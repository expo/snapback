import type { Query, Mutation, Refusal, Session } from "./contract.ts";
import { oidcPrincipal } from "./identity-principal.ts";
import { ServerError } from "./server-json.ts";
import type { IdentityRuntime } from "./server-private.ts";
import { lifetimeFetch } from "./server-context.ts";
import { Retry } from "./worker.ts";

interface RuntimeLifetime {
  readonly signal: AbortSignal;
  readonly now: () => number;
  assertActive(): void;
}

interface RuntimeOptions {
  readonly url: string;
  readonly token: string;
  readonly fetch?: typeof fetch;
}

function refusal(value: unknown): Refusal | undefined {
  if (!value || typeof value !== "object") return undefined;
  const found = value as Partial<Refusal>;
  return typeof found.code === "string" && typeof found.family === "string" && typeof found.message === "string"
    ? found as Refusal : undefined;
}

// @ref LLP 3000.009#7 — provider protocols stay in the server runtime; this
// narrow bridge exposes neither a service client nor arbitrary session minting.
export function identityRuntime(options: RuntimeOptions, lifetime: RuntimeLifetime): IdentityRuntime {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const fetchWithinLifetime = lifetimeFetch(doFetch, lifetime.signal);
  const base = options.url.replace(/\/$/, "");
  const post = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
    lifetime.assertActive();
    let response: Response;
    try {
      response = await fetchWithinLifetime(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${options.token}` },
        body: JSON.stringify(body),
        signal: lifetime.signal,
      });
    } catch (error) {
      lifetime.assertActive();
      throw new Retry("the private identity operation has an uncertain outcome", { cause: error });
    }
    let json: Record<string, unknown>;
    try { json = await response.json() as Record<string, unknown>; }
    catch (error) {
      lifetime.assertActive();
      throw new Retry("the private identity operation returned an unreadable response", { cause: error });
    }
    lifetime.assertActive();
    const denied = refusal(json.denied ?? json.why);
    if (denied) throw new ServerError(denied.code, "the private identity operation was refused", denied.family);
    if (!response.ok) throw new Retry("the private identity operation did not complete");
    return json;
  };
  return Object.freeze({
    now: lifetime.now,
    providerFetch: fetchWithinLifetime,
    async query<A, R>(op: Query<A, R>, args: A): Promise<R> {
      if (!op || op.kind !== "query" || typeof op.name !== "string") throw new ServerError("E_OIDC_RECIPE", "the identity query is not configured");
      const result = await post(`/q/${encodeURIComponent(op.name)}`, { args });
      if (!Object.hasOwn(result, "data")) throw new ServerError("E_OIDC_RECIPE", "the identity query returned no data");
      return result.data as R;
    },
    async mutate<A, R>(op: Mutation<A, R>, args: A, id: string): Promise<void> {
      if (!op || op.kind !== "mutation" || typeof op.name !== "string") throw new ServerError("E_OIDC_RECIPE", "the identity mutation is not configured");
      const result = await post(`/m/${encodeURIComponent(op.name)}`, { id, args });
      if (result.state !== "sent") throw new Retry("the private identity mutation has not settled");
    },
    async mint(issuer: string, subject: string, kind: string, days: number): Promise<Session> {
      const principal = oidcPrincipal(issuer, subject);
      const result = await post("/auth/session", { principal, kind, days });
      const session = result.session as Partial<Session> | undefined;
      if (!session || session.principal !== principal || session.kind !== kind
        || typeof session.token !== "string" || session.token.length === 0
        || typeof session.expiresAt !== "number" || !Number.isFinite(session.expiresAt)
        || session.expiresAt <= lifetime.now()) {
        throw new ServerError("E_OIDC_MINT", "the identity session mint returned an invalid session");
      }
      return Object.freeze({ principal, kind, token: session.token, expiresAt: session.expiresAt });
    },
  });
}
