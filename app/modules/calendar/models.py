import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CalendarEventType(str, enum.Enum):
    meeting = "meeting"
    reminder = "reminder"
    leave = "leave"
    attendance = "attendance"
    focus = "focus"


class CalendarVisibility(str, enum.Enum):
    private = "private"
    personal = "personal"
    team = "team"


class CalendarSource(str, enum.Enum):
    manual = "manual"
    leave = "leave"
    attendance = "attendance"
    timesheet = "timesheet"


class CalendarEvent(Base):
    __tablename__ = "calendar_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(180))
    description: Mapped[Optional[str]] = mapped_column(Text)
    location: Mapped[Optional[str]] = mapped_column(String(180))
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    event_type: Mapped[CalendarEventType] = mapped_column(Enum(CalendarEventType), default=CalendarEventType.meeting)
    visibility: Mapped[CalendarVisibility] = mapped_column(Enum(CalendarVisibility), default=CalendarVisibility.personal)
    source: Mapped[CalendarSource] = mapped_column(Enum(CalendarSource), default=CalendarSource.manual)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    meeting_link: Mapped[Optional[str]] = mapped_column(String(255))
