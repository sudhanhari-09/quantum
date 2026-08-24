"""Protocol base + registry (B21): pluggable QKD protocol layer."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional

from app.core.exceptions import AppError


class ProtocolNotSupported(AppError):
    status_code = 501
    code = "PROTOCOL_NOT_SUPPORTED"
    message = "This QKD protocol is registered but not supported in v1."


class ProtocolNotFound(AppError):
    status_code = 404
    code = "PROTOCOL_NOT_FOUND"
    message = "Unknown QKD protocol."


@dataclass
class ProtocolRunInput:
    qubit_count: int
    channel_noise: float
    seed: int
    eve_fraction: float = 0.0  # fraction of qubits intercepted (attack rerun)


@dataclass
class ProtocolRunResult:
    protocol: str
    seed: int
    qubits_generated: int
    matching_bases: int
    sifted_bits: int
    compared_bits: int
    errors: int
    qber: float
    alice_bits: list[int] = field(default_factory=list)
    alice_bases: list[str] = field(default_factory=list)
    bob_bases: list[str] = field(default_factory=list)
    bob_bits: list[int] = field(default_factory=list)
    eve_touched: list[bool] = field(default_factory=list)
    # SECURITY: canonical sifted key material (Alice's bits). Never serialized.
    sifted_key_bits: str = ""

    @property
    def key_efficiency(self) -> float:
        return self.sifted_bits / self.qubits_generated if self.qubits_generated else 0.0


class ProtocolBase(ABC):
    """Abstract QKD protocol. Subclass + register to add a new protocol."""

    name: str = "BASE"
    requires_entanglement: bool = False
    supported: bool = False

    @abstractmethod
    def run(self, params: ProtocolRunInput) -> ProtocolRunResult:  # pragma: no cover
        ...

    def estimate_key_efficiency(self) -> float:
        raise ProtocolNotSupported(f"{self.name} has no efficiency estimate in v1")


class ProtocolRegistry:
    def __init__(self) -> None:
        self._protocols: dict[str, ProtocolBase] = {}

    def register(self, protocol: ProtocolBase) -> None:
        self._protocols[protocol.name.upper()] = protocol

    def get(self, name: str) -> ProtocolBase:
        proto = self._protocols.get((name or "").upper())
        if proto is None:
            raise ProtocolNotFound()
        return proto

    def require_supported(self, name: str) -> ProtocolBase:
        proto = self.get(name)
        if not proto.supported:
            raise ProtocolNotSupported(
                details={"protocol": proto.name}
            )
        return proto

    def list_names(self) -> list[str]:
        return sorted(self._protocols.keys())

    def describe_all(self) -> list[dict]:
        return [
            {
                "name": p.name,
                "supported": p.supported,
                "requires_entanglement": p.requires_entanglement,
            }
            for p in sorted(self._protocols.values(), key=lambda x: x.name)
        ]


protocol_registry = ProtocolRegistry()


def default_registry() -> ProtocolRegistry:
    """Registry with BB84 fully implemented and v1 stubs registered."""
    from app.protocols.bb84 import BB84Protocol
    from app.protocols.stubs import (
        B92Protocol,
        DecoyBB84Protocol,
        E91Protocol,
        SARG04Protocol,
        SixStateProtocol,
    )

    reg = ProtocolRegistry()
    reg.register(BB84Protocol())
    for stub_cls in (
        B92Protocol,
        E91Protocol,
        SixStateProtocol,
        SARG04Protocol,
        DecoyBB84Protocol,
    ):
        reg.register(stub_cls())
    return reg
