import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class NotificationType(str, enum.Enum):
    system = "system"
    leave = "leave"
    timesheet = "timesheet"
    chat = "chat"
    attendance = "attendance"
    calendar = "calendar"
    wfh = "wfh"
    break_alert = "break_alert"
    admin = "admin"
    approval = "approval"
    warning = "warning"


class NotificationPriority(str, enum.Enum):
    info = "info"
    success = "success"
    warning = "warning"
    danger = "danger"


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    recipient_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    type: Mapped[NotificationType] = mapped_column(
        Enum(NotificationType, name="notificationtype"),
        default=NotificationType.system,
        nullable=False,
        index=True,
    )

    priority: Mapped[NotificationPriority] = mapped_column(
        Enum(NotificationPriority, name="notificationpriority"),
        default=NotificationPriority.info,
        nullable=False,
    )

    title: Mapped[str] = mapped_column(String(160), nullable=False)

    body: Mapped[str] = mapped_column(Text, nullable=False)

    action_url: Mapped[str] = mapped_column(
        String(255),
        nullable=True,
    )

    read_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

