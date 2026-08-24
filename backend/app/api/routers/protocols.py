"""Protocols router (B21 registry truth endpoint)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.dependencies import SessionDep, get_current_user
from app.protocols.base import default_registry

router = APIRouter(prefix="/protocols", tags=["protocols"])


@router.get("")
def list_protocols(session: Session = SessionDep, _: object = Depends(get_current_user)):
    reg = default_registry()
    items = []
    from sqlalchemy import text as sql_text

    for d in reg.describe_all():
        row = session.execute(
            sql_text("SELECT default_threshold FROM protocol_configs WHERE protocol = :p"),
            {"p": d["name"]},
        ).fetchone()
        items.append({
            "name": d["name"],
            "supported": d["supported"],
            "requires_entanglement": d["requires_entanglement"],
            "default_threshold": float(row[0]) if row else None,
        })
    return items
