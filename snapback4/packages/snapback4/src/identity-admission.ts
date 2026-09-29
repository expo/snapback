import type { Refusal, Write } from "./contract.ts";
import type { Queued, StoreCapture } from "./local-types.ts";
import type { JournalPlan, JournalReply } from "./web-journal-execution.ts";

// @ref LLP 3000.007#20.4 — custody can precede identification, but execution cannot.
export const IDENTITY_WAIT_MS = 30_000;
export const IDENTITY_ADMISSIONS = "identity-admissions";
export interface AdmissionIdentity { backend: string; store?: string | undefined; deadline: number }
interface Deferred { entry: Queued; identity: AdmissionIdentity; admitted?: boolean; store?: string; why?: Refusal; outcome?: Exclude<Write, { state: "pending" }> }
export const identityRefusal = (timeout: boolean): Refusal => ({
  code: timeout ? "E_ADMISSION_TIMEOUT" : "E_ADMISSION_STORE", family: "store", site: "client.mutate", guide: "writes",
  message: timeout ? "This write could not identify its backend within 30 seconds and was not sent. Reconnect, then submit a new attempt."
    : "The backend changed before this write could be admitted. Review the current backend, then submit a new attempt.",
  rewrite: timeout ? "check the connection and backend URL, then submit with a new write id" : "reload the current backend and review the draft before submitting with a new write id",
});
const check = (reply: JournalReply): any => {
  if (reply.denied) throw new Error(`${reply.denied.code}: ${reply.denied.message}`);
  return reply.ok;
};
export function identityQueue(read: () => Promise<Queued[]>, resumed: (entry: Queued) => void): () => Promise<Queued[]> {
  const waiting = new Set<string>();
  return async () => {
    const entries = await read();
    for (const entry of entries) {
      if (entry.admission_waiting) waiting.add(entry.id);
      else if (waiting.delete(entry.id)) resumed(entry);
    }
    return entries;
  };
}
const identity = (state: StoreCapture): AdmissionIdentity => ({
  backend: state.adoption_capture?.["device:backend-identity"] ?? "",
  store: state.store_id ?? state.transfer_store_id ?? undefined, deadline: Date.now() + IDENTITY_WAIT_MS,
});
function sameInput(a: Queued, b: Queued): boolean {
  const sort = (v: any): any => Array.isArray(v) ? v.map(sort) : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v;
  return a.op === b.op && a.viewer === b.viewer && JSON.stringify(sort(a.args)) === JSON.stringify(sort(b.args));
}

/** Plans run inside the host's existing serialized admission/commit boundary.
 * Metadata owns only the pre-identification handoff; the ordinary outbox owns
 * prediction, delivery, deduplication and receipts after it. */
export class IdentityAdmissions {
  private kept: Deferred[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly wake?: () => void) {}
  close(): void { clearTimeout(this.timer); }
  remember(value: string | null): void {
    this.kept = value ? JSON.parse(value) : [];
    clearTimeout(this.timer);
    const deadline = this.deadline();
    if (deadline !== undefined && this.wake) {
      this.timer = setTimeout(this.wake, Math.max(0, deadline - Date.now()));
      (this.timer as { unref?: () => void }).unref?.();
    }
  }
  bound(id: string): string | undefined { return this.kept.find(r => r.entry.id === id)?.store; }
  deadline(): number | undefined { return this.kept.filter(r => !r.admitted && !r.why && !r.store && !r.outcome).reduce<number | undefined>((n, r) => n === undefined ? r.identity.deadline : Math.min(n, r.identity.deadline), undefined); }
  private *load(): JournalPlan<Deferred[]> {
    const text = check(yield { op: "meta", key: IDENTITY_ADMISSIONS });
    return text ? JSON.parse(text) : [];
  }
  private *save(records: Deferred[]): JournalPlan<void> {
    check(yield { op: "set_meta", key: IDENTITY_ADMISSIONS, value: JSON.stringify(records) });
  }
  private view(record: Deferred): Queued {
    return { ...record.entry, predictable: false, predicted: [], ...(record.store ? { store_id: record.store } : {}),
      admission_waiting: !record.admitted, ...(record.why ? { admission_refusal: record.why } : {}), ...(record.outcome ? { admission_outcome: record.outcome } : {}) };
  }
  *admit(entry: Queued, captured?: AdmissionIdentity, expectedStore?: string): JournalPlan<JournalReply> {
    const state = check(yield { op: "sync_state", capture: false }) as StoreCapture;
    const records = yield* this.load();
    const existing = records.find(r => r.entry.id === entry.id);
    if (existing) {
      if (!sameInput(existing.entry, entry)) return { denied: { code: "E_WRITE_ID_REUSE", family: "input", message: "write id already belongs to different input; retry the original input or use a new id", guide: "writes" } };
      const queued = check(yield { op: "queued" }) as Queued[];
      const admitted = queued.find(e => e.id === entry.id);
      if (admitted && !sameInput(admitted, entry)) return { denied: { code: "E_WRITE_ID_REUSE", family: "input", message: "write id already belongs to different input; retry the original input or use a new id", guide: "writes" } };
      return { ok: admitted ?? this.view(existing) };
    }
    if (!captured && state.store_id && !records.some(r => !r.admitted && !r.why)) return yield { op: "admit", entry };
    // Validate operation kind with the ordinary interpreter before deferring
    // prediction. Nothing from this validation is ever exposed to transport.
    const backend = check(yield { op: "backend" });
    const program = backend.programs.find((p: { name: string }) => p.name === entry.op);
    if (backend.schema.operations?.[entry.op]?.ephemeral || !program || program.kind !== "Mutation") {
      return yield { op: "admit", entry };
    }
    if (records.filter(r => !r.admitted).length >= 32 || new TextEncoder().encode(JSON.stringify([...records, { entry }])).length > 256 * 1024) {
      return { denied: { code: "E_ADMISSION", family: "store", message: "The admission journal is full; wait for pending writes to settle before retrying.", guide: "writes" } };
    }
    entry = { ...entry, seq: Math.max(entry.seq, check(yield { op: "next_submission" }), ...records.map(r => r.entry.seq + 1)) };
    const record: Deferred = { entry, identity: captured ?? { ...identity(state), store: expectedStore ?? state.store_id ?? state.transfer_store_id ?? undefined } };
    records.push(record);
    yield* this.save(records);
    return { ok: this.view(record) };
  }
  *queued(request: Record<string, unknown> = { op: "queued" }): JournalPlan<JournalReply> {
    const records = yield* this.load();
    if (!records.length) return yield request;
    const state = check(yield { op: "sync_state", capture: false }) as StoreCapture;
    const established = Number(check(yield { op: "meta", key: "identity-established" }));
    let actual = check(yield request) as Queued[];
    let changed = false;
    for (const record of records) {
      if (record.admitted || record.why || record.outcome) continue;
      const store = state.store_id ?? state.transfer_store_id;
      const expectedStore = record.store ?? record.identity.store;
      if (state.restore_refusal || (store && expectedStore && store !== expectedStore)
        || record.identity.backend !== state.adoption_capture?.["device:backend-identity"]) {
        record.why = identityRefusal(false); changed = true; continue;
      }
      if (!record.store && record.identity.deadline <= Date.now() && !(state.store_id && established > 0 && established <= record.identity.deadline)) { record.why = identityRefusal(true); changed = true; continue; }
      if (!state.store_id) break;
      if (!record.store) {
        record.store = state.store_id;
        // Freeze successful identification before native admission. Another
        // owner cannot time it out while SQLite is committing the outbox row.
        yield* this.save(records);
      }
      if (state.backend_required) break;
      // A native process may have committed admission before dying during
      // this metadata handoff. Recover that exact outbox entry, never re-mint.
      const existing = actual.find(e => e.id === record.entry.id);
      const reply = existing && !sameInput(existing, record.entry)
        ? { denied: { code: "E_WRITE_ID_REUSE", family: "input", message: "write id already belongs to different input; retry the original input or use a new id", guide: "writes" } }
        : yield { op: "admit", entry: record.entry, identity_backend: record.identity.backend, identity_store: record.store };
      if (reply.denied?.retryable || ["E_STORE", "E_PREDICT", "E_GENERATION"].includes(reply.denied?.code)) break;
      if (reply.denied) record.why = reply.denied.code === "E_ADMISSION_STORE" ? identityRefusal(false) : reply.denied;
      else { record.admitted = true; record.store = state.store_id; actual.push(reply.ok); }
      changed = true;
    }
    actual = check(yield { op: "queued" }) as Queued[];
    const kept = records.filter(r => !r.admitted || actual.some(e => e.id === r.entry.id));
    if (changed || kept.length !== records.length) yield* this.save(kept);
    // Entries transferred before this generation of deferred custody retain
    // priority. Newly admitted entries preserve their original capture order.
    const entries: Queued[] = actual.filter(e => !records.some(r => r.entry.id === e.id && r.outcome)).map(e => {
      const store = records.find(r => r.entry.id === e.id)?.store ?? e.store_id;
      return { ...e, ...(store ? { store_id: store } : {}) };
    });
    entries.push(...records.filter(r => !r.admitted).map(r => this.view(r)));
    const order = (e: Queued) => records.find(r => r.entry.id === e.id)?.entry.seq ?? e.seq;
    entries.sort((a, b) => order(a) - order(b));
    return { ok: entries };
  }
  *settle(request: Record<string, unknown>): JournalPlan<JournalReply> {
    const records = yield* this.load();
    const record = records.find(r => r.entry.id === request.id);
    const actual = record && !record.admitted ? check(yield { op: "queued" }) as Queued[] : undefined;
    // Terminal recovery owns only the deferred handoff. A peer's ordinary
    // outbox/receipt can outlive this interpreter's store incarnation.
    const reply = record?.outcome || (actual && !actual.some(e => e.id === request.id)) ? { ok: null } : yield request;
    if (!reply.denied && record && (record.outcome || request.seq == null)) yield* this.save(records.filter(r => r !== record));
    return reply;
  }
  *adopt(value: string | null): JournalPlan<void> {
    if (!value) return;
    const records = yield* this.load();
    let seq = Math.max(check(yield { op: "next_submission" }), ...records.map(r => r.entry.seq + 1));
    for (const record of JSON.parse(value) as Deferred[]) {
      if (records.some(r => r.entry.id === record.entry.id)) continue;
      records.push({ ...record, entry: { ...record.entry, seq: seq++ } });
    }
    yield* this.save(records);
  }
}
