import { create } from "zustand";

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
}

export type WsStatus = "connected" | "connecting" | "disconnected";

interface UiState {
  toasts: Toast[];
  wsStatus: WsStatus;
  pushToast: (kind: Toast["kind"], message: string) => void;
  dismissToast: (id: number) => void;
  setWsStatus: (status: WsStatus) => void;
}

let toastId = 0;

export const useUiStore = create<UiState>((set, get) => ({
  toasts: [],
  wsStatus: "disconnected",
  pushToast: (kind, message) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, kind, message }] });
    window.setTimeout(() => get().dismissToast(id), 5000);
  },
  dismissToast: (id) =>
    set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setWsStatus: (wsStatus) => set({ wsStatus }),
}));
