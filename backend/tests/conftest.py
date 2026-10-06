"""Shared pytest fixtures.

A single temp SQLite DB backs the whole run; every table is truncated between
tests so each test starts from a clean, isolated state.
"""

from __future__ import annotations

import os
import tempfile

import pytest

_TMP_DIR = tempfile.mkdtemp(prefix="qsc_test_")
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP_DIR.replace(os.sep, '/')}/qsc_test.db"
os.environ["QSC_MASTER_KEY"] = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="  # 32 bytes b64
os.environ["JWT_SECRET_KEY"] = "test-secret-key-not-for-production"
os.environ.pop("ENABLE_ADMIN_BOOTSTRAP", None)
# Tests run the synchronous pipeline by default (individual tests opt into
# async mode explicitly); this keeps the suite deterministic no matter what a
# developer's local .env contains for the live-demo flag.
os.environ["PROCESS_ASYNC"] = "false"
# Generous limits for functional tests; B35 has a dedicated limiting test.
os.environ["RATE_LIMIT_ATTACK_PER_MIN"] = "1000"
os.environ["RATE_LIMIT_SEARCH_PER_MIN"] = "1000"
os.environ["RATE_LIMIT_AUTH_PER_MIN"] = "1000"

from sqlalchemy import text  # noqa: E402

import app.models  # noqa: E402,F401
from app.db.base import Base  # noqa: E402


PROTOCOL_SEEDS = [
    ("BB84", True, {"noise_resistance": 0.55, "key_efficiency": 0.90, "max_distance_km": 100, "maturity": 1.0}),
    ("B92", False, {"noise_resistance": 0.50, "key_efficiency": 0.25, "max_distance_km": 80, "maturity": 0.7}),
    ("E91", False, {"noise_resistance": 0.70, "key_efficiency": 0.50, "max_distance_km": 150, "maturity": 0.5}),
    ("SIX_STATE", False, {"noise_resistance": 0.75, "key_efficiency": 0.30, "max_distance_km": 90, "maturity": 0.6}),
    ("SARG04", False, {"noise_resistance": 0.60, "key_efficiency": 0.40, "max_distance_km": 85, "maturity": 0.6}),
    ("DECOY_BB84", False, {"noise_resistance": 0.65, "key_efficiency": 0.70, "max_distance_km": 120, "maturity": 0.8}),
]

THRESHOLDS = {"BB84": 0.11, "B92": 0.11, "E91": 0.12, "SIX_STATE": 0.13,
              "SARG04": 0.11, "DECOY_BB84": 0.10}


@pytest.fixture(scope="session", autouse=True)
def _create_schema():
    from app.db.session import get_engine

    engine = get_engine()
    Base.metadata.create_all(engine)
    # Seed protocol_configs once (mirrors alembic revision 0002_seeds).
    from sqlalchemy import text
    from datetime import datetime, timezone

    with engine.begin() as conn:
        for name, enabled, params in PROTOCOL_SEEDS:
            exists = conn.execute(
                text("SELECT id FROM protocol_configs WHERE protocol = :p"), {"p": name}
            ).first()
            if not exists:
                conn.execute(
                    text(
                        "INSERT INTO protocol_configs "
                        "(protocol, enabled, default_threshold, max_qubits, parameters, created_at) "
                        "VALUES (:p, :e, :t, :q, :par, :c)"
                    ),
                    {
                        "p": name, "e": enabled, "t": THRESHOLDS[name], "q": 256,
                        "par": str(params).replace("'", '"'),
                        "c": datetime.now(timezone.utc),
                    },
                )
    yield
    try:
        os.remove(_TMP_DIR.replace(os.sep, "/") + "/qsc_test.db")
    except OSError:
        pass


TABLES = [
    "secret_keys",
    "ai_recommendations",
    "security_reports",
    "attacks",
    "qkd_sessions",
    "messages",
    "communication_sessions",
    "audit_logs",
    "refresh_tokens",
    "users",
    # NOTE: protocol_configs is reference configuration seeded once per
    # session and intentionally NOT truncated between tests.
]


@pytest.fixture(autouse=True)
def _clean_tables():
    yield
    # Reset the in-process rate limiter so per-test requests start clean.
    from app.core.ratelimit import backend as rl_backend

    rl_backend.reset()
    from app.db.session import get_engine

    with get_engine().begin() as conn:
        for t in TABLES:
            conn.execute(text(f"DELETE FROM {t}"))


@pytest.fixture()
def in_memory_db():
    """Fresh SQLite DB per test; yields a session_scope-like factory."""
    import tempfile

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    url = f"sqlite:///{tempfile.mkdtemp(prefix='qsc_unit_').replace(os.sep, '/')}/u.db"
    eng = create_engine(url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(eng)
    factory = sessionmaker(bind=eng, expire_on_commit=False)

    from contextlib import contextmanager

    @contextmanager
    def scope():
        s = factory()
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()

    scope.engine = eng  # type: ignore[attr-defined]
    yield scope
    eng.dispose()


@pytest.fixture()
async def client():
    from httpx import ASGITransport, AsyncClient

    from app.main import create_app

    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac


# ---- helper factories --------------------------------------------------------


async def register_user(client, name="Alice", email=None, password="Str0ngPass!x"):
    email = email or f"{name.lower()}{id(client) & 0xffff}@test.io"
    resp = await client.post(
        "/api/v1/auth/register",
        json={"name": name, "email": email, "password": password},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["user"], {"email": email, "password": password}


async def login(client, creds):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": creds["email"], "password": creds["password"]},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def auth_headers(tokens):
    return {"Authorization": f"Bearer {tokens['access_token']}"}

