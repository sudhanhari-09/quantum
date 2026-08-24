import { Card } from "../../../components/ui/Card";
import { Skeleton } from "../../../components/ui/Feedback";
import { useRecommendation } from "../../../queries/hooks";
import type { CommState } from "../../../core/constants/vocab";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

const COLORS = ["#1d4ed8", "#3b82f6", "#60a5fa", "#93c5fd", "#cbd5e1"];

const PIPELINE = [
  "analyzing communication",
  "ai evaluation",
  "protocol comparison",
  "recommendation",
  "protocol execution",
] as const;

function pipelineStage(state: CommState | null | undefined): number {
  if (!state || ["CREATED", "RECEIVER_VERIFIED"].includes(state)) return -1;
  if (state === "AI_ANALYZING") return 1;
  if (state === "PROTOCOL_SELECTED") return 3;
  // from QKD_INITIALIZING onward the recommendation is being executed
  return 4;
}

/** §11 — AI recommendation panel; renders backend payload only. */
export function RecommendationPanel({
  communicationId,
  sessionState = null,
}: {
  communicationId: number;
  sessionState?: CommState | null;
}) {
  const { data, isError } = useRecommendation(communicationId);
  const stage = pipelineStage(sessionState);

  if (isError && !data) return null;

  /* analyzing state — backend has not persisted a recommendation yet */
  if (!data) {
    if (stage >= 0) {
      return (
        <Card className="p-5" aria-label="AI analysis in progress">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
            AI protocol recommendation
          </h3>
          <ol className="mt-4 space-y-2.5" aria-live="polite">
            {PIPELINE.slice(0, 2).map((label, i) => (
              <li key={label} className="flex items-center gap-3 text-sm">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-bold ${
                    i < stage
                      ? "border-success bg-success/10 text-success"
                      : "animate-pulse border-primary bg-primary/10 text-primary"
                  }`}
                  aria-hidden="true"
                >
                  {i < stage ? "✓" : i + 1}
                </span>
                <span className={i <= stage ? "font-medium capitalize text-fg" : "capitalize text-muted"}>
                  {label}
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex items-center gap-3" role="status">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted">Analyzing communication conditions…</p>
          </div>
        </Card>
      );
    }
    return null;
  }

  const scores = Object.entries(data.scores).map(([protocol, score]) => ({
    protocol,
    score: Number((Number(score) * 100).toFixed(0)),
  }));
  const executed = stage === 4;

  return (
    <Card className="p-5 anim-pop" aria-label="AI protocol recommendation">
      {/* pipeline header */}
      <ol className="flex flex-wrap items-center gap-1" aria-label="Recommendation pipeline">
        {PIPELINE.map((label, i) => (
          <li key={label} className="flex items-center gap-1">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                i <= stage
                  ? i === PIPELINE.length - 1 && executed
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted/60"
              }`}
            >
              {i < stage ? "✓ " : ""}
              {label}
            </span>
            {i < PIPELINE.length - 1 && <span aria-hidden="true" className="text-slate-300">→</span>}
          </li>
        ))}
      </ol>

      <div className="mt-4 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Recommended protocol
        </h3>
        <span className="rounded bg-blue-50 px-2 py-0.5 font-mono text-xs font-bold text-primary ring-1 ring-blue-100">
          {data.protocol}
        </span>
      </div>

      {/* confidence */}
      <div className="mt-3 flex items-center gap-4">
        <div className="min-w-[150px]">
          <span className="font-mono text-2xl font-extrabold tabular-nums">
            {(data.confidence * 100).toFixed(0)}%
          </span>
          <span className="ml-1 text-xs text-muted">confidence</span>
        </div>
        <div
          className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-valuenow={Math.round(data.confidence * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-800 transition-[width] duration-700"
            style={{ width: `${(data.confidence * 100).toFixed(0)}%` }}
          />
        </div>
      </div>

      <p className="mt-3 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2 text-sm leading-relaxed text-fg/80">
        <BrainGlyph /> {data.explanation}
      </p>

      {/* invariant communication: recommendation == execution */}
      {executed ? (
        <div role="status" className="mt-3 flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-xs text-success">
          <CheckMark /> Executing recommended protocol{" "}
          <strong className="font-mono">{data.protocol}</strong> — recommendation matches the engine input.
        </div>
      ) : (
        <div role="status" className="mt-3 flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-primary">
          <CheckMark /> The QKD engine will execute exactly this protocol.
        </div>
      )}

      {scores.length > 0 && (
        <div className="mt-4 h-36">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={scores} layout="vertical" margin={{ left: 4 }}>
              <XAxis type="number" domain={[0, 100]} hide />
              <YAxis
                type="category"
                dataKey="protocol"
                width={84}
                tick={{ fill: "#64748b", fontSize: 11 }}
              />
              <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={14}>
                {scores.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {Object.entries(data.features).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-border/50 py-1">
            <dt className="text-muted">{k.replace(/_/g, " ")}</dt>
            <dd className="font-mono">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export function RecommendationSkeleton() {
  return <Skeleton className="h-48" />;
}

/* tiny inline glyphs */
function BrainGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="mr-1 inline h-4 w-4 align-text-bottom text-primary" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4a4 4 0 00-4 4 3 3 0 00-2.83 4A3 3 0 007 17.83 3.5 3.5 0 0012 20V4z" />
      <path d="M12 4a4 4 0 014 4 3 3 0 012.83 4A3 3 0 0117 17.83 3.5 3.5 0 0112 20" />
    </svg>
  );
}
function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" className="inline h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" strokeWidth="1.8" />
      <path d="M8.5 12.2l2.4 2.4 4.6-5" />
    </svg>
  );
}
