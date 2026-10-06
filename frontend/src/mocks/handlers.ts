import { http, HttpResponse, type DefaultBodyType } from "msw";
import { API_BASE } from "../core/config";
import { db, asHttpError } from "./engine";
import type {
  AttackRow,
  AuditRow,
  CommunicationSummary,
  MessageDetail,
  MessageRow,
  ProtocolAnalyticsRow,
  QkdRun,
  Role,
  SecurityEventRow,
  SecurityReport,
  TimelineEvent,
} from "../types/api";

const p = (path: string) => `${API_BASE}${path}`;

function fail(e: unknown) {
  const http = asHttpError(e);
  if (http) {
    const [status, code] = http;
    return HttpResponse.json({ code, message: code }, { status });
  }
  return HttpResponse.json(
    { code: "INTERNAL_ERROR", message: "INTERNAL_ERROR" },
    { status: 500 },
  );
}

function auth(req: Request): { id: number; role: Role } | null {
  const header = req.headers.get("Authorization") ?? "";
  const match = /mock-access-(\d+)-/.exec(header);
  if (!match) return null;
  const user = db.users.find((u) => u.id === Number(match[1]));
  return user ? { id: user.id, role: user.role } : null;
}

function requireAuth(req: Request) {
  const session = auth(req);
  if (!session) {
    // Throwing a Response short-circuits the resolver, so unauthenticated calls
    // answer with a real 401 + envelope exactly like the backend
    // (400/500 leakage here previously hid the refresh-token flow).
    throw HttpResponse.json(
      { code: "TOKEN_REQUIRED", message: "TOKEN_REQUIRED" },
      { status: 401 },
    );
  }
  return session;
}

export const handlers = [
  // ---- AUTH ------------------------------------------------------------
  http.post(p("/auth/register"), async ({ request }) => {
    try {
      const body = (await request.json()) as { name: string; email: string; password: string };
      const user = db.register(body.name, body.email, body.password);
      return HttpResponse.json({ user: publicUser(user) }, { status: 201 });
    } catch (e) {
      return fail(e);
    }
  }),

  http.post(p("/auth/login"), async ({ request }) => {
    try {
      const body = (await request.json()) as { email: string; password: string };
      const user = db.login(body.email, body.password);
      return HttpResponse.json({ ...db.tokensFor(user), user: publicUser(user) });
    } catch (e) {
      return fail(e);
    }
  }),

  http.post(p("/auth/refresh"), async ({ request }) => {
    const body = (await request.json()) as { refresh_token: string };
    const match = /mock-refresh-(\d+)-/.exec(body.refresh_token ?? "");
    const user = match ? db.users.find((u) => u.id === Number(match[1])) : null;
    if (!user)
      return HttpResponse.json({ code: "TOKEN_INVALID", message: "TOKEN_INVALID" }, { status: 401 });
    return HttpResponse.json({
      access_token: `mock-access-${user.id}-${Date.now()}`,
      refresh_token: `mock-refresh-${user.id}-${Date.now()}`,
      expires_in: 1800,
    });
  }),

  http.get(p("/auth/me"), ({ request }) => {
    const session = auth(request);
    const user = session ? db.users.find((u) => u.id === session.id) : null;
    if (!user)
      return HttpResponse.json({ code: "TOKEN_REQUIRED", message: "TOKEN_REQUIRED" }, { status: 401 });
    return HttpResponse.json({ user: fullUser(user) });
  }),

  // ---- USERS -----------------------------------------------------------
  http.get(p("/users/search"), ({ request }) => {
    requireAuth(request);
    const url = new URL(request.url);
    const qscId = url.searchParams.get("qsc_id") ?? "";
    if (!/^QSC-[A-Z0-9]{10}$/.test(qscId))
      return HttpResponse.json({ code: "INVALID_QSC_FORMAT", message: "INVALID_QSC_FORMAT" }, { status: 422 });
    const found = db.searchByQsc(qscId);
    if (!found)
      return HttpResponse.json({ code: "USER_NOT_FOUND", message: "USER_NOT_FOUND" }, { status: 404 });
    return HttpResponse.json({
      user: { id: found.id, name: found.name, unique_user_id: found.unique_user_id },
    });
  }),

  http.get(p("/users/me"), ({ request }) => {
    const s = auth(request);
    const user = s ? db.users.find((u) => u.id === s.id) : null;
    if (!user)
      return HttpResponse.json({ code: "TOKEN_REQUIRED", message: "TOKEN_REQUIRED" }, { status: 401 });
    return HttpResponse.json(fullUser(user));
  }),

  // ---- MESSAGES ----------------------------------------------------------
  http.post(p("/messages"), async ({ request }) => {
    try {
      const s = requireAuth(request);
      const body = (await request.json()) as {
        receiver_qsc_id: string;
        content: string;
        security_requirement?: string;
      };
      if (!body.content?.trim())
        return HttpResponse.json({ code: "VALIDATION_ERROR", message: "VALIDATION_ERROR" }, { status: 422 });
      if (body.content.length > 2000)
        return HttpResponse.json({ code: "CONTENT_TOO_LONG", message: "CONTENT_TOO_LONG" }, { status: 422 });
      const created = db.createMessage(
        s.id,
        body.receiver_qsc_id,
        body.content.trim(),
        body.security_requirement ?? "MEDIUM",
      );
      return HttpResponse.json(
        { ...created, status: "CREATED", message: "accepted for secure processing" },
        { status: 202 },
      );
    } catch (e) {
      return fail(e);
    }
  }),

  http.get(p("/messages/inbox"), ({ request }) => {
    const s = requireAuth(request);
    const rows = db.messages
      .filter((m) => m.receiver_id === s.id && ["DELIVERED", "READ"].includes(m.status))
      .reverse()
      .map(messageRow);
    return paginated(rows, new URL(request.url));
  }),

  http.get(p("/messages/sent"), ({ request }) => {
    const s = requireAuth(request);
    const rows = db.messages
      .filter((m) => m.sender_id === s.id)
      .reverse()
      .map(messageRow);
    return paginated(rows, new URL(request.url));
  }),

  http.get(p("/messages/:id/security-report"), ({ request, params }) => {
    const s = requireAuth(request);
    const id = Number(params.id);
    const msg = db.messages.find((m) => m.id === id);
    if (!msg || (msg.sender_id !== s.id && msg.receiver_id !== s.id))
      return HttpResponse.json({ code: "MESSAGE_NOT_FOUND", message: "MESSAGE_NOT_FOUND" }, { status: 404 });
    const report = db.reports.find((r) => r.message_id === id);
    if (!report)
      return HttpResponse.json({ code: "REPORT_NOT_FOUND", message: "REPORT_NOT_FOUND" }, { status: 404 });
    return HttpResponse.json({ report });
  }),

  http.get(p("/messages/:id"), ({ request, params }) => {
    try {
      const s = requireAuth(request);
      const id = Number(params.id);
      const msg = db.markRead(id, s.id);
      const isParticipant = msg.sender_id === s.id || msg.receiver_id === s.id;
      if (!isParticipant)
        return HttpResponse.json({ code: "FOREIGN_MESSAGE", message: "FOREIGN_MESSAGE" }, { status: 403 });
      const canRead =
        ["DELIVERED", "READ"].includes(msg.status) &&
        (msg.receiver_id === s.id || msg.sender_id === s.id);
      const detail: MessageDetail = {
        ...messageRow(msg),
        content: canRead ? msg.plaintext ?? undefined : undefined,
        communication_id: msg.communication_id,
        sender: { id: msg.sender_id, name: userName(msg.sender_id) },
        receiver: { id: msg.receiver_id, name: userName(msg.receiver_id) },
      };
      return HttpResponse.json(detail);
    } catch (e) {
      return fail(e);
    }
  }),

  http.get(p("/security-reports"), ({ request }) => {
    const s = requireAuth(request);
    const mine = new Set(
      db.messages.filter((m) => m.sender_id === s.id || m.receiver_id === s.id).map((m) => m.id),
    );
    const rows: SecurityReport[] = db.reports.filter((r) => mine.has(r.message_id));
    return paginated(rows, new URL(request.url));
  }),

  // ---- COMMUNICATIONS ------------------------------------------------------
  http.get(p("/communications/active"), ({ request }) => {
    const s = requireAuth(request);
    if (s.role !== "ATTACKER")
      return HttpResponse.json({ code: "ROLE_FORBIDDEN", message: "ROLE_FORBIDDEN" }, { status: 403 });
    return HttpResponse.json({ items: db.activeSessions(s.id) });
  }),

  http.get(p("/communications/:id/recommendation"), ({ request, params }) => {
    const s = requireAuth(request);
    const comm = db.comms.find((c) => c.id === Number(params.id));
    if (!comm || (comm.sender_id !== s.id && comm.receiver_id !== s.id && s.role !== "ADMIN"))
      return HttpResponse.json({ code: "COMMUNICATION_NOT_FOUND", message: "COMMUNICATION_NOT_FOUND" }, { status: 404 });
    if (!comm.recommendation)
      return HttpResponse.json({ code: "RECOMMENDATION_NOT_READY", message: "RECOMMENDATION_NOT_READY" }, { status: 404 });
    return HttpResponse.json(comm.recommendation);
  }),

  http.get(p("/communications/:id/qkd"), ({ request, params }) => {
    const s = requireAuth(request);
    const comm = db.comms.find((c) => c.id === Number(params.id));
    if (!comm || (comm.sender_id !== s.id && comm.receiver_id !== s.id && s.role !== "ADMIN"))
      return HttpResponse.json({ code: "COMMUNICATION_NOT_FOUND", message: "COMMUNICATION_NOT_FOUND" }, { status: 404 });
    const runs: QkdRun[] = db.qkdRuns.filter((r) => r.communication_id === comm!.id);
    return HttpResponse.json({
      runs,
      latest_key_status: runs.at(-1)?.key_status ?? comm.key_status,
    });
  }),

  http.get(p("/communications/:id/security"), ({ request, params }) => {
    const s = requireAuth(request);
    const comm = db.comms.find((c) => c.id === Number(params.id));
    if (!comm || (comm.sender_id !== s.id && comm.receiver_id !== s.id && s.role !== "ADMIN"))
      return HttpResponse.json({ code: "COMMUNICATION_NOT_FOUND", message: "COMMUNICATION_NOT_FOUND" }, { status: 404 });
    const run = [...db.qkdRuns].reverse().find((r) => r.communication_id === comm!.id);
    const qber = run?.qber ?? 0;
    return HttpResponse.json({
      decision:
        comm.key_status === "ACCEPTED" ? "ACCEPTED" : comm.key_status === "REJECTED" ? "REJECTED" : "PENDING",
      key_status: comm.key_status,
      attack_detected: comm.attack_detected,
      qber,
      threshold: run?.threshold ?? 0.11,
      evaluated_at: run?.created_at ?? comm.created_at,
    });
  }),

  http.get(p("/communications/:id/timeline"), ({ request, params }) => {
    const s = requireAuth(request);
    const comm = db.comms.find((c) => c.id === Number(params.id));
    if (!comm || (comm.sender_id !== s.id && comm.receiver_id !== s.id && s.role !== "ADMIN"))
      return HttpResponse.json({ code: "COMMUNICATION_NOT_FOUND", message: "COMMUNICATION_NOT_FOUND" }, { status: 404 });
    const events: TimelineEvent[] = comm.timeline.slice(-500);
    return HttpResponse.json({ events });
  }),

  http.get(p("/communications/history"), ({ request }) => {
    const s = requireAuth(request);
    const rows = db.comms
      .filter((c) => c.sender_id === s.id || c.receiver_id === s.id)
      .map((c) => db.toCommSummary(c));
    return paginated(rows.reverse(), new URL(request.url));
  }),

  http.get(p("/communications/:id"), ({ request, params }) => {
    const s = requireAuth(request);
    const comm = db.comms.find((c) => c.id === Number(params.id));
    if (!comm || (comm.sender_id !== s.id && comm.receiver_id !== s.id && s.role !== "ADMIN"))
      return HttpResponse.json({ code: "COMMUNICATION_NOT_FOUND", message: "COMMUNICATION_NOT_FOUND" }, { status: 404 });
    const summary: CommunicationSummary = db.toCommSummary(comm);
    return HttpResponse.json(summary);
  }),

  http.get(p("/communications"), ({ request }) => {
    const s = requireAuth(request);
    const scope = new URL(request.url).searchParams.get("scope") ?? "mine";
    let rows = db.comms.filter((c) => c.sender_id === s.id || c.receiver_id === s.id);
    if (scope === "history")
      rows = rows.filter((c) => ["READ", "BLOCKED", "FAILED", "DELIVERED"].includes(c.session_status));
    const summaries = rows.map((c) => db.toCommSummary(c)).reverse();
    return paginated(summaries, new URL(request.url));
  }),

  // ---- ATTACKS -----------------------------------------------------------
  http.post(p("/communications/:id/attacks"), async ({ request, params }) => {
    try {
      const s = requireAuth(request);
      if (s.role !== "ATTACKER")
        return HttpResponse.json({ code: "ROLE_FORBIDDEN", message: "ROLE_FORBIDDEN" }, { status: 403 });
      const body = (await request.json()) as {
        attack_type: string;
        attack_strength: number;
      };
      if (body.attack_type !== "INTERCEPT_AND_RESEND")
        return HttpResponse.json({ code: "INVALID_ATTACK_TYPE", message: "INVALID_ATTACK_TYPE" }, { status: 422 });
      const attack = db.launchAttack(s.id, Number(params.id), Number(body.attack_strength));
      const comm = db.comms.find((c) => c.id === attack.communication_id)!;
      return HttpResponse.json({ ...attack, session_state: comm.session_status }, { status: 201 });
    } catch (e) {
      return fail(e);
    }
  }),

  http.get(p("/attacks/history"), ({ request }) => {
    const s = requireAuth(request);
    const rows: AttackRow[] = db.attacks.filter((a) => a.attacker_id === s.id).reverse();
    return paginated(rows, new URL(request.url));
  }),

  http.get(p("/attacks/:id"), ({ request, params }) => {
    const s = requireAuth(request);
    const attack = db.attacks.find((a) => a.id === Number(params.id));
    if (!attack || (s.role !== "ADMIN" && attack.attacker_id !== s.id))
      return HttpResponse.json({ code: "ATTACK_NOT_FOUND", message: "ATTACK_NOT_FOUND" }, { status: 404 });
    return HttpResponse.json(attack);
  }),

  http.get(p("/eve/dashboard/summary"), ({ request }) => {
    const s = requireAuth(request);
    if (s.role !== "ATTACKER")
      return HttpResponse.json({ code: "ROLE_FORBIDDEN", message: "ROLE_FORBIDDEN" }, { status: 403 });
    return HttpResponse.json({
      active_sessions: db.activeSessions().length,
      total_attacks: db.attacks.filter((a) => a.attacker_id === s.id).length,
      detected_attacks: db.attacks.filter(
        (a) => a.attacker_id === s.id && a.detection_status === "DETECTED",
      ).length,
      detection_rate: (() => {
        const mine = db.attacks.filter((a) => a.attacker_id === s.id);
        return mine.length
          ? Number((mine.filter((a) => a.detection_status === "DETECTED").length / mine.length).toFixed(2))
          : 0;
      })(),
    });
  }),

  // ---- DASHBOARDS / ADMIN ---------------------------------------------
  http.get(p("/dashboard/summary"), ({ request }) => {
    const s = requireAuth(request);
    return HttpResponse.json(db.userSummary(s.id));
  }),

  http.get(p("/admin/dashboard/summary"), ({ request }) => {
    const s = requireAuth(request);
    if (s.role !== "ADMIN")
      return HttpResponse.json({ code: "ROLE_FORBIDDEN", message: "ROLE_FORBIDDEN" }, { status: 403 });
    return HttpResponse.json(db.adminSummary());
  }),

  http.get(p("/admin/users"), ({ request }) => {
    const s = requireAuth(request);
    if (s.role !== "ADMIN")
      return HttpResponse.json({ code: "ROLE_FORBIDDEN", message: "ROLE_FORBIDDEN" }, { status: 403 });
    const search = (new URL(request.url).searchParams.get("search") ?? "").toLowerCase();
    const users = db.users
      .filter(
        (u) =>
          !search ||
          u.name.toLowerCase().includes(search) ||
          (u.email ?? "").toLowerCase().includes(search) ||
          u.unique_user_id.toLowerCase().includes(search),
      )
      .map(fullUser);
    return HttpResponse.json({ items: users, total: users.length, page: 1, limit: 50 });
  }),

  http.patch(p("/admin/users/:id"), async ({ request, params }) => {
    try {
      const s = requireAuth(request);
      if (s.role !== "ADMIN")
        return HttpResponse.json({ code: "ROLE_FORBIDDEN", message: "ROLE_FORBIDDEN" }, { status: 403 });
      const target = db.users.find((u) => u.id === Number(params.id));
      if (!target)
        return HttpResponse.json({ code: "USER_NOT_FOUND", message: "USER_NOT_FOUND" }, { status: 404 });
      const body = (await request.json()) as { is_active?: boolean };
      if (target.id === s.id && body.is_active === false)
        return HttpResponse.json(
          { code: "ADMIN_CANNOT_DISABLE_SELF", message: "ADMIN_CANNOT_DISABLE_SELF" },
          { status: 409 },
        );
      target.is_active = body.is_active ?? target.is_active;
      db.auditLog(s.id, "admin.user.update", `user ${target.name} is_active=${target.is_active}`);
      return HttpResponse.json(fullUser(target));
    } catch (e) {
      return fail(e);
    }
  }),

  http.get(p("/admin/security-events"), ({ request }) => {
    const s = requireAuth(request);
    if (s.role !== "ADMIN")
      return HttpResponse.json({ code: "ROLE_FORBIDDEN", message: "ROLE_FORBIDDEN" }, { status: 403 });
    const rows: SecurityEventRow[] = db.reports.map((r) => ({
      communication_id: db.messages.find((m) => m.id === r.message_id)?.communication_id ?? 0,
      protocol: r.protocol,
      qber: r.qber,
      threshold: r.threshold,
      key_status: r.key_status,
      attack_detected: r.attack_detected,
      verdict: r.delivery_status,
      created_at: r.created_at,
    }));
    return paginated(rows, new URL(request.url));
  }),

  http.get(p("/admin/protocol-analytics"), ({ request }) => {
    const s = requireAuth(request);
    if (s.role !== "ADMIN")
      return HttpResponse.json({ code: "ROLE_FORBIDDEN", message: "ROLE_FORBIDDEN" }, { status: 403 });
    const protocols: ProtocolAnalyticsRow[] = db.protocolAnalytics();
    return HttpResponse.json({ protocols, by_day: db.adminSummary().communications_per_day });
  }),

  http.get(p("/admin/audit-logs"), ({ request }) => {
    const s = requireAuth(request);
    if (s.role !== "ADMIN")
      return HttpResponse.json({ code: "ROLE_FORBIDDEN", message: "ROLE_FORBIDDEN" }, { status: 403 });
    const rows: AuditRow[] = db.audit;
    return paginated(rows, new URL(request.url));
  }),

  http.get(p("/protocols"), () =>
    HttpResponse.json([
      { name: "BB84", supported: true, default_threshold: 0.11 },
      { name: "B92", supported: false, default_threshold: 0.11 },
      { name: "E91", supported: false, default_threshold: 0.11 },
      { name: "SIX_STATE", supported: false, default_threshold: 0.11 },
      { name: "SARG04", supported: false, default_threshold: 0.11 },
      { name: "DECOY_BB84", supported: false, default_threshold: 0.11 },
    ]),
  ),
];

// ---- helpers ---------------------------------------------------------
function publicUser(u: (typeof db.users)[number]) {
  return { id: u.id, name: u.name, email: u.email, unique_user_id: u.unique_user_id, role: u.role };
}
function fullUser(u: (typeof db.users)[number]) {
  return { ...publicUser(u), is_active: u.is_active, created_at: u.created_at };
}
function userName(id: number) {
  return db.users.find((u) => u.id === id)?.name ?? "?";
}
function messageRow(m: (typeof db.messages)[number]): MessageRow {
  return {
    id: m.id,
    sender: { id: m.sender_id, name: userName(m.sender_id) },
    receiver: { id: m.receiver_id, name: userName(m.receiver_id) },
    protocol: m.protocol,
    qber: m.qber,
    key_status: m.key_status,
    status: m.status,
    attack_detected: m.attack_detected,
    created_at: m.created_at,
    read_at: m.read_at,
  };
}
function paginated<T>(items: T[], url: URL) {
  const page = Number(url.searchParams.get("page") ?? 1);
  const limit = Number(url.searchParams.get("limit") ?? 20);
  const start = (page - 1) * limit;
  return HttpResponse.json<DefaultBodyType>({
    items: items.slice(start, start + limit),
    total: items.length,
    page,
    limit,
  });
}
