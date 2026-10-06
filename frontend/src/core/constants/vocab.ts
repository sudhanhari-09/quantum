export const COMM_STATES = [
  "CREATED",
  "RECEIVER_VERIFIED",
  "AI_ANALYZING",
  "PROTOCOL_SELECTED",
  "QKD_INITIALIZING",
  "QKD_RUNNING",
  "KEY_SIFTING",
  "QBER_EVALUATION",
  "SECURITY_CHECK",
  "KEY_ACCEPTED",
  "ENCRYPTING",
  "ENCRYPTED",
  "DELIVERED",
  "READ",
  "ATTACK_DETECTED",
  "KEY_REJECTED",
  "BLOCKED",
  "FAILED",
] as const;
export type CommState = (typeof COMM_STATES)[number];

export const TERMINAL_STATES: CommState[] = ["READ", "BLOCKED", "FAILED"];

export const ATTACK_WINDOW_STATES: CommState[] = [
  "QKD_INITIALIZING",
  "QKD_RUNNING",
  "KEY_SIFTING",
  "QBER_EVALUATION",
  "SECURITY_CHECK",
];

export const MESSAGE_STATUSES = [
  "PENDING",
  "VERIFIED",
  "PROCESSING",
  "ENCRYPTED",
  "DELIVERED",
  "READ",
  "REJECTED",
  "BLOCKED",
  "FAILED",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const KEY_STATUSES = ["PENDING", "ACCEPTED", "REJECTED"] as const;
export type KeyStatus = (typeof KEY_STATUSES)[number];

export const ROLES = ["USER", "ATTACKER", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export const PROTOCOLS = [
  "BB84",
  "B92",
  "E91",
  "SIX_STATE",
  "SARG04",
  "DECOY_BB84",
] as const;
export type Protocol = (typeof PROTOCOLS)[number];

export const SECURITY_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type SecurityLevel = (typeof SECURITY_LEVELS)[number];

export const ATTACK_TYPES = ["INTERCEPT_AND_RESEND"] as const;
export type AttackType = (typeof ATTACK_TYPES)[number];

export const DETECTION_STATUSES = ["DETECTED", "NOT_DETECTED"] as const;
export type DetectionStatus = (typeof DETECTION_STATUSES)[number];

/** Error code catalog - Section 19.4 of the master plan. */
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "TOKEN_REQUIRED",
  "INVALID_CREDENTIALS",
  "TOKEN_INVALID",
  "TOKEN_REUSED",
  "USER_NOT_FOUND",
  "EMAIL_TAKEN",
  "USER_DISABLED",
  "QSC_NOT_FOUND",
  "INVALID_QSC_FORMAT",
  "SELF_DELIVERY",
  "CONTENT_TOO_LONG",
  "MESSAGE_NOT_FOUND",
  "FOREIGN_MESSAGE",
  "COMMUNICATION_NOT_FOUND",
  "FOREIGN_SESSION",
  "INVALID_STATE_TRANSITION",
  "ATTACK_WINDOW_CLOSED",
  "INVALID_ATTACK_TYPE",
  "KEY_REJECTED",
  "REPORT_NOT_FOUND",
  "ADMIN_CANNOT_DISABLE_SELF",
  "ROLE_FORBIDDEN",
  "RATE_LIMITED",
  "DATABASE_ERROR",
  "INTERNAL_ERROR",
  "PROTOCOL_NOT_SUPPORTED",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number] | "UNKNOWN";

export const WS_EVENT_TYPES = [
  "communication.created",
  "communication.receiver_verified",
  "communication.state_changed",
  "ai.analysis_started",
  "ai.protocol_selected",
  "protocol.adaptive_retry",
  "qkd.started",
  "qkd.progress",
  "qkd.completed",
  "qber.calculated",
  "security.check_started",
  "security.key_accepted",
  "security.key_rejected",
  "attack.started",
  "attack.progress",
  "attack.detected",
  "message.encrypted",
  "message.delivered",
  "message.blocked",
  "message.read",
  "audit.record",
  "config.updated",
] as const;
export type WsEventType = (typeof WS_EVENT_TYPES)[number];

export const QSC_ID_REGEX = /^QSC-[A-Z0-9]{10}$/;

/** Derived status mapping per Section 08 of the master plan. */
export const STATE_TO_MESSAGE_STATUS: Record<CommState, MessageStatus> = {
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

export const STATE_TO_KEY_STATUS: Record<CommState, KeyStatus> = {
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

export type StateGroup =
  | "preparation"
  | "qkd"
  | "security"
  | "secure"
  | "attack"
  | "failure";

export const STATE_GROUPS: Record<CommState, StateGroup> = {
  CREATED: "preparation",
  RECEIVER_VERIFIED: "preparation",
  AI_ANALYZING: "preparation",
  PROTOCOL_SELECTED: "preparation",
  QKD_INITIALIZING: "qkd",
  QKD_RUNNING: "qkd",
  KEY_SIFTING: "qkd",
  QBER_EVALUATION: "qkd",
  SECURITY_CHECK: "security",
  KEY_ACCEPTED: "secure",
  ENCRYPTING: "secure",
  ENCRYPTED: "secure",
  DELIVERED: "secure",
  READ: "secure",
  ATTACK_DETECTED: "attack",
  KEY_REJECTED: "attack",
  BLOCKED: "attack",
  FAILED: "failure",
};

export const ROLE_HOME: Record<Role, string> = {
  USER: "/dashboard",
  ATTACKER: "/eve/dashboard",
  ADMIN: "/admin/dashboard",
};
