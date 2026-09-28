import { refreshSession, sessionKey, type Session, type SessionStore, type SignIn } from "./auth.ts";
import type { Refusal } from "./contract.ts";
import { sessionTransaction } from "./session-transaction.ts";
import { knownNonDispatch, refusal } from "./http-response.ts";

export const unknownRotation = (result: SignIn): boolean => !result.ok &&
  (result.why.code === "E_HTTP_RESPONSE" || result.why.code === "E_OFFLINE" && !knownNonDispatch.has(result.why));
const pendingClaims = new WeakSet<SignIn>();
export const rotationFenced = (result: SignIn): boolean => unknownRotation(result) && !pendingClaims.has(result);
function claimed(saved: { snapback4Rotation: { why?: unknown; pending?: boolean } }): SignIn {
  const result: SignIn = { ok: false, why: refusal(saved.snapback4Rotation.why) ?? uncertain() };
  if (saved.snapback4Rotation.pending) pendingClaims.add(result);
  return result;
}
const warnings = new WeakMap<object, (why?: Refusal) => void>();
export function onRotationWarning(options: object, warn: (why?: Refusal) => void): void { warnings.set(options, warn); }
const uncertain = (): Refusal => ({ code: "E_HTTP_RESPONSE", family: "link", retryable: true,
  message: "a session refresh may have consumed this bearer; its outcome is unknown and renewal is paused",
  rewrite: "sign in again to obtain a new session; do not resend this refresh" });

// @ref LLP 3000#http-overload-diagnostics — the session's durable claim precedes dispatch; peers and restarts cannot replay it.
export function sessionRotation(url: string, store: SessionStore, fetcher: typeof fetch, options: object) {
  const key = sessionKey(url);
  const warn = (result: SignIn): SignIn => {
    if (unknownRotation(result) && !result.ok) warnings.get(options)?.({ ...result.why, site: "app.auth.refresh", rewrite: uncertain().rewrite! });
    else warnings.get(options)?.();
    return result;
  };
  const rotate = async (token: string, session: Session | null): Promise<SignIn> => {
    let outcome: SignIn | undefined;
    try {
      const prior = await sessionTransaction(store, key, async storage => {
        const bytes = await storage.get(key);
        const saved = bytes ? JSON.parse(bytes) : session ?? { token };
        if (saved.token !== token) return { ok: false, why: { code: "E_AUTH", family: "auth", message: "the stored session changed; reopen the client" } } as SignIn;
        if (saved.snapback4Rotation) return claimed(saved);
        await storage.set(key, JSON.stringify({ ...saved, snapback4Rotation: { why: uncertain(), pending: true } }));
        return undefined;
      });
      if (prior) return warn(prior);
      const result = outcome = warn(await refreshSession(url, token, fetcher));
      // Success keeps the claim until the ordinary, authorized session save
      // adopts its successor. A crash between response and save stays fenced.
      if (!result.ok) await sessionTransaction(store, key, async storage => {
        const bytes = await storage.get(key), saved = bytes ? JSON.parse(bytes) : null;
        if (saved?.token !== token || !saved.snapback4Rotation) return;
        if (unknownRotation(result)) saved.snapback4Rotation = { why: result.why };
        else delete saved.snapback4Rotation;
        await storage.set(key, JSON.stringify(saved));
      });
      return result;
    } catch (error) {
      // The pre-dispatch claim already fences an unknown result. Failure to
      // enrich its diagnostic cannot hide that outcome or its app warning.
      if (outcome && unknownRotation(outcome)) return outcome;
      const why: Refusal = { code: "E_STORE", family: "store", retryable: true,
        message: `session rotation storage failed: ${String(error)}`, rewrite: "repair sessionStore, then reopen the app" };
      warnings.get(options)?.(why);
      return { ok: false, why };
    }
  };
  return Object.assign(rotate, { async restore(session: Session): Promise<SignIn | undefined> {
    const result = await sessionTransaction(store, key, async storage => {
      const bytes = await storage.get(key), saved = bytes ? JSON.parse(bytes) : null;
      return saved?.token === session.token && saved.snapback4Rotation ? claimed(saved) : undefined;
    });
    return result && warn(result);
  } });
}
