"""Realtime service skeleton (B1/B33): single event sink; WS wiring lands in B33."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any


class RealtimeService:
    """Buffers + fans out domain events to WebSocket channels.

    Services call emit() AFTER commit. Without connected sockets the events
    are dropped harmlessly (REST remains the source of truth).
    """

    def __init__(self) -> None:
        self._queues: dict[str, set[asyncio.Queue]] = defaultdict(set)
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self, channel: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        self._queues[channel].add(q)
        return q

    def unsubscribe(self, channel: str, queue: asyncio.Queue) -> None:
        self._queues[channel].discard(queue)

    def _deliver(self, channel: str, envelope: dict[str, Any]) -> None:
        for q in tuple(self._queues.get(channel, ())):
            try:
                q.put_nowait(envelope)
            except asyncio.QueueFull:
                pass

    def emit(
        self,
        channels: list[str],
        event_type: str,
        *,
        communication_id: int | None = None,
        state: str | None = None,
        actor_role: str = "SYSTEM",
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        envelope = {
            "type": event_type,
            "communication_id": communication_id,
            "state": state,
            "actor_role": actor_role,
            "payload": payload or {},
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        for channel in channels:
            if self._loop and self._loop.is_running():
                try:
                    self._loop.call_soon_threadsafe(self._deliver, channel, envelope)
                    continue
                except RuntimeError:
                    pass
            self._deliver(channel, envelope)
        return envelope

    @staticmethod
    def channels_for_roles(roles: set[str], communication_id: int | None = None) -> list[str]:
        """Audience routing rules per Section 16."""
        chans: list[str] = []
        if roles & {"USER"}:
            chans.append(f"user:{communication_id}" if communication_id else "user")
        if "ATTACKER" in roles:
            chans.append("eve")
        if "ADMIN" in roles:
            chans.append(f"admin:{communication_id}" if communication_id else "admin")
        if communication_id is not None:
            chans.append(f"comm:{communication_id}")
        return chans


realtime = RealtimeService()
