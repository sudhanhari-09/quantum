"""WS endpoints (B33): JWT-verified channels bridging RealtimeService queues.

Handshake contract (Section 20):
  * the access JWT is passed as ``?token=<jwt>`` and verified BEFORE any event
    is delivered;
  * failures are reported with app-level close codes 4401 (token missing /
    invalid / expired), 4403 (authenticated but wrong role) and 4404 (unknown
    resource).

IMPORTANT: the socket is ACCEPTED before it is closed. Closing before the
handshake completes (``close()`` without ``accept()``) makes the ASGI server
answer the upgrade with **HTTP 403 Forbidden**, which destroys the reason for
the rejection: every client then sees an opaque 403 and cannot tell an expired
token (refresh + retry) from a role denial (do not retry). Accepting first makes
4401/4403 visible to the browser ``CloseEvent``.

NOTE on logging (Section 33): WebSocket handshakes are logged in HTTP-style
format without exposing JWT tokens. Successful: ``INFO WS CONNECT /ws/user-events 101``.
Rejected: ``WARNING WS CONNECT /ws/eve-events 401`` or ``403`` depending on reason.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.core.logging import get_logger
from app.core.security import TokenInvalid, decode_access_token
from app.models import Role
from app.services.realtime_service import realtime
from app.ws.manager import manager

logger = get_logger(__name__)

router = APIRouter()

# App-level close codes (RFC 6455 only defines 1000-1015, so these are ours).
WS_CLOSE_UNAUTHORIZED = 4401
WS_CLOSE_FORBIDDEN = 4403
WS_CLOSE_NOT_FOUND = 4404


async def _authenticate(token: str | None) -> tuple[int, str]:
    """Decode the access JWT; FAIL-CLOSED when the role claim is unusable."""
    if not token:
        raise TokenInvalid("Missing WebSocket access token.")
    payload = decode_access_token(token)
    role = payload.get("role")
    if role not in Role.ALL:
        # Never default to USER when a claim is missing or unknown.
        raise TokenInvalid("Access token carries no valid role claim.")
    return int(payload["sub"]), role


async def _reject(ws: WebSocket, channel: str, code: int, reason: str) -> None:
    """Accept the handshake, then close with ``code`` (the client contract).

    No payload is sent before closing: the close code IS the contract, and any
    frame would make ``receive()`` succeed instead of surfacing the rejection.
    """
    # Log the rejection WITHOUT exposing the token. Use the channel name to
    # construct the WS path without query parameters.
    logger.info("ws.rejected channel=%s close_code=%s reason=%s", channel, code, reason)
    try:
        await ws.accept()
    except Exception:  # pragma: no cover - client vanished mid-handshake
        return
    try:
        await ws.close(code=code, reason=reason[:120])
    except Exception:
        pass


async def _authorize(
    ws: WebSocket,
    channel: str,
    token: str | None,
    allowed_roles: tuple[str, ...],
) -> tuple[int, str] | None:
    """Single authentication + role check shared by every channel."""
    try:
        user_id, role = await _authenticate(token)
    except TokenInvalid as exc:
        # Log the CODE only — never the token itself.
        # Use the actual WS path for the channel (no token query param).
        path_map = {
            "user/events": "/ws/user-events",
            "eve/events": "/ws/eve-events",
            "admin/events": "/ws/admin-events",
        }
        ws_path = path_map.get(channel, channel)
        logger.info("ws.auth_failed %s code=%s", ws_path, exc.code)
        await _reject(ws, channel, WS_CLOSE_UNAUTHORIZED, "access token invalid or expired")
        return None
    except Exception:  # pragma: no cover - defensive
        path_map = {
            "user/events": "/ws/user-events",
            "eve/events": "/ws/eve-events",
            "admin/events": "/ws/admin-events",
        }
        ws_path = path_map.get(channel, channel)
        logger.warning("ws.auth_failed %s code=UNEXPECTED", ws_path)
        await _reject(ws, channel, WS_CLOSE_UNAUTHORIZED, "access token invalid or expired")
        return None

    if role not in allowed_roles:
        path_map = {
            "user/events": "/ws/user-events",
            "eve/events": "/ws/eve-events",
            "admin/events": "/ws/admin-events",
        }
        ws_path = path_map.get(channel, channel)
        logger.info("ws.role_denied %s role=%s", ws_path, role)
        await _reject(ws, channel, WS_CLOSE_FORBIDDEN, "role not permitted for this channel")
        return None
    return user_id, role


async def _pump(queue: asyncio.Queue, ws: WebSocket) -> None:
    """Forwards queued envelopes from services to this socket."""
    while True:
        envelope = await queue.get()
        if envelope is None:
            break
        await ws.send_json(envelope)


async def _handle_client(ws: WebSocket, channel: str, identity: tuple[int, str]) -> None:
    """Serve an already-authenticated socket (no second JWT verification)."""
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
    except Exception as exc:  # malformed frames must not raise into the server
        logger.info(
            "ws.recv_stopped channel=%s user_id=%s error=%s",
            channel,
            identity[0],
            type(exc).__name__,
        )
    finally:
        pump_task.cancel()
        realtime.unsubscribe(channel, queue)
        manager.disconnect(channel, ws)


@router.websocket("/ws/user/events")
async def ws_user_events(ws: WebSocket, token: str | None = Query(default=None)):
    identity = await _authorize(ws, "user/events", token, (Role.USER, Role.ADMIN))
    if identity is None:
        return
    # Successful handshake: log WS CONNECT without token
    logger.info("WS CONNECT /ws/user-events 101")
    await _handle_client(ws, "user", identity)


@router.websocket("/ws/eve/events")
async def ws_eve_events(ws: WebSocket, token: str | None = Query(default=None)):
    identity = await _authorize(ws, "eve/events", token, (Role.ATTACKER,))
    if identity is None:
        return
    # Successful handshake: log WS CONNECT without token
    logger.info("WS CONNECT /ws/eve-events 101")
    await _handle_client(ws, "eve", identity)


@router.websocket("/ws/admin/events")
async def ws_admin_events(ws: WebSocket, token: str | None = Query(default=None)):
    identity = await _authorize(ws, "admin/events", token, (Role.ADMIN,))
    if identity is None:
        return
    # Successful handshake: log WS CONNECT without token
    logger.info("WS CONNECT /ws/admin-events 101")
    await _handle_client(ws, "admin", identity)


@router.websocket("/ws/communications/{communication_id}")
async def ws_communication(
    ws: WebSocket,
    communication_id: int,
    token: str | None = Query(default=None),
):
    from app.db.session import session_scope
    from app.models import CommunicationSession

    identity = await _authorize(
        ws, f"comm:{communication_id}", token, (Role.USER, Role.ATTACKER, Role.ADMIN)
    )
    if identity is None:
        return
    user_id, role = identity

    with session_scope() as session:
        comm = session.get(CommunicationSession, communication_id)
        if comm is None:
            logger.info("ws.not_found channel=comm:%s", communication_id)
            await _reject(
                ws, f"comm:{communication_id}", WS_CLOSE_NOT_FOUND, "unknown communication"
            )
            return
        allowed = user_id in (comm.sender_id, comm.receiver_id) or role == Role.ADMIN
    if not allowed:
        logger.info("ws.participant_denied channel=comm:%s user_id=%s", communication_id, user_id)
        await _reject(
            ws, f"comm:{communication_id}", WS_CLOSE_FORBIDDEN, "not a session participant"
        )
        return

    await _handle_client(ws, f"comm:{communication_id}", identity)
