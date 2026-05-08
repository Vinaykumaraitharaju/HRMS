from datetime import date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.modules.audit.service import safe_record_audit
from app.modules.auth.models import Role, User
from app.modules.timesheets.schemas import (
    TimesheetCreate,
    TimesheetDecision,
    TimesheetEntryCreate,
    TimesheetRead,
    WeeklySummary,
)
from app.modules.timesheets.models import Timesheet
from app.modules.timesheets.service import TimesheetService

from app.modules.notifications.models import NotificationType
from app.modules.notifications.schemas import NotificationCreate
from app.modules.notifications.service import NotificationService

router = APIRouter()


async def _safe_notify(
    db: AsyncSession,
    user_id: Optional[int],
    title: str,
    message: str,
    notification_type: NotificationType = NotificationType.timesheet,
):
    """
    Notification should never break timesheet flow.
    """
    if not user_id:
        return

    try:
        payload = NotificationCreate(
            user_id=user_id,
            title=title,
            message=message,
            type=notification_type,
        )
        await NotificationService(db).create(payload)
    except Exception:
        pass


def _timesheet_owner_id(timesheet) -> Optional[int]:
    return (
        getattr(timesheet, "user_id", None)
        or getattr(timesheet, "employee_user_id", None)
        or getattr(timesheet, "created_by_id", None)
    )


@router.post("", response_model=TimesheetRead, status_code=status.HTTP_201_CREATED)
async def create_timesheet(
    payload: TimesheetCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    timesheet = await TimesheetService(db).create(current_user, payload)
    await safe_record_audit(
        db,
        category="Timesheets",
        action="timesheet.created",
        message=f"Timesheet created: week {timesheet.week_start}",
        actor=current_user,
        entity_type="timesheet",
        entity_id=timesheet.id,
        details=payload.model_dump(),
    )

    await _safe_notify(
        db=db,
        user_id=current_user.id,
        title="Timesheet created",
        message="Your timesheet has been created successfully.",
    )

    return timesheet


@router.post("/{timesheet_id}/entries", response_model=TimesheetRead)
async def add_entry(
    timesheet_id: int,
    payload: TimesheetEntryCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    timesheet = await TimesheetService(db).add_entry(
        timesheet_id, current_user, payload
    )
    await safe_record_audit(
        db,
        category="Timesheets",
        action="timesheet.entry_added",
        message=f"Timesheet entry saved: {payload.entry_date}",
        actor=current_user,
        entity_type="timesheet",
        entity_id=timesheet.id,
        details=payload.model_dump(),
    )

    await _safe_notify(
        db=db,
        user_id=current_user.id,
        title="Timesheet entry added",
        message="Your timesheet entry has been added successfully.",
    )

    return timesheet


@router.post("/entries", response_model=TimesheetRead)
async def upsert_entry_by_date(
    payload: TimesheetEntryCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    timesheet = await TimesheetService(db).upsert_entry_by_date(current_user, payload)
    await safe_record_audit(
        db,
        category="Timesheets",
        action="timesheet.entry_saved",
        message=f"Timesheet entry saved: {payload.entry_date}",
        actor=current_user,
        entity_type="timesheet",
        entity_id=timesheet.id,
        details=payload.model_dump(),
    )

    await _safe_notify(
        db=db,
        user_id=current_user.id,
        title="Timesheet entry saved",
        message="Your timesheet entry has been saved successfully.",
    )

    return timesheet


@router.delete("/entries/{entry_date}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry_by_date(
    entry_date: date,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    await TimesheetService(db).delete_entry_by_date(current_user, entry_date)
    await safe_record_audit(
        db,
        category="Timesheets",
        action="timesheet.entry_deleted",
        message=f"Timesheet entry deleted: {entry_date}",
        actor=current_user,
        entity_type="timesheet_entry",
        entity_id=entry_date.isoformat(),
    )

    await _safe_notify(
        db=db,
        user_id=current_user.id,
        title="Timesheet entry deleted",
        message=f"Your timesheet entry for {entry_date} has been deleted.",
    )

    return None


@router.post("/submit-week", response_model=TimesheetRead)
async def submit_timesheet_week(
    payload: TimesheetCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    result = await db.execute(
        select(Timesheet).where(
            Timesheet.employee_id == current_user.employee_id,
            Timesheet.week_start == payload.week_start,
        )
    )

    timesheet = result.scalar_one_or_none()

    if not timesheet:
        timesheet = await TimesheetService(db).create(current_user, payload)

    submitted = await TimesheetService(db).submit(timesheet.id, current_user)
    await safe_record_audit(
        db,
        category="Timesheets",
        action="timesheet.submitted",
        message=f"Timesheet submitted: #{submitted.id}",
        actor=current_user,
        entity_type="timesheet",
        entity_id=submitted.id,
    )

    await _safe_notify(
        db=db,
        user_id=current_user.id,
        title="Timesheet submitted",
        message="Your weekly timesheet has been submitted for approval.",
    )

    return submitted


@router.get("", response_model=list[TimesheetRead])
async def list_timesheets(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    return await TimesheetService(db).list(current_user)


@router.get("/{timesheet_id}/summary", response_model=WeeklySummary)
async def weekly_summary(
    timesheet_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
):
    return await TimesheetService(db).summary(timesheet_id)


@router.post("/{timesheet_id}/submit", response_model=TimesheetRead)
async def submit_timesheet(
    timesheet_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    timesheet = await TimesheetService(db).submit(timesheet_id, current_user)
    await safe_record_audit(
        db,
        category="Timesheets",
        action="timesheet.submitted",
        message=f"Timesheet submitted: #{timesheet.id}",
        actor=current_user,
        entity_type="timesheet",
        entity_id=timesheet.id,
    )

    await _safe_notify(
        db=db,
        user_id=current_user.id,
        title="Timesheet submitted",
        message="Your timesheet has been submitted for approval.",
    )

    return timesheet


@router.post("/{timesheet_id}/approve", response_model=TimesheetRead)
async def approve_timesheet(
    timesheet_id: int,
    payload: TimesheetDecision,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[
        User, Depends(require_roles(Role.manager, Role.supervisor, Role.admin))
    ],
):
    timesheet = await TimesheetService(db).approve(timesheet_id, current_user, payload)
    await safe_record_audit(
        db,
        category="Timesheets",
        action="timesheet.approved",
        message=f"Timesheet approved: #{timesheet.id}",
        actor=current_user,
        entity_type="timesheet",
        entity_id=timesheet.id,
        details=payload.model_dump(),
    )

    await _safe_notify(
        db=db,
        user_id=_timesheet_owner_id(timesheet),
        title="Timesheet approved",
        message="Your timesheet has been approved.",
    )

    return timesheet


@router.post("/{timesheet_id}/reject", response_model=TimesheetRead)
async def reject_timesheet(
    timesheet_id: int,
    payload: TimesheetDecision,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[
        User, Depends(require_roles(Role.manager, Role.supervisor, Role.admin))
    ],
):
    timesheet = await TimesheetService(db).reject(timesheet_id, current_user, payload)
    await safe_record_audit(
        db,
        category="Timesheets",
        action="timesheet.rejected",
        message=f"Timesheet rejected: #{timesheet.id}",
        actor=current_user,
        entity_type="timesheet",
        entity_id=timesheet.id,
        details=payload.model_dump(),
    )

    await _safe_notify(
        db=db,
        user_id=_timesheet_owner_id(timesheet),
        title="Timesheet rejected",
        message="Your timesheet has been rejected.",
    )

    return timesheet
