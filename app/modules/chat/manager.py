import json
import time
from collections import defaultdict

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self.direct_connections: dict[int, set[WebSocket]] = defaultdict(set)
        self.group_connections: dict[int, set[WebSocket]] = defaultdict(set)
        self.last_seen: dict[int, float] = {}

    async def connect_user(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self.direct_connections[user_id].add(websocket)
        self.touch_user(user_id)

    def disconnect_user(self, user_id: int, websocket: WebSocket) -> None:
        self.direct_connections[user_id].discard(websocket)

    async def connect_group(self, group_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self.group_connections[group_id].add(websocket)

    def disconnect_group(self, group_id: int, websocket: WebSocket) -> None:
        self.group_connections[group_id].discard(websocket)

    async def send_user(self, user_id: int, payload: dict) -> None:
        await self._send_many(self.direct_connections[user_id], payload)

    async def send_group(self, group_id: int, payload: dict) -> None:
        await self._send_many(self.group_connections[group_id], payload)

    async def _send_many(self, websockets: set[WebSocket], payload: dict) -> None:
        message = json.dumps(payload)
        stale: list[WebSocket] = []
        for websocket in websockets:
            try:
                await websocket.send_text(message)
            except RuntimeError:
                stale.append(websocket)
        for websocket in stale:
            websockets.discard(websocket)

    def touch_user(self, user_id: int) -> None:
        self.last_seen[user_id] = time.time()

    def online_user_ids(self, window_seconds: int = 45) -> list[int]:
        now = time.time()
        return [user_id for user_id, seen_at in self.last_seen.items() if now - seen_at <= window_seconds]


connection_manager = ConnectionManager()
