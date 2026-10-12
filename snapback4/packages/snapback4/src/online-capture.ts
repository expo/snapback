// The device-less browser write journal (LLP 3000.013.000). A synchronous
// localStorage record holds a click until the online intent journal
// (app-online.ts) commits it in IndexedDB; recovery admits a surviving record
// into that journal at most once. No transport, result or settlement lives here.
import { admissionRefusal } from "./admission.ts";
import { sameAdmissionAuthority, type AdmissionAuthority, type AdmissionAuthorityContext } from "./admission-authority.ts";
import { mintId } from "./client.ts";
import type { Refusal } from "./contract.ts";

export interface CaptureRecord {
  v: 1; key: string; nonce: string; runtime: string; seq: number; id: string; op: string; args: unknown;
  viewer: string; url: string; storeId: string; authority: AdmissionAuthority & { source: string }; at: number;
}
/** Transfer markers live in the online journal value, beside its intents:
 * one `id:nonce` entry per admitted or known capture (LLP 3000.013.000 §4.2). */
export interface Marked { captured?: string[]; pending?: { id: string }[] }
export const markerOf = (record: Pick<CaptureRecord, "id" | "nonce">) => `${record.id}:${record.nonce}`;
/** Whether the journal holds a marker for any capture of id. */
export const markedId = (journal: Marked, id: string) => !!journal.captured?.some(mark => mark.startsWith(`${id}:`));

const PREFIX = "snapback4-online-admission:";
const RUNTIME = "snapback4-online-runtime:";
const RECORD_BYTES = 64 * 1024, JOURNAL_BYTES = 256 * 1024, JOURNAL_RECORDS = 32;
export const MARKER_LIMIT = 1024;
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const hex = (text: string) => Array.from({ length: text.length }, (_, i) => text.charCodeAt(i).toString(16).padStart(4, "0")).join("");
const backendPrefix = (url: string) => `${PREFIX}${hex(url)}:`;
const scopePrefix = (url: string, source: string, principal: string) => `${backendPrefix(url)}${hex(source)}:${hex(principal)}:`;
// @ref LLP 3000.013.000#4.1 — one key per capture: localStorage has no
// compare-and-swap, so no capture ever writes over, or removes, another's key.
const recordKey = (url: string, source: string, principal: string, id: string, nonce: string) => `${scopePrefix(url, source, principal)}${id}:${nonce}`;

function storage(): Storage {
  const store = globalThis.localStorage;
  if (!store) throw new Error("localStorage is unavailable");
  return store;
}
function keys(store: Storage): string[] {
  return Array.from({ length: store.length }, (_, i) => store.key(i)).filter((key): key is string => key !== null);
}

function parse(key: string, text: string | null, url: string): CaptureRecord | "cancelled" | undefined {
  if (!text || bytes(text) > RECORD_BYTES) return;
  try {
    const r = JSON.parse(text) as CaptureRecord & { cancelled?: boolean };
    if (r?.key !== key) return;
    if (r.cancelled === true) return "cancelled";
    const a = r.authority;
    if (r.v === 1 && r.url === url && typeof r.nonce === "string" && typeof r.runtime === "string" && Number.isSafeInteger(r.seq)
      && typeof r.id === "string" && typeof r.op === "string" && r.op.length > 0 && Object.hasOwn(r, "args")
      && typeof r.viewer === "string" && typeof r.storeId === "string" && r.storeId.length > 0 && typeof r.at === "number"
      && a && typeof a.key === "string" && typeof a.epoch === "string" && typeof a.principal === "string" && typeof a.source === "string"
      && (a.kind === undefined || a.kind === "persona") && a.principal === r.viewer && key === recordKey(url, a.source, a.principal, r.id, r.nonce)) return r;
  } catch { /* A malformed record never becomes an executable write. */ }
  return;
}

export class OnlineCapture {
  readonly runtime = mintId();
  /** Granted before custody exposes a client (LLP 3000.013.000 §4.5). */
  readonly ready: Promise<void>;
  private readonly live = new Set<string>();
  /** Markers (`id:nonce`) of captures whose removal this runtime saw itself. */
  private readonly removed = new Set<string>();
  private sequence = 0;
  private release: (() => void) | undefined;
  /** A commit failed with its record kept: recover before the next admission. */
  stale = false;
  constructor(readonly url: string, readonly viewer: string, readonly authority: AdmissionAuthorityContext) {
    // @ref LLP 3000.013.000#4.5 — a live runtime's records are never another runtime's to adopt.
    const held = new Promise<void>(resolve => { this.release = resolve; });
    this.ready = new Promise<void>((granted, failed) => {
      const locks = globalThis.navigator?.locks;
      if (!locks) { failed(new Error("Web Locks are unavailable")); return; }
      void locks.request(RUNTIME + this.runtime, () => { granted(); return held; }).catch(failed);
    });
  }

  /** Release this lifetime's liveness lock; its leftover records become adoptable. */
  close(): void { this.release?.(); this.release = undefined; }

  private scope() {
    const stamp = this.authority.capture();
    return { stamp, source: stamp.source ?? "", prefix: scopePrefix(this.url, stamp.source ?? "", stamp.principal) };
  }

  /** Whether this scope holds an executable record of id (G1 custody before its commit). */
  holding(id: string): boolean {
    try {
      const store = storage(), { prefix } = this.scope();
      return keys(store).some(key => key.startsWith(`${prefix}${id}:`) && typeof parse(key, store.getItem(key), this.url) === "object");
    } catch { return false; }
  }

  // @ref LLP 3000.013.000#4.1 — before mutate returns; a refusal admits nothing.
  capture(id: string, op: string, args: unknown, storeId: string): CaptureRecord | Refusal {
    const refuse = (message: string, rewrite: string) => admissionRefusal(message, "app.mutate", rewrite);
    try {
      const store = storage();
      const { stamp, source } = this.scope();
      const nonce = mintId(), key = recordKey(this.url, source, stamp.principal, id, nonce);
      // The bounds count executable records; a cancellation placeholder holds no click.
      let held = 0, total = 0;
      for (const name of keys(store)) {
        if (!name.startsWith(backendPrefix(this.url))) continue;
        const text = store.getItem(name) ?? "";
        const found = parse(name, text, this.url);
        if (typeof found !== "object") continue;
        held++; total += bytes(name) + bytes(text);
        this.sequence = Math.max(this.sequence, found.seq);
      }
      const record: CaptureRecord = { v: 1, key, nonce, runtime: this.runtime, seq: ++this.sequence, id, op, args,
        viewer: this.viewer, url: this.url, storeId, authority: { ...(stamp.kind ? { kind: stamp.kind } : {}), key: stamp.key, epoch: stamp.epoch, principal: stamp.principal, source }, at: Date.now() };
      const text = JSON.stringify(record);
      if (bytes(text) > RECORD_BYTES) return refuse("the write exceeds the browser write journal's 64 KiB record; it was not admitted", "reduce the arguments, then retry");
      if (held >= JOURNAL_RECORDS || total + bytes(key) + bytes(text) > JOURNAL_BYTES)
        return refuse("the browser write journal is full (32 records or 256 KiB); the write was not admitted", "wait for queued writes to reach the server, then retry with the same id");
      store.setItem(key, text);
      this.live.add(key);
      return JSON.parse(text) as CaptureRecord;
    } catch (error) {
      return refuse(`localStorage could not keep the write: ${String(error)}`, "restore writable localStorage (not full, not blocked), then retry with the same id");
    }
  }

  /** Remove this capture's own key; a removal seen here lets this runtime drop the marker. */
  remove(record: CaptureRecord): void {
    this.live.delete(record.key);
    try {
      const store = storage();
      store.removeItem(record.key);
      if (store.getItem(record.key) === null) this.removed.add(markerOf(record));
    } catch { /* The marker keeps it non-executable; a later recovery removes it. */ }
  }

  /** Hand the record to a later open's recovery, without a stale-recovery here. */
  keep(record: CaptureRecord): void { this.live.delete(record.key); }

  /** The commit failed; the record stays for this runtime's recovery. */
  failed(record: CaptureRecord): void { this.live.delete(record.key); this.stale = true; }

  /** Never admitted: remove this capture's key, or leave a non-executable cancellation. */
  cancel(record: CaptureRecord): void {
    this.live.delete(record.key);
    try {
      const store = storage();
      store.removeItem(record.key);
      if (store.getItem(record.key) !== null) store.setItem(record.key, JSON.stringify({ key: record.key, cancelled: true }));
    } catch { /* Indeterminate; see LLP 3000.013.000 §6. */ }
  }

  mark(journal: Marked, record: Pick<CaptureRecord, "id" | "nonce">): void {
    const mark = markerOf(record);
    this.removed.delete(mark);
    const marks = (journal.captured ?? []).filter(entry => entry !== mark);
    marks.push(mark);
    journal.captured = marks.slice(-MARKER_LIMIT);
  }

  // @ref LLP 3000.013.000#4.2 — a peer's getItem() === null proves nothing
  // across renderers: a marker is dropped only for a capture this runtime saw
  // removed itself, and never while its id is still pending.
  collect(journal: Marked): void {
    for (const mark of this.removed) if (!journal.captured?.includes(mark)) this.removed.delete(mark);
    if (!journal.captured || !this.removed.size) return;
    const pending = new Set(journal.pending?.map(intent => intent.id));
    const kept = journal.captured.filter(mark => !this.removed.has(mark) || pending.has(mark.slice(0, mark.indexOf(":"))));
    if (kept.length) journal.captured = kept; else delete journal.captured;
  }

  /** This scope's records recovery may consider, in capture order. */
  async candidates(): Promise<CaptureRecord[]> {
    const { stamp, source } = this.scope();
    const snapshot = await globalThis.navigator.locks.query();
    const busy = new Set([...(snapshot.held ?? []), ...(snapshot.pending ?? [])].map(lock => lock.name));
    const store = storage(), found: CaptureRecord[] = [];
    // @ref LLP 3000.013.000#4.4 — another authority source is not an ended session: only this source and session key.
    const sourcePrefix = `${backendPrefix(this.url)}${hex(source)}:`;
    for (const key of keys(store)) {
      if (!key.startsWith(sourcePrefix)) continue;
      const record = parse(key, store.getItem(key), this.url);
      // A cancellation placeholder is never executable; sweeping it frees its slot.
      if (record === "cancelled") { try { store.removeItem(key); } catch { /* Harmless. */ } continue; }
      if (typeof record !== "object" || record.authority.key !== stamp.key) continue;
      if (record.runtime === this.runtime ? this.live.has(key) : busy.has(RUNTIME + record.runtime)) continue;
      found.push(record);
    }
    return found.sort((a, b) => a.seq - b.seq || a.at - b.at);
  }

  /** Under the caller's locks: whether this record's session still holds. */
  holds(record: CaptureRecord): Promise<boolean> {
    return sameAdmissionAuthority(record.authority, this.authority, record.viewer);
  }
}
