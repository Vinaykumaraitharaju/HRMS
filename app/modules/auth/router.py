from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import Base, engine
from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.core.security import decode_access_token, hash_password, verify_password
from app.modules.auth.models import Role, RoleModel, User, user_roles
from app.modules.auth.schemas import (
    ForgotPasswordRequest,
    LoginResponse,
    LoginRequest,
    ProfileUpdateRequest,
    ResetPasswordRequest,
    UserCreate,
    UserRead,
)
from app.modules.auth.service import AuthService
from app.modules.employees.models import Employee

router = APIRouter()


class UserRoleUpdateRequest(BaseModel):
    role: Role


class AdminPasswordResetRequest(BaseModel):
    password: str
    reset_authenticator: bool = True


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


def role_value(role_name: Role | str) -> str:
    return role_name.value if isinstance(role_name, Role) else str(role_name)


def user_display_name(first_name: str | None, last_name: str | None, email: str) -> str:
    full_name = " ".join(part for part in [first_name, last_name] if part).strip()
    if full_name:
        return full_name

    local_part = (
        email.split("@", 1)[0].replace(".", " ").replace("_", " ").replace("-", " ")
    )
    return (
        "".join(f" {char}" if char.isdigit() else char for char in local_part)
        .title()
        .strip()
    )


def user_row_payload(row, roles: list[str]) -> dict:
    name = user_display_name(row.first_name, row.last_name, row.email)
    return {
        "id": int(row.id),
        "email": row.email,
        "name": name,
        "full_name": name,
        "employee_id": row.employee_id,
        "employee_code": row.employee_code,
        "job_title": row.job_title,
        "totp_enabled": bool(getattr(row, "totp_enabled", False)),
        "password_change_required": bool(getattr(row, "password_change_required", False)),
        "roles": roles,
    }


def get_bearer_or_cookie_token(request: Request) -> str | None:
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip()
    return request.cookies.get("access_token")


@router.post("/login")
async def login(
    payload: LoginRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LoginResponse:
    token = await AuthService(db).authenticate(
        payload.login,
        payload.password,
        payload.totp_code,
    )

    if not token.access_token:
        return token

    response.set_cookie(
        key="access_token",
        value=token.access_token,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/",
        max_age=60 * 60 * 24,
    )

    return token


@router.post("/forgot-password")
async def forgot_password(
    payload: ForgotPasswordRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return await AuthService(db).send_reset_otp(payload.login)


@router.post("/reset-password")
async def reset_password(
    payload: ResetPasswordRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return await AuthService(db).reset_password_with_otp(
        payload.login,
        payload.otp,
        payload.new_password,
    )


@router.get("/me")
async def me(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    token = get_bearer_or_cookie_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = decode_access_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    result = await db.execute(
        select(User).where(User.id == int(user_id), User.is_active.is_(True))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    roles = [role_value(role.name) for role in user.roles]
    employee = user.employee
    name = user_display_name(
        employee.first_name if employee else None,
        employee.last_name if employee else None,
        user.email,
    )

    return {
        "id": int(user.id),
        "email": user.email,
        "name": name,
        "full_name": name,
        "employee_id": user.employee_id,
        "employee_code": employee.employee_code if employee else None,
        "job_title": employee.job_title if employee else None,
        "mobile": user.profile_mobile,
        "profile_photo_data_url": user.profile_photo_data_url,
        "role": roles[0] if roles else "employee",
        "roles": roles,
        "totp_enabled": bool(user.totp_enabled),
        "password_change_required": bool(user.password_change_required),
    }


@router.put("/me/profile")
async def update_my_profile(
    payload: ProfileUpdateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    current_user.profile_mobile = (payload.mobile or "").strip() or None
    current_user.profile_photo_data_url = payload.photo_data_url or None
    await db.commit()
    await db.refresh(current_user)

    return {
        "message": "Profile updated",
        "mobile": current_user.profile_mobile,
        "profile_photo_data_url": current_user.profile_photo_data_url,
    }


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    current_password = str(payload.current_password or "")
    new_password = str(payload.new_password or "")

    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")

    if not verify_password(current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    current_user.password_hash = hash_password(new_password[:72])
    current_user.password_change_required = False
    await db.commit()

    return {"message": "Password updated successfully"}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(key="access_token", path="/", samesite="lax", secure=False)
    return {"message": "Logged out"}


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(Role.admin))],
):
    return await AuthService(db).create_user(payload)


@router.get("/users")
async def list_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(Role.admin))],
):
    return await _directory_payload(db)


@router.patch("/users/{user_id}/role")
async def update_user_role(
    user_id: int,
    payload: UserRoleUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(Role.admin))],
):
    user_result = await db.execute(
        select(User).where(User.id == user_id, User.is_active.is_(True))
    )
    user = user_result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    role_result = await db.execute(
        select(RoleModel).where(RoleModel.name == payload.role)
    )
    role = role_result.scalar_one_or_none()

    if not role:
        role = RoleModel(name=payload.role)
        db.add(role)
        await db.flush()

    user.roles = [role]

    await db.commit()
    await db.refresh(user)

    return {
        "message": "Role updated successfully",
        "user_id": user.id,
        "role": payload.role.value,
    }


@router.post("/employees/{employee_id}/reset-password")
async def reset_employee_password(
    employee_id: int,
    payload: AdminPasswordResetRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(Role.admin))],
):
    password = str(payload.password or "")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    result = await db.execute(
        select(User).where(User.employee_id == employee_id, User.is_active.is_(True))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="Employee user account not found")

    user.password_hash = hash_password(password[:72])
    user.password_change_required = True
    if payload.reset_authenticator:
        user.totp_secret = None
        user.totp_enabled = False

    await db.commit()

    return {
        "message": "Password reset",
        "email": user.email,
        "authenticator_reset": bool(payload.reset_authenticator),
    }


@router.post("/seed-admin")
async def seed_admin(payload: dict, db: Annotated[AsyncSession, Depends(get_db)]):
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password")

    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password required")

    # bcrypt has a 72-byte input limit; cap admin seed password for compatibility.
    password = str(password)[:72]

    try:
        # Ensure all tables exist before seeding.
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        role_result = await db.execute(
            select(RoleModel).where(RoleModel.name == Role.admin)
        )
        admin_role = role_result.scalar_one_or_none()
        if not admin_role:
            admin_role = RoleModel(name=Role.admin)
            db.add(admin_role)
            await db.flush()

        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()

        if user:
            user.password_hash = hash_password(password)
            user.is_active = True
            user.password_change_required = False
            user.roles = [admin_role]
            await db.commit()
            return {"message": "Admin updated", "email": email}

        user = User(
            email=email,
            password_hash=hash_password(password),
            employee_id=None,
            roles=[admin_role],
            is_active=True,
            password_change_required=False,
        )

        db.add(user)
        await db.commit()
        return {"message": "Admin created", "email": email}
    except SQLAlchemyError as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Seed admin failed: {exc}")
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Seed admin unexpected error: {exc}")


@router.get("/directory")
async def directory_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
):
    return await _directory_payload(db)


async def _directory_payload(db: AsyncSession) -> list[dict]:
    users_result = await db.execute(
        select(
            User.id,
            User.email,
            User.employee_id,
            User.totp_enabled,
            User.password_change_required,
            Employee.first_name,
            Employee.last_name,
            Employee.employee_code,
            Employee.job_title,
        )
        .outerjoin(Employee, Employee.id == User.employee_id)
        .where(User.is_active.is_(True))
    )

    users = users_result.all()
    user_ids = [int(row.id) for row in users]
    role_map: dict[int, list[str]] = {user_id: [] for user_id in user_ids}

    if user_ids:
        roles_result = await db.execute(
            select(user_roles.c.user_id, RoleModel.name)
            .join(RoleModel, RoleModel.id == user_roles.c.role_id)
            .where(user_roles.c.user_id.in_(user_ids))
        )
        for user_id, role_name in roles_result.all():
            role_map.setdefault(int(user_id), []).append(role_value(role_name))

    return [user_row_payload(row, role_map.get(int(row.id), [])) for row in users]
