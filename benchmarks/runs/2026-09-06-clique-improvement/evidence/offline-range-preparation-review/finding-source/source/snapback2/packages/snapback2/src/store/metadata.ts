// @ref LLP 1012#indexed-held-search — row sequence/negative guards persist as individual records in the existing metadata store.
import type { ChangedRecords } from './swap-journal.js';
export type MetaEntry = { key: string; value: unknown };
const main = new Set(['rows', 'answers', 'outbox']);
export function metadata(state: object): MetaEntry[] { return projectMetadata(state)!.put; }
export function metadataChanges(state: object, changed: ChangedRecords, owned: MetadataKeys): { put: MetaEntry[]; remove: string[] } | undefined {
  return projectMetadata(state, changed, owned);
}
function projectMetadata(state: object, changed?: ChangedRecords, owned?: MetadataKeys): { put: MetaEntry[]; remove: string[] } | undefined {
  const put: MetaEntry[] = [], remove: string[] = [], header: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(state)) {
    if (main.has(field)) continue;
    if (value && typeof value === 'object') {
      header[field] = Array.isArray(value) ? [] : {};
      for (const key of changed && !changed.get('*')?.has(field) ? changed.get(field) ?? [] : Object.keys(value)) {
        const id = JSON.stringify([field, key]);
        if (Object.hasOwn(value, key)) put.push({ key: id, value: value[key] }); else remove.push(id);
      }
    } else header[field] = value;
  }
  for (const field of changed?.get('*') ?? []) if (!main.has(field)) {
    const value = (state as Record<string,unknown>)[field];
    for (const id of owned?.root(field) ?? []) {
      const key = id.startsWith('[') ? JSON.parse(id)[1] : undefined;
      if (!value || typeof value !== 'object' || key === undefined || !Object.hasOwn(value,key)) remove.push(id);
    }
  }
  if (!changed || changed.get('*')?.size) put.unshift({ key: 'state', value: header });
  return { put, remove };
}
export function restoreMetadata(entries: MetaEntry[]): Record<string, any> {
  const result = structuredClone(entries.find(e => e.key === 'state')?.value ?? {}) as Record<string, any>;
  for (const { key, value } of entries) {
    if (key === 'state') continue;
    if (key.startsWith('[')) { const [field, item] = JSON.parse(key); (result[field] ??= {})[item] = value; }
    else result[key] = value;
  }
  return result;
}

/** Committed metadata key ownership, without a second flat Set or payload baseline. */
export class MetadataKeys {
  private roots = new Map<string,Set<string>>();
  constructor(keys: Iterable<string> = []) { for (const key of keys) this.add(key); }
  private owner(key: string): string { return key.startsWith('[') ? JSON.parse(key)[0] : key; }
  root(name: string): Iterable<string> { return this.roots.get(name) ?? []; }
  has(key: string): boolean { return this.roots.get(this.owner(key))?.has(key) ?? false; }
  add(key: string): void {
    const name = this.owner(key), keys = this.roots.get(name) ?? new Set<string>();
    keys.add(key); this.roots.set(name,keys);
  }
  delete(key: string): void {
    const name = this.owner(key), keys = this.roots.get(name);
    keys?.delete(key); if (!keys?.size) this.roots.delete(name);
  }
  *[Symbol.iterator](): IterableIterator<string> { for (const keys of this.roots.values()) yield* keys; }
}
