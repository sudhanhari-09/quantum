import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useWs } from "../core/wsContext";
import { useUiStore } from "../core/uiStore";
import { ACTIVE_SESSIONS_KEY } from "./keys";
import type { WsEnvelope } from "../types/api";

/**
 * Single source binding WS event types -> query invalidations (F31).
 * Keys mirror the hooks in queries/hooks.ts.
 */
const INVALIDATIONS: Record<string, string[][]> = {
  // EVE's Active Communications list must react to the window OPENING, not only
  // to session creation: communication.state_changed fires on every transition
  // (including PROTOCOL_SELECTED -> QKD_INITIALIZING), which is what makes a
  // live USER->USER session appear without any manual browser refresh.
  "communication.state_changed": [
    [...ACTIVE_SESSIONS_KEY],
    ["communications"],
    ["dashboard", "summary"],
    ["eve", "summary"],
    ["admin", "summary"],
  ],
  "communication.created": [["communications"], ["communications", "active"], ["dashboard", "summary"], ["eve", "summary"]],
  "ai.analysis_started": [["communications"], ["recommendation"]],
  "ai.protocol_selected": [["recommendation"], ["communications"]],
  "qkd.started": [["qkd"], ["communications"], ["dashboard", "summary"]],
  "qkd.progress": [["qkd"], ["communications"]],
  "qkd.completed": [["qkd"], ["security"], ["dashboard", "summary"], ["communications"], ["eve", "summary"]],
  "qber.calculated": [["qkd"], ["security"], ["communications"], ["eve", "summary"]],
  "security.check_started": [["security"]],
  "security.key_accepted": [["security"], ["messages"], ["communications"], ["dashboard", "summary"]],
  "security.key_rejected": [["security"], ["messages"], ["communications"], ["dashboard", "summary"]],
  "attack.started": [["attacks"], ["communications", "active"], ["eve", "summary"], ["dashboard", "summary"]],
  "attack.progress": [["attacks"], ["communications"], ["eve", "summary"]],
  "attack.detected": [
    ["attacks"],
    ["communications"],
    ["messages"],
    ["eve", "summary"],
    ["admin", "summary"],
    ["admin", "security-events"],
    ["dashboard", "summary"],
  ],
  "message.encrypted": [["messages"], ["communications"]],
  "message.delivered": [["messages", "inbox"], ["dashboard", "summary"], ["communications"]],
  "message.blocked": [["messages", "sent"], ["dashboard", "summary"], ["communications"]],
  "message.read": [["messages"]],
  "protocol.adaptive_retry": [["communications"], ["recommendation"], ["qkd"]],
};

/** Keys invalidated by one WS event type (exact match or family prefix). */
export function invalidationKeysFor(type: string): string[][] {
  if (INVALIDATIONS[type]) return INVALIDATIONS[type];
  const prefix = Object.keys(INVALIDATIONS).find((k) => type.startsWith(`${k}.`));
  return prefix ? INVALIDATIONS[prefix]! : [];
}

/**
 * Applies one WS envelope to the query cache (single code path shared by the
 * provider and the tests): invalidate the mapped keys, every communication-
 * scoped query for the envelope's communication, then surface the toast.
 */
export function applyLiveEnvelope(qc: QueryClient, envelope: WsEnvelope): void {
  for (const key of invalidationKeysFor(envelope.type)) {
    void qc.invalidateQueries({ queryKey: key });
  }
  // Communication-scoped queries: ['communications', id]
  if (envelope.communication_id != null) {
    void qc.invalidateQueries({
      queryKey: ["communications", envelope.communication_id],
    });
    // Also invalidate communication-specific sub-queries
    void qc.invalidateQueries({
      queryKey: ["qkd", envelope.communication_id],
    });
    void qc.invalidateQueries({
      queryKey: ["security", envelope.communication_id],
    });
    void qc.invalidateQueries({
      queryKey: ["recommendation", envelope.communication_id],
    });
    void qc.invalidateQueries({
      queryKey: ["timeline", envelope.communication_id],
    });
  }
  const pushToast = useUiStore.getState().pushToast;
  switch (envelope.type) {
    case "message.delivered":
      pushToast("success", "A message was delivered securely.");
      break;
    case "message.blocked":
      pushToast("error", "A message was blocked after attack detection.");
      break;
    case "attack.detected":
      pushToast("error", "Eavesdropping detected on a communication.");
      break;
    case "attack.started":
      pushToast("warning", "An attack simulation has started on a communication.");
      break;
    case "protocol.adaptive_retry":
      pushToast("info", "AI recommended a protocol switch due to security concerns.");
      break;
    default:
      break;
  }
}

/** Mount once (inside providers) to keep every live view fresh. */
export function useLiveInvalidation(): void {
  const qc = useQueryClient();
  const subscribe = useWs();

  useEffect(() => {
    return subscribe("*", (envelope: WsEnvelope) => applyLiveEnvelope(qc, envelope));
  }, [qc, subscribe]);
}
