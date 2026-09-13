// @ref LLP 1018.008.007.002#10-receipt-groups-and-the-full-application-client —
// bounded protocol admission is shared by the client scheduler and its row carrier.
import { RowImage } from '../../evaluator/src/row-image.js';
import { canonicalJson, wireJson } from '../../evaluator/src/value-runtime.js';
import { decodeCursorFor } from '../../evaluator/src/cursor.js';
import type { ClosureReceipt } from '../../evaluator/src/types.js';
import { prepareReceipt, type DeliveryReceipt } from './offline-protocol.js';
import { onceColumns } from './store/asset-policy.js';
import type { HeldProgram } from './store/range-store.js';
import type { NativeCommit, NativePacket, NativeRow, NativeState } from './native-custody.js';

interface Page {
  after: string | null; cursor: string | null; next: string | null; exhausted: boolean;
  events: Array<{ id: string; row: string; disposition: 'present' | 'unavailable' | 'removed' }>;
  receipt: DeliveryReceipt;
}
export interface Acquisition {
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

/** Pure admission: no publication, network, authentication, or query scheduling. */
export function decodeNativeAcquisition(value: unknown, held: {
  state: NativeState; program: HeldProgram; authorityReceipt?: Omit<ClosureReceipt, 'rows'>;
}, log: string, content: string, after: string | null, packets: NativePacket[]): {
  change: NativeCommit; error?: unknown;
} {
    const { state, program } = held, raw = value as Acquisition;
    if (!raw || raw.protocol !== 1 || raw.generation !== state.generation || raw.schemaHash !== state.schemaHash
      || raw.authority?.principal !== state.principal || raw.authority.authEpoch !== state.authEpoch || raw.log !== log || raw.content !== content
      || !uint(raw.seq) || raw.seq < state.seq || !Number.isSafeInteger(raw.readTime) || typeof raw.more !== 'boolean'
      || !Array.isArray(raw.rows) || !Array.isArray(raw.pages) || raw.pages.length > 8 || !Array.isArray(raw.receipts)
      || raw.receipts.length > packets.length) fail('native acquisition identity or bound mismatch');
    const rows: NativeRow[] = [], pool = new Map<string, Record<string, unknown>>();
    const once = onceColumns(program.schema);
    for (const entry of raw.rows) {
      if (typeof entry.table !== 'string' || typeof entry.id !== 'string' || !entry.row || entry.row.id !== entry.id) fail('invalid native row');
      const id = rowKey(entry.table, entry.id);
      if (pool.has(id)) fail('duplicate native row');
      const row = RowImage.fromWire(program.schema, entry.table, entry.row, fail, state.schemaHash);
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
    const coverage: NativeCommit['coverage'] = [];
    const oldProof = held.authorityReceipt ?? emptyReceipt();
    const verdicts = new Map(oldProof.verdicts.map(v => [canonicalJson([v.rule_hash, v.pinned_inputs_digest, v.principal, v.auth_epoch]), v]));
    let position = after, acquired = state.logs[log]?.acquired ?? 0, exhausted = false;
    const boundary = (token: string | null): [number, string] | null => token === null ? null : wireJson(decodeCursorFor(token,
      { table: log, index: 'byRecipient', order: 'Asc', suffix: [{ name: 'seq', kind: 'Int' }, { name: 'id', kind: 'Id' }] }, program.schema)) as [number, string];
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
      const receipt = prepareReceipt(program.schema, { ranges: [], absences: [], verdicts: page.receipt.verdicts });
      for (const verdict of receipt.verdicts) {
        if (verdict.principal !== state.principal || verdict.auth_epoch !== state.authEpoch) fail('native authority has wrong principal');
        verdicts.set(canonicalJson([verdict.rule_hash, verdict.pinned_inputs_digest, verdict.principal, verdict.auth_epoch]), verdict);
      }
      // Presence is earned by this page's committed body, never by cursor progress.
      if (events.length && program.schema.tables?.[content]?.deliver?.receipts)
        next.packets.push({ id: `native:${++next.serial}`, log, events });
      coverage.push({ log, recipient: state.principal, after: position, cursor: page.cursor, exhausted: page.exhausted });
      position = page.cursor; exhausted = page.exhausted; acquired += page.events.length;
    }
    if (!raw.pages.length && !raw.receipts.length && !raw.error) fail('native acquisition made no bounded progress');
    if (raw.pages.length) next.logs[log] = { cursor: position, exhausted, acquired };
    const proof = { receipt: { schema_hash: state.schemaHash, ranges: [], absences: [], verdicts: [...verdicts.values()] } };
    return { change: { state: next, rows, coverage, proofs: { 'native-authority': proof } }, error: raw.error };
}
