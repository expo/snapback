// @ref LLP 1019#native-acquisition-restart — generated logs earn durable native receipt packets, not product intents.
import { NativeCustody, nativeIndexedDB, type NativeDisk, type NativePacket, type NativeRow, type NativeState } from './native-custody.js';
import { decodeHeldProgram } from './held-program.js';
import { RowImage } from '../../evaluator/src/row-image.js';
import { sha256 } from '../../evaluator/src/hash.js';
import { canonicalJson, wireJson } from '../../evaluator/src/value-runtime.js';
import { queryState } from '../../evaluator/src/runner.js';
import { SearchExecution } from '../../evaluator/src/search-runtime.js';
import { decodeCursorFor } from '../../evaluator/src/cursor.js';
import { EvalError } from '../../evaluator/src/errors.js';
import { cursorArgument, isLocalCursor, localBinding, decodeLocalCursor, encodeLocalCursor, StaleLocalPage, serverArguments, type LocalFence } from './local-cursor.js';
import { tagArguments } from './twin-hydrate.js';
import { decodeDeliveryEnvelope, expandRows, prepareClosureReceipt, prepareReceipt, type DeliveryReceipt } from './offline-protocol.js';
import { wireAuthMe, wireManifest, RefusalError, wireRefusal } from './client-wire.js';
import type { HeldProgram } from './store/range-store.js';
import type { ClosureReceipt } from '../../evaluator/src/types.js';
import { onceColumns } from './store/asset-policy.js';

export interface NativeAcquisitionOptions {
  url: string; token: string; principal: string; offline?: boolean; databasePrefix?: string;
  /** Carrier injection for executable atomicity/restart witnesses. */
  disk?: (name: string) => Promise<NativeDisk>;
  fetch?: typeof fetch;
}
export interface NativeAcquisitionStatus {
  principal: string; seq: number; pending: number; rejected: number; acquired: number; exhausted: boolean;
}
interface Page {
  after: string | null; cursor: string | null; next: string | null; exhausted: boolean;
  events: Array<{ id: string; row: string; disposition: 'present' | 'unavailable' | 'removed' }>;
  receipt: DeliveryReceipt;
}
interface Acquisition {
  protocol: 1; generation: string; schemaHash: string; authority: { principal: string; authEpoch: number };
  log: string; content: string; seq: number; readTime: number;
  rows: Array<{ table: string; id: string; row: Record<string, unknown> }>;
  pages: Page[]; receipts: Array<{ id: string; state: 'complete' | 'rejected'; seq: number; code?: string }>;
  more: boolean;
  error?: unknown;
}
function fail(message: string): never { throw new TypeError(message); }
const rowKey = (table: string, id: string) => JSON.stringify([table, id]);
const uint = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const cursor = (value: unknown): value is string | null => value === null || typeof value === 'string';
const emptyReceipt = (): Omit<ClosureReceipt, 'rows'> => ({ ranges: [], absences: [], verdicts: [] });
function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Experimental complete acquisition path. Product intent replay remains a separate, unmodified client surface. */
export class NativeAcquisitionClient {
  private custody?: NativeCustody;
  private tail: Promise<unknown> = Promise.resolve();
  private initialization?: Promise<void>;
  private offline: boolean;
  private closed = false;
  private readonly abort = new AbortController();
  private release?: () => void;
  private releaseDone?: Promise<unknown>;
  private selectedLog?: string;
  private poisoned = false;
  private readonly incarnation = crypto.randomUUID();
  constructor(private readonly options: NativeAcquisitionOptions) { this.offline = options.offline ?? false; }
  private current(): NativeCustody {
    if (this.closed || this.poisoned || !this.custody || this.custody.state.sealed) fail('native client is not readable');
    return this.custody;
  }
  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = this.tail.then(run); this.tail = next.catch(() => undefined); return next;
  }
  initialize(): Promise<void> { return this.initialization ??= this.open(); }
  private async open(): Promise<void> {
    const principal = this.options.principal;
    if (!principal) fail('native initialization requires its retained principal binding');
    const name = `${this.options.databasePrefix ?? 'snapback2-native'}:${encodeURIComponent(this.options.url)}:${principal}`;
    // One physical writer, held for this instance's lifetime. No hidden follower writes.
    if (!this.options.disk) {
      if (!globalThis.navigator?.locks) fail('native acquisition requires browser writer locks');
      const acquired = deferred(), released = deferred();
      this.release = () => released.resolve();
      this.releaseDone = navigator.locks.request(name, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock) { acquired.reject(Error('native partition already has a writer')); return; }
        acquired.resolve(); await released.promise;
      });
      await acquired.promise;
    }
    const disk = await (this.options.disk ?? nativeIndexedDB)(name);
    try {
      const held = await disk.load();
      const tokenHash = sha256(this.options.token);
      if (held.state && (held.state.principal !== principal || held.state.tokenHash !== tokenHash)) fail('native custody tokenHash/principal changed');
      if (held.state?.sealed) fail('native custody is sealed');
      let epoch = held.state?.authEpoch, program = held.program && decodeHeldProgram(held.program);
      if (!this.offline) {
        try {
          // The retained partition is locked before authentication: a terminal bootstrap
          // refusal seals it too, before any later offline instance can expose its rows.
          const session = wireAuthMe(await this.json('/api/auth/me'));
          if (principal !== session.viewer) fail('native principal differs from authenticated session');
          epoch = session.authEpoch;
          const manifest = wireManifest(await this.json('/api/manifest'));
          program = decodeHeldProgram(await this.json(`/api/program?generation=${encodeURIComponent(manifest.programGeneration)}`));
          if (!program || program.generation !== manifest.programGeneration) fail('native program custody is malformed');
        } catch (error) {
          if (error instanceof RefusalError && (error.status === 401 || error.status === 403) && held.state)
            await disk.commit({ state: { ...held.state, sealed: true }, pages: [], proofs: {} });
          throw error;
        }
      }
      if (!program || !uint(epoch)) fail('native offline program custody is absent');
      const state: NativeState = { principal, authEpoch: epoch, tokenHash,
        generation: program.generation, schemaHash: program.schemaHash, seq: 0, readTime: 0,
        serial: 0, sealed: false, logs: {}, packets: [] };
      const custody = new NativeCustody(program, state, disk); await custody.open(held);
      if (this.closed) fail('native initialization was closed');
      this.custody = custody;
      this.selectedLog = Object.keys(custody.state.logs)[0];
    } catch (error) { disk.close(); this.release?.(); throw error; }
  }
  get status(): NativeAcquisitionStatus {
    const held = this.current(), log = this.selectedLog && held.state.logs[this.selectedLog];
    return { principal: held.state.principal, seq: held.state.seq, pending: held.state.packets.filter(p => !p.rejected).length,
      rejected: held.state.packets.filter(p => p.rejected).length, acquired: log ? log.acquired : 0, exhausted: !!log && log.exhausted };
  }
  setOffline(offline = true): void { this.offline = offline; }
  async acquire(log: string, progress?: (status: NativeAcquisitionStatus) => void): Promise<NativeAcquisitionStatus> {
    await this.initialize();
    return this.serialize(async () => {
      this.selectedLog = log;
      const held = this.current();
      const declaration = Object.entries<any>(held.program.schema.tables ?? {}).find(([, table]) => table.deliver?.log === log);
      if (!declaration) fail('native acquisition requires a generated delivery log');
      if (this.offline) fail('native acquisition requires a connection');
      let fetched = false, pagesOnly = false;
      do {
        const state = this.current().state, after = state.logs[log]?.cursor ?? null;
        const packets = pagesOnly ? [] : state.packets.filter(p => p.log === log && !p.rejected).slice(0, 8);
        const response = await this.json('/api/acquire', { protocol: 1, generation: state.generation, schemaHash: state.schemaHash,
          authEpoch: state.authEpoch, log, after, receipts: packets.map(({ id, events }) => ({ id, events })), pages: 8 });
        await this.accept(response, log, declaration[0], after, packets);
        pagesOnly = (response as Acquisition).pages.length === 0;
        fetched = true;
        try { progress?.(this.status); } catch { /* observers cannot revoke committed custody */ }
        if (this.status.rejected) break;
      } while (!fetched || !this.status.exhausted || this.current().state.packets.some(p => p.log === log && !p.rejected));
      return this.status;
    });
  }
  private async accept(value: unknown, log: string, content: string, after: string | null, packets: NativePacket[]): Promise<void> {
    const held = this.current(), state = held.state, raw = value as Acquisition;
    if (!raw || raw.protocol !== 1 || raw.generation !== state.generation || raw.schemaHash !== state.schemaHash
      || raw.authority?.principal !== state.principal || raw.authority.authEpoch !== state.authEpoch || raw.log !== log || raw.content !== content
      || !uint(raw.seq) || raw.seq < state.seq || !Number.isSafeInteger(raw.readTime) || typeof raw.more !== 'boolean'
      || !Array.isArray(raw.rows) || !Array.isArray(raw.pages) || raw.pages.length > 8 || !Array.isArray(raw.receipts)
      || raw.receipts.length > packets.length) fail('native acquisition identity or bound mismatch');
    const rows: NativeRow[] = [], pool = new Map<string, Record<string, unknown>>();
    const once = onceColumns(held.program.schema);
    for (const entry of raw.rows) {
      if (typeof entry.table !== 'string' || typeof entry.id !== 'string' || !entry.row || entry.row.id !== entry.id) fail('invalid native row');
      const id = rowKey(entry.table, entry.id);
      if (pool.has(id)) fail('duplicate native row');
      const row = RowImage.fromWire(held.program.schema, entry.table, entry.row, fail, state.schemaHash);
      if ((once[entry.table] ?? []).some(column => entry.row[column] != null)) fail('native prototype does not acquire view-once media');
      pool.set(id, entry.row); rows.push({ table: entry.table, id: entry.id, row, seq: raw.seq });
    }
    const next = { ...state, seq: raw.seq, readTime: raw.readTime, logs: { ...state.logs }, packets: [...state.packets] };
    const seen = new Set<string>();
    for (const receipt of raw.receipts) {
      if (seen.has(receipt.id) || !packets.some(p => p.id === receipt.id) || !uint(receipt.seq) || receipt.seq > raw.seq
        || !['complete', 'rejected'].includes(receipt.state)) fail('invalid native receipt completion');
      seen.add(receipt.id);
      next.packets = next.packets.flatMap(p => p.id !== receipt.id ? [p] : receipt.state === 'complete' ? [] : [{ ...p, rejected: receipt.code ?? 'E_REQUIRE' }]);
    }
    const coverage: Parameters<NativeCustody['commit']>[0]['coverage'] = [];
    const oldProof = held.proof('native-authority')?.receipt ?? emptyReceipt();
    const verdicts = new Map(oldProof.verdicts.map(v => [canonicalJson([v.rule_hash, v.pinned_inputs_digest, v.principal, v.auth_epoch]), v]));
    let position = after, acquired = state.logs[log]?.acquired ?? 0, exhausted = false;
    const boundary = (token: string | null): [number, string] | null => token === null ? null : wireJson(decodeCursorFor(token,
      { table: log, index: 'byRecipient', order: 'Asc', suffix: [{ name: 'seq', kind: 'Int' }, { name: 'id', kind: 'Id' }] }, held.program.schema)) as [number, string];
    let previous = boundary(after);
    const eventIds = new Set<string>();
    for (let i = 0; i < raw.pages.length; i++) {
      const page = raw.pages[i];
      if (page.after !== position || !cursor(page.cursor) || !cursor(page.next) || typeof page.exhausted !== 'boolean'
        || page.next !== (page.exhausted ? null : page.cursor) || !Array.isArray(page.events) || page.events.length > 50
        || (page.exhausted && i + 1 !== raw.pages.length) || (!page.exhausted && page.cursor === position)) fail('invalid native page chain');
      const events: string[] = [];
      for (const event of page.events) {
        const row = pool.get(rowKey(log, event.id));
        if (!row || row.recipient !== state.principal || row.row !== event.row || eventIds.has(event.id)
          || !['present', 'unavailable', 'removed'].includes(event.disposition)) fail('invalid native event ownership');
        if (!uint(row.seq) || row.seq > raw.seq || previous && (row.seq < previous[0] || row.seq === previous[0] && event.id <= previous[1]))
          fail('native events must advance their recipient cursor');
        previous = [row.seq, event.id];
        eventIds.add(event.id);
        if (event.disposition === 'present') {
          if (row.kind === 'removed' || !pool.has(rowKey(content, event.row))) fail('receipt obligation has no disclosed body');
          events.push(event.id);
        } else if (event.disposition === 'removed') {
          if (row.kind !== 'removed' || pool.has(rowKey(content, event.row))) fail('invalid removal disposition');
          if (!rows.some(r => r.table === content && r.id === event.row)) rows.push({ table: content, id: event.row, row: null, seq: raw.seq });
        }
      }
      if (canonicalJson(boundary(page.cursor)) !== canonicalJson(previous)) fail('native cursor does not name its last durable event');
      if (!page.receipt || !Array.isArray(page.receipt.verdicts)) fail('invalid native rule evidence');
      // Native log coverage replaces its generic range/absence receipt terms.
      const receipt = prepareReceipt(held.program.schema, { ranges: [], absences: [], verdicts: page.receipt.verdicts });
      for (const verdict of receipt.verdicts) {
        if (verdict.principal !== state.principal || verdict.auth_epoch !== state.authEpoch) fail('native authority has wrong principal');
        verdicts.set(canonicalJson([verdict.rule_hash, verdict.pinned_inputs_digest, verdict.principal, verdict.auth_epoch]), verdict);
      }
      // Presence is earned by this page's committed body, never by cursor progress.
      if (events.length && held.program.schema.tables?.[content]?.deliver?.receipts)
        next.packets.push({ id: `native:${++next.serial}`, log, events });
      coverage.push({ log, recipient: state.principal, after: position, cursor: page.cursor, exhausted: page.exhausted });
      position = page.cursor; exhausted = page.exhausted; acquired += page.events.length;
    }
    if (!raw.pages.length && !raw.receipts.length && !raw.error) fail('native acquisition made no bounded progress');
    if (raw.pages.length) next.logs[log] = { cursor: position, exhausted, acquired };
    const proof = { receipt: { schema_hash: state.schemaHash, ranges: [], absences: [], verdicts: [...verdicts.values()] } };
    await this.publish({ state: next, rows, coverage, proofs: { 'native-authority': proof } });
    if (raw.error) throw new RefusalError(wireRefusal(raw.error, 'native acquisition suffix'));
  }
  private async publish(change: Parameters<NativeCustody['commit']>[0]): Promise<void> {
    try { await this.current().commit(change); }
    catch (error) { this.poisoned = true; throw error; }
  }
  async query(op: string, args: unknown): Promise<any> {
    await this.initialize();
    return this.serialize(async () => {
      const held = this.current(), operation = held.program.programs[op];
      if (!operation || operation.kind !== 'query') fail('native query requires an installed query');
      if (this.offline) return this.localQuery(op, args);
      args = serverArguments(args, (operation.ir as any).args);
      const envelope = decodeDeliveryEnvelope(await this.json('/api/query?receipt=1', { op, args }));
      const state = held.state;
      if (envelope.generation !== state.generation || envelope.schemaHash !== state.schemaHash || envelope.planHash !== operation.planHash
        || envelope.authority.principal !== state.principal || envelope.authority.authEpoch !== state.authEpoch || envelope.seq < state.seq)
        fail('native auxiliary query identity mismatch');
      const prepared = prepareClosureReceipt(envelope, held.program.schema, operation.ir), { rows, ...receipt } = prepared;
      const once = onceColumns(held.program.schema);
      if (envelope.rows.some(row => (once[row.table] ?? []).some(column => row.row[column] != null))) fail('native prototype does not acquire view-once media');
      const proofs: NonNullable<Parameters<NativeCustody['commit']>[0]['proofs']> = {};
      proofs[`query:${op}:${canonicalJson(args)}`] = { receipt, program: operation.ir };
      await this.publish({ state: { ...state, seq: envelope.seq, readTime: envelope.readTime ?? state.readTime },
        rows: rows.map(row => ({ ...row, row: row.row as RowImage, seq: envelope.seq })), proofs });
      return { state: envelope.state, data: expandRows(envelope), next: envelope.next, seq: envelope.seq, connection: 'connected' };
    });
  }
  private localQuery(op: string, args: unknown): any {
    const held = this.current(), operation = held.program.programs[op], ir = operation.ir as any;
    if (ir.read_time_granularity_ms != null) fail('native prototype timed queries require an owner clock refresh');
    const cursorName = cursorArgument(operation), searchWork = new SearchExecution(), binding = localBinding(operation, args, searchWork);
    const fence: LocalFence = { partition: held.state.principal, operation: op, program: operation.planHash,
      schema: held.state.schemaHash, generation: held.state.generation, incarnation: this.incarnation,
      revisions: [held.state.revision ?? 0], timed: false };
    const token = cursorName && (args as any)?.[cursorName];
    if (cursorName && isLocalCursor(token)) {
      try { args = { ...(args as any), [cursorName]: decodeLocalCursor(token, fence, binding,
        Object.values((operation.certificate as any).result_pages ?? {}), held.program.schema) }; }
      catch (error) { if (!(error instanceof StaleLocalPage)) throw error; args = { ...(args as any), [cursorName]: null }; }
    }
    const context = { viewer: held.state.principal, principal_kind: 'user', auth_epoch: held.state.authEpoch,
      args: tagArguments(ir.args, args, held.program.schema), now: Date.now(), read_time: null, new_ids: [] };
    try {
      const execution = held.rows.reexecute(ir, context, operation.certificate, searchWork), run = execution.execution;
      const page = run.page, suffix = page?.merge ? run.trace.merges.slice().reverse().find(m => m.site === page.site)?.last_returned_suffix
        : run.trace.ranges.slice().reverse().find(r => r.site === page?.site)?.lastReturnedSuffix;
      const next = cursorName && page && suffix && queryState(operation.certificate, run.trace, context.viewer) === 'capped'
        ? encodeLocalCursor(fence, binding, { table: page.table, index: page.index, order: page.order, suffix: page.suffix, values: suffix }) : null;
      const rangeSites = new Set(run.trace.ranges.map(range => range.site));
      const trustworthy = !execution.partialSites.some(site => !rangeSites.has(site))
        && !run.trace.absences.some(a => execution.partialSites.includes(a.site));
      const search = run.held || run.trace.ranges.some(r => r.prefix.some(p => 'WordPrefix' in p));
      const state = search && trustworthy && (run.held || execution.state !== 'fresh') ? 'held'
        : execution.state === 'fresh' ? queryState(operation.certificate, run.trace, context.viewer) : 'partial';
      return { state, data: execution.partialSites.includes('missing-authority') ? undefined : wireJson(run.result),
        next: trustworthy ? next : null, seq: held.state.seq, connection: 'offline', sites: execution.partialSites };
    } catch (error) {
      if (!(error instanceof EvalError)) throw error;
      return { state: error.partialSites?.length ? 'partial' : 'denied', connection: 'offline', seq: held.state.seq,
        sites: error.partialSites, reason: error.authoredCode ?? error.code };
    }
  }
  async settled(): Promise<{ remaining: number; rejected: number }> {
    await this.tail; const status = this.status; return { remaining: status.pending, rejected: status.rejected };
  }
  rows(table: string): Record<string, unknown>[] { return this.current().rows.rows(table).map(row => RowImage.wire(row as RowImage)); }
  async close(): Promise<void> {
    this.closed = true; this.abort.abort(); await this.initialization?.catch(() => undefined); await this.tail;
    this.custody?.close(); this.release?.(); await this.releaseDone;
  }
  private async json(path: string, body?: unknown): Promise<any> {
    if (this.closed || this.offline) fail('native transport is closed or offline');
    const response = await (this.options.fetch ?? fetch)(`${this.options.url}${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${this.options.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: this.abort.signal });
    if (this.closed) fail('native response arrived after close');
    const text = await response.text();
    if (path === '/api/acquire' && new TextEncoder().encode(text).byteLength > 1_048_576) fail('native response exceeds byte budget');
    const value = JSON.parse(text);
    if (!response.ok) {
      const error = new RefusalError(wireRefusal(value, 'native response'), response.status >= 500, response.status);
      if ((response.status === 401 || response.status === 403) && this.custody)
        await this.publish({ state: { ...this.custody.state, sealed: true }, rows: [] });
      throw error;
    }
    return value;
  }
}
