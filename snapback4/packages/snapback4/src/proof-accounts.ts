import { identityRequest } from "./identity-request.ts";
import { randomUUID, randomBytes } from "node:crypto";
import type { ServeHost } from "./proof.ts";

export interface StagingAccount {
  role: string; email: string; password: string; principal: string; token: string; expiresAt: number;
}
export type StagingSessions = Record<string, StagingAccount[]>;
export interface SeedAccountsOptions {
  roles: Record<string, number>;
  provision: { readonly name: string };
  /** Service seat authorized by the provisioning mutation. Default operator. */
  service?: string;
  args?: (account: StagingAccount) => Record<string, unknown>;
  /** Whole setup deadline, including rate-limit waits. Default 5 minutes. */
  timeoutMs?: number;
}

// @ref LLP 3000.000.000.001#2-real-staging-accounts — real credentials and ordinary operator mutations, never system seeding or auth bypass.
/** @throws E_STAGING_INPUT for invalid plans; E_STAGING for production/dev hosts; E_STAGING_TIMEOUT, E_STAGING_SIGNUP or E_STAGING_PROVISION for incomplete setup. Partial accounts/grants may exist; inspect or discard the staging store before retrying. */
export async function seedAccounts(host: Pick<ServeHost, "url" | "operatorToken">, options: SeedAccountsOptions): Promise<StagingSessions> {
  // @ref LLP 3000.000.000.001#8-wave-18-developer-loop-amendment-dx4 — custom argument keys override defaults; the seat grants no extra authority.
  const service = options.service ?? "operator";
  const roles = Object.entries(options.roles), timeout = options.timeoutMs ?? 300_000;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(service) || !Number.isSafeInteger(timeout) || timeout < 1 || !roles.length || roles.some(([role, n]) => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(role) || !Number.isSafeInteger(n) || n < 1)
      || roles.reduce((sum, [, n]) => sum + n, 0) > 100 || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/.test(options.provision?.name ?? "")) {
    throw Error("E_STAGING_INPUT: provide 1..100 accounts across named roles, a mutation handle and a positive timeoutMs");
  }
  const end = performance.now() + timeout;
  const remaining = () => {
    const ms = Math.ceil(end - performance.now());
    if (ms <= 0) throw Error("E_STAGING_TIMEOUT: setup incomplete; partial accounts/grants may exist; inspect or discard this staging deployment");
    return ms;
  };
  const request = (path: string, init?: RequestInit) => fetch(host.url + path, { ...init, signal: AbortSignal.timeout(Math.min(remaining(), 30_000)) });
  const config = await request("/auth/config");
  const identity = await config.json();
  if (!config.ok || identity.environment !== "staging" || identity.development !== false || !identity.password) {
    throw Error("E_STAGING: account seeding requires serve on a fresh deploy --staging with password identity; production and dev refuse before creating users");
  }
  const operator = await host.operatorToken(service);
  const sessions: StagingSessions = Object.create(null);
  for (const [role, count] of roles) {
    sessions[role] = [];
    for (let i = 0; i < count; i++) {
      const email = `staging-${role}-${randomUUID()}@example.test`, password = randomBytes(24).toString("base64url");
      const {json: reply} = await identityRequest(host.url + "/auth/signup", {
        method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({email,password}),
      }, fetch, {timeoutMs:remaining()}).catch(error => { remaining(); throw error; });
      if ((reply.denied as {code?:string} | undefined)?.code === "E_RATE_LIMIT") {
        throw Error("E_STAGING_TIMEOUT: identity retry budget exhausted; increase timeoutMs or inspect partial accounts/grants before retrying");
      }
      const session = reply.session as {principal?:string;token?:string;expiresAt?:number} | undefined;
      if (typeof session?.principal !== "string" || typeof session.token !== "string" || typeof session.expiresAt !== "number") {
        throw Error(`E_STAGING_SIGNUP: signup refused (${(reply.denied as {code?:string} | undefined)?.code ?? "invalid reply"}); partial accounts/grants may exist`);
      }
      const account: StagingAccount = { role, email, password, principal: session.principal, token: session.token, expiresAt: session.expiresAt };
      const args = { principal: account.principal, role, ...options.args?.(account) };
      const response = await request(`/m/${options.provision.name}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${operator}` }, body: JSON.stringify({ id: randomUUID(), args }) });
      const result = await response.json();
      if (!response.ok || result.state !== "sent") throw Error(`E_STAGING_PROVISION: ${options.provision.name} refused (${result.why?.code ?? result.denied?.code ?? "invalid reply"}); partial accounts/grants may exist`);
      sessions[role]!.push(account);
    }
  }
  return sessions;
}
