import type { TimelineEntry } from "../../features/communications/timeline";
import { STATE_GROUPS, type StateGroup } from "../../core/constants/vocab";

const dotColor: Record<StateGroup, string> = {
  preparation: "bg-primary",
  qkd: "bg-cyan-400",
  security: "bg-warning",
  secure: "bg-success",
  attack: "bg-danger",
  failure: "bg-slate-500",
};

export interface TimelineProps {
  entries: TimelineEntry[];
}

/** Event breadcrumb timeline driven purely by WS/REST events (F10). */
export function Timeline({ entries }: TimelineProps) {
  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted">
        Awaiting first event…
      </p>
    );
  }
  return (
    <ol className="relative space-y-3 border-l border-border pl-5">
      {entries.map((e, i) => (
        <li key={`${e.timestamp}-${e.type}-${i}`} className="relative">
          <span
            aria-hidden="true"
            className={`absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-surface ${
              dotColor[STATE_GROUPS[e.state]] ?? "bg-muted"
            }`}
          />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-xs text-fg">{e.type}</span>
            <span className="text-[11px] uppercase tracking-wide text-muted">
              → {e.state.replace(/_/g, " ")}
            </span>
            <time className="ml-auto font-mono text-[11px] text-muted">
              {new Date(e.timestamp).toLocaleTimeString()}
            </time>
          </div>
          {e.detail && <p className="mt-0.5 text-xs text-muted">{e.detail}</p>}
        </li>
      ))}
    </ol>
  );
}
