import { Link } from "react-router-dom";

export function ForbiddenPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-4 text-center">
      <p className="font-mono text-6xl font-bold text-danger">403</p>
      <h1 className="text-lg font-semibold">Role forbidden</h1>
      <p className="max-w-sm text-sm text-muted">
        Your account role does not have access to this zone.
      </p>
      <Link to="/login" className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white">
        Back to sign in
      </Link>
    </div>
  );
}

export function AboutQkdPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-bold">How simulated QKD works</h1>
      <div className="mt-6 max-w-2xl space-y-4 text-sm leading-relaxed text-muted">
        <p>
          Quantum Key Distribution lets two parties build a shared secret key while
          detecting any eavesdropper. This platform simulates the BB84 protocol
          classically: random bits are encoded in randomly chosen rectilinear (R) or
          diagonal (D) bases, transmitted over a noisy simulated channel, and measured
          by the receiver in its own random bases.
        </p>
        <p>
          After transmission both parties compare bases publicly and keep only the bits
          where bases matched — sifting. A random sample of sifted bits is compared to
          estimate the <strong className="text-fg">Quantum Bit Error Rate (QBER)</strong>.
          If QBER stays at or below a configured simulation threshold, the key is accepted
          and used to encrypt your message with AES-GCM. If an eavesdropper intercepts and
          resends qubits, the error rate rises and the security engine blocks delivery.
        </p>
        <p>
          All quantum operations here are Monte-Carlo simulations of measurement
          statistics — no physical quantum hardware is involved. The acceptance threshold
          is a configurable simulation parameter, not a universal physics constant.
        </p>
      </div>
      <Link to="/register" className="mt-8 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white">
        Create an account
      </Link>
    </div>
  );
}
