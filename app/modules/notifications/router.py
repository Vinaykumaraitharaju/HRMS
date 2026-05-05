from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.notifications.schemas import NotificationRead, NotificationUnreadCount
from app.modules.notifications.service import NotificationService

router = APIRouter()


@router.get("", response_model=list[NotificationRead])
async def list_notifications(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(default=30, ge=1, le=100),
):
    return await NotificationService(db).list_for_user(current_user.id, limit=limit)


@router.get("/unread-count", response_model=NotificationUnreadCount)
async def unread_count(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    count = await NotificationService(db).unread_count(current_user.id)
    return {"count": count}


@router.patch("/read-all")
async def mark_all_notifications_read(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    updated = await NotificationService(db).mark_all_read(current_user.id)
    return {"message": "All notifications marked as read", "updated": updated}


@router.patch("/{notification_id}/read", response_model=NotificationRead)
async def mark_notification_read(
    notification_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    notification = await NotificationService(db).mark_read(
        notification_id, current_user.id
    )

    if not notification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found",
        )

    return notification
