// @ref LLP 1012#indexed-held-search — durable deltas maintain one immutable effective row pool and its indexes.
import { ClientStore } from '../../evaluator/src/store.js';
import { Ordered } from '../../evaluator/src/ordered.js';
import { prepareRange } from '../../evaluator/src/coverage.js';
import { logicalKey } from '../../evaluator/src/index-store.js';
import { sha256 } from '../../evaluator/src/hash.js';
import { canonicalJson, validateIdentity, wireJson } from '../../evaluator/src/value-runtime.js';
import { schemaDigest } from './offline-schema.js';
import { closureFromAnswer } from './twin-hydrate.js';
import { tagWireRow, type WireValue } from './offline-protocol.js';
import { onceAssetIds, onceColumns, RowAssets } from './store/asset-policy.js';
import type { Context } from '../../evaluator/src/types.js';
import type { HeldProgram, PersistedRangeState, StoredAnswer, StoredRow, OutboxEntry, OverlayRow } from './store/range-store.js';
import type { StoreChange, StoreRevision } from './store/swap-journal.js';

const rowKey = (r: { table: string; id: string }) => `${r.table}\0${r.id}`;
const ref = (key: string) => { const i = key.indexOf('\0'); return { table: key.slice(0, i), id: key.slice(i + 1) }; };
type Contribution = { entry: OutboxEntry; row: OverlayRow };
const fifo = (a: OutboxEntry, b: OutboxEntry) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt) || a.intent.localeCompare(b.intent);

export interface TwinStoreSources {
  program(): HeldProgram | undefined;
  changes(since?: StoreRevision): Promise<StoreChange<PersistedRangeState>>;
  principal(): string | undefined;
  now(): number;
}

export class TwinStore {
  store!: ClientStore;
  program!: HeldProgram;
  revision?: StoreRevision;
  /** Cursor revisions advance for local semantic changes, never server cursor or retirement watermarks. */
  rowsRevision = 0;
  authorityRevision = 0;
  overlayRevision = 0;
  readonly evicted = new Set<string>();
  readonly holed = new Set<string>();
  private assets = new RowAssets({});
  get onceAssets(): Set<string> { return this.assets.once; }
  private state!: PersistedRangeState;
  incarnation = 0;
  private effective = new Map<string, StoredRow>();
  private answerReceipts = new Map<string, string>();
  private fence = '';
  private contributions = new Map<string, Map<string, Contribution>>();
  private intentRows = new Map<string, Set<string>>();
  private pending = new Ordered<OutboxEntry, string>(fifo);
  private pendingEntries = new Map<string, OutboxEntry>();
  private holes = new Map<string, number>();
  private answerHoles = new Map<string, string[]>();
  private deliveries = new Ordered<[number, string], number>((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  private answerTimes = new Map<string, number>();
  constructor(private sources: TwinStoreSources) {}
  get facts() { return this.state.facts; }
  get deliveredAt(): number | undefined { return this.deliveries.seek(() => 0, true).next().value?.[1]; }
  get predicted(): string[] { return [...this.pending.seek(() => 0)].map(r => r[1]); }

  async sync(): Promise<boolean> {
    const program = this.sources.program(), principal = this.sources.principal();
    if (!program || principal === undefined) return false;
    validateIdentity(principal);
    let change = await this.sources.changes(this.revision);
    const facts = (change.snapshot?.facts ?? (change.records?.['*']?.facts as any) ?? this.state?.facts);
    const fence = JSON.stringify([principal, program.generation, program.schemaHash, facts?.authEpoch]);
    if (!change.snapshot && (fence !== this.fence || program !== this.program)) change = await this.sources.changes();
    if (change.snapshot) {
      this.state = change.snapshot;
      if (this.state.sealed || this.state.superseded || (this.state.facts &&
        (this.state.facts.generation !== program.generation || this.state.facts.schemaHash !== program.schemaHash))) return false;
      if (schemaDigest(program.schema) !== program.schemaHash) throw new TypeError('held schema identity mismatch');
      this.program = program; this.fence = fence; this.incarnation++; this.effective.clear(); this.answerReceipts.clear();
      this.contributions.clear(); this.intentRows.clear(); this.pendingEntries.clear(); this.pending = new Ordered(fifo);
      this.assets = new RowAssets(onceColumns(program.schema)); this.evicted.clear(); this.holed.clear(); this.holes.clear(); this.answerHoles.clear();
      this.deliveries = new Ordered((a, b) => a[0] - b[0] || a[1].localeCompare(b[1])); this.answerTimes.clear();
      this.store = new ClientStore(program.schema, undefined, { readable: Object.entries(program.schema.tables ?? {})
        .filter(([, t]) => t.retain === 'delivered-history').map(([name]) => name) });
      const affected = new Set([...Object.keys(this.state.rows), ...Object.keys(this.state.negative), ...Object.keys(this.state.extentNegative), ...Object.keys(this.state.viewed)]);
      for (const intent of Object.keys(this.state.overlay)) this.intent(intent, affected);
      for (const key of affected) this.row(key);
      for (const [key, answer] of Object.entries(this.state.answers)) this.answer(key, answer);
      this.store.registerHeld(program.programs, this.context());
      this.rowsRevision = this.authorityRevision = this.overlayRevision = 0;
    } else if (change.revision !== this.revision?.revision) {
      const rows = new Set<string>(), answers = new Set<string>(), intents = new Set<string>();
      const changed = new Set<string>();
      for (const category of new Set([...Object.keys(change.records ?? {}), ...Object.keys(change.removed ?? {})])) {
        changed.add(category);
        const target = category === '*' ? this.state : (this.state as any)[category];
        for (const key of new Set([...Object.keys(change.records?.[category] ?? {}), ...(change.removed?.[category] ?? [])])) {
          if (Object.hasOwn(change.records?.[category] ?? {}, key)) target[key] = change.records![category][key]; else delete target[key];
          if (['rows', 'negative', 'extentNegative', 'rowSeq', 'viewed'].includes(category)) rows.add(key);
          if (category === 'answers') answers.add(key);
          if (category === 'outbox' || category === 'overlay') intents.add(key);
        }
      }
      if (this.state.sealed || this.state.superseded) { this.revision = undefined; return false; }
      // Replaced root dictionaries mean a generation reset; request one coherent cold snapshot.
      if (Object.keys(change.records?.['*'] ?? {}).some(k => ['rows', 'answers', 'negative', 'extentNegative', 'overlay', 'viewed', 'facts'].includes(k))
        || change.removed?.['*']?.includes('facts')) { this.revision = undefined; return this.sync(); }
      for (const intent of intents) this.intent(intent, rows);
      let rowChanged = false, authorityChanged = false;
      for (const key of rows) rowChanged = this.row(key) || rowChanged;
      for (const key of answers) authorityChanged = this.answer(key, this.state.answers[key]) || authorityChanged;
      if (rowChanged) this.rowsRevision++;
      if (rowChanged || authorityChanged || changed.has('negative') || changed.has('extentNegative') || changed.has('viewed')) this.authorityRevision++;
      if (rowChanged && intents.size) this.overlayRevision++;
    }
    this.revision = { incarnation: change.incarnation, revision: change.revision };
    return true;
  }
  private context(): Context { return { viewer: this.sources.principal()!, principal_kind: 'user', auth_epoch: this.facts?.authEpoch ?? 0,
    args: {}, now: null, new_ids: [], read_time: null }; }
  private intent(intent: string, affected: Set<string>): void {
    for (const key of this.intentRows.get(intent) ?? []) {
      this.contributions.get(key)?.delete(intent); affected.add(key);
      if (!this.contributions.get(key)?.size) this.contributions.delete(key);
    }
    const previous = this.pendingEntries.get(intent);
    if (previous) this.pending.delete(previous);
    this.pendingEntries.delete(intent); this.intentRows.delete(intent);
    const entry = this.state.outbox[intent], overlay = this.state.overlay[intent];
    if (!entry || !overlay || entry.state === 'rejected' || entry.state === 'expired') return;
    const keys = new Set<string>();
    for (const row of overlay) {
      const key = rowKey(row), contributions = this.contributions.get(key) ?? new Map();
      contributions.set(intent, { entry, row }); this.contributions.set(key, contributions); keys.add(key); affected.add(key);
    }
    this.intentRows.set(intent, keys); this.pendingEntries.set(intent, entry); this.pending.set(entry, intent);
  }
  private row(key: string): boolean {
    const { table, id } = ref(key), negative = this.state.negative[key], base = this.state.rows[key];
    const hole = this.state.extentNegative[key];
    const masked = hole !== undefined && (hole.active || !base);
    if (negative === undefined && !masked) this.evicted.delete(key); else this.evicted.add(key);
    let effective = base && !masked && (negative === undefined || (this.state.rowSeq[key] ?? -1) > negative) ? base : undefined;
    // Only the affected row's FIFO journal is replayed. Each contribution records assignments, not an earlier intent's image.
    const contributions = [...(this.contributions.get(key)?.values() ?? [])].sort((a, b) => fifo(a.entry, b.entry));
    for (const { entry, row } of contributions) {
      if (hole !== undefined && (masked || entry.issuedSeq <= hole.seq)) continue;
      if (negative !== undefined && (!base || (this.state.rowSeq[key] ?? -1) <= negative || entry.issuedSeq <= negative)) continue;
      if (row.removed) effective = undefined;
      else if (row.fields) {
        if (effective) effective = { table, id, row: { ...effective.row, ...Object.fromEntries(row.fields.map(f => [f, row.row[f]])) } };
      } else effective = row;
    }
    const viewed = this.state.viewed[key], columns = this.state.onceColumns ?? onceColumns(this.program.schema);
    if (viewed && (!effective || !(columns[table]?.length) || (() => {
      const assets = onceAssetIds(columns, [effective!]); return assets.size > 0 && [...assets].every(id => viewed.assets.includes(id));
    })())) effective = undefined;
    const prior = this.effective.get(key);
    const changed = canonicalJson(prior?.row ?? null) !== canonicalJson(effective?.row ?? null);
    if (effective) this.effective.set(key, effective); else this.effective.delete(key);
    // Explicit negative/view-once authority is independent of answer membership and overlay settlement.
    this.store.setReceipt(`negative:${key}`, (!effective && (negative !== undefined || viewed)) ? {
      schema_hash: this.program.schemaHash, rows: [], ranges: [], absences: [[table, 'byId', [{ Id: id }]]], verdicts: [],
    } : undefined);
    if (!changed) return false;
    this.assets.set(key, effective);
    if (effective) {
      this.store.put(table, tagWireRow(this.program.schema, table, effective.row as Record<string, WireValue>));
    } else this.store.remove(table, id);
    return changed;
  }
  private answer(key: string, answer?: StoredAnswer): boolean {
    const previous = this.answerTimes.get(key);
    if (previous !== undefined) this.deliveries.delete([previous, key]);
    if (answer) { this.deliveries.set([answer.deliveredAt, key], answer.deliveredAt); this.answerTimes.set(key, answer.deliveredAt); }
    else this.answerTimes.delete(key);
    const operation = answer && this.program.programs[answer.op];
    const derived = answer?.receipt?.ranges.some(range => range.prefix.some(atom => atom !== null && typeof atom === 'object' && 'WordPrefix' in atom));
    const receipt = answer && (!derived || operation) && closureFromAnswer(answer, this.program.schema, this.program.schemaHash, operation?.ir, k => this.state.rows[k]);
    const meaning = receipt && sha256(canonicalJson({ ...receipt, ranges: receipt.ranges.map(range => ({ ...range,
      prefix: logicalKey(prepareRange(this.program.schema, range, operation?.ir)),
    })) }));
    if (meaning === this.answerReceipts.get(key)) return false;
    if (meaning) this.answerReceipts.set(key, meaning); else this.answerReceipts.delete(key);
    for (const table of this.answerHoles.get(key) ?? []) {
      const n = (this.holes.get(table) ?? 1) - 1;
      if (n) this.holes.set(table, n); else { this.holes.delete(table); this.holed.delete(table); }
    }
    this.answerHoles.delete(key);
    if (!answer || !receipt) { this.store.setReceipt(key); return true; }
    const holes = [...new Set((answer.receipt?.ranges ?? []).filter(r => r.evictedIds?.length).map(r => r.table))];
    this.answerHoles.set(key, holes);
    for (const table of holes) { this.holes.set(table, (this.holes.get(table) ?? 0) + 1); this.holed.add(table); }
    this.store.setReceipt(key, receipt, operation?.ir);
    return true;
  }
}
