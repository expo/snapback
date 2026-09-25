import { admissionRefusal, browserAdmission } from "./admission.ts";
import { sameAdmissionAuthority, type AdmissionAuthority, type AdmissionAuthorityContext } from "./admission-authority.ts";
import { storeLock } from "./app-storage.ts";
// Synchronous custody until the web device's ordinary admission commits.
// No transport, result, or server settlement lives here.
import type { Change } from "./web.ts";
import type { Refusal } from "./contract.ts";
import type { WebDevice } from "./wasm/snapback4_device.js";

interface Entry {
  id: string;
  seq: number;
  op: string;
  args: unknown;
  new_ids: string[];
  viewer: string;
  now: number;
  predictable: boolean;
  predicted: string[];
  replay_candidate?: boolean;
}

export interface AdmissionRecord { key: string; storeId: string; entry: Entry; authority?: AdmissionAuthority }
interface Transfer { key: string; storeId: string; recovered: boolean }
const PREFIX = "snapback4-admission:";
const RECORD_BYTES = 64 * 1024;
const JOURNAL_BYTES = 256 * 1024;
const JOURNAL_RECORDS = 32;
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const prefix = (name: string) => `${PREFIX}${encodeURIComponent(name)}:`;
const invoke = (device: WebDevice, request: Record<string, unknown>) => JSON.parse(device.call(JSON.stringify(request)));

function storage(): Storage | undefined {
  try { return typeof window === "undefined" ? undefined : globalThis.localStorage; } catch { return; }
}

function keys(store: Storage): string[] {
  return Array.from({ length: store.length }, (_, i) => store.key(i)).filter((key): key is string => key !== null);
}

function absent(key: string): boolean {
  try { const store = storage(); return !!store && store.getItem(key) === null; } catch { return false; }
}

function remove(key: string): void {
  try { storage()?.removeItem(key); } catch { /* Keep the transfer marker until removal succeeds. */ }
}

export function journalStores(namePrefix: string): string[] {
  try {
    const store = storage();
    if (!store) return [];
    const names = new Set<string>();
    for (const key of keys(store).filter(key => key.startsWith(PREFIX))) {
      try {
        const name = decodeURIComponent(key.slice(PREFIX.length).split(":")[0]!);
        if (name.startsWith(namePrefix)) names.add(name);
      } catch { /* One malformed key must not hide another tab's journal. */ }
    }
    return [...names];
  } catch { return []; }
}

function records(name: string, cleanup = false): AdmissionRecord[] {
  try {
    const store = storage();
    if (!store) return [];
    const found: AdmissionRecord[] = [];
    for (const key of keys(store).filter(key => key.startsWith(prefix(name)))) {
      const text = store.getItem(key);
      if (!text || bytes(text) > RECORD_BYTES) continue;
      try {
        const record = JSON.parse(text) as AdmissionRecord & { cancelled?: boolean };
        if (record.key === key && record.cancelled === true) { if (cleanup) remove(key); continue; }
        const e = record.entry;
        if (record.key === key && typeof record.storeId === "string" && e && typeof e.id === "string" && Number.isSafeInteger(e.seq)
          && typeof e.op === "string" && Array.isArray(e.new_ids) && e.new_ids.every(id => typeof id === "string")
          && typeof e.viewer === "string" && typeof e.now === "number") found.push(record);
      } catch { /* A malformed record cannot become an executable write. */ }
    }
    return found.sort((a, b) => a.entry.seq - b.entry.seq);
  } catch { return []; }
}

export class AdmissionJournal {
  authority: AdmissionAuthorityContext | undefined;
  private transfers = new Map<string, Transfer>();
  private storeId: string | undefined;
  private sequence = 0;
  constructor(private readonly name: string, private readonly exclusive: boolean) {}

  load(saved: Change[]): void {
    this.transfers.clear();
    this.storeId = undefined;
    this.remember(saved);
    for (const record of records(this.name, this.exclusive)) this.sequence = Math.max(this.sequence, record.entry.seq);
  }

  remember(changes: Change[]): void {
    for (const c of changes) {
      if (c.s === "m" && c.k === "device:store_id") this.storeId = c.v ?? undefined;
      if (c.s === "j") {
        if (c.v === null) this.transfers.delete(c.k);
        else this.transfers.set(c.k, JSON.parse(c.v));
      }
    }
  }

  // @ref LLP 3000.007#20.4 — capture before mutate's first await; only ordinary IDB admission may expose the write to transport.
  capture(request: Record<string, unknown>): AdmissionRecord | undefined {
    const refuse = (message: string): never => { throw new AdmissionError(message); };
    if (!this.exclusive) refuse("no exclusive provider claim; open a webDevice before writing");
    try {
      const store = storage();
      if (!store) return refuse("localStorage is unavailable; mutation was not admitted");
      if (!this.storeId) return refuse("the backend store is not identified yet; mutation was not admitted");
      const requested = request.entry as Entry;
      const entry = { ...requested, seq: this.sequence = Math.max(this.sequence + 1, requested.seq) };
      const key = `${prefix(this.name)}${encodeURIComponent(this.storeId)}:${entry.id}`;
      const record = JSON.parse(JSON.stringify({ key, storeId: this.storeId, entry, authority: this.authority?.capture() })) as AdmissionRecord;
      const text = JSON.stringify(record);
      if (bytes(text) > RECORD_BYTES) return refuse("mutation admission exceeds 64 KiB; reduce the arguments before retrying");
      const held = keys(store).filter(key => key.startsWith(prefix(this.name)));
      const total = held.reduce((n, key) => n + bytes(key) + bytes(store.getItem(key) ?? ""), 0);
      if (held.length >= JOURNAL_RECORDS || total + bytes(key) + bytes(text) > JOURNAL_BYTES) return refuse("the admission journal is full (32 records or 256 KiB); wait for queued writes to commit before retrying");
      store.setItem(key, text);
      return record;
    } catch (error) { if (!browserAdmission()) return; throw error instanceof AdmissionError ? error : new AdmissionError(`localStorage could not keep the mutation: ${String(error)}`); }
  }

  transfer(record: AdmissionRecord, recovered: boolean): Change {
    return { s: "j", k: record.entry.id, v: JSON.stringify({ key: record.key, storeId: record.storeId, recovered } satisfies Transfer) };
  }

  refused(record: AdmissionRecord): Change[] {
    // No admission committed and nothing was sent. If removal fails, replace
    // the executable copy with a cancellation; IDB is an independent fallback.
    remove(record.key);
    if (!absent(record.key)) {
      try { storage()?.setItem(record.key, JSON.stringify({ key: record.key, cancelled: true })); } catch { /* IDB may still acknowledge it. */ }
    }
    return absent(record.key) ? [] : [this.transfer(record, false)];
  }

  // These are IDB transfer acknowledgements, not terminal mutation receipts.
  // They share the admission commit, so failure to remove localStorage cannot
  // resurrect an admitted ID after its outbox entry/receipt has been retired.
  cleanup(queued: ReadonlyMap<string, unknown>): Change[] {
    const changes: Change[] = [];
    if (!this.exclusive) return changes;
    for (const [id, transfer] of this.transfers) {
      remove(transfer.key);
      if (absent(transfer.key) && (!transfer.recovered || !queued.has(id))) changes.push({ s: "j", k: id, v: null });
    }
    return changes;
  }

  // Recovered, previously unadmitted writes keep their original store binding.
  // An authenticated reset has already withdrawn predictions before this runs.
  fence(device: WebDevice): void {
    const state = invoke(device, { op: "sync_state" }).ok;
    if (!state?.store_id) return;
    for (const [id, transfer] of this.transfers) if (transfer.recovered && transfer.storeId !== state.store_id) {
      const reply = invoke(device, { op: "dequeue", id });
      if (reply.denied) throw new Error(JSON.stringify(reply));
    }
  }

  async recover(device: WebDevice, settle: (extra?: Change[]) => Promise<void>, live = new Set<string>()): Promise<void> {
    if (!this.exclusive) return;
    const state = invoke(device, { op: "sync_state" }).ok;
    if (!state?.store_id || state.restore_refusal || state.backend_required) return;
    for (const record of records(this.name, true)) {
      const id = record.entry.id;
      if (live.has(id)) continue;
      if (this.transfers.has(id)) { remove(record.key); continue; }
      // A transferred outbox receipt wins over any leftover journal copy.
      const queued = invoke(device, { op: "queued" }).ok as Entry[];
      if (queued.some(e => e.id === id)) {
        await settle([this.transfer(record, false)]);
        continue;
      }
      // A bare device cannot validate an app-owned journal. Already committed
      // outbox custody above is independent of this unadmitted record's epoch.
      if (record.authority && !this.authority) continue;
      if (record.storeId !== state.store_id) {
        await settle([this.transfer(record, false)]);
        continue;
      }
      // @ref LLP 3000.007#20.4 — a journal record exists because ordinary
      // admission did not durably finish. Its retained rows may be stale, so a
      // local authored refusal cannot settle the intent. Replay admission keeps
      // a successful prediction, or rolls refusal back and lets the server decide.
      await this.authorize(record, async () => {
        const reply = this.admit(device, { ...record.entry, replay_candidate: true });
        if (reply.denied && !writeRefusal(reply)) throw new Error(JSON.stringify(reply));
        await settle(reply.denied ? this.refused(record) : [this.transfer(record, true)]);
      }, async () => { await settle(this.refused(record)); });
    }
  }

  async authorize<T>(record: AdmissionRecord, admitted: () => Promise<T>, refused: () => Promise<T>): Promise<T> {
    const stamp = record.authority;
    // Legacy app journals cannot prove which login authorized the click.
    // Raw local clients have no app epoch and retain their existing custody.
    if (!stamp) return this.authority ? refused() : admitted();
    if (!this.authority) throw new Error("the journal's session reader has not been attached");
    return storeLock(stamp.key, () => sameAdmissionAuthority(stamp, this.authority!, record.entry.viewer) ? admitted() : refused());
  }

  // @ref LLP 3000.007#20.4 — recovery and live admission allocate from the device's durable counter inside the same serialized chain.
  admit(device: WebDevice, entry: unknown): Record<string, unknown> {
    const next = invoke(device, { op: "next_submission" });
    if (next.denied) return next;
    return invoke(device, { op: "admit", entry: { ...entry as Entry, seq: next.ok } });
  }
}

export function writeRefusal(reply: Record<string, unknown>): boolean {
  const why = reply.denied as Refusal | undefined;
  return !!why && !why.retryable && !["E_STORE", "E_STORE_RESTORE", "E_GENERATION", "E_PREDICT"].includes(why.code);
}

export class AdmissionError extends Error {
  readonly why: Refusal;
  constructor(message: string) { super(message); this.why = admissionRefusal(message); }
}
