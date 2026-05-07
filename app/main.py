from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from sqlalchemy import text
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app.core.config import settings
from app.core.database import Base
from app.core.database import AsyncSessionLocal
from app.core.database import engine
from app.core.security import decode_access_token
from app.core.security import hash_password
from app.db import schema  # noqa: F401  # Ensure model metadata is registered
from app.modules.auth.models import Role, RoleModel, User

from app.modules.activity.router import router as activity_router
from app.modules.attendance.router import router as attendance_router
from app.modules.auth.router import router as auth_router
from app.modules.calendar.router import router as calendar_router
from app.modules.chat.router import router as chat_router
from app.modules.employees.router import router as employees_router
from app.modules.leave.router import router as leave_router
from app.modules.notifications.router import router as notifications_router
from app.modules.timesheets.router import router as timesheets_router


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


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, version="0.1.0")
    static_dir = Path(__file__).resolve().parent / "static"

    @app.on_event("startup")
    async def normalize_role_enum_values() -> None:
        await _migrate_sqlite_employees_reports_to_nullable()

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            try:
                await conn.execute(
                    text("UPDATE roles SET name='admin' WHERE lower(name)='admin'")
                )
                await conn.execute(
                    text("UPDATE roles SET name='hr' WHERE lower(name)='hr'")
                )
                await conn.execute(
                    text("UPDATE roles SET name='manager' WHERE lower(name)='manager'")
                )
                await conn.execute(
                    text("UPDATE roles SET name='supervisor' WHERE lower(name)='supervisor'")
                )
                await conn.execute(
                    text("UPDATE roles SET name='employee' WHERE lower(name)='employee'")
                )
            except OperationalError:
                # If startup races with initial DB bootstrap, continue without failing boot.
                pass

        admin_email = (settings.admin_email or "").strip().lower()
        admin_password = (settings.admin_password or "").strip()
        if admin_email and admin_password:
            async with AsyncSessionLocal() as session:
                result = await session.execute(select(User).where(User.email == admin_email))
                existing_user = result.scalar_one_or_none()
                if not existing_user:
                    role_result = await session.execute(
                        select(RoleModel).where(RoleModel.name == Role.admin)
                    )
                    admin_role = role_result.scalar_one_or_none()
                    if not admin_role:
                        admin_role = RoleModel(name=Role.admin)
                        session.add(admin_role)
                        await session.flush()

                    user = User(
                        email=admin_email,
                        password_hash=hash_password(admin_password),
                        employee_id=None,
                        roles=[admin_role],
                        is_active=True,
                    )
                    session.add(user)
                    await session.commit()

    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
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
        return {"status": "ok", "service": settings.app_name, "web": "enabled"}

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

    return app


app = create_app()
