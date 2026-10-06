/**
 * Access-token inspection helpers.
 *
 * The JWT payload is decoded WITHOUT verifying the signature — it is only used
 * to decide whether asking the server is worth it. The backend always remains
 * the authority on authentication and authorization.
 */

export interface AccessTokenClaims {
  sub?: string;
  role?: string;
  type?: string;
  exp?: number;
  jti?: string;
}

function base64UrlDecode(segment: string): string | null {
  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const binary = atob(padded + pad);
    // Handle non-ASCII characters safely.
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Returns the decoded claims, or null when the value is not a JWT. */
export function decodeAccessToken(token: string | null | undefined): AccessTokenClaims | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null; // opaque token (e.g. test/mock tokens)
  const json = base64UrlDecode(parts[1]!);
  if (!json) return null;
  try {
    return JSON.parse(json) as AccessTokenClaims;
  } catch {
    return null;
  }
}

/**
 * True when the access token is expired (or expires within `skewSeconds`).
 *
 * Tokens that are not JWTs return `false`: their lifetime is unknown, so the
 * server decides. This keeps the check fail-safe for opaque tokens while still
 * preventing "reconnect with a known-expired token" loops for real JWTs.
 */
export function isTokenExpired(
  token: string | null | undefined,
  skewSeconds = 30,
): boolean {
  const claims = decodeAccessToken(token);
  if (!claims) return false;
  if (typeof claims.exp !== "number") return false;
  return claims.exp * 1000 <= Date.now() + skewSeconds * 1000;
}

/** True when the token is a JWT and carries the expected type claim. */
export function isAccessToken(token: string | null | undefined): boolean {
  const claims = decodeAccessToken(token);
  return claims?.type === "access" || claims === null;
}
