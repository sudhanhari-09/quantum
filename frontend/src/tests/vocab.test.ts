import { describe, expect, it } from "vitest";
import {
  COMM_STATES,
  STATE_TO_MESSAGE_STATUS,
  STATE_TO_KEY_STATUS,
  STATE_GROUPS,
  QSC_ID_REGEX,
  messageStatusFor,
} from "../core/constants/vocabHelpers";

describe("shared vocabulary (R3)", () => {
  it("exposes the exact 18-state machine vocabulary", () => {
    expect(COMM_STATES).toHaveLength(18);
    expect(COMM_STATES[0]).toBe("CREATED");
    expect(COMM_STATES).toContain("BLOCKED");
    expect(COMM_STATES).toContain("FAILED");
  });

  it("maps every state to a derived message status (Section 08)", () => {
    for (const s of COMM_STATES) {
      expect(STATE_TO_MESSAGE_STATUS[s]).toBeTruthy();
      expect(STATE_TO_KEY_STATUS[s]).toBeTruthy();
      expect(STATE_GROUPS[s]).toBeTruthy();
    }
    expect(STATE_TO_MESSAGE_STATUS.DELIVERED).toBe("DELIVERED");
    expect(STATE_TO_MESSAGE_STATUS.BLOCKED).toBe("BLOCKED");
    expect(STATE_TO_KEY_STATUS.KEY_ACCEPTED).toBe("ACCEPTED");
    expect(STATE_TO_KEY_STATUS.ATTACK_DETECTED).toBe("REJECTED");
  });

  it("validates QSC ID format", () => {
    expect(QSC_ID_REGEX.test("QSC-AB12CD34EF")).toBe(true);
    expect(QSC_ID_REGEX.test("QSC-ab12cd34ef")).toBe(false);
    expect(QSC_ID_REGEX.test("QSC-123")).toBe(false);
    expect(QSC_ID_REGEX.test("ABC-AB12CD34EF")).toBe(false);
  });

  it("messageStatusFor falls back to PENDING for unknown states", () => {
    expect(messageStatusFor("DELIVERED")).toBe("DELIVERED");
    expect(messageStatusFor("NOT_A_STATE" as never)).toBe("PENDING");
  });
});
