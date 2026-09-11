// @ref LLP 1012#4-the-range-store — normalize JSON values before splitting metadata across the atomic carrier projection.
// @ref LLP 1012#indexed-held-search — row sequence/negative guards persist as individual records in the existing metadata store.
import type { ChangedRecords } from './swap-journal.js';
export type MetaEntry = { key: string; value: unknown };
const main = new Set(['rows', 'answers', 'outbox']);
const arrayLengthLimit = 2 ** 32 - 1;
const own = (target: Record<string,unknown>, key: string, value: unknown): void => {
  if (key === '__proto__') Object.defineProperty(target,key,{ value,enumerable:true,writable:true,configurable:true });
  else target[key] = value;
};
const rootValue = (value: unknown): unknown => value && typeof value === 'object' ? Array.isArray(value) ? [] : {} : value;
export function metadata(state: object): MetaEntry[] { return projectMetadata(state)!.put; }
export function metadataChanges(state: object, changed: ChangedRecords, owned: MetadataKeys): { put: MetaEntry[]; remove: string[] } | undefined {
  return projectMetadata(state, changed, owned);
}
function jsonValue(value: unknown, key: string, arrayItem = false): { present: boolean; value: unknown } {
  const holder: Record<string,unknown> = {}; own(holder,key,value);
  const copy = JSON.parse(JSON.stringify(holder));
  return Object.hasOwn(copy,key) ? { present:true,value:copy[key] } : { present:arrayItem,value:null };
}
function arrayIndex(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}
function projectMetadata(state: object, changed?: ChangedRecords, owned?: MetadataKeys): { put: MetaEntry[]; remove: string[] } | undefined {
  const put: MetaEntry[] = [], removed = new Set<string>(), projected = new Set<string>();
  const add = (key: string, value: unknown) => {
    if (projected.has(key)) return;
    projected.add(key); put.push({ key,value });
  };
  const roots = new Set([...changed?.get('*') ?? []].filter(field => !main.has(field)));
  if (!changed || !owned?.has('state')) add('state',{});
  const fields = changed
    ? new Set([...roots,...[...changed.keys()].filter(field => field !== '*' && !main.has(field))])
    : new Set(Object.keys(state).filter(field => !main.has(field)));
  for (const field of fields) {
    const root = !changed || roots.has(field);
    const normalized = root ? jsonValue((state as Record<string,unknown>)[field],field) : undefined;
    const value = normalized ? normalized.present ? normalized.value : undefined : (state as Record<string,unknown>)[field];
    if (root) {
      const id = JSON.stringify([field]);
      if (normalized!.present) add(id,rootValue(value));
      else removed.add(id);
    }
    if (value && typeof value === 'object') {
      const array = Array.isArray(value);
      const keys = root ? Object.keys(value) : changed!.get(field) ?? [];
      if (array && root) add(JSON.stringify([field,'length']),value.length);
      // An index write can grow an array without a root journal entry. Refreshing
      // the split length child also lets a shrink remove only formerly owned keys.
      if (array && changed && !root && [...keys].some(key => key === 'length' || arrayIndex(key,value.length))) {
        add(JSON.stringify([field,'length']),value.length);
      }
      for (const key of keys) {
        const id = JSON.stringify([field,key]);
        if (array && key === 'length') {
          for (const prior of owned?.root(field) ?? []) {
            const item = prior.startsWith('[') ? JSON.parse(prior)[1] : undefined;
            if (typeof item === 'string' && arrayIndex(item,arrayLengthLimit) && Number(item) >= value.length) removed.add(prior);
          }
          continue;
        }
        if (!Object.hasOwn(value,key) || (array && !arrayIndex(key,value.length))) { removed.add(id); continue; }
        const item = root ? { present:true,value:(value as Record<string,unknown>)[key] }
          : jsonValue((value as Record<string,unknown>)[key],key,array);
        if (item.present) add(id,item.value); else removed.add(id);
      }
    }
    if (root && changed) for (const id of owned?.root(field) ?? []) if (id !== 'state' && !projected.has(id)) removed.add(id);
  }
  return { put, remove:[...removed] };
}
export function restoreMetadata(entries: MetaEntry[]): Record<string, any> {
  const result = structuredClone(entries.find(e => e.key === 'state')?.value ?? {}) as Record<string, any>;
  for (const { key,value } of entries) {
    if (key === 'state') continue;
    if (!key.startsWith('[')) own(result,key,value);
    else {
      const parts = JSON.parse(key);
      if (parts.length === 1) own(result,parts[0],rootValue(value));
    }
  }
  for (const { key, value } of entries) {
    if (key.startsWith('[')) {
      const parts = JSON.parse(key);
      if (parts.length !== 2) continue;
      const [field,item] = parts;
      let parent = Object.hasOwn(result,field) ? result[field] : undefined;
      if (!parent || typeof parent !== 'object') { parent = {}; own(result,field,parent); }
      if (Array.isArray(parent)) {
        if (item === 'length') { parent.length = value as number; continue; }
        if (!arrayIndex(item,arrayLengthLimit)) continue;
      }
      own(parent as Record<string,unknown>,item,value);
    }
  }
  // A length-only growth has no child records for its new holes.
  for (const value of Object.values(result)) if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value,index)) value[index] = null;
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
