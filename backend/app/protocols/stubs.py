"""Registered-but-unsupported protocol stubs for v1 (Section 03/13.1)."""

from __future__ import annotations

from app.protocols.base import (
    ProtocolBase,
    ProtocolNotSupported,
    ProtocolRunInput,
    ProtocolRunResult,
)


class _StubProtocol(ProtocolBase):
    supported = False

    def run(self, params: ProtocolRunInput) -> ProtocolRunResult:
        raise ProtocolNotSupported(
            f"{self.name} is registered but not runnable in v1.",
            details={"protocol": self.name},
        )

    def estimate_key_efficiency(self) -> float:
        raise ProtocolNotSupported(f"{self.name} efficiency unknown in v1")


class B92Protocol(_StubProtocol):
    name = "B92"


class E91Protocol(_StubProtocol):
    name = "E91"
    requires_entanglement = True


class SixStateProtocol(_StubProtocol):
    name = "SIX_STATE"


class SARG04Protocol(_StubProtocol):
    name = "SARG04"


class DecoyBB84Protocol(_StubProtocol):
    name = "DECOY_BB84"
