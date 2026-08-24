"""Messages router (B11/B26/B27): create + inbox + sent + detail + report."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from sqlalchemy.orm import Session

from app.core.dependencies import SessionDep, get_current_user
from app.core.exceptions import AppError
from app.models import CommunicationSession, Message, Role, User
from app.schemas.message import CreateMessageRequest
from app.services.delivery_service import DeliveryService, InboxRepository
from app.services.encryption_service import EncryptionService
from app.services.messaging_service import MessagingService
from app.services.reporting_service import ReportingService

router = APIRouter(prefix="/messages", tags=["messages"])


@router.post("", status_code=202)
def create_message(
    body: CreateMessageRequest,
    background_tasks: BackgroundTasks,
    session: Session = SessionDep,
    user: User = Depends(get_current_user),
):
    from app.core.config import get_settings
    from app.db.session import session_scope

    if not get_settings().process_async:
        svc = MessagingService(session)
        message, comm = svc.create_message(
            user, body.receiver_qsc_id, body.content, body.security_requirement
        )
        # Full secure pipeline runs synchronously; REST stays source of truth.
        svc.run_secure_pipeline(message, body.content, body.security_requirement)
        session.flush()
        return {
            "message_id": message.id,
            "communication_id": comm.id,
            "status": message.status,
            "message": "accepted for secure processing",
        }

    # Async mode: perform creation writes in a SHORT-LIVED dedicated session so
    # no write lock crosses into the background task (SQLite safety), then
    # return the contract 202/CREATED immediately.
    with session_scope() as s:
        owner = s.get(User, user.id)
        svc = MessagingService(s)
        message, comm = svc.create_message(
            owner, body.receiver_qsc_id, body.content, body.security_requirement
        )
        message_id, comm_id = message.id, comm.id

    plaintext = body.content
    requirement = body.security_requirement

    def run_pipeline() -> None:
        import time

        from app.core.config import get_settings as _gs
        from app.core.logging import get_logger

        logger_bg = get_logger("qsc.pipeline")
        logger_bg.info("bg pipeline start comm=%s", comm_id)
        # Let the request's dependency teardown fully release before writing.
        time.sleep(_gs().pipeline_stage_delay_ms / 1000.0)
        try:
            with session_scope() as s:
                m = s.get(Message, message_id)
                c = s.get(CommunicationSession, comm_id)
                if m is None or c is None:
                    return
                MessagingService(s).run_secure_pipeline(
                    m, plaintext, requirement,
                    stage_delay=_gs().pipeline_stage_delay_ms / 1000.0,
                    commit_each_stage=True,
                )
        except Exception:
            logger_bg.exception("async secure pipeline failed for communication %s", comm_id)
            raise

    background_tasks.add_task(run_pipeline)
    return {
        "message_id": message_id,
        "communication_id": comm_id,
        "status": "CREATED",
        "message": "accepted for secure processing",
    }


@router.get("/inbox")
def inbox(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    session: Session = SessionDep,
    user: User = Depends(get_current_user),
):
    items, total = InboxRepository(session).inbox(user.id, page, limit)
    return {
        "items": [_list_row(session, m) for m in items],
        "total": total,
        "page": page,
        "limit": limit,
    }


@router.get("/sent")
def sent(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    session: Session = SessionDep,
    user: User = Depends(get_current_user),
):
    items, total = InboxRepository(session).sent(user.id, page, limit)
    return {
        "items": [_list_row(session, m) for m in items],
        "total": total,
        "page": page,
        "limit": limit,
    }


@router.get("/{message_id}")
def get_message(
    message_id: int,
    session: Session = SessionDep,
    user: User = Depends(get_current_user),
):
    msg = InboxRepository(session).get_for_owner(message_id, user.id)
    if msg is None:
        raise AppError("Message not found.", code="MESSAGE_NOT_FOUND", status_code=404)

    content: str | None = None
    if msg.status in ("DELIVERED", "READ") and msg.encrypted_message:
        try:
            content = EncryptionService(session).decrypt_for_owner(msg)
        except Exception:
            content = None  # safe failure: never leak ciphertext internals
        if msg.status == "DELIVERED" and user.id == msg.receiver_id:
            DeliveryService(session).mark_read(msg, user.id)

    return {
        "id": msg.id,
        "communication_id": msg.communication_id,
        "sender": {"id": msg.sender_id, "name": _name(session, msg.sender_id)},
        "receiver": {"id": msg.receiver_id, "name": _name(session, msg.receiver_id)},
        "content": content,
        "protocol": msg.protocol,
        "qber": msg.qber,
        "key_status": msg.key_status,
        "status": msg.status,
        "attack_detected": msg.attack_detected,
        "created_at": msg.created_at.isoformat(),
        "read_at": msg.read_at.isoformat() if msg.read_at else None,
    }


@router.get("/{message_id}/security-report")
def security_report(
    message_id: int,
    session: Session = SessionDep,
    user: User = Depends(get_current_user),
):
    msg = InboxRepository(session).get_for_owner(message_id, user.id)
    if msg is None:
        raise AppError("Message not found.", code="MESSAGE_NOT_FOUND", status_code=404)
    report = ReportingService(session).get_for_message(message_id)
    if report is None:
        raise AppError("Report not found.", code="REPORT_NOT_FOUND", status_code=404)
    return {
        "report": {
            "message_id": report.message_id,
            "protocol": report.protocol,
            "qber": report.qber,
            "attack_detected": report.attack_detected,
            "key_status": report.key_status,
            "encryption_status": report.encryption_status,
            "delivery_status": report.delivery_status,
            "created_at": report.created_at.isoformat(),
        }
    }


def _name(session: Session, user_id: int) -> str:
    from app.models import User

    u = session.get(User, user_id)
    return u.name if u else "unknown"


def _list_row(session: Session, m) -> dict:
    return {
        "id": m.id,
        "sender": {"id": m.sender_id, "name": _name(session, m.sender_id)} if m.sender_id else None,
        "receiver_id": m.receiver_id,
        "protocol": m.protocol,
        "qber": m.qber,
        "key_status": m.key_status,
        "status": m.status,
        "attack_detected": m.attack_detected,
        "created_at": m.created_at.isoformat(),
        "read_at": m.read_at.isoformat() if m.read_at else None,
    }
