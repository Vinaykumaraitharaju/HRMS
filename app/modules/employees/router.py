from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.modules.auth.models import Role, User
from app.modules.audit.service import safe_record_audit
from app.modules.employees.schemas import (
    DepartmentCreate,
    DepartmentRead,
    EmployeeCreate,
    EmployeeRead,
    EmployeeUpdate,
)
from app.modules.employees.service import EmployeeService

router = APIRouter()


@router.post("/departments", response_model=DepartmentRead, status_code=status.HTTP_201_CREATED)
async def create_department(
    payload: DepartmentCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(Role.admin, Role.hr))],
):
    department = await EmployeeService(db).create_department(payload)
    await safe_record_audit(
        db,
        category="Employees",
        action="department.created",
        message=f"Department created: {department.name}",
        actor=current_user,
        entity_type="department",
        entity_id=department.id,
    )
    return department


@router.get("/departments", response_model=list[DepartmentRead])
async def list_departments(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
):
    return await EmployeeService(db).list_departments()


@router.post("", response_model=EmployeeRead, status_code=status.HTTP_201_CREATED)
async def create_employee(
    payload: EmployeeCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(Role.admin, Role.hr))],
):
    employee = await EmployeeService(db).create_employee(payload)
    await safe_record_audit(
        db,
        category="Employees",
        action="employee.created",
        message=f"Employee created: {employee.first_name} {employee.last_name} ({employee.employee_code})",
        actor=current_user,
        entity_type="employee",
        entity_id=employee.id,
        details={"employee_code": employee.employee_code},
    )
    return employee


@router.get("", response_model=list[EmployeeRead])
async def list_employees(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    return await EmployeeService(db).list_employees(current_user)


@router.get("/{employee_id}", response_model=EmployeeRead)
async def get_employee(
    employee_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    return await EmployeeService(db).get_employee_for_user(employee_id, current_user)


@router.patch("/{employee_id}", response_model=EmployeeRead)
async def update_employee(
    employee_id: int,
    payload: EmployeeUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(Role.admin, Role.hr))],
):
    employee = await EmployeeService(db).update_employee(employee_id, payload)
    await safe_record_audit(
        db,
        category="Employees",
        action="employee.updated",
        message=f"Employee updated: {employee.first_name} {employee.last_name} ({employee.employee_code})",
        actor=current_user,
        entity_type="employee",
        entity_id=employee.id,
        details=payload.model_dump(exclude_unset=True),
    )
    return employee


@router.delete("/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_employee(
    employee_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(Role.admin))],
) -> None:
    await EmployeeService(db).delete_employee(employee_id)
    await safe_record_audit(
        db,
        category="Employees",
        action="employee.deactivated",
        message=f"Employee deactivated: #{employee_id}",
        actor=current_user,
        entity_type="employee",
        entity_id=employee_id,
    )
