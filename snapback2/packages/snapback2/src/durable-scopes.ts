// @ref LLP 1018.008.007.002#10-receipt-groups-and-the-full-application-client —
// the durable catalogue preserves term-independent scope authority and overflow.
import { heldScopeLayout, validateHeldDescriptor } from '../../evaluator/src/held-directory.js';
import { components } from '../../evaluator/src/index-store.js';
import { readQueryAuthority } from '../../evaluator/src/query.js';
import { sha256 } from '../../evaluator/src/hash.js';
import { canonicalJson, clone, fieldOrNull, variant, wireJson } from '../../evaluator/src/value-runtime.js';
import type { QueryDirectory, QueryHost } from '../../evaluator/src/query-work.js';
import type { Context, Value } from '../../evaluator/src/types.js';
import type { DirectoryChange, DirectoryRecord, DurableRowsTx } from './durable-rows.js';
import { indexPrefix, prefixRange, scalarFromKey, scalarKey, stringFromKey } from './durable-key.js';

type Status = 'allowed' | 'unknown' | 'denied';
interface Probe { table: string; index: string; key: any[] }
interface Descriptor {
  id: string; value: any; fixed: number[]; permutation: number[]; probes: Probe[];
}
interface Scope {
  table: string; index: string; values: Value[]; key: IDBValidKey[]; identity: string;
}
interface ScopeRecord {
  scopeKey: IDBValidKey[];
  binding: string;
  count: number;
  representative: string;
  statuses: Array<[descriptor: string, status: Status]>;
  selectionKeys: IDBValidKey[][];
  dependencyKeys: IDBValidKey[][];
}
const BINDING = 'durableScopeBinding';
function fail(message: string): never { throw new TypeError(`durable scopes: ${message}`); }
const indexId = (table: string, index: string) => canonicalJson([table, index]);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

function probes(rule: any): Probe[] {
  const [kind, data] = variant(rule);
  if (kind === 'Exists') return [data];
  if (kind === 'And' || kind === 'Or') return data.flatMap(probes);
  if (kind === 'Not') return probes(data);
  return [];
}

/** Construct once per carrier transaction. Program metadata is small; scopes,
 * row bodies, and posting lists are never loaded wholesale into this object. */
export class DurableScopes {
  private readonly descriptors = new Map<string, Descriptor>();
  private readonly byIndex = new Map<string, Descriptor[]>();
  private readonly probeIndexes = new Set<string>();
  private readonly probeTables = new Set<string>();
  private readonly context: Context;
  private readonly binding: string;
  private refreshing = false;
  constructor(readonly tx: DurableRowsTx, context: Context) {
    this.context = clone(context);
    const visit = (value: any): void => {
      if (!value || typeof value !== 'object') return;
      if (value.held_search) {
        const descriptor = validateHeldDescriptor(tx.program.schema, value), id = sha256(canonicalJson(descriptor));
        if (!this.descriptors.has(id)) {
          const item: Descriptor = { id, value: descriptor, ...heldScopeLayout(descriptor),
            probes: probes((tx.program.schema as any).tables[descriptor.table].rules.read) };
          this.descriptors.set(id, item);
          const key = indexId(descriptor.table, descriptor.index), entries = this.byIndex.get(key) ?? [];
          entries.push(item); this.byIndex.set(key, entries);
          for (const probe of item.probes) {
            this.probeIndexes.add(indexId(probe.table, probe.index)); this.probeTables.add(probe.table);
          }
        }
      }
      for (const child of Object.values(value)) visit(child);
    };
    for (const operation of Object.values(tx.program.programs)) visit(operation.ir);
    for (const entries of this.byIndex.values()) entries.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    this.binding = canonicalJson([tx.program.generation, tx.program.schemaHash, context.viewer,
      context.auth_epoch, [...this.descriptors.keys()].sort()]);
  }

  /** A changed partition/program must rebuild its catalogue explicitly, not
   * turn old authority into an apparently empty search result. */
  private async checkBinding(initial?: ReadonlyMap<string, number>): Promise<void> {
    const old = await this.tx.getMeta(BINDING);
    if (old === this.binding) return;
    if (old !== undefined || await this.tx.request(this.tx.idb.objectStore('scopes').count()))
      fail('catalogue identity changed or its binding is absent');
    for (const [key, entries] of this.byIndex) {
      const descriptor = entries[0].value;
      const held = await this.tx.request(this.tx.idb.objectStore('directory').index('scopeKeys')
        .count(prefixRange(indexPrefix(descriptor.table, descriptor.index, []))));
      if (held !== (initial?.get(key) ?? 0)) fail('held rows have no initialized scope catalogue');
    }
    if (initial) await this.tx.putMeta(BINDING, this.binding);
  }
  private scope(key: IDBValidKey[]): Scope {
    if (!Array.isArray(key) || key.length < 2) fail('invalid physical scope key');
    const table = stringFromKey(key[0]), index = stringFromKey(key[1]);
    const parts = components(this.tx.program.schema, table, index), derived = parts.findIndex(part => 'WordPrefixes' in part);
    if (derived < 0 || key.length !== derived + 2) fail('physical scope does not match its derived index');
    const values = key.slice(2).map(scalarFromKey);
    return { table, index, values, key: indexPrefix(table, index, values.map(Scalar => ({ Scalar }))),
      identity: canonicalJson([table, index, values]) };
  }
  private selection(descriptor: Descriptor, status: Status, scope: Value[]): IDBValidKey[] {
    return [descriptor.id, this.context.viewer, this.context.auth_epoch, status,
      ...descriptor.permutation.map(i => scalarKey(scope[i]))];
  }
  private dependency(digest: string): IDBValidKey[] { return [this.context.viewer, this.context.auth_epoch, digest]; }
  private checked(value: any): { record: ScopeRecord; scope: Scope } {
    if (!value || typeof value !== 'object' || value.binding !== this.binding || !Number.isSafeInteger(value.count)
      || value.count <= 0 || typeof value.representative !== 'string' || !Array.isArray(value.statuses)
      || !Array.isArray(value.selectionKeys) || !Array.isArray(value.dependencyKeys)) fail('invalid catalogue record');
    const scope = this.scope(value.scopeKey), descriptors = this.byIndex.get(indexId(scope.table, scope.index)) ?? [];
    if (value.statuses.length !== descriptors.length) fail('catalogue descriptors changed');
    const expected: IDBValidKey[][] = [];
    for (let i = 0; i < descriptors.length; i++) {
      const status = value.statuses[i];
      if (!Array.isArray(status) || status.length !== 2 || status[0] !== descriptors[i].id
        || !['allowed', 'unknown', 'denied'].includes(status[1])) fail('invalid catalogue authority');
      if (status[1] !== 'denied') expected.push(this.selection(descriptors[i], status[1], scope.values));
    }
    if (expected.length !== value.selectionKeys.length
      || expected.some((key, i) => indexedDB.cmp(key, value.selectionKeys[i]) !== 0)) fail('catalogue selection keys disagree');
    for (const key of value.dependencyKeys) if (!Array.isArray(key) || key.length !== 3
      || key[0] !== this.context.viewer || key[1] !== this.context.auth_epoch || !digest(key[2])) fail('invalid authority dependency');
    return { record: value, scope };
  }

  directory(value: any): QueryDirectory | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const descriptor = this.descriptors.get(sha256(canonicalJson(value)));
    if (!descriptor) return undefined;
    return { fixed: descriptor.fixed, select: (values, limit) => this.select(descriptor, values, limit) };
  }
  private async select(descriptor: Descriptor, values: Value[], limit: number): Promise<{
    scopes: Value[][]; overflow: boolean; missing: boolean;
  }> {
    if (values.length !== descriptor.fixed.length || !Number.isSafeInteger(limit) || limit < 0) fail('invalid scope selection bound');
    const fixed = values.map(scalarKey);
    await this.checkBinding();
    const index = this.tx.idb.objectStore('scopes').index('selectionKeys');
    const prefix = (status: Status): IDBValidKey[] => [descriptor.id, this.context.viewer, this.context.auth_epoch, status, ...fixed];
    // Unknown wins even if its scope would fall beyond the allowed limit.
    const unknown = await this.tx.request(index.get(prefixRange(prefix('unknown'))));
    if (unknown !== undefined) {
      const { record } = this.checked(unknown);
      if (!record.statuses.some(([id, status]) => id === descriptor.id && status === 'unknown')) fail('unknown index disagrees');
      return { scopes: [], overflow: false, missing: true };
    }
    const request = index.openCursor(prefixRange(prefix('allowed')));
    let pending = this.tx.request(request);
    const scopes: Value[][] = [];
    while (scopes.length <= limit) {
      const cursor = await pending;
      if (!cursor) break;
      const { record, scope } = this.checked(cursor.value);
      if (indexedDB.cmp(cursor.primaryKey, scope.key) !== 0
        || !record.statuses.some(([id, status]) => id === descriptor.id && status === 'allowed')) fail('allowed index disagrees');
      scopes.push(scope.values);
      if (scopes.length > limit) break;
      pending = this.tx.request(request); cursor.continue();
    }
    return { scopes: scopes.slice(0, limit), overflow: scopes.length > limit, missing: false };
  }

  /** Read only the ordinary point keys that a declared scope rule depends on. */
  private changedDigests(record: DirectoryRecord, digests: Set<string>): void {
    if (!this.probeTables.has(record.table)) return;
    for (const key of record.keys) {
      const table = stringFromKey(key[0]), index = stringFromKey(key[1]);
      if (!this.probeIndexes.has(indexId(table, index))) continue;
      const parts = components(this.tx.program.schema, table, index);
      if (table !== record.table || parts.some(part => !('Column' in part)) || key.length !== parts.length + 3)
        fail('invalid authority point key');
      digests.add(sha256(canonicalJson([table, index, key.slice(2, parts.length + 2).map(scalarFromKey).map(wireJson)])));
    }
  }
  private probeDigest(probe: Probe, row: Value): string {
    const keys = probe.key.map(term => {
      const [kind, data] = variant(term);
      if (kind === 'Viewer') return { Id: this.context.viewer } as Value;
      if (kind === 'Field') return fieldOrNull(row, data);
      if (kind === 'Literal') return data as Value;
      return fail('invalid read-rule dependency term');
    });
    return sha256(canonicalJson([probe.table, probe.index, keys.map(wireJson)]));
  }

  /** Call after putRows and proof replacement. host must observe those new facts
   * in this same transaction. Removed verdicts/absences need their old digests. */
  async refresh(changes: readonly DirectoryChange[], host: QueryHost, authorityDigests: Iterable<string> = []): Promise<void> {
    if (this.tx.idb.mode !== 'readwrite' || this.refreshing) fail('refresh requires one serial write transaction');
    this.refreshing = true;
    try {
      const pending = new Map<string, Scope>(), digests = new Set(authorityDigests);
      for (const value of digests) if (!digest(value)) fail('invalid changed authority digest');
      const add = (key: IDBValidKey[]): void => {
        const scope = this.scope(key);
        if (this.byIndex.has(indexId(scope.table, scope.index))) pending.set(scope.identity, scope);
      };
      const changedRows = new Map<string, DirectoryRecord>();
      for (const change of changes) {
        changedRows.set(canonicalJson([change.after.table, change.after.id]), change.after);
        for (const record of [change.before, change.after]) if (record) {
          for (const key of record.scopeKeys) add(key);
          this.changedDigests(record, digests);
        }
      }
      // Initial binding may cover only a complete set of newly indexed rows;
      // a missing catalogue over pre-existing rows is never silently repaired.
      const initialCounts = new Map<string, number>();
      for (const row of changedRows.values()) for (const key of row.scopeKeys) {
        const scope = this.scope(key), id = indexId(scope.table, scope.index);
        initialCounts.set(id, (initialCounts.get(id) ?? 0) + 1);
      }
      await this.checkBinding(initialCounts);
      const store = this.tx.idb.objectStore('scopes'), index = store.index('dependencyKeys');
      // Collect identities before changing their dependency index entries.
      for (const value of digests) {
        const request = index.openKeyCursor(IDBKeyRange.only(this.dependency(value)));
        let next = this.tx.request(request);
        for (;;) {
          const cursor = await next;
          if (!cursor) break;
          add(cursor.primaryKey as IDBValidKey[]);
          next = this.tx.request(request); cursor.continue();
        }
      }
      for (const scope of pending.values()) await this.refreshScope(scope, host);
    } catch (error) { try { this.tx.idb.abort(); } catch {} throw error; }
    finally { this.refreshing = false; }
  }
  private async refreshScope(scope: Scope, host: QueryHost): Promise<void> {
    const index = this.tx.idb.objectStore('directory').index('scopeKeys'), store = this.tx.idb.objectStore('scopes');
    const [count, representative] = await Promise.all([
      this.tx.request(index.count(IDBKeyRange.only(scope.key))),
      this.tx.request(index.get(scope.key)) as Promise<DirectoryRecord | undefined>,
    ]);
    if (!count) {
      if (representative !== undefined) fail('scope count and representative disagree');
      await this.tx.request(store.delete(scope.key)); return;
    }
    if (!representative || representative.table !== scope.table) fail('scope representative is missing');
    const row = await this.tx.row(representative);
    if (!row) fail('scope representative was deleted');
    const record: ScopeRecord = { scopeKey: scope.key, binding: this.binding, count, representative: representative.id,
      statuses: [], selectionKeys: [], dependencyKeys: [] };
    const dependencies = new Set<string>();
    for (const descriptor of this.byIndex.get(indexId(scope.table, scope.index)) ?? []) {
      const result = await readQueryAuthority(host, this.tx.program.schema, this.context, scope.table, row);
      const status: Status = result === true ? 'allowed' : result === null ? 'unknown' : 'denied';
      record.statuses.push([descriptor.id, status]);
      if (status !== 'denied') record.selectionKeys.push(this.selection(descriptor, status, scope.values));
      for (const probe of descriptor.probes) dependencies.add(this.probeDigest(probe, row));
    }
    record.dependencyKeys = [...dependencies].map(value => this.dependency(value));
    await this.tx.request(store.put(record, scope.key));
  }
}
