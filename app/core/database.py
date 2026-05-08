from collections.abc import AsyncGenerator
import os
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings


class Base(DeclarativeBase):
    pass


def _resolve_database_url(raw_url: str) -> str:
    if raw_url.startswith("postgres://"):
        return raw_url.replace("postgres://", "postgresql+asyncpg://", 1)

    if raw_url.startswith("postgresql://") and "+asyncpg" not in raw_url:
        return raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    # On Render, ensure relative SQLite files are stored on persistent disk.
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
        # If persistent disk is not mounted/writable yet, keep original URL
        # so the service can still boot instead of crashing on import.
        return raw_url


engine = create_async_engine(_resolve_database_url(settings.database_url), pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
