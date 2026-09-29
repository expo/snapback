import type { Queued } from "./local-types.ts";
import type { Query } from "./contract.ts";
import { ReadObservation } from "./read-observation.ts";
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
  op: Query<unknown, unknown>;
  args: unknown;
  key: string;
  tables: Set<string>;
  setExistenceTables(tables: Set<string> | null): void;
  /** Re-runs a watch whose server answer read presence (LLP 3000.018), every
   * `presenceEvery` ms from then on. */
  presenceRefresh: ReturnType<typeof setTimeout> | null;
  presenceEvery?: number | undefined;
  /** The last accepted observation used the server while acquiring. */
  serverRead?: boolean;
  /** Whole server answer only: a composed retained answer cannot bypass its VM. */
  serverOnly?: boolean;
  subscribers: Set<() => void>;
  running: boolean;
  dirty: boolean;
  /** Reported change not yet published by this replica. */
  changeCut?: number;
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
  set(key: string, answer: ServerAnswer, order: AnswerOrder): void {
    if (this.admit(key, order)) this.answers.set(key, answer);
  }
  /** A server's refusal or loading answer, or a composed read's, which is not
   * remembered: nothing is remembered for the key. */
  delete(key: string, order: AnswerOrder): void {
    if (this.admit(key, order)) this.answers.delete(key);
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

export function queuedPredictions(entries: readonly Queued[]): readonly string[] | null {
  const predicted = entries.filter(e => e.observed_seq == null && e.predictable === true);
  return predicted.some(e => !e.predicted) ? null : [...new Set(predicted.flatMap(e => [...predictedTables(e.predicted!)]))];
}

/** Every local commit fences reads; retained replacements keep the change bound. */
export class LocalReads {
  revision = 0;
  predictions: readonly string[] | null = null;
  admissions = 0;
  pending(tables: Set<string> | null, predictions = this.predictions): boolean {
    return this.admissions > 0 || pendingTables(predictions, tables);
  }
  async readQueued(run: () => Promise<Queued[]>, watches: Iterable<LocalWatch>): Promise<Queued[]> {
    const revision = this.revision, entries = await run();
    if (revision === this.revision) {
      this.queued(entries);
      for (const watch of watches) if (watch.updateExistence()) notifyLocalWatch(watch);
    }
    return entries;
  }
  queued(entries: readonly Queued[]): void {
    this.predictions = queuedPredictions(entries);
  }
  readonly serverAnswers = new RememberedAnswers();

  // @ref LLP 3000.023#10 — change evidence retires recovery memory and
  // pre-change evaluations without resetting the displayed answer.
  changed(watch: LocalWatch, cut?: number): void {
    this.serverAnswers.forget(`${watch.op.name}:${JSON.stringify(watch.args)}`);
    watch.resetVersion++;
    if (cut !== undefined) watch.changeCut = Math.max(watch.changeCut ?? cut, cut);
  }

  // @ref LLP 3000.023#10 — an old replica cannot discharge reported change
  // evidence. Only published sync progress or a whole server answer at the cut
  // qualifies; a composed answer may still contain pre-change local rows.
  applied(watches: Iterable<LocalWatch>, watermark: number): void {
    for (const watch of watches) if (watch.changeCut !== undefined && watermark >= watch.changeCut) delete watch.changeCut;
  }

  current(watch: LocalWatch, result: { read: import("./contract.ts").Read<unknown>; serverOnly?: boolean; seq?: number | undefined }): boolean {
    return watch.changeCut === undefined || !("data" in result.read)
      || (result.serverOnly === true && result.seq !== undefined && result.seq >= watch.changeCut);
    // Keep the replica floor even after a qualifying server replacement: an
    // offline re-read must not reinstall its older local rows before sync.
  }

  // @ref LLP 3000.019#3.3 — held expiry fences old HTTP bodies before a callback can roll time back.
  expire(watch: LocalWatch, serverDue: boolean, serverNow: number): void {
    if (serverDue) this.serverAnswers.expire(`${watch.op.name}:${JSON.stringify(watch.args)}`, serverNow);
  }

  // @ref LLP 3000.023#10 — ordinary commits re-read without withdrawing the displayed answer.
  committed(watches: Iterable<LocalWatch>, operation: string): void {
    this.clear(watches, !["apply", "admit", "settle"].includes(operation));
  }

  clear(watches: Iterable<LocalWatch>, reset = true): void {
    this.revision++;
    this.predictions = null;
    this.serverAnswers.clear();
    for (const watch of watches) {
      if (reset) delete watch.changeCut;
      if (reset) watch.reset({ loading: true }); else watch.reload(true);
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

// @ref LLP 3000.031#1.1 — an unknown footprint blocks even a read of no tables.
export function pendingTables(predictions: readonly string[] | null, tables: Set<string> | null): boolean {
  return predictions === null || predictions.some(table => tables === null || tables.has(table));
}

export function localWatch(keep: boolean | undefined, op: Query<unknown, unknown>, args: unknown, key: string, incarnation: number,
  pending: (tables: Set<string> | null) => boolean): LocalWatch {
  const watch: LocalWatch = Object.assign(new ReadObservation<unknown>(keep), { op, args, key, tables: new Set<string>(), presenceRefresh: null, subscribers: new Set<() => void>(), running: false, dirty: false, expiryTimer: null, incarnation,
    setExistenceTables(tables: Set<string> | null) { watch.pending = () => pending(tables); } });
  watch.setExistenceTables(null);
  return watch;
}
