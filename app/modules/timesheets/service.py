from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.auth.models import User
from app.modules.notifications.models import NotificationType
from app.modules.notifications.schemas import NotificationCreate
from app.modules.notifications.service import NotificationService
from app.modules.timesheets.models import Timesheet, TimesheetEntry, TimesheetStatus
from app.modules.timesheets.schemas import (
    TimesheetCreate,
    TimesheetDecision,
    TimesheetEntryCreate,
    WeeklySummary,
)


class TimesheetService:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _week_start(self, entry_date: date) -> date:
        return entry_date - timedelta(days=entry_date.weekday())

    async def _get_employee_id(self, current_user: User) -> int:
        if not current_user.employee_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is not linked to an employee",
            )
        return current_user.employee_id

    async def create(self, current_user: User, payload: TimesheetCreate) -> Timesheet:
        employee_id = await self._get_employee_id(current_user)

        result = await self.db.execute(
            select(Timesheet)
            .options(selectinload(Timesheet.entries))
            .where(
                Timesheet.employee_id == employee_id,
                Timesheet.week_start == payload.week_start,
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            return existing

        timesheet = Timesheet(employee_id=employee_id, week_start=payload.week_start)
        self.db.add(timesheet)
        await self.db.commit()

        return await self._timesheet(timesheet.id)

    async def list(self, current_user: User) -> list[Timesheet]:
        employee_id = await self._get_employee_id(current_user)

        result = await self.db.execute(
            select(Timesheet)
            .options(selectinload(Timesheet.entries))
            .where(Timesheet.employee_id == employee_id)
            .order_by(Timesheet.week_start.desc())
        )
        return list(result.scalars().unique().all())

    async def add_entry(
        self, timesheet_id: int, current_user: User, payload: TimesheetEntryCreate
    ) -> Timesheet:
        timesheet = await self._timesheet(timesheet_id)
        employee_id = await self._get_employee_id(current_user)

        if timesheet.employee_id != employee_id:
            raise HTTPException(
                status_code=403, detail="Cannot edit another employee timesheet"
            )

        return await self._upsert_entry(timesheet, payload)

    async def upsert_entry_by_date(
        self, current_user: User, payload: TimesheetEntryCreate
    ) -> Timesheet:
        employee_id = await self._get_employee_id(current_user)
        week_start = self._week_start(payload.entry_date)

        result = await self.db.execute(
            select(Timesheet)
            .options(selectinload(Timesheet.entries))
            .where(
                Timesheet.employee_id == employee_id,
                Timesheet.week_start == week_start,
            )
        )
        timesheet = result.scalar_one_or_none()

        if not timesheet:
            timesheet = Timesheet(employee_id=employee_id, week_start=week_start)
            self.db.add(timesheet)
            await self.db.flush()

        return await self._upsert_entry(timesheet, payload)

    async def _upsert_entry(
        self, timesheet: Timesheet, payload: TimesheetEntryCreate
    ) -> Timesheet:
        if timesheet.status != TimesheetStatus.draft:
            raise HTTPException(
                status_code=409, detail="Only draft timesheets can be edited"
            )

        task = payload.task.strip()
        if not task:
            raise HTTPException(status_code=422, detail="Task is required")

        if payload.hours <= 0 or payload.hours > 24:
            raise HTTPException(
                status_code=422, detail="Hours must be between 0.25 and 24"
            )

        entry_result = await self.db.execute(
            select(TimesheetEntry).where(
                TimesheetEntry.timesheet_id == timesheet.id,
                TimesheetEntry.entry_date == payload.entry_date,
            )
        )
        entry = entry_result.scalar_one_or_none()

        if entry:
            entry.task = task
            entry.hours = payload.hours
            entry.notes = payload.notes
        else:
            self.db.add(
                TimesheetEntry(
                    timesheet_id=timesheet.id,
                    entry_date=payload.entry_date,
                    task=task,
                    hours=payload.hours,
                    notes=payload.notes,
                )
            )

        await self.db.commit()
        return await self._timesheet(timesheet.id)

    async def delete_entry_by_date(self, current_user: User, entry_date: date) -> None:
        employee_id = await self._get_employee_id(current_user)
        week_start = self._week_start(entry_date)

        result = await self.db.execute(
            select(Timesheet).where(
                Timesheet.employee_id == employee_id,
                Timesheet.week_start == week_start,
            )
        )
        timesheet = result.scalar_one_or_none()

        if not timesheet:
            return

        if timesheet.status != TimesheetStatus.draft:
            raise HTTPException(
                status_code=409, detail="Only draft timesheets can be edited"
            )

        entry_result = await self.db.execute(
            select(TimesheetEntry).where(
                TimesheetEntry.timesheet_id == timesheet.id,
                TimesheetEntry.entry_date == entry_date,
            )
        )
        entry = entry_result.scalar_one_or_none()

        if entry:
            await self.db.delete(entry)
            await self.db.commit()

    async def submit(self, timesheet_id: int, current_user: User) -> Timesheet:
        timesheet = await self._timesheet(timesheet_id)
        employee_id = await self._get_employee_id(current_user)

        if timesheet.employee_id != employee_id:
            raise HTTPException(
                status_code=403, detail="Cannot submit another employee timesheet"
            )

        if timesheet.status != TimesheetStatus.draft:
            raise HTTPException(
                status_code=409, detail="Only draft timesheets can be submitted"
            )

        if not timesheet.entries:
            raise HTTPException(
                status_code=422,
                detail="Add at least one timesheet entry before submitting",
            )

        total = sum((entry.hours for entry in timesheet.entries), Decimal("0"))
        if total <= 0:
            raise HTTPException(
                status_code=422, detail="Total hours must be greater than zero"
            )

        timesheet.status = TimesheetStatus.submitted
        await self.db.commit()

        await NotificationService(self.db).create(
            NotificationCreate(
                recipient_user_id=current_user.id,
                type=NotificationType.timesheet,
                title="Timesheet submitted",
                body=f"Timesheet week {timesheet.week_start} was submitted.",
            )
        )

        return await self._timesheet(timesheet.id)

    async def approve(
        self, timesheet_id: int, approver: User, payload: TimesheetDecision
    ) -> Timesheet:
        timesheet = await self._timesheet(timesheet_id)

        if timesheet.status != TimesheetStatus.submitted:
            raise HTTPException(status_code=409, detail="Timesheet is not submitted")

        timesheet.status = TimesheetStatus.approved
        timesheet.approver_id = approver.id
        timesheet.decision_note = payload.note

        await self.db.commit()
        return await self._timesheet(timesheet.id)

    async def reject(
        self, timesheet_id: int, approver: User, payload: TimesheetDecision
    ) -> Timesheet:
        timesheet = await self._timesheet(timesheet_id)

        if timesheet.status != TimesheetStatus.submitted:
            raise HTTPException(status_code=409, detail="Timesheet is not submitted")

        timesheet.status = TimesheetStatus.rejected
        timesheet.approver_id = approver.id
        timesheet.decision_note = payload.note

        await self.db.commit()
        return await self._timesheet(timesheet.id)

    async def summary(self, timesheet_id: int) -> WeeklySummary:
        timesheet = await self._timesheet(timesheet_id)
        total = sum((entry.hours for entry in timesheet.entries), Decimal("0"))

        return WeeklySummary(
            timesheet_id=timesheet.id,
            week_start=timesheet.week_start,
            total_hours=total,
            status=timesheet.status,
        )

    async def _timesheet(self, timesheet_id: int) -> Timesheet:
        result = await self.db.execute(
            select(Timesheet)
            .options(selectinload(Timesheet.entries))
            .where(Timesheet.id == timesheet_id)
        )
        timesheet = result.scalar_one_or_none()

        if not timesheet:
            raise HTTPException(status_code=404, detail="Timesheet not found")

        return timesheet
