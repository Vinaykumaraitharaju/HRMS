from pydantic import BaseModel, EmailStr, Field

from app.modules.auth.models import Role


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginResponse(BaseModel):
    access_token: str | None = None
    token_type: str = "bearer"
    mfa_required: bool = False
    mfa_setup_required: bool = False
    message: str | None = None
    otp_auth_uri: str | None = None
    qr_code_data_url: str | None = None
    manual_setup_key: str | None = None


class LoginRequest(BaseModel):
    # Accepts either work email or employee code / employee id.
    login: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=8)
    totp_code: str | None = Field(default=None, min_length=6, max_length=6)


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
