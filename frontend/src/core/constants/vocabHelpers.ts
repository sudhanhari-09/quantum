import {
  STATE_TO_MESSAGE_STATUS,
  type CommState,
  type MessageStatus,
} from "./vocab";

export * from "./vocab";

/** Safe derived-status lookup; unknown values never crash the UI (Sec 09). */
export function messageStatusFor(state: CommState | string): MessageStatus {
  return STATE_TO_MESSAGE_STATUS[state as CommState] ?? "PENDING";
}
