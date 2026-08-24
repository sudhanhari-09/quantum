"""B2 acceptance: settings parse, prod guards, master-key validation."""

from __future__ import annotations

import base64
import os

import pytest


def _make_env(tmp_path, **overrides):
    values = {
        "QSC_ENV": "dev",
        "JWT_SECRET_KEY": "dev-only-secret-key-change-me",
        "DATABASE_URL": "sqlite:///./qsc.db",
        "QSC_MASTER_KEY": base64.b64encode(b"x" * 32).decode(),
    }
    values.update(overrides)
    env_file = tmp_path / ".env"
    env_file.write_text("\n".join(f"{k}={v}" for k, v in values.items()), encoding="utf-8")
    return str(env_file)


def _load(env_file, monkeypatch=None):
    from app.core.config import Settings

    if monkeypatch is not None:
        # Env vars (set by conftest) take precedence over dotenv values;
        # remove them so the fixture .env file is authoritative.
        for var in ("DATABASE_URL", "QSC_ENV", "JWT_SECRET_KEY", "QSC_MASTER_KEY",
                    "ENABLE_ADMIN_BOOTSTRAP", "ADMIN_PASSWORD"):
            monkeypatch.delenv(var, raising=False)
    return Settings(_env_file=env_file)


def test_dev_defaults_load(tmp_path, monkeypatch):
    s = _load(_make_env(tmp_path), monkeypatch)
    assert s.threshold_default == 0.11
    assert s.channel_noise_default == 0.01
    assert s.qkd_qubits_default == 256
    assert s.max_reattacks == 3
    assert s.access_token_expire_minutes == 30
    assert len(s.master_key_bytes) == 32


def test_prod_rejects_default_secret(tmp_path, monkeypatch):
    with pytest.raises(Exception):
        _load(
            _make_env(
                tmp_path,
                QSC_ENV="prod",
                DATABASE_URL="postgresql+psycopg://u:p@localhost:5432/qsc",
                QSC_MASTER_KEY=base64.b64encode(os.urandom(16)).decode(),
            ),
            monkeypatch,
        )


def test_master_key_wrong_size_fails_in_prod(tmp_path, monkeypatch):
    with pytest.raises(Exception):
        _load(
            _make_env(
                tmp_path,
                QSC_ENV="prod",
                JWT_SECRET_KEY="a-really-long-production-secret-value",
                DATABASE_URL="postgresql+psycopg://u:p@localhost:5432/qsc",
                QSC_MASTER_KEY=base64.b64encode(b"short").decode(),
            ),
            monkeypatch,
        )


def test_sqlite_url_normalized(tmp_path, monkeypatch):
    s = _load(_make_env(tmp_path, DATABASE_URL="sqlite:///./x.db"), monkeypatch)
    assert s.database_url == "sqlite:///./x.db"
