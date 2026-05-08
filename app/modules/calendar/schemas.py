from datetime import datetime

from pydantic import BaseModel, model_validator

from app.modules.calendar.models import CalendarEventType, CalendarSource, CalendarVisibility


class CalendarEventCreate(BaseModel):
    title: str
    description: str | None = None
    location: str | None = None
    start_at: datetime
    end_at: datetime
    all_day: bool = False
    event_type: CalendarEventType = CalendarEventType.meeting
    visibility: CalendarVisibility = CalendarVisibility.personal
    meeting_link: str | None = None
    attendee_user_ids: list[int] = []

    @model_validator(mode="after")
    def validate_range(self):
        if self.end_at < self.start_at:
            raise ValueError("end_at must be on or after start_at")
        return self


class CalendarEventUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    location: str | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    all_day: bool | None = None
    event_type: CalendarEventType | None = None
    visibility: CalendarVisibility | None = None
    meeting_link: str | None = None
    attendee_user_ids: list[int] | None = None

    @model_validator(mode="after")
    def validate_range(self):
        if self.start_at and self.end_at and self.end_at < self.start_at:
            raise ValueError("end_at must be on or after start_at")
        return self


class CalendarEventRead(BaseModel):
    id: int
    owner_user_id: int
    title: str
    description: str | None
    location: str | None
    start_at: datetime
    end_at: datetime
    all_day: bool
    event_type: CalendarEventType
    visibility: CalendarVisibility
    source: CalendarSource
    created_at: datetime
    updated_at: datetime
    meeting_link: str | None = None
    attendee_user_ids: list[int] = []

    model_config = {"from_attributes": True}
