from datetime import date, datetime

from pydantic import BaseModel, Field, model_validator

from app.modules.leave.models import LeaveStatus


class LeaveApply(BaseModel):
    leave_type: str
    start_date: date
    end_date: date
    reason: str

    @model_validator(mode="after")
    def validate_dates(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class LeaveDecision(BaseModel):
    note: str | None = None


class LeaveRead(BaseModel):
    id: int
    employee_id: int
    requester_name: str | None = None
    requester_employee_code: str | None = None
    leave_type: str
    start_date: date
    end_date: date
    reason: str
    status: LeaveStatus
    supervisor_id: int | None
    manager_id: int | None
    decision_note: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class LeaveTypePolicy(BaseModel):
    name: str
    balance: int = Field(default=0, ge=0)
    approvalFlow: str = "Manager only"


class HolidayPolicy(BaseModel):
    country: str = "India"
    location: str = "Hyderabad"
    name: str
    date: str
    type: str = "public"


class LeavePolicyState(BaseModel):
    annual: int = 12
    casual: int = 4
    sick: int = 2
    approvalFlow: str = "Supervisor then Manager"
    revokeRule: str = "Manager approval required"
    holidayCountry: str = "India"
    holidayLocation: str = "Hyderabad"
    leaveTypes: list[LeaveTypePolicy] = []
    holidays: list[HolidayPolicy] = []


class DemoLeaveApply(BaseModel):
    leave_type: str
    start_date: date
    end_date: date
    reason: str

    @model_validator(mode="after")
    def validate_dates(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class DemoLeaveRequestState(BaseModel):
    id: int
    leave_id: str
    leave_type: str
    start_date: date
    end_date: date
    reason: str
    status: str
    stage: str
    created_at: datetime


class DemoLeaveState(BaseModel):
    requests: list[DemoLeaveRequestState]
