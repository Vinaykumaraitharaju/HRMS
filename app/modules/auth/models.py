from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Table,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

# ✅ Import Employee properly (adjust path if needed)
from app.modules.employee.models import Employee


class Role(str, enum.Enum):
    admin = "admin"
    hr = "hr"
    manager = "manager"
    supervisor = "supervisor"
    employee = "employee"


user_roles = Table(
    "user_roles",
    Base.metadata,
    mapped_column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    mapped_column("role_id", ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)


class RoleModel(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[Role] = mapped_column(Enum(Role), unique=True, index=True)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    employee_id: Mapped[int | None] = mapped_column(
        ForeignKey("employees.id", ondelete="SET NULL"),
        nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    roles: Mapped[list[RoleModel]] = relationship(
        secondary=user_roles,
        lazy="selectin"
    )

    employee: Mapped[Employee | None] = relationship(
        back_populates="user",
        lazy="selectin"
    )


class PasswordResetOTP(Base):
    __tablename__ = "password_reset_otps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True
    )

    otp_hash: Mapped[str] = mapped_column(String(255), index=True)

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        index=True
    )

    used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now()
    )

    user: Mapped[User] = relationship(
        lazy="selectin"
    )
