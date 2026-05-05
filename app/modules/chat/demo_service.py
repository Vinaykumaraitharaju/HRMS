from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
import json

from sqlalchemy import insert, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import schema  # noqa: F401
from app.modules.auth.models import Role, RoleModel, User
from app.modules.chat.models import (
    ChatGroup,
    ChatMessage,
    ChatMessageReadReceipt,
    chat_group_members,
    chat_message_mentions,
)
from app.modules.chat.schemas import (
    DemoChatConversation,
    DemoChatMessage,
    DemoChatState,
    DemoChatUser,
)
from app.modules.notifications.models import Notification, NotificationType


class DemoChatService:
    PROFILE_FIXTURES = {
        "you": {
            "email": "employee@wavelynk.com",
            "name": "Aarav Menon",
            "department": "Product",
            "role": "Product Designer",
            "auth_role": Role.employee,
            "online": True,
        },
        "nisha": {
            "email": "nisha@wavelynk.com",
            "name": "Nisha Rao",
            "department": "Product Design",
            "role": "Supervisor",
            "auth_role": Role.supervisor,
            "online": True,
        },
        "dev": {
            "email": "dev@wavelynk.com",
            "name": "Dev Shah",
            "department": "Engineering",
            "role": "Manager",
            "auth_role": Role.manager,
            "online": True,
        },
        "meera": {
            "email": "meera@wavelynk.com",
            "name": "Meera Iyer",
            "department": "People Ops",
            "role": "HR Partner",
            "auth_role": Role.supervisor,
            "online": False,
        },
        "kayo": {
            "email": "kayo@wavelynk.com",
            "name": "Kayo M.",
            "department": "Research",
            "role": "Research Lead",
            "auth_role": Role.manager,
            "online": True,
        },
        "will": {
            "email": "will@wavelynk.com",
            "name": "Will L.",
            "department": "Product",
            "role": "Product Manager",
            "auth_role": Role.manager,
            "online": False,
        },
        "eric": {
            "email": "eric@wavelynk.com",
            "name": "Eric I.",
            "department": "Design",
            "role": "Designer",
            "auth_role": Role.employee,
            "online": True,
        },
        "rhea": {
            "email": "rhea@wavelynk.com",
            "name": "Rhea Kapoor",
            "department": "Finance",
            "role": "Analyst",
            "auth_role": Role.employee,
            "online": True,
        },
    }

    GROUP_FIXTURES = {
        "Design Squad": {
            "section": "Alexandria Project",
            "role": "Channel",
            "members": ["you", "eric", "will", "kayo", "nisha"],
            "messages": [
                (
                    "eric",
                    "Hey, I wanted to start this chat to get to know some of the priorities your team is thinking about.",
                ),
                ("will", "We are starting to do intake for next half planning."),
                ("you", "Thanks for kicking this off!"),
                (
                    "you",
                    "Here is the link to our backlog. It is open for intake suggestions.",
                ),
            ],
        },
        "Product Team": {
            "section": "Favorites",
            "role": "Group chat",
            "members": ["you", "nisha", "dev", "will", "eric", "kayo"],
            "messages": [
                ("nisha", "Sprint planning moved to 3 PM."),
                ("will", "Bring the leave workflow notes too."),
            ],
        },
        "People Ops": {
            "section": "Teams and channels",
            "role": "HR channel",
            "members": ["you", "meera", "nisha", "rhea"],
            "messages": [
                ("meera", "Holiday calendar has been updated for next month."),
            ],
        },
        "Research weekly sync": {
            "section": "Alexandria Project",
            "role": "Channel",
            "members": ["you", "kayo", "will"],
            "messages": [
                ("kayo", "Weekly research notes are posted in Shared."),
            ],
        },
    }

    DIRECT_FIXTURES = {
        "nisha": [
            ("nisha", "Your leave request has moved to manager approval."),
            ("you", "Thanks, I will keep an eye on it."),
            ("nisha", "Also submit this week's timesheet by evening."),
        ],
        "dev": [
            ("dev", "Please submit today's timesheet before 5 PM."),
            ("you", "Adding the final task notes now."),
        ],
    }

    def __init__(self, db: AsyncSession):
        self.db = db
        self.current_key = "you"

    async def bootstrap(self) -> DemoChatState:
        user_map = await self._ensure_demo_users()
        await self._ensure_direct_messages(user_map)
        await self._ensure_groups(user_map)
        return await self.build_state(user_map)

    async def send_demo_message(
        self,
        conversation_id: str,
        body: str,
        mention_user_ids: list[str],
        attachments: list[dict] | None = None,
    ) -> DemoChatState:
        user_map = await self._ensure_demo_users()
        current_user = user_map[self.current_key]
        mention_db_ids = [
            user_map[user_key].id
            for user_key in mention_user_ids
            if user_key in user_map and user_key != self.current_key
        ]
        payload_body = self._serialize_message_payload(body, attachments or [])

        if conversation_id.startswith("user:"):
            other_key = conversation_id.split(":", 1)[1]
            other_user = user_map[other_key]
            message = ChatMessage(
                sender_id=current_user.id, recipient_id=other_user.id, body=payload_body
            )
            self.db.add(message)
            await self.db.flush()
        else:
            group_id = int(conversation_id.split(":", 1)[1])
            message = ChatMessage(
                sender_id=current_user.id, group_id=group_id, body=payload_body
            )
            self.db.add(message)
            await self.db.flush()

        self.db.add(
            ChatMessageReadReceipt(message_id=message.id, user_id=current_user.id)
        )

        if mention_db_ids:
            await self.db.execute(
                insert(chat_message_mentions),
                [
                    {"message_id": message.id, "user_id": user_id}
                    for user_id in mention_db_ids
                ],
            )
            # self.db.add_all(
            #    [
            #       Notification(
            #          recipient_user_id=user_id,
            #         type=NotificationType.chat,
            #        title="You were mentioned",
            #       body=body[:160],
            #  )
            # for user_id in mention_db_ids
            # ]
            # )

        await self.db.commit()
        return await self.build_state(user_map)

    async def mark_demo_conversation_read(self, conversation_id: str) -> None:
        user_map = await self._ensure_demo_users()
        current_user = user_map[self.current_key]
        message_ids = await self._unread_message_ids(
            conversation_id, current_user.id, user_map
        )
        if not message_ids:
            return
        existing = await self.db.execute(
            select(ChatMessageReadReceipt.message_id).where(
                ChatMessageReadReceipt.user_id == current_user.id,
                ChatMessageReadReceipt.message_id.in_(message_ids),
            )
        )
        existing_ids = set(existing.scalars().all())
        self.db.add_all(
            [
                ChatMessageReadReceipt(message_id=message_id, user_id=current_user.id)
                for message_id in message_ids
                if message_id not in existing_ids
            ]
        )
        await self.db.commit()

    async def add_demo_members(
        self, conversation_id: str, member_user_ids: list[str]
    ) -> tuple[str, DemoChatState]:
        user_map = await self._ensure_demo_users()
        current_user = user_map[self.current_key]
        member_keys = [
            user_key
            for user_key in member_user_ids
            if user_key in user_map and user_key != self.current_key
        ]

        if conversation_id.startswith("user:"):
            other_key = conversation_id.split(":", 1)[1]
            group_name = self._direct_group_name([other_key, *member_keys], user_map)
            group = ChatGroup(name=group_name, created_by_id=current_user.id)
            self.db.add(group)
            await self.db.flush()
            all_ids = sorted(
                {
                    current_user.id,
                    user_map[other_key].id,
                    *(user_map[user_key].id for user_key in member_keys),
                }
            )
            await self.db.execute(
                insert(chat_group_members),
                [{"group_id": group.id, "user_id": user_id} for user_id in all_ids],
            )
            await self.db.commit()
            state = await self.build_state(user_map)
            return f"group:{group.id}", state

        group_id = int(conversation_id.split(":", 1)[1])
        existing = await self.db.execute(
            select(chat_group_members.c.user_id).where(
                chat_group_members.c.group_id == group_id
            )
        )
        existing_ids = set(existing.scalars().all())
        new_rows = [
            {"group_id": group_id, "user_id": user_map[user_key].id}
            for user_key in member_keys
            if user_map[user_key].id not in existing_ids
        ]
        if new_rows:
            await self.db.execute(insert(chat_group_members), new_rows)
            await self.db.commit()
        state = await self.build_state(user_map)
        return conversation_id, state

    async def build_state(self, user_map: dict[str, User]) -> DemoChatState:
        current_user = user_map[self.current_key]
        directory = [
            DemoChatUser(
                id=user_key,
                user_id=user.id,
                name=self.PROFILE_FIXTURES[user_key]["name"],
                email=self.PROFILE_FIXTURES[user_key]["email"],
                department=self.PROFILE_FIXTURES[user_key]["department"],
                role=self.PROFILE_FIXTURES[user_key]["role"],
                online=self.PROFILE_FIXTURES[user_key]["online"],
            )
            for user_key, user in user_map.items()
        ]
        id_to_key = {user.id: user_key for user_key, user in user_map.items()}

        direct_messages_result = await self.db.execute(
            select(ChatMessage)
            .options(selectinload(ChatMessage.read_receipts))
            .where(
                ChatMessage.group_id.is_(None),
                or_(
                    ChatMessage.sender_id == current_user.id,
                    ChatMessage.recipient_id == current_user.id,
                ),
            )
            .order_by(ChatMessage.created_at.asc())
        )
        direct_messages = list(direct_messages_result.scalars().all())

        group_ids_result = await self.db.execute(
            select(chat_group_members.c.group_id).where(
                chat_group_members.c.user_id == current_user.id
            )
        )
        group_ids = list(group_ids_result.scalars().all())

        groups_result = await self.db.execute(
            select(ChatGroup)
            .where(ChatGroup.id.in_(group_ids))
            .order_by(ChatGroup.created_at.asc())
        )
        groups = list(groups_result.scalars().all())

        group_members_result = await self.db.execute(
            select(chat_group_members.c.group_id, chat_group_members.c.user_id).where(
                chat_group_members.c.group_id.in_(group_ids)
            )
        )
        group_members_rows = list(group_members_result.all())
        group_members: dict[int, list[int]] = defaultdict(list)
        for group_id, user_id in group_members_rows:
            group_members[group_id].append(user_id)

        group_messages_result = await self.db.execute(
            select(ChatMessage)
            .options(selectinload(ChatMessage.read_receipts))
            .where(ChatMessage.group_id.in_(group_ids))
            .order_by(ChatMessage.created_at.asc())
        )
        group_messages = list(group_messages_result.scalars().all())

        mention_rows = await self.db.execute(
            select(chat_message_mentions.c.message_id, chat_message_mentions.c.user_id)
        )
        mentions_by_message: dict[int, list[str]] = defaultdict(list)
        for message_id, user_id in mention_rows.all():
            user_key = id_to_key.get(user_id)
            if user_key:
                mentions_by_message[message_id].append(user_key)

        conversation_members: dict[str, list[str]] = {}
        conversation_messages: dict[str, list[DemoChatMessage]] = {}
        conversations: list[DemoChatConversation] = []
        latest_order: dict[str, datetime] = {}

        by_other_user: dict[int, list[ChatMessage]] = defaultdict(list)
        for message in direct_messages:
            other_user_id = (
                message.recipient_id
                if message.sender_id == current_user.id
                else message.sender_id
            )
            if other_user_id:
                by_other_user[other_user_id].append(message)

        for other_user_id, messages in by_other_user.items():
            other_key = id_to_key[other_user_id]
            profile = self.PROFILE_FIXTURES[other_key]
            conversation_id = f"user:{other_key}"
            conversation_members[conversation_id] = [self.current_key, other_key]
            conversation_messages[conversation_id] = [
                self._to_demo_message(
                    message,
                    current_user.id,
                    (
                        other_key
                        if message.sender_id != current_user.id
                        else self.current_key
                    ),
                    mentions_by_message,
                )
                for message in messages
            ]
            unread = self._count_unread(messages, current_user.id)
            last_message = messages[-1]
            last_payload = self._deserialize_message_payload(last_message.body)
            conversations.append(
                DemoChatConversation(
                    id=conversation_id,
                    section="Favorites" if other_key == "nisha" else "Chats",
                    name=profile["name"],
                    role=profile["role"],
                    preview=self._conversation_preview(
                        last_payload["body"], last_payload["attachments"]
                    ),
                    time=self._time_label(last_message.created_at),
                    unread=str(unread) if unread else "",
                    online=bool(profile["online"]),
                    members=2,
                    details=[
                        profile["email"],
                        profile["department"],
                        f"{len(messages)} messages",
                    ],
                )
            )
            latest_order[conversation_id] = last_message.created_at

        messages_by_group: dict[int, list[ChatMessage]] = defaultdict(list)
        for message in group_messages:
            if message.group_id:
                messages_by_group[message.group_id].append(message)

        for group in groups:
            members = [
                id_to_key[user_id]
                for user_id in group_members[group.id]
                if user_id in id_to_key
            ]
            conversation_id = f"group:{group.id}"
            msgs = messages_by_group[group.id]
            last_payload = (
                self._deserialize_message_payload(msgs[-1].body)
                if msgs
                else {"body": "No messages yet.", "attachments": []}
            )
            last_body = (
                self._conversation_preview(
                    last_payload["body"], last_payload["attachments"]
                )
                if msgs
                else "No messages yet."
            )
            unread = self._count_unread(msgs, current_user.id)
            fixture = self.GROUP_FIXTURES.get(group.name)
            role = fixture["role"] if fixture else "Group chat"
            section = fixture["section"] if fixture else "Chats"
            details_email = (
                self.PROFILE_FIXTURES[members[1]]["department"]
                if len(members) == 2
                else f"{len(members)} members"
            )
            details = [
                details_email if len(members) == 2 else f"{len(members)} members",
                fixture["section"] if fixture else "Ad hoc chat",
                f"{len(msgs)} messages",
            ]
            conversations.append(
                DemoChatConversation(
                    id=conversation_id,
                    section=section,
                    name=group.name,
                    role=role,
                    preview=last_body,
                    time=self._time_label(msgs[-1].created_at) if msgs else "now",
                    unread=str(unread) if unread else "",
                    online=True,
                    members=len(members),
                    details=details,
                )
            )
            conversation_members[conversation_id] = members
            conversation_messages[conversation_id] = [
                self._to_demo_message(
                    message,
                    current_user.id,
                    id_to_key[message.sender_id],
                    mentions_by_message,
                )
                for message in msgs
            ]
            latest_order[conversation_id] = (
                msgs[-1].created_at if msgs else group.created_at
            )

        conversations.sort(
            key=lambda item: latest_order.get(item.id, datetime.now(UTC)),
            reverse=True,
        )

        return DemoChatState(
            current_user_id=self.current_key,
            directory=directory,
            conversations=conversations,
            conversation_members=conversation_members,
            conversation_messages=conversation_messages,
        )

    async def _ensure_demo_users(self) -> dict[str, User]:
        emails = [profile["email"] for profile in self.PROFILE_FIXTURES.values()]
        roles_needed = {
            profile["auth_role"] for profile in self.PROFILE_FIXTURES.values()
        }
        role_result = await self.db.execute(
            select(RoleModel).where(RoleModel.name.in_(roles_needed))
        )
        roles_by_name = {role.name: role for role in role_result.scalars().all()}
        for role_name in roles_needed:
            if role_name not in roles_by_name:
                role = RoleModel(name=role_name)
                self.db.add(role)
                roles_by_name[role_name] = role
        await self.db.flush()

        user_result = await self.db.execute(
            select(User).options(selectinload(User.roles)).where(User.email.in_(emails))
        )
        users_by_email = {user.email: user for user in user_result.scalars().all()}

        for profile in self.PROFILE_FIXTURES.values():
            if profile["email"] not in users_by_email:
                user = User(
                    email=profile["email"],
                    password_hash="demo-local-user",
                    roles=[roles_by_name[profile["auth_role"]]],
                )
                self.db.add(user)
                await self.db.flush()
                users_by_email[user.email] = user

        await self.db.commit()
        refreshed = await self.db.execute(
            select(User).options(selectinload(User.roles)).where(User.email.in_(emails))
        )
        users_by_email = {user.email: user for user in refreshed.scalars().all()}
        return {
            user_key: users_by_email[profile["email"]]
            for user_key, profile in self.PROFILE_FIXTURES.items()
        }

    async def _ensure_direct_messages(self, user_map: dict[str, User]) -> None:
        current_user = user_map[self.current_key]
        for other_key, messages in self.DIRECT_FIXTURES.items():
            other_user = user_map[other_key]
            result = await self.db.execute(
                select(ChatMessage.id).where(
                    ChatMessage.group_id.is_(None),
                    or_(
                        (ChatMessage.sender_id == current_user.id)
                        & (ChatMessage.recipient_id == other_user.id),
                        (ChatMessage.sender_id == other_user.id)
                        & (ChatMessage.recipient_id == current_user.id),
                    ),
                )
            )
            if result.first():
                continue
            for sender_key, body in messages:
                sender = user_map[sender_key]
                recipient = (
                    other_user if sender_key == self.current_key else current_user
                )
                self.db.add(
                    ChatMessage(
                        sender_id=sender.id, recipient_id=recipient.id, body=body
                    )
                )
        await self.db.commit()

    async def _ensure_groups(self, user_map: dict[str, User]) -> None:
        current_user = user_map[self.current_key]
        for name, fixture in self.GROUP_FIXTURES.items():
            existing = await self.db.execute(
                select(ChatGroup).where(
                    ChatGroup.name == name, ChatGroup.created_by_id == current_user.id
                )
            )
            group = existing.scalar_one_or_none()
            if not group:
                group = ChatGroup(name=name, created_by_id=current_user.id)
                self.db.add(group)
                await self.db.flush()
                await self.db.execute(
                    insert(chat_group_members),
                    [
                        {"group_id": group.id, "user_id": user_map[user_key].id}
                        for user_key in fixture["members"]
                    ],
                )
            message_result = await self.db.execute(
                select(ChatMessage.id).where(ChatMessage.group_id == group.id)
            )
            if not message_result.first():
                for sender_key, body in fixture["messages"]:
                    self.db.add(
                        ChatMessage(
                            sender_id=user_map[sender_key].id,
                            group_id=group.id,
                            body=body,
                        )
                    )
        await self.db.commit()

    async def _unread_message_ids(
        self, conversation_id: str, current_user_id: int, user_map: dict[str, User]
    ) -> list[int]:
        if conversation_id.startswith("user:"):
            other_key = conversation_id.split(":", 1)[1]
            other_user_id = user_map[other_key].id
            result = await self.db.execute(
                select(ChatMessage)
                .options(selectinload(ChatMessage.read_receipts))
                .where(
                    ChatMessage.group_id.is_(None),
                    ChatMessage.sender_id == other_user_id,
                    ChatMessage.recipient_id == current_user_id,
                )
            )
        else:
            group_id = int(conversation_id.split(":", 1)[1])
            result = await self.db.execute(
                select(ChatMessage)
                .options(selectinload(ChatMessage.read_receipts))
                .where(
                    ChatMessage.group_id == group_id,
                    ChatMessage.sender_id != current_user_id,
                )
            )
        messages = list(result.scalars().all())
        return [
            message.id
            for message in messages
            if current_user_id
            not in {receipt.user_id for receipt in message.read_receipts}
        ]

    def _to_demo_message(
        self,
        message: ChatMessage,
        current_user_id: int,
        sender_key: str,
        mentions_by_message: dict[int, list[str]],
    ) -> DemoChatMessage:
        read = (
            current_user_id in {receipt.user_id for receipt in message.read_receipts}
            or message.sender_id == current_user_id
        )
        payload = self._deserialize_message_payload(message.body)
        return DemoChatMessage(
            message_id=message.id,
            side="right" if message.sender_id == current_user_id else "left",
            name=(
                "You"
                if message.sender_id == current_user_id
                else self.PROFILE_FIXTURES[sender_key]["name"]
            ),
            body=payload["body"],
            time=message.created_at.astimezone(UTC).strftime("%H:%M"),
            mentions=[
                {"id": mention_key, "name": self.PROFILE_FIXTURES[mention_key]["name"]}
                for mention_key in mentions_by_message.get(message.id, [])
                if mention_key in self.PROFILE_FIXTURES
            ],
            attachments=payload["attachments"],
            read=read,
        )

    def _serialize_message_payload(self, body: str, attachments: list[dict]) -> str:
        payload = {
            "body": body,
            "attachments": attachments,
        }
        return f"__WAVELYNK_CHAT__{json.dumps(payload, separators=(',', ':'))}"

    def _deserialize_message_payload(self, body: str) -> dict:
        if body.startswith("__WAVELYNK_CHAT__"):
            try:
                payload = json.loads(body.removeprefix("__WAVELYNK_CHAT__"))
                return {
                    "body": payload.get("body", ""),
                    "attachments": payload.get("attachments", []),
                }
            except json.JSONDecodeError:
                pass
        return {"body": body, "attachments": []}

    def _conversation_preview(self, body: str, attachments: list[dict]) -> str:
        if attachments:
            if len(attachments) == 1:
                kind = attachments[0].get("kind", "file")
                label = {
                    "image": "Image",
                    "pdf": "PDF document",
                    "word": "Word document",
                    "sheet": "Spreadsheet",
                    "slides": "Presentation",
                    "file": "File",
                }.get(kind, "File")
                preview = f"{label}: {attachments[0].get('name', 'attachment')}"
            else:
                preview = f"{len(attachments)} attachments"
            return f"{preview} · {body}" if body else preview
        return body

    def _count_unread(self, messages: list[ChatMessage], current_user_id: int) -> int:
        total = 0
        for message in messages:
            if message.sender_id == current_user_id:
                continue
            if current_user_id not in {
                receipt.user_id for receipt in message.read_receipts
            }:
                total += 1
        return total

    def _time_label(self, created_at: datetime) -> str:
        now = datetime.now(UTC)
        stamp = created_at if created_at.tzinfo else created_at.replace(tzinfo=UTC)
        delta = now - stamp.astimezone(UTC)
        minutes = max(int(delta.total_seconds() // 60), 0)
        if minutes < 1:
            return "now"
        if minutes < 60:
            return f"{minutes}m"
        hours = minutes // 60
        if hours < 24:
            return f"{hours}h"
        days = hours // 24
        return f"{days}d"

    def _direct_group_name(
        self, member_keys: list[str], user_map: dict[str, User]
    ) -> str:
        names = [
            self.PROFILE_FIXTURES[user_key]["name"].split(" ")[0]
            for user_key in member_keys
            if user_key in user_map
        ]
        return " / ".join(names[:3]) if names else "New group"
