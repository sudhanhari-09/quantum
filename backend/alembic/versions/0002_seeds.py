"""seed protocol_configs + optional bootstrap accounts (B5)

RECOMMENDED ADDITION seeds: default protocol_configs rows (BB84 enabled with
threshold 0.11; other registered protocols as disabled stubs) and, guarded by
ENABLE_ADMIN_BOOTSTRAP=true, one ADMIN account and one ATTACKER (eve) account.
Idempotent: safe to run repeatedly.

Revision ID: 0002_seeds
Revises: 10e630a4bfa9
Create Date: 2026-08-22
"""
import base64

from alembic import op
import sqlalchemy as sa
from sqlalchemy import table, column, String, Boolean, Numeric, Integer, JSON

revision = "0002_seeds"
down_revision = "10e630a4bfa9"
branch_labels = None
depends_on = None

PROTOCOL_SEEDS = [
    # name, enabled, threshold, max_qubits, parameters (weights + capabilities)
    ("BB84", True, "0.1100", 256, {
        "noise_resistance": 0.55,
        "key_efficiency": 0.90,
        "max_distance_km": 100,
        "maturity": 1.0,
    }),
    ("B92", True, "0.1100", 256, {"noise_resistance": 0.50, "key_efficiency": 0.50, "max_distance_km": 80, "maturity": 0.7}),
    ("E91", True, "0.1200", 128, {"noise_resistance": 0.70, "key_efficiency": 0.50, "max_distance_km": 150, "maturity": 0.5}),
    ("SIX_STATE", True, "0.1300", 128, {"noise_resistance": 0.75, "key_efficiency": 0.30, "max_distance_km": 90, "maturity": 0.6}),
    ("SARG04", True, "0.1100", 256, {"noise_resistance": 0.60, "key_efficiency": 0.40, "max_distance_km": 85, "maturity": 0.6}),
    ("DECOY_BB84", True, "0.1000", 512, {"noise_resistance": 0.65, "key_efficiency": 0.70, "max_distance_km": 120, "maturity": 0.8}),
]


def _seed_protocol_configs() -> None:
    conn = op.get_bind()
    pc = sa.table(
        "protocol_configs",
        sa.column("protocol", sa.String),
        sa.column("enabled", sa.Boolean),
        sa.column("default_threshold", sa.Numeric),
        sa.column("max_qubits", sa.Integer),
        sa.column("parameters", sa.JSON),
        sa.column("created_at", sa.DateTime),
    )
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    for name, enabled, thr, qubits, params in PROTOCOL_SEEDS:
        exists = conn.execute(text_select(name)).first()
        if not exists:
            conn.execute(
                pc.insert().values(
                    protocol=name,
                    enabled=enabled,
                    default_threshold=float(thr),
                    max_qubits=qubits,
                    parameters=params,
                    created_at=now,
                )
            )


def text_select(name: str):
    from sqlalchemy import text

    return text("SELECT id FROM protocol_configs WHERE protocol = :p").bindparams(p=name)


def _bootstrap_accounts() -> None:
    import os

    from app.core.config import settings

    if not settings.enable_admin_bootstrap:
        return
    if not settings.admin_password:
        return

    import bcrypt

    from app.services.qsc_id_service import generate_qsc_id

    conn = op.get_bind()
    users = sa.table(
        "users",
        sa.column("id", sa.Integer),
        sa.column("unique_user_id", sa.String),
        sa.column("name", sa.String),
        sa.column("email", sa.String),
        sa.column("password_hash", sa.String),
        sa.column("role", sa.String),
        sa.column("is_active", sa.Boolean),
        sa.column("created_at", sa.DateTime),
    )
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)

    def _ensure(email: str, name: str, role: str) -> None:
        row = conn.execute(
            sa.text("SELECT id FROM users WHERE email = :e").bindparams(e=email.lower())
        ).first()
        if row:
            return
        pw_hash = bcrypt.hashpw(settings.admin_password.encode(), bcrypt.gensalt(rounds=12)).decode()
        conn.execute(
            users.insert().values(
                unique_user_id=generate_qsc_id(),
                name=name,
                email=email.lower(),
                password_hash=pw_hash,
                role=role,
                is_active=True,
                created_at=now,
            )
        )

    _ensure(settings.admin_email, settings.admin_name or "Platform Admin", "ADMIN")
    _ensure("eve@qsc.dev", "Eve (Simulated Attacker)", "ATTACKER")


def upgrade() -> None:
    _seed_protocol_configs()
    _bootstrap_accounts()


def downgrade() -> None:
    pass  # seeds are harmless; keep them on downgrade for auditability
