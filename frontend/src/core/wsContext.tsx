import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
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

/** Opens the role-appropriate channels once authenticated (F4/F31). */
export function WsProvider({ children }: { children: ReactNode }) {
  const [tick, setTick] = useState(0);
  const clientsRef = useRef<WsClient[]>([]);
  const accessToken = useAuthStore((s) => s.accessToken);
  const role = useAuthStore((s) => s.user?.role);

  // Re-create clients when identity changes.
  useEffect(() => {
    clientsRef.current.forEach((c) => c.close());
    clientsRef.current = [];
    if (!accessToken || !role) return undefined;
    const clients = channelsForRole(role).map((ch) => new WsClient(ch));
    clients.forEach((c) => c.connect());
    clientsRef.current = clients;
    setTick((t) => t + 1);
    return () => {
      clients.forEach((c) => c.close());
      clientsRef.current = [];
    };
  }, [accessToken, role]);

  const value = useMemo<WsCtx>(
    () => ({
      subscribe: (type, handler) => {
        const offs = clientsRef.current.map((c) =>
          type === "*" ? c.onAny(handler) : c.on(type, handler),
        );
        return () => offs.forEach((off) => off());
      },
    }),
    [tick],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWs(): Subscribe {
  return useContext(Ctx).subscribe;
}
