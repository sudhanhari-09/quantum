import { useEffect, useState } from "react";

interface Props {
  /** Current QBER 0..1 (from backend only). */
  qber: number | null | undefined;
  /** Simulation acceptance threshold 0..1. */
  threshold: number;
  /** Optional baseline QBER for attack before/after comparison. */
  before?: number | null;
  compact?: boolean;
}

function pct(v: number | null | undefined): number {
  const n = Number(v ?? 0);
  return Math.max(0, Math.min(100, n * 100));
}

/**
 * §15 QBER visualization: animated meter with simulation-threshold marker,
 * optional before/after attack comparison. Values are rendered verbatim from
 * backend data — the component computes nothing about security.
 */
export function QberMeter({ qber, threshold, before = null, compact = false }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 60);
    return () => window.clearTimeout(t);
  }, []);

  const value = pct(qber);
  const mark = pct(threshold);
  const breached = qber != null && qber > threshold;

  return (
    <div className={compact ? "" : "rounded-xl border border-border bg-surface p-4"}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          QBER {before != null && <span className="text-danger">· after attack</span>}
        </p>
        <span
          role="status"
          aria-label={`QBER ${value.toFixed(2)} percent`}
          className={`font-mono text-lg font-bold tabular-nums ${
            breached ? "text-danger" : qber == null ? "text-muted" : "text-success"
          }`}
        >
          {qber != null ? `${value.toFixed(2)}%` : "—"}
        </span>
      </div>

      {/* meter */}
      <div
        className="relative mt-2 h-3 overflow-visible rounded-full bg-slate-100"
        role="img"
        aria-label={`QBER meter: ${value.toFixed(2)} percent against ${mark.toFixed(0)} percent simulation threshold`}
      >
        {/* safe zone tint up to threshold */}
        <div
          className="absolute inset-y-0 left-0 rounded-l-full bg-gradient-to-r from-emerald-100 to-emerald-200/70"
          style={{ width: `${mark}%` }}
        />
        {/* value fill */}
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-[900ms] ease-out ${
            breached
              ? "bg-gradient-to-r from-orange-400 to-red-500"
              : "bg-gradient-to-r from-emerald-500 to-emerald-600"
          }`}
          style={{ width: mounted ? `${Math.max(value, 1.5)}%` : "0%" }}
        />
        {/* threshold marker */}
        <div
          className="absolute -top-1 h-5 w-0.5 rounded bg-fg/70"
          style={{ left: `${mark}%` }}
          title={`Simulation threshold ${(threshold * 100).toFixed(0)}%`}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>0%</span>
        <span
          className={`-translate-x-1/2 font-semibold ${breached ? "text-danger" : "text-fg"}`}
          style={{ marginLeft: `${mark}%` }}
        >
          ▲ threshold {(threshold * 100).toFixed(0)}%
        </span>
        <span>100%</span>
      </div>

      {/* before / after */}
      {before != null && (
        <div className="mt-4 space-y-2 border-t border-border pt-3">
          {[
            ["baseline run", pct(before), false],
            ["after intercept", value, true],
          ].map(([label, v, hot]) => (
            <div key={String(label)} className="flex items-center gap-3">
              <span className="w-28 text-right text-xs text-muted">{label}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    hot ? "bg-red-500" : "bg-slate-400"
                  }`}
                  style={{ width: `${v as number}%` }}
                />
              </div>
              <span className={`w-14 font-mono text-xs tabular-nums ${hot ? "font-bold text-danger" : ""}`}>
                {(v as number).toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
