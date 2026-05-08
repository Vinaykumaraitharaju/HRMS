from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import and_, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.auth.models import User
from app.modules.calendar.models import CalendarEvent, CalendarEventAttendee, CalendarVisibility
from app.modules.calendar.schemas import CalendarEventCreate, CalendarEventUpdate


class CalendarService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, current_user: User, payload: CalendarEventCreate) -> CalendarEvent:
        data = payload.model_dump(exclude={"attendee_user_ids"})
        attendee_user_ids = await self._valid_attendee_ids(payload.attendee_user_ids, current_user.id)
        event = CalendarEvent(owner_user_id=current_user.id, **data)
        event.attendees = [
            CalendarEventAttendee(user_id=user_id)
            for user_id in attendee_user_ids
        ]
        self.db.add(event)
        await self.db.commit()
        return await self._event_with_attendees(event.id)

    async def list_for_user(
        self,
        current_user: User,
        start_at: datetime | None = None,
        end_at: datetime | None = None,
    ) -> list[CalendarEvent]:
        attendee_exists = exists().where(
            CalendarEventAttendee.event_id == CalendarEvent.id,
            CalendarEventAttendee.user_id == current_user.id,
        )
        query = select(CalendarEvent).options(selectinload(CalendarEvent.attendees)).where(
            or_(
                CalendarEvent.owner_user_id == current_user.id,
                attendee_exists,
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
        attendee_user_ids = data.pop("attendee_user_ids", None)
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
        if attendee_user_ids is not None:
            valid_user_ids = await self._valid_attendee_ids(attendee_user_ids, current_user.id)
            event.attendees = [
                CalendarEventAttendee(user_id=user_id)
                for user_id in valid_user_ids
            ]
        await self.db.commit()
        return await self._event_with_attendees(event.id)

    async def delete(self, event_id: int, current_user: User) -> None:
        event = await self._owned_event(event_id, current_user)
        await self.db.delete(event)
        await self.db.commit()

    async def _owned_event(self, event_id: int, current_user: User) -> CalendarEvent:
        result = await self.db.execute(
            select(CalendarEvent)
            .options(selectinload(CalendarEvent.attendees))
            .where(CalendarEvent.id == event_id, CalendarEvent.owner_user_id == current_user.id)
        )
        event = result.scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendar event not found")
        return event

    async def _event_with_attendees(self, event_id: int) -> CalendarEvent:
        result = await self.db.execute(
            select(CalendarEvent)
            .options(selectinload(CalendarEvent.attendees))
            .where(CalendarEvent.id == event_id)
        )
        event = result.scalar_one()
        return event

    async def _valid_attendee_ids(self, attendee_user_ids: list[int], owner_user_id: int) -> list[int]:
        unique_ids = sorted({int(user_id) for user_id in attendee_user_ids if int(user_id) != owner_user_id})
        if not unique_ids:
            return []

        result = await self.db.execute(
            select(User.id).where(User.id.in_(unique_ids), User.is_active.is_(True))
        )
        valid_ids = {int(user_id) for user_id in result.scalars().all()}
        missing = [user_id for user_id in unique_ids if user_id not in valid_ids]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid meeting participant user IDs: {', '.join(map(str, missing))}",
            )
        return unique_ids
