import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWs } from "../core/wsContext";
import { useUiStore } from "../core/uiStore";
import type { WsEnvelope } from "../types/api";

/**
 * Single source binding WS event types -> query invalidations (F31).
 * Keys mirror the hooks in queries/hooks.ts.
 */
const INVALIDATIONS: Record<string, string[][]> = {
  "communication.state_changed": [["communications"], ["dashboard", "summary"]],
  "communication.created": [["communications"], ["communications", "active"]],
  "ai.protocol_selected": [["recommendation"]],
  "qkd.started": [["qkd"]],
  "qkd.progress": [],
  "qkd.completed": [["qkd"], ["security"], ["dashboard", "summary"]],
  "qber.calculated": [["qkd"], ["security"]],
  "security.key_accepted": [["security"], ["messages"]],
  "security.key_rejected": [["security"], ["messages"]],
  "attack.started": [["attacks"], ["communications", "active"], ["eve", "summary"]],
  "attack.detected": [
    ["attacks"],
    ["communications"],
    ["messages"],
    ["eve", "summary"],
    ["admin", "summary"],
    ["admin", "security-events"],
  ],
  "message.encrypted": [["messages"]],
  "message.delivered": [["messages", "inbox"], ["dashboard", "summary"]],
  "message.blocked": [["messages", "sent"], ["dashboard", "summary"]],
  "message.read": [["messages"]],
};

function keysFor(type: string): string[][] {
  if (INVALIDATIONS[type]) return INVALIDATIONS[type];
  const prefix = Object.keys(INVALIDATIONS).find((k) => type.startsWith(`${k}.`));
  return prefix ? INVALIDATIONS[prefix]! : [];
}

/** Mount once (inside providers) to keep every live view fresh. */
export function useLiveInvalidation(): void {
  const qc = useQueryClient();
  const subscribe = useWs();

  useEffect(() => {
    return subscribe("*", (envelope: WsEnvelope) => {
      for (const key of keysFor(envelope.type)) {
        void qc.invalidateQueries({ queryKey: key });
      }
      // Communication-scoped queries: ['communications', id]
      if (envelope.communication_id != null) {
        void qc.invalidateQueries({
          queryKey: ["communications", envelope.communication_id],
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
        default:
          break;
      }
    });
  }, [qc, subscribe]);
}
