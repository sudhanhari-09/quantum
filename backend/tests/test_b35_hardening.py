"""B35 acceptance: rate limiting, security headers, no key leakage."""

from __future__ import annotations

from tests.conftest import auth_headers, register_user


def test_rate_limiter_blocks_after_limit(monkeypatch):
    from app.core.ratelimit import backend

    monkeypatch.setenv("RATE_LIMIT_AUTH_PER_MIN", "2")
    from app.core.config import get_settings

    get_settings.cache_clear()
    try:
        # Simulate three rapid hits on the same identity.
        key = ("auth", "user:999")
        assert backend.hit(key, _limit("rate_limit_auth_per_min")) is True
        assert backend.hit(key, _limit("rate_limit_auth_per_min")) is True
        assert backend.hit(key, _limit("rate_limit_auth_per_min")) is False
    finally:
        get_settings.cache_clear()
        backend.reset()


def _limit(attr: str) -> int:
    from app.core.config import get_settings

    return int(getattr(get_settings(), attr))


async def test_auth_rate_limit_429_over_http(client, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_AUTH_PER_MIN", "2")
    from app.core.config import get_settings

    get_settings.cache_clear()
    try:
        codes = []
        for i in range(3):
            resp = await client.post(
                "/api/v1/auth/register",
                json={"name": f"RL User {i}", "email": f"rl{i}@test.io",
                      "password": "Str0ngPass!x"},
            )
            codes.append(resp.status_code)
        assert codes[:2] == [201, 201]
        assert codes[2] == 429
        assert (await client.post(
            "/api/v1/auth/register",
            json={"name": "RL X", "email": "rlx@test.io", "password": "Str0ngPass!x"},
        )).json()["code"] == "RATE_LIMITED"
    finally:
        get_settings.cache_clear()


async def test_security_headers_present(client):
    resp = await client.get("/api/v1/health")
    # Clickjacking + content-type nosniff + referrer policy (S23).
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"
    assert resp.headers.get("X-Frame-Options") in ("DENY", "SAMEORIGIN")
    assert "frame-ancestors" in resp.headers.get("Content-Security-Policy", "")
    assert resp.headers.get("Referrer-Policy") in ("no-referrer", "strict-origin-when-cross-origin")


async def test_no_key_material_in_any_response(client):
    """S19/S10 grep-style test across a delivered communication."""
    alice_user, alice_creds = await register_user(client, "Alice", "alice.s19@test.io")
    bob_user, bob_creds = await register_user(client, "Bob", "bob.s19@test.io")
    atok = await login_tokens(client, alice_creds)
    btok = await login_tokens(client, bob_creds)

    created = (
        await client.post(
            "/api/v1/messages",
            json={"receiver_qsc_id": bob_user["unique_user_id"], "content": "grep me"},
            headers=auth_headers(atok),
        )
    ).json()

    endpoints = [
        f"/api/v1/communications/{created['communication_id']}",
        f"/api/v1/communications/{created['communication_id']}/qkd",
        f"/api/v1/communications/{created['communication_id']}/security",
        f"/api/v1/communications/{created['communication_id']}/recommendation",
        f"/api/v1/messages/{created['message_id']}",
        f"/api/v1/messages/{created['message_id']}/security-report",
        "/api/v1/messages/inbox",
        "/api/v1/messages/sent",
        "/api/v1/protocols",
    ]
    forbidden_markers = ("key_enc", "sifted_key", "secret_key", "master_key",
                         "jwt_secret", "password_hash")
    for ep in endpoints:
        body = str((await client.get(ep, headers=auth_headers(atok))).json()).lower()
        for marker in forbidden_markers:
            assert marker not in body, f"{marker} leaked via {ep}"


async def login_tokens(client, creds):
    resp = await client.post(
        "/api/v1/auth/login", json={"email": creds["email"], "password": creds["password"]}
    )
    return resp.json()
