from pydantic import BaseModel, EmailStr, Field

from app.modules.auth.models import Role


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    # Accepts either work email or employee code / employee id.
    login: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=8)


class ForgotPasswordRequest(BaseModel):
    # Accepts either work email or employee code / employee id.
    login: str = Field(min_length=1, max_length=255)


class ResetPasswordRequest(BaseModel):
    # Accepts either work email or employee code / employee id.
    login: str = Field(min_length=1, max_length=255)
    otp: str = Field(min_length=4, max_length=10)
    new_password: str = Field(min_length=8)


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    roles: list[Role] = Field(default_factory=lambda: [Role.employee])
    employee_id: int | None = None


class RoleRead(BaseModel):
    id: int
    name: Role

    model_config = {"from_attributes": True}


class UserRead(BaseModel):
    id: int
    email: EmailStr
    is_active: bool
    roles: list[RoleRead]

    model_config = {"from_attributes": True}
