from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.chat.manager import connection_manager
from app.modules.chat.models import (
    ChatGroup,
    ChatMessage,
    ChatMessageReadReceipt,
    chat_group_members,
    chat_message_mentions,
)
from app.modules.chat.schemas import ChatGroupCreate, ChatMessageCreate
from app.modules.notifications.models import NotificationType
from app.modules.notifications.schemas import NotificationCreate
from app.modules.notifications.service import NotificationService


class ChatService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_group(self, current_user: User, payload: ChatGroupCreate) -> ChatGroup:
        group = ChatGroup(name=payload.name, created_by_id=current_user.id)
        self.db.add(group)
        await self.db.flush()
        member_ids = sorted(set(payload.member_user_ids + [current_user.id]))
        if member_ids:
            await self.db.execute(
                insert(chat_group_members),
                [{"group_id": group.id, "user_id": user_id} for user_id in member_ids],
            )
        await self.db.commit()
        await self.db.refresh(group)
        return group

    async def send_message(self, current_user: User, payload: ChatMessageCreate) -> ChatMessage:
        data = payload.model_dump(exclude={"mention_user_ids"})
        message = ChatMessage(sender_id=current_user.id, **data)
        self.db.add(message)
        await self.db.flush()
        mention_ids = sorted(set(payload.mention_user_ids))
        if mention_ids:
            await self.db.execute(
                insert(chat_message_mentions),
                [{"message_id": message.id, "user_id": user_id} for user_id in mention_ids],
            )
        # Sender has implicitly read their own message.
        self.db.add(ChatMessageReadReceipt(message_id=message.id, user_id=current_user.id))
        await self.db.commit()
        await self.db.refresh(message)
        message.mention_user_ids = mention_ids
        message.read_by_user_ids = [current_user.id]
        wire_payload = {
            "type": "message",
            "id": message.id,
            "sender_id": message.sender_id,
            "recipient_id": message.recipient_id,
            "group_id": message.group_id,
            "body": message.body,
            "mention_user_ids": mention_ids,
            "created_at": message.created_at.isoformat(),
        }
        if message.recipient_id:
            await connection_manager.send_user(message.recipient_id, wire_payload)
            await NotificationService(self.db).create(
                NotificationCreate(
                    recipient_user_id=message.recipient_id,
                    type=NotificationType.chat,
                    title="New message",
                    body=message.body[:160],
                )
            )
        if message.group_id:
            await connection_manager.send_group(message.group_id, wire_payload)
        for user_id in mention_ids:
            if user_id == current_user.id:
                continue
            await NotificationService(self.db).create(
                NotificationCreate(
                    recipient_user_id=user_id,
                    type=NotificationType.chat,
                    title="You were mentioned",
                    body=message.body[:160],
                )
            )
        return message

    async def list_messages(self, current_user: User) -> list[ChatMessage]:
        member_group_ids = select(chat_group_members.c.group_id).where(chat_group_members.c.user_id == current_user.id)
        result = await self.db.execute(
            select(ChatMessage)
            .where(
                (ChatMessage.sender_id == current_user.id)
                | (ChatMessage.recipient_id == current_user.id)
                | (ChatMessage.group_id.in_(member_group_ids))
            )
            .order_by(ChatMessage.created_at.asc())
        )
        messages = list(result.scalars().all())
        if not messages:
            return messages

        message_ids = [message.id for message in messages]

        mention_result = await self.db.execute(
            select(chat_message_mentions.c.message_id, chat_message_mentions.c.user_id).where(
                chat_message_mentions.c.message_id.in_(message_ids)
            )
        )
        mention_map: dict[int, list[int]] = {message_id: [] for message_id in message_ids}
        for message_id, user_id in mention_result.all():
            mention_map.setdefault(int(message_id), []).append(int(user_id))

        for message in messages:
            message.mention_user_ids = mention_map.get(message.id, [])
            message.read_by_user_ids = [receipt.user_id for receipt in (message.read_receipts or [])]

        return messages

    async def mark_read(self, current_user: User, message_ids: list[int]) -> list[ChatMessageReadReceipt]:
        if not message_ids:
            return []
        existing_result = await self.db.execute(
            select(ChatMessageReadReceipt.message_id).where(
                ChatMessageReadReceipt.user_id == current_user.id,
                ChatMessageReadReceipt.message_id.in_(message_ids),
            )
        )
        existing_ids = set(existing_result.scalars().all())
        rows = [
            ChatMessageReadReceipt(message_id=message_id, user_id=current_user.id)
            for message_id in sorted(set(message_ids) - existing_ids)
        ]
        self.db.add_all(rows)
        await self.db.commit()
        return rows
