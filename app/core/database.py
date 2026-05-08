from collections.abc import AsyncGenerator
import os
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings


class Base(DeclarativeBase):
    pass


def is_postgres_url(database_url: str) -> bool:
    return database_url.startswith(
        ("postgres://", "postgresql://", "postgresql+asyncpg://")
    )


def is_sqlite_url(database_url: str) -> bool:
    return database_url.startswith("sqlite")


def _resolve_database_url(raw_url: str) -> str:
    if raw_url.startswith("postgres://"):
        return raw_url.replace("postgres://", "postgresql+asyncpg://", 1)

    if raw_url.startswith("postgresql://") and "+asyncpg" not in raw_url:
        return raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    if os.getenv("RENDER") == "true" and is_sqlite_url(raw_url):
        allow_ephemeral_sqlite = os.getenv("ALLOW_EPHEMERAL_SQLITE", "").strip().lower()
        if allow_ephemeral_sqlite not in {"1", "true", "yes"}:
            raise RuntimeError(
                "Refusing to start on Render with SQLite DATABASE_URL because it is not "
                "persistent. Create a Render Postgres database and set DATABASE_URL to "
                "its Internal Database URL."
            )

    # On Render, relative SQLite is only allowed for temporary testing when
    # ALLOW_EPHEMERAL_SQLITE=true. Production must use Postgres.
    if not raw_url.startswith("sqlite+aiosqlite:///./"):
        return raw_url

    if os.getenv("RENDER") != "true":
        return raw_url

    data_dir = os.getenv("PERSISTENT_DATA_DIR", "/var/data")
    db_file = raw_url.removeprefix("sqlite+aiosqlite:///./")
    db_path = Path(data_dir) / db_file
    try:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite+aiosqlite:///{db_path.as_posix()}"
    except PermissionError:
        raise RuntimeError(
            f"SQLite persistent directory is not writable: {db_path.parent}. "
            "Use Render Postgres for persistent production data."
        )


resolved_database_url = _resolve_database_url(settings.database_url)
engine = create_async_engine(resolved_database_url, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
