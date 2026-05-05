from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.modules.auth.models import Role, User
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
    _: Annotated[User, Depends(require_roles(Role.admin, Role.hr))],
):
    return await EmployeeService(db).create_department(payload)


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
    _: Annotated[User, Depends(require_roles(Role.admin, Role.hr))],
):
    return await EmployeeService(db).create_employee(payload)


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
    _: Annotated[User, Depends(require_roles(Role.admin, Role.hr))],
):
    return await EmployeeService(db).update_employee(employee_id, payload)


@router.delete("/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_employee(
    employee_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(Role.admin))],
) -> None:
    await EmployeeService(db).delete_employee(employee_id)
