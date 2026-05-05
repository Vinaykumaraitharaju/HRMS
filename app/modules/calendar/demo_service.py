from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.calendar.models import CalendarEvent, CalendarEventType, CalendarSource, CalendarVisibility
from app.modules.calendar.schemas import CalendarEventCreate
from app.modules.calendar.service import CalendarService
from app.modules.chat.demo_service import DemoChatService
from app.modules.notifications.models import Notification, NotificationType


class DemoCalendarService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def bootstrap(self) -> list[CalendarEvent]:
        user_map = await DemoChatService(self.db)._ensure_demo_users()
        await self._seed_events(user_map["you"].id)
        return await self.list_events(user_map["you"].id)

    async def list_events(self, owner_user_id: int) -> list[CalendarEvent]:
        result = await self.db.execute(
            select(CalendarEvent)
            .where(CalendarEvent.owner_user_id == owner_user_id)
            .order_by(CalendarEvent.start_at.asc())
        )
        return list(result.scalars().all())

    async def create_event(self, payload: CalendarEventCreate) -> list[CalendarEvent]:
        user_map = await DemoChatService(self.db)._ensure_demo_users()
        user = user_map["you"]
        event = await CalendarService(self.db).create(user, payload)
        self.db.add(
            Notification(
                recipient_user_id=user.id,
                type=NotificationType.calendar,
                title="Calendar event created",
                body=f"{event.title} scheduled for {event.start_at.astimezone(UTC).strftime('%b %d %H:%M')}",
            )
        )
        await self.db.commit()
        return await self.list_events(user.id)

    async def delete_event(self, event_id: int) -> list[CalendarEvent]:
        user_map = await DemoChatService(self.db)._ensure_demo_users()
        user = user_map["you"]
        await CalendarService(self.db).delete(event_id, user)
        return await self.list_events(user.id)

    async def _seed_events(self, owner_user_id: int) -> None:
        result = await self.db.execute(select(CalendarEvent.id).where(CalendarEvent.owner_user_id == owner_user_id))
        if result.first():
            return
        today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        events = [
            CalendarEvent(
                owner_user_id=owner_user_id,
                title="Daily check-in",
                description="Product team standup",
                location="Teams room A",
                start_at=today.replace(hour=9, minute=15),
                end_at=today.replace(hour=9, minute=30),
                event_type=CalendarEventType.meeting,
                visibility=CalendarVisibility.team,
                source=CalendarSource.manual,
            ),
            CalendarEvent(
                owner_user_id=owner_user_id,
                title="Design sync",
                description="Review work with Nisha Rao",
                location="Meeting room B",
                start_at=today.replace(hour=11, minute=0),
                end_at=today.replace(hour=11, minute=45),
                event_type=CalendarEventType.meeting,
                visibility=CalendarVisibility.team,
                source=CalendarSource.manual,
            ),
            CalendarEvent(
                owner_user_id=owner_user_id,
                title="Leave workflow review",
                description="People Ops review session",
                location="Teams call",
                start_at=today.replace(hour=14, minute=30),
                end_at=today.replace(hour=15, minute=15),
                event_type=CalendarEventType.meeting,
                visibility=CalendarVisibility.team,
                source=CalendarSource.manual,
            ),
            CalendarEvent(
                owner_user_id=owner_user_id,
                title="Submit daily timesheet",
                description="Reminder before logout",
                location="Workspace",
                start_at=today.replace(hour=16, minute=30),
                end_at=today.replace(hour=16, minute=45),
                event_type=CalendarEventType.reminder,
                visibility=CalendarVisibility.personal,
                source=CalendarSource.timesheet,
            ),
            CalendarEvent(
                owner_user_id=owner_user_id,
                title="Focus block",
                description="Design handoff work",
                location="Quiet hours",
                start_at=(today + timedelta(days=1)).replace(hour=10, minute=0),
                end_at=(today + timedelta(days=1)).replace(hour=12, minute=0),
                event_type=CalendarEventType.focus,
                visibility=CalendarVisibility.personal,
                source=CalendarSource.manual,
            ),
        ]
        self.db.add_all(events)
        await self.db.commit()
