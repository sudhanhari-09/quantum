"""QKD session management (B15): orchestrates runs and persists results.

Seed policy: deterministic function of (communication_id, run_count) so
post-attack reruns reproduce baseline randomness exactly (Section 14.2).
Rows are append-only; API responses never include sifted key bits.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import CommunicationSession, QkdSession
from app.protocols.base import ProtocolRunInput, default_registry
from app.services.qber_engine import compute_qber


class QkdEngineError(RuntimeError):
    pass


def seed_for_run(communication_id: int, run_count: int) -> int:
    return abs(hash((communication_id, run_count, "qsc-qkd-seed"))) % (2 ** 48)


SAMPLE_ROWS = 32
_BASIS_WIRE = {"Z": "R", "X": "D"}  # engine basis -> wire label (R=rectilinear, D=diagonal)


def build_sample(result) -> list[dict]:
    """Visualization sample of the first N rounds (no key material)."""
    rows: list[dict] = []
    for i in range(min(SAMPLE_ROWS, result.qubits_generated)):
        a_basis = result.alice_bases[i]
        b_basis = result.bob_bases[i]
        rows.append(
            {
                "index": i,
                "alice_bit": result.alice_bits[i],
                "alice_basis": _BASIS_WIRE[a_basis],
                "bob_basis": _BASIS_WIRE[b_basis],
                "bob_bit": result.bob_bits[i],
                "basis_match": a_basis == b_basis,
                "kept": a_basis == b_basis,
                "error": a_basis == b_basis and result.alice_bits[i] != result.bob_bits[i],
            }
        )
    return rows


class QkdService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.registry = default_registry()

    def run_count(self, communication_id: int) -> int:
        return (
            self.session.query(QkdSession)
            .filter(QkdSession.communication_id == communication_id)
            .count()
        )

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

    def threshold_for(self, protocol: str) -> float:
        from sqlalchemy import text as sql_text

        row = self.session.execute(
            sql_text("SELECT default_threshold FROM protocol_configs WHERE protocol = :p"),
            {"p": protocol.upper()},
        ).fetchone()
        return float(row[0]) if row else settings.threshold_default

    def execute_baseline(
        self,
        comm: CommunicationSession,
        on_progress=None,
    ) -> tuple[QkdSession, object]:
        """Run the session's recommended protocol and persist a baseline row.

        on_progress(percent, stage) is an optional callback used for WS events.
        Returns (persisted_qkd_row, raw_engine_result).
        """
        protocol_name = comm.protocol
        if not protocol_name:
            raise QkdEngineError("session has no selected protocol")

        # CRITICAL INVARIANT (R8/O6): executed protocol must be registered.
        protocol = self.registry.require_supported(protocol_name)

        seed = seed_for_run(comm.id, self.run_count(comm.id))
        params = ProtocolRunInput(
            qubit_count=settings.qkd_qubits_default,
            channel_noise=settings.channel_noise_default,
            seed=seed,
        )
        if on_progress:
            on_progress(10, "initializing")
        result = protocol.run(params)
        if on_progress:
            # Granular progress ticks also PACED the live attack window: under
            # commit_each_stage the pipeline commits+dwells on every tick, so a
            # USER->USER session stays observably attackable long enough for a
            # real EVE client to see, select and target it (B22/B33 demo flow).
            on_progress(35, "transmitting")
            on_progress(60, "sifting bases")
            on_progress(85, "sampling errors")
            on_progress(100, "finalizing")
        threshold = self.threshold_for(protocol_name)

        qber = compute_qber(result.errors, result.compared_bits)
        row = QkdSession(
            communication_id=comm.id,
            protocol=protocol_name,
            seed=seed,
            qubits_generated=result.qubits_generated,
            matching_bases=result.matching_bases,
            sifted_bits=result.sifted_bits,
            compared_bits=result.compared_bits,
            errors=result.errors,
            qber=qber,
            threshold=threshold,
            key_status="PENDING",
            is_baseline=True,
            sample_json=build_sample(result),
        )
        self.session.add(row)
        self.session.flush()
        return row, result

    def append_post_attack_run(self, comm: CommunicationSession, strength: float) -> tuple[QkdSession, object]:
        """Deterministic rerun with Eve injected at the given strength."""
        baseline = self.latest_baseline(comm.id)
        if baseline is None:
            raise QkdEngineError("no baseline run to rerun")
        protocol = self.registry.require_supported(baseline.protocol)
        params = ProtocolRunInput(
            qubit_count=baseline.qubits_generated,
            channel_noise=settings.channel_noise_default,
            seed=baseline.seed,
            eve_fraction=strength,
        )
        result = protocol.run(params)
        qber = compute_qber(result.errors, result.compared_bits)
        row = QkdSession(
            communication_id=comm.id,
            protocol=baseline.protocol,
            seed=baseline.seed,
            qubits_generated=result.qubits_generated,
            matching_bases=result.matching_bases,
            sifted_bits=result.sifted_bits,
            compared_bits=result.compared_bits,
            errors=result.errors,
            qber=qber,
            threshold=baseline.threshold,
            key_status="PENDING",
            is_baseline=False,
            sample_json=build_sample(result),
        )
        self.session.add(row)
        self.session.flush()
        return row, result
