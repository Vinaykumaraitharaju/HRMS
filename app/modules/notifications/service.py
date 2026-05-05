import json
from datetime import UTC, datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis import redis_client
from app.modules.notifications.models import Notification
from app.modules.notifications.schemas import NotificationCreate


class NotificationService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, payload: NotificationCreate) -> Notification:
        data = payload.model_dump()

        if "user_id" in data and "recipient_user_id" not in data:
            data["recipient_user_id"] = data.pop("user_id")

        if "message" in data and "body" not in data:
            data["body"] = data.pop("message")

        notification = Notification(**data)

        self.db.add(notification)
        await self.db.commit()
        await self.db.refresh(notification)

        try:
            await redis_client.publish(
                f"notifications:{notification.recipient_user_id}",
                json.dumps(
                    {
                        "id": notification.id,
                        "type": (
                            notification.type.value
                            if hasattr(notification.type, "value")
                            else str(notification.type)
                        ),
                        "title": notification.title,
                        "body": notification.body,
                        "message": notification.body,
                        "recipient_user_id": notification.recipient_user_id,
                        "read_at": (
                            notification.read_at.isoformat()
                            if notification.read_at
                            else None
                        ),
                        "created_at": (
                            notification.created_at.isoformat()
                            if notification.created_at
                            else None
                        ),
                    }
                ),
            )
        except Exception as exc:
            print("Redis publish skipped:", exc)

        return notification

    async def list_for_user(
        self,
        user_id: int,
        limit: int = 30,
    ) -> list[Notification]:
        safe_limit = max(1, min(int(limit or 30), 100))

        result = await self.db.execute(
            select(Notification)
            .where(Notification.recipient_user_id == user_id)
            .order_by(Notification.created_at.desc())
            .limit(safe_limit)
        )

        return list(result.scalars().all())

    async def mark_read(
        self,
        notification_id: int,
        user_id: int,
    ) -> Optional[Notification]:
        result = await self.db.execute(
            select(Notification).where(
                Notification.id == notification_id,
                Notification.recipient_user_id == user_id,
            )
        )

        notification = result.scalar_one_or_none()

        if notification:
            notification.read_at = datetime.now(UTC)
            await self.db.commit()
            await self.db.refresh(notification)

        return notification

    async def mark_all_read(self, user_id: int) -> int:
        result = await self.db.execute(
            select(Notification).where(
                Notification.recipient_user_id == user_id,
                Notification.read_at.is_(None),
            )
        )

        notifications = list(result.scalars().all())

        now = datetime.now(UTC)

        for notification in notifications:
            notification.read_at = now

        await self.db.commit()

        return len(notifications)
