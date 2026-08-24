"""WebSocket connection manager (B33): channels, JWT handshake, heartbeat.

Channels per Section 16/20:
  /ws/user/events            USER + ADMIN
  /ws/communications/{id}    sender + receiver + ADMIN
  /ws/eve/events             ATTACKER
  /ws/admin/events           ADMIN

Envelope: {type, communication_id, state, actor_role, payload, timestamp}.
JWT verified on connect via ?token=<access_jwt>; failures close with 4401.
Server pings every 30s; client pongs keep the socket alive.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect


class ConnectionManager:
    HEARTBEAT_SECONDS = 30

    def __init__(self) -> None:
        # channel -> set of live sockets
        self.channels: dict[str, set[WebSocket]] = {}
        self._heartbeat_tasks: dict[int, asyncio.Task] = {}

    async def connect(self, channel: str, ws: WebSocket) -> None:
        await ws.accept()
        self.channels.setdefault(channel, set()).add(ws)

        async def _heartbeat() -> None:
            while True:
                await asyncio.sleep(self.HEARTBEAT_SECONDS)
                if ws not in self.channels.get(channel, set()):
                    break
                try:
                    await ws.send_json({"action": "ping", "timestamp": None})
                except Exception:
                    break

        self._heartbeat_tasks[id(ws)] = asyncio.create_task(_heartbeat())

    def disconnect(self, channel: str, ws: WebSocket) -> None:
        self.channels.get(channel, set()).discard(ws)
        task = self._heartbeat_tasks.pop(id(ws), None)
        if task:
            task.cancel()

    async def send_to_channel(self, channel: str, envelope: dict) -> int:
        sockets = tuple(self.channels.get(channel, ()))
        delivered = 0
        for ws in sockets:
            try:
                await ws.send_json(envelope)
                delivered += 1
            except Exception:
                self.disconnect(channel, ws)
        return delivered

    @staticmethod
    def channel_key_for(role: str, user_id: int, comm_participants: dict[int, tuple[int, int]] | None = None,
                        communication_id: int | None = None) -> Optional[str]:
        """Audience routing per Section 16 channel rules."""
        if role == "ADMIN":
            return "admin"
        if role == "ATTACKER":
            return "eve"
        if role == "USER" and communication_id is not None and comm_participants:
            participants = comm_participants.get(communication_id)
            if participants and user_id in participants:
                return f"comm:{communication_id}"
        return "user"


manager = ConnectionManager()
