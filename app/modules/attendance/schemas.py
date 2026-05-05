from datetime import datetime

from pydantic import BaseModel, Field

from app.modules.attendance.models import AttendanceAction


class AttendanceCapture(BaseModel):
    action: AttendanceAction
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    work_mode: str = "office"
    break_type: str | None = None
    note: str | None = None


class AttendanceRead(BaseModel):
    id: int
    employee_id: int
    action: AttendanceAction
    latitude: float
    longitude: float
    distance_meters: float
    work_mode: str
    break_type: str | None
    note: str | None
    captured_at: datetime

    model_config = {"from_attributes": True}
