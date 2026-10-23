import type { Session } from "./auth.ts";
import { isReadToken } from "./read-token.ts";

/** Authenticated development and staging return this exact bearer's current live lifetime.
 * Matching the dispatch bearer is the caller's responsibility. Same-bearer
 * preservation is monotonic, so a delayed old reply cannot undo a jump. */
export function reconciledTiming(session: Session, response: Response): Session {
  if (response.headers.get("x-snapback-session-timing") !== "staging") return session;
  const expiry = Number(response.headers.get("x-snapback-session-expires"));
  const capText = response.headers.get("x-snapback-session-cap");
  const cap = capText === null ? undefined : Number(capText);
  if (!Number.isSafeInteger(expiry) || expiry <= 0) return session;
  const read = isReadToken(session.token);
  if (read && (cap === undefined || !Number.isSafeInteger(cap) || cap < expiry)) return session;
  if (!read && cap !== undefined) return session;
  const expiresAt = Math.max(session.expiresAt, expiry);
  const capExpiresAt = cap === undefined ? undefined : Math.max(session.capExpiresAt ?? 0, cap);
  if (expiresAt === session.expiresAt && capExpiresAt === session.capExpiresAt) return session;
  return { ...session, expiresAt, ...(capExpiresAt === undefined ? {} : { capExpiresAt }) };
}

export function requestMatchesSession(request: { url: string; authorization: string | null }, base: string, session: Session): boolean {
  return (request.url === base || request.url.startsWith(base + "/")) && request.authorization === `Bearer ${session.token}`;
}

/** Expired local metadata may be superseded by a preserving development or staging jump.
 * Read-only probing creates no session and never widens or refreshes one. */
export async function restoreStagingTiming(base: string, session: Session, fetcher: typeof fetch): Promise<Session | null> {
  const aborter = new AbortController();
  const timer = setTimeout(() => aborter.abort(), 10_000);
  (timer as { unref?: () => void }).unref?.();
  try {
    const response = await fetcher(`${base}/probe?scope=1`, { headers: { authorization: `Bearer ${session.token}` }, signal: aborter.signal });
    if (!response.ok) return null;
    const next = reconciledTiming(session, response);
    const stamp = Number(response.headers.get("x-snapback-time"));
    if (next === session || !Number.isSafeInteger(stamp) || next.expiresAt <= stamp) return null;
    // Consume the bounded ordinary probe body before blessing restoration.
    const { readResponse } = await import("./http-response.ts");
    const body = await readResponse(response);
    return body.ok === true && body.viewer === session.principal && body.scope === (isReadToken(session.token) ? "read" : "full") ? next : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}
