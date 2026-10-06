"""Runtime trace (STEP 18): the FULL auth lifecycle, per role.

For USER, ATTACKER and ADMIN this walks the exact production sequence:

  LOGIN -> token used for API + WS -> token EXPIRES -> WS handshake rejected
  as 4401 -> REST answers 401 TOKEN_INVALID -> REFRESH -> NEW pair -> dashboards
  recover -> WS reconnects with the NEWEST access token -> /auth/me returns the
  backend-verified role.

No frontend code runs here: this proves the contract the client relies on.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
import pytest
from sqlalchemy import text
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from tests.conftest import login, register_user

ROLE_CASES = [
    ("USER", "user/events", "/api/v1/dashboard/summary"),
    ("ATTACKER", "eve/events", "/api/v1/eve/dashboard/summary"),
    ("ADMIN", "admin/events", "/api/v1/admin/dashboard/summary"),
]


def _set_role(email: str, role: str) -> None:
    from app.db.session import get_engine

    with get_engine().begin() as conn:
        conn.execute(text("UPDATE users SET role=:r WHERE email=:e"), {"r": role, "e": email})


def _expired_access_token(user_id: int, role: str) -> str:
    from app.core.config import settings

    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": str(user_id),
            "role": role,
            "type": "access",
            "jti": "runtime-trace-expired",
            "iat": int((now - timedelta(hours=1)).timestamp()),
            "exp": int((now - timedelta(minutes=30)).timestamp()),
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def _bearer(tokens) -> dict:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


@pytest.mark.parametrize("role,channel,dashboard", ROLE_CASES)
async def test_full_auth_lifecycle_per_role(client, role, channel, dashboard):
    from app.main import create_app

    tag = role.lower()
    user, creds = await register_user(client, f"Trace{role}", f"trace.{tag}@test.io")
    if role != "USER":
        _set_role(creds["email"], role)

    # 1) LOGIN -> fresh pair; the role travels in the access-token claims.
    tokens = await login(client, creds)
    assert tokens["access_token"] and tokens["refresh_token"]
    me = await client.get("/api/v1/auth/me", headers=_bearer(tokens))
    assert me.status_code == 200
    assert me.json()["user"]["role"] == role

    # 2) Authenticated REST call works with the access token.
    assert (await client.get(dashboard, headers=_bearer(tokens))).status_code == 200

    expired_token = _expired_access_token(user["id"], role)

    app = create_app()
    with TestClient(app) as tc:
        # 3) WS handshake with a VALID token succeeds.
        with tc.websocket_connect(f"/ws/{channel}?token={tokens['access_token']}") as ws:
            ws.send_json({"action": "ping"})
            assert ws.receive_json()["action"] == "pong"

        # 4) EXPIRY: an expired token is rejected with 4401 (never HTTP 403).
        with pytest.raises(WebSocketDisconnect) as expired:
            with tc.websocket_connect(f"/ws/{channel}?token={expired_token}") as ws:
                ws.receive_json()
        assert expired.value.code == 4401

        # 5) Expired REST call -> 401 TOKEN_INVALID (what the client refreshes on).
        expired_api = await client.get(dashboard, headers={"Authorization": f"Bearer {expired_token}"})
        assert expired_api.status_code == 401
        assert expired_api.json()["code"] == "TOKEN_INVALID"

        # 6) REFRESH with the CURRENT refresh token -> brand-new pair.
        refreshed = await client.post(
            "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        )
        assert refreshed.status_code == 200
        new_pair = refreshed.json()
        assert new_pair["access_token"] != tokens["access_token"]
        assert new_pair["refresh_token"] != tokens["refresh_token"]

        # 7) Dashboards recover immediately with the rotated access token.
        recovered = await client.get(dashboard, headers=_bearer(new_pair))
        assert recovered.status_code == 200

        # 8) WS reconnects with the NEWEST access token.
        with tc.websocket_connect(f"/ws/{channel}?token={new_pair['access_token']}") as ws:
            ws.send_json({"action": "ping"})
            assert ws.receive_json()["action"] == "pong"

    # 9) The rotated refresh token keeps working; the spent one never does again.
    second = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": new_pair["refresh_token"]}
    )
    assert second.status_code == 200
    replay = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert replay.status_code == 401
    assert replay.json()["code"] == "TOKEN_REUSED"


async def test_role_isolation_is_preserved(client):
    """STEP 7: the fix must not have weakened role authorization anywhere."""
    from app.main import create_app

    _, user_creds = await register_user(client, "PermUser", "perm.user@test.io")
    user_tokens = await login(client, user_creds)

    _, eve_creds = await register_user(client, "PermEve", "perm.eve@test.io")
    _set_role(eve_creds["email"], "ATTACKER")
    eve_tokens = await login(client, eve_creds)

    _, admin_creds = await register_user(client, "PermAdmin", "perm.admin@test.io")
    _set_role(admin_creds["email"], "ADMIN")
    admin_tokens = await login(client, admin_creds)

    # USER: own dashboard yes, EVE/ADMIN surfaces no.
    assert (await client.get("/api/v1/dashboard/summary", headers=_bearer(user_tokens))).status_code == 200
    assert (await client.get("/api/v1/eve/dashboard/summary", headers=_bearer(user_tokens))).status_code == 403
    assert (await client.get("/api/v1/admin/dashboard/summary", headers=_bearer(user_tokens))).status_code == 403

    # EVE: attacker dashboard yes, admin surfaces no.
    assert (await client.get("/api/v1/eve/dashboard/summary", headers=_bearer(eve_tokens))).status_code == 200
    assert (await client.get("/api/v1/admin/dashboard/summary", headers=_bearer(eve_tokens))).status_code == 403

    # ADMIN: administrative surfaces yes.
    assert (await client.get("/api/v1/admin/dashboard/summary", headers=_bearer(admin_tokens))).status_code == 200

    # Wrong-role WebSocket channels stay closed with 4403.
    app = create_app()
    with TestClient(app) as tc:
        for channel, tokens in (("eve/events", user_tokens), ("admin/events", eve_tokens)):
            with pytest.raises(WebSocketDisconnect) as denied:
                with tc.websocket_connect(f"/ws/{channel}?token={tokens['access_token']}") as ws:
                    ws.receive_json()
            assert denied.value.code == 4403