// @ref LLP 1012#indexed-held-search — receipt identity is normalized meaning; a term never grants its source scope.
import { canonicalJson, compareArrays, fieldOrNull, scopedRuleHash } from './value-runtime';
import { components, logicalKey, preparePrefix } from './index-store';
import type { IndexAtom, LogicalIndexAtom } from './search-key';
import type { ClosureReceipt, ReceiptRange, TraceRange, Value, Verdict } from './types';
import { EvalError } from './errors';
import { SearchExecution } from './search-runtime';
import { CoverageSpans } from './coverage-spans';

type ScanSite = { table: string; index: string; bounds: (number | undefined)[]; shape: boolean[]; identity: string };
const sites = new WeakMap<object, Map<string, ScanSite>>();
const admissions = new WeakMap<object, SearchExecution>();
export function scanBounds(program: any): Map<string, ScanSite> {
  if (!program || typeof program !== 'object') return new Map();
  const cached = sites.get(program); if (cached) return cached;
  const result = new Map<string, ScanSite>();
  const visit = (value: any): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.prefix) && typeof value.site === 'string') {
      const site = { table: value.table, index: value.index,
        bounds: value.prefix.map((p: any) => p.WordPrefix?.source_max),
        shape: value.prefix.map((p: any) => Object.hasOwn(p, 'WordPrefix')),
        identity: canonicalJson(value) };
      const prior = result.get(value.site);
      if (prior && prior.identity !== site.identity) throw new EvalError('E_TRACE_SUBSET', 'ambiguous issuing scan site');
      result.set(value.site, site);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(program); sites.set(program, result); return result;
}
/** A delivered descriptor borrows Q only from its exact issuing scan and derived slot. */
export function prepareRange(schema: any, range: Pick<ReceiptRange, 'site' | 'table' | 'index' | 'prefix'>,
  program?: any, search?: SearchExecution): LogicalIndexAtom[] {
  const site = scanBounds(program).get(range.site);
  const derived = range.prefix.some(a => 'WordPrefix' in a);
  if (derived && (!site || (site.table !== range.table || site.index !== range.index
    || site.shape.length !== range.prefix.length || site.shape.some((word, i) => word !== ('WordPrefix' in range.prefix[i])))))
    throw new EvalError('E_INPUT', 'range does not match its trusted issuing scan');
  if (!search && program && typeof program === 'object') {
    search = admissions.get(program);
    if (!search) { search = new SearchExecution(() => {}, 64); admissions.set(program, search); }
  }
  return preparePrefix(schema, range.table, range.index, range.prefix, site?.bounds ?? [], search?.atom);
}
type Range = { value: ReceiptRange; logical: LogicalIndexAtom[]; identity: string; group: string; expected: Map<string, Value[]>; lost: Set<string>; exact: boolean; last?: Value[] | null; extent?: [Value[] | null, Value[] | null] };
type Group = { count: number; spans: CoverageSpans; summary: string };
const whole = (r: ReceiptRange): boolean => !r.evicted_ids?.length;
const boundsKey = (r: ReceiptRange | TraceRange): string => JSON.stringify([r.order, r.take, r.after, r.before, r.gt, r.gte, r.lt, r.lte, r.rule_hash]);
const pointKey = (table: string, index: string, key: Value[]): string => JSON.stringify([table, index, key]);
const verdictKey = (v: Verdict): string => JSON.stringify([v.rule_hash, v.pinned_inputs_digest, v.principal, v.auth_epoch]);
export class CoverageIndex {
  private owners = new Map<string, { ranges: Range[]; absences: string[]; verdicts: [string, boolean][] }>();
  private exact = new Map<string, number>();
  private groups = new Map<string, Group>();
  private complete = new Map<string, number>();
  private patterns = new Map<string, string[][]>();
  private absences = new Map<string, Set<string>>();
  private verdicts = new Map<string, [number, number]>();
  private rowRanges = new Map<string, Set<Range>>();
  constructor(private schema: any, private position: (range: ReceiptRange, logical: LogicalIndexAtom[], id: string) => Value[] | null) {
    for (const [table, definition] of Object.entries<any>(schema.tables)) {
      const patterns = new Map<string, string[]>();
      for (const index of Object.values<any>(definition.indexes)) {
        if (index.components.some((c: any) => !('Column' in c))) continue;
        for (let n = 0; n <= index.components.length; n++) {
          const names = index.components.slice(0, n).map((c: any) => c.Column);
          patterns.set(JSON.stringify(names), names);
        }
      }
      this.patterns.set(table, [...patterns.values()]);
    }
  }
  set(owner: string, receipt: ClosureReceipt | undefined, program?: any): void {
    const verdicts = (receipt?.verdicts ?? []).map((v): [string, boolean] => {
      if (typeof v.result !== 'boolean') throw new EvalError('E_INPUT', 'verdict result must be boolean');
      return [verdictKey(v), v.result];
    });
    const pool = new Map(receipt?.rows.map(r => [JSON.stringify([r.table, r.id]), r.row]));
    // Prepare/validate all new proof before removing the previous owner.
    const ranges = (receipt?.ranges ?? []).map(value => {
      const logical = prepareRange(this.schema, value, program), prefix = logicalKey(logical);
      const identity = JSON.stringify([value.site, value.table, value.index, prefix, boundsKey(value)]);
      const group = JSON.stringify([value.table, value.index, value.order, value.rule_hash, prefix]);
      const r: Range = { value, logical, identity, group, expected: new Map(), lost: new Set(), exact: false };
      const parts = components(this.schema, value.table, value.index);
      for (const id of [...value.row_ids, ...(value.halo ? [value.halo.id] : [])]) {
        const row = pool.get(JSON.stringify([value.table, id]));
        if (row) r.expected.set(id, parts.flatMap(c => 'Column' in c ? [fieldOrNull(row, c.Column)] : []));
        else r.lost.add(id);
      }
      if (whole(value) && !r.lost.size && [value.before, value.gt, value.gte, value.lt, value.lte].every(v => v === null)) {
        const tuple = (v: Value): Value[] => typeof v === 'object' && 'Array' in v ? v.Array : [v];
        const row = pool.get(JSON.stringify([value.table, value.row_ids.at(-1)]));
        const suffix = parts.slice(value.prefix.length);
        const end = value.held_suffix ?? (row && suffix.every(c => 'Column' in c) ? suffix.map(c => fieldOrNull(row, (c as { Column: string }).Column)) : undefined);
        if (value.stop === 'Exhausted' || end) {
          r.extent = [value.after === null ? null : tuple(value.after), value.stop === 'Exhausted' ? null : end!];
          r.last = null;
          for (const id of r.expected.keys()) {
            const fields = pool.get(JSON.stringify([value.table, id]))!;
            const position = suffix.flatMap(c => 'Column' in c ? [fieldOrNull(fields, c.Column)] : []);
            if (!r.last || compareArrays(position, r.last) * (value.order === 'Desc' ? -1 : 1) > 0) r.last = position;
          }
        }
      }
      return r;
    });
    const old = this.owners.get(owner);
    if (old) {
      for (const r of old.ranges) this.range(r, -1);
      for (const key of old.absences) { const refs = this.absences.get(key)!; refs.delete(owner); if (!refs.size) this.absences.delete(key); }
      for (const [key, result] of old.verdicts) this.verdictCount(key, result, -1);
      this.owners.delete(owner);
    }
    if (!receipt) return;
    const held = { ranges, absences: [] as string[], verdicts };
    for (const r of ranges) this.range(r, 1);
    for (const [table, index, values] of receipt.absences) {
      const key = pointKey(table, index, values), refs = this.absences.get(key) ?? new Set();
      refs.add(owner); this.absences.set(key, refs); held.absences.push(key);
    }
    for (const [key, result] of verdicts) this.verdictCount(key, result, 1);
    this.owners.set(owner, held);
  }
  private verdictCount(key: string, result: boolean, delta: number): void {
    const counts: [number, number] = this.verdicts.get(key) ?? [0, 0]; counts[Number(result)] += delta;
    if (counts[0] || counts[1]) this.verdicts.set(key, counts); else this.verdicts.delete(key);
  }
  private count(map: Map<string, number>, key: string, delta: number): void {
    const count = (map.get(key) ?? 0) + delta;
    if (count) map.set(key, count); else map.delete(key);
  }
  private range(r: Range, delta: 1 | -1): void {
    let group = this.groups.get(r.group);
    if (!group) {
      const v = r.value, columns = components(this.schema, v.table, v.index).slice(0, v.prefix.length).map(c => 'Column' in c ? c.Column : '');
      group = { count: 0, spans: new CoverageSpans(v.order === 'Desc'), summary: JSON.stringify([v.table, v.rule_hash, columns.some(c => !c) ? v.index : columns, logicalKey(r.logical)]) };
      this.groups.set(r.group, group);
    }
    if (group.spans.complete) this.count(this.complete, group.summary, -1);
    if (r.extent) group.spans.change(...r.extent, delta, r.last);
    if (group.spans.complete) this.count(this.complete, group.summary, 1);
    group.count += delta; if (!group.count) this.groups.delete(r.group);
    for (const id of [...r.value.row_ids, ...(r.value.halo ? [r.value.halo.id] : [])]) {
      const key = JSON.stringify([r.value.table, id]), refs = this.rowRanges.get(key) ?? new Set();
      if (delta > 0) { refs.add(r); this.rowRanges.set(key, refs); this.member(r, id); }
      else { refs.delete(r); if (!refs.size) this.rowRanges.delete(key); }
    }
    if (delta > 0) this.quality(r);
    else if (r.exact) this.count(this.exact, r.identity, -1);
  }
  private member(r: Range, id: string): void {
    const expected = r.expected.get(id), current = this.position(r.value, r.logical, id);
    if (!expected || !current || compareArrays(expected, current)) r.lost.add(id); else r.lost.delete(id);
  }
  private quality(r: Range): void {
    const exact = whole(r.value) && (r.value.stop === 'Exhausted' || r.lost.size <= (r.value.halo ? 1 : 0));
    if (exact !== r.exact) this.count(this.exact, r.identity, exact ? 1 : -1);
    r.exact = exact;
  }
  changed(table: string, id: string): void {
    for (const r of this.rowRanges.get(JSON.stringify([table, id])) ?? []) { this.member(r, id); this.quality(r); }
  }
  hasAbsence(table: string, index: string, key: Value[]): boolean { return !!this.absences.get(pointKey(table, index, key))?.size; }
  verdict(rule: string, digest: string, viewer: string, epoch: number): boolean | null {
    const counts = this.verdicts.get(JSON.stringify([rule, digest, viewer, epoch]));
    // Updates maintain disagreement; warm reads never traverse retained owners.
    return !counts || counts[0] && counts[1] ? null : counts[1] > 0;
  }
  covers(range: TraceRange, logical: LogicalIndexAtom[]): boolean {
    const identity = JSON.stringify([range.site, range.table, range.index, logicalKey(logical), boundsKey(range)]);
    if (this.exact.has(identity)) return true;
    return this.drained(range.table, range.index, logical, range.rule_hash);
  }
  drained(table: string, index: string, prefix: LogicalIndexAtom[], rule = scopedRuleHash(this.schema, this.schema.tables[table].rules.read)): boolean {
    const parts = components(this.schema, table, index);
    if (this.complete.has(JSON.stringify([table, rule, index, logicalKey(prefix)]))) return true;
    for (const columns of this.patterns.get(table) ?? []) {
      const values: LogicalIndexAtom[] = [];
      for (const column of columns) {
        const at = parts.findIndex(c => 'Column' in c && c.Column === column);
        if (at < 0 || at >= prefix.length) break;
        values.push(prefix[at]);
      }
      if (values.length === columns.length && this.complete.has(JSON.stringify([table, rule, columns, logicalKey(values)]))) return true;
    }
    return false;
  }
}
