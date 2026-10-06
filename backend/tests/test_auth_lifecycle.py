"""Acceptance: refresh-token lifecycle + WebSocket authentication contract.

Covers the production problems this change set fixes:
  * an expired/invalid WS token must surface as app-level close code 4401
    (NOT as an HTTP 403 handshake rejection) so clients can refresh and retry;
  * a wrong role must surface as 4403 and never be retried;
  * rotation keeps exactly ONE active refresh token per user;
  * concurrent refreshes can never mint two successors from one token.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from tests.conftest import login, register_user


def _expired_access_token(user_id: int, role: str = "USER") -> str:
    """A structurally valid but expired access JWT (no monkeypatching needed)."""
    from app.core.config import settings

    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "role": role,
        "type": "access",
        "jti": "expired-token",
        "iat": int((now - timedelta(minutes=10)).timestamp()),
        "exp": int((now - timedelta(minutes=5)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def _promote_attacker(email: str) -> None:
    from sqlalchemy import text

    from app.db.session import get_engine

    with get_engine().begin() as conn:
        conn.execute(text("UPDATE users SET role='ATTACKER' WHERE email=:e"), {"e": email})


async def test_ws_expired_token_closes_4401_not_http_403(client):
    from app.main import create_app

    user, _ = await register_user(client, "WsExpired", "ws.expired@test.io")
    token = _expired_access_token(user["id"])

    app = create_app()
    with TestClient(app) as tc:
        # The handshake is ACCEPTED (no HTTP 403) and then closed with 4401, so
        # the browser CloseEvent carries the real reason.
        with pytest.raises(WebSocketDisconnect) as info:
            with tc.websocket_connect(f"/ws/user/events?token={token}") as ws:
                ws.receive_json()
    assert info.value.code == 4401
    assert "invalid or expired" in (info.value.reason or "")


async def test_ws_missing_token_closes_4401(client):
    from app.main import create_app

    app = create_app()
    with TestClient(app) as tc:
        with pytest.raises(WebSocketDisconnect) as info:
            with tc.websocket_connect("/ws/eve/events") as ws:
                ws.receive_json()
    assert info.value.code == 4401


async def test_ws_role_denied_closes_4403(client):
    from app.main import create_app

    user, creds = await register_user(client, "WsPlain", "ws.plain@test.io")
    assert user["role"] == "USER"
    _promote_attacker(creds["email"])  # attacker only sees /ws/eve/events
    # Re-login AFTER promotion: the role travels in the access token's claims.
    tokens = await login(client, creds)

    app = create_app()
    with TestClient(app) as tc:
        # ATTACKER token on the admin channel -> 4403 (never 403 at handshake).
        with pytest.raises(WebSocketDisconnect) as info:
            with tc.websocket_connect(
                f"/ws/admin/events?token={tokens['access_token']}"
            ) as ws:
                ws.receive_json()
        assert info.value.code == 4403
        # The attacker channel itself still works for the promoted role.
        with tc.websocket_connect(f"/ws/eve/events?token={tokens['access_token']}") as ws:
            ws.send_json({"action": "ping"})
            assert ws.receive_json()["action"] == "pong"


async def test_rotation_keeps_exactly_one_active_token(client):
    from sqlalchemy import text

    from app.db.session import get_engine

    _, creds = await register_user(client, "Rotate", "rotate.one@test.io")
    tokens = await login(client, creds)
    user_id = tokens["user"]["id"]

    resp = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert resp.status_code == 200
    rotated = resp.json()
    assert rotated["refresh_token"] != tokens["refresh_token"]
    assert rotated["access_token"] != tokens["access_token"]

    with get_engine().begin() as conn:
        rows = conn.execute(
            text(
                "SELECT token_hash, revoked_at FROM refresh_tokens "
                "WHERE user_id = :u ORDER BY id"
            ),
            {"u": user_id},
        ).all()

    active = [row for row in rows if row.revoked_at is None]
    assert len(rows) == 2
    assert len(active) == 1, "rotation must leave exactly one usable refresh token"

    # The newest token still refreshes; the consumed one is dead.
    again = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": rotated["refresh_token"]}
    )
    assert again.status_code == 200
    replay = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert replay.status_code == 401
    assert replay.json()["code"] == "TOKEN_REUSED"


async def test_concurrent_refresh_never_issues_two_successors(client):
    _, creds = await register_user(client, "Race", "race.rotate@test.io")
    tokens = await login(client, creds)
    body = {"refresh_token": tokens["refresh_token"]}

    responses = await asyncio.gather(
        *[client.post("/api/v1/auth/refresh", json=body) for _ in range(3)]
    )
    statuses = [r.status_code for r in responses]

    # Atomic compare-and-swap rotation: at most ONE request can consume it.
    assert statuses.count(200) <= 1, statuses
    for response in responses:
        if response.status_code == 401:
            assert response.json()["code"] in ("TOKEN_REUSED", "TOKEN_INVALID")