from app.modules.notifications.models import NotificationType
from app.modules.notifications.schemas import NotificationCreate
from app.modules.notifications.service import NotificationService
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.modules.audit.service import safe_record_audit
from app.modules.attendance.models import AttendanceAction
from app.modules.attendance.schemas import AttendanceCapture, AttendanceRead
from app.modules.attendance.service import AttendanceService
from app.modules.auth.models import User

router = APIRouter()


def attendance_notification_copy(payload: AttendanceCapture) -> tuple[NotificationType, str, str]:
    break_label = (payload.break_type or "Break").replace("_", " ").strip().title()

    if payload.action == AttendanceAction.break_start:
        return (
            NotificationType.break_alert,
            f"{break_label} started",
            f"Your {break_label.lower()} has started.",
        )

    if payload.action == AttendanceAction.break_end:
        return (
            NotificationType.break_alert,
            f"{break_label} ended",
            f"Your {break_label.lower()} has ended. Welcome back.",
        )

    if payload.action == AttendanceAction.logout:
        return (
            NotificationType.attendance,
            "Logged out",
            "Your work session has been closed.",
        )

    return (
        NotificationType.attendance,
        "Logged in",
        "Your attendance has been recorded successfully.",
    )


@router.post(
    "/capture", response_model=AttendanceRead, status_code=status.HTTP_201_CREATED
)
async def capture_attendance(
    payload: AttendanceCapture,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    result = await AttendanceService(db).capture(current_user, payload)
    await safe_record_audit(
        db,
        category="Attendance",
        action=f"attendance.{payload.action.value if hasattr(payload.action, 'value') else payload.action}",
        message=f"Attendance captured: {payload.action}",
        actor=current_user,
        entity_type="attendance",
        entity_id=result.id,
        details={
            "employee_id": result.employee_id,
            "work_mode": result.work_mode,
            "distance_meters": result.distance_meters,
        },
    )

    try:
        notification_type, title, body = attendance_notification_copy(payload)
        await NotificationService(db).create(
            NotificationCreate(
                recipient_user_id=current_user.id,
                type=notification_type,
                title=title,
                body=body,
            )
        )
    except Exception as exc:
        print("Notification skipped:", exc)

    return result


@router.get("/me", response_model=list[AttendanceRead])
async def my_attendance(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    return await AttendanceService(db).list_for_current_user(current_user)
