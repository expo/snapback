import { valueDeadline, type ValueDeadlines } from "./read-decoration.ts";
import { readyRead } from "./read-existence.ts";
// @ref LLP 3000.028#3.3 — SDK-owned merge, one remote invocation, combined keyset continuation.
import type { SearchComposition } from "./backend.ts";
import type { Cursor, Read, Refusal } from "./contract.ts";
import type { QueryEnvironment } from "./local-query.ts";
import { sha256 } from "./sha256.ts";
import type { StoreCapture } from "./local-types.ts";
import type { LocalWatch } from "./local-reads.ts";

// @ref LLP 3000.028#3.3 — identity is captured before HTTP and validated
// before any source position can be accepted, independently of delivery images.
export async function searchReplyIdentity(capture: StoreCapture | undefined, json: Record<string, unknown>, generation: number,
  witness: (store: unknown, head: unknown, capture: StoreCapture) => Promise<boolean>): Promise<string | undefined> {
  if (!capture || json.store_id !== (capture.transfer_store_id ?? capture.store_id)
    || await witness(json.store_id, json.head ?? json.seq, capture)) { delete json.delivery; return; }
  if (!capture.backend_required && capture.generation === json.generation
    && json.generation === generation && typeof json.store_id === "string") return `${json.store_id}:${json.generation}`;
}

export function refreshSearchRoots(watches: ReadonlyMap<string, LocalWatch>, name: string, cursor: string | undefined,
  notify: (watch: LocalWatch) => void, rerun: (watch: LocalWatch) => void): void {
  if (!cursor) return;
  // A stale suffix cannot be repaired in place. Withdraw and reobserve the
  // requested root; Pages replaces its suffix when that cursor changes.
  for (const root of [...watches.values()]) if (root.op.name === name && (root.args as Record<string, unknown>)?.[cursor] == null) {
    root.reset({ loading: true }); notify(root);
    if (watches.get(root.key) === root) void rerun(root);
  }
}

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
  resume(spent: Counts, readCut = false) {
    for (const kind of Object.keys(this.used) as (keyof Counts)[]) {
      // A capped Rust scan records the rejected charge too. Retain it without
      // granting another read; decoding/merge spend only other dimensions.
      const stopped = readCut && (kind === "examined" || kind === "index_entries" || kind === "rule_probes");
      if (!Number.isSafeInteger(spent[kind]) || spent[kind] < this.used[kind]
        || spent[kind] > Math.max(this.ceilings[kind], this.used[kind]) && !stopped) throw new SearchBound(kind);
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
function encoded(value: unknown): string { return encodedText(JSON.stringify(value)); }
function encodedText(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decoded(value: string): unknown {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0))));
}
type Row = Record<string, unknown> & { id: string };
type Page = { decorationExpiry?: number | null | undefined; searchRows?: Row[]; data?: Row[]; denied?: Refusal; loading?: boolean; complete?: boolean; cut?: "words" | "meter" | null; next?: string | null; nextExpiry?: number | null; metered?: Counts };
type State = { decorations?: Row[]; decorationExpiry?: number | null | undefined; metered: Counts; left?: string[]; epoch: string; delivery: string; ceilings: Counts };
type Position = { binding: string; epoch: string; audience: string | null; identity: string | null; after: string | null; server: string | null; local: string | null; localCut?: "words" | "meter" };

// The server sorts/deduplicates the complete authorized opening by Value order.
// Hash that canonical proof on every page, including current-only pages. These
// reservations cover JSON/UTF-8 scratch and SHA-256 padding, not another decoder.
function audienceDigest(scopes: string[], ledger: SearchLedger): string {
  ledger.charge("steps", scopes.length + 1);
  let bytes = 2;
  for (const key of scopes) bytes += 3 + key.length * 6;
  ledger.charge("heap_bytes", 1024 + bytes * 6);
  ledger.charge("steps", bytes + 1);
  const encoded = new TextEncoder().encode(JSON.stringify(scopes));
  ledger.charge("steps", 128 * Math.ceil((encoded.length + 9) / 64));
  return Array.from(sha256(encoded), byte => byte.toString(16).padStart(2, "0")).join("");
}

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

// Exact signed i64 order keys: unsafe JSON numbers are never accepted as hints.
function orderKey(value: unknown): value is number | string {
  if (typeof value === "number") return Number.isSafeInteger(value);
  if (typeof value !== "string" || !/^-?(0|[1-9][0-9]{0,18})$/.test(value) || value === "-0") return false;
  const key = BigInt(value);
  return key >= -9223372036854775808n && key <= 9223372036854775807n;
}
function sourceCursor(plan: SearchComposition, row: Row, generation: number, ledger: SearchLedger) {
  if (!orderKey(row[plan.column])) throw new SearchBound("invalid source ordering key");
  ledger.text(512 + 6 * (plan.table.length + plan.index.length + plan.column.length + row.id.length));
  const value: unknown[] = [plan.variant ? 2 : 1, plan.table, plan.index, plan.order,
    [{ name: plan.column, kind: plan.kind }, { name: "id", kind: "Id" }],
    [{ Int: row[plan.column] }, { Id: row.id }]];
  if (plan.variant) value.push({ generation, prefix: [], variant: plan.variant });
  // Cursor v1/v2 has a tagged i64 JSON number. Write this one validated
  // numeric token directly; JSON.stringify(Number(key)) would round it.
  const token = encodedText(JSON.stringify(value).replace(/"Int":"(-?[0-9]+)"/, '"Int":$1'));
  if (token.length > maxCursor) throw new SearchBound("cursor");
  return token;
}
export interface SearchResult extends ValueDeadlines {
  read: Read<unknown>;
  transportOffline?: boolean;
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
  const decorated = !!env.backend.schema?.operations?.[name]?.search_decoration;
  const loading: SearchResult = { read: { loading: true }, nextExpiry: null, valueDevice: null, valueServer: null, searchAttempt: true };
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
    let position: Position = { binding, epoch: state.epoch, audience: null, identity: null, after: null, server: null, local: null };
    if (combinedCursor(cursor)) {
      if (cursor.length > maxCursor) throw new SearchBound("cursor");
      let old: Position;
      try { old = decoded(cursor.slice(prefix.length)) as Position; }
      catch { return { ...loading, read: { denied: { code: "E_INPUT", family: "input", message: "invalid ordinary search cursor" } } }; }
      if (!old || typeof old !== "object" || ![old.server, old.local].every(c => c === null || typeof c === "string")
        || old.localCut !== undefined && old.localCut !== "words" && old.localCut !== "meter") {
        return { ...loading, read: { denied: { code: "E_INPUT", family: "input", message: "invalid ordinary search cursor" } } };
      }
      if (old.binding === binding && old.epoch === state.epoch && typeof old.audience === "string" && typeof old.identity === "string"
        && (old.after === null || typeof old.after === "string")) position = old;
      // State loss, membership/generation/argument changes restart both sources.
    }
    // A plain server/offline cursor has no store or audience binding. Online
    // composition must start fresh; offline evaluation can still seek that key.
    let local: Page = { data: [], complete: !position.localCut, next: null, cut: position.localCut ?? null };
    if (state.left?.length && !position.localCut) {
      const reply = await env.call({ op: "query", name, args: { ...args, [plan.cursor]: position.after },
        viewer: env.principal, now: env.deviceNow(), search: true, spent: ledger.used }); checkpoint();
      local = (reply.ok ?? { denied: reply.denied }) as Page;
      if (local.denied) return { ...loading, read: { denied: local.denied } };
      if (local.loading || !local.data || !local.metered) return loading;
      ledger.resume(local.metered, local.cut === "meter");
    }
    if (await blocked()) return loading;
    checkpoint();
    const credential = env.credentialRevision;
    // The supplied candidates are bounded by this page. The response certifies
    // only point readability; current rows win even outside the needle/keyset.
    ledger.charge("heap_bytes", 128 + (local.data?.length ?? 0) * 64);
    ledger.charge("steps", local.data?.length ?? 0);
    const retained = local.cut && !local.next ? [] : (local.searchRows ?? local.data ?? []).map(row => row.id);
    if (retained.length > plan.limit + 1) throw new SearchBound("overlap candidates");
    ledger.text(jsonBound(retained, ledger));
    const decorationSelection = decorated ? { searchRetainedOrder: (local.cut && !local.next ? [] : local.data ?? []).map(row => row[plan.column]), searchRetainedMore: !!local.next } : {};
    if (decorated) ledger.text(jsonBound(decorationSelection, ledger));
    const response = await env.searchPost(`/q/${name}`, { args: { ...args, [plan.cursor]: position.after }, searchRetained: retained, ...decorationSelection }, r => ledger.decode(r)); checkpoint();
    if (!response.ok) return { ...loading, transportOffline: true };
    if (response.obsoleteAuth || await blocked()) return loading;
    checkpoint();
    const remote = response.json as Page;
    // A permanent refusal publishes no rows or cursor. It must not become an
    // identity refresh loop, including an old server's early decoder refusal.
    if (remote.denied) return { ...loading, read: { denied: remote.denied }, credential };
    if (remote.loading) return loading;
    if (!response.searchIdentity || position.identity !== null && position.identity !== response.searchIdentity) {
      env.refreshSearch?.(name);
      return loading;
    }
    position.identity = response.searchIdentity;
    if (!Array.isArray(remote.data)) return loading;
    if (decorated) {
      ledger.charge("steps", remote.data.length);
      if (!Array.isArray(remote.searchRows) || remote.searchRows.length !== remote.data.length
        || !remote.searchRows.every(row => row && typeof row.id === "string" && orderKey(row[plan.column]))) {
        return { ...loading, read: { denied: { code: "E_INPUT", family: "input", message: "upgrade the server to support lifted search source keys" } } };
      }
    }
    const scopes = response.json.searchScopes;
    if (!Array.isArray(scopes)) return loading;
    ledger.charge("steps", scopes.length);
    if (!scopes.every(key => typeof key === "string")) return loading;
    const audience = audienceDigest(scopes, ledger);
    if (position.audience !== null && position.audience !== audience) {
      // Withdraw this stale suffix. A live page chain reobserves its root on a
      // separate observation; this request must not fetch again to fill it.
      env.refreshSearch?.(name);
      return loading;
    }
    position.audience = audience;
    // The server's complete, authorized membership opening proves disjointness
    // without chasing unrelated commits. Rejoin cannot preserve stale matches.
    if (state.left?.length) {
      if (!state.left) return loading;
      ledger.charge("heap_bytes", 128 + scopes.length * 64);
      ledger.charge("steps", scopes.length + state.left.length);
      const current = new Set(scopes);
      if (state.left.some(key => current.has(key))) return loading;
    }
    if ((local.nextExpiry != null && local.nextExpiry <= env.deviceNow())
      || (remote.nextExpiry != null && remote.nextExpiry <= env.serverNow())) return { ...loading, retryExpired: true };
    // A missing head after an undisclosed cut is not proven exhaustion.
    const remoteSafe = remote.complete !== false || !!remote.next;
    if (!remoteSafe) return { ...loading, read: readyRead({ data: [], complete: false, fresh: false,
      cut: remote.cut ?? local.cut ?? null, next: null }) };
    // @ref LLP 3000.028#3.3 — an unproved device head cannot erase proved server hits.
    // Discovery may have missed a newer retained word, so even returned local
    // candidates are not a global head. Publish only the proven current stream
    // and preserve the cut for this entire continuation. Resuming the device
    // later could insert a newer hit behind rows already emitted.
    if (local.cut && !local.next) {
      position.localCut = local.cut;
      local = { data: [], complete: false, cut: local.cut, next: null };
      if (!remote.data.length) throw new SearchBound(`retained ${local.cut}; narrow the search or search one chat`);
    }
    const current = response.json.searchCurrent;
    const invalidOverlap = (): SearchResult => ({ ...loading, read: { denied: { code: "E_INPUT", family: "input", message: "upgrade the server to support ordinary search overlap" } } });
    if (!Array.isArray(current) || current.length > retained.length) return invalidOverlap();
    // Validate a page-sized subset in linear work, like the scope proof above.
    // Prepay both sets and membership probes; decoding already charged ID bytes.
    ledger.charge("heap_bytes", 128 + retained.length * 64);
    ledger.charge("steps", retained.length + current.length * 2);
    const candidates = new Set(retained);
    if (!current.every(id => typeof id === "string" && candidates.has(id))) {
      return invalidOverlap();
    }
    ledger.charge("heap_bytes", 128 + current.length * 64);
    const suppressed = new Set(current);
    const left = local.searchRows ?? local.data!, right = remote.searchRows ?? remote.data;
    ledger.charge("heap_bytes", 128 + plan.limit * 128);
    const data: Row[] = [];
    let retainedEmitted = false;
    const retainedPositions: number[] = [];
    const seen = new Set<string>(); // Defense in depth if a source/proof repeats an ID.
    let i = 0, j = 0;
    let consumed = false;
    const before = (a: Row, b: Row) => {
      ledger.charge("steps", 2);
      const ak = a[plan.column], bk = b[plan.column];
      if (!orderKey(ak) || !orderKey(bk)) throw new SearchBound("invalid source ordering key");
      ledger.charge("steps", (typeof ak === "string" ? ak.length * 2 : 0) + (typeof bk === "string" ? bk.length * 2 : 0));
      ledger.charge("heap_bytes", 128); // bounded i64 validation and comparison
      const av = BigInt(ak), bv = BigInt(bk);
      let cmp = av < bv ? -1 : av > bv ? 1 : 0;
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
      ledger.charge("steps", 2 + row.id.length * 2); // selection + both ID hash lookups
      if (!(fromLocal && suppressed.has(row.id)) && !seen.has(row.id)) {
        ledger.text(64 + row.id.length);
        // Decoded rows are already reserved; output serializing/copying is also paid.
        const value = fromLocal ? local.data![i]! : remote.data[j]!;
        const bytes = jsonBound(value, ledger);
        ledger.charge("heap_bytes", bytes * 2);
        ledger.charge("output_bytes", bytes + 1);
        data.push(value); seen.add(row.id);
        if (fromLocal) { retainedEmitted = true; retainedPositions.push(data.length - 1); }
      }
      const next = sourceCursor(plan, row, env.backend.generation, ledger);
      // Both lanes seek the combined consumed key on the next request. A new
      // match before that key is outside this live traversal even if its lane
      // emitted nothing yet. All fetched/unconsumed keys after it remain eligible.
      position.after = next; consumed = true;
      if (fromLocal) { position.local = next; i++; } else { position.server = next; j++; }
    }
    const decorationRows = decorated ? retainedPositions.map(position => data[position]!) : undefined;
    if (decorationRows) ledger.text(jsonBound(decorationRows, ledger));
    const afterReply = await env.call({ op: "search_state", name, spent: ledger.used,
      ...(decorationRows ? { decorationRows, viewer: env.principal, now: env.deviceNow() } : {}) }); checkpoint();
    if (afterReply.denied) return { ...loading, read: { denied: afterReply.denied as Refusal } };
    const after = afterReply.ok as State | undefined;
    if (!after?.metered) return loading;
    ledger.resume(after.metered);
    if (!state.delivery || after.delivery !== state.delivery || after.epoch !== state.epoch || env.link !== "online" || credential !== env.credentialRevision) return loading;
    if (decorated) {
      if (!after.decorations || after.decorations.length !== retainedPositions.length) return loading;
      for (let k = 0; k < retainedPositions.length; k++) data[retainedPositions[k]!] = after.decorations[k]!;

    }
    const more = i < left.length || j < right.length || !!local.next || !!remote.next;
    let next: string | null = null;
    if (more && consumed) {
      ledger.text(2048 + binding.length + (position.local?.length ?? 0) + (position.server?.length ?? 0) + (position.after?.length ?? 0));
      next = prefix + encoded(position);
      if (next.length > maxCursor) throw new SearchBound("cursor");
      ledger.charge("output_bytes", next.length);
    }
    const seq = [response.json.seq, response.json.head].find(x => typeof x === "number") as number | undefined;
    return { read: readyRead({ data, complete: local.complete !== false && remote.complete !== false,
      cut: remote.cut ?? local.cut ?? null, fresh: !retainedEmitted, next: next as Cursor | null,
      ...(retainedEmitted && env.lastSyncAt ? { since: Math.min(env.lastSyncAt, Date.now()) } : {}) }),
      nextExpiry: local.nextExpiry ?? null, serverExpiry: remote.nextExpiry ?? null,
      valueDevice: valueDeadline(after.decorationExpiry, decorated && retainedPositions.length > 0), valueServer: valueDeadline(remote.decorationExpiry, decorated),
      credential, seq, served: true, searchAttempt: true };
  } catch (error) {
    if (error instanceof SearchBound) return { ...loading, read: { denied: error.refusal } };
    throw error;
  }
}
