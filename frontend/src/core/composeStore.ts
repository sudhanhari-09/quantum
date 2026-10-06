import { create } from "zustand";
import type { Protocol, SecurityLevel, UserPublic } from "../types/api";

interface ComposeState {
  step: 1 | 2 | 3 | 4;
  receiver: UserPublic | null;
  body: string;
  securityLevel: SecurityLevel;
  selectedProtocol: Protocol | null;
  setReceiver: (receiver: UserPublic) => void;
  setBody: (body: string) => void;
  setSecurityLevel: (level: SecurityLevel) => void;
  setSelectedProtocol: (protocol: Protocol | null) => void;
  nextStep: () => void;
  prevStep: () => void;
  reset: () => void;
}

export const useComposeStore = create<ComposeState>((set, get) => ({
  step: 1,
  receiver: null,
  body: "",
  securityLevel: "MEDIUM",
  selectedProtocol: null,
  setReceiver: (receiver) => set({ receiver }),
  setBody: (body) => set({ body }),
  setSecurityLevel: (securityLevel) => set({ securityLevel }),
  setSelectedProtocol: (selectedProtocol) => set({ selectedProtocol }),
  nextStep: () => set({ step: Math.min(4, get().step + 1) as 1 | 2 | 3 | 4 }),
  prevStep: () => set({ step: Math.max(1, get().step - 1) as 1 | 2 | 3 | 4 }),
  reset: () =>
    set({ step: 1, receiver: null, body: "", securityLevel: "MEDIUM", selectedProtocol: null }),
}));
