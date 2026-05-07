from __future__ import annotations

import hashlib
import os
import random
import smtplib
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, hash_password, verify_password
from app.modules.auth.models import PasswordResetOTP, Role, RoleModel, User
from app.modules.auth.schemas import Token, UserCreate
from app.modules.employees.models import Employee


class AuthService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ---------------- LOGIN ----------------
    async def authenticate(self, login: str, password: str) -> Token:
        user = await self._find_user_by_login(login)

        if (
            not user
            or not user.is_active
            or not verify_password(password, user.password_hash)
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email/employee ID or password",
            )

        roles = [self._role_to_str(role.name) for role in user.roles]
        token = create_access_token(str(user.id), {"roles": roles})
        return Token(access_token=token)

    # ---------------- SEND OTP ----------------
    async def send_reset_otp(self, login: str) -> dict[str, str]:
        user = await self._find_user_by_login(login)

        if not user or not user.is_active:
            return {
                "message": "If the account exists, an OTP has been sent to the registered email."
            }

        otp = f"{random.SystemRandom().randint(100000, 999999)}"
        otp_hash = self._otp_hash(user.id, otp)
        expires_at = datetime.now(UTC) + timedelta(minutes=10)

        # invalidate old OTPs
        await self.db.execute(
            update(PasswordResetOTP)
            .where(
                PasswordResetOTP.user_id == user.id,
                PasswordResetOTP.used_at.is_(None),
            )
            .values(used_at=datetime.now(UTC))
        )

        self.db.add(
            PasswordResetOTP(
                user_id=user.id,
                otp_hash=otp_hash,
                expires_at=expires_at,
            )
        )

        await self.db.commit()

        await self._send_otp_email(user.email, otp)

        return {
            "message": "If the account exists, an OTP has been sent to the registered email."
        }

    # ---------------- RESET PASSWORD ----------------
    async def reset_password_with_otp(
        self, login: str, otp: str, new_password: str
    ) -> dict[str, str]:
        user = await self._find_user_by_login(login)

        if not user or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired OTP",
            )

        otp_hash = self._otp_hash(user.id, otp.strip())
        now = datetime.now(UTC)

        result = await self.db.execute(
            select(PasswordResetOTP)
            .where(
                PasswordResetOTP.user_id == user.id,
                PasswordResetOTP.otp_hash == otp_hash,
                PasswordResetOTP.used_at.is_(None),
                PasswordResetOTP.expires_at > now,
            )
            .order_by(PasswordResetOTP.id.desc())
        )

        reset_otp = result.scalars().first()

        if not reset_otp:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired OTP",
            )

        user.password_hash = hash_password(new_password)
        reset_otp.used_at = now

        await self.db.commit()

        return {"message": "Password updated successfully"}

    # ---------------- EMAIL SENDER ----------------
    async def _send_otp_email(self, to_email: str, otp: str) -> None:
        smtp_host = os.getenv("SMTP_HOST", "").strip()
        smtp_port = int(os.getenv("SMTP_PORT", "587"))
        smtp_user = (
            os.getenv("SMTP_USERNAME", "").strip()
            or os.getenv("SMTP_USER", "").strip()
        )
        smtp_password = (
            os.getenv("SMTP_PASSWORD", "").strip() or os.getenv("SMTP_PASS", "").strip()
        )
        smtp_password = smtp_password.replace(" ", "")
        smtp_from = (
            os.getenv("FROM_EMAIL", "").strip()
            or os.getenv("SMTP_FROM", "").strip()
            or smtp_user
        ).strip()

        subject = "Your Wavelynk HRMS Password Reset OTP"

        plain_body = f"Your OTP is {otp}. It expires in 10 minutes."

        html_body = f"""
        <html>
        <body style="background:#f4f7fb;font-family:Arial;text-align:center;padding:20px;">
            <div style="background:#fff;padding:30px;border-radius:12px;">
                <h2>Wavelynk HRMS</h2>
                <p>Your OTP Code:</p>
                <h1 style="letter-spacing:6px;">{otp}</h1>
                <p>Valid for 10 minutes</p>
            </div>
        </body>
        </html>
        """

        if not smtp_host or not smtp_user or not smtp_password:
            print(f"[DEV OTP] {otp}")
            return

        msg = EmailMessage()
        msg["From"] = smtp_from
        msg["To"] = to_email
        msg["Subject"] = subject
        msg.set_content(plain_body)
        msg.add_alternative(html_body, subtype="html")

        try:
            with smtplib.SMTP(smtp_host, smtp_port) as smtp:
                smtp.starttls()
                smtp.login(smtp_user, smtp_password)
                smtp.send_message(msg)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"SMTP send failed: {exc}",
            )

    # ---------------- HELPERS ----------------
    async def _find_user_by_login(self, login: str) -> User | None:
        login = (login or "").strip()
        if not login:
            return None

        login_lower = login.lower()
        conditions = [func.lower(User.email) == login_lower]

        if login.isdigit():
            conditions.append(User.id == int(login))

        result = await self.db.execute(
            select(User)
            .outerjoin(Employee, Employee.id == User.employee_id)
            .where(
                User.is_active.is_(True),
                or_(*conditions, func.lower(Employee.employee_code) == login_lower),
            )
        )

        return result.scalars().first()

    async def _get_or_create_roles(self, names: list[Role]) -> list[RoleModel]:
        result = await self.db.execute(
            select(RoleModel).where(RoleModel.name.in_(names))
        )

        roles_by_name = {role.name: role for role in result.scalars().all()}

        for name in names:
            if name not in roles_by_name:
                role = RoleModel(name=name)
                self.db.add(role)
                roles_by_name[name] = role

        await self.db.flush()
        return [roles_by_name[name] for name in names]

    def _otp_hash(self, user_id: int, otp: str) -> str:
        secret = os.getenv("JWT_SECRET_KEY", "dev-secret")
        raw = f"{user_id}:{otp}:{secret}"
        return hashlib.sha256(raw.encode()).hexdigest()

    def _role_to_str(self, value: Role | str) -> str:
        return value.value if isinstance(value, Role) else str(value)
