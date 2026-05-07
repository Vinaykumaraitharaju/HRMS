from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Wavelynk"
    environment: str = "local"

    database_url: str
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    office_latitude: float
    office_longitude: float
    office_radius_meters: float = 250

    # ✅ ADD THIS (SMTP SUPPORT)
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    from_email: str | None = None
    admin_email: str | None = None
    admin_password: str | None = None

    # ✅ IMPORTANT FIX
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",  # 🔥 THIS FIXES YOUR ERROR
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
