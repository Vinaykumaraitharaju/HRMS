import asyncio

from app.core.database import Base, engine

# Import auth models so PasswordResetOTP is registered in Base.metadata.
import app.modules.auth.models  # noqa: F401


async def main() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("auth tables ready")


if __name__ == "__main__":
    asyncio.run(main())
