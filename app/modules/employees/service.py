from datetime import date
import secrets

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.modules.auth.models import Role, RoleModel, User
from app.modules.employees.models import Department, Employee
from app.modules.employees.schemas import (
    DepartmentCreate,
    EmployeeCreate,
    EmployeeUpdate,
)


class EmployeeService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_department(self, payload: DepartmentCreate) -> Department:
        name = payload.name.strip()

        existing = await self.db.execute(
            select(Department).where(func.lower(Department.name) == name.lower())
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Department already exists",
            )

        department = Department(name=name)
        self.db.add(department)
        await self.db.commit()
        await self.db.refresh(department)
        return department

    async def list_departments(self) -> list[Department]:
        result = await self.db.execute(select(Department).order_by(Department.name))
        return list(result.scalars().all())

    async def create_employee(self, payload: EmployeeCreate) -> Employee:
        await self._ensure_department(payload.department_id)

        if payload.reports_to_id:
            if payload.reports_to_id == 0:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Invalid manager",
                )
            await self.get_employee(payload.reports_to_id)

        employee_code = await self._next_employee_code(payload.date_joined)

        payload_data = payload.model_dump()

        # These fields are for account creation, not Employee table.
        email = str(payload_data.pop("email", "") or "").strip().lower()
        role_value = payload_data.pop("role", Role.employee)

        if isinstance(role_value, Role):
            role_enum = role_value
        else:
            try:
                role_enum = Role(str(role_value).lower())
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Invalid role",
                )
        password = str(payload_data.pop("password", "") or "").strip()

        if not email:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Work email is required to create employee login",
            )

        existing_user = await self.db.execute(
            select(User).where(func.lower(User.email) == email)
        )
        if existing_user.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A user with this email already exists",
            )

        if payload_data.get("reports_to_id") is None:
            # Backward-compatible fallback for legacy SQLite schemas where
            # reports_to_id is still NOT NULL in production.
            next_id_result = await self.db.execute(select(func.max(Employee.id)))
            next_id = (next_id_result.scalar_one_or_none() or 0) + 1
            payload_data["id"] = next_id
            payload_data["reports_to_id"] = next_id

        employee = Employee(employee_code=employee_code, **payload_data)
        self.db.add(employee)
        await self.db.flush()

        role = await self._get_or_create_role(role_enum)

        # Temporary password if admin did not provide one.
        initial_password = password or f"Welcome@{employee_code}"

        user = User(
            email=email,
            password_hash=hash_password(initial_password),
            employee_id=employee.id,
            roles=[role],
            is_active=True,
            password_change_required=True,
        )

        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(employee)
        return employee

    async def list_employees(self, current_user: User) -> list[Employee]:
        result = await self.db.execute(
            select(Employee).order_by(Employee.employee_code)
        )
        employees = list(result.scalars().all())

        role_names = {self._role_value(role.name) for role in current_user.roles}

        if role_names.intersection({Role.admin.value, Role.hr.value}):
            return employees

        if (
            role_names.intersection({Role.manager.value, Role.supervisor.value})
            and current_user.employee_id
        ):
            return [
                employee
                for employee in employees
                if employee.id == current_user.employee_id
                or employee.reports_to_id == current_user.employee_id
            ]

        if current_user.employee_id:
            return [
                employee
                for employee in employees
                if employee.id == current_user.employee_id
            ]

        return []

    async def get_employee(self, employee_id: int) -> Employee:
        result = await self.db.execute(
            select(Employee).where(Employee.id == employee_id)
        )
        employee = result.scalar_one_or_none()

        if not employee:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employee not found",
            )

        return employee

    async def get_employee_for_user(
        self,
        employee_id: int,
        current_user: User,
    ) -> Employee:
        employee = await self.get_employee(employee_id)
        role_names = {self._role_value(role.name) for role in current_user.roles}

        if role_names.intersection({Role.admin.value, Role.hr.value}):
            return employee

        if current_user.employee_id == employee.id:
            return employee

        if (
            role_names.intersection({Role.manager.value, Role.supervisor.value})
            and employee.reports_to_id == current_user.employee_id
        ):
            return employee

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot view this employee",
        )

    async def update_employee(
        self,
        employee_id: int,
        payload: EmployeeUpdate,
    ) -> Employee:
        employee = await self.get_employee(employee_id)
        updates = payload.model_dump(exclude_unset=True)

        if "department_id" in updates:
            await self._ensure_department(updates["department_id"])

        if updates.get("reports_to_id") == employee.id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Employee cannot report to self",
            )

        if updates.get("reports_to_id"):
            await self.get_employee(updates["reports_to_id"])

        for key, value in updates.items():
            setattr(employee, key, value)

        await self.db.commit()
        await self.db.refresh(employee)
        return employee

    async def delete_employee(self, employee_id: int) -> None:
        employee = await self.get_employee(employee_id)

        user_result = await self.db.execute(
            select(User).where(User.employee_id == employee.id)
        )
        user = user_result.scalar_one_or_none()

        if user:
            user.is_active = False
            user.employee_id = None

        await self.db.delete(employee)
        await self.db.commit()

    async def _next_employee_code(self, joined_on: date) -> str:
        prefix = joined_on.strftime("%y")

        result = await self.db.execute(
            select(Employee.employee_code).where(
                Employee.employee_code.like(f"{prefix}%")
            )
        )

        sequences: list[int] = []
        for code in result.scalars().all():
            suffix = str(code).removeprefix(prefix)
            if suffix.isdigit():
                sequences.append(int(suffix))

        sequence = (max(sequences) if sequences else 0) + 1
        return f"{prefix}{sequence:04d}"

    async def _ensure_department(self, department_id: int) -> None:
        result = await self.db.execute(
            select(Department.id).where(Department.id == department_id)
        )

        if result.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Department not found",
            )

    async def _get_or_create_role(self, role_name: Role) -> RoleModel:
        result = await self.db.execute(
            select(RoleModel).where(RoleModel.name == role_name)
        )
        role = result.scalar_one_or_none()

        if role:
            return role

        role = RoleModel(name=role_name)
        self.db.add(role)
        await self.db.flush()
        return role

    def _role_value(self, role_name: Role | str) -> str:
        return role_name.value if isinstance(role_name, Role) else str(role_name)
