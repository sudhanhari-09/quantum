import { describe, expect, it } from "vitest";
import { appendBounded, entryFromEnvelope, type TimelineEntry } from "../features/communications/timeline";
import { simulateBb84Like } from "./bb84Fixture";

describe("timeline helpers (F10)", () => {
  it("creates entries from envelopes and drops null-state ones", () => {
    const ok = entryFromEnvelope({
      type: "communication.state_changed",
      state: "CREATED",
      timestamp: "2026-08-22T10:00:00Z",
      payload: { state: "CREATED" },
    });
    expect(ok).not.toBeNull();
    const dropped = entryFromEnvelope({
      type: "qkd.progress",
      state: null,
      timestamp: "2026-08-22T10:00:01Z",
    });
    expect(dropped).toBeNull();
  });

  it("bounds the timeline to 500 entries", () => {
    let entries: TimelineEntry[] = Array.from({ length: 500 }, (_, i) => ({
      type: "t",
      state: "CREATED" as const,
      timestamp: String(i),
    }));
    entries = appendBounded(entries, {
      type: "t",
      state: "CREATED",
      timestamp: "new",
    });
    expect(entries).toHaveLength(500);
    expect(entries[entries.length - 1]!.timestamp).toBe("new");
  });
});

describe("mock BB84 simulation sanity (R7-aligned)", () => {
  it("is deterministic per seed", () => {
    const a = simulateBb84Like(7);
    const b = simulateBb84Like(7);
    expect(a.errors).toBe(b.errors);
    expect(a.qber).toBe(b.qber);
  });

  it("attack rerun raises errors vs baseline for same seed", () => {
    const baseline = simulateBb84Like(11, false, 0);
    const attacked = simulateBb84Like(11, false, 1.0);
    expect(attacked.errors).toBeGreaterThanOrEqual(baseline.errors);
  });
});
