"""AI protocol recommendation service (B20) — Section 12 scoring model.

A real scoring engine: computes a feature snapshot from live inputs, scores
every registered protocol with admin-editable weights, derives confidence via
a softmax margin, and persists the full audit trail. CRITICAL INVARIANT:
the recommended protocol string is exactly what QKDEngine executes.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import AiRecommendation, Attack, CommunicationSession
from app.protocols.base import default_registry


class ProtocolMismatch(RuntimeError):
    """Raised when recommendation != executed protocol (hard failure)."""


DEFAULT_WEIGHTS = {
    "channel_noise": 0.25,
    "security_requirement": 0.25,
    "attack_risk": 0.20,
    "distance": 0.10,
    "key_efficiency": 0.10,
    "maturity": 0.10,
}

SECURITY_REQUIREMENT_MAP = {"LOW": 0.2, "MEDIUM": 0.5, "HIGH": 0.9}

# Simulated route distance setting per security level [TBD default]
DISTANCE_BY_SECURITY = {"LOW": 30.0, "MEDIUM": 50.0, "HIGH": 80.0}


def _softmax_margin(scores: dict[str, float]) -> float:
    if not scores:
        return 0.0
    values = sorted(scores.values(), reverse=True)
    top, runner = values[0], values[1] if len(values) > 1 else 0.0
    # softmax over top-2 then probability mass of the winner
    exps = [math.exp(v * 10) for v in (top, runner)]
    return round(exps[0] / sum(exps), 4)


def _normalize(value: float, low: float, high: float) -> float:
    span = high - low or 1.0
    return max(0.0, min(1.0, (value - low) / span))


class AiRecommendationService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.registry = default_registry()

    # ---- feature snapshot ----------------------------------------------------
    def compute_feature_snapshot(self, comm: CommunicationSession,
                                 security_requirement: str) -> dict:
        recent_window = datetime.now(timezone.utc) - timedelta(hours=24)
        detected_recent = (
            self.session.query(Attack)
            .filter(
                Attack.detection_status == "DETECTED",
                Attack.created_at >= recent_window.replace(tzinfo=None),
            )
            .count()
        )
        attack_risk = min(1.0, detected_recent * 0.2)
        distance = DISTANCE_BY_SECURITY.get(security_requirement, 50.0)
        return {
            "channel_noise": settings.channel_noise_default,
            "security_requirement": SECURITY_REQUIREMENT_MAP.get(security_requirement, 0.5),
            "estimated_attack_risk": round(attack_risk, 4),
            "distance_km": distance,
            "qubits_requested": settings.qkd_qubits_default,
        }

    # ---- scoring ---------------------------------------------------------------
    def score_protocols(self, features: dict) -> tuple[dict[str, float], dict[str, float]]:
        """Returns (scores_by_protocol, weights_used). Weights come from DB."""
        weights = self._weights()
        capabilities = self._capabilities()

        scores: dict[str, float] = {}
        for name, cap in capabilities.items():
            s = 0.0
            # noise resistance vs channel noise (higher noise -> need resistance)
            noise_fit = 1.0 - _normalize(features["channel_noise"], 0.0, 0.10) * (1.0 - cap["noise_resistance"])
            s += weights["channel_noise"] * noise_fit
            # security requirement vs protocol maturity+noise resistance blend
            sec_fit = (cap["noise_resistance"] * 0.6 + cap["maturity"] * 0.4) * features["security_requirement"]
            s += weights["security_requirement"] * (sec_fit + (1 - features["security_requirement"]) * 0.5)
            # attack risk favours mature protocols
            risk_fit = cap["maturity"] * (1.0 - features["estimated_attack_risk"]) + cap["noise_resistance"] * features["estimated_attack_risk"]
            s += weights["attack_risk"] * risk_fit
            # distance suitability
            dist_fit = 1.0 if cap["max_distance_km"] >= features["distance_km"] else _normalize(cap["max_distance_km"], 0, features["distance_km"])
            s += weights["distance"] * dist_fit
            # key efficiency
            s += weights["key_efficiency"] * cap["key_efficiency"]
            # maturity
            s += weights["maturity"] * cap["maturity"]
            scores[name] = round(s, 6)
        return scores, weights

    def _capabilities(self) -> dict[str, dict]:
        caps: dict[str, dict] = {}
        for row in self._protocol_config_rows():
            params = row["parameters"] or {}
            caps[row["protocol"]] = {
                "noise_resistance": float(params.get("noise_resistance", 0.5)),
                "key_efficiency": float(params.get("key_efficiency", 0.5)),
                "max_distance_km": float(params.get("max_distance_km", 100)),
                "maturity": float(params.get("maturity", 0.5)),
                "enabled": bool(row["enabled"]),
            }
        # ensure registry-only protocols still appear
        for name in self.registry.list_names():
            caps.setdefault(name, {
                "noise_resistance": 0.5, "key_efficiency": 0.5,
                "max_distance_km": 100, "maturity": 0.5, "enabled": False,
            })
        return caps

    def _protocol_config_rows(self) -> list[dict]:
        from sqlalchemy import text as sql_text

        rows = self.session.execute(
            sql_text("SELECT protocol, enabled, parameters FROM protocol_configs")
        ).fetchall()
        return [
            {
                "protocol": r[0],
                "enabled": bool(r[1]),
                "parameters": r[2] if isinstance(r[2], dict) else {},
            }
            for r in rows
        ]

    def _weights(self) -> dict[str, float]:
        bb84 = next((r for r in self._protocol_config_rows() if r["protocol"] == "BB84"), None)
        merged = dict(DEFAULT_WEIGHTS)
        if bb84 and isinstance(bb84["parameters"], dict):
            w = bb84["parameters"].get("feature_weights")
            if isinstance(w, dict):
                merged.update({k: float(v) for k, v in w.items()})
        total = sum(merged.values()) or 1.0
        return {k: v / total for k, v in merged.items()}

    # ---- main entry -------------------------------------------------------------
    def recommend(self, comm: CommunicationSession, security_requirement: str = "MEDIUM") -> AiRecommendation:
        features = self.compute_feature_snapshot(comm, security_requirement)
        scores, _ = self.score_protocols(features)

        # Section 03: only ENABLED + SUPPORTED protocols are selectable.
        # Stubs stay in the score table (UI analytics) but can never win.
        eligible = {
            name: score
            for name, score in scores.items()
            if self._is_eligible(name)
        }
        if not eligible:
            raise RuntimeError(
                "NO_ENABLED_PROTOCOLS: no runnable QKD protocol is configured"
            )
        best = max(eligible.items(), key=lambda kv: kv[1])[0]
        confidence = _softmax_margin(eligible)

        contributions = self._explain(best, features, scores)
        explanation = (
            f"{best} selected: {contributions}. "
            f"Evaluated under channel_noise={features['channel_noise']}, "
            f"security={security_requirement}, attack_risk={features['estimated_attack_risk']}."
        )

        row = AiRecommendation(
            communication_id=comm.id,
            protocol=best,
            confidence=confidence,
            explanation=explanation,
            features=features,
            protocol_scores=scores,
        )
        self.session.add(row)
        self.session.flush()
        return row

    def _is_eligible(self, name: str) -> bool:
        """Eligible = supported by the registry AND enabled in config."""
        try:
            proto = self.registry.get(name)
        except Exception:
            return False
        if not proto.supported:
            return False
        caps = self._capabilities().get(name, {})
        return bool(caps.get("enabled", False))

    def _explain(self, winner: str, features: dict, scores: dict) -> str:
        ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
        parts = [f"highest weighted score ({ranked[0][1]:.3f})"]
        caps = self._capabilities().get(winner, {})
        if features["security_requirement"] >= 0.8 and caps.get("maturity", 0) >= 0.9:
            parts.append("high security requirement met by proven maturity")
        if features["estimated_attack_risk"] > 0.3:
            parts.append("elevated attack activity favours resilient protocol")
        if len(ranked) > 1:
            parts.append(f"runner-up {ranked[1][0]} scored {ranked[1][1]:.3f}")
        return ", ".join(parts)

    def latest_for(self, communication_id: int) -> Optional[AiRecommendation]:
        return (
            self.session.query(AiRecommendation)
            .filter(AiRecommendation.communication_id == communication_id)
            .order_by(AiRecommendation.id.desc())
            .first()
        )
