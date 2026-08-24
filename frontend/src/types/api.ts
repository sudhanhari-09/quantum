import type {
  AttackType,
  CommState,
  DetectionStatus,
  KeyStatus,
  MessageStatus,
  Protocol,
  Role,
  WsEventType,
} from "../core/constants/vocab";

export type {
  AttackType,
  CommState,
  DetectionStatus,
  KeyStatus,
  MessageStatus,
  Protocol,
  Role,
  SecurityLevel,
  WsEventType,
} from "../core/constants/vocab";

export interface UserPublic {
  id: number;
  name: string;
  unique_user_id: string;
}

export interface User extends UserPublic {
  email?: string;
  role: Role;
  is_active?: boolean;
  created_at?: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  expires_in: number;
}

export interface LoginResponse extends AuthTokens {
  user: User;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ApiErrorEnvelope {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface MessageRow {
  id: number;
  sender: { id: number; name: string };
  receiver?: { id: number; name: string };
  protocol: Protocol | null;
  qber: number | null;
  key_status: KeyStatus | null;
  status: MessageStatus;
  attack_detected: boolean;
  created_at: string;
  read_at: string | null;
}

export interface MessageDetail extends MessageRow {
  content?: string;
  communication_id?: number;
}

export interface CommunicationSummary {
  id: number;
  sender: { id: number; name: string };
  receiver: { id: number; name: string };
  protocol: Protocol | null;
  session_status: CommState;
  message_status: MessageStatus;
  key_status: KeyStatus;
  qber: number | null;
  attack_detected: boolean;
  created_at: string;
  completed_at: string | null;
}

/** Metadata-only view for EVE (Section 14.3). */
export interface ActiveSession {
  id: number;
  sender_name: string;
  receiver_name: string;
  protocol: Protocol | null;
  session_state: CommState;
  created_at: string;
}

export interface Recommendation {
  protocol: Protocol;
  confidence: number;
  explanation: string;
  scores: Record<string, number>;
  features: Record<string, number | string>;
  evaluated_at: string;
}

export interface QkdRun {
  id: number;
  protocol: Protocol;
  qubits_generated: number;
  matching_bases: number;
  sifted_bits: number;
  compared_bits: number;
  errors: number;
  qber: number;
  threshold: number;
  key_status: KeyStatus;
  is_baseline: boolean;
  created_at: string;
  sample?: QubitSampleRow[];
}

export interface QubitSampleRow {
  index: number;
  alice_bit: 0 | 1;
  alice_basis: "R" | "D";
  bob_basis: "R" | "D";
  bob_bit: 0 | 1;
  basis_match: boolean;
  kept: boolean;
  error: boolean;
}

export interface SecurityState {
  decision: "ACCEPTED" | "REJECTED" | "PENDING";
  key_status: KeyStatus;
  attack_detected: boolean;
  qber: number;
  threshold: number;
  evaluated_at: string;
}

export interface TimelineEvent {
  type: WsEventType;
  state: CommState;
  previous_state?: CommState;
  timestamp: string;
}

export interface AttackRow {
  id: number;
  attacker_id: number;
  communication_id: number;
  attack_type: AttackType;
  attack_strength: number;
  states_intercepted: number;
  states_modified: number;
  qber_before: number;
  qber_after: number;
  detection_status: DetectionStatus;
  created_at: string;
  threshold?: number;
  message_blocked?: boolean;
}

export interface SecurityReport {
  message_id: number;
  protocol: Protocol;
  qber: number;
  threshold: number;
  attack_detected: boolean;
  key_status: KeyStatus;
  encryption_status: "ENCRYPTED" | "NOT_ENCRYPTED" | "SKIPPED";
  delivery_status: "DELIVERED" | "BLOCKED" | "PENDING";
  created_at: string;
}

export interface UserDashboardSummary {
  messages_sent: number;
  messages_received: number;
  messages_delivered: number;
  messages_blocked: number;
  active_communications: number;
  attacks_on_mine: number;
  average_qber: number;
  recent: CommunicationSummary[];
}

export interface EveDashboardSummary {
  active_sessions: number;
  total_attacks: number;
  detected_attacks: number;
  detection_rate: number;
}

export interface AdminDashboardSummary {
  total_users: number;
  active_communications: number;
  messages_delivered: number;
  messages_blocked: number;
  attacks_total: number;
  attacks_detected: number;
  attack_detection_rate: number;
  average_qber: number;
  communications_per_day: { date: string; count: number }[];
  security_outcomes: { outcome: string; count: number }[];
  protocol_usage: { protocol: string; sessions: number }[];
  recent_audit: AuditRow[];
}

export interface AuditRow {
  id: number;
  user_id: number | null;
  user_name?: string | null;
  user_role?: string | null;
  action: string;
  description: string;
  created_at: string;
}

export interface SecurityEventRow {
  communication_id: number;
  protocol: Protocol;
  qber: number;
  threshold: number;
  key_status: KeyStatus;
  attack_detected: boolean;
  verdict: string;
  created_at: string;
}

export interface ProtocolAnalyticsRow {
  name: Protocol;
  supported: boolean;
  default_threshold: number;
  sessions: number;
  avg_qber: number;
  acceptance_rate: number;
  attacks: number;
  avg_confidence: number;
}

export interface ProtocolRegistryEntry {
  name: Protocol;
  supported: boolean;
  default_threshold: number;
}

/** WS event envelope per Section 20. */
export interface WsEnvelope<P = Record<string, unknown>> {
  type: WsEventType;
  communication_id: number | null;
  state: CommState | null;
  actor_role: Role | "SYSTEM" | null;
  payload: P;
  timestamp: string;
}
