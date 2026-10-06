/**
 * Central session lifecycle: ONE refresh path for the whole app.
 *
 * Guarantees
 *  - single-flight: concurrent 401s / WS auth failures share one refresh call;
 *  - cross-tab: `navigator.locks` serialises refresh across tabs and the newest
 *    persisted token pair is adopted before anything is sent, so an old refresh
 *    token is never replayed (the backend revokes the family on reuse);
 *  - rotation-safe: both tokens returned by the backend replace both stored
 *    tokens, and a token this tab already rotated away is never sent again;
 *  - terminal states (401/403 from /auth/refresh, TOKEN_REUSED) clear the
 *    session and tell subscribers, instead of retrying forever.
 */
import axios from "axios";
import { API_BASE } from "./config";
import { useAuthStore } from "./authStore";
import { isTokenExpired } from "./tokenUtils";

export type SessionEndReason = "expired" | "reused" | "revoked" | "signed-out";

/** User-facing, non-technical copy for every session-end path. */
export const SESSION_END_MESSAGES: Record<SessionEndReason, string> = {
  expired: "Your session expired. Please sign in again.",
  reused: "Security check failed on your session. Please sign in again.",
  revoked: "Your session is no longer valid. Please sign in again.",
  "signed-out": "You were signed out in another tab.",
};

const TOKENS_KEY = "qsc-auth";
const REFRESH_LOCK = "qsc-auth-refresh";
const REFRESH_TIMEOUT_MS = 15_000;

interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

let inflight: Promise<string | null> | null = null;
/** Refresh token already consumed by this tab: resending it = reuse. */
let rotatedFrom: string | null = null;

const endListeners = new Set<(reason: SessionEndReason) => void>();
const refreshListeners = new Set<(accessToken: string) => void>();

export function onSessionEnd(listener: (reason: SessionEndReason) => void): () => void {
  endListeners.add(listener);
  return () => endListeners.delete(listener);
}

export function onSessionRefreshed(listener: (accessToken: string) => void): () => void {
  refreshListeners.add(listener);
  return () => refreshListeners.delete(listener);
}

function readStoredTokens(): { accessToken: string | null; refreshToken: string | null } {
  try {
    const raw = window.sessionStorage.getItem(TOKENS_KEY);
    if (!raw) return { accessToken: null, refreshToken: null };
    const parsed = JSON.parse(raw) as {
      state?: { accessToken?: string | null; refreshToken?: string | null };
    };
    return {
      accessToken: parsed.state?.accessToken ?? null,
      refreshToken: parsed.state?.refreshToken ?? null,
    };
  } catch {
    return { accessToken: null, refreshToken: null };
  }
}

/** Write token pair to sessionStorage (tab-isolated). Exported for authStore hydration. */
export function writeTokensToSessionStorage(
  accessToken: string | null,
  refreshToken: string | null,
): void {
  if (accessToken == null && refreshToken == null) {
    window.sessionStorage.removeItem(TOKENS_KEY);
  } else {
    const value = JSON.stringify({
      state: { accessToken, refreshToken },
    });
    window.sessionStorage.setItem(TOKENS_KEY, value);
  }
}

/** Read tokens from sessionStorage without modifying store. Exported for authStore hydration. */
export { readStoredTokens };

/** Adopt tokens another tab rotated while we were waiting. Returns true if so. */
function adoptStoredTokens(): boolean {
  const stored = readStoredTokens();
  if (!stored.refreshToken || !stored.accessToken) return false;
  const local = useAuthStore.getState();
  if (stored.accessToken === local.accessToken) return false;
  local.setTokens(stored.accessToken, stored.refreshToken);
  return true;
}

function notifyRefreshed(token: string): void {
  for (const listener of refreshListeners) {
    try {
      listener(token);
    } catch {
      /* a broken listener must never break the refresh path */
    }
  }
}

/** Ends the session: clears tokens/user and notifies (idempotent). */
export function expireSession(reason: SessionEndReason): void {
  const state = useAuthStore.getState();
  const hadSession = state.accessToken != null || state.refreshToken != null;
  rotatedFrom = null;
  state.clearSession();
  if (!hadSession) return;
  for (const listener of endListeners) {
    try {
      listener(reason);
    } catch {
      /* ignore */
    }
  }
}

/** Local sign-out (deliberate): clears without raising "session expired" UX. */
export function resetSession(): void {
  rotatedFrom = null;
  useAuthStore.getState().clearSession();
}

async function runWithLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks || typeof locks.request !== "function") return fn();
  return locks.request(REFRESH_LOCK, fn) as Promise<T>;
}

async function performRefresh(startedWithToken: string | null): Promise<string | null> {
  // Cross-tab first: another tab may have rotated while we queued for the lock.
  adoptStoredTokens();
  const state = useAuthStore.getState();
  const presented = state.refreshToken;
  if (!presented) return null;
  if (state.accessToken && state.accessToken !== startedWithToken) {
    return state.accessToken; // someone else already refreshed for us
  }
  if (presented === rotatedFrom) {
    // We already spent this token. Reusing it would trip reuse detection.
    expireSession("expired");
    return null;
  }

  try {
    const { data } = await axios.post<RefreshResponse>(
      `${API_BASE}/auth/refresh`,
      { refresh_token: presented },
      { headers: { "Content-Type": "application/json" }, timeout: REFRESH_TIMEOUT_MS },
    );
    rotatedFrom = presented;
    // Store BOTH rotated tokens, only if the session is still ours.
    const current = useAuthStore.getState();
    if (current.refreshToken === presented) {
      current.setTokens(data.access_token, data.refresh_token);
    }
    const token = useAuthStore.getState().accessToken ?? data.access_token;
    notifyRefreshed(token);
    return token;
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    const code = (axios.isAxiosError(error)
      ? (error.response?.data as { code?: string } | undefined)?.code
      : undefined) as string | undefined;
    if (status === 401 || status === 403) {
      // Genuine revocation: stop immediately (never loop on refresh).
      expireSession(code === "TOKEN_REUSED" ? "reused" : "expired");
      return null;
    }
    // Network / server problem: keep the session, caller decides when to retry.
    return null;
  }
}

/** Single-flight refresh; resolves with the new access token or null. */
export function refreshSession(): Promise<string | null> {
  if (inflight) return inflight;
  const startedWithToken = useAuthStore.getState().accessToken;
  inflight = runWithLock(() => performRefresh(startedWithToken))
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Token for a new WebSocket handshake: refresh first when known-expired. */
export async function ensureFreshAccessToken(): Promise<string | null> {
  const { accessToken, refreshToken } = useAuthStore.getState();
  if (accessToken && !isTokenExpired(accessToken)) return accessToken;
  if (refreshToken) {
    const refreshed = await refreshSession();
    if (refreshed) return refreshed;
  }
  const fallback = useAuthStore.getState().accessToken;
  return fallback && !isTokenExpired(fallback) ? fallback : null;
}

/** Keeps tabs consistent and mirrors sign-out/rotation across them. */
let crossTabStarted = false;

export function startCrossTabSync(): void {
  if (crossTabStarted || typeof window === "undefined") return;
  crossTabStarted = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== TOKENS_KEY) return;
    const stored = readStoredTokens();
    const local = useAuthStore.getState();
    if (!stored.refreshToken) {
      if (local.refreshToken) expireSession("signed-out");
      return;
    }
    if (!stored.accessToken || stored.accessToken === local.accessToken) return;
    const wasAuthenticated = local.authStatus === "authenticated";
    local.setTokens(stored.accessToken, stored.refreshToken);
    if (!wasAuthenticated) notifyRefreshed(stored.accessToken);
  });
}

/** Test/dev helper: forget the single-flight and rotation bookkeeping. */
export function resetSessionInternals(): void {
  inflight = null;
  rotatedFrom = null;
}