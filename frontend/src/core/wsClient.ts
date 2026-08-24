import { WS_BASE } from "./config";
import { useAuthStore } from "./authStore";
import { useUiStore, type WsStatus } from "./uiStore";
import type { WsEnvelope } from "../types/api";

type Handler = (envelope: WsEnvelope) => void;

const MAX_BACKOFF_MS = 15000;

/**
 * Thin WebSocket wrapper: JWT handshake via ?token=, auto-reconnect with
 * exponential backoff, typed event bus, heartbeat pong replies (Sec 16/20).
 * A single instance per channel is created by WsProvider.
 */
export class WsClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private anyHandlers = new Set<Handler>();
  private backoffMs = 1000;
  private closedByUser = false;
  private reconnectTimer: number | null = null;
  private channel: string;

  constructor(channel: string) {
    this.channel = channel;
  }

  connect(): void {
    this.closedByUser = false;
    const token = useAuthStore.getState().accessToken;
    if (!token) return;
    this.setStatus("connecting");
    const url = `${WS_BASE}/${this.channel}?token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      this.backoffMs = 1000;
      this.setStatus("connected");
    };

    socket.onmessage = (evt) => {
      try {
        const envelope = JSON.parse(evt.data as string) as WsEnvelope;
        if ((envelope as { type?: string }).type === "ping") {
          socket.send(JSON.stringify({ action: "pong" }));
          return;
        }
        this.dispatch(envelope);
      } catch {
        /* ignore malformed frames */
      }
    };

    socket.onclose = () => {
      this.setStatus("disconnected");
      this.socket = null;
      if (!this.closedByUser) this.scheduleReconnect();
    };

    socket.onerror = () => {
      socket.close();
    };
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

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
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
    this.reconnectTimer = window.setTimeout(() => {
      this.connect();
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    }, this.backoffMs);
  }

  private setStatus(status: WsStatus): void {
    useUiStore.getState().setWsStatus(status);
  }
}
