import { create } from "zustand";
import type { ActiveSession, AttackType } from "../types/api";

interface AttackState {
  communicationId: number | null;
  target: ActiveSession | null;
  attackType: AttackType;
  strength: number;
  runId: number | null;
  progress: number;
  setTarget: (target: ActiveSession) => void;
  setType: (type: AttackType) => void;
  setStrength: (strength: number) => void;
  setRun: (runId: number, communicationId: number) => void;
  setProgress: (progress: number) => void;
  reset: () => void;
}

export const useAttackStore = create<AttackState>((set) => ({
  communicationId: null,
  target: null,
  attackType: "INTERCEPT_AND_RESEND",
  strength: 0.5,
  runId: null,
  progress: 0,
  setTarget: (target) => set({ target, communicationId: target.id }),
  setType: (attackType) => set({ attackType }),
  setStrength: (strength) => set({ strength }),
  setRun: (runId, communicationId) => set({ runId, communicationId }),
  setProgress: (progress) => set({ progress }),
  reset: () =>
    set({
      communicationId: null,
      target: null,
      attackType: "INTERCEPT_AND_RESEND",
      strength: 0.5,
      runId: null,
      progress: 0,
    }),
}));
