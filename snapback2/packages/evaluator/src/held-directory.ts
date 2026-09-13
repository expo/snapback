// @ref LLP 1012#indexed-held-search — directory authority is independent of term postings and downloaded membership enumeration.
import { sha256 } from './hash';
import { Ordered } from './ordered';
import { compareArrays, fieldOrNull, canonicalJson, wireJson } from './value-runtime';
import { components, prefixCompare } from './index-store';
import { fail } from './errors';
import type { HeldIndex } from './index-store';
import type { Value } from './types';

export interface DirectoryEntry { scope: Value[]; rows: Set<Value>; key: Value[]; dependency?: string }

/** Both carriers admit the same compiler-provided held-search descriptor. */
export function validateHeldDescriptor(schema: any, merge: any): any {
  const d = merge.held_search, lane = merge.lanes?.[0];
  if (merge.lanes.length !== 1 || !lane.source || lane.setup?.length || lane.scan.before !== null || lane.scan.range !== null
    || d.table !== lane.scan.table || d.index !== lane.scan.index || d.order !== lane.scan.order
    || canonicalJson(d.discovery.scan) !== canonicalJson(lane.source) || d.discovery.binding !== lane.binding
    || canonicalJson(d.term) !== canonicalJson(lane.scan.prefix.at(-1)?.WordPrefix)) fail('E_TRACE_SUBSET', 'held search metadata does not match its merge');
  if (components(schema, d.table, d.index).findIndex(part => 'WordPrefixes' in part) !== d.scope.length || d.suffix.at(-1) !== 'id')
    fail('E_TRACE_SUBSET', 'invalid held search partition');
  return d;
}
export function heldScopeLayout(descriptor: any): { fixed: number[]; permutation: number[] } {
  const fixed = descriptor.scope.flatMap((s: any, i: number) => directDiscoveryField(s.value, descriptor.discovery.binding) ? [] : [i]);
  return { fixed, permutation: [...fixed, ...descriptor.scope.map((_: any, i: number) => i).filter((i: number) => !fixed.includes(i))] };
}
export class ReadableDirectory {
  private entries = new Map<string, DirectoryEntry>();
  private allowed = new Ordered<Value[], DirectoryEntry>(compareArrays);
  private unknown = new Ordered<Value[], DirectoryEntry>(compareArrays);
  private dependencies = new Map<string, Set<DirectoryEntry>>();
  private digests = new Map<string, Set<DirectoryEntry>>();
  readonly fixed: number[];
  private permutation: number[];
  constructor(readonly index: HeldIndex, readonly descriptor: any, private viewer: string, private check: (row: Value) => boolean | null) {
    const layout = heldScopeLayout(descriptor);
    this.fixed = layout.fixed; this.permutation = layout.permutation;
    for (const [scope] of index.scopes.seek(() => 0)) this.refresh(scope);
  }
  refresh(scope: Value[]): void {
    const id = canonicalJson(scope), old = this.entries.get(id);
    if (old) {
      this.allowed.delete(old.key); this.unknown.delete(old.key);
      if (old.dependency) { this.link(this.dependencies, old.dependency, old, false); this.link(this.digests, sha256(old.dependency), old, false); }
    }
    const rows = this.index.scopes.get(scope);
    if (!rows?.size) { this.entries.delete(id); return; }
    const row = rows.values().next().value!, key = this.permutation.map(i => scope[i]);
    const entry: DirectoryEntry = { scope, rows, key };
    const probe = this.index.schema.tables[this.index.table].rules.read?.Exists;
    if (probe) {
      const values = probe.key.map((t: any) => t === 'Viewer' ? { Id: this.viewer } : t.Field !== undefined ? fieldOrNull(row, t.Field) : t.Literal);
      entry.dependency = canonicalJson([probe.table, probe.index, values.map(wireJson)]);
      this.link(this.dependencies, entry.dependency, entry, true); this.link(this.digests, sha256(entry.dependency), entry, true);
    }
    this.entries.set(id, entry);
    const status = this.check(row);
    if (status === true) this.allowed.set(key, entry);
    else if (status === null) this.unknown.set(key, entry);
  }
  private link(map: Map<string, Set<DirectoryEntry>>, key: string, entry: DirectoryEntry, add: boolean): void {
    const refs = map.get(key) ?? new Set();
    if (add) { refs.add(entry); map.set(key, refs); }
    else { refs.delete(entry); if (!refs.size) map.delete(key); }
  }
  touch(dependency: string): void { for (const e of [...(this.dependencies.get(dependency) ?? [])]) this.refresh(e.scope); }
  /** Verdict inputs use a digest of the same point identity. */
  touchDigest(digest: string): void { for (const e of [...(this.digests.get(digest) ?? [])]) this.refresh(e.scope); }
  select(values: Value[], limit: number): { scopes: Value[][]; overflow: boolean; missing: boolean } {
    const compare = (key: Value[]) => prefixCompare(key, values);
    if (!this.unknown.seek(compare).next().done) return { scopes: [], overflow: false, missing: true };
    const scopes: Value[][] = [];
    for (const [, entry] of this.allowed.seek(compare)) { scopes.push(entry.scope); if (scopes.length > limit) break; }
    return { scopes: scopes.slice(0, limit), overflow: scopes.length > limit, missing: false };
  }
}
export function directDiscoveryField(expr: any, binding: string): string | undefined {
  const f = expr?.Field;
  // Field is the active expression's {base,name}, unlike RuleTerm.Field which is a column string.
  return f?.base?.Variable === binding ? f.name : undefined;
}
