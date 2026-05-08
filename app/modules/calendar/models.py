import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

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
    description: Mapped[str] = mapped_column(Text, nullable=True)
    location: Mapped[str] = mapped_column(String(180), nullable=True)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    event_type: Mapped[CalendarEventType] = mapped_column(Enum(CalendarEventType), default=CalendarEventType.meeting)
    visibility: Mapped[CalendarVisibility] = mapped_column(Enum(CalendarVisibility), default=CalendarVisibility.personal)
    source: Mapped[CalendarSource] = mapped_column(Enum(CalendarSource), default=CalendarSource.manual)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    meeting_link: Mapped[str] = mapped_column(String(255), nullable=True)

    attendees: Mapped[list["CalendarEventAttendee"]] = relationship(
        back_populates="event",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    @property
    def attendee_user_ids(self) -> list[int]:
        return [attendee.user_id for attendee in self.attendees]


class CalendarEventAttendee(Base):
    __tablename__ = "calendar_event_attendees"

    event_id: Mapped[int] = mapped_column(
        ForeignKey("calendar_events.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    event: Mapped[CalendarEvent] = relationship(back_populates="attendees")

