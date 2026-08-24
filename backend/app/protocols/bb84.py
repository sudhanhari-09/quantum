"""BB84 protocol simulation (B14) — classical Monte-Carlo per Section 13.2.

Steps: Alice bits/bases -> encode -> channel noise -> [optional Eve
intercept-and-resend] -> Bob bases + measurement -> basis comparison ->
sifting -> error counting -> QBER. All randomness from seeded independent
streams (deterministic per seed; Eve injection does not perturb other streams).
"""

from __future__ import annotations

from app.protocols.base import ProtocolBase, ProtocolRunInput, ProtocolRunResult

BASIS_Z = "Z"  # rectilinear
BASIS_X = "X"  # diagonal


class BB84Protocol(ProtocolBase):
    name = "BB84"
    requires_entanglement = False
    supported = True

    def run(self, params: ProtocolRunInput) -> ProtocolRunResult:
        from app.simulation.rng import StreamProvider

        n = params.qubit_count
        if n <= 0:
            raise ValueError("qubit_count must be positive")
        streams = StreamProvider(params.seed)

        # 1-2. Alice random bits and bases (own streams)
        rng_alice_bits = streams.stream("alice_bits")
        rng_alice_bases = streams.stream("alice_bases")
        a_bits = [rng_alice_bits.randint(0, 1) for _ in range(n)]
        a_bases = [rng_alice_bases.choice((BASIS_Z, BASIS_X)) for _ in range(n)]

        # 4. Channel noise flips on transmission
        rng_noise = streams.stream("channel_noise")
        transmitted = [
            bit ^ (1 if rng_noise.random() < params.channel_noise else 0) for bit in a_bits
        ]

        # [Attack path] Eve intercept-and-resend on round(p*n) qubits.
        eve_touched = [False] * n
        effective_states = list(zip(transmitted, a_bases))
        if params.eve_fraction > 0:
            rng_eve_pick = streams.stream("eve_pick")
            rng_eve_basis = streams.stream("eve_basis")
            rng_eve_outcome = streams.stream("eve_outcome")
            k = round(params.eve_fraction * n)
            targets = rng_eve_pick.sample(range(n), min(k, n))
            for i in targets:
                e_basis = rng_eve_basis.choice((BASIS_Z, BASIS_X))
                t_bit, t_basis = effective_states[i]
                # Eve measures the simulated state in her random basis:
                if e_basis == t_basis:
                    outcome = t_bit
                else:
                    outcome = rng_eve_outcome.randint(0, 1)
                # ...and resends what she measured, in her basis.
                effective_states[i] = (outcome, e_basis)
                eve_touched[i] = True

        # 5-6. Bob bases + measurement with standard BB84 rules
        rng_bob_bases = streams.stream("bob_bases")
        rng_bob_measure = streams.stream("bob_measure")
        b_bases = [rng_bob_bases.choice((BASIS_Z, BASIS_X)) for _ in range(n)]
        b_bits: list[int] = []
        for i in range(n):
            t_bit, t_basis = effective_states[i]
            if b_bases[i] == t_basis:
                b_bits.append(t_bit)  # correct basis -> deterministic outcome
            else:
                b_bits.append(rng_bob_measure.randint(0, 1))  # wrong basis -> 50/50

        # 7. Basis comparison / sifting (keep indices where bases match Alice)
        kept = [i for i in range(n) if a_bases[i] == b_bases[i]]
        sifted_alice = "".join(str(a_bits[i]) for i in kept)

        # 9-10. Error estimation over the compared sample (all sifted when small)
        compare_limit = max(n * 2, 512)
        sample = kept if len(kept) <= compare_limit else kept[:compare_limit]
        errors = sum(1 for i in sample if a_bits[i] != b_bits[i])
        compared_bits = len(sample)
        qber = errors / compared_bits if compared_bits else 0.0

        return ProtocolRunResult(
            protocol=self.name,
            seed=params.seed,
            qubits_generated=n,
            matching_bases=len(kept),
            sifted_bits=len(sifted_alice),
            compared_bits=compared_bits,
            errors=errors,
            qber=qber,
            alice_bits=a_bits,
            alice_bases=a_bases,
            bob_bases=b_bases,
            bob_bits=b_bits,
            eve_touched=eve_touched,
            sifted_key_bits=sifted_alice,
        )
