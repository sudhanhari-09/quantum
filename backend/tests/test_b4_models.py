"""B4 acceptance: schema matches Section 11; unique constraints enforced."""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

import app.models  # noqa: F401  (register tables)
from app.db.base import Base

REQUIRED_TABLES = {
    "users",
    "messages",
    "communication_sessions",
    "qkd_sessions",
    "attacks",
    "security_reports",
    "audit_logs",
    # recommended additions
    "ai_recommendations",
    "secret_keys",
    "protocol_configs",
    "refresh_tokens",
}

REQUIRED_COLUMNS = {
    "users": {"id", "unique_user_id", "name", "email", "password_hash", "role", "is_active", "created_at"},
    "messages": {
        "id", "sender_id", "receiver_id", "communication_id", "encrypted_message",
        "nonce", "protocol", "status", "qber", "key_status", "attack_detected",
        "created_at", "read_at",
    },
    "communication_sessions": {"id", "sender_id", "receiver_id", "protocol", "session_status", "created_at", "completed_at"},
    "qkd_sessions": {
        "id", "communication_id", "protocol", "qubits_generated", "matching_bases",
        "sifted_bits", "compared_bits", "errors", "qber", "threshold", "key_status",
        "is_baseline", "created_at",
    },
    "attacks": {
        "id", "attacker_id", "communication_id", "attack_type", "attack_strength",
        "states_intercepted", "states_modified", "qber_before", "qber_after",
        "detection_status", "created_at",
    },
    "security_reports": {
        "id", "message_id", "protocol", "qber", "attack_detected", "key_status",
        "encryption_status", "delivery_status", "created_at",
    },
    "audit_logs": {"id", "user_id", "action", "description", "created_at"},
}


@pytest.fixture(scope="module")
def engine(tmp_path_factory):
    url = f"sqlite:///{(tmp_path_factory.mktemp('b4') / 'b4.db').as_posix()}"
    eng = create_engine(url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


def test_all_tables_exist(engine):
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    missing = REQUIRED_TABLES - tables
    assert not missing, f"missing tables: {missing}"


def test_required_columns_exist(engine):
    inspector = inspect(engine)
    for table, cols in REQUIRED_COLUMNS.items():
        actual = {c["name"] for c in inspector.get_columns(table)}
        missing = cols - actual
        assert not missing, f"{table} missing columns: {missing}"


def test_unique_email_constraint():
    # Emails are normalized to lowercase by the service layer (B6); the DB
    # unique index on the normalized column enforces case-insensitive
    # uniqueness effectively.
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(eng)
    factory = sessionmaker(bind=eng, future=True)
    from app.models import User

    with factory() as s:
        s.add(
            User(
                unique_user_id="QSC-AAAAAAAAA1",
                name="A",
                email="dup@test.io",
                password_hash="x",
                role="USER",
            )
        )
        s.commit()
        with pytest.raises(Exception):
            s.add(
                User(
                    unique_user_id="QSC-AAAAAAAAA2",
                    name="B",
                    email="dup@test.io",
                    password_hash="x",
                    role="USER",
                )
            )
            s.commit()


def test_email_normalized_lowercase_at_db_boundary():
    from app.models import User

    u = User(email="DUP@test.io", unique_user_id="QSC-CCCCCCCCCC", name="n",
             password_hash="x", role="USER")
    assert u.email == "dup@test.io"


def test_unique_qsc_id_constraint():
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(eng)
    factory = sessionmaker(bind=eng, future=True)
    from app.models import User

    with factory() as s:
        s.add(User(unique_user_id="QSC-BBBBBBBBB1", name="A", email="a@t.io", password_hash="x", role="USER"))
        s.commit()
        with pytest.raises(Exception):
            s.add(User(unique_user_id="QSC-BBBBBBBBB1", name="B", email="b@t.io", password_hash="x", role="USER"))
            s.commit()
