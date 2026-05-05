from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class ChatGroupCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    member_user_ids: list[int] = Field(default_factory=list)


class ChatGroupRead(BaseModel):
    id: int
    name: str
    created_by_id: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatMessageCreate(BaseModel):
    recipient_id: int | None = None
    group_id: int | None = None
    body: str = Field(min_length=1, max_length=4000)
    mention_user_ids: list[int] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_target(self):
        if bool(self.recipient_id) == bool(self.group_id):
            raise ValueError("Provide exactly one of recipient_id or group_id")
        return self


class ChatMessageRead(BaseModel):
    id: int
    sender_id: int
    recipient_id: int | None
    group_id: int | None
    body: str
    mention_user_ids: list[int] = Field(default_factory=list)
    read_by_user_ids: list[int] = Field(default_factory=list)
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatMessageReadMark(BaseModel):
    message_ids: list[int] = Field(default_factory=list)


class ChatPresenceRead(BaseModel):
    online_user_ids: list[int] = Field(default_factory=list)


class DemoChatUser(BaseModel):
    id: str
    user_id: int
    name: str
    email: str
    department: str
    role: str
    online: bool = True


class DemoChatConversation(BaseModel):
    id: str
    section: str
    name: str
    role: str
    preview: str
    time: str
    unread: str
    online: bool
    members: int
    details: list[str]


class DemoChatAttachment(BaseModel):
    id: str
    name: str
    kind: str
    mime_type: str = "application/octet-stream"
    size: int = 0
    data_url: str


class DemoChatMessage(BaseModel):
    message_id: int
    side: str
    name: str
    body: str
    time: str
    mentions: list[dict[str, str | int]] = []
    attachments: list[DemoChatAttachment] = []
    read: bool = True


class DemoChatState(BaseModel):
    current_user_id: str
    directory: list[DemoChatUser]
    conversations: list[DemoChatConversation]
    conversation_members: dict[str, list[str]]
    conversation_messages: dict[str, list[DemoChatMessage]]


class DemoSendMessage(BaseModel):
    conversation_id: str
    body: str
    mention_user_ids: list[str] = []
    attachments: list[DemoChatAttachment] = []


class DemoReadConversation(BaseModel):
    conversation_id: str


class DemoGroupMembersUpdate(BaseModel):
    member_user_ids: list[str]
