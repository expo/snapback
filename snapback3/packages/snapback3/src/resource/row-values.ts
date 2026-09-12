import { plainObject } from '../../../evaluator/src/value-runtime.js';

type RowRef = { table: string; id: string };

// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — application
// objects containing a reserved marker are escaped and expanded exactly once.
export function asRowRef(value: unknown): RowRef | undefined {
  if (!plainObject(value) || Object.keys(value).length !== 1 || !plainObject(value.$row)) return;
  const marker = value.$row;
  return Object.keys(marker).sort().join(',') === 'id,table'
    && typeof marker.table === 'string' && typeof marker.id === 'string'
    ? { table: marker.table, id: marker.id } : undefined;
}

export function escapedFields(value: unknown): Record<string, unknown> | undefined {
  if (!plainObject(value) || Object.keys(value).length !== 1 || !plainObject(value.$row)) return;
  return Object.keys(value.$row).length === 1 && plainObject(value.$row.$value)
    ? value.$row.$value : undefined;
}

export function mapRowValues(value: unknown, resolve: (ref: RowRef) => unknown): unknown {
  const ref = asRowRef(value);
  if (ref) return resolve(ref);
  if (Array.isArray(value)) return value.map(item => mapRowValues(item, resolve));
  if (!plainObject(value)) return value;
  return Object.fromEntries(Object.entries(escapedFields(value) ?? value)
    .map(([key, item]) => [key, mapRowValues(item, resolve)]));
}

export function rowReferences(value: unknown): Set<string> {
  const result = new Set<string>();
  const visit = (item: unknown): void => {
    const ref = asRowRef(item);
    if (ref) { result.add(JSON.stringify([ref.table, ref.id])); return; }
    if (Array.isArray(item)) { item.forEach(visit); return; }
    if (plainObject(item)) Object.values(escapedFields(item) ?? item).forEach(visit);
  };
  visit(value);
  return result;
}
