// @ref LLP 1012#indexed-held-search — row sequence/negative guards persist as individual records in the existing metadata store.
import type { ChangedRecords } from './swap-journal.js';
export type MetaEntry = { key: string; value: unknown };
const main = new Set(['rows', 'answers', 'outbox']);
export function metadata(state: object): MetaEntry[] { return projectMetadata(state)!.put; }
export function metadataChanges(state: object, changed: ChangedRecords): { put: MetaEntry[]; remove: string[] } | undefined {
  return projectMetadata(state, changed);
}
function projectMetadata(state: object, changed?: ChangedRecords): { put: MetaEntry[]; remove: string[] } | undefined {
  const put: MetaEntry[] = [], remove: string[] = [], header: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(state)) {
    if (main.has(field)) continue;
    if (value && typeof value === 'object') {
      if (changed?.get('*')?.has(field)) return; // Replacing a dictionary resets that ownership domain.
      header[field] = Array.isArray(value) ? [] : {};
      for (const key of changed ? changed.get(field) ?? [] : Object.keys(value)) {
        const id = JSON.stringify([field, key]);
        if (Object.hasOwn(value, key)) put.push({ key: id, value: value[key] }); else remove.push(id);
      }
    } else header[field] = value;
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
