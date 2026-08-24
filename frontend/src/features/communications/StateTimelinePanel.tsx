import { useEffect, useState } from "react";
import { Card } from "../../components/ui/Card";
import { Timeline } from "../../components/ui/Timeline";
import { LiveIndicator, ReconnectBanner } from "../../components/ui/FeedbackGlobal";
import { useWs } from "../../core/wsContext";
import { appendBounded, entryFromEnvelope, type TimelineEntry } from "./timeline";
import { useTimeline } from "../../queries/hooks";

/** F10 — live state-machine timeline fed by WS + REST bootstrap. */
export function StateTimelinePanel({ communicationId }: { communicationId: number }) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const subscribe = useWs();
  const { data: boot } = useTimeline(communicationId);

  // Bootstrap from REST replay (safety net on mount/reconnect).
  useEffect(() => {
    if (!boot) return;
    setEntries(
      boot.events.map((e) =>
        entryFromEnvelope({
          type: e.type,
          state: e.state,
          previous_state: e.previous_state,
          timestamp: e.timestamp,
        }),
      ).filter((e): e is TimelineEntry => e != null),
    );
  }, [boot]);

  useEffect(() => {
    if (paused) return undefined;
    return subscribe("communication.state_changed", (env) => {
      if (env.communication_id !== communicationId && env.communication_id != null)
        return;
      const entry = entryFromEnvelope(env);
      if (entry) setEntries((prev) => appendBounded(prev, entry));
    });
  }, [subscribe, communicationId, paused]);

  return (
    <Card className="p-5" aria-label="Live timeline">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Live timeline
        </h3>
        <div className="flex items-center gap-3">
          <LiveIndicator />
          <button
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:text-fg"
          >
            {paused ? "resume" : "pause"}
          </button>
        </div>
      </div>
      <div className="mt-3">
        <ReconnectBanner />
        <Timeline entries={entries} />
      </div>
    </Card>
  );
}
