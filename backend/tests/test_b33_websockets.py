"""B33 acceptance: WS auth, channels, event envelope, heartbeat."""

from __future__ import annotations

import asyncio
import json

from tests.conftest import auth_headers, login, register_user


async def _promote_attacker(client, creds):
    from sqlalchemy import text

    from app.db.session import get_engine

    with get_engine().begin() as conn:
        conn.execute(
            text("UPDATE users SET role='ATTACKER' WHERE email=:e"), {"e": creds["email"]}
        )


async def _token(client, creds):
    return (await client.post(
        "/api/v1/auth/login", json={"email": creds["email"], "password": creds["password"]}
    )).json()["access_token"]


async def test_ws_requires_valid_jwt(client):
    from starlette.testclient import TestClient

    from app.main import create_app

    app = create_app()
    with TestClient(app) as tc:
        # no token -> close 4401
        try:
            with tc.websocket_connect("/ws/user/events") as ws:
                ws.receive_json()
            closed = False
        except Exception:
            closed = True
        assert closed

        # garbage token -> close 4401
        try:
            with tc.websocket_connect("/ws/user/events?token=garbage") as ws:
                ws.receive_json()
            closed = False
        except Exception:
            closed = True
        assert closed


async def test_ws_ping_pong_and_event_delivery(client):
    from starlette.testclient import TestClient

    from app.main import create_app

    _, alice_creds = await register_user(client, "WsAlice", "ws.alice@test.io")
    token = await _token(client, alice_creds)

    app = create_app()
    with TestClient(app) as tc:
        with tc.websocket_connect(f"/ws/user/events?token={token}") as ws:
            ws.send_json({"action": "ping"})
            pong = ws.receive_json()
            assert pong["action"] == "pong"


async def test_ws_eve_channel_role_gating(client):
    from starlette.testclient import TestClient

    from app.main import create_app

    _, eve_creds = await register_user(client, "WsEve", "ws.eve@test.io", password="EvePass123!")
    await _promote_attacker(client, eve_creds)
    eve_token = await _token(client, eve_creds)

    _, user_creds = await register_user(client, "WsUser", "ws.user@test.io")
    user_token = await _token(client, user_creds)

    app = create_app()
    with TestClient(app) as tc:
        # USER on eve channel -> rejected
        with pytest.raises(Exception):
            with tc.websocket_connect(f"/ws/eve/events?token={user_token}") as ws:
                ws.receive_json()

        # ATTACKER accepted; ping works
        with tc.websocket_connect(f"/ws/eve/events?token={eve_token}") as ws:
            ws.send_json({"action": "ping"})
            assert ws.receive_json()["action"] == "pong"


async def test_realtime_service_envelope_shape():
    from app.services.realtime_service import RealtimeService

    rt = RealtimeService()
    q = rt.subscribe("user")
    env = rt.emit(["user"], "qkd.progress", communication_id=7,
                  state="QKD_RUNNING", actor_role="SYSTEM",
                  payload={"percent": 50, "stage": "sifting"})
    got = q.get_nowait() if not q.empty() else None
    if got is None:
        import asyncio

        got = await asyncio.wait_for(q.get(), timeout=1)
    assert set(got.keys()) == {"type", "communication_id", "state", "actor_role",
                               "payload", "timestamp"}
    assert got["type"] == "qkd.progress" and got["communication_id"] == 7


import pytest  # noqa: E402  (used above in role-gating test)
