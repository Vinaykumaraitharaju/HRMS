from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.calendar.schemas import (
    CalendarEventCreate,
    CalendarEventRead,
    CalendarEventUpdate,
)
from app.modules.calendar.service import CalendarService

router = APIRouter()


@router.get("/events", response_model=list[CalendarEventRead])
async def list_calendar_events(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    start_at: datetime | None = Query(default=None),
    end_at: datetime | None = Query(default=None),
):
    return await CalendarService(db).list_for_user(current_user, start_at, end_at)


@router.post(
    "/events", response_model=CalendarEventRead, status_code=status.HTTP_201_CREATED
)
async def create_calendar_event(
    payload: CalendarEventCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    return await CalendarService(db).create(current_user, payload)


@router.patch("/events/{event_id}", response_model=CalendarEventRead)
async def update_calendar_event(
    event_id: int,
    payload: CalendarEventUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    return await CalendarService(db).update(event_id, current_user, payload)


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_calendar_event(
    event_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    await CalendarService(db).delete(event_id, current_user)
    return None
