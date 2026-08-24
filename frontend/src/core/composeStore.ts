import { create } from "zustand";
import type { SecurityLevel, UserPublic } from "../types/api";

interface ComposeState {
  step: 1 | 2 | 3;
  receiver: UserPublic | null;
  body: string;
  securityLevel: SecurityLevel;
  setReceiver: (receiver: UserPublic) => void;
  setBody: (body: string) => void;
  setSecurityLevel: (level: SecurityLevel) => void;
  nextStep: () => void;
  prevStep: () => void;
  reset: () => void;
}

export const useComposeStore = create<ComposeState>((set, get) => ({
  step: 1,
  receiver: null,
  body: "",
  securityLevel: "MEDIUM",
  setReceiver: (receiver) => set({ receiver }),
  setBody: (body) => set({ body }),
  setSecurityLevel: (securityLevel) => set({ securityLevel }),
  nextStep: () => set({ step: Math.min(3, get().step + 1) as 1 | 2 | 3 }),
  prevStep: () => set({ step: Math.max(1, get().step - 1) as 1 | 2 | 3 }),
  reset: () =>
    set({ step: 1, receiver: null, body: "", securityLevel: "MEDIUM" }),
}));
