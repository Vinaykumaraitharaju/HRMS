from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.modules.timesheets.models import TimesheetStatus


class TimesheetCreate(BaseModel):
    week_start: date


class TimesheetEntryCreate(BaseModel):
    entry_date: date
    task: str
    hours: Decimal = Field(gt=0, le=24)
    notes: str | None = None


class TimesheetDecision(BaseModel):
    note: str | None = None


class TimesheetEntryRead(BaseModel):
    id: int
    entry_date: date
    task: str
    hours: Decimal
    notes: str | None

    model_config = {"from_attributes": True}


class TimesheetRead(BaseModel):
    id: int
    employee_id: int
    week_start: date
    status: TimesheetStatus
    approver_id: int | None
    decision_note: str | None
    created_at: datetime
    entries: list[TimesheetEntryRead] = []

    model_config = {"from_attributes": True}


class WeeklySummary(BaseModel):
    timesheet_id: int
    week_start: date
    total_hours: Decimal
    status: TimesheetStatus


class DemoTimesheetEntryUpsert(BaseModel):
    entry_date: date
    task: str
    hours: Decimal = Field(ge=0, le=24)
    notes: str | None = None


class DemoWeeklySubmit(BaseModel):
    week_start: date


class DemoHolidayRead(BaseModel):
    date: date
    name: str


class DemoTimesheetEntryState(BaseModel):
    entry_date: date
    task: str
    hours: Decimal
    notes: str | None = None
    submitted: bool = False


class DemoTimesheetState(BaseModel):
    week_start: date
    timesheet_id: int
    status: TimesheetStatus
    entries: list[DemoTimesheetEntryState]
    holidays: list[DemoHolidayRead]
