"""Security decision engine (B17): the sole authority for key/delivery decisions.

Decision model (Section 15):
  qber <= threshold -> ACCEPTED (encryption + delivery allowed)
  qber >  threshold -> REJECTED (attack suspected; message BLOCKED)
Downgrade ACCEPTED -> REJECTED only while inside the attack window; once
DELIVERED, no downgrade.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.models import Attack, CommunicationSession, QkdSession
from app.services.audit_service import record as audit
from app.services.qber_engine import compute_qber
from app.services.state_machine import (
    ATTACK_WINDOW_STATES,
    StateMachineService,
)


@dataclass(frozen=True)
class SecurityDecision:
    decision: str            # PENDING | ACCEPTED | REJECTED
    qber: float
    threshold: float
    key_status: str          # PENDING | ACCEPTED | REJECTED
    attack_detected: bool


class KeyRejected(AppError):
    status_code = 409
    code = "KEY_REJECTED"
    message = "QKD security check failed; the key was rejected."


def evaluate(qber: float, threshold: float) -> str:
    """Pure rule: ACCEPTED iff qber <= threshold."""
    return "ACCEPTED" if qber <= threshold else "REJECTED"


class SecurityEngine:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.state_machine = StateMachineService(session)

    def latest_baseline(self, communication_id: int) -> Optional[QkdSession]:
        return (
            self.session.query(QkdSession)
            .filter(
                QkdSession.communication_id == communication_id,
                QkdSession.is_baseline.is_(True),
            )
            .order_by(QkdSession.id.desc())
            .first()
        )

    def latest_run(self, communication_id: int) -> Optional[QkdSession]:
        return (
            self.session.query(QkdSession)
            .filter(QkdSession.communication_id == communication_id)
            .order_by(QkdSession.id.desc())
            .first()
        )

    def evaluate_session(self, comm: CommunicationSession) -> SecurityDecision:
        """Run SECURITY_CHECK on the latest run and transition accordingly."""
        run = self.latest_run(comm.id)
        if run is None:
            return SecurityDecision("PENDING", 0.0, 0.0, "PENDING", False)

        self.state_machine.transition(comm, "SECURITY_CHECK", actor_role="SYSTEM")
        decision = evaluate(run.qber, run.threshold)
        # Persist the verdict onto the run row itself.
        run.key_status = "ACCEPTED" if decision == "ACCEPTED" else "REJECTED"

        if decision == "ACCEPTED":
            self.state_machine.transition(comm, "KEY_ACCEPTED", actor_role="SYSTEM")
        else:
            self.state_machine.transition(comm, "ATTACK_DETECTED", actor_role="SYSTEM")
            self.state_machine.transition(comm, "KEY_REJECTED", actor_role="SYSTEM")
            self.state_machine.transition(comm, "BLOCKED", actor_role="SYSTEM")

        audit(
            self.session,
            f"security.key_{decision.lower()}",
            f"security check for communication {comm.id}: qber={run.qber} "
            f"threshold={run.threshold} -> {decision}",
            user_id=None,
        )
        return SecurityDecision(
            decision=decision,
            qber=run.qber,
            threshold=run.threshold,
            key_status=decision if decision in ("ACCEPTED", "REJECTED") else "PENDING",
            attack_detected=decision == "REJECTED",
        )

    def evaluate_post_attack(
        self,
        comm: CommunicationSession,
        post_run: QkdSession,
        attack: Attack,
    ) -> str:
        """Detection rule: recomputed post-attack QBER vs same single threshold."""
        detection = "DETECTED" if post_run.qber > post_run.threshold else "NOT_DETECTED"
        attack.detection_status = detection
        return detection

    def confirm_key_accepted(self, comm: CommunicationSession) -> None:
        """Gate used by EncryptionService before encrypting anything.

        Acceptance means: the latest run's stored key_status is ACCEPTED and
        the session never entered a rejected/blocked path.
        """
        run = self.latest_run(comm.id)
        if run is None or run.key_status != "ACCEPTED":
            raise KeyRejected()
        if comm.session_status in ("ATTACK_DETECTED", "KEY_REJECTED", "BLOCKED", "FAILED"):
            raise KeyRejected()

    def can_reattack(self, comm: CommunicationSession) -> bool:
        if comm.session_status not in ATTACK_WINDOW_STATES:
            return False
        count = (
            self.session.query(Attack)
            .filter(Attack.communication_id == comm.id)
            .count()
        )
        return count < 3  # MAX_REATTACKS [REC]
