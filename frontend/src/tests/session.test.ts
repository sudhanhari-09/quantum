import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { API_BASE } from "../core/config";
import { apiGet } from "../core/apiClient";
import { useAuthStore } from "../core/authStore";
import {
  ensureFreshAccessToken,
  onSessionEnd,
  refreshSession,
  resetSessionInternals,
  startCrossTabSync,
  type SessionEndReason,
} from "../core/session";
import { isTokenExpired } from "../core/tokenUtils";
import { db, server } from "./setup";

const alice = () => db.users.find((u) => u.email === "alice@qsc.dev")!;

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** A structurally real JWT with a controlled `exp` (signature is irrelevant). */
function jwtExpiringIn(secondsFromNow: number): string {
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({
    sub: String(alice().id),
    role: "USER",
    type: "access",
    exp: Math.floor(Date.now() / 1000) + secondsFromNow,
  });
  return `${header}.${payload}.signature`;
}

function refreshHandler(onCall: () => void) {
  return http.post(`${API_BASE}/auth/refresh`, () => {
    onCall();
    const user = alice();
    return HttpResponse.json({
      access_token: `mock-access-${user.id}-${Date.now()}`,
      refresh_token: `mock-refresh-${user.id}-${Date.now()}`,
      expires_in: 1800,
    });
  });
}

describe("token lifecycle (single-flight refresh, rotation, terminal states)", () => {
  beforeEach(() => {
    useAuthStore.getState().clearSession();
    resetSessionInternals();
    window.sessionStorage.clear();
  });

  it("performs exactly ONE refresh for five simultaneous 401s and retries each request", async () => {
    let refreshCalls = 0;
    server.use(refreshHandler(() => (refreshCalls += 1)));
    useAuthStore
      .getState()
      .setSession(alice(), "stale-access-token", `mock-refresh-${alice().id}-seed`);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => apiGet<{ messages_sent: number }>("/dashboard/summary")),
    );

    expect(results).toHaveLength(5);
    expect(refreshCalls).toBe(1); // Scenario A: one refresh, not five
    expect(useAuthStore.getState().accessToken).toMatch(/^mock-access-/);
    expect(useAuthStore.getState().accessToken).not.toBe("stale-access-token");
  });

  it("treats TOKEN_REUSED as terminal: clears the session, stops refreshing, notifies once", async () => {
    let refreshCalls = 0;
    server.use(
      http.post(`${API_BASE}/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json(
          { code: "TOKEN_REUSED", message: "reuse detected" },
          { status: 401 },
        );
      }),
    );
    const reasons: SessionEndReason[] = [];
    const off = onSessionEnd((reason) => reasons.push(reason));
    useAuthStore.getState().setSession(alice(), "stale-access-token", "spent-refresh");

    await expect(apiGet("/dashboard/summary")).rejects.toMatchObject({ status: 401 });
    expect(reasons).toEqual(["reused"]);
    expect(useAuthStore.getState().refreshToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().authStatus).toBe("unauthenticated");

    // Nothing left to refresh with: no further refresh request is attempted.
    await expect(apiGet("/dashboard/summary")).rejects.toMatchObject({ status: 401 });
    expect(refreshCalls).toBe(1);
    off();
  });

  it("never reuses a refresh token that was already rotated away", async () => {
    let refreshCalls = 0;
    server.use(refreshHandler(() => (refreshCalls += 1)));
    useAuthStore.getState().setSession(alice(), "stale-access-token", "refresh-1");

    expect(await refreshSession()).toMatch(/^mock-access-/);
    expect(refreshCalls).toBe(1);

    // A stale writer puts the already-consumed token back into the store.
    useAuthStore.getState().setTokens("stale-2", "refresh-1");
    expect(await refreshSession()).toBeNull();
    expect(refreshCalls).toBe(1); // the spent token was never sent again
  });

  it("refreshes before a WebSocket handshake when the access token is expired", async () => {
    const expired = jwtExpiringIn(-60);
    expect(isTokenExpired(expired)).toBe(true);
    useAuthStore
      .getState()
      .setSession(alice(), expired, `mock-refresh-${alice().id}-seed`);

    const token = await ensureFreshAccessToken();
    expect(token).toBeTruthy();
    expect(token).not.toBe(expired);
    expect(isTokenExpired(token)).toBe(false);
  });

  it("never treats an opaque (non-JWT) token as expired", () => {
    expect(isTokenExpired(`mock-access-${alice().id}-123`)).toBe(false);
    expect(isTokenExpired(jwtExpiringIn(3600))).toBe(false);
    expect(isTokenExpired(jwtExpiringIn(-1))).toBe(true);
    expect(isTokenExpired(null)).toBe(false);
  });

  it("persists tokens only — never a stale user or role", () => {
    useAuthStore.getState().setSession(alice(), "access-1", "refresh-1");
    const persisted = JSON.parse(window.sessionStorage.getItem("qsc-auth") ?? "{}") as {
      state?: Record<string, unknown>;
    };
    expect(persisted.state).toEqual({ accessToken: "access-1", refreshToken: "refresh-1" });
    expect(persisted.state).not.toHaveProperty("user");
  });
});

describe("multi-tab session isolation", () => {
  beforeEach(() => {
    useAuthStore.getState().clearSession();
    resetSessionInternals();
    window.sessionStorage.clear();
    window.localStorage.clear();
    startCrossTabSync();
  });

  it("keeps credentials in per-tab sessionStorage - never shared localStorage", () => {
    useAuthStore.getState().setSession(
      { ...alice(), role: "ADMIN" } as const,
      "admin-access-token",
      "admin-refresh-token",
    );

    // Two browser tabs never share sessionStorage: that is what isolates
    // an ADMIN login in one tab from an EVE login in another.
    expect(window.localStorage.getItem("qsc-auth")).toBeNull();
    const stored = JSON.parse(window.sessionStorage.getItem("qsc-auth") ?? "{}") as {
      state?: Record<string, unknown>;
    };
    expect(stored.state).toEqual({
      accessToken: "admin-access-token",
      refreshToken: "admin-refresh-token",
    });
    // user/role are never persisted; they always come from /auth/me.
    expect(stored.state).not.toHaveProperty("user");
  });

  it("a sign-out announced on the storage channel clears this tab once", () => {
    useAuthStore.getState().setSession(alice(), "access-1", "refresh-1");
    const reasons: SessionEndReason[] = [];
    const off = onSessionEnd((reason) => reasons.push(reason));

    // The other tab removed the shared entry, then the storage event fired.
    window.sessionStorage.removeItem("qsc-auth");
    window.dispatchEvent(new StorageEvent("storage", { key: "qsc-auth", newValue: null }));

    expect(useAuthStore.getState().authStatus).toBe("unauthenticated");
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(reasons).toEqual(["signed-out"]);
    off();
  });

  it("adopts a rotation announced on the storage channel (newest pair wins)", () => {
    useAuthStore.getState().setSession(alice(), "access-1", "refresh-1");

    // Another tab rotated first: storage now holds the successor pair, and the
    // old refresh token must never be sent again.
    window.sessionStorage.setItem(
      "qsc-auth",
      JSON.stringify({ state: { accessToken: "access-2", refreshToken: "refresh-2" } }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: "qsc-auth" }));

    expect(useAuthStore.getState().accessToken).toBe("access-2");
    expect(useAuthStore.getState().refreshToken).toBe("refresh-2");
  });
});