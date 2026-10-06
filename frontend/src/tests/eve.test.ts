import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { applyLiveEnvelope, invalidationKeysFor } from "../queries/live";
import { ACTIVE_SESSIONS_KEY } from "../queries/keys";
import type { WsEnvelope } from "../types/api";

/**
 * EVE live-visibility regression suite.
 *
 * Requirement: a live USER -> USER communication must appear in the EVE
 * dashboard's Active Communications list WITHOUT a manual browser refresh.
 * The backend emits communication.state_changed when the session enters the
 * attack window, and this bridge must invalidate exactly the query key that
 * useActiveSessions() subscribes with.
 */
function envelope(
  type: WsEnvelope["type"],
  communicationId: number | null = null,
): WsEnvelope {
  return {
    type,
    communication_id: communicationId,
    state: "QKD_INITIALIZING",
    actor_role: "SYSTEM",
    payload: {},
    timestamp: new Date().toISOString(),
  };
}

describe("EVE active-communications live refresh", () => {
  it("state_changed maps to the exact key used by useActiveSessions()", () => {
    const keys = invalidationKeysFor("communication.state_changed");
    expect(keys).toContainEqual([...ACTIVE_SESSIONS_KEY]);
  });

  it("marks ['communications','active'] stale when a session enters the window", () => {
    const qc = new QueryClient();
    qc.setQueryData([...ACTIVE_SESSIONS_KEY], { items: [] });

    applyLiveEnvelope(qc, envelope("communication.state_changed", 42));

    expect(qc.getQueryState([...ACTIVE_SESSIONS_KEY])?.isInvalidated).toBe(true);
  });

  it("still invalidates the active list for creation and attack events", () => {
    for (const type of ["communication.created", "attack.started"] as const) {
      const qc = new QueryClient();
      qc.setQueryData([...ACTIVE_SESSIONS_KEY], { items: [] });

      applyLiveEnvelope(qc, envelope(type, 7));

      expect(qc.getQueryState([...ACTIVE_SESSIONS_KEY])?.isInvalidated).toBe(true);
    }
  });

  it("does not touch the active list for unrelated message-only events", () => {
    const qc = new QueryClient();
    qc.setQueryData([...ACTIVE_SESSIONS_KEY], { items: [] });

    applyLiveEnvelope(qc, envelope("message.read", 7));

    expect(qc.getQueryState([...ACTIVE_SESSIONS_KEY])?.isInvalidated).toBe(false);
  });
});
