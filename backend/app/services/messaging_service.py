"""Messaging service (B11) + communication sessions (B12) + secure pipeline.

POST /messages creates the message + session (state CREATED), then runs the
backend pipeline: RECEIVER_VERIFIED -> AI recommendation -> QKD -> security
decision -> encryption OR blocking -> delivery -> report. WS events and audit
rows accompany every step. Plaintext exists only transiently in memory.
"""

from __future__ import annotations

from typing import Callable, Optional

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.models import CommunicationSession, Message, User
from app.repositories.user_repository import UserRepository
from app.services.ai_recommendation_service import AiRecommendationService
from app.services.audit_service import record as audit
from app.services.delivery_service import DeliveryService
from app.services.encryption_service import EncryptionService
from app.services.event_recorder import record as record_event
from app.services.key_service import KeyService
from app.services.qkd_service import QkdService
from app.services.realtime_service import realtime
from app.services.reporting_service import ReportingService
from app.services.security_engine import SecurityEngine
from app.services.state_machine import ATTACK_WINDOW_STATES, StateMachineService


def _emit_and_record(session, channels, event_type, *, communication_id=None,
                     state=None, actor_role="SYSTEM", payload=None):
    """Single sink: broadcast live AND persist for REST timeline replay."""
    realtime.emit(channels, event_type, communication_id=communication_id,
                  state=state, actor_role=actor_role, payload=payload)
    if communication_id is not None:
        record_event(session, communication_id, event_type, state=state,
                     actor_role=actor_role, payload=payload)


class MessagingService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.users = UserRepository(session)
        self.state_machine = StateMachineService(session)

    # ---- creation (B11/B12) -----------------------------------------------------
    def create_message(
        self,
        sender: User,
        receiver_qsc_id: str,
        content: str,
        security_requirement: str = "MEDIUM",
    ) -> tuple[Message, CommunicationSession]:
        receiver = self.users.get_by_qsc_id((receiver_qsc_id or "").strip().upper())
        if receiver is None:
            raise AppError("No user with that QSC ID.",
                           code="USER_NOT_FOUND", status_code=404)
        if receiver.id == sender.id:
            raise AppError("Cannot send a message to yourself.",
                           code="SELF_DELIVERY", status_code=409)
        if not (1 <= len(content.strip()) <= 2000):
            raise AppError("Message content must be 1..2000 characters.",
                           code="CONTENT_TOO_LONG", status_code=422)

        comm = CommunicationSession(sender_id=sender.id, receiver_id=receiver.id)
        self.session.add(comm)
        self.session.flush()

        message = Message(
            sender_id=sender.id,
            receiver_id=receiver.id,
            communication_id=comm.id,
            status="PENDING",
        )
        self.session.add(message)
        self.session.flush()

        # CREATED is the initial state; verify receiver immediately.
        self.state_machine.transition(comm, "RECEIVER_VERIFIED")
        audit(self.session, "message.create",
              f"message {message.id} created in communication {comm.id}",
              user_id=sender.id)
        _emit_and_record(
            self.session,
            ["eve", "admin", "user"],
            "communication.created",
            communication_id=comm.id,
            state="CREATED",
            actor_role="USER",
            payload={"communication_id": comm.id, "sender": sender.name,
                     "receiver": receiver.name},
        )
        return message, comm

    # ---- full pipeline (B20 -> B15 -> B17 -> B18 -> B19 -> B26 -> B27) ----------
    def run_secure_pipeline(
        self,
        message: Message,
        plaintext: str,
        security_requirement: str = "MEDIUM",
        stage_delay: float = 0.0,
        commit_each_stage: bool = False,
    ) -> None:
        """Runs after creation; never stores plaintext.

        stage_delay > 0 inserts a small dwell between major stages so the
        session is observably inside the attack window and the UI can render
        real progress (Section 16 / F10 / F23).
        commit_each_stage > makes every intermediate state VISIBLE to other
        connections immediately (required for the live attack window); the
        caller then owns final durability semantics.
        """
        import time

        comm: CommunicationSession = message.session
        sm = self.state_machine

        def dwell() -> None:
            if stage_delay > 0:
                import time as _t

                _t.sleep(stage_delay)
            if commit_each_stage:
                self.session.commit()

        # ---- AI recommendation (B20) -------------------------------------------
        dwell()
        sm.transition(comm, "AI_ANALYZING")
        _emit_and_record(self.session, ["user", "comm"], "ai.analysis_started",
                         communication_id=comm.id, state="AI_ANALYZING")
        recommender = AiRecommendationService(self.session)
        rec = recommender.recommend(comm, security_requirement)
        comm.protocol = rec.protocol  # INVARIANT: executed == recommended
        message.protocol = rec.protocol
        sm.transition(comm, "PROTOCOL_SELECTED")
        _emit_and_record(self.session, ["user", "comm", "admin"], "ai.protocol_selected",
                         communication_id=comm.id, state="PROTOCOL_SELECTED",
                         payload={"protocol": rec.protocol,
                                  "confidence": rec.confidence,
                                  "explanation": rec.explanation,
                                  "scores": rec.protocol_scores})
        audit(self.session, "recommend",
              f"communication {comm.id}: recommended {rec.protocol} "
              f"(confidence {rec.confidence})", user_id=message.sender_id)

        # ---- QKD (B14/B15/B16) ---------------------------------------------------
        sm.transition(comm, "QKD_INITIALIZING")
        qkd = QkdService(self.session)

        def progress(percent: int, stage: str) -> None:
            dwell()
            sm.transition(comm, "QKD_RUNNING")
            _emit_and_record(self.session, ["user", "comm", "eve"], "qkd.progress",
                             communication_id=comm.id, state="QKD_RUNNING",
                             payload={"percent": percent, "stage": stage})

        _emit_and_record(self.session, ["user", "comm", "eve"], "qkd.started",
                         communication_id=comm.id, state="QKD_INITIALIZING",
                         payload={"protocol": comm.protocol})
        baseline_row, result = qkd.execute_baseline(comm, on_progress=progress)
        dwell()
        sm.transition(comm, "KEY_SIFTING")
        sm.transition(comm, "QBER_EVALUATION")
        _emit_and_record(self.session, ["user", "comm"], "qber.calculated",
                         communication_id=comm.id, state="QBER_EVALUATION",
                         payload={"qber": baseline_row.qber,
                                  "threshold": baseline_row.threshold})
        _emit_and_record(self.session, ["user", "comm", "eve"], "qkd.completed",
                         communication_id=comm.id, state="QBER_EVALUATION",
                         payload={"qubits_generated": baseline_row.qubits_generated,
                                  "matching_bases": baseline_row.matching_bases,
                                  "sifted_bits": baseline_row.sifted_bits,
                                  "compared_bits": baseline_row.compared_bits,
                                  "errors": baseline_row.errors,
                                  "qber": baseline_row.qber})
        audit(self.session, "qkd.run",
              f"communication {comm.id}: BB84-style run protocol={baseline_row.protocol} "
              f"qber={baseline_row.qber}", user_id=message.sender_id)

        # ---- Security decision (B17) ----------------------------------------------
        dwell()
        engine = SecurityEngine(self.session)
        decision = engine.evaluate_session(comm)

        if decision.decision == "ACCEPTED":
            # ---- key storage + encryption + delivery ---------------------------
            KeyService(self.session).store_accepted_key(
                comm.id, baseline_row.id, result.sifted_key_bits
            )
            _emit_and_record(self.session, ["user", "comm"], "security.key_accepted",
                             communication_id=comm.id, state="KEY_ACCEPTED",
                             payload={"message_id": message.id})

            sm.transition(comm, "ENCRYPTING")
            EncryptionService(self.session).encrypt_message(message, plaintext)
            plaintext = ""  # drop from memory immediately
            sm.transition(comm, "ENCRYPTED")
            _emit_and_record(self.session, ["user", "comm"], "message.encrypted",
                             communication_id=comm.id, state="ENCRYPTED",
                             payload={"message_id": message.id})

            sm.transition(comm, "DELIVERED")
            _emit_and_record(self.session, ["user", "comm"], "message.delivered",
                             communication_id=comm.id, state="DELIVERED",
                             payload={"message_id": message.id,
                                      "receiver_id": message.receiver_id})
            audit(self.session, "deliver",
                  f"message {message.id} delivered to receiver",
                  user_id=message.sender_id)
        else:
            message.attack_detected = True
            _emit_and_record(self.session, ["user", "comm", "admin"], "security.key_rejected",
                             communication_id=comm.id, state="KEY_REJECTED",
                             payload={"message_id": message.id,
                                      "reason": "qber above simulation threshold"})
            _emit_and_record(self.session, ["user", "comm", "admin"], "message.blocked",
                             communication_id=comm.id, state="BLOCKED",
                             payload={"message_id": message.id,
                                      "reason": "security check failed"})
            audit(self.session, "block",
                  f"message {message.id} blocked; key rejected "
                  f"(qber={decision.qber} > threshold={decision.threshold})",
                  user_id=message.sender_id)

        # ---- report (B27) ------------------------------------------------------------
        latest_run = qkd.latest_run(comm.id)
        ReportingService(self.session).write_report(message, comm, latest_run)
        if commit_each_stage:
            # Persist terminal state immediately (visible to pollers now).
            self.session.commit()
