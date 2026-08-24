"""WS endpoints (B33): JWT-verified channels bridging RealtimeService queues."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.core.security import TokenInvalid, decode_access_token
from app.models import Role
from app.services.realtime_service import realtime
from app.ws.manager import manager

router = APIRouter()


async def _authenticate(token: str | None) -> tuple[int, str]:
    if not token:
        raise TokenInvalid()
    payload = decode_access_token(token)
    return int(payload["sub"]), payload.get("role", Role.USER)


async def _pump(queue: asyncio.Queue, ws: WebSocket) -> None:
    """Forwards queued envelopes from services to this socket."""
    while True:
        envelope = await queue.get()
        if envelope is None:
            break
        await ws.send_json(envelope)


async def _handle_client(ws: WebSocket, channel: str) -> None:
    try:
        user_id, role = await _authenticate(ws.query_params.get("token"))
    except Exception:
        await ws.close(code=4401)
        return

    # Bind the running loop so service threads can deliver into queues.
    realtime.bind_loop(asyncio.get_running_loop())

    queue = realtime.subscribe(channel)
    await manager.connect(channel, ws)
    pump_task = asyncio.create_task(_pump(queue, ws))
    try:
        while True:
            msg = await ws.receive_json()
            action = msg.get("action")
            if action == "ping":
                await ws.send_json({"action": "pong"})
            elif action == "unsubscribe_communication":
                break
    except WebSocketDisconnect:
        pass
    finally:
        pump_task.cancel()
        realtime.unsubscribe(channel, queue)
        manager.disconnect(channel, ws)


@router.websocket("/ws/user/events")
async def ws_user_events(ws: WebSocket, token: str | None = Query(default=None)):
    role_ok = True
    try:
        _, role = await _authenticate(token)
        role_ok = role in (Role.USER, Role.ADMIN)
    except Exception:
        role_ok = False
    if not role_ok:
        await ws.close(code=4401)
        return
    await _handle_client(ws, "user")


@router.websocket("/ws/eve/events")
async def ws_eve_events(ws: WebSocket, token: str | None = Query(default=None)):
    try:
        _, role = await _authenticate(token)
        if role != Role.ATTACKER:
            await ws.close(code=4403)
            return
    except Exception:
        await ws.close(code=4401)
        return
    await _handle_client(ws, "eve")


@router.websocket("/ws/admin/events")
async def ws_admin_events(ws: WebSocket, token: str | None = Query(default=None)):
    try:
        _, role = await _authenticate(token)
        if role != Role.ADMIN:
            await ws.close(code=4403)
            return
    except Exception:
        await ws.close(code=4401)
        return
    await _handle_client(ws, "admin")


@router.websocket("/ws/communications/{communication_id}")
async def ws_communication(
    ws: WebSocket,
    communication_id: int,
    token: str | None = Query(default=None),
):
    from app.db.session import session_scope
    from app.models import CommunicationSession

    try:
        user_id, role = await _authenticate(token)
    except Exception:
        await ws.close(code=4401)
        return

    with session_scope() as session:
        comm = session.get(CommunicationSession, communication_id)
        if comm is None:
            await ws.close(code=4404)
            return
        allowed = user_id in (comm.sender_id, comm.receiver_id) or role == Role.ADMIN
    if not allowed:
        await ws.close(code=4403)
        return

    channel = f"comm:{communication_id}"
    queue = realtime.subscribe(channel)
    await manager.connect(channel, ws)
    pump_task = asyncio.create_task(_pump(queue, ws))
    try:
        while True:
            msg = await ws.receive_json()
            if msg.get("action") == "ping":
                await ws.send_json({"action": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        pump_task.cancel()
        realtime.unsubscribe(channel, queue)
        manager.disconnect(channel, ws)
