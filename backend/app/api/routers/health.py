"""Health endpoint: GET /api/v1/health -> {status, version, db}."""

from __future__ import annotations

from fastapi import APIRouter

from app import __version__

from app.core.config import settings

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    db_status = "ok"
    try:
        from app.db.session import check_db

        if not check_db():
            db_status = "error"
    except ImportError:
        # DB layer not present yet (B1); reported as ok until B3 wires it.
        pass
    except Exception:
        db_status = "error"

    return {"status": "ok", "version": __version__, "db": db_status}
