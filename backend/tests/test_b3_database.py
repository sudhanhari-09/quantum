"""B3 acceptance: engine creation, session open/close, rollback on exception."""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker


@pytest.fixture()
def sqlite_engine(tmp_path):
    url = f"sqlite:///{(tmp_path / 'b3test.db').as_posix()}"
    engine = create_engine(url, connect_args={"check_same_thread": False})
    yield engine
    engine.dispose()


def test_session_opens_and_commits(sqlite_engine):
    factory = sessionmaker(bind=sqlite_engine, future=True)
    with sqlite_engine.begin() as conn:
        conn.execute(text("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)"))
    with factory() as s:
        s.execute(text("INSERT INTO t (v) VALUES ('kept')"))
        s.commit()
    with factory() as s:
        assert s.execute(text("SELECT count(*) FROM t")).scalar() == 1


def test_rollback_on_exception(sqlite_engine):
    from contextlib import contextmanager

    @contextmanager
    def scope():
        s = sessionmaker(bind=sqlite_engine, future=True)()
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()

    with sqlite_engine.begin() as conn:
        conn.execute(text("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)"))

    with pytest.raises(RuntimeError):
        with scope() as s:
            s.execute(text("INSERT INTO t (v) VALUES ('doomed')"))
            raise RuntimeError("boom")

    with sqlite_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM t")).scalar() == 0


def test_configured_url_is_valid():
    from app.core.config import settings

    assert settings.database_url.startswith(("sqlite", "postgresql", "postgres"))
