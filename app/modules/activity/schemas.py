from datetime import datetime

from pydantic import BaseModel


class ActivityItemRead(BaseModel):
    id: str
    kind: str
    title: str
    body: str
    actor: str
    category: str
    created_at: datetime
    unread: bool
    target: str | None = None
    meta: dict[str, str | int] = {}
