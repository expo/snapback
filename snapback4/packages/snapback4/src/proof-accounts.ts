import { rosterLock } from "./proof-roster-lock.ts";
import { identityRequest } from "./identity-request.ts";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync, lstatSync, fsyncSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ServeHost } from "./proof.ts";

export interface StagingAccount {
  kind: "user"; role: string; email: string; password: string; principal: string; token: string; expiresAt: number;
}
export type StagingSessions = Record<string, StagingAccount[]>;
export type ProvisionedAccount = StagingAccount;
export type ProvisionedSessions = StagingSessions;
export interface ProvisionAccountsOptions extends SeedAccountsOptions {
  /** Named persistent roster within this deployment. Default default. */
  roster?: string;
  /** Required for a host not returned by startServe. Keep with the deployment. */
  rosterDir?: string;
}
export interface SeedAccountsOptions {
  roles?: Record<string, number>;
  provision?: { readonly name: string };
  /** Additional password users with no provision call; returned under sessions.users. */
  users?: number;
  /** Service seat authorized by the provisioning mutation. Default operator. */
  service?: string;
  args?: (account: StagingAccount) => Record<string, unknown>;
  /** Whole setup deadline, including rate-limit waits. Default 5 minutes. */
  timeoutMs?: number;
}

function validatePlan(options: SeedAccountsOptions) {
  // @ref LLP 3000.000.000.001#8-wave-18-developer-loop-amendment-dx4 — custom argument keys override defaults; the seat grants no extra authority.
  const service = options.service ?? "operator";
  const roles = Object.entries(options.roles ?? {}), users=options.users ?? 0, timeout = options.timeoutMs ?? 300_000;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(service) || !Number.isSafeInteger(timeout) || timeout < 1 || !Number.isSafeInteger(users) || users<0 || (!roles.length&&!users) || (users>0&&roles.some(([role])=>role==="users")) || roles.some(([role, n]) => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(role) || !Number.isSafeInteger(n) || n < 1)
      || roles.reduce((sum, [, n]) => sum + n, users) > 100 || (roles.length>0 || options.provision!==undefined) && (typeof options.provision?.name!=="string" || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/.test(options.provision.name))) {
    throw Error("E_STAGING_INPUT: provide 1..100 accounts across named roles, a mutation handle and a positive timeoutMs");
  }
  return {service, roles:[...roles,...(users ? [["users",users] as [string,number]] : [])], timeout};
}

// @ref LLP 3000.000.000.001#2-real-staging-accounts — real credentials and ordinary operator mutations, never system seeding or auth bypass.
/** @throws E_STAGING_INPUT for invalid plans; E_STAGING for production/dev hosts; E_STAGING_TIMEOUT, E_STAGING_SIGNUP or E_STAGING_PROVISION for incomplete setup. Partial accounts/grants may exist; inspect or discard the staging store before retrying. */
async function accounts(host: Pick<ServeHost, "url" | "operatorToken">, options: SeedAccountsOptions, environment: "staging" | "production" | "development", roster?: Roster, save: () => void = () => {}, assertHeld: () => void = () => {}): Promise<StagingSessions> {
  const {service, roles, timeout} = validatePlan(options);
  const end = performance.now() + timeout;
  const partial = environment === "development" ? "inspect partial development accounts/grants or discard this development store" : environment === "staging" ? "inspect or discard this staging deployment" : "inspect partial production accounts/grants before retrying";
  const remaining = () => {
    assertHeld();
    const ms = Math.ceil(end - performance.now());
    if (ms <= 0) throw Error(`E_STAGING_TIMEOUT: setup incomplete; partial accounts/grants may exist; ${partial}`);
    return ms;
  };
  const guardedFetch: typeof fetch = (url, init) => { assertHeld(); return fetch(url, init); };
  const request = (path: string, init?: RequestInit) => guardedFetch(host.url + path, { ...init, signal: AbortSignal.timeout(Math.min(remaining(), 30_000)) });
  const config = await request("/auth/config");
  const identity = await config.json();
  if (!config.ok || identity.environment !== environment || identity.development !== (environment === "development") || !identity.password) {
    throw Error(environment === "development" ? "E_DEV_ACCOUNTS: devAccounts requires startDev with password identity; serve hosts refuse before creating users" : environment === "staging"
      ? "E_STAGING: account seeding requires serve on a fresh deploy --staging with password identity; production and dev refuse before creating users"
      : "E_PRODUCTION_ACCOUNTS: account provisioning requires serve on a production deploy with password identity; staging and dev refuse before creating users");
  }
  const operator = Object.keys(options.roles??{}).length ? await host.operatorToken(service) : "";
  if (environment === "production" && operator) {
    const response = await request("/schema", { headers: { authorization: `Bearer ${operator}` } }), schema = await response.json();
    const named = response.ok && Array.isArray(schema.service_identities) && schema.service_identities.includes(`service:${service}`);
    if (!named) process.stderr.write(`snapback4: WARNING minted service:${service}, but the served schema reports no explicit positive authorization mention for that service identity; rules still decide every operation and provisionAccounts(${options.provision?.name}) will likely refuse.\n`);
  }
  const sessions: StagingSessions = Object.create(null);
  for (const [role, count] of roles) {
    sessions[role] = [];
    for (let i = 0; i < count; i++) {
      let fresh = false;
      let entry = roster?.entries.find(entry => entry.role === role && entry.index === i);
      if (!entry) {
        fresh = true;
        entry = { role, index: i, email: `${environment}-${role}-${randomUUID()}@example.test`, password: randomBytes(24).toString("base64url"), id: randomUUID(), done: false };
        roster?.entries.push(entry); save(); // Persist identity before the first possibly ambiguous write.
      }
      const { email, password } = entry;
      let reply: Record<string, unknown>;
      if (roster && !fresh) {
        const result = await identityRequest(host.url + "/auth/login", {
          method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({email,password}),
        }, guardedFetch, {timeoutMs:remaining()}).catch(error => {
          if ((error as {code?:string})?.code === "E_IDENTITY_TIMEOUT") throw Error(`E_STAGING_TIMEOUT: login deadline expired; ${partial}`);
          remaining(); throw error;
        });
        reply = result.json;
        if (!reply.session && (entry.principal || (reply.denied as {code?:string})?.code !== "E_AUTH")) throw Error("E_PRODUCTION_ROSTER: saved account login failed; inspect roster and deployment; no replacement account created");
      } else reply = {};
      if (!reply.session) {
      const result = await identityRequest(host.url + "/auth/signup", {
        method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({email,password}),
      }, guardedFetch, {timeoutMs:remaining()}).catch(error => {
        if ((error as {code?: string})?.code === "E_IDENTITY_TIMEOUT") throw Error(`E_STAGING_TIMEOUT: signup deadline expired; partial accounts/grants may exist; ${partial}`);
        remaining(); throw error;
      });
      reply = result.json;
      }
      if ((reply.denied as {code?:string} | undefined)?.code === "E_RATE_LIMIT") {
        throw Error("E_STAGING_TIMEOUT: identity retry budget exhausted; increase timeoutMs or inspect partial accounts/grants before retrying");
      }
      const session = reply.session as {principal?:string;kind?:string;token?:string;expiresAt?:number} | undefined;
      if (typeof session?.principal !== "string" || typeof session.token !== "string" || typeof session.expiresAt !== "number" || session.kind !== "user") {
        throw Error(`E_STAGING_SIGNUP: signup refused (${(reply.denied as {code?:string} | undefined)?.code ?? "invalid reply"}); partial accounts/grants may exist; ${partial}`);
      }
      const account: StagingAccount = { kind: session.kind, role, email, password, principal: session.principal, token: session.token, expiresAt: session.expiresAt };
      if (entry.principal && entry.principal !== account.principal) throw Error("E_PRODUCTION_ROSTER: principal differs from saved roster; inspect deployment");
      entry.principal = account.principal; save();
      if (role==="users" && (options.users??0)>0) {entry.done=true;save();sessions[role]!.push(account);continue;}
      const args = { principal: account.principal, role, ...options.args?.(account) };
      const encodedArgs = canonical(args);
      if (entry.args && entry.args !== encodedArgs) throw Error("E_PRODUCTION_ROSTER: provisioning arguments changed; inspect roster instead of silently reassigning roles");
      entry.args = encodedArgs; save();
      if (!entry.done) {
      const response = await request(`/m/${options.provision?.name}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${operator}` }, body: JSON.stringify({ id: entry.id, args }) });
      const result = await response.json();
      if (!response.ok || result.state !== "sent") {
        let parameters:string[]=[];
        try {
          const response=await request("/schema",{headers:{authorization:`Bearer ${operator}`}}), schema=await response.json();
          const program=schema.programs?.find((p:{name:string})=>p.name===options.provision?.name);
          parameters=Object.keys(program?.args??{}).sort();
        } catch { /* failure diagnostics must not mask the original refusal */ }
        const merged=Object.fromEntries(Object.entries(args).map(([key,value])=>[key,`<redacted ${value===null?"null":Array.isArray(value)?"array":typeof value}>`]));
        const refusal = result.why ?? result.denied;
        // Preserve the backend's explanation without echoing opaque arguments.
        const strings = [account.email, account.password, account.token], scalars = new Set<string>();
        const opaque = (value: unknown): void => {
          if (typeof value === "string") { if (value) strings.push(value); }
          else if (value === null || typeof value === "number" || typeof value === "boolean") scalars.add(String(value));
          else if (Array.isArray(value)) value.forEach(opaque);
          else if (value && typeof value === "object") Object.values(value).forEach(opaque);
        };
        opaque(args);
        let explanation: string = typeof refusal?.message === "string" ? refusal.message.slice(0, 4096) : "";
        for (const value of strings.sort((a, b) => b.length - a.length)) {
          if (value.length > 3) { explanation = explanation.replaceAll(value, "<redacted>"); continue; }
          // A one-letter selection must not turn "argument" into gibberish.
          // Redact quoted/standalone echoes while retaining named schema sites.
          const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          explanation = explanation.replace(new RegExp(`(?<![\\p{L}\\p{N}_.])${escaped}(?![\\p{L}\\p{N}_])`, "gu"), (token, offset: number, text: string) =>
            /(?:argument|field|column|table|operation|mutation|code)\s+["']?$/.test(text.slice(0, offset)) ? token : "<redacted>");
        }
        // Backend value descriptions use scalar tokens ("the number 482719").
        // Quoted scalar echoes are values too. Preserve explicitly named
        // schema sites and whole identifiers/codes, not arbitrary quoted values.
        explanation = explanation.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[\p{L}_][\p{L}\p{N}_]*|-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/gu,
          (token, offset: number, text: string) => {
            const quoted = token[0] === '"' || token[0] === "'", value = quoted ? token.slice(1, -1) : token;
            const schemaSite = /^[\p{L}_][\p{L}\p{N}_]*$/u.test(value)
              && /(?:argument|field|column|table|operation|mutation|code)\s+$/.test(text.slice(0, offset));
            if (!scalars.has(value) || schemaSite) return token;
            return quoted ? `${token[0]}<redacted>${token[0]}` : "<redacted>";
          });
        throw Error(`E_STAGING_PROVISION: ${options.provision?.name} refused (${refusal?.code ?? "invalid reply"})${explanation ? `: ${explanation}` : ""}; supplied arguments: ${Object.keys(args).sort().join(", ")}; merged args (opaque values redacted): ${JSON.stringify(merged)}; mutation parameters: ${parameters.length?parameters.join(", "):"unavailable"}; args(account) merges over {principal, role}, explicit keys win; ${partial}`);
      }
      entry.done = true; save();
      }
      sessions[role]!.push(account);
    }
  }
  return sessions;
}

// @ref LLP 3000.000.000.001#2-real-staging-accounts — real credentials and ordinary operator mutations, never system seeding or auth bypass.
/** @throws E_STAGING_INPUT for invalid plans; E_STAGING for production/dev hosts; E_STAGING_TIMEOUT, E_STAGING_SIGNUP or E_STAGING_PROVISION for incomplete setup. */
export function seedAccounts(host: Pick<ServeHost, "url" | "operatorToken">, options: SeedAccountsOptions): Promise<StagingSessions> {
  return accounts(host, options, "staging");
}

function canonical(value: unknown): string {
  // Compare the JSON wire values, including nested objects, independent of key order.
  const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,x]) => [k,sorted(x)])) : v;
  return JSON.stringify(sorted(JSON.parse(JSON.stringify(value))));
}
interface RosterEntry { role: string; index: number; email: string; password: string; id: string; principal?: string; args?: string; done: boolean }
interface Roster { version: 1; plan: string; entries: RosterEntry[] }
/** Reuse a named deployment roster with fresh password sessions; provision only unfinished entries.
 * @throws E_STAGING_INPUT for invalid plans; E_PRODUCTION_ACCOUNTS for staging/dev;
 * E_PRODUCTION_ROSTER for changed/unsafe roster or failed saved login; E_PRODUCTION_ROSTER_BUSY for concurrent setup;
 * E_STAGING_TIMEOUT, E_STAGING_SIGNUP or E_STAGING_PROVISION for incomplete setup.
 */
// @ref LLP 3000.011.003.000.000#16-wave-27-process-checks-dx10 — persist credentials and stable IDs before production effects.
export async function provisionAccounts(host: Pick<ServeHost, "url" | "operatorToken"> & { deploymentDir?: string }, options: ProvisionAccountsOptions): Promise<ProvisionedSessions> {
  validatePlan(options);
  const name = options.roster ?? "default", directory = options.rosterDir ?? host.deploymentDir;
  if (!directory || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw Error("E_PRODUCTION_ROSTER: use startServe or supply rosterDir, and a simple roster name");
  const base = resolve(directory);
  if (!lstatSync(base).isDirectory()) throw Error("E_PRODUCTION_ROSTER: rosterDir must be an existing deployment directory");
  const folder = join(base, "proof-accounts"); mkdirSync(folder, {mode:0o700, recursive:true});
  // Persist the newly created roster directory's link as well as each snapshot.
  const parent = openSync(base, "r"); try { fsyncSync(parent); } finally { closeSync(parent); }
  const path = join(folder, name + ".json"), lock = path + ".lock";
  const owned = rosterLock(lock);
  try {
    const plan = JSON.stringify({...(options.users?{users:options.users}:{}),roles:Object.entries(options.roles??{}).sort(), provision:options.provision?.name, service:options.service ?? "operator"});
    let roster: Roster;
    try {
      if (!lstatSync(path).isFile() || (lstatSync(path).mode & 0o077)) throw Error("unsafe roster file");
      roster = JSON.parse(readFileSync(path, "utf8"));
      if (roster.version !== 1 || typeof roster.plan !== "string" || !Array.isArray(roster.entries)) throw Error("invalid roster");
      if (roster.plan !== plan) {
        // Render only validated plan fields, never arbitrary saved strings or entries.
        const pinned = JSON.parse(roster.plan);
        if (pinned.provision !== undefined && typeof pinned.provision !== "string") throw Error("invalid roster plan");
        const normalized = validatePlan({...pinned, roles: Object.fromEntries(pinned.roles), provision: pinned.provision !== undefined ? {name:pinned.provision} : undefined});
        const safe = JSON.stringify({...(pinned.users?{users:pinned.users}:{}),roles:Object.entries(Object.fromEntries(pinned.roles)).sort(),provision:pinned.provision,service:normalized.service});
        throw Object.assign(Error(`E_PRODUCTION_ROSTER: supplied plan ${plan}; pinned plan ${safe}; reuse the pinned plan or intentionally choose a new roster name; no new accounts created`), {planMismatch:true});
      }
      const slots = new Set<string>();
      for (const entry of roster.entries) {
        if (!entry) throw Error("invalid roster entry");
        const slot = `${entry.role}:${entry.index}`;
        if (!entry || typeof entry.role !== "string" || !Number.isSafeInteger(entry.index) || entry.index < 0
            || entry.index >= (entry.role==="users"&&options.users ? options.users : options.roles?.[entry.role] ?? 0) || slots.has(slot)
            || typeof entry.email !== "string" || !entry.email.endsWith("@example.test") || typeof entry.password !== "string" || entry.password.length < 20
            || typeof entry.id !== "string" || !/^[a-f0-9-]{36}$/.test(entry.id) || typeof entry.done !== "boolean"
            || (entry.principal !== undefined && typeof entry.principal !== "string") || (entry.args !== undefined && typeof entry.args !== "string")
            || (entry.done && (!entry.principal || !(entry.role==="users"&&(options.users??0)>0)&&!entry.args))) throw Error("invalid roster entry");
        slots.add(slot);
      }
    } catch (error) {
      if ((error as {planMismatch?:boolean}).planMismatch) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw Error("E_PRODUCTION_ROSTER: unreadable, unsafe or changed roster; inspect it; no new accounts created");
      roster = {version:1, plan, entries:[]};
    }
    const save = () => {
      owned.assertHeld();
      const temporary = path + "." + randomUUID() + ".tmp";
      const snapshot = openSync(temporary, "wx", 0o600);
      try { writeFileSync(snapshot, JSON.stringify(roster)); fsyncSync(snapshot); } finally { closeSync(snapshot); }
      renameSync(temporary, path);
      const parent = openSync(folder, "r"); try { fsyncSync(parent); } finally { closeSync(parent); }
    };
    return await accounts(host, options, "production", roster, save, () => owned.assertHeld());
  } finally { owned.release(); }
}

// @ref LLP 3000.011.003.000.000#17-wave-29-serve-proofs-and-proof-residue-dx12 — development shares the production plan and real-user authority path.
/** Fresh password accounts with ordinary operator provisioning, for startDev acceptance proofs.
 * Same role/count/provision/args plan and account shape as production.
 * @throws invalid plan, non-development host, signup/provision refusal or bounded timeout. */
export function devAccounts(host: Pick<ServeHost, "url" | "operatorToken">, options: SeedAccountsOptions): Promise<StagingSessions> {
  return accounts(host, options, "development");
}
