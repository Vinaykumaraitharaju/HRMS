from datetime import datetime

from pydantic import BaseModel

from app.modules.notifications.models import NotificationPriority, NotificationType


class NotificationCreate(BaseModel):
    recipient_user_id: int
    type: NotificationType = NotificationType.system
    priority: NotificationPriority = NotificationPriority.info
    title: str
    body: str
    action_url: str | None = None


class NotificationRead(BaseModel):
    id: int
    recipient_user_id: int
    type: NotificationType
    priority: NotificationPriority
    title: str
    body: str
    action_url: str | None
    read_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class NotificationUnreadCount(BaseModel):
    count: int
