import { deferReadNotifications } from "./read-notifications.ts";
import type { Queued } from "./local-types.ts";
import type { Query, Refusal } from "./contract.ts";
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

export type ReadScopes = Record<string, Record<string, unknown>[]>;
/** A composition depends on both evaluations; missing certification widens. */
export function mergeReadScopes(left: ReadScopes | undefined, right: ReadScopes | undefined): ReadScopes | undefined {
  if (!left || !right) return undefined;
  const scopes: ReadScopes = Object.create(null);
  for (const source of [left, right]) for (const [table, groups] of Object.entries(source)) {
    const values = scopes[table] ??= [];
    for (const group of groups) if (!values.some(value => JSON.stringify(value) === JSON.stringify(group))) values.push(group);
  }
  return scopes;
}
type ScopeLoss = { table: string; data: unknown[]; watermark: number };
function overlapsScope(tables: Set<string>, scopes: ReadScopes | undefined, loss: ScopeLoss): boolean {
  return tables.has(loss.table) && (scopes === undefined || (Object.hasOwn(scopes, loss.table) ? scopes[loss.table] : undefined)?.some(group =>
    Object.entries(group).every(([index, value]) => JSON.stringify(value) === JSON.stringify(loss.data[Number(index)]))) === true);
}

export interface LocalWatch extends ReadObservation<unknown> {
  op: Query<unknown, unknown>;
  args: unknown;
  key: string;
  tables: Set<string>;
  scopes?: ReadScopes | undefined;
  /** A staged removal must publish before any local answer can return. */
  scopeCut?: number;
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
  changeVersion?: number;
  /** Reported change not yet published by this replica. */
  changeCut?: number;
  /** Resume at sync publication even when its final footprint is disjoint. */
  waitingForSync?: boolean;
  detachedEpoch?: number;
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

export function rerunLocalTables(watches: Iterable<LocalWatch>, tables: Set<string>, rerun: (watch: LocalWatch) => void): void {
  if (!tables.size) return;
  for (const watch of watches) if (watch.tables.size === 0 || [...watch.tables].some(table => tables.has(table))) void rerun(watch);
}

export type ServerAnswer = {
  read: Extract<import("./contract.ts").Read<unknown>, { data: unknown }>;
  scopes?: ReadScopes | undefined;
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
  clear(touched?: readonly string[]): void {
    if (touched === undefined) { this.answers.clear(); this.written.clear(); return; }
    if (!touched.length) return;
    for (const [key, answer] of this.answers) {
      if (answer.tables.size && !touched.some(table => answer.tables.has(table))) continue;
      this.forget(key);
    }
  }
  withdraw(losses: ScopeLoss[]): void {
    for (const [key, answer] of this.answers) if (losses.some(loss => overlapsScope(answer.tables, answer.scopes, loss))) this.forget(key);
  }
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
  evidenceEpoch = 0;
  evidence(): void { this.evidenceEpoch++; }
  detach(watch: LocalWatch): void { watch.detachedEpoch = this.evidenceEpoch; }
  predictions: readonly string[] | null = null;
  admissions = 0;
  private scopeCuts: ScopeLoss[] = [];
  private readonly notifiedCuts = new Map<string | undefined, number>();
  /** Notifications invalidate memory even when its last observation is closed.
   * The existing revision fences every older evaluation, including unseen keys. */
  notified(tables: readonly string[] | undefined, cut: number): void {
    if (tables === undefined || tables.length) this.revision++;
    this.evidence();
    this.serverAnswers.clear(tables);
    for (const table of tables ?? [undefined]) this.notifiedCuts.set(table, Math.max(this.notifiedCuts.get(table) ?? 0, cut));
  }
  resume(watch: LocalWatch): void {
    if (watch.detachedEpoch === undefined) return;
    for (const [table, cut] of this.notifiedCuts) if (table === undefined || !watch.tables.size || watch.tables.has(table)) {
      watch.changeCut = Math.max(watch.changeCut ?? 0, cut);
    }
  }
  // @ref LLP 3000.031#1.1 — one-shot and observed reads share the admission fence.
  admitting(watches: () => Iterable<LocalWatch>): () => void {
    const notify = () => { for (const watch of watches()) if (watch.updateExistence()) notifyLocalWatch(watch); };
    this.admissions++; notify();
    return () => { this.admissions--; notify(); };
  }
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
    this.evidence();
    this.serverAnswers.forget(`${watch.op.name}:${JSON.stringify(watch.args)}`);
    watch.changeVersion = (watch.changeVersion ?? 0) + 1;
    if (cut !== undefined) watch.changeCut = Math.max(watch.changeCut ?? cut, cut);
  }

  // @ref LLP 3000.023#10 — only held queries forbid every future server fallback.
  // Previous routing cannot prove the next branch or coverage. Terminal
  // refusals must reach runLocal's checkpoint even after a watch has parked.
  deferUntilSync(watch: LocalWatch, acquired: boolean, backend: BackendJson, denied: Refusal | null): boolean {
    if (watch.kept) watch.reload();
    const program = backend.programs.find(program => program.name === watch.op.name);
    const held = backend.schema.operations?.[watch.op.name]?.held ?? program?.held ?? watch.op.held ?? false;
    if (!denied && watch.scopeCut !== undefined) { watch.waitingForSync = true; return true; }
    if (!denied && acquired && watch.changeCut !== undefined) {
      watch.waitingForSync = true;
      return held;
    }
    delete watch.waitingForSync;
    return false;
  }

  // @ref LLP 3000.023#10 — an old replica cannot discharge reported change
  // evidence. Only published sync progress or a whole server answer at the cut
  // qualifies; a composed answer may still contain pre-change local rows.
  applied(watches: Iterable<LocalWatch>, watermark: number): LocalWatch[] {
    this.evidence();
    for (const [table, cut] of this.notifiedCuts) if (cut <= watermark) this.notifiedCuts.delete(table);
    this.scopeCuts = this.scopeCuts.filter(loss => loss.watermark > watermark);
    return [...watches].filter(watch => this.reconcile(watch, watermark));
  }

  /** A resumed owner checks the actual replica, never a saved publication cut. */
  reconcile(watch: LocalWatch, watermark: number): boolean {
    if (watch.scopeCut !== undefined && watermark >= watch.scopeCut) delete watch.scopeCut;
    if (watch.changeCut === undefined || watermark < watch.changeCut || watch.scopeCut !== undefined) return false;
    delete watch.changeCut;
    const waiting = watch.waitingForSync === true;
    delete watch.waitingForSync;
    return waiting;
  }

  blocked(result: { read: import("./contract.ts").Read<unknown>; tables?: Set<string>; scopes?: ReadScopes | undefined }): number | undefined {
    if (!("data" in result.read) || !result.tables) return;
    let cut: number | undefined;
    for (const loss of this.scopeCuts) if (overlapsScope(result.tables, result.scopes, loss)) cut = Math.max(cut ?? loss.watermark, loss.watermark);
    return cut;
  }

  // @ref LLP 3000.023#10 — one epoch covers every channel a detached owner missed.
  // A getter may discard a saved answer, but never parks an unregistered owner.
  restore(watch: LocalWatch, detached: boolean, denied: Refusal | null): void {
    if (denied) {
      if (!("denied" in watch.snapshot) || watch.snapshot.denied.code !== denied.code) watch.reset({ denied });
      return;
    }
    if (detached && watch.detachedEpoch !== this.evidenceEpoch) {
      delete watch.scopeCut; delete watch.changeCut; delete watch.waitingForSync;
      if (!("loading" in watch.snapshot)) watch.reset({ loading: true }, false, "detached-change");
    }
  }

  current(watch: LocalWatch, result: { read: import("./contract.ts").Read<unknown>; tables?: Set<string>; scopes?: ReadScopes | undefined; serverOnly?: boolean; seq?: number | undefined }): boolean {
    // New mounts have no prior footprint: certify their evaluated dependency
    // against every unpublished removal before installing the first answer.
    const cut = this.blocked(result);
    if (cut !== undefined) {
      this.changed(watch, cut);
      watch.scopeCut = Math.max(watch.scopeCut ?? cut, cut);
      watch.waitingForSync = true;
    }
    return !("data" in result.read) || watch.scopeCut === undefined && (watch.changeCut === undefined
      || (result.serverOnly === true && result.seq !== undefined && result.seq >= watch.changeCut));
    // Keep the replica floor even after a qualifying server replacement: an
    // offline re-read must not reinstall its older local rows before sync.
  }

  // @ref LLP 3000.019#3.3 — held expiry fences old HTTP bodies before a callback can roll time back.
  expire(watch: LocalWatch, serverDue: boolean, serverNow: number): void {
    if (serverDue) this.serverAnswers.expire(`${watch.op.name}:${JSON.stringify(watch.args)}`, serverNow);
  }

  // @ref LLP 3000.023#10 — membership scope removal bypasses observation capacity.
  withdrawScopes(watches: Iterable<LocalWatch>, page: { watermark: number; events?: { kind?: string; table?: string; data?: unknown }[] }, published: boolean, offline?: Refusal): () => void {
    const lost: ScopeLoss[] = (page.events ?? []).flatMap(event => event.kind === "scope" && event.table && Array.isArray(event.data)
      ? [{ table: event.table, data: event.data, watermark: page.watermark }] : []);
    if (lost.length) this.evidence();
    this.serverAnswers.withdraw(lost);
    if (!published) for (const loss of lost) {
      const prior = this.scopeCuts.find(cut => cut.table === loss.table && JSON.stringify(cut.data) === JSON.stringify(loss.data));
      if (prior) prior.watermark = Math.max(prior.watermark, loss.watermark); else this.scopeCuts.push(loss);
    }
    const affected: LocalWatch[] = [];
    const approvals = deferReadNotifications(() => { for (const watch of watches) {
      if (!lost.some(loss => overlapsScope(watch.tables, watch.scopes, loss))) continue;
      this.changed(watch, page.watermark);
      if (!published) watch.scopeCut = Math.max(watch.scopeCut ?? 0, page.watermark);
      watch.waitingForSync = true;
      watch.reset({ loading: true }, false, "membership-removal");
      if (!published && offline) watch.publish({ denied: offline });
      affected.push(watch);
    } });
    return () => { approvals(); for (const watch of affected) notifyLocalWatch(watch); };
  }

  refuse(watches: Iterable<LocalWatch>, denied: Refusal): void {
    this.evidence();
    this.serverAnswers.clear();
    const all = [...watches];
    const deliver = deferReadNotifications(() => { for (const watch of all) {
      this.changed(watch);
      watch.reset({ denied });
      if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
      watch.expiryTimer = null;
    } });
    deliver(); for (const watch of all) notifyLocalWatch(watch);
  }

  // @ref LLP 3000.023#3.1 — ordinary commits mark revalidation; queue service starts a new bounded episode.
  committed(watches: Iterable<LocalWatch>, operation: string, touched?: readonly string[]): void {
    this.clear(watches, !["apply", "admit", "settle"].includes(operation), touched, operation);
  }

  clear(watches: Iterable<LocalWatch>, reset = true, touched?: readonly string[], cause = "store-or-schema-reset"): void {
    this.revision++; this.evidence();
    if (reset) { this.scopeCuts = []; this.notifiedCuts.clear(); }
    this.predictions = null;
    this.serverAnswers.clear(reset ? undefined : touched);
    for (const watch of watches) {
      if (reset) { delete watch.scopeCut; delete watch.changeCut; delete watch.waitingForSync; }
      if (reset) watch.reset({ loading: true }, false, cause); else watch.reload(true, { queued: true });
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
