/**
 * Query keys shared by the query hooks and the WS -> invalidation bridge.
 *
 * Keeping them in ONE module guarantees that the key invalidated by a live
 * event is exactly the key a component subscribed with (requirement: EVE's
 * Active Communications list must refresh itself, never by manual reload).
 */
export const ACTIVE_SESSIONS_KEY = ["communications", "active"] as const;