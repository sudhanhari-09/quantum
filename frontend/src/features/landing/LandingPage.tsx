import { useState } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../../components/ui/Logo";

/* ------------------------------------------------------------------ */
/* Hero visual: animated Alice -> Quantum Channel -> Bob               */
/* Purely illustrative; contains no statistics.                        */
/* ------------------------------------------------------------------ */
function HeroVisual() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_24px_60px_-24px_rgba(29,78,216,0.25)]">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 via-blue-400 to-blue-600" aria-hidden="true" />
      <div className="p-5 sm:p-7">
        <div className="mb-4 flex items-center justify-between">
          <span className="rounded-full border border-primary/20 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
            BB84 · live simulation
          </span>
          <span className="font-mono text-xs text-muted">qkd.run(256)</span>
        </div>

        <svg viewBox="0 0 420 150" className="w-full" role="img" aria-label="Alice sends quantum states through a channel to Bob while Eve attempts to intercept">
          <defs>
            <linearGradient id="node-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#1d4ed8" />
            </linearGradient>
          </defs>

          {/* channel */}
          <line x1="70" y1="60" x2="350" y2="60" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="6 6" />
          <text x="210" y="38" textAnchor="middle" fontSize="10" fill="#64748b" letterSpacing="2">
            QUANTUM CHANNEL
          </text>

          {/* photons */}
          <circle r="4" fill="#2563eb">
            <animateMotion dur="2.2s" repeatCount="indefinite" path="M75 60 H345" />
          </circle>
          <circle r="2.6" fill="#60a5fa">
            <animateMotion dur="2.2s" begin="0.7s" repeatCount="indefinite" path="M75 60 H345" />
          </circle>
          <circle r="2" fill="#93c5fd">
            <animateMotion dur="2.2s" begin="1.4s" repeatCount="indefinite" path="M75 60 H345" />
          </circle>

          {/* Alice */}
          <rect x="30" y="34" width="40" height="52" rx="12" fill="url(#node-g)" />
          <text x="50" y="64" textAnchor="middle" fontSize="15" fontWeight="700" fill="#ffffff">A</text>
          <text x="50" y="104" textAnchor="middle" fontSize="10" fontWeight="600" fill="#334155">ALICE</text>
          {/* bases chips */}
          <g fontSize="9" fontWeight="700">
            <rect x="26" y="112" width="22" height="14" rx="4" fill="#eff6ff" stroke="#bfdbfe" />
            <text x="37" y="122" textAnchor="middle" fill="#1d4ed8">↕</text>
            <rect x="52" y="112" width="22" height="14" rx="4" fill="#eff6ff" stroke="#bfdbfe" />
            <text x="63" y="122" textAnchor="middle" fill="#1d4ed8">✕</text>
          </g>

          {/* Bob */}
          <rect x="350" y="34" width="40" height="52" rx="12" fill="#0f172a" />
          <text x="370" y="64" textAnchor="middle" fontSize="15" fontWeight="700" fill="#ffffff">B</text>
          <text x="370" y="104" textAnchor="middle" fontSize="10" fontWeight="600" fill="#334155">BOB</text>
          <g fontSize="9" fontWeight="700">
            <rect x="346" y="112" width="22" height="14" rx="4" fill="#f8fafc" stroke="#e2e8f0" />
            <text x="357" y="122" textAnchor="middle" fill="#64748b">↕</text>
            <rect x="372" y="112" width="22" height="14" rx="4" fill="#f8fafc" stroke="#e2e8f0" />
            <text x="383" y="122" textAnchor="middle" fill="#64748b">✕</text>
          </g>

          {/* Eve interceptor */}
          <g>
            <circle cx="210" cy="96" r="13" fill="#fef2f2" stroke="#dc2626" strokeWidth="1.5" />
            <text x="210" y="100" textAnchor="middle" fontSize="10" fontWeight="800" fill="#dc2626">E</text>
            <line x1="210" y1="83" x2="210" y2="62" stroke="#dc2626" strokeWidth="1.5" strokeDasharray="3 3" />
            <circle cx="210" cy="96" r="17" fill="none" stroke="#dc2626" opacity="0.35">
              <animate attributeName="r" values="14;22;14" dur="2.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.4;0;0.4" dur="2.6s" repeatCount="indefinite" />
            </circle>
            <text x="210" y="124" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#dc2626">EVE · simulated</text>
          </g>
        </svg>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[
            ["Random bits + bases", "Alice encodes"],
            ["Measure & sift", "Bob compares"],
            ["QBER check", "Eve exposed"],
          ].map(([t, s]) => (
            <div key={t} className="rounded-lg border border-border bg-slate-50/80 px-2 py-2.5">
              <p className="text-[11px] font-semibold text-fg">{t}</p>
              <p className="mt-0.5 text-[10px] text-muted">{s}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const NAV_LINKS = [
  ["Home", "#top"],
  ["How It Works", "#how-it-works"],
  ["Security", "#security"],
  ["Protocols", "#protocols"],
  ["About", "#about"],
] as const;

function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" aria-label="QuantumSecure home">
          <Logo subtitle="Quantum Secure Communication" />
        </Link>
        <nav className="hidden items-center gap-7 lg:flex" aria-label="Primary">
          {NAV_LINKS.map(([label, href]) => (
            <a key={href} href={href} className="text-sm font-medium text-muted transition hover:text-fg">
              {label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          <Link to="/login" className="rounded-lg px-4 py-2 text-sm font-semibold text-fg hover:bg-slate-100">
            Sign in
          </Link>
          <Link
            to="/register"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-strong"
          >
            Get started
          </Link>
        </div>
        <button
          className="rounded-md p-2 hover:bg-slate-100 lg:hidden"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>
      {open && (
        <div className="border-t border-border bg-white px-4 pb-4 lg:hidden">
          <nav className="flex flex-col py-2" aria-label="Mobile">
            {NAV_LINKS.map(([label, href]) => (
              <a key={href} href={href} onClick={() => setOpen(false)} className="rounded-md px-2 py-2.5 text-sm font-medium text-muted hover:bg-slate-50 hover:text-fg">
                {label}
              </a>
            ))}
            <hr className="my-2 border-border" />
            <Link to="/login" className="rounded-md px-2 py-2.5 text-sm font-semibold hover:bg-slate-50">
              Sign in
            </Link>
            <Link to="/register" className="mt-1 rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-semibold text-white">
              Create free account
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}

function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
  tint = false,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
  tint?: boolean;
}) {
  return (
    <section id={id} className={tint ? "border-y border-border bg-slate-50/70" : ""}>
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <p className="section-title">{eyebrow}</p>
        <h2 className="mt-2 max-w-2xl text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
        {lead && <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">{lead}</p>}
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Register & receive your QSC ID",
    body: "Create an account and the backend assigns you a unique public identifier — your address on the platform. No phone numbers, no usernames to guess.",
  },
  {
    n: "02",
    title: "Compose a secure message",
    body: "Address a message by QSC ID and pick how much security the communication needs. Content stays in memory until the pipeline secures it.",
  },
  {
    n: "03",
    title: "AI picks the protocol; simulated QKD runs",
    body: "A recommendation engine scores registered protocols against current conditions, then the BB84 engine executes exactly the chosen protocol over a simulated quantum channel.",
  },
  {
    n: "04",
    title: "Key accepted → encrypted delivery",
    body: "If the measured error rate is within the simulation threshold, the sifted key unlocks AES-GCM encryption and delivery. If not, the message is blocked — never delivered.",
  },
];

const FEATURES = [
  {
    icon: "🔑",
    title: "Simulated BB84 engine",
    body: "Ephemeral qubits, random basis choices, measurement statistics and sifting — a faithful Monte-Carlo simulation with seeded determinism.",
  },
  {
    icon: "🧠",
    title: "AI protocol selection",
    body: "A weighted scoring model evaluates noise, risk, distance and efficiency per message, then the recommended protocol is provably the one executed.",
  },
  {
    icon: "🛡️",
    title: "Security engine gate",
    body: "One authoritative service decides acceptance or rejection from real run data. The UI never computes or embellishes security results.",
  },
  {
    icon: "🕵️",
    title: "Eve attack simulation",
    body: "An intercept-and-resend attacker genuinely rewrites stored run data — error rates rise for the right reason, not as theatre.",
  },
  {
    icon: "🔐",
    title: "AES-GCM delivery",
    body: "Accepted keys derive AES-256 keys via HKDF. Ciphertext only ever touches the database; plaintext exists solely in owner-scoped views.",
  },
  {
    icon: "📡",
    title: "Real-time state machine",
    body: "Every lifecycle change streams over WebSocket channels per audience, driving live timelines, dashboards and verdict banners.",
  },
];

const BENEFITS = [
  "Eavesdropping is detectable by design — intercept-and-resend measurably raises QBER.",
  "Blocked messages never reach an inbox; delivery requires an accepted key first.",
  "No role — not even admin — can read message plaintext through any API.",
  "Secret key material never leaves the server in any REST or WebSocket payload.",
  "Every auditable action lands in a complete, inspectable audit trail.",
];

const PROTOCOLS = [
  {
    name: "BB84",
    supported: true,
    body: "Prepare-and-measure protocol with rectilinear/diagonal bases. Fully simulated end-to-end: qubits, sifting, error estimation and key acceptance.",
  },
  {
    name: "B92",
    supported: false,
    body: "Two-state prepare-and-measure variant. Registered in the protocol registry, ready for a full engine implementation.",
  },
  {
    name: "E91",
    supported: false,
    body: "Entanglement-based protocol requiring a correlated-pair phase. Flagged as not-supported in v1.",
  },
  {
    name: "SIX_STATE",
    supported: false,
    body: "Three-basis extension of BB84 offering stronger disturbance sensitivity.",
  },
  {
    name: "SARG04",
    supported: false,
    body: "Encoding compatible with BB84 hardware using different sifting logic.",
  },
  {
    name: "DECOY_BB84",
    supported: false,
    body: "Decoy-state extension hardening against photon-number-splitting attacks.",
  },
];

export function LandingPage() {
  return (
    <div id="top" className="min-h-screen bg-bg">
      <Navbar />

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-blue-50 via-bg to-bg"
        />
        {/* soft background motion */}
        <div aria-hidden="true" className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-blue-100/60 blur-3xl anim-drift" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-cyan-100/50 blur-3xl anim-drift" style={{ animationDelay: "-6s" }} />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-2 lg:gap-16 lg:px-8">
          <div>
            <span className="anim-enter inline-flex items-center gap-2 rounded-full border border-primary/20 bg-blue-50 px-3 py-1 text-xs font-semibold text-primary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" aria-hidden="true" />
              Final-year project · AI × Quantum Security
            </span>
            <h1 className="anim-enter mt-5 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl" style={{ animationDelay: "90ms" }}>
              Quantum-safe messaging,
              <span className="bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-transparent">
                {" "}
                proven end to end.
              </span>
            </h1>
            <p className="anim-enter mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg" style={{ animationDelay: "180ms" }}>
              QuantumSecure demonstrates how quantum key distribution, AI-driven
              protocol selection and standard AES-GCM encryption combine into one
              secure communication pipeline — complete with an eavesdropper that
              gets caught by physics, not by promises.
            </p>
            <div className="anim-enter mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: "270ms" }}>
              <Link
                to="/register"
                className="rounded-xl bg-primary px-6 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition-all hover:-translate-y-0.5 hover:bg-primary-strong hover:shadow-xl hover:shadow-blue-600/25"
              >
                Create free account
              </Link>
              <Link
                to="/login"
                className="rounded-xl border border-border bg-surface px-6 py-3 text-sm font-bold text-fg shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary hover:text-primary"
              >
                Sign in
              </Link>
            </div>
            <dl className="anim-enter mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-border pt-6" style={{ animationDelay: "360ms" }}>
              {[
                ["BB84", "simulated protocol"],
                ["AES-GCM", "payload encryption"],
                ["WebSocket", "live state machine"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-sm font-bold text-fg">{k}</dt>
                  <dd className="mt-0.5 text-xs text-muted">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="anim-enter" style={{ animationDelay: "220ms" }}>
            <HeroVisual />
          </div>
        </div>
      </section>

      {/* INTRODUCTION */}
      <Section
        id="overview"
        eyebrow="Project introduction"
        title="A software-only demonstration of quantum-secured communication."
        lead="No quantum hardware, no blockchain, no gimmicks — just a rigorous classical simulation of how quantum key distribution works, wired into a production-style application with roles, reports and real-time monitoring."
      >
        <div className="grid gap-6 lg:grid-cols-3">
          {[
            {
              t: "The idea",
              b: "Two parties build a shared secret key by exchanging quantum states whose privacy is guaranteed by measurement disturbance itself. Anyone listening changes the statistics — and gets caught.",
            },
            {
              t: "The platform",
              b: "Users register, exchange messages addressed by QSC ID, and watch each message travel a full state machine: verification, AI protocol choice, QKD run, security decision, encryption and delivery.",
            },
            {
              t: "The honesty rule",
              b: "Every number in the UI comes from persisted simulation runs. Thresholds are labelled simulation parameters. The platform claims simulation, never physical interception.",
            },
          ].map((c) => (
            <div key={c.t} className="card p-6">
              <h3 className="text-base font-bold">{c.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{c.b}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* HOW IT WORKS */}
      <Section
        id="how-it-works"
        eyebrow="How it works"
        title="From compose to delivery in four governed steps."
        lead="A backend-owned state machine validates every transition, so the UI can only ever show what actually happened."
        tint
      >
        <ol className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="card relative p-6">
              <span className="font-mono text-sm font-extrabold text-primary">{s.n}</span>
              <h3 className="mt-3 text-sm font-bold leading-snug">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* QKD EXPLANATION */}
      <Section
        id="qkd"
        eyebrow="Quantum key distribution"
        title="BB84, simulated honestly."
        lead="Each run generates hundreds of qubits whose fates are computed, compared and stored — so the error rate you see is earned, not asserted."
      >
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="card p-6">
            <ol className="space-y-4">
              {[
                ["Random bits & bases", "Alice generates random bits and encodes each in a randomly chosen rectilinear (↕) or diagonal (✕) basis."],
                ["Transmission & measurement", "States cross the simulated channel; Bob measures each in his own random basis."],
                ["Sifting", "Both sides reveal bases publicly and keep only positions where they matched."],
                ["Error estimation", "A sample of the sifted bits is compared. Mismatches give the quantum bit error rate (QBER)."],
                ["Decision", "QBER within threshold → key accepted and used for encryption. Above it → rejected and the message blocked."],
              ].map(([t, b], i) => (
                <li key={t} className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 font-mono text-xs font-bold text-primary ring-1 ring-blue-100">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-bold">{t}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-muted">{b}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="space-y-4">
            <div className="card p-6">
              <p className="section-title">Why eavesdropping shows up</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                In BB84&apos;s idealized channel, an interceptor who measures in the wrong
                basis must guess, and guesses corrupt roughly a quarter of intercepted
                bits. The simulation reproduces exactly this signature: more
                interception, higher QBER, near-certain detection.
              </p>
            </div>
            <div className="card border-primary/20 bg-gradient-to-br from-blue-50/80 to-surface p-6">
              <p className="section-title">Simulation threshold</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Acceptance uses a configurable{" "}
                <strong className="text-fg">simulation threshold</strong> (default 11%).
                It demonstrates the decision mechanics of QKD systems — it is not
                presented as a universal physics constant.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* AI SELECTION */}
      <Section
        id="ai"
        eyebrow="AI protocol recommendation"
        title="Every message gets a reasoned protocol choice."
        lead="A weighted scoring engine evaluates live conditions per message, ranks every registered protocol, and persists its full feature snapshot for audit."
        tint
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <div className="card overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">Feature</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">Answers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  ["Channel noise", "How noisy is the simulated link right now?"],
                  ["Security requirement", "LOW / MEDIUM / HIGH chosen by the sender"],
                  ["Attack risk", "Recent detected attacks raise caution"],
                  ["Distance & efficiency", "Route length vs expected key rate"],
                  ["Protocol maturity", "Registry metadata per protocol"],
                ].map(([f, d]) => (
                  <tr key={f}>
                    <td className="px-5 py-3 font-semibold">{f}</td>
                    <td className="px-5 py-3 text-muted">{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-4">
            <ul className="space-y-3">
              {[
                "Scores, confidence and explanations are computed from inputs — never hard-coded.",
                "The invariant is enforced end to end: the recommended protocol is the executed protocol.",
                "Weights live in admin-managed configuration; changing them changes future recommendations.",
                "v1 executes BB84; other protocols register as auditable stubs ready to slot in.",
              ].map((b) => (
                <li key={b} className="flex gap-3 text-sm leading-relaxed text-muted">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  {b}
                </li>
              ))}
            </ul>
            <div className="card p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">What you see in the UI</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                A live panel with the chosen protocol, confidence bar, per-protocol
                score chart and the feature snapshot that produced the decision —
                rendered verbatim from the recommendation record.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* SECURITY / EVE */}
      <Section
        id="security"
        eyebrow="Security & detection"
        title="Meet Eve. Watch her get caught."
        lead="A dedicated attacker role observes eligible sessions and launches a simulated intercept-and-resend attack. Because the attack rewrites actual run data, detection follows from measurement — not from scripting."
      >
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              k: "1 · Observe",
              t: "Metadata only",
              b: "Eve sees which sessions are inside the attack window — identifiers, participants' names, protocol and state. No ciphertext, keys or content, ever, by API construction.",
            },
            {
              k: "2 · Attack",
              t: "Intercept & resend",
              b: "She picks a strength from 10–100%. The engine re-runs the stored simulation with her measurements injected, producing new counters and a recomputed QBER.",
            },
            {
              k: "3 · Verdict",
              t: "Detected & blocked",
              b: "If post-attack QBER crosses the threshold: key rejected, message blocked before delivery, report written, admins alerted in real time.",
            },
          ].map((c) => (
            <div key={c.k} className="card p-6">
              <span className="inline-block rounded-full border border-danger/20 bg-red-50 px-2.5 py-0.5 text-[11px] font-bold text-danger">
                {c.k}
              </span>
              <h3 className="mt-3 text-base font-bold">{c.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{c.b}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <div className="card p-6">
            <h3 className="text-base font-bold">Key features</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {FEATURES.map((f) => (
                <div key={f.title} className="flex gap-3">
                  <span aria-hidden="true" className="text-xl">{f.icon}</span>
                  <div>
                    <p className="text-sm font-bold">{f.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted">{f.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card border-success/25 bg-gradient-to-br from-emerald-50/60 to-surface p-6">
            <h3 className="text-base font-bold">Security benefits</h3>
            <ul className="mt-4 space-y-3">
              {BENEFITS.map((b) => (
                <li key={b} className="flex gap-3 text-sm leading-relaxed text-muted">
                  <svg viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0 text-success" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.3a1 1 0 00-1.4-1.4L9 10.6 7.7 9.3a1 1 0 00-1.4 1.4l2 2a1 1 0 001.4 0l4-4z" clipRule="evenodd" />
                  </svg>
                  {b}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* PROTOCOLS */}
      <Section
        id="protocols"
        eyebrow="Protocol registry"
        title="One runnable protocol today. A registry built for tomorrow."
        lead="The backend maintains a pluggable protocol registry — adding a future protocol means registering one module, and the AI scorer, execution engine and analytics pick it up automatically."
        tint
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROTOCOLS.map((p) => (
            <div
              key={p.name}
              className={`card card-hover p-5 ${p.supported ? "ring-1 ring-primary/25" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-base font-extrabold">{p.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${
                    p.supported ? "bg-success/10 text-success" : "bg-slate-100 text-muted"
                  }`}
                >
                  {p.supported ? "RUNNABLE IN V1" : "REGISTERED STUB"}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ABOUT */}
      <Section
        id="about"
        eyebrow="About the project"
        title="Built to capstone standards, honest by design."
        lead="QuantumSecure is a final-year project at the intersection of artificial intelligence, quantum communication and cybersecurity engineering."
      >
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted">
              The platform pairs a React front end with contract-first API and
              WebSocket layers, so every visualization is bound to real persisted
              state: communication lifecycles, QKD run records, attack outcomes,
              security reports and audit trails.
            </p>
            <p className="text-sm leading-relaxed text-muted">
              Three flows carry the experience:{" "}
              <strong className="text-fg">Alice → Quantum Channel → Bob</strong> for
              live key exchange,{" "}
              <strong className="text-fg">AI recommendation → actual protocol execution</strong>{" "}
              for intelligent selection, and{" "}
              <strong className="text-fg">Eve interception → QBER change → detection → blocking</strong>{" "}
              for security under attack.
            </p>
            <p className="rounded-lg border border-border bg-slate-50/80 px-4 py-3 text-xs leading-relaxed text-muted">
              Simulation honesty: all quantum operations are classical Monte-Carlo
              simulations of measurement statistics. Thresholds are labelled
              simulation parameters. The platform never claims physical interception.
            </p>
          </div>
          <div className="card p-6">
            <p className="section-title">Engineering stack</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                "React 18",
                "TypeScript",
                "Tailwind CSS",
                "TanStack Query",
                "WebSocket live events",
                "Recharts",
                "AES-256-GCM + HKDF",
                "Role-based access",
                "Audit trail",
              ].map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-border bg-slate-50 px-3 py-1 text-xs font-medium text-fg/80"
                >
                  {t}
                </span>
              ))}
            </div>
            <hr className="my-5 border-border" />
            <p className="section-title">Roles in the demo</p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <li><strong className="text-primary">USER</strong> — registers, exchanges secure messages, monitors sessions.</li>
              <li><strong className="text-danger">ATTACKER</strong> — observes eligible sessions and launches simulated intercept-and-resend.</li>
              <li><strong className="text-warning">ADMIN</strong> — platform analytics, user management, security monitoring, audit.</li>
            </ul>
          </div>
        </div>
      </Section>

      {/* CTA */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-strong via-primary to-blue-500 px-6 py-14 text-center shadow-xl sm:px-16">
            <div aria-hidden="true" className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
            <h2 className="relative text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              Run your own eavesdropping experiment.
            </h2>
            <p className="relative mx-auto mt-3 max-w-xl text-sm leading-relaxed text-blue-100 sm:text-base">
              Register in seconds, send a secure message, then sign in as the
              attacker and try to break it. The physics decides who wins.
            </p>
            <div className="relative mt-8 flex flex-wrap justify-center gap-3">
              <Link to="/register" className="rounded-xl bg-white px-6 py-3 text-sm font-bold text-primary shadow-lg transition hover:bg-blue-50">
                Create free account
              </Link>
              <Link to="/about-qkd" className="rounded-xl border border-white/40 px-6 py-3 text-sm font-bold text-white transition hover:bg-white/10">
                How QKD works
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid gap-10 md:grid-cols-4">
            <div className="md:col-span-2">
              <Logo size="sm" subtitle="Final-year capstone" />
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">
                A software simulation of quantum key distribution, AI-assisted
                protocol selection and authenticated encryption, built to
                final-year academic standards with honest, data-driven visuals.
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-fg">Product</p>
              <ul className="mt-3 space-y-2 text-sm text-muted">
                <li><Link to="/register" className="hover:text-primary">Register</Link></li>
                <li><Link to="/login" className="hover:text-primary">Sign in</Link></li>
                <li><a href="#how-it-works" className="hover:text-primary">How it works</a></li>
                <li><a href="#security" className="hover:text-primary">Attack detection</a></li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-fg">Technology</p>
              <ul className="mt-3 space-y-2 text-sm text-muted">
                <li><a href="#qkd" className="hover:text-primary">BB84 simulation</a></li>
                <li><a href="#ai" className="hover:text-primary">AI protocol engine</a></li>
                <li><a href="#protocols" className="hover:text-primary">Protocol registry</a></li>
                <li><Link to="/about-qkd" className="hover:text-primary">QKD primer</Link></li>
                <li>AES-256-GCM · HKDF</li>
              </ul>
            </div>
          </div>
          <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 sm:flex-row">
            <p className="text-xs text-muted">
              © {new Date().getFullYear()} QuantumSecure · QSC Platform. All quantum operations are simulations.
            </p>
            <p className="font-mono text-[11px] text-muted">React · FastAPI-ready contracts · WebSocket live</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
