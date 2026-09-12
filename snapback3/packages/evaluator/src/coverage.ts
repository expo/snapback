// @ref LLP 1012#indexed-held-search — receipt identity is normalized meaning; a term never grants its source scope.
import { canonicalJson, clone, compareArrays, fieldOrNull, scopedRuleHash, wireJson } from './value-runtime';
import { components, logicalKey } from './index-store';
import { PreparedRange, rangeSchemaIdentity } from './range-preparation';
export { prepareRange } from './range-preparation';
import type { IndexAtom, LogicalIndexAtom } from './search-key';
import type { ClosureReceipt, ReceiptRange, TraceRange, Value, Verdict } from './types';
import { EvalError } from './errors';
import { CoverageSpans } from './coverage-spans';

type Range = { value: ReceiptRange; logical: LogicalIndexAtom[]; identity: string; group: string; expected: Map<string, Value[]>; lost: Set<string>; exact: boolean; last?: Value[] | null; extent?: [Value[] | null, Value[] | null] };
type Owner = { ranges: Range[]; absences: string[]; verdicts: [string, boolean][] };
type Group = { count: number; spans: CoverageSpans; summary: string };
const whole = (r: ReceiptRange): boolean => !r.evicted_ids?.length;
const boundsKey = (r: ReceiptRange | TraceRange): string => JSON.stringify([r.order, r.take, r.after, r.before, r.gt, r.gte, r.lt, r.lte, r.rule_hash]);
const pointKey = (table: string, index: string, key: Value[]): string => JSON.stringify([table, index, key]);
const verdictKey = (v: Verdict): string => JSON.stringify([v.rule_hash, v.pinned_inputs_digest, v.principal, v.auth_epoch]);
export class CoverageIndex {
  private readonly schemaIdentity: string;
  private owners = new Map<string, Owner>();
  private exact = new Map<string, [pages: number, exhausted: number]>();
  private groups = new Map<string, Group>();
  private complete = new Map<string, number>();
  private patterns = new Map<string, string[][]>();
  private absences = new Map<string, Set<string>>();
  private verdicts = new Map<string, [number, number]>();
  private rowRanges = new Map<string, Set<Range>>();
  constructor(private schema: any, private position: (range: ReceiptRange, logical: LogicalIndexAtom[], id: string) => Value[] | null) {
    this.schemaIdentity = rangeSchemaIdentity(schema);
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
  /** Issuing keys are consumed here: undefined selects the confirmed pool; null withholds the position. */
  set(owner: string, receipt: ClosureReceipt | undefined, program?: any,
    issuedKeys?: (table: string, index: string, id: string) => Value[] | null | undefined): Array<Pick<Owner, 'absences' | 'verdicts'> | undefined> {
    const verdicts = (receipt?.verdicts ?? []).map((v): [string, boolean] => {
      if (typeof v.result !== 'boolean') throw new EvalError('E_INPUT', 'verdict result must be boolean');
      return [verdictKey(v), v.result];
    });
    const pool = new Map(receipt?.rows.map(r => [JSON.stringify([r.table, r.id]), r.row]));
    // Prepare/validate all new proof before removing the previous owner.
    const ranges = (receipt?.ranges ?? []).map(incoming => {
      // Retain isolated proof metadata and typed keys, never the caller's row pool.
      const { value,prepared } = PreparedRange.tagged(this.schema,incoming,program,this.schemaIdentity);
      const logical = prepared.meaning.prefix, prefix = logicalKey(logical);
      const identity = JSON.stringify([value.site, value.table, value.index, prefix, boundsKey(value)]);
      const group = JSON.stringify([value.table, value.index, value.order, value.rule_hash, prefix]);
      const r: Range = { value, logical, identity, group, expected: new Map(), lost: new Set(), exact: false };
      const suffix = prepared.suffix, after = prepared.meaning.after, heldSuffix = value.held_suffix;
      for (const id of [...value.row_ids, ...(value.halo ? [value.halo.id] : [])]) {
        const row = pool.get(JSON.stringify([value.table, id]));
        const columns = prepared.columns;
        const issued = issuedKeys?.(value.table, value.index, id);
        const keys = issued === undefined ? row ? columns.map(c => fieldOrNull(row, (c as { Column: string }).Column)) : null : issued;
        if (keys) r.expected.set(id, clone(prepared.position(this.schema,keys)));
        else r.lost.add(id);
      }
      if (whole(value) && !r.lost.size && [value.before, value.gt, value.gte, value.lt, value.lte].every(v => v === null)) {
        const suffixOf = (keys: Value[]) => keys.slice(keys.length - suffix.length);
        const keys = r.expected.get(value.row_ids.at(-1)!);
        const end = heldSuffix ?? (keys && suffix.every(c => 'Column' in c) ? suffixOf(keys) : undefined);
        if (value.stop === 'Exhausted' || end) {
          r.extent = [after, value.stop === 'Exhausted' ? null : clone(end!)];
          r.last = null;
          for (const keys of r.expected.values()) {
            const position = suffixOf(keys);
            if (!r.last || compareArrays(position, r.last) * (value.order === 'Desc' ? -1 : 1) > 0) r.last = clone(position);
          }
        }
      }
      for (const id of [...value.row_ids, ...(value.halo ? [value.halo.id] : [])]) this.member(r, id);
      return r;
    });
    const absences = [...new Set((receipt?.absences ?? []).map(([table,index,values]) => {
      values.forEach(wireJson); // Authority invalidation must not discover malformed values after publication.
      return pointKey(table,index,values);
    }))];
    const old = this.owners.get(owner);
    if (old && receipt && canonicalJson([old.absences,old.verdicts]) === canonicalJson([absences,verdicts])
      && old.ranges.length === ranges.length && ranges.every((r,i) => {
        const prior = old.ranges[i];
        return prior.identity === r.identity && canonicalJson([{ ...prior.value,prefix: logicalKey(prior.logical) }, [...prior.expected], [...prior.lost], prior.extent, prior.last])
          === canonicalJson([{ ...r.value,prefix: logicalKey(r.logical) }, [...r.expected], [...r.lost], r.extent, r.last]);
      })) {
      // Equal proof keeps its indexed owner/counts, but adopts the current immutable parameters.
      for (let i = 0; i < ranges.length; i++) { old.ranges[i].value = ranges[i].value; old.ranges[i].logical = ranges[i].logical; }
      return [];
    }
    if (!old && !receipt) return [];
    if (old) {
      for (const r of old.ranges) this.range(r, -1);
      for (const key of old.absences) { const refs = this.absences.get(key)!; refs.delete(owner); if (!refs.size) this.absences.delete(key); }
      for (const [key, result] of old.verdicts) this.verdictCount(key, result, -1);
      this.owners.delete(owner);
    }
    if (!receipt) return [old];
    const held = { ranges, absences, verdicts };
    for (const r of ranges) this.range(r, 1);
    for (const key of absences) {
      const refs = this.absences.get(key) ?? new Set();
      refs.add(owner); this.absences.set(key, refs);
    }
    for (const [key, result] of verdicts) this.verdictCount(key, result, 1);
    this.owners.set(owner, held);
    // Reuse the owners' compact identities; immediate directory refresh must see final counts.
    return [old, held];
  }
  authorityOwners(): Iterable<Pick<Owner, 'absences' | 'verdicts'>> { return this.owners.values(); }
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
      if (delta > 0) { refs.add(r); this.rowRanges.set(key, refs); }
      else { refs.delete(r); if (!refs.size) this.rowRanges.delete(key); }
    }
    if (delta > 0) this.quality(r);
    else if (r.exact) this.exactCount(r, -1);
  }
  private member(r: Range, id: string): void {
    const expected = r.expected.get(id), current = this.position(r.value, r.logical, id);
    if (!expected || !current || compareArrays(expected, current)) r.lost.add(id); else r.lost.delete(id);
  }
  private quality(r: Range): void {
    const exact = whole(r.value) && (r.value.stop === 'Exhausted' || r.lost.size <= (r.value.halo ? 1 : 0));
    if (exact !== r.exact) this.exactCount(r, exact ? 1 : -1);
    r.exact = exact;
  }
  private exactCount(r: Range, delta: number): void {
    const counts: [number, number] = this.exact.get(r.identity) ?? [0, 0];
    counts[0] += delta; if (r.value.stop === 'Exhausted') counts[1] += delta;
    if (counts[0]) this.exact.set(r.identity, counts); else this.exact.delete(r.identity);
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
  private exactCounts(range: TraceRange, logical: LogicalIndexAtom[]): [number, number] | undefined {
    const identity = JSON.stringify([range.site, range.table, range.index, logicalKey(logical), boundsKey(range)]);
    return this.exact.get(identity);
  }
  // @ref LLP 1001#3-read-and-write-states-no-silent-states — exact page values do not establish exhaustion beyond a retained halo.
  stop(range: TraceRange, logical: LogicalIndexAtom[]): TraceRange['stop'] {
    const counts = this.exactCounts(range, logical);
    return range.stop === 'exhausted' && counts?.[0] && !counts[1]
      && !this.drained(range.table, range.index, logical, range.rule_hash) ? 'limit' : range.stop;
  }
  covers(range: TraceRange, logical: LogicalIndexAtom[]): boolean {
    if (this.exactCounts(range, logical)?.[range.stop === 'exhausted' ? 1 : 0]) return true;
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
