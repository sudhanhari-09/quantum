"""B5 acceptance: alembic baseline + idempotent seeds."""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, inspect, text

import app.models  # noqa: F401
from app.db.base import Base


@pytest.fixture()
def fresh_db(tmp_path):
    eng = create_engine(
        f"sqlite:///{(tmp_path / 'b5.db').as_posix()}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


def _run_seed(conn):
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    # Execute the seed functions directly from revision 0002_seeds.
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "seed_rev", __file__.replace("test_b5_migrations.py", "").join(["", ""]) or None
    ) if False else None
    from pathlib import Path

    versions_dir = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    target = next(p for p in versions_dir.glob("0002_*.py"))
    spec = importlib.util.spec_from_file_location("seed_rev", str(target))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    # Provide op context via alembic ops proxy bound to our connection.
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    ctx = MigrationContext.configure(conn)
    op = Operations(ctx)
    import alembic.op as global_op

    # Temporarily bind global op proxy.
    proxy = Operations._install_proxy(op) if hasattr(Operations, "_install_proxy") else None
    try:
        mod._seed_protocol_configs()
    finally:
        if proxy is not None:
            Operations._remove_proxy()
    return mod


def test_seed_idempotent(fresh_db):
    with fresh_db.begin() as conn:
        mod = _run_seed(conn)
    with fresh_db.begin() as conn:
        _run_seed(conn)  # second pass must not duplicate rows
        count = conn.execute(text("SELECT count(*) FROM protocol_configs")).scalar()
        assert count == 6, "seed must be idempotent (6 registered protocols)"
        bb84 = conn.execute(
            text("SELECT enabled, default_threshold FROM protocol_configs WHERE protocol='BB84'")
        ).fetchone()
        assert bb84[0] in (1, True)
        assert abs(float(bb84[1]) - 0.11) < 1e-9


def test_baseline_schema_created(fresh_db):
    tables = set(inspect(fresh_db).get_table_names())
    assert {"users", "messages", "qkd_sessions", "attacks"} <= tables


def test_qsc_id_service_format():
    from app.services.qsc_id_service import QSC_ID_REGEX, generate_qsc_id, is_valid_qsc_id

    qid = generate_qsc_id()
    assert is_valid_qsc_id(qid), qid
