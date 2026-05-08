from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_roles
from app.modules.audit.schemas import AuditLogRead
from app.modules.audit.service import AuditService
from app.modules.auth.models import Role, User

router = APIRouter()


@router.get("", response_model=list[AuditLogRead])
async def list_audit_logs(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(Role.admin, Role.hr))],
    category: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
):
    return await AuditService(db).list(category=category, limit=limit)
