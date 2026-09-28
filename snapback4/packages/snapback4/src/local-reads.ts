import type { Query } from "./contract.ts";
import { ReadObservation, readKey } from "./read-observation.ts";
import { presenceRefresh } from "./presence-refresh.ts";
import type { BackendJson } from "./backend.ts";


export function runsOnServer(backend: BackendJson, op: Query<unknown, unknown>, nativeReady: boolean): boolean {
  const program = backend.programs.find(program => program.name === op.name);
  if (program?.native) return !nativeReady;
  return (backend.schema.operations?.[op.name]?.runs ?? program?.runs ?? op.runs) === "server";
}

export function predictedTables(predicted: readonly string[]): Set<string> {
  // Footprints are table/id; ids may themselves contain slashes.
  return new Set(predicted.map(row => row.slice(0, row.indexOf("/"))).filter(Boolean));
}

export interface LocalWatch extends ReadObservation<unknown> {
  stablePuts?: string[];
  op: Query<unknown, unknown>;
  args: unknown;
  key: string;
  tables: Set<string>;
  /** Re-runs a watch whose server answer read presence (LLP 3000.018), every
   * `presenceEvery` ms from then on. */
  presenceRefresh: ReturnType<typeof setTimeout> | null;
  presenceEvery?: number | undefined;
  /** The last accepted observation used the server while acquiring. */
  serverRead?: boolean;
  /** Whole server answer only: a composed retained answer cannot bypass its VM. */
  serverOnly?: boolean;
  serverSeq?: number | undefined;
  subscribers: Set<() => void>;
  running: boolean;
  dirty: boolean;
  expiredRetries?: number;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  incarnation: number;
}

export function armLocalPresence(watch: LocalWatch, unavailable: boolean, acquiring: boolean, refresh: () => void): void {
  // A closed client or a dead session keeps no interval, whichever read settles last.
  if (unavailable) watch.presenceEvery = undefined;
  // @ref LLP 3000.019#3.3 — a live fallback must not wait behind cold snapshot publication.
  // Reuse the bounded background read while sync owns the change-follow loop.
  const interval = !unavailable && acquiring && watch.serverRead
    ? Math.min(watch.presenceEvery ?? 250, 250) : watch.presenceEvery;
  watch.presenceRefresh = presenceRefresh(watch.presenceRefresh, interval, () => {
    watch.presenceRefresh = null;
    refresh();
  });
}

export function notifyLocalWatch(watch: LocalWatch): void {
  for (const subscriber of watch.subscribers) subscriber();
}

export function rerunLocalTables(watches: Iterable<LocalWatch>, tables: Set<string>, rerun: (watch: LocalWatch) => Promise<void>): void {
  if (!tables.size) return;
  for (const watch of watches) if (watch.tables.size === 0 || [...watch.tables].some(table => tables.has(table))) void rerun(watch);
}

export type ServerAnswer = {
  read: Extract<import("./contract.ts").Read<unknown>, { data: unknown }>;
  at: number;
  nextExpiry: number | null;
  tables: Set<string>;
};

/** Where a server's answer or refusal stands: the store cut the server read, if
 * the reply named one, then when the read attempt began. */
export type AnswerOrder = { seq: number | undefined; ticket: number };
type Written = AnswerOrder & { highest: number | undefined; barrier?: number };

/** Remembered server answers, which a later recovery may show. A server's
 * answer, or its refusal, replaces what is remembered for its key only if it
 * is not older. A reply below the highest cut any reply for the key has named,
 * kept or not, is older; otherwise a later cut than what is remembered wins,
 * and at the same cut, or when either names none, the read attempt that began
 * later wins (LLP 3000.018 §3.2). */
export class RememberedAnswers {
  private readonly answers = new Map<string, ServerAnswer>();
  private readonly written = new Map<string, Written>();
  private tickets = 0;
  /** The ticket of a read attempt that is about to begin. */
  begin(): number { return ++this.tickets; }
  get(key: string): ServerAnswer | undefined { return this.answers.get(key); }
  set(key: string, answer: ServerAnswer, order: AnswerOrder): boolean {
    if (!this.admit(key, order)) return false;
    this.answers.set(key, answer); return true;
  }
  /** A server's refusal or loading answer, or a composed read's, which is not
   * remembered: nothing is remembered for the key. */
  delete(key: string, order: AnswerOrder): boolean {
    if (!this.admit(key, order)) return false;
    this.answers.delete(key); return true;
  }
  /** Local expiry fences every read already begun, while preserving its cuts. */
  forget(key: string): void {
    this.answers.delete(key);
    this.fence(key);
  }
  /** Displayed expiry fences old bodies even when newer memory survives. */
  expire(key: string, now: number): void {
    this.fence(key);
    const last = this.answers.get(key);
    if (last?.nextExpiry != null && last.nextExpiry <= now) this.answers.delete(key);
  }
  private fence(key: string): void {
    const slot = this.written.get(key), barrier = ++this.tickets;
    this.written.set(key, { seq: slot?.seq, highest: slot?.highest, ticket: barrier, barrier });
  }
  clear(): void { this.answers.clear(); this.written.clear(); }
  get size(): number { return this.answers.size; }
  /** The cache as one read attempt writes it: the server's cut, then the attempt's
   * ticket. A refetch within the attempt is a new read, so it renews the ticket. */
  view() {
    let ticket = this.begin();
    return {
      get: (key: string) => this.get(key),
      set: (key: string, answer: ServerAnswer, seq?: number) => this.set(key, answer, { seq, ticket }),
      delete: (key: string, seq?: number) => this.delete(key, { seq, ticket }),
      forget: (key: string) => this.forget(key),
      renew: () => { ticket = this.begin(); },
    };
  }
  /** Whether a reply is not older than what is remembered for its key. Either
   * way the highest cut named for the key stays known, so an answer remembered
   * with a cut is always at the highest cut any reply for its key has named. */
  private admit(key: string, order: AnswerOrder): boolean {
    const slot = this.written.get(key);
    const highest = order.seq === undefined ? slot?.highest : Math.max(order.seq, slot?.highest ?? order.seq);
    const newer = !slot ? true
      // @ref LLP 3000.019#3.3 — expiry cannot be undone by an older in-flight body, even at a higher cut.
      : order.ticket < (slot.barrier ?? 0) ? false
      // Below a cut some reply for the key named, kept or not: older, whatever its ticket.
      : order.seq !== undefined && slot.highest !== undefined && order.seq < slot.highest ? false
      // Cuts compare only when both replies name one.
      : order.seq !== undefined && slot.seq !== undefined && order.seq > slot.seq ? true
      : order.ticket >= slot.ticket;
    this.written.set(key, newer ? { ...order, highest, ...(slot?.barrier === undefined ? {} : { barrier: slot.barrier }) } : { ...slot!, highest });
    return newer;
  }
}

/** Every local commit fences reads; retaining watches bound an ordinary reload. */
export class LocalReads {
  revision = 0;
  readonly serverAnswers = new RememberedAnswers();
  private appliedCut = 0;
  private reportedCut = 0;
  evidenceSerial = 0;
  private readonly unknownKeys = new Map<string, number>();
  private readonly tableCuts = new Map<string, number>();
  private readonly keyCuts = new Map<string, number>();
  // @ref LLP 3000.029#7 — new evaluations are fenced until published apply.
  fence(tables: readonly string[] | undefined, cut: number): void {
    for (const table of tables ?? ["*"]) this.tableCuts.set(table, Math.max(cut, this.tableCuts.get(table) ?? 0));
  }
  replacement(key: string, cut?: number): void {
    if (cut === undefined) this.unknownKeys.set(key, ++this.evidenceSerial); else this.unknownKeys.delete(key);
    const previous = this.keyCuts.get(key) ?? 0;
    this.keyCuts.set(key, Math.max(cut ?? Infinity, Number.isFinite(previous) ? previous : 0));
  }
  minimum(key: string, tables: Set<string>): number {
    return Math.max(this.keyCuts.get(key) === Infinity || (this.keyCuts.get(key) ?? 0) <= this.appliedCut ? 0 : this.keyCuts.get(key) ?? 0, this.tableCuts.get("*") ?? 0,
      ...[...this.tableCuts].filter(([table]) => !tables.size || tables.has(table)).map(([, cut]) => cut));
  }
  blocked(key: string, tables: Set<string>): boolean { return this.keyCuts.get(key) === Infinity || this.minimum(key, tables) > this.appliedCut; }
  applied(cut: number, complete = false, requestSerial = this.evidenceSerial): void {
    this.appliedCut = Math.max(this.appliedCut, cut);
    this.reportedCut = Math.max(this.reportedCut, cut);
    for (const slots of [this.tableCuts, this.keyCuts]) for (const [key, minimum] of slots)
      if (minimum <= this.appliedCut || (complete && minimum === Infinity && (this.unknownKeys.get(key) ?? Infinity) <= requestSerial)) { slots.delete(key); this.unknownKeys.delete(key); }
  }


  // A receipt covers its own commit only. A gap is an unknown footprint.
  receipt(watches: Iterable<LocalWatch>, json: Record<string, unknown>): boolean {
    const cut = Number(json.seq);
    if (!Number.isSafeInteger(cut) || cut <= this.reportedCut) return false;
    const touched = cut === this.reportedCut + 1 && Array.isArray(json.tables) ? json.tables as string[] : undefined;
    const stable = Array.isArray(json.nonRevoking) ? json.nonRevoking as string[] : [];
    this.changed([...watches].filter(w => !w.serverOnly || w.serverSeq === undefined || w.serverSeq < cut), touched, cut, stable);
    return true;
  }

  // @ref LLP 3000.019#3.3 — held expiry fences old HTTP bodies before a callback can roll time back.
  expire(watch: LocalWatch, serverDue: boolean, serverNow: number): void {
    if (serverDue) this.serverAnswers.expire(readKey(watch.op, watch.args), serverNow);
  }

  // @ref LLP 3000.029#4 — committed input changes withdraw before callbacks.
  committed(watches: Iterable<LocalWatch>, operation: string, touched?: readonly string[], nonRevoking: readonly string[] = []): void {
    if (!["apply", "admit", "settle"].includes(operation)) { this.clear(watches); return; }
    this.changed(watches, touched, undefined, nonRevoking);
  }

  changed(watches: Iterable<LocalWatch>, touched?: readonly string[], cut?: number, nonRevoking: readonly string[] = []): void {
    this.revision++;
    if (cut !== undefined) { this.fence(touched, cut); this.reportedCut = Math.max(this.reportedCut, cut); }
    this.serverAnswers.clear();
    for (const watch of watches) {
      if ("denied" in watch.snapshot && watch.snapshot.denied.code === "E_INPUT") continue;
      const invalid = touched === undefined || (touched.length > 0 &&
        (watch.tables.size === 0 || touched.some(table => watch.tables.has(table) && (!nonRevoking.includes(table) || !watch.stablePuts?.includes(table)))));
      if (invalid) {
        watch.reset({ loading: true });
        if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
        watch.expiryTimer = null; watch.deadlines = undefined;
      } else watch.reload();
    }
  }

  clear(watches: Iterable<LocalWatch>, reset = true): void {
    this.revision++;
    this.serverAnswers.clear();
    this.tableCuts.clear(); this.keyCuts.clear(); this.unknownKeys.clear(); this.appliedCut = 0; this.reportedCut = 0;
    for (const watch of watches) {
      if (reset) watch.reset({ loading: true }); else watch.reload();
      if (reset || !watch.retain) {
        if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
        watch.expiryTimer = null;
        watch.deadlines = undefined;
      }
      // A replaced store relearns presence intervals from its next server answer.
      if (watch.presenceRefresh) clearTimeout(watch.presenceRefresh);
      watch.presenceRefresh = null;
      watch.presenceEvery = undefined;
    }
  }
}

/** Unknown host replies conservatively invalidate; empty certified footprints do not. */
export function changedInputs(operation: unknown, result: unknown): string[] | undefined {
  const evidence = result as { touched?: string[]; predicted?: string[] } | undefined;
  return operation === "admit" && Array.isArray(evidence?.predicted)
    ? [...predictedTables(evidence.predicted)] : evidence?.touched;
}

/** Shared local watch plumbing; resets finish before the next async read. */
export function watchLocalEphemeral(watch: LocalWatch, tables: string[], interests: import("./ephemeral-reads.ts").EphemeralReads,
  current: () => boolean, clearExpiry: () => void, rerun: () => void): void {
  if (!tables.length) { interests.remove(watch); return; }
  interests.add(watch, tables, reset => {
    const deliver = reset ? watch.reset({ loading: true }, true) : undefined;
    if (reset) clearExpiry();
    return () => {
      deliver?.();
      if (!current()) return;
      if (reset) notifyLocalWatch(watch);
      rerun();
    };
  });
}
