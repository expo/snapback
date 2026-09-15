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
}

export interface AdmissionRecord { key: string; storeId: string; entry: Entry }
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
    return [...new Set(keys(store).filter(key => key.startsWith(PREFIX)).map(key => decodeURIComponent(key.slice(PREFIX.length).split(":")[0]!)).filter(name => name.startsWith(namePrefix)))];
  } catch { return []; }
}

function records(name: string): AdmissionRecord[] {
  try {
    const store = storage();
    if (!store) return [];
    const found: AdmissionRecord[] = [];
    for (const key of keys(store).filter(key => key.startsWith(prefix(name)))) {
      const text = store.getItem(key);
      if (!text || bytes(text) > RECORD_BYTES) continue;
      try {
        const record = JSON.parse(text) as AdmissionRecord;
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
  private transfers = new Map<string, Transfer>();
  private storeId: string | undefined;
  constructor(private readonly name: string) {}

  load(saved: Change[]): void {
    this.transfers.clear();
    this.storeId = undefined;
    this.remember(saved);
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
    try {
      const store = storage();
      if (!store || !this.storeId) return;
      const entry = request.entry as Entry;
      const key = `${prefix(this.name)}${encodeURIComponent(this.storeId)}:${entry.id}`;
      const record = JSON.parse(JSON.stringify({ key, storeId: this.storeId, entry })) as AdmissionRecord;
      const text = JSON.stringify(record);
      if (bytes(text) > RECORD_BYTES) return;
      const held = keys(store).filter(key => key.startsWith(prefix(this.name)));
      const total = held.reduce((n, key) => n + bytes(key) + bytes(store.getItem(key) ?? ""), 0);
      if (held.length >= JOURNAL_RECORDS || total + bytes(key) + bytes(text) > JOURNAL_BYTES) return;
      store.setItem(key, text);
      return record;
    } catch { return; } // Quota, disabled storage, accessors and serialization keep today's admission path.
  }

  transfer(record: AdmissionRecord, recovered: boolean): Change {
    return { s: "j", k: record.entry.id, v: JSON.stringify({ key: record.key, storeId: record.storeId, recovered } satisfies Transfer) };
  }

  refused(record: AdmissionRecord): Change[] {
    // No admission committed and nothing was sent. Preserve the ordinary
    // typed refusal even when IDB is down; only failed synchronous cleanup
    // needs an IDB acknowledgement to suppress the leftover journal copy.
    remove(record.key);
    return absent(record.key) ? [] : [this.transfer(record, false)];
  }

  // These are IDB transfer acknowledgements, not terminal mutation receipts.
  // They share the admission commit, so failure to remove localStorage cannot
  // resurrect an admitted ID after its outbox entry/receipt has been retired.
  cleanup(queued: ReadonlyMap<string, unknown>): Change[] {
    const changes: Change[] = [];
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
    const state = invoke(device, { op: "sync_state" }).ok;
    if (!state?.store_id || state.restore_refusal || state.backend_required) return;
    for (const record of records(this.name)) {
      const id = record.entry.id;
      if (live.has(id)) continue;
      if (this.transfers.has(id)) { remove(record.key); continue; }
      // A transferred outbox receipt wins over any leftover journal copy.
      const queued = invoke(device, { op: "queued" }).ok as Entry[];
      if (queued.some(e => e.id === id)) {
        await settle([this.transfer(record, false)]);
        continue;
      }
      if (record.storeId !== state.store_id) {
        await settle([this.transfer(record, false)]);
        continue;
      }
      const entry = { ...record.entry, seq: invoke(device, { op: "next_submission" }).ok };
      const reply = invoke(device, { op: "admit", entry });
      if (reply.denied && !writeRefusal(reply)) throw new Error(JSON.stringify(reply));
      await settle(reply.denied ? this.refused(record) : [this.transfer(record, true)]);
    }
  }
}

export function writeRefusal(reply: Record<string, unknown>): boolean {
  const why = reply.denied as Refusal | undefined;
  return !!why && !why.retryable && !["E_STORE", "E_STORE_RESTORE", "E_GENERATION", "E_PREDICT"].includes(why.code);
}
