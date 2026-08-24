import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Role, User } from "../types/api";

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  setSession: (user: User, accessToken: string, refreshToken: string) => void;
  setUser: (user: User) => void;
  clearSession: () => void;
}

/** Tokens persisted to localStorage only; user refetched per reload (Sec 09). */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setSession: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken }),
      setUser: (user) => set({ user }),
      clearSession: () =>
        set({ user: null, accessToken: null, refreshToken: null }),
    }),
    { name: "qsc-auth" },
  ),
);

export function selectRole(): Role | null {
  return useAuthStore.getState().user?.role ?? null;
}

export function selectIsAuthenticated(): boolean {
  return useAuthStore.getState().accessToken != null;
}
