import { create } from "zustand";
import type { Role, User } from "../types/api";
import { readStoredTokens, writeTokensToSessionStorage } from "./session";

/**
 * `unknown`     — tokens exist but the backend has not confirmed them yet
 *                 (app boot / browser refresh). Nothing role-gated may render.
 * `authenticated` — /auth/me succeeded; `user.role` is backend-verified.
 * `unauthenticated` — no usable session; guarded routes redirect to /login.
 */
export type AuthStatus = "unknown" | "authenticated" | "unauthenticated";

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  authStatus: AuthStatus;
  /** Full login/refresh response: the single place a session is created. */
  setSession: (user: User, accessToken: string, refreshToken: string) => void;
  /** Rotation: replaces BOTH tokens, never only one of them. */
  setTokens: (accessToken: string, refreshToken: string) => void;
  /** /auth/me result: user + role always come from the backend. */
  setUser: (user: User) => void;
  /** Boot finished with nothing to restore. */
  markUnauthenticated: () => void;
  /** Drop the session (logout / revoked / unrecoverable refresh failure). */
  clearSession: () => void;
  /** Initialize store from sessionStorage (called once at app start). */
  hydrate: () => void;
}

/**
 * Hydrate authStore from sessionStorage.
 * Safe to call multiple times; idempotent.
 */
function hydrateStore(): void {
  const { accessToken, refreshToken } = readStoredTokens();
  if (accessToken && refreshToken) {
    useAuthStore.setState({
      accessToken,
      refreshToken,
      authStatus: "unknown", // backend still needs to verify via /auth/me
    });
  }
}

// Hydrate immediately on module load (before any component reads the store)
hydrateStore();

export const useAuthStore = create<AuthState>()(
  (set) => ({
    user: null,
    accessToken: null,
    refreshToken: null,
    authStatus: "unknown",
    setSession: (user, accessToken, refreshToken) => {
      set({ user, accessToken, refreshToken, authStatus: "authenticated" });
      writeTokensToSessionStorage(accessToken, refreshToken);
    },
    setTokens: (accessToken, refreshToken) => {
      set({ accessToken, refreshToken });
      writeTokensToSessionStorage(accessToken, refreshToken);
    },
    setUser: (user) => set({ user, authStatus: "authenticated" }),
    markUnauthenticated: () => {
      set({ authStatus: "unauthenticated" });
      writeTokensToSessionStorage(null, null);
    },
    clearSession: () => {
      set({
        user: null,
        accessToken: null,
        refreshToken: null,
        authStatus: "unauthenticated",
      });
      writeTokensToSessionStorage(null, null);
    },
    hydrate: hydrateStore,
  }),
);

export function selectRole(): Role | null {
  return useAuthStore.getState().user?.role ?? null;
}

/** Authenticated ⇒ a backend-verified user is present (never just a token). */
export function selectIsAuthenticated(): boolean {
  const state = useAuthStore.getState();
  return state.authStatus === "authenticated" && state.user != null;
}

