from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.calendar.models import CalendarEvent, CalendarVisibility
from app.modules.calendar.schemas import CalendarEventCreate, CalendarEventUpdate


class CalendarService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, current_user: User, payload: CalendarEventCreate) -> CalendarEvent:
        event = CalendarEvent(owner_user_id=current_user.id, **payload.model_dump())
        self.db.add(event)
        await self.db.commit()
        await self.db.refresh(event)
        return event

    async def list_for_user(
        self,
        current_user: User,
        start_at: datetime | None = None,
        end_at: datetime | None = None,
    ) -> list[CalendarEvent]:
        query = select(CalendarEvent).where(
            or_(
                CalendarEvent.owner_user_id == current_user.id,
                CalendarEvent.visibility == CalendarVisibility.team,
            )
        )
        if start_at and end_at:
            query = query.where(
                and_(
                    CalendarEvent.start_at <= end_at,
                    CalendarEvent.end_at >= start_at,
                )
            )
        query = query.order_by(CalendarEvent.start_at.asc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def update(self, event_id: int, current_user: User, payload: CalendarEventUpdate) -> CalendarEvent:
        event = await self._owned_event(event_id, current_user)
        data = payload.model_dump(exclude_unset=True)
        if "start_at" in data and "end_at" not in data:
            if event.end_at < data["start_at"]:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="end_at must be on or after start_at",
                )
        if "end_at" in data and "start_at" not in data:
            if data["end_at"] < event.start_at:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="end_at must be on or after start_at",
                )
        for key, value in data.items():
            setattr(event, key, value)
        await self.db.commit()
        await self.db.refresh(event)
        return event

    async def delete(self, event_id: int, current_user: User) -> None:
        event = await self._owned_event(event_id, current_user)
        await self.db.delete(event)
        await self.db.commit()

    async def _owned_event(self, event_id: int, current_user: User) -> CalendarEvent:
        result = await self.db.execute(
            select(CalendarEvent).where(CalendarEvent.id == event_id, CalendarEvent.owner_user_id == current_user.id)
        )
        event = result.scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendar event not found")
        return event
