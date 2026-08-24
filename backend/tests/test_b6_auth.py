"""B6 acceptance: full auth API — register, login, me, refresh, logout."""

from __future__ import annotations

import re

import pytest

from tests.conftest import auth_headers, login, register_user

QSC_RE = re.compile(r"^QSC-[A-Z0-9]{10}$")


async def test_register_success(client):
    user, _ = await register_user(client, "Alice", "alice.b6@test.io")
    assert QSC_RE.match(user["unique_user_id"])
    assert user["role"] == "USER"
    body = user
    assert set(body.keys()) == {"id", "name", "email", "unique_user_id", "role", "is_active", "created_at"}


async def test_register_duplicate_email_conflict(client):
    await register_user(client, "Dup", "dup.b6@test.io")
    resp = await client.post(
        "/api/v1/auth/register",
        json={"name": "Dup2", "email": "DUP.B6@test.io", "password": "Str0ngPass!x"},
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "EMAIL_TAKEN"


async def test_login_flow_and_me(client):
    _, creds = await register_user(client, "Bob", "bob.b6@test.io")
    tokens = await login(client, creds)
    assert tokens["token_type"] == "bearer"
    assert tokens["expires_in"] > 0

    resp = await client.get("/api/v1/auth/me", headers=auth_headers(tokens))
    assert resp.status_code == 200
    assert resp.json()["user"]["email"] == "bob.b6@test.io"


async def test_login_wrong_password_same_error(client):
    _, creds = await register_user(client, "Carol", "carol.b6@test.io")
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "carol.b6@test.io", "password": "WrongPassword!"},
    )
    assert resp.status_code == 401
    assert resp.json()["code"] == "INVALID_CREDENTIALS"

    # Unknown email must return the identical code (no enumeration).
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "nobody.b6@test.io", "password": "WrongPassword!"},
    )
    assert resp.status_code == 401
    assert resp.json()["code"] == "INVALID_CREDENTIALS"


async def test_refresh_rotation_and_reuse_detection(client):
    _, creds = await register_user(client, "Dave", "dave.b6@test.io")
    tokens = await login(client, creds)

    resp = await client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert resp.status_code == 200
    new_pair = resp.json()
    assert new_pair["access_token"] != tokens["access_token"]
    assert new_pair["refresh_token"] != tokens["refresh_token"]

    # Reusing the OLD (rotated) refresh token revokes the family.
    resp = await client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert resp.status_code == 401
    assert resp.json()["code"] == "TOKEN_REUSED"

    # The new token is also dead now (family revoked).
    resp = await client.post("/api/v1/auth/refresh", json={"refresh_token": new_pair["refresh_token"]})
    assert resp.status_code == 401


async def test_logout_revokes_refresh(client):
    _, creds = await register_user(client, "Eve", "logout.b6@test.io", password="AttackerPass1")
    tokens = await login(client, creds)
    resp = await client.post(
        "/api/v1/auth/logout", json={"refresh_token": tokens["refresh_token"]}, headers=auth_headers(tokens)
    )
    assert resp.status_code == 204
    resp = await client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert resp.status_code == 401


async def test_me_requires_token(client):
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 401
    assert resp.json()["code"] == "TOKEN_REQUIRED"


@pytest.mark.parametrize("payload", [
    {"name": "X", "email": "x@test.io", "password": "LongEnough1"},   # name too short
    {"name": "Valid Name", "email": "not-an-email", "password": "LongEnough1"},
    {"name": "Valid Name", "email": "v@test.io", "password": "short"},  # password < 8
])
async def test_register_validation_422(client, payload):
    resp = await client.post("/api/v1/auth/register", json=payload)
    assert resp.status_code == 422
