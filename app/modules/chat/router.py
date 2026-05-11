from typing import Annotated, Optional

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.chat.manager import connection_manager
from app.modules.chat.schemas import (
    ChatGroupCreate,
    ChatGroupRead,
    ChatMessageCreate,
    ChatPresenceRead,
    ChatMessageRead,
    ChatMessageReadMark,
)
from app.modules.chat.service import ChatService

router = APIRouter()


def _safe_get(obj, key: str, default=None):
    if obj is None:
        return default

    if isinstance(obj, dict):
        return obj.get(key, default)

    return getattr(obj, key, default)


def _message_to_payload(message) -> dict:
    return {
        "id": _safe_get(message, "id"),
        "sender_id": _safe_get(message, "sender_id"),
        "recipient_id": _safe_get(message, "recipient_id"),
        "group_id": _safe_get(message, "group_id"),
        "content": _safe_get(message, "content"),
        "message": _safe_get(message, "message"),
        "body": _safe_get(message, "body"),
        "attachments": _safe_get(message, "attachments", []),
        "created_at": str(_safe_get(message, "created_at", "")),
        "is_read": _safe_get(message, "is_read", False),
    }


async def _safe_send_user(user_id: Optional[int], payload: dict):
    if not user_id:
        return

    try:
        await connection_manager.send_user(int(user_id), payload)
    except Exception:
        pass


async def _safe_send_group(group_id: Optional[int], payload: dict):
    if not group_id:
        return

    try:
        await connection_manager.send_group(int(group_id), payload)
    except Exception:
        pass


@router.post(
    "/groups",
    response_model=ChatGroupRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_group(
    payload: ChatGroupCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    connection_manager.touch_user(current_user.id)
    group = await ChatService(db).create_group(current_user, payload)

    await _safe_send_group(
        _safe_get(group, "id"),
        {
            "type": "group_created",
            "group_id": _safe_get(group, "id"),
            "created_by": current_user.id,
        },
    )

    return group


@router.post(
    "/messages",
    response_model=ChatMessageRead,
    status_code=status.HTTP_201_CREATED,
)
async def send_message(
    payload: ChatMessageCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    connection_manager.touch_user(current_user.id)

    message = await ChatService(db).send_message(current_user, payload)
    message_payload = _message_to_payload(message)

    event = {
        "type": "new_message",
        "message": message_payload,
    }

    recipient_id = (
        _safe_get(message, "recipient_id")
        or _safe_get(payload, "recipient_id")
        or _safe_get(payload, "receiver_id")
    )

    group_id = _safe_get(message, "group_id") or _safe_get(payload, "group_id")

    if group_id:
        await _safe_send_group(group_id, event)
    else:
        await _safe_send_user(recipient_id, event)
        await _safe_send_user(current_user.id, event)

    return message


@router.get("/messages", response_model=list[ChatMessageRead])
async def list_messages(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    connection_manager.touch_user(current_user.id)
    return await ChatService(db).list_messages(current_user)


@router.post("/messages/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_messages_read(
    payload: ChatMessageReadMark,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    connection_manager.touch_user(current_user.id)

    await ChatService(db).mark_read(current_user, payload.message_ids)

    await _safe_send_user(
        current_user.id,
        {
            "type": "messages_read",
            "message_ids": payload.message_ids,
            "reader_id": current_user.id,
        },
    )

    return None


@router.get("/presence", response_model=ChatPresenceRead)
async def list_presence(
    current_user: Annotated[User, Depends(get_current_user)],
):
    connection_manager.touch_user(current_user.id)
    return ChatPresenceRead(online_user_ids=connection_manager.online_user_ids())


@router.websocket("/ws/users/{user_id}")
async def user_socket(websocket: WebSocket, user_id: int):
    await connection_manager.connect_user(user_id, websocket)

    await _safe_send_user(
        user_id,
        {
            "type": "connected",
            "user_id": user_id,
        },
    )

    try:
        while True:
            payload = await websocket.receive_json()

            event_type = payload.get("type")

            if event_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if event_type == "typing" and payload.get("recipient_id"):
                await _safe_send_user(
                    int(payload["recipient_id"]),
                    {
                        "type": "typing",
                        "from_user_id": user_id,
                        "recipient_id": int(payload["recipient_id"]),
                        "is_typing": bool(payload.get("is_typing", True)),
                    },
                )

    except WebSocketDisconnect:
        connection_manager.disconnect_user(user_id, websocket)

    except Exception:
        connection_manager.disconnect_user(user_id, websocket)


@router.websocket("/ws/groups/{group_id}")
async def group_socket(websocket: WebSocket, group_id: int):
    await connection_manager.connect_group(group_id, websocket)

    try:
        while True:
            payload = await websocket.receive_json()

            event_type = payload.get("type")

            if event_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if event_type == "typing":
                await _safe_send_group(
                    group_id,
                    {
                        "type": "typing",
                        "group_id": group_id,
                        "from_user_id": payload.get("from_user_id"),
                        "is_typing": bool(payload.get("is_typing", True)),
                    },
                )

    except WebSocketDisconnect:
        connection_manager.disconnect_group(group_id, websocket)

    except Exception:
        connection_manager.disconnect_group(group_id, websocket)
