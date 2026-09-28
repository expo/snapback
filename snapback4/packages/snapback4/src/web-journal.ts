import { admissionRefusal, browserAdmission } from "./admission.ts";
import { sameAdmissionAuthority, type AdmissionAuthority, type AdmissionAuthorityContext } from "./admission-authority.ts";
import { storeLock } from "./app-storage.ts";
// Synchronous custody until the web device's ordinary admission commits.
// Exit dispatch evidence also survives until its ordinary status commit.
// No transport, result, or server settlement lives here.
import type { Change } from "./web.ts";
import type { Refusal } from "./contract.ts";
import { runJournal, runJournalAsync, type JournalPlan, type JournalInvoke, type JournalDevice } from "./web-journal-execution.ts";

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
const invoke = (device: JournalDevice, request: Record<string, unknown>) => JSON.parse(device.call(JSON.stringify(request)));

// @ref LLP 3000.013#6 — one rule for every handoff toward delivery. Unbound pre-journal outboxes
// retain their legacy custody; a journaled intent never loses its binding.
export function journalStoreBinding(bound: string | undefined, destination: string | null | undefined): "allow" | "defer" | "retire" {
  return bound === undefined ? "allow" : !destination ? "defer" : bound === destination ? "allow" : "retire";
}
export const bindingRefusal = (binding: "defer" | "retire"): Refusal => ({
  ...admissionRefusal(binding === "defer" ? "the captured backend store is not identified yet" : "the journaled write belongs to a different backend store",
    "client.mutate", binding === "defer" ? "reconnect to the captured backend to recover this write" : "review the replacement backend before submitting a new write"),
  retryable: binding === "defer",
});

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
  private exits = new Map<string, string>();
  private stagedExits = new Map<string, string>();
  private storeId: string | undefined;
  private sequence = 0;
  constructor(private readonly name: string, private readonly exclusive: boolean) {}

  // Keep the captured identity on the wire even if the endpoint changes after
  // local validation. Legacy outboxes use their kept device's identity.
  boundStore(id: string): string | undefined { return this.transfers.get(id)?.storeId ?? this.storeId; }

  load(saved: Change[]): void {
    this.transfers.clear();
    this.exits.clear(); this.stagedExits.clear();
    this.storeId = undefined;
    this.remember(saved);
    for (const record of records(this.name, this.exclusive)) this.sequence = Math.max(this.sequence, record.entry.seq);
  }

  remember(changes: Change[]): void {
    for (const c of changes) {
      if (c.s === "m" && c.k === "device:store_id") this.storeId = c.v ?? undefined;
      if (c.s === "j") {
        if (c.k.startsWith("exit:")) {
          if (c.v === null) this.exits.delete(c.k);
          else this.exits.set(c.k, c.v);
          if (this.stagedExits.get(c.k) === c.v) this.stagedExits.delete(c.k);
          continue;
        }
        if (c.v === null) this.transfers.delete(c.k);
        else this.transfers.set(c.k, JSON.parse(c.v));
      }
    }
  }

  // @ref LLP 3000.019#3.3 — page teardown cannot await IDB. Keep dispatch
  // evidence synchronously before allowing the request, on the existing journal.
  captureExit(id: string): boolean {
    try {
      const store = storage();
      if (!store) return !browserAdmission();
      const key = `${prefix(this.name)}exit:${id}`;
      const value = JSON.stringify({ key, id, storeId: this.boundStore(id), token: crypto.randomUUID() });
      store.setItem(key, value);
      this.stagedExits.set(`exit:${id}`, value);
      return true;
    } catch { return false; }
  }

  cancelExit(id: string): void {
    const key = `${prefix(this.name)}exit:${id}`;
    remove(key);
    if (!absent(key)) {
      // A refused dispatch is not send evidence. If both attempts fail, keep
      // the staged acknowledgement for the next ordinary commit to retire it.
      try {
        const store = storage();
        if (!store) return;
        const cancelled = JSON.stringify({ key, cancelled: true });
        store.setItem(key, cancelled);
        if (store.getItem(key) !== cancelled) return;
      } catch { return; }
    }
    this.stagedExits.delete(`exit:${id}`);
  }

  recoverExits(device: JournalDevice): void { runJournal(this.exitRecovery(), request => invoke(device, request)); }

  recoverExitsWith(call: JournalInvoke): Promise<void> { return runJournalAsync(this.exitRecovery(), call); }

  private *exitRecovery(): JournalPlan<void> {
    const store = storage();
    if (!store || !this.exclusive) return;
    const entries = new Set(((yield { op: "queued" }).ok as Entry[]).map(e => e.id));
    for (const key of keys(store).filter(key => key.startsWith(`${prefix(this.name)}exit:`))) {
      const value = store.getItem(key);
      if (!value || bytes(value) > RECORD_BYTES) continue;
      let record: { key: string; id: string; storeId?: string };
      try { record = JSON.parse(value); } catch { continue; }
      if (!record || record.key !== key || typeof record.id !== "string" || key !== `${prefix(this.name)}exit:${record.id}`) continue;
      const marker = `exit:${record.id}`;
      if (this.exits.get(marker) === value) continue;
      // Recovery changes only the original outbox row. Never re-admit an id
      // after settlement, nor apply a marker to another backend's intent.
      if (entries.has(record.id) && record.storeId === this.boundStore(record.id)) {
        const reply = yield { op: "begin_send", id: record.id };
        if (reply.denied) continue;
      }
      this.stagedExits.set(marker, value);
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
    for (const [id, value] of this.exits) {
      const key = `${prefix(this.name)}${id}`;
      try { if (storage()?.getItem(key) === value) remove(key); } catch { /* Retry cleanup on the next commit. */ }
      if (absent(key)) changes.push({ s: "j", k: id, v: null });
    }
    for (const [id, value] of this.stagedExits) changes.push({ s: "j", k: id, v: value });
    for (const [id, transfer] of this.transfers) {
      remove(transfer.key);
      if (absent(transfer.key) && !queued.has(id)) changes.push({ s: "j", k: id, v: null });
    }
    return changes;
  }

  // Every journaled write keeps its original store binding until dequeued,
  // including a fresh click captured while a replacement probe was in flight.
  // An authenticated reset has already withdrawn predictions before this runs.
  fence(device: JournalDevice): void { runJournal(this.fencing(), request => invoke(device, request)); }

  fenceWith(call: JournalInvoke): Promise<void> { return runJournalAsync(this.fencing(), call); }

  private *fencing(): JournalPlan<void> {
    const state = (yield { op: "sync_state", capture: false }).ok;
    for (const [id, transfer] of this.transfers) if (journalStoreBinding(transfer.storeId, state?.store_id) === "retire") {
      const reply = yield { op: "dequeue", id };
      if (reply.denied) throw new Error(JSON.stringify(reply));
    }
  }

  binding(device: JournalDevice, id: string): ReturnType<typeof journalStoreBinding> {
    const destination = invoke(device, { op: "sync_state", capture: false }).ok?.store_id;
    return journalStoreBinding(this.transfers.get(id)?.storeId, destination);
  }

  async recover(device: JournalDevice, settle: (extra?: Change[]) => Promise<void>, live = new Set<string>()): Promise<void> {
    return this.recoverWith(request => Promise.resolve(invoke(device, request)), settle, live);
  }

  // The page keeps capture, authority locks and cleanup. Only these explicit
  // requests cross a Worker boundary; records retain their original identity.
  async recoverWith(call: JournalInvoke, settle: (extra?: Change[]) => Promise<void>, live = new Set<string>()): Promise<void> {
    if (!this.exclusive) return;
    await this.recoverExitsWith(call);
    if (this.stagedExits.size) await settle([...this.stagedExits].map(([k, v]) => ({ s: "j", k, v })));
    const state = (await call({ op: "sync_state", capture: false })).ok;
    if (!state?.store_id || state.restore_refusal || state.backend_required) return;
    for (const record of records(this.name, true)) {
      const id = record.entry.id;
      if (live.has(id)) continue;
      if (this.transfers.has(id)) { remove(record.key); continue; }
      // A transferred outbox receipt wins over any leftover journal copy.
      const queued = (await call({ op: "queued" })).ok as Entry[];
      if (queued.some(e => e.id === id)) {
        await settle([this.transfer(record, false)]);
        continue;
      }
      // A bare device cannot validate an app-owned journal. Already committed
      // outbox custody above is independent of this unadmitted record's epoch.
      if (record.authority && !this.authority) continue;
      const binding = journalStoreBinding(record.storeId, state.store_id);
      if (binding === "defer") continue;
      if (binding === "retire") {
        await settle([this.transfer(record, false)]);
        continue;
      }
      // @ref LLP 3000.007#20.4 — a journal record exists because ordinary
      // admission did not durably finish. Its retained rows may be stale, so a
      // local authored refusal cannot settle the intent. Replay admission keeps
      // a successful prediction, or rolls refusal back and lets the server decide.
      await this.authorize(record, async () => {
        const reply = await this.admitWith(call, { ...record.entry, replay_candidate: true }, record.storeId);
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
    const authority = this.authority;
    let accepted = false;
    try {
      return await storeLock(stamp.key, async () => {
        accepted = await sameAdmissionAuthority(stamp, authority, record.entry.viewer);
        return accepted ? admitted() : refused();
      });
    } finally {
      // The app must withdraw observations too, but its check takes the same
      // non-reentrant lock. Schedule it only after this lock has released.
      if (!accepted) authority.recheck();
    }
  }

  // @ref LLP 3000.007#20.4 — recovery and live admission allocate from the device's durable counter inside the same serialized chain.
  admit(device: JournalDevice, entry: unknown, storeId?: string): Record<string, unknown> {
    return runJournal(this.admission(entry, storeId), request => invoke(device, request));
  }

  admitWith(call: JournalInvoke, entry: unknown, storeId?: string): Promise<Record<string, unknown>> {
    return runJournalAsync(this.admission(entry, storeId), call);
  }

  private *admission(entry: unknown, storeId?: string): JournalPlan<Record<string, unknown>> {
    const state = yield { op: "sync_state", capture: false };
    const binding = journalStoreBinding(storeId, state.ok?.store_id);
    if (binding !== "allow") return { denied: bindingRefusal(binding) };
    const next = yield { op: "next_submission" };
    if (next.denied) return next;
    const floor = yield { op: "meta", key: "server-clock-floor" };
    if (floor.denied) return floor;
    // Capture remains synchronous. Recovery ahead of this admission in the
    // device chain may have advanced time since capture, including after a crash.
    const issued = Number(floor.ok), requested = entry as Entry;
    const now = Number.isSafeInteger(issued) && issued >= 0 ? Math.max(requested.now, issued) : requested.now;
    return yield { op: "admit", entry: { ...requested, now, seq: next.ok } };
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
