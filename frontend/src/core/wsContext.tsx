import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { WsClient } from "./wsClient";
import { useAuthStore } from "./authStore";
import type { Role } from "./constants/vocab";
import type { WsEnvelope } from "../types/api";

type Subscribe = (type: string | "*", handler: (e: WsEnvelope) => void) => () => void;

interface WsCtx {
  subscribe: Subscribe;
}

interface Subscription {
  type: string;
  handler: (e: WsEnvelope) => void;
  detach: () => void;
}

const Ctx = createContext<WsCtx>({ subscribe: () => () => undefined });

function channelsForRole(role: Role): string[] {
  switch (role) {
    case "ATTACKER":
      return ["eve/events"];
    case "ADMIN":
      return ["admin/events", "user/events"];
    default:
      return ["user/events"];
  }
}

/**
 * Opens the role-appropriate channels once the backend has CONFIRMED the
 * identity (F4/F31).
 *
 * Sockets are keyed on identity — `authStatus` + `role` — and never on the
 * access token, so a token rotation does not tear down and rebuild live
 * sockets (which is what used to produce duplicate connections). `subscribe`
 * is stable and re-binds to the current clients, so re-renders cannot double
 * subscribe either.
 */
export function WsProvider({ children }: { children: ReactNode }) {
  const clientsRef = useRef<WsClient[]>([]);
  const subscriptionsRef = useRef<Set<Subscription>>(new Set());
  const authStatus = useAuthStore((s) => s.authStatus);
  const role = useAuthStore((s) => s.user?.role ?? null);

  /** Point every subscriber at the current client set exactly once. */
  const rebind = useCallback(() => {
    for (const subscription of subscriptionsRef.current) {
      subscription.detach();
      const offs = clientsRef.current.map((client) =>
        subscription.type === "*"
          ? client.onAny(subscription.handler)
          : client.on(subscription.type, subscription.handler),
      );
      subscription.detach = () => offs.forEach((off) => off());
    }
  }, []);

  useEffect(() => {
    // Never connect before authentication is resolved, and only once per role.
    if (authStatus !== "authenticated" || !role) return undefined;
    const clients = channelsForRole(role).map((channel) => new WsClient(channel));
    clientsRef.current = clients;
    rebind();
    clients.forEach((client) => client.connect());
    return () => {
      clientsRef.current.forEach((client) => client.close());
      clientsRef.current = [];
      rebind();
    };
  }, [authStatus, role, rebind]);

  const subscribe = useCallback<Subscribe>(
    (type, handler) => {
      const subscription: Subscription = {
        type,
        handler,
        detach: () => undefined,
      };
      const offs = clientsRef.current.map((client) =>
        type === "*" ? client.onAny(handler) : client.on(type, handler),
      );
      subscription.detach = () => offs.forEach((off) => off());
      subscriptionsRef.current.add(subscription);
      return () => {
        subscription.detach();
        subscriptionsRef.current.delete(subscription);
      };
    },
    [],
  );

  const value = useMemo<WsCtx>(() => ({ subscribe }), [subscribe]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWs(): Subscribe {
  return useContext(Ctx).subscribe;
}
