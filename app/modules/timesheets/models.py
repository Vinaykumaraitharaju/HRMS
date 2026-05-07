import enum
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class TimesheetStatus(str, enum.Enum):
    draft = "draft"
    submitted = "submitted"
    approved = "approved"
    rejected = "rejected"


class Timesheet(Base):
    __tablename__ = "timesheets"
    __table_args__ = (UniqueConstraint("employee_id", "week_start", name="uq_timesheet_employee_week"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), index=True)
    week_start: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[TimesheetStatus] = mapped_column(Enum(TimesheetStatus), default=TimesheetStatus.draft)
    approver_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    decision_note: Mapped[Optional[str]] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    entries: Mapped[list["TimesheetEntry"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class TimesheetEntry(Base):
    __tablename__ = "timesheet_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    timesheet_id: Mapped[int] = mapped_column(ForeignKey("timesheets.id", ondelete="CASCADE"), index=True)
    entry_date: Mapped[date] = mapped_column(Date)
    task: Mapped[str] = mapped_column(String(200))
    hours: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    notes: Mapped[Optional[str]] = mapped_column(Text)
