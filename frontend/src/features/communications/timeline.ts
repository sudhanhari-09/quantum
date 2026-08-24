import type { CommState, WsEventType } from "../../core/constants/vocab";

/** One breadcrumb in the live communication timeline (F10). */
export interface TimelineEntry {
  type: WsEventType | string;
  state: CommState;
  previous_state?: CommState;
  timestamp: string;
  detail?: string;
}

export function entryFromEnvelope(e: {
  type: string;
  state: CommState | null;
  previous_state?: CommState | null;
  timestamp: string;
  payload?: Record<string, unknown>;
}): TimelineEntry | null {
  if (!e.state) return null;
  const details = e.payload
    ? Object.entries(e.payload)
        .filter(([k]) => k !== "message_id" && k !== "communication_id")
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join(", ")
    : "";
  return {
    type: e.type,
    state: e.state,
    previous_state: e.previous_state ?? undefined,
    timestamp: e.timestamp,
    detail: details || undefined,
  };
}

const MAX_ENTRIES = 500;

export function appendBounded(
  entries: TimelineEntry[],
  entry: TimelineEntry,
): TimelineEntry[] {
  const next = [...entries, entry];
  return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
}
