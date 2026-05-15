from dotenv import load_dotenv

load_dotenv()

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from sqlalchemy import text
from sqlalchemy import select
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from app.core.config import settings
from app.core.database import Base
from app.core.database import AsyncSessionLocal
from app.core.database import engine
from app.core.database import resolved_database_url
from app.core.database import is_postgres_url
from app.core.security import decode_access_token
from app.core.security import hash_password
from app.db import schema  # noqa: F401  # Ensure model metadata is registered
from app.modules.auth.models import Role, RoleModel, User

from app.modules.activity.router import router as activity_router
from app.modules.audit.router import router as audit_router
from app.modules.attendance.router import router as attendance_router
from app.modules.auth.router import router as auth_router
from app.modules.calendar.router import router as calendar_router
from app.modules.chat.router import router as chat_router
from app.modules.employees.router import router as employees_router
from app.modules.leave.router import router as leave_router
from app.modules.notifications.router import router as notifications_router
from app.modules.timesheets.router import router as timesheets_router


logger = logging.getLogger("hrms.api")


def is_authenticated(request: Request) -> bool:
    token = request.cookies.get("access_token")

    if not token:
        return False

    try:
        decode_access_token(token)
        return True
    except Exception:
        return False


async def _migrate_sqlite_employees_reports_to_nullable() -> None:
    async with engine.begin() as conn:
        if conn.dialect.name != "sqlite":
            return

        table_check = await conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='employees'")
        )
        if table_check.first() is None:
            return

        pragma_rows = await conn.execute(text("PRAGMA table_info(employees)"))
        rows = pragma_rows.fetchall()
        reports_to_info = next((row for row in rows if row[1] == "reports_to_id"), None)
        if reports_to_info is None:
            return

        # PRAGMA table_info columns: cid, name, type, notnull, dflt_value, pk
        reports_to_not_null = int(reports_to_info[3]) == 1
        if not reports_to_not_null:
            return

        await conn.execute(text("PRAGMA foreign_keys=OFF"))
        await conn.execute(
            text(
                """
                CREATE TABLE employees_new (
                    id INTEGER NOT NULL PRIMARY KEY,
                    employee_code VARCHAR(6) NOT NULL,
                    first_name VARCHAR(120) NOT NULL,
                    last_name VARCHAR(120) NOT NULL,
                    job_title VARCHAR(120) NOT NULL,
                    date_joined DATE NOT NULL,
                    department_id INTEGER NOT NULL,
                    reports_to_id INTEGER NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(department_id) REFERENCES departments (id),
                    FOREIGN KEY(reports_to_id) REFERENCES employees (id)
                )
                """
            )
        )
        await conn.execute(
            text(
                """
                INSERT INTO employees_new (
                    id, employee_code, first_name, last_name, job_title,
                    date_joined, department_id, reports_to_id, created_at
                )
                SELECT
                    id, employee_code, first_name, last_name, job_title,
                    date_joined, department_id, reports_to_id, created_at
                FROM employees
                """
            )
        )
        await conn.execute(text("DROP TABLE employees"))
        await conn.execute(text("ALTER TABLE employees_new RENAME TO employees"))
        await conn.execute(
            text("CREATE UNIQUE INDEX IF NOT EXISTS ix_employees_employee_code ON employees (employee_code)")
        )
        await conn.execute(text("PRAGMA foreign_keys=ON"))


async def _migrate_auth_totp_columns() -> None:
    async with engine.begin() as conn:
        if conn.dialect.name == "postgresql":
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64)"))
            await conn.execute(
                text("ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE")
            )
            await conn.execute(
                text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_change_required "
                    "BOOLEAN NOT NULL DEFAULT FALSE"
                )
            )
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_mobile VARCHAR(40)"))
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_data_url TEXT"))
            return

        if conn.dialect.name == "sqlite":
            pragma_rows = await conn.execute(text("PRAGMA table_info(users)"))
            columns = {row[1] for row in pragma_rows.fetchall()}
            if "totp_secret" not in columns:
                await conn.execute(text("ALTER TABLE users ADD COLUMN totp_secret VARCHAR(64)"))
            if "totp_enabled" not in columns:
                await conn.execute(
                    text("ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN NOT NULL DEFAULT 0")
                )
            if "password_change_required" not in columns:
                await conn.execute(
                    text("ALTER TABLE users ADD COLUMN password_change_required BOOLEAN NOT NULL DEFAULT 0")
                )
            if "profile_mobile" not in columns:
                await conn.execute(text("ALTER TABLE users ADD COLUMN profile_mobile VARCHAR(40)"))
            if "profile_photo_data_url" not in columns:
                await conn.execute(text("ALTER TABLE users ADD COLUMN profile_photo_data_url TEXT"))


async def _migrate_nullable_workflow_columns() -> None:
    nullable_columns = {
        "leave_requests": ["supervisor_id", "manager_id", "decision_note"],
        "timesheets": ["approver_id", "decision_note"],
        "timesheet_entries": ["notes"],
        "calendar_events": ["description", "location", "meeting_link"],
        "chat_messages": ["recipient_id", "group_id"],
    }

    async with engine.begin() as conn:
        if conn.dialect.name == "postgresql":
            for table_name, column_names in nullable_columns.items():
                for column_name in column_names:
                    await conn.execute(
                        text(
                            f'ALTER TABLE IF EXISTS "{table_name}" '
                            f'ALTER COLUMN "{column_name}" DROP NOT NULL'
                        )
                    )
            return

        # New SQLite databases use the SQLAlchemy model metadata above. Existing
        # SQLite schema rewrites are intentionally avoided here because Render
        # production uses Postgres and SQLite ALTER COLUMN is not supported.


async def _migrate_leave_type_column() -> None:
    async with engine.begin() as conn:
        if conn.dialect.name == "postgresql":
            await conn.execute(
                text(
                    "ALTER TABLE IF EXISTS leave_requests "
                    "ADD COLUMN IF NOT EXISTS leave_type VARCHAR(120) NOT NULL DEFAULT 'Leave'"
                )
            )
            return

        if conn.dialect.name == "sqlite":
            table_check = await conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name='leave_requests'")
            )
            if table_check.first() is None:
                return

            pragma_rows = await conn.execute(text("PRAGMA table_info(leave_requests)"))
            columns = {row[1] for row in pragma_rows.fetchall()}
            if "leave_type" not in columns:
                await conn.execute(
                    text("ALTER TABLE leave_requests ADD COLUMN leave_type VARCHAR(120) NOT NULL DEFAULT 'Leave'")
                )


async def _migrate_leave_workflow_columns() -> None:
    workflow_columns = {
        "approval_flow": "VARCHAR(120)",
        "current_step": "VARCHAR(40)",
        "workflow_steps": "JSON",
        "approval_history": "JSON",
        "revoke_rule": "VARCHAR(120)",
    }

    async with engine.begin() as conn:
        if conn.dialect.name == "postgresql":
            await conn.execute(text("ALTER TYPE leavestatus ADD VALUE IF NOT EXISTS 'pending_hr'"))
            await conn.execute(text("ALTER TYPE leavestatus ADD VALUE IF NOT EXISTS 'cancelled'"))
            for column_name, column_type in workflow_columns.items():
                await conn.execute(
                    text(
                        "ALTER TABLE IF EXISTS leave_requests "
                        f"ADD COLUMN IF NOT EXISTS {column_name} {column_type}"
                    )
                )
            return

        if conn.dialect.name == "sqlite":
            table_check = await conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name='leave_requests'")
            )
            if table_check.first() is None:
                return

            pragma_rows = await conn.execute(text("PRAGMA table_info(leave_requests)"))
            columns = {row[1] for row in pragma_rows.fetchall()}
            sqlite_types = {
                "approval_flow": "VARCHAR(120)",
                "current_step": "VARCHAR(40)",
                "workflow_steps": "JSON",
                "approval_history": "JSON",
                "revoke_rule": "VARCHAR(120)",
            }
            for column_name, column_type in sqlite_types.items():
                if column_name not in columns:
                    await conn.execute(
                        text(f"ALTER TABLE leave_requests ADD COLUMN {column_name} {column_type}")
                    )


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, version="0.1.0")
    static_dir = Path(__file__).resolve().parent / "static"

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        logger.warning(
            "API error %s %s -> %s: %s",
            request.method,
            request.url.path,
            exc.status_code,
            exc.detail,
        )
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        errors = exc.errors()
        logger.warning(
            "API validation error %s %s -> 422: %s",
            request.method,
            request.url.path,
            errors,
        )
        return JSONResponse(status_code=422, content={"detail": errors})

    @app.exception_handler(SQLAlchemyError)
    async def sqlalchemy_exception_handler(request: Request, exc: SQLAlchemyError):
        logger.exception(
            "Database error %s %s: %s",
            request.method,
            request.url.path,
            exc,
        )
        return JSONResponse(
            status_code=500,
            content={"detail": "Database error. Check Render logs for details."},
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        logger.exception(
            "Unhandled error %s %s: %s",
            request.method,
            request.url.path,
            exc,
        )
        return JSONResponse(
            status_code=500,
            content={"detail": "Unexpected server error. Check Render logs for details."},
        )

    @app.on_event("startup")
    async def normalize_role_enum_values() -> None:
        await _migrate_sqlite_employees_reports_to_nullable()
        await _migrate_auth_totp_columns()

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            role_name_expr = "name::text" if conn.dialect.name == "postgresql" else "name"
            try:
                await conn.execute(
                    text(f"UPDATE roles SET name='admin' WHERE lower({role_name_expr})='admin'")
                )
                await conn.execute(
                    text(f"UPDATE roles SET name='hr' WHERE lower({role_name_expr})='hr'")
                )
                await conn.execute(
                    text(f"UPDATE roles SET name='manager' WHERE lower({role_name_expr})='manager'")
                )
                await conn.execute(
                    text(f"UPDATE roles SET name='supervisor' WHERE lower({role_name_expr})='supervisor'")
                )
                await conn.execute(
                    text(f"UPDATE roles SET name='employee' WHERE lower({role_name_expr})='employee'")
                )
            except OperationalError:
                # If startup races with initial DB bootstrap, continue without failing boot.
                pass

        await _migrate_nullable_workflow_columns()
        await _migrate_leave_type_column()
        await _migrate_leave_workflow_columns()

        admin_email = (settings.admin_email or "").strip().lower()
        admin_password = (settings.admin_password or "").strip()
        if admin_email and admin_password:
            async with AsyncSessionLocal() as session:
                role_result = await session.execute(
                    select(RoleModel).where(RoleModel.name == Role.admin)
                )
                admin_role = role_result.scalar_one_or_none()
                if not admin_role:
                    admin_role = RoleModel(name=Role.admin)
                    session.add(admin_role)
                    await session.flush()

                result = await session.execute(select(User).where(User.email == admin_email))
                existing_user = result.scalar_one_or_none()
                if existing_user:
                    existing_user.password_hash = hash_password(admin_password)
                    existing_user.is_active = True
                    existing_user.roles = [admin_role]
                    action = "updated"
                else:
                    user = User(
                        email=admin_email,
                        password_hash=hash_password(admin_password),
                        employee_id=None,
                        roles=[admin_role],
                        is_active=True,
                    )
                    session.add(user)
                    action = "created"

                await session.commit()
                print(f"Startup admin {action}: {admin_email}")
        else:
            print("Startup admin not configured: set ADMIN_EMAIL and ADMIN_PASSWORD on Render.")

    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
    app.include_router(audit_router, prefix="/api/v1/audit-logs", tags=["audit"])
    app.include_router(activity_router, prefix="/api/v1/activity", tags=["activity"])
    app.include_router(employees_router, prefix="/api/v1/employees", tags=["employees"])
    app.include_router(leave_router, prefix="/api/v1/leaves", tags=["leaves"])
    app.include_router(timesheets_router, prefix="/api/v1/timesheets", tags=["timesheets"])
    app.include_router(attendance_router, prefix="/api/v1/attendance", tags=["attendance"])
    app.include_router(calendar_router, prefix="/api/v1/calendar", tags=["calendar"])
    app.include_router(chat_router, prefix="/api/v1/chat", tags=["chat"])
    app.include_router(
        notifications_router,
        prefix="/api/v1/notifications",
        tags=["notifications"],
    )

    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "service": settings.app_name,
            "web": "enabled",
            "database": "postgres" if is_postgres_url(resolved_database_url) else "sqlite",
            "persistent_database": is_postgres_url(resolved_database_url),
        }

    @app.get("/", include_in_schema=False)
    async def web_app(request: Request):
        if not is_authenticated(request):
            return RedirectResponse(url="/login")
        return FileResponse(static_dir / "index.html")

    @app.get("/dashboard", include_in_schema=False)
    async def dashboard(request: Request):
        if not is_authenticated(request):
            return RedirectResponse(url="/login")
        return FileResponse(static_dir / "index.html")

    @app.get("/admin", include_in_schema=False)
    async def admin_console(request: Request):
        if not is_authenticated(request):
            return RedirectResponse(url="/login")
        return FileResponse(static_dir / "index.html")

    @app.get("/admin/{section}", include_in_schema=False)
    async def admin_section(section: str, request: Request):
        if not is_authenticated(request):
            return RedirectResponse(url="/login")
        return FileResponse(static_dir / "index.html")

    @app.get("/login", include_in_schema=False)
    async def login_page():
        return FileResponse(static_dir / "login.html")

    @app.get("/{page_name}", include_in_schema=False)
    async def client_page(page_name: str, request: Request):
        client_pages = {"chat", "timesheet", "leave", "requests", "calendar", "activity", "profile"}
        if page_name not in client_pages:
            raise HTTPException(status_code=404, detail="Not Found")
        if not is_authenticated(request):
            return RedirectResponse(url="/login")
        return FileResponse(static_dir / "index.html")

    return app


app = create_app()
