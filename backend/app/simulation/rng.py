"""Deterministic-per-seed RNG streams for reproducible simulations (Section 13.2).

Independent sub-streams guarantee that injecting an attacker does not perturb
the random sequences used by Alice/Bob/noise, so a post-attack rerun with the
same seed reproduces the baseline exactly plus Eve's effect only.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from random import Random


@dataclass(frozen=True)
class SimulationSeed:
    value: int

    @staticmethod
    def generate() -> "SimulationSeed":
        return SimulationSeed(secrets.randbits(48))


class StreamProvider:
    """Derives named independent random streams from one master seed."""

    def __init__(self, seed: int) -> None:
        self._seed = seed

    def stream(self, name: str) -> Random:
        return Random(f"{self._seed}:{name}")
