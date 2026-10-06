"""Application configuration — pydantic-settings source of truth (B2).

Freezes once per process; startup fails fast on misconfiguration (e.g. a
QSC_MASTER_KEY shorter than 32 bytes in prod mode).
"""

from __future__ import annotations

import base64
import os
from functools import lru_cache

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_PATH,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # app
    app_name: str = "QSC Platform API"
    qsc_env: str = Field(default="dev", alias="QSC_ENV")
    log_level: str = "INFO"
    cors_origins: str = "http://localhost:5173"

    # database
    database_url: str = "sqlite:///./qsc.db"

    # jwt
    jwt_secret_key: str = "dev-only-secret-key-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7

    # master key for key-at-rest encryption [REC]
    qsc_master_key: str = ""

    # simulation defaults
    threshold_default: float = 0.11
    channel_noise_default: float = 0.01
    qkd_qubits_default: int = 256
    max_reattacks: int = 3

    # pipeline scheduling: when true, POST /messages returns 202/CREATED and
    # the secure pipeline continues as a background task with observable
    # stage dwell (enables the live attack window + real-time UI).
    process_async: bool = False
    pipeline_stage_delay_ms: int = 1200

    # rate limits (requests per minute)
    rate_limit_auth_per_min: int = 5
    rate_limit_search_per_min: int = 10
    rate_limit_attack_per_min: int = 3
    rate_limit_default_per_min: int = 120

    # bootstrap
    enable_admin_bootstrap: bool = False
    admin_email: str = "admin@qsc.dev"
    admin_password: str = ""
    admin_name: str = "Platform Admin"

    @property
    def is_prod(self) -> bool:
        return self.qsc_env.lower() == "prod"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def master_key_bytes(self) -> bytes:
        """Decoded 32-byte QSC_MASTER_KEY; raises if unusable."""
        raw = (self.qsc_master_key or "").strip()
        if not raw:
            raise ValueError("QSC_MASTER_KEY is not configured")
        key = base64.b64decode(raw)
        if len(key) != 32:
            raise ValueError("QSC_MASTER_KEY must decode to exactly 32 bytes")
        return key

    @field_validator("database_url")
    @classmethod
    def _normalize_sqlite_url(cls, v: str) -> str:
        if v.startswith("sqlite://") and not v.startswith("sqlite:///"):
            return "sqlite:///" + v[len("sqlite://") :]
        return v

    @model_validator(mode="after")
    def _prod_guards(self) -> "Settings":
        problems: list[str] = []
        if self.is_prod:
            if self.jwt_secret_key == "dev-only-secret-key-change-me":
                problems.append("JWT_SECRET_KEY must be changed in prod")
            try:
                self.master_key_bytes
            except ValueError as exc:
                problems.append(f"QSC_MASTER_KEY invalid: {exc}")
            if not self.database_url.startswith(("postgresql", "postgres")):
                problems.append("DATABASE_URL must be PostgreSQL in prod")
        if problems:
            raise ValueError("IncompleteConfig: " + "; ".join(problems))
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


class _SettingsProxy:
    """Forwards attribute access to the CURRENT cached Settings instance.

    Guarantees a single configuration source even after get_settings.cache_clear()
    (used by tests / runtime reconfiguration): modules holding `from
    app.core.config import settings` always see the live instance.
    """

    def __getattr__(self, name: str):
        return getattr(get_settings(), name)

    def __setattr__(self, name: str, value) -> None:
        setattr(get_settings(), name, value)


settings = _SettingsProxy()
