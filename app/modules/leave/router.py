from typing import Annotated, Optional

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_roles
from app.modules.audit.service import safe_record_audit
from app.modules.auth.models import Role, User
from app.modules.leave.schemas import (
    LeaveApply,
    LeaveDecision,
    LeavePolicyState,
    LeaveRead,
)
from app.modules.leave.service import LeaveService

from app.modules.notifications.models import NotificationType
from app.modules.notifications.schemas import NotificationCreate
from app.modules.notifications.service import NotificationService

router = APIRouter()


async def _safe_notify(
    db: AsyncSession,
    user_id: Optional[int],
    title: str,
    message: str,
    notification_type: NotificationType = NotificationType.leave,
):
    """
    Notification should never break leave flow.
    If notification fails, leave apply/approve/reject still works.
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


def _leave_owner_id(leave) -> Optional[int]:
    return (
        getattr(leave, "user_id", None)
        or getattr(leave, "employee_id", None)
        or getattr(leave, "created_by_id", None)
    )


@router.get("/policy", response_model=LeavePolicyState)
async def get_leave_policy(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    return await LeaveService(db).get_policy()


@router.put("/policy", response_model=LeavePolicyState)
async def update_leave_policy(
    payload: LeavePolicyState,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(Role.hr, Role.admin))],
):
    policy = await LeaveService(db).update_policy(payload)

    await _safe_notify(
        db=db,
        user_id=current_user.id,
        title="Leave policy updated",
        message="Leave policy has been updated successfully.",
    )

    return policy


@router.post("", response_model=LeaveRead, status_code=status.HTTP_201_CREATED)
async def apply_leave(
    payload: LeaveApply,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    leave = await LeaveService(db).apply(current_user, payload)
    await safe_record_audit(
        db,
        category="Leave",
        action="leave.submitted",
        message=f"Leave request submitted: #{leave.id}",
        actor=current_user,
        entity_type="leave",
        entity_id=leave.id,
        details=payload.model_dump(),
    )

    await _safe_notify(
        db=db,
        user_id=current_user.id,
        title="Leave request submitted",
        message="Your leave request has been submitted for approval.",
    )

    return leave


@router.get("", response_model=list[LeaveRead])
async def list_leaves(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    return await LeaveService(db).list(current_user)


@router.post("/{leave_id}/supervisor-approve", response_model=LeaveRead)
async def supervisor_approve(
    leave_id: int,
    payload: LeaveDecision,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[
        User, Depends(require_roles(Role.supervisor, Role.manager, Role.admin))
    ],
):
    leave = await LeaveService(db).supervisor_approve(leave_id, current_user, payload)
    await safe_record_audit(
        db,
        category="Leave",
        action="leave.supervisor_approved",
        message=f"Leave supervisor approved: #{leave.id}",
        actor=current_user,
        entity_type="leave",
        entity_id=leave.id,
        details=payload.model_dump(),
    )

    await _safe_notify(
        db=db,
        user_id=_leave_owner_id(leave),
        title="Leave supervisor approved",
        message="Your leave request has been approved by supervisor.",
    )

    return leave


@router.post("/{leave_id}/manager-approve", response_model=LeaveRead)
async def manager_approve(
    leave_id: int,
    payload: LeaveDecision,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(Role.manager, Role.admin))],
):
    leave = await LeaveService(db).manager_approve(leave_id, current_user, payload)
    await safe_record_audit(
        db,
        category="Leave",
        action="leave.approved",
        message=f"Leave approved: #{leave.id}",
        actor=current_user,
        entity_type="leave",
        entity_id=leave.id,
        details=payload.model_dump(),
    )

    await _safe_notify(
        db=db,
        user_id=_leave_owner_id(leave),
        title="Leave approved",
        message="Your leave request has been approved by manager.",
    )

    return leave


@router.post("/{leave_id}/reject", response_model=LeaveRead)
async def reject_leave(
    leave_id: int,
    payload: LeaveDecision,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[
        User, Depends(require_roles(Role.supervisor, Role.manager, Role.admin))
    ],
):
    leave = await LeaveService(db).reject(leave_id, current_user, payload)
    await safe_record_audit(
        db,
        category="Leave",
        action="leave.rejected",
        message=f"Leave rejected: #{leave.id}",
        actor=current_user,
        entity_type="leave",
        entity_id=leave.id,
        details=payload.model_dump(),
    )

    await _safe_notify(
        db=db,
        user_id=_leave_owner_id(leave),
        title="Leave rejected",
        message="Your leave request has been rejected.",
    )

    return leave


@router.delete("/request/{leave_id}", response_model=LeaveRead)
async def revoke_leave(
    leave_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    leave = await LeaveService(db).revoke(leave_id, current_user)
    await safe_record_audit(
        db,
        category="Leave",
        action="leave.revoked",
        message=f"Leave revoked: #{leave.id}",
        actor=current_user,
        entity_type="leave",
        entity_id=leave.id,
    )

    await _safe_notify(
        db=db,
        user_id=current_user.id,
        title="Leave request revoked",
        message="Your leave request has been revoked.",
    )

    return leave
