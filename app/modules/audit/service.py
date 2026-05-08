from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi.encoders import jsonable_encoder

from app.modules.audit.models import AuditLog
from app.modules.auth.models import User


class AuditService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def record(
        self,
        *,
        category: str,
        action: str,
        message: str,
        actor: User | None = None,
        entity_type: str | None = None,
        entity_id: int | str | None = None,
        details: dict | None = None,
    ) -> AuditLog:
        log = AuditLog(
            category=category,
            action=action,
            message=message,
            actor_user_id=actor.id if actor else None,
            actor_email=actor.email if actor else None,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            details=jsonable_encoder(details or {}),
        )
        self.db.add(log)
        await self.db.commit()
        await self.db.refresh(log)
        return log

    async def list(self, category: str | None = None, limit: int = 100) -> list[AuditLog]:
        limit = max(1, min(limit, 500))
        query = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)
        if category and category.lower() != "all":
            query = query.where(AuditLog.category == category)
        result = await self.db.execute(query)
        return list(result.scalars().all())


async def safe_record_audit(
    db: AsyncSession,
    *,
    category: str,
    action: str,
    message: str,
    actor: User | None = None,
    entity_type: str | None = None,
    entity_id: int | str | None = None,
    details: dict | None = None,
) -> None:
    try:
        await AuditService(db).record(
            category=category,
            action=action,
            message=message,
            actor=actor,
            entity_type=entity_type,
            entity_id=entity_id,
            details=details,
        )
    except Exception as exc:
        await db.rollback()
        print("Audit log skipped:", exc)
