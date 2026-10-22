import type { Session } from "./contract.ts";

// @ref LLP 3000.036.004#154-supplied-client-sessions — validate before effects and retain a private primitive snapshot.
export function suppliedSession(value: unknown, constructor: string): Session | undefined {
  if (value === undefined) return undefined;
  const invalid = (field: string): never => {
    throw new TypeError(`${constructor}: E_SESSION: session.${field} is missing or invalid. Pass the complete Session returned by guest(), login(), signup() or your service's session minting; One-line token-only fix: createClient({ url, token }).`);
  };
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid("object");
  const input = value as Record<string, unknown>;
  const principal = input.principal, kind = input.kind, token = input.token;
  const expiresAt = input.expiresAt, scope = input.scope, capExpiresAt = input.capExpiresAt;
  const fields: string[] = [];
  if (typeof principal !== "string" || principal.trim().length === 0) fields.push("principal");
  if (typeof kind !== "string" || kind.trim().length === 0) fields.push("kind");
  if (typeof token !== "string" || token.trim().length === 0) fields.push("token");
  if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt <= 0) fields.push("expiresAt (positive integer milliseconds)");
  if (scope !== undefined && scope !== "full" && scope !== "read") fields.push("scope (full or read)");
  if (capExpiresAt !== undefined && (typeof capExpiresAt !== "number" || !Number.isSafeInteger(capExpiresAt) || capExpiresAt <= 0)) fields.push("capExpiresAt (positive integer milliseconds)");
  if (fields.length) invalid(fields.join(", session."));
  return Object.freeze({ principal, kind, token, expiresAt, ...(Object.prototype.hasOwnProperty.call(input, "scope") ? { scope } : {}), ...(Object.prototype.hasOwnProperty.call(input, "capExpiresAt") ? { capExpiresAt } : {}) }) as Session;
}

/** Legacy online credentials carry only a bearer; identity and expiry stay server facts. */
export function suppliedOnlineSession(value: unknown): { session?: Session; token?: string } {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const input = value as Record<string, unknown>;
    const token = input.token;
    if (!["principal", "kind", "token", "expiresAt"].every(key => Object.prototype.hasOwnProperty.call(input, key))
        && typeof token === "string" && token.trim().length > 0) {
      return { token };
    }
  }
  const session = suppliedSession(value, "createClient");
  return session ? { session } : {};
}
