import type { Session } from "./contract.ts";

// @ref LLP 3000.036.004#154-supplied-client-sessions — validate before effects and retain a private primitive snapshot.
export function suppliedSession(value: unknown, constructor: string): Session | undefined {
  if (value === undefined) return undefined;
  const invalid = (field: string): never => {
    throw new TypeError(`${constructor}: E_SESSION: session.${field} is invalid. Pass the complete Session returned by guest(), login(), signup() or your service's session minting; createClient({ token }) accepts a bare bearer token.`);
  };
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid("object");
  const input = value as Record<string, unknown>;
  const principal = input.principal, kind = input.kind, token = input.token;
  const expiresAt = input.expiresAt, scope = input.scope, capExpiresAt = input.capExpiresAt;
  if (typeof principal !== "string" || principal.trim().length === 0) invalid("principal");
  if (typeof kind !== "string" || kind.trim().length === 0) invalid("kind");
  if (typeof token !== "string" || token.trim().length === 0) invalid("token");
  if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt <= 0) invalid("expiresAt (positive integer milliseconds)");
  if (scope !== undefined && scope !== "full" && scope !== "read") invalid("scope (full or read)");
  if (capExpiresAt !== undefined && (typeof capExpiresAt !== "number" || !Number.isSafeInteger(capExpiresAt) || capExpiresAt <= 0)) invalid("capExpiresAt (positive integer milliseconds)");
  return Object.freeze({ principal, kind, token, expiresAt, ...(Object.prototype.hasOwnProperty.call(input, "scope") ? { scope } : {}), ...(Object.prototype.hasOwnProperty.call(input, "capExpiresAt") ? { capExpiresAt } : {}) }) as Session;
}
