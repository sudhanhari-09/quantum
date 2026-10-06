import { WS_BASE } from "./config";
import { useAuthStore } from "./authStore";
import { useUiStore, type WsStatus } from "./uiStore";
import { ensureFreshAccessToken, refreshSession } from "./session";
import type { WsEnvelope } from "../types/api";

type Handler = (envelope: WsEnvelope) => void;

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_JITTER_MS = 400;
/** Server pings every 30s; nothing received for 75s means the socket is dead. */
const FRAME_TIMEOUT_MS = 75_000;
const FRAME_CHECK_INTERVAL_MS = 15_000;

/* App-level close codes emitted by the backend (app/ws/routes.py). */
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_FORBIDDEN = 4403;
const CLOSE_NOT_FOUND = 4404;

/** At most ONE live client per channel, however often React re-renders. */
const activeClients = new Map<string, WsClient>();

/**
 * Thin WebSocket wrapper: JWT handshake via ?token=, controlled exponential
 * backoff with jitter, heartbeat watchdog, typed event bus (Sec 16/20).
 *
 * Authentication rules enforced here:
 *  - the latest access token is read from the auth store right before EVERY
 *    handshake; a known-expired token is refreshed first, so the socket is
 *    never (re)opened with a token we already know is dead;
 *  - close 4401 (token rejected) triggers at most ONE refresh + reconnect with
 *    the new token; a second 4401 ends the session instead of looping;
 *  - close 4403/4404 (role/resource denied) never reconnects.
 */
export class WsClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private anyHandlers = new Set<Handler>();
  private backoffMs = BASE_BACKOFF_MS;
  private closedByUser = false;
  private stopped = false;
  private connecting = false;
  private authRetried = false;
  private epoch = 0;
  private reconnectTimer: number | null = null;
  private frameTimer: number | null = null;
  private lastFrameAt = 0;
  private channel: string;

  constructor(channel: string) {
    this.channel = channel;
    const previous = activeClients.get(channel);
    if (previous && previous !== this) previous.close();
    activeClients.set(channel, this);
  }

  /** Idempotent: repeated calls never open a second socket for this channel. */
  connect(): void {
    this.closedByUser = false;
    this.stopped = false;
    if (this.connecting) return;
    const state = this.socket?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
    this.clearReconnectTimer();
    this.connecting = true;
    void this.open();
  }

  private async open(): Promise<void> {
    try {
      const token = await ensureFreshAccessToken();
      if (this.closedByUser || this.stopped) return;
      if (activeClients.get(this.channel) !== this) return; // superseded
      if (!token) {
        // No usable token right now: retry only while a session still exists.
        const { accessToken, refreshToken } = useAuthStore.getState();
        if (accessToken || refreshToken) this.scheduleReconnect();
        return;
      }

      const epoch = ++this.epoch;
      this.setStatus("connecting");
      const socket = new WebSocket(
        `${WS_BASE}/${this.channel}?token=${encodeURIComponent(token)}`,
      );
      this.socket = socket;
      this.lastFrameAt = Date.now();

      socket.onopen = () => {
        if (epoch !== this.epoch) return;
        this.backoffMs = BASE_BACKOFF_MS;
        this.authRetried = false;
        this.setStatus("connected");
        this.armFrameWatchdog(socket);
      };

      socket.onmessage = (event) => this.handleFrame(socket, epoch, event);

      socket.onclose = (event) => {
        if (epoch !== this.epoch) return;
        if (this.socket === socket) this.socket = null;
        this.clearFrameTimer();
        this.handleClose((event as CloseEvent | undefined)?.code);
      };

      // onclose always follows onerror; reconnect logic lives in one place.
      socket.onerror = () => undefined;
    } finally {
      this.connecting = false;
    }
  }

  private handleFrame(socket: WebSocket, epoch: number, event: MessageEvent): void {
    if (epoch !== this.epoch) return;
    this.lastFrameAt = Date.now();
    try {
      const envelope = JSON.parse(event.data as string) as WsEnvelope & {
        action?: string;
      };
      if (envelope.action === "ping" || (envelope as { type?: string }).type === "ping") {
        socket.send(JSON.stringify({ action: "pong" }));
        return;
      }
      if (envelope.action === "pong") return; // control frame, not an envelope
      this.dispatch(envelope);
    } catch {
      /* ignore malformed frames */
    }
  }

  on(type: string, handler: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  onAny(handler: Handler): () => void {
    this.anyHandlers.add(handler);
    return () => {
      this.anyHandlers.delete(handler);
    };
  }

  private handleClose(rawCode: number | undefined): void {
    this.setStatus("disconnected");
    if (this.closedByUser || this.stopped) return;
    // Browsers report 1006 when the close code is not visible (abnormal close).
    const code = typeof rawCode === "number" && rawCode !== 0 ? rawCode : 1006;

    if (code === CLOSE_FORBIDDEN || code === CLOSE_NOT_FOUND) {
      // Authenticated but not allowed here: reconnecting would loop forever.
      console.warn(`[QSC] websocket ${this.channel} closed with ${code}; not reconnecting`);
      this.stopped = true;
      return;
    }

    if (code === CLOSE_UNAUTHORIZED) {
      if (this.authRetried) {
        // The refresh did not help: the session is really gone.
        // Don't call expireSession here - let REST API 401 handling manage the session
        this.stopped = true;
        return;
      }
      this.authRetried = true;
      void refreshSession().then((token) => {
        if (this.closedByUser || this.stopped) return;
        if (token) this.connect();
        else this.scheduleReconnect();
      });
      return;
    }

    this.scheduleReconnect();
  }

  close(): void {
    this.closedByUser = true;
    this.epoch += 1; // invalidate every in-flight callback
    this.clearReconnectTimer();
    this.clearFrameTimer();
    if (activeClients.get(this.channel) === this) activeClients.delete(this.channel);
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    }
    this.setStatus("disconnected");
  }

  get status(): WsStatus {
    return useUiStore.getState().wsStatus;
  }

  private dispatch(envelope: WsEnvelope): void {
    this.anyHandlers.forEach((h) => h(envelope));
    this.handlers.get(envelope.type)?.forEach((h) => h(envelope));
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.stopped || this.reconnectTimer != null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.backoffMs + Math.floor(Math.random() * MAX_JITTER_MS));
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  /** Detects half-open sockets (server gone without a FIN). */
  private armFrameWatchdog(socket: WebSocket): void {
    this.clearFrameTimer();
    this.frameTimer = window.setInterval(() => {
      if (this.socket !== socket) return;
      if (Date.now() - this.lastFrameAt > FRAME_TIMEOUT_MS) socket.close();
    }, FRAME_CHECK_INTERVAL_MS);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearFrameTimer(): void {
    if (this.frameTimer != null) {
      window.clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
  }

  private setStatus(status: WsStatus): void {
    useUiStore.getState().setWsStatus(status);
  }
}
