from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from sqlalchemy import text

from app.core.config import settings
from app.core.database import engine
from app.core.security import decode_access_token

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


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, version="0.1.0")
    static_dir = Path(__file__).resolve().parent / "static"

    @app.on_event("startup")
    async def normalize_role_enum_values() -> None:
        async with engine.begin() as conn:
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