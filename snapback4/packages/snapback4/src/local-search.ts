// @ref LLP 3000.028#3.3 — SDK-owned merge, one remote invocation, two consumed positions.
import type { SearchComposition } from "./backend.ts";
import type { Cursor, Read, Refusal } from "./contract.ts";
import type { QueryEnvironment } from "./local-query.ts";

type Counts = Record<"examined" | "index_entries" | "rule_probes" | "steps" | "heap_bytes" | "output_bytes" | "rows_written", number>;
const zero = (): Counts => ({ examined: 0, index_entries: 0, rule_probes: 0, steps: 0, heap_bytes: 0, output_bytes: 0, rows_written: 0 });
export class SearchBound extends Error {
  readonly refusal: Refusal;
  constructor(kind: string) {
    super(`ordinary search exhausted the device read allowance (${kind})`);
    this.refusal = { code: "E_BOUND", family: "bound", message: this.message, site: "ordinary search coordinator", guide: "search" };
  }
}
/** The budget source is device Ceilings::default(), exported by search_state.
 * The Rust scan resumes our charges, then we resume its receipt. No reset. */
export class SearchLedger {
  used = zero();
  constructor(readonly ceilings: Counts) {}
  charge(kind: keyof Counts, amount: number) {
    if (!Number.isSafeInteger(amount) || amount < 0 || this.used[kind] + amount > this.ceilings[kind]) throw new SearchBound(kind);
    this.used[kind] += amount;
  }
  resume(spent: Counts) {
    for (const kind of Object.keys(this.used) as (keyof Counts)[]) {
      if (!Number.isSafeInteger(spent[kind]) || spent[kind] < this.used[kind] || spent[kind] > this.ceilings[kind]) throw new SearchBound(kind);
    }
    this.used = { ...spent };
  }
  /** Byte-based upper reservations cover buffering, UTF-16 strings, JSON nodes,
   * decoded objects and serialization scratch before any decoder runs. */
  text(bytes: number) { this.charge("heap_bytes", 128 + bytes * 32); this.charge("steps", bytes + 1); }
  async decode(response: Response): Promise<Record<string, unknown>> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("search response has no body");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        this.text(value.byteLength); // before retention, concatenation or decoding
        length += value.byteLength; chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
  }
}
const prefix = "sb4s:";
const maxCursor = 4096;
export const combinedCursor = (value: unknown): value is string => typeof value === "string" && value.startsWith(prefix);
function encoded(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decoded(value: string): unknown {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0))));
}
type Row = Record<string, unknown> & { id: string };
type Page = { data?: Row[]; denied?: Refusal; loading?: boolean; complete?: boolean; cut?: "words" | "meter" | null; next?: string | null; nextExpiry?: number | null; metered?: Counts };
type State = { metered: Counts; left?: string[]; epoch: string; retained: boolean; ceilings: Counts };
type Position = { binding: string; epoch: string; server: string | null; local: string | null };

// Upper UTF-8 JSON size without allocating a serialized value. The walk itself
// is charged before visiting each node/key; fixed scratch is prepaid by text().
function jsonBound(value: unknown, ledger: SearchLedger): number {
  ledger.charge("steps", 1);
  if (typeof value === "string") return 2 + value.length * 6;
  if (typeof value === "number") return 32;
  if (!value || typeof value !== "object") return 5;
  let bytes = 2;
  for (const key in value) {
    ledger.charge("steps", 1);
    bytes += 4 + key.length * 6 + jsonBound((value as Record<string, unknown>)[key], ledger);
    if (bytes > ledger.ceilings.heap_bytes) throw new SearchBound("heap_bytes");
  }
  return bytes;
}

function sourceCursor(plan: SearchComposition, row: Row, generation: number, ledger: SearchLedger) {
  ledger.text(512 + 6 * (plan.table.length + plan.index.length + plan.column.length + row.id.length));
  const value: unknown[] = [plan.variant ? 2 : 1, plan.table, plan.index, plan.order,
    [{ name: plan.column, kind: plan.kind }, { name: "id", kind: "Id" }],
    [{ Int: row[plan.column] }, { Id: row.id }]];
  if (plan.variant) value.push({ generation, prefix: [], variant: plan.variant });
  const token = encoded(value);
  if (token.length > maxCursor) throw new SearchBound("cursor");
  return token;
}
export interface SearchResult {
  read: Read<unknown>;
  nextExpiry: number | null;
  serverExpiry?: number | null;
  credential?: number;
  seq?: number | undefined;
  served?: boolean;
  searchAttempt: true;
  retryExpired?: boolean;
}

export async function ordinarySearch(env: QueryEnvironment, name: string, input: unknown, plan: SearchComposition,
  checkpoint: () => void, blocked: () => Promise<boolean>): Promise<SearchResult> {
  const loading: SearchResult = { read: { loading: true }, nextExpiry: null, searchAttempt: true };
  const stateReply = await env.call({ op: "search_state", name }); checkpoint();
  const state = stateReply.ok as State | undefined;
  if (stateReply.denied) return { ...loading, read: { denied: stateReply.denied as Refusal } };
  if (!state) return loading; // older devices cannot partially activate composition
  const ledger = new SearchLedger(state.ceilings);
  try {
    if (!state.metered) return { ...loading, read: { denied: { code: "E_INPUT", family: "input", message: "upgrade the device to support the ordinary search ledger" } } };
    ledger.resume(state.metered);
    ledger.text(jsonBound(input, ledger));
    const args = { ...input as Record<string, unknown> };
    const cursor = args[plan.cursor];
    args[plan.cursor] = null;
    ledger.text(2048 + (typeof cursor === "string" ? cursor.length : 0));
    const bound = [name, args, env.principal, env.backend.generation, env.linkRevision, plan];
    ledger.text(jsonBound(bound, ledger));
    const binding = JSON.stringify(bound);
    let position: Position = { binding, epoch: state.epoch, server: null, local: null };
    if (combinedCursor(cursor)) {
      if (cursor.length > maxCursor) throw new SearchBound("cursor");
      let old: Position;
      try { old = decoded(cursor.slice(prefix.length)) as Position; }
      catch { return { ...loading, read: { denied: { code: "E_INPUT", family: "input", message: "invalid ordinary search cursor" } } }; }
      if (!old || typeof old !== "object" || ![old.server, old.local].every(c => c === null || typeof c === "string")) {
        return { ...loading, read: { denied: { code: "E_INPUT", family: "input", message: "invalid ordinary search cursor" } } };
      }
      if (old.binding === binding && old.epoch === state.epoch) position = old;
      // State loss, membership/generation/argument changes restart both sources.
    } else if (typeof cursor === "string") {
      position.server = cursor; position.local = cursor;
    }
    let local: Page = { data: [], complete: true, next: null, cut: null };
    if (state.retained) {
      const reply = await env.call({ op: "query", name, args: { ...args, [plan.cursor]: position.local },
        viewer: env.principal, now: env.deviceNow(), search: true, spent: ledger.used }); checkpoint();
      local = (reply.ok ?? { denied: reply.denied }) as Page;
      if (local.denied) return { ...loading, read: { denied: local.denied } };
      if (local.loading || !local.data || !local.metered) return loading;
      ledger.resume(local.metered);
    }
    if (await blocked()) return loading;
    checkpoint();
    const credential = env.credentialRevision;
    const response = await env.searchPost(`/q/${name}`, { args: { ...args, [plan.cursor]: position.server } }, r => ledger.decode(r)); checkpoint();
    if (!response.ok || response.obsoleteAuth || await blocked()) return loading;
    checkpoint();
    const remote = response.json as Page;
    // Refusals, including opening failures, remain the original operation's.
    if (remote.denied) return { ...loading, read: { denied: remote.denied }, credential };
    if (remote.loading || !Array.isArray(remote.data)) return loading;
    const afterReply = await env.call({ op: "search_state", name, spent: ledger.used }); checkpoint();
    if (afterReply.denied) return { ...loading, read: { denied: afterReply.denied as Refusal } };
    const after = afterReply.ok as State | undefined;
    if (!after?.metered) return loading;
    ledger.resume(after.metered);
    if (after?.epoch !== state.epoch || env.link !== "online" || credential !== env.credentialRevision) return loading;
    // The server's complete, authorized membership opening proves disjointness
    // without chasing unrelated commits. Rejoin cannot preserve stale matches.
    if (state.retained) {
      const scopes = response.json.searchScopes;
      if (!Array.isArray(scopes) || !state.left) return loading;
      ledger.charge("heap_bytes", 128 + scopes.length * 64);
      ledger.charge("steps", scopes.length + state.left.length);
      const current = new Set(scopes);
      if (state.left.some(key => current.has(key))) return loading;
    }
    if ((local.nextExpiry != null && local.nextExpiry <= env.deviceNow())
      || (remote.nextExpiry != null && remote.nextExpiry <= env.serverNow())) return { ...loading, retryExpired: true };
    // A missing head after an undisclosed cut is not proven exhaustion.
    const localSafe = !local.cut || !!local.next;
    const remoteSafe = remote.complete !== false || !!remote.next;
    if (!localSafe || !remoteSafe) return { ...loading, read: { data: [], complete: false, fresh: false,
      cut: remote.cut ?? local.cut ?? null, next: null } };
    const left = local.data!, right = remote.data;
    ledger.charge("heap_bytes", 128 + plan.limit * 128);
    const data: Row[] = [];
    const seen = new Set<string>();
    let i = 0, j = 0;
    const before = (a: Row, b: Row) => {
      ledger.charge("steps", 2);
      let cmp = Number(a[plan.column]) - Number(b[plan.column]);
      if (!cmp) {
        // Rust strings order Unicode scalar values (UTF-8), not UTF-16 units.
        ledger.charge("steps", a.id.length + b.id.length + 1);
        for (let x = 0, y = 0; x < a.id.length && y < b.id.length;) {
          const left = a.id.codePointAt(x)!, right = b.id.codePointAt(y)!;
          if (left !== right) { cmp = left - right; break; }
          x += left > 0xffff ? 2 : 1; y += right > 0xffff ? 2 : 1;
        }
        cmp ||= a.id.length - b.id.length;
      }
      return plan.order === "Desc" ? cmp > 0 : cmp < 0;
    };
    while (data.length < plan.limit) {
      // Never refill a constituent page. Its next is not its consumed position.
      if (i === left.length && local.next || j === right.length && (remote.next || remote.complete === false)) break;
      if (i === left.length && j === right.length) break;
      const fromLocal = j === right.length || i < left.length && before(left[i]!, right[j]!);
      const row = fromLocal ? left[i]! : right[j]!;
      ledger.charge("steps", 2); // selection + deduplication
      if (!seen.has(row.id)) {
        ledger.text(64 + row.id.length);
        // Decoded rows are already reserved; output serializing/copying is also paid.
        const bytes = jsonBound(row, ledger);
        ledger.charge("heap_bytes", bytes * 2);
        ledger.charge("output_bytes", bytes + 1);
        data.push(row); seen.add(row.id);
      }
      const next = sourceCursor(plan, row, env.backend.generation, ledger);
      if (fromLocal) { position.local = next; i++; } else { position.server = next; j++; }
    }
    const more = i < left.length || j < right.length || !!local.next || !!remote.next;
    let next: string | null = null;
    if (more && data.length) {
      ledger.text(2048 + binding.length + (position.local?.length ?? 0) + (position.server?.length ?? 0));
      next = prefix + encoded(position);
      if (next.length > maxCursor) throw new SearchBound("cursor");
      ledger.charge("output_bytes", next.length);
    }
    const seq = [response.json.seq, response.json.head].find(x => typeof x === "number") as number | undefined;
    return { read: { data, complete: local.complete !== false && remote.complete !== false,
      cut: remote.cut ?? local.cut ?? null, fresh: !state.retained, next: next as Cursor | null,
      ...(state.retained && env.lastSyncAt ? { since: Math.min(env.lastSyncAt, Date.now()) } : {}) },
      nextExpiry: local.nextExpiry ?? null, serverExpiry: remote.nextExpiry ?? null,
      credential, seq, served: true, searchAttempt: true };
  } catch (error) {
    if (error instanceof SearchBound) return { ...loading, read: { denied: error.refusal } };
    throw error;
  }
}
