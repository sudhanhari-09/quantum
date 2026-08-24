"""Attacks router (B22-B25/B29): launch, detail, history, eve summary."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.core.dependencies import SessionDep, get_current_user
from app.core.exceptions import AppError
from app.core.ratelimit import rate_limit
from app.models import Attack, Role, User
from app.schemas.message import AttackCreateRequest
from app.services.attack_simulation_service import AttackSimulationService

router = APIRouter(prefix="/attacks", tags=["attacks"])
comm_router = APIRouter(prefix="/communications", tags=["attacks"])


def _attack_row(a: Attack) -> dict:
    return {
        "attack_id": a.id,
        "id": a.id,
        "communication_id": a.communication_id,
        "attack_type": a.attack_type,
        "attack_strength": a.attack_strength,
        "states_intercepted": a.states_intercepted,
        "states_modified": a.states_modified,
        "qber_before": a.qber_before,
        "qber_after": a.qber_after,
        "detection_status": a.detection_status,
        "created_at": a.created_at.isoformat(),
    }


@comm_router.post("/{comm_id}/attacks", status_code=201)
@rate_limit(scope="attack_launch")
def launch_attack(
    request: Request,
    comm_id: int,
    body: AttackCreateRequest,
    session: Session = SessionDep,
    eve: User = Depends(get_current_user),
):
    if eve.role != Role.ATTACKER:
        raise AppError("Attacker role required.", code="ROLE_FORBIDDEN", status_code=403)
    attack = AttackSimulationService(session).launch(
        comm_id, eve.id, body.attack_type, body.attack_strength
    )
    comm_state = _session_state(session, attack.communication_id)
    row = _attack_row(attack)
    row["session_state"] = comm_state
    return row


def _session_state(session: Session, comm_id: int) -> str:
    from app.models import CommunicationSession

    comm = session.get(CommunicationSession, comm_id)
    return comm.session_status if comm else "UNKNOWN"


@router.get("/history")
def attack_history(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    session: Session = SessionDep,
    eve: User = Depends(get_current_user),
):
    if eve.role != Role.ATTACKER:
        raise AppError("Attacker role required.", code="ROLE_FORBIDDEN", status_code=403)
    items, total = AttackSimulationService(session).attack_history(eve.id, page, limit)
    return {"items": [_attack_row(a) for a in items], "total": total,
            "page": page, "limit": limit}


@router.get("/summary")
def eve_summary(
    session: Session = SessionDep,
    eve: User = Depends(get_current_user),
):
    if eve.role != Role.ATTACKER:
        raise AppError("Attacker role required.", code="ROLE_FORBIDDEN", status_code=403)
    return AttackSimulationService(session).eve_dashboard_summary()


@router.get("/{attack_id}")
def attack_detail(
    attack_id: int,
    session: Session = SessionDep,
    user: User = Depends(get_current_user),
):
    attack = AttackSimulationService(session).get_attack_for(
        attack_id, user.role, user.id
    )
    if attack is None:
        raise AppError("Attack not found.", code="ATTACK_NOT_FOUND", status_code=404)
    return _attack_row(attack)


# NOTE: /eve/dashboard/summary alias per Section 19 contract.
from fastapi import APIRouter as _AR  # noqa: E402

eve_router = _AR(prefix="/eve", tags=["attacks"])


@eve_router.get("/dashboard/summary")
def eve_dashboard_alias(
    session: Session = SessionDep,
    eve: User = Depends(get_current_user),
):
    if eve.role != Role.ATTACKER:
        raise AppError("Attacker role required.", code="ROLE_FORBIDDEN", status_code=403)
    return AttackSimulationService(session).eve_dashboard_summary()
