"""B21/B14/B16 acceptance: registry, BB84 correctness, QBER math."""

from __future__ import annotations

import statistics

import pytest

from app.protocols.base import (
    ProtocolNotFound,
    ProtocolNotSupported,
    ProtocolRunInput,
    default_registry,
)
from app.services.qber_engine import QberZeroDenominator, compute_qber


# ---- B21 registry ------------------------------------------------------------


def test_registry_lists_all_six_protocols():
    reg = default_registry()
    assert reg.list_names() == ["B92", "BB84", "DECOY_BB84", "E91", "SARG04", "SIX_STATE"]
    described = {d["name"]: d for d in reg.describe_all()}
    assert described["BB84"]["supported"] is True
    assert described["E91"]["requires_entanglement"] is True
    for name in ("B92", "SIX_STATE", "SARG04", "DECOY_BB84", "E91"):
        assert described[name]["supported"] is False


def test_registry_unknown_protocol_raises():
    with pytest.raises(ProtocolNotFound):
        default_registry().get("SHOR")


def test_stub_run_raises_not_supported():
    from app.protocols.stubs import E91Protocol

    with pytest.raises(ProtocolNotSupported) as e:
        E91Protocol().run(ProtocolRunInput(qubit_count=8, channel_noise=0.0, seed=1))
    assert e.value.status_code == 501


def test_bb84_end_to_end_via_registry():
    res = default_registry().require_supported("BB84").run(
        ProtocolRunInput(qubit_count=256, channel_noise=0.01, seed=42)
    )
    assert res.protocol == "BB84"
    assert res.qubits_generated == 256
    assert 0 <= res.qber <= 1


# ---- B14 BB84 engine ---------------------------------------------------------


def test_noiseless_channel_gives_zero_qber_and_half_sift():
    res = default_registry().require_supported("BB84").run(
        ProtocolRunInput(qubit_count=2048, channel_noise=0.0, seed=7)
    )
    # No noise, no Eve -> every kept bit matches exactly.
    assert res.errors == 0
    assert res.qber == 0.0
    # Basis matching ratio ~ 0.5 (law of large numbers, tight bounds)
    ratio = res.matching_bases / res.qubits_generated
    assert 0.47 < ratio < 0.53


def test_determinism_same_seed_identical_counters():
    a = default_registry().require_supported("BB84").run(
        ProtocolRunInput(qubit_count=256, channel_noise=0.02, seed=99)
    )
    b = default_registry().require_supported("BB84").run(
        ProtocolRunInput(qubit_count=256, channel_noise=0.02, seed=99)
    )
    assert (a.matching_bases, a.sifted_bits, a.compared_bits, a.errors, a.qber) == (
        b.matching_bases, b.sifted_bits, b.compared_bits, b.errors, b.qber
    )
    assert a.alice_bits == b.alice_bits and a.bob_bits == b.bob_bits
    assert a.sifted_key_bits == b.sifted_key_bits


def test_known_answer_vector_with_stubbed_streams():
    """With forced streams: alice bits all 0/basis Z, bob basis Z -> perfect key."""
    from random import Random

    from app.simulation.rng import StreamProvider

    class ForcedStreams(StreamProvider):
        def stream(self, name):
            r = Random(f"{self._seed}:{name}")
            if name == "alice_bits":
                return _ConstantRandom(0)
            if name == "alice_bases":
                return _ConstantChoice("Z")
            if name == "bob_bases":
                return _ConstantChoice("Z")
            return r

    import app.protocols.bb84 as bb84mod
    import app.simulation.rng as rngmod

    original = rngmod.StreamProvider
    rngmod.StreamProvider = ForcedStreams
    try:
        proto = bb84mod.BB84Protocol()
        res = proto.run(ProtocolRunInput(qubit_count=64, channel_noise=0.0, seed=1))
    finally:
        rngmod.StreamProvider = original

    assert res.matching_bases == 64  # all bases match
    assert res.errors == 0
    assert res.sifted_key_bits == "0" * 64


class _ConstantRandom:
    def __init__(self, value: int) -> None:
        self.value = value

    def randint(self, a: int, b: int) -> int:
        return self.value

    def random(self) -> float:
        return 1.0  # never below threshold -> no noise flips


class _ConstantChoice:
    def __init__(self, value: str) -> None:
        self.value = value

    def choice(self, seq):
        return self.value

    def sample(self, population, k):
        return list(population)[:k]


def test_qber_near_channel_noise_without_eve():
    qbers = []
    for seed in range(10):
        res = default_registry().require_supported("BB84").run(
            ProtocolRunInput(qubit_count=1024, channel_noise=0.02, seed=seed)
        )
        qbers.append(res.qber)
    mean = statistics.mean(qbers)
    assert 0.005 <= mean <= 0.05  # centered around ~2% channel noise


# ---- B16 QBER engine ---------------------------------------------------------


def test_qber_boundaries():
    assert compute_qber(0, 100) == 0.0
    assert compute_qber(100, 100) == 1.0
    assert compute_qber(3, 100) == 0.03


def test_qber_zero_denominator_raises():
    with pytest.raises(QberZeroDenominator):
        compute_qber(1, 0)


def test_qber_rounding():
    assert compute_qber(1, 3) == round(1 / 3, 6)
