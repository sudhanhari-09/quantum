"""Eve attacker system (B22) + intercept-and-resend simulation (B23/B24).

AttackSimulationService is the ONLY component allowed to run attacks.
Purely simulated: it deterministically reruns the stored QKD baseline with
Eve injected, appends a post-attack qkd_sessions row so QBER genuinely
changes, records the attack row, and hands the verdict to the state machine.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import AppError
from app.models import Attack, CommunicationSession, Message, QkdSession
from app.services.audit_service import record as audit
from app.services.event_recorder import record as record_event
from app.services.qkd_service import QkdService
from app.services.realtime_service import realtime
from app.services.security_engine import SecurityEngine
from app.services.state_machine import ATTACK_WINDOW_STATES, StateMachineService

ATTACK_TYPES = ("INTERCEPT_AND_RESEND",)


def _emit_and_record(session, channels, event_type, *, communication_id=None,
                     state=None, actor_role="SYSTEM", payload=None):
    realtime.emit(channels, event_type, communication_id=communication_id,
                  state=state, actor_role=actor_role, payload=payload)
    if communication_id is not None:
        record_event(session, communication_id, event_type, state=state,
                     actor_role=actor_role, payload=payload)


class AttackWindowClosed(AppError):
    status_code = 409
    code = "ATTACK_WINDOW_CLOSED"
    message = "This communication is no longer within the attack window."


class InvalidAttackType(AppError):
    status_code = 422
    code = "INVALID_ATTACK_TYPE"
    message = "attack_type must be INTERCEPT_AND_RESEND in v1."


class EveVisibilityError(AppError):
    status_code = 403
    code = "ROLE_FORBIDDEN"
    message = "Not allowed."


class AttackSimulationService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.state_machine = StateMachineService(session)
        self.security = SecurityEngine(session)
        self.qkd = QkdService(session)

    # ---- B22: Eve surfaces -------------------------------------------------------
    def active_communications(self) -> list[dict]:
        """Metadata-only list of sessions inside the attack window."""
        rows = (
            self.session.query(CommunicationSession)
            .filter(CommunicationSession.session_status.in_(ATTACK_WINDOW_STATES))
            .order_by(CommunicationSession.created_at.desc())
            .all()
        )
        items: list[dict] = []
        for c in rows:
            items.append(
                {
                    "id": c.id,
                    "sender_name": _name_of(self.session, c.sender_id),
                    "receiver_name": _name_of(self.session, c.receiver_id),
                    "protocol": c.protocol,
                    "session_state": c.session_status,
                    "created_at": c.created_at.isoformat(),
                }
            )
        return items

    def eve_dashboard_summary(self) -> dict:
        total = self.session.query(Attack).count()
        detected = (
            self.session.query(Attack)
            .filter(Attack.detection_status == "DETECTED")
            .count()
        )
        active = (
            self.session.query(CommunicationSession)
            .filter(CommunicationSession.session_status.in_(ATTACK_WINDOW_STATES))
            .count()
        )
        rate = round(detected / total, 4) if total else 0.0
        return {
            "active_sessions": active,
            "total_attacks": total,
            "detected_attacks": detected,
            "detection_rate": rate,
        }

    def get_attack_for(self, attack_id: int, viewer_role: str, viewer_id: int) -> Optional[Attack]:
        attack = self.session.get(Attack, attack_id)
        if attack is None:
            return None
        if viewer_role == "ADMIN" or (viewer_role == "ATTACKER" and attack.attacker_id == viewer_id):
            return attack
        raise EveVisibilityError()

    def attack_history(self, attacker_id: int, page: int, limit: int) -> tuple[list[Attack], int]:
        from sqlalchemy import func, select

        base = (
            select(Attack)
            .where(Attack.attacker_id == attacker_id)
            .order_by(Attack.id.desc())
        )
        total = self.session.scalar(select(func.count()).select_from(base.subquery())) or 0
        items = self.session.scalars(base.limit(limit).offset((page - 1) * limit)).all()
        return list(items), int(total)

    # ---- B23/B24/B25: the simulated attack -----------------------------------------
    def launch(
        self,
        communication_id: int,
        attacker_id: int,
        attack_type: str,
        strength: float,
    ) -> Attack:
        if attack_type not in ATTACK_TYPES:
            raise InvalidAttackType()
        if not (0.1 <= strength <= 1.0):
            raise AppError("attack_strength must be within 0.1..1.0.",
                           code="VALIDATION_ERROR", status_code=422)

        comm = self.session.get(CommunicationSession, communication_id)
        if comm is None:
            raise AppError("Communication not found.",
                           code="COMMUNICATION_NOT_FOUND", status_code=404)
        if comm.session_status not in ATTACK_WINDOW_STATES:
            raise AttackWindowClosed()
        attacks_so_far = (
            self.session.query(Attack)
            .filter(Attack.communication_id == communication_id)
            .count()
        )
        if attacks_so_far >= settings.max_reattacks:
            raise AttackWindowClosed("Maximum re-attacks reached.")

        baseline = self.qkd.latest_baseline(communication_id)
        if baseline is None:
            # Fast clients can reach the window at QKD_INITIALIZING, before
            # the async pipeline has persisted its baseline run; materialize
            # it now so the attack has real stored counters to corrupt.
            baseline, _ = self.qkd.execute_baseline(comm)

        realtime.emit(["eve", "admin"], "attack.started",
            communication_id=communication_id,
            state=comm.session_status, actor_role="ATTACKER",
            payload={"strength": strength},
        )

        # Live progress ticks for the attack run view (percent of qubits
        # processed by the simulated interception).
        for pct, stage in ((25, "intercepting states"), (55, "eve measurement"),
                           (80, "resend + error recount")):
            _emit_and_record(
                self.session, ["eve", "comm"], "attack.progress",
                communication_id=communication_id, state=comm.session_status,
                actor_role="ATTACKER",
                payload={"percent": pct, "states_modified": 0},
            )

        # Deterministic rerun with Eve injected; genuinely recomputes counters.
        post_row, result = self.qkd.append_post_attack_run(comm, strength)

        states_intercepted = round(strength * baseline.qubits_generated)
        states_modified = max(0, post_row.errors - baseline.errors)

        attack = Attack(
            attacker_id=attacker_id,
            communication_id=communication_id,
            attack_type=attack_type,
            attack_strength=strength,
            states_intercepted=states_intercepted,
            states_modified=states_modified,
            qber_before=baseline.qber,
            qber_after=post_row.qber,
            detection_status="NOT_DETECTED",
        )
        self.session.add(attack)
        self.session.flush()

        # ---- B24 detection via the single SecurityEngine rule -------------------
        detection = self.security.evaluate_post_attack(comm, post_row, attack)
        message: Message | None = (
            self.session.query(Message)
            .filter(Message.communication_id == communication_id)
            .first()
        )

        _emit_and_record(self.session, ["eve", "comm", "user", "admin"], "qber.calculated",
                         communication_id=communication_id, state=comm.session_status,
                         payload={"qber": post_row.qber, "threshold": post_row.threshold})

        if detection == "DETECTED":
            post_row.key_status = "REJECTED"
            self.state_machine.transition(comm, "ATTACK_DETECTED", actor_role="ATTACKER")
            self.state_machine.transition(comm, "KEY_REJECTED", actor_role="SYSTEM")
            self.state_machine.transition(comm, "BLOCKED", actor_role="SYSTEM")
            if message is not None:
                message.attack_detected = True
                message.protocol = comm.protocol
            _emit_and_record(self.session, ["eve", "comm", "user", "admin"], "attack.detected",
                             communication_id=communication_id, state="ATTACK_DETECTED",
                             actor_role="ATTACKER",
                             payload={"attack_id": attack.id,
                                      "qber_before": attack.qber_before,
                                      "qber_after": attack.qber_after,
                                      "detection_status": detection})
            _emit_and_record(self.session, ["user", "comm", "admin"], "message.blocked",
                             communication_id=communication_id, state="BLOCKED",
                             payload={"message_id": message.id if message else None,
                                      "reason": "intercept-and-resend detected"})
            # Ensure a security report exists for the blocked path (B25/B27).
            if message is not None:
                from app.services.reporting_service import ReportingService

                ReportingService(self.session).write_report(message, comm, post_row)
        else:
            # NOT_DETECTED: session resumes its flow; still broadcast progress
            # completion so live run views settle via REST/WS.
            _emit_and_record(self.session, ["eve", "comm"], "attack.progress",
                             communication_id=communication_id,
                             state=comm.session_status, actor_role="ATTACKER",
                             payload={"percent": 100,
                                      "states_modified": states_modified})

        audit(
            self.session,
            "attack.launch",
            f"simulated {attack_type} on communication {communication_id}: "
            f"strength={strength} qber {attack.qber_before}->{attack.qber_after} "
            f"({detection})",
            user_id=attacker_id,
        )
        return attack


def _name_of(session: Session, user_id: int) -> str:
    from app.models import User

    user = session.get(User, user_id)
    return user.name if user else "unknown"
