from app.modules.notifications.models import NotificationType
from app.modules.notifications.schemas import NotificationCreate
from app.modules.notifications.service import NotificationService
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.modules.audit.service import safe_record_audit
from app.modules.attendance.schemas import AttendanceCapture, AttendanceRead
from app.modules.attendance.service import AttendanceService
from app.modules.auth.models import User

router = APIRouter()


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
        await NotificationService(db).create(
            NotificationCreate(
                recipient_user_id=current_user.id,
                type=NotificationType.attendance,
                title="Attendance captured",
                body="Your attendance has been recorded successfully.",
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
