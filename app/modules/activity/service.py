from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.modules.activity.schemas import ActivityItemRead
from app.modules.auth.models import User
from app.modules.calendar.models import CalendarEvent
from app.modules.notifications.models import Notification, NotificationType


class ActivityService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _get_current_user(self, request: Request) -> User:
        token = request.cookies.get("access_token")

        if not token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated",
            )

        try:
            payload = decode_access_token(token)
            user_id = int(payload.get("sub"))
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token",
            )

        result = await self.db.execute(
            select(User).where(User.id == user_id, User.is_active.is_(True))
        )
        user = result.scalar_one_or_none()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
            )

        return user

    async def get_feed(self, request: Request) -> list[ActivityItemRead]:
        current_user = await self._get_current_user(request)

        notifications_result = await self.db.execute(
            select(Notification)
            .where(Notification.recipient_user_id == current_user.id)
            .order_by(Notification.created_at.desc())
        )
        notifications = list(notifications_result.scalars().all())

        calendar_result = await self.db.execute(
            select(CalendarEvent)
            .where(
                CalendarEvent.owner_user_id == current_user.id,
                CalendarEvent.start_at >= datetime.now(UTC) - timedelta(days=1),
            )
            .order_by(CalendarEvent.start_at.asc())
        )
        calendar_events = list(calendar_result.scalars().all())

        items = [
            ActivityItemRead(
                id=f"notification:{notification.id}",
                kind="notification",
                title=notification.title,
                body=notification.body,
                actor=self._actor_for_notification(notification),
                category=notification.type.value,
                created_at=notification.created_at,
                unread=notification.read_at is None,
                target=self._target_for_notification(notification),
                meta={"notification_id": notification.id},
            )
            for notification in notifications
        ]

        items.extend(
            [
                ActivityItemRead(
                    id=f"calendar:{event.id}",
                    kind="calendar",
                    title=event.title,
                    body=event.location or event.description or event.event_type.value,
                    actor="Calendar",
                    category="calendar",
                    created_at=event.start_at,
                    unread=False,
                    target="calendar",
                    meta={
                        "event_id": event.id,
                        "event_type": event.event_type.value,
                    },
                )
                for event in calendar_events[:8]
            ]
        )

        return sorted(items, key=lambda item: item.created_at, reverse=True)

    async def mark_item_read(self, item_id: str, request: Request) -> None:
        current_user = await self._get_current_user(request)

        if not item_id.startswith("notification:"):
            return

        notification_id = int(item_id.split(":", 1)[1])

        result = await self.db.execute(
            select(Notification).where(
                Notification.id == notification_id,
                Notification.recipient_user_id == current_user.id,
            )
        )
        notification = result.scalar_one_or_none()

        if not notification or notification.read_at is not None:
            return

        notification.read_at = datetime.now(UTC)
        await self.db.commit()

    def _actor_for_notification(self, notification: Notification) -> str:
        if notification.type == NotificationType.chat:
            return "Chat"
        if notification.type == NotificationType.leave:
            return "Leave"
        if notification.type == NotificationType.timesheet:
            return "Timesheet"
        if notification.type == NotificationType.calendar:
            return "Calendar"
        return "Activity"

    def _target_for_notification(self, notification: Notification) -> str:
        if notification.type == NotificationType.chat:
            return "chat"
        if notification.type == NotificationType.calendar:
            return "calendar"
        return "dashboard"
