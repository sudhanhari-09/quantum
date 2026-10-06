import type { ErrorCode } from "./constants/vocab";

/** Central error-code -> user-safe message table (F32, Section 19.4). */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: "Some fields are invalid. Please review the form.",
  UNAUTHORIZED: "You need to sign in to continue.",
  TOKEN_REQUIRED: "Your session has expired. Please sign in again.",
  INVALID_CREDENTIALS: "Incorrect email or password.",
  TOKEN_INVALID: "Your session is no longer valid. Please sign in again.",
  TOKEN_REUSED: "Security check failed. Please sign in again.",
  SELF_DELIVERY: "You cannot send a secure message to yourself.",
  USER_NOT_FOUND: "No user was found with those details.",
  EMAIL_TAKEN: "An account with this email already exists.",
  USER_DISABLED: "This account has been disabled. Contact an administrator.",
  QSC_NOT_FOUND: "No user found with that QSC ID.",
  INVALID_QSC_FORMAT:
    "QSC ID must match the format QSC-XXXXXXXXXX (10 letters/digits).",
  CONTENT_TOO_LONG: "Message content exceeds the 2000 character limit.",
  MESSAGE_NOT_FOUND: "That message does not exist.",
  FOREIGN_MESSAGE: "You are not allowed to view this message.",
  COMMUNICATION_NOT_FOUND: "That communication session does not exist.",
  FOREIGN_SESSION: "You are not a participant of this session.",
  INVALID_STATE_TRANSITION: "The session state cannot change that way.",
  ATTACK_WINDOW_CLOSED:
    "The attack window for this communication is closed.",
  INVALID_ATTACK_TYPE: "Unsupported attack type.",
  KEY_REJECTED: "The quantum key was rejected; the message cannot proceed.",
  REPORT_NOT_FOUND: "No security report exists yet.",
  ADMIN_CANNOT_DISABLE_SELF: "Administrators cannot disable their own account.",
  ROLE_FORBIDDEN: "You do not have permission to perform this action.",
  RATE_LIMITED: "Too many requests. Please slow down and try again shortly.",
  DATABASE_ERROR: "A storage problem occurred. Try again later.",
  INTERNAL_ERROR: "Something went wrong on our side. Try again later.",
  PROTOCOL_NOT_SUPPORTED: "This protocol is registered but not supported in v1.",
  UNKNOWN: "An unexpected error occurred.",
};

export function messageForCode(code?: string): string {
  if (!code) return ERROR_MESSAGES.UNKNOWN;
  return (
    ERROR_MESSAGES[code as ErrorCode] ?? ERROR_MESSAGES.UNKNOWN
  );
}
