from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.activity.schemas import ActivityItemRead
from app.modules.activity.service import ActivityService

router = APIRouter()


@router.get("/feed", response_model=list[ActivityItemRead])
async def activity_feed(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return await ActivityService(db).get_feed(request)


@router.post("/feed/{item_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_activity_read(
    item_id: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await ActivityService(db).mark_item_read(item_id, request)
    return None
