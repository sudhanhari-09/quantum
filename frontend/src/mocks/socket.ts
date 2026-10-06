import type { Role } from "../types/api";
import { db } from "./engine";

type Ctor = typeof WebSocket;

/**
 * Replaces window.WebSocket when VITE_ENABLE_MOCKS=1. Routes connections to
 * the in-memory backend and streams Section 20 envelopes to subscribers.
 */
export function installMockWebSocket(): void {
  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = MockWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((evt: { data: string }) => void) | null = null;
    private listener: Parameters<typeof db.addListener>[0] | null = null;
    private pingTimer: number | null = null;
    private url: URL;

    constructor(url: string) {
      this.url = new URL(url);
      const token = this.url.searchParams.get("token") ?? "";
      const match = /mock-access-(\d+)-/.exec(token);
      const user = match ? db.users.find((u) => u.id === Number(match[1])) : null;
      if (!user) {
        setTimeout(() => this.onerror?.(), 30);
        return;
      }
      const channel = this.url.pathname.replace(/^.*\/ws\//, "");
      if (channel === "user/events" && user.role === "ATTACKER") {
        // Eve may not join the user channel; close with policy code.
        setTimeout(() => {
          this.onerror?.();
          this.readyState = MockWebSocket.CLOSING;
          this.onclose?.();
        }, 30);
        return;
      }
      this.listener = {
        role: user.role as Role,
        userId: user.id,
        channel,
        send: (data) => {
          if (this.readyState === MockWebSocket.OPEN) this.onmessage?.({ data });
        },
      };
      setTimeout(() => {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.();
        if (this.listener) db.addListener(this.listener);
        // Mirror the server heartbeat so the client's frame watchdog stays fed.
        this.pingTimer = window.setInterval(() => {
          if (this.readyState === MockWebSocket.OPEN) {
            this.onmessage?.({ data: JSON.stringify({ action: "ping", timestamp: null }) });
          }
        }, 30000);
      }, 50);
    }

    send(data: string) {
      const msg = JSON.parse(data) as { action?: string };
      if (msg.action === "pong") return;
    }

    close() {
      if (this.listener) db.removeListener(this.listener);
      this.listener = null;
      if (this.pingTimer != null) {
        window.clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.();
    }
  }
  window.WebSocket = MockWebSocket as unknown as Ctor;
}
