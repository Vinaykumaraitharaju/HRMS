from __future__ import annotations

from datetime import date, datetime, time, timedelta
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.auth.models import User
from app.modules.chat.demo_service import DemoChatService
from app.modules.employees.models import Department, Employee
from app.modules.timesheets.models import Timesheet, TimesheetEntry, TimesheetStatus
from app.modules.timesheets.schemas import (
    DemoHolidayRead,
    DemoTimesheetEntryState,
    DemoTimesheetEntryUpsert,
    DemoTimesheetState,
)


class DemoTimesheetService:
    HOLIDAYS = [
        ("2026-05-01", "Labour Day"),
        ("2026-05-14", "Public Holiday"),
    ]

    EMPLOYEE_FIXTURES = {
        "you": {
            "employee_code": "260014",
            "first_name": "Aarav",
            "last_name": "Menon",
            "job_title": "Product Designer",
            "date_joined": date(2024, 6, 10),
            "department": "Product",
            "reports_to": "nisha",
        },
        "nisha": {
            "employee_code": "260051",
            "first_name": "Nisha",
            "last_name": "Rao",
            "job_title": "Supervisor",
            "date_joined": date(2022, 3, 14),
            "department": "Product Design",
            "reports_to": "dev",
        },
        "dev": {
            "employee_code": "260032",
            "first_name": "Dev",
            "last_name": "Shah",
            "job_title": "Manager",
            "date_joined": date(2021, 1, 5),
            "department": "Engineering",
            "reports_to": None,
        },
    }

    def __init__(self, db: AsyncSession):
        self.db = db
        self.current_key = "you"

    async def bootstrap(self, week_start: date | None = None) -> DemoTimesheetState:
        user_map = await DemoChatService(self.db)._ensure_demo_users()
        await self._ensure_demo_employees(user_map)
        if week_start is None:
            week_start = self._week_start(date.today())
        timesheet = await self._ensure_timesheet(user_map[self.current_key], week_start)
        await self._seed_timesheet_entries(timesheet)
        return await self._build_state(timesheet.id)

    async def upsert_entry(self, payload: DemoTimesheetEntryUpsert) -> DemoTimesheetState:
        self._validate_employee_edit_window(payload.entry_date)
        return await self._upsert_entry(payload)

    async def upsert_manager_entry(self, payload: DemoTimesheetEntryUpsert) -> DemoTimesheetState:
        return await self._upsert_entry(payload)

    async def _upsert_entry(self, payload: DemoTimesheetEntryUpsert) -> DemoTimesheetState:
        user_map = await DemoChatService(self.db)._ensure_demo_users()
        await self._ensure_demo_employees(user_map)
        timesheet = await self._ensure_timesheet(user_map[self.current_key], self._week_start(payload.entry_date))
        result = await self.db.execute(
            select(TimesheetEntry).where(
                TimesheetEntry.timesheet_id == timesheet.id,
                TimesheetEntry.entry_date == payload.entry_date,
            )
        )
        entry = result.scalar_one_or_none()
        if entry:
            entry.task = payload.task
            entry.hours = payload.hours
            entry.notes = payload.notes
        else:
            self.db.add(
                TimesheetEntry(
                    timesheet_id=timesheet.id,
                    entry_date=payload.entry_date,
                    task=payload.task,
                    hours=payload.hours,
                    notes=payload.notes,
                )
            )
        timesheet.status = TimesheetStatus.draft
        await self.db.commit()
        return await self._build_state(timesheet.id)

    async def submit_week(self, week_start: date) -> DemoTimesheetState:
        user_map = await DemoChatService(self.db)._ensure_demo_users()
        await self._ensure_demo_employees(user_map)
        timesheet = await self._ensure_timesheet(user_map[self.current_key], week_start)
        timesheet.status = TimesheetStatus.submitted
        await self.db.commit()
        return await self._build_state(timesheet.id)

    async def delete_entry(self, entry_date: date) -> DemoTimesheetState:
        self._validate_employee_edit_window(entry_date)
        user_map = await DemoChatService(self.db)._ensure_demo_users()
        await self._ensure_demo_employees(user_map)
        timesheet = await self._ensure_timesheet(user_map[self.current_key], self._week_start(entry_date))
        result = await self.db.execute(
            select(TimesheetEntry).where(
                TimesheetEntry.timesheet_id == timesheet.id,
                TimesheetEntry.entry_date == entry_date,
            )
        )
        entry = result.scalar_one_or_none()
        if entry:
            await self.db.delete(entry)
            timesheet.status = TimesheetStatus.draft
            await self.db.commit()
        return await self._build_state(timesheet.id)

    async def _build_state(self, timesheet_id: int) -> DemoTimesheetState:
        result = await self.db.execute(
            select(Timesheet)
            .options(selectinload(Timesheet.entries))
            .where(Timesheet.id == timesheet_id)
        )
        timesheet = result.scalar_one()
        entries = [
            DemoTimesheetEntryState(
                entry_date=entry.entry_date,
                task=entry.task,
                hours=entry.hours,
                notes=entry.notes,
                submitted=timesheet.status == TimesheetStatus.submitted,
            )
            for entry in sorted(timesheet.entries, key=lambda item: item.entry_date)
        ]
        holidays = [DemoHolidayRead(date=date.fromisoformat(day), name=name) for day, name in self.HOLIDAYS]
        return DemoTimesheetState(
            week_start=timesheet.week_start,
            timesheet_id=timesheet.id,
            status=timesheet.status,
            entries=entries,
            holidays=holidays,
        )

    async def _ensure_timesheet(self, current_user: User, week_start: date) -> Timesheet:
        result = await self.db.execute(
            select(Timesheet)
            .options(selectinload(Timesheet.entries))
            .where(Timesheet.employee_id == current_user.employee_id, Timesheet.week_start == week_start)
        )
        timesheet = result.scalar_one_or_none()
        if timesheet:
            return timesheet
        timesheet = Timesheet(employee_id=current_user.employee_id, week_start=week_start, status=TimesheetStatus.draft)
        self.db.add(timesheet)
        await self.db.commit()
        await self.db.refresh(timesheet)
        return timesheet

    async def _seed_timesheet_entries(self, timesheet: Timesheet) -> None:
        result = await self.db.execute(select(TimesheetEntry.id).where(TimesheetEntry.timesheet_id == timesheet.id))
        if result.first():
            return
        monday = timesheet.week_start
        samples = [
            (monday, "Attendance workflow improvements", Decimal("8.0"), "Reviewed attendance flow and work tracking."),
            (monday + timedelta(days=1), "Production support and employee ticket follow-up", Decimal("7.5"), "Handled HRMS employee issues, standup, and approval follow-up."),
        ]
        self.db.add_all(
            [
                TimesheetEntry(timesheet_id=timesheet.id, entry_date=entry_date, task=task, hours=hours, notes=notes)
                for entry_date, task, hours, notes in samples
            ]
        )
        await self.db.commit()

    def _week_start(self, value: date) -> date:
        return value - timedelta(days=value.weekday())

    def _validate_employee_edit_window(self, entry_date: date) -> None:
        holiday_dates = {date.fromisoformat(day) for day, _ in self.HOLIDAYS}
        if entry_date in holiday_dates or entry_date.weekday() in (5, 6):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Timesheet hours are not required for holidays, Saturdays, or Sundays.",
            )

        now = datetime.now()
        today = now.date()
        same_week = self._week_start(entry_date) == self._week_start(today)
        thursday_friday_window = today.weekday() in (3, 4) and entry_date.weekday() in (3, 4) and same_week
        if entry_date == today or thursday_friday_window:
            return

        cutoff = datetime.combine(entry_date + timedelta(days=1), time(11, 0))
        if now >= cutoff:
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail="Timesheet is frozen. Please contact your manager to update this entry.",
            )

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only the current workday can be filled by employees. Please contact your manager for corrections.",
        )

    async def _ensure_demo_employees(self, user_map: dict[str, User]) -> None:
        department_names = {fixture["department"] for fixture in self.EMPLOYEE_FIXTURES.values()}
        dept_result = await self.db.execute(select(Department).where(Department.name.in_(department_names)))
        departments = {department.name: department for department in dept_result.scalars().all()}
        for name in department_names:
            if name not in departments:
                department = Department(name=name)
                self.db.add(department)
                departments[name] = department
        await self.db.flush()

        employees_result = await self.db.execute(
            select(Employee).where(Employee.employee_code.in_([fixture["employee_code"] for fixture in self.EMPLOYEE_FIXTURES.values()]))
        )
        employees = {employee.employee_code: employee for employee in employees_result.scalars().all()}

        for fixture in self.EMPLOYEE_FIXTURES.values():
            if fixture["employee_code"] not in employees:
                employee = Employee(
                    employee_code=fixture["employee_code"],
                    first_name=fixture["first_name"],
                    last_name=fixture["last_name"],
                    job_title=fixture["job_title"],
                    date_joined=fixture["date_joined"],
                    department_id=departments[fixture["department"]].id,
                    reports_to_id=None,
                )
                self.db.add(employee)
                await self.db.flush()
                employees[fixture["employee_code"]] = employee

        for key, fixture in self.EMPLOYEE_FIXTURES.items():
            employee = employees[fixture["employee_code"]]
            report_key = fixture["reports_to"]
            report_id = None
            if report_key:
                report_fixture = self.EMPLOYEE_FIXTURES[report_key]
                report_id = employees[report_fixture["employee_code"]].id
            employee.reports_to_id = report_id
            user = user_map[key]
            if user.employee_id != employee.id:
                user.employee_id = employee.id
        await self.db.commit()
