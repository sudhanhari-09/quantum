/**
 * Simulated backend for dev/demo/tests ONLY (gated behind VITE_ENABLE_MOCKS=1).
 * Implements the Section 19/20 contracts in-memory so every UI phase can be
 * exercised without Track B. Production builds talk exclusively to the real
 * FastAPI backend; this module is never a production data source.
 */
import type {
  ActiveSession,
  AttackRow,
  AuditRow,
  CommState,
  CommunicationSummary,
  KeyStatus,
  MessageRow,
  MessageStatus,
  Protocol,
  QkdRun,
  QubitSampleRow,
  Role,
  SecurityReport,
  TimelineEvent,
  User,
} from "../types/api";

const THRESHOLD = 0.11;
const CHANNEL_NOISE = 0.01;
const QUBITS = 256;
const STEP_MS = 1400;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DbUser extends User {
  password: string;
}

export interface DbMessage extends MessageRow {
  receiver_id: number;
  sender_id: number;
  communication_id: number;
  content_ciphertext: string | null;
  plaintext: string | null;
  security_requirement: string;
}

export interface DbComm extends Omit<CommunicationSummary, "sender" | "receiver"> {
  sender_id: number;
  receiver_id: number;
  timeline: TimelineEvent[];
  recommendation: {
    protocol: Protocol;
    confidence: number;
    explanation: string;
    scores: Record<string, number>;
    features: Record<string, number | string>;
    evaluated_at: string;
  } | null;
}

interface Listener {
  role: Role;
  userId: number;
  channel: string;
  send: (data: string) => void;
}

let nextId = 1;

function makeQscId(rand: () => number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "QSC-";
  for (let i = 0; i < 10; i++) id += chars[Math.floor(rand() * chars.length)];
  return id;
}

class MockBackend {
  users: DbUser[] = [];
  messages: DbMessage[] = [];
  comms: DbComm[] = [];
  qkdRuns: (QkdRun & { communication_id: number })[] = [];
  attacks: AttackRow[] = [];
  reports: SecurityReport[] = [];
  audit: AuditRow[] = [];
  private listeners = new Set<Listener>();
  private rand = mulberry32(42);

  reset() {
    /* keep singleton state across HMR */
  }

  emit(
    type: string,
    communicationId: number | null,
    state: CommState | null,
    actorRole: Role | "SYSTEM",
    payload: Record<string, unknown>,
    audience: "user" | "eve" | "admin" | "comm" = "user",
  ) {
    const envelope = JSON.stringify({
      type,
      communication_id: communicationId,
      state,
      actor_role: actorRole,
      payload,
      timestamp: new Date().toISOString(),
    });
    this.listeners.forEach((l) => {
      const targeted =
        audience === "admin"
          ? l.role === "ADMIN"
          : audience === "eve"
            ? l.role === "ATTACKER"
            : l.role === "ADMIN" ||
              (communicationId != null &&
                this.commParticipants(communicationId).includes(l.userId)) ||
              (type.startsWith("message.") &&
                this.messageAudience(payload).includes(l.userId));
      if (targeted) l.send(envelope);
    });
  }

  private commParticipants(commId: number): number[] {
    const c = this.comms.find((x) => x.id === commId);
    return c ? [c.sender_id, c.receiver_id] : [];
  }

  private messageAudience(payload: Record<string, unknown>): number[] {
    const ids: number[] = [];
    if (typeof payload.receiver_id === "number") ids.push(payload.receiver_id);
    if (typeof payload.sender_id === "number") ids.push(payload.sender_id);
    return ids.length
      ? ids
      : payload.message_id
        ? (() => {
            const m = this.messages.find((x) => x.id === payload.message_id);
            return m ? [m.sender_id, m.receiver_id] : [];
          })()
        : [];
  }

  addListener(l: Listener) {
    this.listeners.add(l);
  }
  removeListener(l: Listener) {
    this.listeners.delete(l);
  }

  auditLog(userId: number | null, action: string, description: string) {
    const u = this.users.find((x) => x.id === userId);
    this.audit.unshift({
      id: nextId++,
      user_id: userId,
      user_name: u?.name ?? null,
      user_role: u?.role ?? null,
      action,
      description,
      created_at: new Date().toISOString(),
    });
  }

  register(name: string, email: string, password: string): DbUser {
    email = email.toLowerCase();
    if (this.users.some((u) => u.email === email))
      throw httpError(409, "EMAIL_TAKEN");
    const user: DbUser = {
      id: nextId++,
      name,
      email,
      password,
      unique_user_id: makeQscId(this.rand),
      role: "USER",
      is_active: true,
      created_at: new Date().toISOString(),
    };
    this.users.push(user);
    this.auditLog(user.id, "register", `user ${name} registered`);
    return user;
  }

  login(email: string, password: string): DbUser {
    const user = this.users.find((u) => u.email === email.toLowerCase());
    if (!user || user.password !== password)
      throw httpError(401, "INVALID_CREDENTIALS");
    if (!user.is_active) throw httpError(403, "USER_DISABLED");
    this.auditLog(user.id, "login", `user ${user.name} logged in`);
    return user;
  }

  tokensFor(user: DbUser) {
    return {
      access_token: `mock-access-${user.id}-${Date.now()}`,
      refresh_token: `mock-refresh-${user.id}-${Date.now()}`,
      token_type: "bearer" as const,
      expires_in: 1800,
    };
  }

  searchByQsc(qscId: string): User | null {
    return (
      this.users.find((u) => u.unique_user_id === qscId.toUpperCase()) ?? null
    );
  }

  createMessage(
    senderId: number,
    receiverQscId: string,
    content: string,
    securityRequirement: string,
  ): { message_id: number; communication_id: number } {
    const receiver = this.searchByQsc(receiverQscId);
    if (!receiver) throw httpError(404, "USER_NOT_FOUND");
    if (receiver.id === senderId) throw httpError(409, "SELF_DELIVERY");
    const sender = this.users.find((u) => u.id === senderId)!;
    const now = new Date().toISOString();
    const comm: DbComm = {
      id: nextId++,
      sender_id: sender.id,
      receiver_id: receiver.id,
      protocol: null,
      session_status: "CREATED",
      message_status: "PENDING",
      key_status: "PENDING",
      qber: null,
      attack_detected: false,
      created_at: now,
      completed_at: null,
      timeline: [],
      recommendation: null,
    };
    const message: DbMessage = {
      id: nextId++,
      communication_id: comm.id,
      sender_id: sender.id,
      receiver_id: receiver.id,
      sender: { id: sender.id, name: sender.name },
      protocol: null,
      status: "PENDING",
      key_status: "PENDING",
      qber: null,
      attack_detected: false,
      created_at: now,
      read_at: null,
      plaintext: content,
      content_ciphertext: null,
      security_requirement: securityRequirement,
    };
    this.comms.push(comm);
    this.messages.push(message);
    this.auditLog(senderId, "message.create", `message ${message.id} to ${receiver.name}`);
    this.emit("communication.created", comm.id, "CREATED", "SYSTEM", {
      communication_id: comm.id,
      sender: sender.name,
      receiver: receiver.name,
      created_at: now,
    }, "eve");
    // async pipeline
    window.setTimeout(() => void this.runPipeline(comm.id), 400);
    return { message_id: message.id, communication_id: comm.id };
  }

  /** Orchestrates CREATED -> ... -> terminal exactly per Section 07/08. */
  private async runPipeline(commId: number) {
    const advance = (state: CommState, extra?: Partial<DbComm>) =>
      this.transition(commId, state, extra);

    await wait(200);
    advance("RECEIVER_VERIFIED");
    await wait(STEP_MS);
    advance("AI_ANALYZING");
    this.emit("ai.analysis_started", commId, "AI_ANALYZING", "SYSTEM", {}, "user");
    await wait(STEP_MS);

    const comm = this.comms.find((c) => c.id === commId)!;
    const confidence = 0.72 + this.rand() * 0.24;
    comm.recommendation = {
      protocol: "BB84",
      confidence: Number(confidence.toFixed(2)),
      explanation:
        "BB84 chosen: highest maturity score, meets current risk and noise conditions.",
      scores: {
        BB84: Number(confidence.toFixed(2)),
        B92: Number((confidence - 0.18).toFixed(2)),
        E91: Number((confidence - 0.31).toFixed(2)),
        SIX_STATE: Number((confidence - 0.25).toFixed(2)),
      },
      features: {
        channel_noise: CHANNEL_NOISE,
        security_requirement:
          this.messages.find((m) => m.communication_id === commId)
            ?.security_requirement ?? "MEDIUM",
        estimated_attack_risk: Number((this.rand() * 0.3).toFixed(2)),
        distance_km: 80 + Math.floor(this.rand() * 40),
      },
      evaluated_at: new Date().toISOString(),
    };
    advance("PROTOCOL_SELECTED", { protocol: "BB84" });
    this.emit("ai.protocol_selected", commId, "PROTOCOL_SELECTED", "SYSTEM", {
      protocol: "BB84",
      confidence: comm.recommendation.confidence,
      explanation: comm.recommendation.explanation,
      scores: comm.recommendation.scores,
    }, "user");

    await wait(STEP_MS);
    advance("QKD_INITIALIZING");
    this.emit("qkd.started", commId, "QKD_INITIALIZING", "SYSTEM", {
      protocol: "BB84",
      qubit_count: QUBITS,
    }, "user");

    await wait(300);
    advance("QKD_RUNNING");
    const run = this.simulateBb84(commId, true, 0);
    this.qkdRuns.push(run);
    for (const pct of [30, 60, 90]) {
      await wait(STEP_MS / 2);
      this.emit("qkd.progress", commId, "QKD_RUNNING", "SYSTEM", {
        percent: pct,
        stage: pct < 50 ? "measurement" : "sifting",
      }, "user");
    }

    await wait(STEP_MS / 2);
    advance("KEY_SIFTING");
    await wait(STEP_MS / 2);
    advance("QBER_EVALUATION");
    this.emit("qkd.completed", commId, "KEY_SIFTING", "SYSTEM", {
      qubits_generated: run.qubits_generated,
      matching_bases: run.matching_bases,
      sifted_bits: run.sifted_bits,
      compared_bits: run.compared_bits,
      errors: run.errors,
      qber: run.qber,
    }, "user");
    this.emit("qber.calculated", commId, "QBER_EVALUATION", "SYSTEM", {
      qber: run.qber,
      threshold: THRESHOLD,
    }, "user");

    await wait(STEP_MS / 2);
    advance("SECURITY_CHECK");
    this.emit("security.check_started", commId, "SECURITY_CHECK", "SYSTEM", {}, "user");
    await wait(STEP_MS / 2);

    if (run.qber <= THRESHOLD) {
      run.key_status = "ACCEPTED";
      advance("KEY_ACCEPTED");
      const msg = this.messages.find((m) => m.communication_id === commId)!;
      this.emit("security.key_accepted", commId, "KEY_ACCEPTED", "SYSTEM", {
        message_id: msg.id,
      }, "user");
      await wait(STEP_MS / 2);
      msg.content_ciphertext = btoa(unescape(encodeURIComponent(msg.plaintext!)));
      advance("ENCRYPTING");
      await wait(STEP_MS / 2);
      advance("ENCRYPTED");
      this.emit("message.encrypted", commId, "ENCRYPTED", "SYSTEM", {
        message_id: msg.id,
      }, "user");
      await wait(STEP_MS / 2);
      advance("DELIVERED", { completed_at: new Date().toISOString() });
      msg.status = "DELIVERED";
      this.writeReport(msg, "ENCRYPTED", "DELIVERED");
      this.emit("message.delivered", commId, "DELIVERED", "SYSTEM", {
        message_id: msg.id,
        receiver_id: msg.receiver_id,
      }, "user");
    } else {
      this.rejectPath(commId, false);
    }
  }

  simulateBb84(commId: number, isBaseline: boolean, strength: number): QkdRun & { communication_id: number } {
    const seed = commId * 1000 + (isBaseline ? 0 : this.qkdRuns.length + 1);
    const rand = mulberry32(seed);
    const sample: QubitSampleRow[] = [];
    let matching = 0;
    let errors = 0;
    const bases = ["R", "D"] as const;
    for (let i = 0; i < QUBITS; i++) {
      const aliceBit = rand() < 0.5 ? 0 : 1;
      const aliceBasis = bases[Math.floor(rand() * 2)];
      const bobBasis = bases[Math.floor(rand() * 2)];
      const noiseFlip = rand() < CHANNEL_NOISE;
      let bobBit = aliceBit;
      if (aliceBasis !== bobBasis) {
        bobBit = rand() < 0.5 ? 0 : 1;
      } else if (noiseFlip) {
        bobBit = aliceBit === 0 ? 1 : 0;
      }
      // Eve intercept-and-resend on intercepted subset introduces ~25% error
      if (!isBaseline && i < Math.round(strength * QUBITS)) {
        const eveBasis = bases[Math.floor(rand() * 2)];
        if (eveBasis !== aliceBasis && aliceBasis === bobBasis) {
          bobBit = rand() < 0.5 ? 0 : 1;
        }
      }
      const basisMatch = aliceBasis === bobBasis;
      const kept = basisMatch;
      const error = kept && bobBit !== aliceBit;
      if (basisMatch) matching++;
      if (error) errors++;
      if (i < 32)
        sample.push({
          index: i + 1,
          alice_bit: aliceBit as 0 | 1,
          alice_basis: aliceBasis,
          bob_basis: bobBasis,
          bob_bit: bobBit as 0 | 1,
          basis_match: basisMatch,
          kept,
          error,
        });
    }
    const sifted = matching;
    const compared = sifted;
    const qber = compared === 0 ? 0 : Number((errors / compared).toFixed(6));
    return {
      id: nextId++,
      communication_id: commId,
      protocol: "BB84",
      qubits_generated: QUBITS,
      matching_bases: matching,
      sifted_bits: sifted,
      compared_bits: compared,
      errors,
      qber,
      threshold: THRESHOLD,
      key_status: isBaseline ? ("PENDING" as KeyStatus) : ("PENDING" as KeyStatus),
      is_baseline: isBaseline,
      created_at: new Date().toISOString(),
      sample,
    };
  }

  launchAttack(attackerId: number, commId: number, strength: number): AttackRow {
    const comm = this.comms.find((c) => c.id === commId);
    if (!comm) throw httpError(404, "COMMUNICATION_NOT_FOUND");
    if (!["QKD_INITIALIZING", "QKD_RUNNING", "KEY_SIFTING", "QBER_EVALUATION", "SECURITY_CHECK"].includes(comm.session_status))
      throw httpError(409, "ATTACK_WINDOW_CLOSED");
    if (strength < 0.1 || strength > 1.0) throw httpError(422, "VALIDATION_ERROR");

    const baseline =
      this.qkdRuns.find((r) => r.communication_id === commId && r.is_baseline) ??
      this.simulateBb84(commId, true, 0);
    this.emit("attack.started", commId, comm.session_status, "ATTACKER", {
      attack_id: nextId,
      communication_id: commId,
      strength,
      states_intercepted: Math.round(strength * QUBITS),
    }, "eve");

    const rerun = this.simulateBb84(commId, false, strength);
    rerun.is_baseline = false;
    this.qkdRuns.push(rerun);

    const detected = rerun.qber > THRESHOLD;
    const attack: AttackRow = {
      id: nextId++,
      attacker_id: attackerId,
      communication_id: commId,
      attack_type: "INTERCEPT_AND_RESEND",
      attack_strength: strength,
      states_intercepted: Math.round(strength * QUBITS),
      states_modified: rerun.errors,
      qber_before: baseline.qber,
      qber_after: rerun.qber,
      detection_status: detected ? "DETECTED" : "NOT_DETECTED",
      created_at: new Date().toISOString(),
      threshold: THRESHOLD,
    };
    this.attacks.push(attack);
    this.auditLog(attackerId, "attack.launch", `attack ${attack.id} on communication ${commId}`);

    this.emit("attack.progress", commId, comm.session_status, "ATTACKER", {
      percent: 100,
      states_modified: rerun.errors,
    }, "eve");
    this.emit("qber.calculated", commId, comm.session_status, "SYSTEM", {
      qber: rerun.qber,
      threshold: THRESHOLD,
    }, "user");

    if (detected) {
      this.emit("attack.detected", commId, "ATTACK_DETECTED", "SYSTEM", {
        attack_id: attack.id,
        qber_before: attack.qber_before,
        qber_after: attack.qber_after,
        detection_status: "DETECTED",
      }, "user");
      this.rejectPath(commId, true);
    }
    return attack;
  }

  private rejectPath(commId: number, fromAttack: boolean) {
    const comm = this.comms.find((c) => c.id === commId)!;
    const msg = this.messages.find((m) => m.communication_id === commId)!;
    const seq: CommState[] = fromAttack
      ? ["ATTACK_DETECTED", "KEY_REJECTED", "BLOCKED"]
      : ["ATTACK_DETECTED", "KEY_REJECTED", "BLOCKED"];
    for (const s of seq) {
      this.transition(commId, s);
      if (s === "ATTACK_DETECTED") {
        msg.status = "REJECTED";
        this.emit("security.key_rejected", commId, s, "SYSTEM", {
          message_id: msg.id,
          reason: "QBER exceeded simulation threshold",
        }, "user");
      }
      waitSync(150);
    }
    msg.status = "BLOCKED";
    msg.attack_detected = true;
    msg.key_status = "REJECTED";
    comm.attack_detected = true;
    comm.completed_at = new Date().toISOString();
    this.writeReport(msg, "NOT_ENCRYPTED", "BLOCKED");
    this.emit("message.blocked", commId, "BLOCKED", "SYSTEM", {
      message_id: msg.id,
      reason: "QBER exceeded simulation threshold",
    }, "user");
  }

  writeReport(msg: DbMessage, encryptionStatus: SecurityReport["encryption_status"], delivery: SecurityReport["delivery_status"]) {
    const run = [...this.qkdRuns]
      .reverse()
      .find((r) => r.communication_id === msg.communication_id);
    this.reports.unshift({
      message_id: msg.id,
      protocol: msg.protocol ?? "BB84",
      qber: run?.qber ?? 0,
      threshold: THRESHOLD,
      attack_detected: msg.attack_detected,
      key_status: msg.key_status ?? "PENDING",
      encryption_status: encryptionStatus,
      delivery_status: delivery,
      created_at: new Date().toISOString(),
    });
  }

  transition(commId: number, to: CommState, extra?: Partial<DbComm>) {
    const comm = this.comms.find((c) => c.id === commId);
    if (!comm) throw httpError(404, "COMMUNICATION_NOT_FOUND");
    const prev = comm.session_status;
    comm.session_status = to;
    Object.assign(comm, extra ?? {});
    const msg = this.messages.find((m) => m.communication_id === commId);
    const mapping: Record<CommState, MessageStatus> = {
      CREATED: "PENDING",
      RECEIVER_VERIFIED: "VERIFIED",
      AI_ANALYZING: "PROCESSING",
      PROTOCOL_SELECTED: "PROCESSING",
      QKD_INITIALIZING: "PROCESSING",
      QKD_RUNNING: "PROCESSING",
      KEY_SIFTING: "PROCESSING",
      QBER_EVALUATION: "PROCESSING",
      SECURITY_CHECK: "PROCESSING",
      KEY_ACCEPTED: "PROCESSING",
      ENCRYPTING: "ENCRYPTED",
      ENCRYPTED: "ENCRYPTED",
      DELIVERED: "DELIVERED",
      READ: "READ",
      ATTACK_DETECTED: "REJECTED",
      KEY_REJECTED: "BLOCKED",
      BLOCKED: "BLOCKED",
      FAILED: "FAILED",
    };
    const keyMapping: Record<CommState, KeyStatus> = {
      CREATED: "PENDING",
      RECEIVER_VERIFIED: "PENDING",
      AI_ANALYZING: "PENDING",
      PROTOCOL_SELECTED: "PENDING",
      QKD_INITIALIZING: "PENDING",
      QKD_RUNNING: "PENDING",
      KEY_SIFTING: "PENDING",
      QBER_EVALUATION: "PENDING",
      SECURITY_CHECK: "PENDING",
      KEY_ACCEPTED: "ACCEPTED",
      ENCRYPTING: "ACCEPTED",
      ENCRYPTED: "ACCEPTED",
      DELIVERED: "ACCEPTED",
      READ: "ACCEPTED",
      ATTACK_DETECTED: "REJECTED",
      KEY_REJECTED: "REJECTED",
      BLOCKED: "REJECTED",
      FAILED: "PENDING",
    };
    comm.message_status = mapping[to];
    comm.key_status = keyMapping[to];
    if (msg) {
      msg.status = mapping[to];
      msg.key_status = keyMapping[to];
      if (to === "PROTOCOL_SELECTED") msg.protocol = comm.protocol;
      const run = [...this.qkdRuns].reverse().find((r) => r.communication_id === commId);
      if (run) msg.qber = run.qber;
      if (to === "DELIVERED") msg.status = "DELIVERED";
    }
    comm.timeline.push({
      type: "communication.state_changed",
      state: to,
      previous_state: prev,
      timestamp: new Date().toISOString(),
    });
    this.emit("communication.state_changed", commId, to, "SYSTEM", {
      state: to,
      previous_state: prev,
    }, "user");
  }

  markRead(messageId: number, userId: number) {
    const msg = this.messages.find((m) => m.id === messageId);
    if (!msg) throw httpError(404, "MESSAGE_NOT_FOUND");
    if (msg.receiver_id !== userId) throw httpError(403, "FOREIGN_MESSAGE");
    if (msg.status === "DELIVERED") {
      msg.status = "READ";
      msg.read_at = new Date().toISOString();
      const comm = this.comms.find((c) => c.id === msg.communication_id);
      if (comm) this.transition(comm.id, "READ", { completed_at: msg.read_at });
      this.emit("message.read", msg.communication_id, "READ", "USER", {
        message_id: messageId,
        read_at: msg.read_at,
      }, "user");
    }
    return msg;
  }

  activeSessions(): ActiveSession[] {
    return this.comms
      .filter((c) =>
        ["QKD_INITIALIZING", "QKD_RUNNING", "KEY_SIFTING", "QBER_EVALUATION", "SECURITY_CHECK"].includes(c.session_status),
      )
      .map((c) => ({
        id: c.id,
        sender_name: this.users.find((u) => u.id === c.sender_id)?.name ?? "?",
        receiver_name: this.users.find((u) => u.id === c.receiver_id)?.name ?? "?",
        protocol: c.protocol,
        session_state: c.session_status,
        created_at: c.created_at,
      }));
  }

  userSummary(userId: number) {
    const mine = this.messages.filter(
      (m) => m.sender_id === userId || m.receiver_id === userId,
    );
    const runs = this.qkdRuns.filter((r) =>
      mine.some((m) => m.communication_id === r.communication_id),
    );
    return {
      messages_sent: mine.filter((m) => m.sender_id === userId).length,
      messages_received: mine.filter((m) => m.receiver_id === userId).length,
      messages_delivered: mine.filter((m) => m.status === "DELIVERED" || m.status === "READ").length,
      messages_blocked: mine.filter((m) => m.status === "BLOCKED").length,
      active_communications: this.comms.filter(
        (c) =>
          (c.sender_id === userId || c.receiver_id === userId) &&
          !["READ", "BLOCKED", "FAILED"].includes(c.session_status),
      ).length,
      attacks_on_mine: this.attacks.filter((a) =>
        this.comms.some(
          (c) => c.id === a.communication_id && (c.sender_id === userId || c.receiver_id === userId),
        ),
      ).length,
      average_qber: runs.length
        ? Number((runs.reduce((s, r) => s + r.qber, 0) / runs.length).toFixed(4))
        : 0,
      recent: this.comms
        .filter((c) => c.sender_id === userId || c.receiver_id === userId)
        .slice(-8)
        .reverse()
        .map((c) => this.toCommSummary(c)),
    };
  }

  toCommSummary(c: DbComm): CommunicationSummary {
    return {
      id: c.id,
      sender: { id: c.sender_id, name: this.users.find((u) => u.id === c.sender_id)?.name ?? "?" },
      receiver: { id: c.receiver_id, name: this.users.find((u) => u.id === c.receiver_id)?.name ?? "?" },
      protocol: c.protocol,
      session_status: c.session_status,
      message_status: c.message_status,
      key_status: c.key_status,
      qber: c.qber,
      attack_detected: c.attack_detected,
      created_at: c.created_at,
      completed_at: c.completed_at,
    };
  }

  adminSummary() {
    const days: Record<string, number> = {};
    this.comms.forEach((c) => {
      const d = c.created_at.slice(0, 10);
      days[d] = (days[d] ?? 0) + 1;
    });
    const delivered = this.messages.filter((m) => m.status === "DELIVERED" || m.status === "READ").length;
    const blocked = this.messages.filter((m) => m.status === "BLOCKED").length;
    return {
      total_users: this.users.filter((u) => u.role !== "ATTACKER").length,
      active_communications: this.activeSessions().length,
      messages_delivered: delivered,
      messages_blocked: blocked,
      attacks_total: this.attacks.length,
      attacks_detected: this.attacks.filter((a) => a.detection_status === "DETECTED").length,
      attack_detection_rate: this.attacks.length
        ? Number(
            (this.attacks.filter((a) => a.detection_status === "DETECTED").length / this.attacks.length).toFixed(2),
          )
        : 0,
      average_qber: this.qkdRuns.length
        ? Number((this.qkdRuns.reduce((s, r) => s + r.qber, 0) / this.qkdRuns.length).toFixed(4))
        : 0,
      communications_per_day: Object.entries(days)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-14),
      security_outcomes: [
        { outcome: "Delivered", count: delivered },
        { outcome: "Blocked", count: blocked },
      ],
      protocol_usage: [{ protocol: "BB84", sessions: this.comms.length }],
      recent_audit: this.audit.slice(0, 8),
    };
  }

  protocolAnalytics() {
    const bb84Comms = this.comms.length;
    const bb84Attacks = this.attacks.length;
    const accepted = this.qkdRuns.filter((r) => r.key_status === "ACCEPTED").length;
    return [
      {
        name: "BB84" as Protocol,
        supported: true,
        default_threshold: THRESHOLD,
        sessions: bb84Comms,
        avg_qber: this.qkdRuns.length
          ? Number((this.qkdRuns.reduce((s, r) => s + r.qber, 0) / this.qkdRuns.length).toFixed(4))
          : 0,
        acceptance_rate: this.qkdRuns.length ? Number((accepted / this.qkdRuns.length).toFixed(2)) : 0,
        attacks: bb84Attacks,
        avg_confidence: 0.85,
      },
      ...(["B92", "E91", "SIX_STATE"] as Protocol[]).map((name) => ({
        name,
        supported: false,
        default_threshold: THRESHOLD,
        sessions: 0,
        avg_qber: 0,
        acceptance_rate: 0,
        attacks: 0,
        avg_confidence: 0,
      })),
    ];
  }
}

function httpError(status: number, code: string) {
  const err = new Error(code) as Error & { __http?: [number, string] };
  err.__http = [status, code];
  return err;
}

export function asHttpError(e: unknown): [number, string] | null {
  const err = e as Error & { __http?: [number, string] };
  return err.__http ?? null;
}

function wait(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}
function waitSync(ms: number) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    /* busy-wait keeps ordering deterministic in demo */
  }
}

/** Singleton mock database. */
export const db = new MockBackend();

/** Seed demo identities through the normal registration path (R2-compliant). */
export function seedMockData() {
  if (db.users.length > 0) return;
  try {
    db.register("Alice", "alice@qsc.dev", "password123");
    db.register("Bob", "bob@qsc.dev", "password123");
    const eve = db.register("Eve", "eve@qsc.dev", "password123");
    eve.role = "ATTACKER";
    const admin = db.register("Admin", "admin@qsc.dev", "password123");
    admin.role = "ADMIN";
    db.auditLog(null, "system.seed", "demo accounts provisioned via register path");
  } catch {
    /* already seeded */
  }
}
