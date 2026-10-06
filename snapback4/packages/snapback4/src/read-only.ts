import { logout, refreshSession } from "./auth.ts";
import type { Client, Refusal, Session } from "./contract.ts";
import { readResponse, transportRefusal } from "./http-response.ts";

export const readOnlyRefusal = (code = "E_READ_ONLY"): Refusal => ({ code, family: "auth", guide: "read-only",
  message: ({ E_READ_ONLY: "this read session permits reads only; use a full session for writes",
    E_READ_ONLY_DEVICE: "a read session cannot open a device; use the online read-only client",
    E_READ_ONLY_CREDENTIAL: "readOnly needs a server-verified read session, without a persona",
    E_READ_ONLY_UNSUPPORTED: "this server cannot verify read sessions; upgrade it before using readOnly" } as Record<string, string>)[code] ?? code });
export function refuseReadDevice(session?: Session | null, token?: string): void {
  // @ref LLP 3000.033#1.4 — token-based admission works offline and ignores forged scope fields.
  if ((session?.token ?? token)?.startsWith("ro.")) throw Object.assign(new Error("E_READ_ONLY_DEVICE: a read session cannot open a device"), { why: readOnlyRefusal("E_READ_ONLY_DEVICE") });
}
// Apply the same admission check to every device rotation, including a late
// successor. Refuse before adoption or persistence even if scope was forged.
export function refreshDeviceSession(...args: Parameters<typeof refreshSession>): ReturnType<typeof refreshSession> {
  return refreshSession(...args).then(result => { if (result.ok) refuseReadDevice(result.session); return result; });
}
export function validateReadOptions(options: { readOnly?: boolean; persona?: string; device?: unknown }): void {
  const code = options.readOnly && options.device ? "E_READ_ONLY_DEVICE" : options.readOnly && options.persona ? "E_READ_ONLY_CREDENTIAL" : undefined;
  if (code) throw Object.assign(new Error(`${code}: ${readOnlyRefusal(code).message}`), { why: readOnlyRefusal(code) });
}

const readiness = new WeakMap<Client, () => Promise<Refusal | undefined>>();
export const registerReadVerification = (client: Client, verify: () => Promise<Refusal | undefined>) => { readiness.set(client, verify); };
export const verifyReadClient = (client: Client) => readiness.get(client)?.() ?? Promise.resolve(undefined);

// @ref LLP 3000.033#1.4 — nothing passes this gate, including refresh and
// exported asset credentials, before the exact bearer/revision/store is verified.
export class ReadScopeGate {
  private accepted: string | undefined;
  private pending: { key: string; work: Promise<Refusal | undefined> } | undefined;
  private failed: { key: string; why: Refusal } | undefined;
  constructor(private url: string, private transport: typeof fetch,
    private current: () => { token: string | undefined; revision: number; store: string | undefined; closed: boolean },
    private accept: (json: Record<string, unknown>) => void, private signal: AbortSignal) {}
  private key() { const c = this.current(); return JSON.stringify([c.token, c.revision, c.store]); }
  get verified() { return !this.current().closed && this.accepted === this.key(); }
  get refusal() { return this.failed?.key === this.key() ? this.failed.why : undefined; }
  verify(): Promise<Refusal | undefined> {
    if (this.verified) return Promise.resolve(undefined);
    const key = this.key();
    if (this.failed?.key === key) return Promise.resolve(this.failed.why);
    if (this.pending?.key === key) return this.pending.work;
    const c = this.current();
    this.accepted = undefined;
    const work = (async () => {
      let why: Refusal | undefined;
      try {
        if (c.closed || !c.token) return readOnlyRefusal("E_READ_ONLY_CREDENTIAL");
        const response = await this.transport(`${this.url}/probe?scope=1`, { headers: { authorization: `Bearer ${c.token}` }, signal: this.signal });
        const json = await readResponse(response);
        if (key !== this.key() || this.current().closed) return { code: "E_AUTH", family: "auth", message: "the read credential changed during verification" };
        if (json.denied) why = json.denied as Refusal;
        else if (!response.ok || json.ok !== true || !["full", "read"].includes(String(json.scope)) || typeof json.store_id !== "string") why = readOnlyRefusal("E_READ_ONLY_UNSUPPORTED");
        else if (json.scope !== "read") why = readOnlyRefusal("E_READ_ONLY_CREDENTIAL");
        else { this.accept(json); this.accepted = this.key(); }
      } catch (error) { why = transportRefusal(error); }
      if (why && key === this.key() && !why.retryable) this.failed = { key, why };
      return why;
    })();
    this.pending = { key, work };
    void work.finally(() => { if (this.pending?.work === work) this.pending = undefined; });
    return work;
  }
}

// @ref LLP 3000.033#1.4 — a cancelled rotation can still produce a live successor. Cleanup is limited
// to that returned credential, after a fresh probe of its scope, owner and store.
export async function retireReadSession(url: string, token: string, principal: string | null, store: string | undefined, transport: typeof fetch): Promise<void> {
  if (!principal || !store) return;
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 5000);
  try {
    const response = await transport(`${url}/probe?scope=1`, { headers: { authorization: `Bearer ${token}` }, signal: abort.signal });
    const json = await readResponse(response);
    if (response.ok && json.ok === true && json.scope === "read" && json.viewer === principal && json.store_id === store) await logout(url, token, transport);
  } catch { /* The capped family expires if its server cannot be reached. */ }
  finally { clearTimeout(timer); }
}
