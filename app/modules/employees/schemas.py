from datetime import date

from pydantic import BaseModel, EmailStr, Field

from app.modules.auth.models import Role


class DepartmentCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)


class DepartmentRead(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}


class EmployeeCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(min_length=1, max_length=120)

    # ✅ NEW (required for login)
    email: EmailStr

    job_title: str = Field(min_length=2, max_length=120)
    date_joined: date
    department_id: int

    reports_to_id: int | None = None

    # ✅ NEW (role assignment)
    role: Role = Role.employee

    # ✅ NEW (optional password)
    password: str | None = Field(default=None, min_length=8)


class EmployeeUpdate(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=120)
    last_name: str | None = Field(default=None, min_length=1, max_length=120)
    job_title: str | None = Field(default=None, min_length=2, max_length=120)
    department_id: int | None = None
    reports_to_id: int | None = None


class EmployeeRead(BaseModel):
    id: int
    employee_code: str
    first_name: str
    last_name: str
    job_title: str
    date_joined: date
    department_id: int
    reports_to_id: int | None

    # ✅ OPTIONAL (useful for UI later)
    # email: str | None = None

    model_config = {"from_attributes": True}
