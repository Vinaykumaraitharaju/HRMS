from datetime import datetime

from pydantic import BaseModel


class AuditLogRead(BaseModel):
    id: int
    category: str
    action: str
    message: str
    actor_user_id: int | None
    actor_email: str | None
    entity_type: str | None
    entity_id: str | None
    details: dict
    created_at: datetime

    model_config = {"from_attributes": True}
