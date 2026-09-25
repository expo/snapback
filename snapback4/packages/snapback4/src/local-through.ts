// @ref LLP 3000.014#5 — a fallback replaces current pages, preserving delivered history.
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export function hasRetainedRows(value: unknown): boolean {
  if (value === true) return true;
  if (Array.isArray(value)) return value.some(hasRetainedRows);
  return object(value) && Object.values(value).some(hasRetainedRows);
}
// Only the envelope can establish row identity. In particular, a projection
// can rename or replace `id`, and two source tables can share the same id.
const identity = (mask: unknown): string | undefined => {
  const source = object(mask) ? mask.source : undefined;
  return Array.isArray(source) && source.length === 2 && source.every(part => typeof part === "string") ? JSON.stringify(source) : undefined;
};
const uniqueSources = (masks: unknown[]): Map<string, number> => {
  const positions = new Map<string, number>();
  masks.forEach((mask, index) => {
    const source = identity(mask);
    if (source !== undefined) positions.set(source, positions.has(source) ? -1 : index);
  });
  return new Map([...positions].filter(([, index]) => index !== -1));
};
const sourcesIn = (mask: unknown, sources = new Set<string>()): Set<string> => {
  if (Array.isArray(mask)) mask.forEach(child => sourcesIn(child, sources));
  else if (object(mask)) {
    const source = identity(mask);
    if (source !== undefined) sources.add(source);
    if (object(mask.fields)) Object.values(mask.fields).forEach(child => sourcesIn(child, sources));
  }
  return sources;
};
const omitted = Symbol("no retained projection");
// Anonymous leftovers cannot identify a current row. Keep only retained rows
// and the containers leading to them, excluding sources the server returned.
// A retained row keeps its own scalar/JSON fields; nested source rows decide
// retention independently, so they cannot reintroduce a stale current image.
function retainedProjection(value: unknown, mask: unknown, sources: Set<string>, retained = false): unknown {
  if (Array.isArray(value) && Array.isArray(mask)) {
    const items = value.map((child, index) => retainedProjection(child, mask[index], sources, retained)).filter(child => child !== omitted);
    return retained || items.length ? items : omitted;
  }
  if (object(value) && object(mask) && object(mask.fields)) {
    const source = identity(mask);
    if (source !== undefined && sources.has(source)) return omitted;
    retained = mask.retained === true || (source === undefined && retained);
    const fields = mask.fields;
    const entries = Object.entries(value).flatMap(([key, child]) => {
      const projected = retainedProjection(child, fields[key], sources, retained);
      return projected === omitted ? [] : [[key, projected]];
    });
    return retained || entries.length ? Object.fromEntries(entries) : omitted;
  }
  return retained ? value : omitted;
}
export function keepRetainedRows(current: unknown, local: unknown, mask: unknown, currentMask?: unknown): unknown {
  if (!hasRetainedRows(mask)) return current;
  if (Array.isArray(current) && Array.isArray(local)) {
    if (!Array.isArray(mask) || !Array.isArray(currentMask) || mask.length !== local.length || currentMask.length !== current.length) return local;
    // Missing or repeated sources leave only those elements unpaired. Known
    // siblings still refresh; no position or projected field supplies identity.
    const locals = uniqueSources(mask), servers = uniqueSources(currentMask);
    const pairs = new Map<number, number>();
    const pairedLocals = new Set<number>();
    let serverSources: Set<string> | undefined;
    for (const [source, index] of servers) {
      const paired = locals.get(source);
      if (paired !== undefined) { pairs.set(index, paired); pairedLocals.add(paired); }
    }
    return [
      ...current.map((value, index) => {
        const paired = pairs.get(index);
        return paired === undefined ? value : keepRetainedRows(value, local[paired], mask[paired], currentMask[index]);
      }),
      ...local.flatMap((value, index) => {
        if (pairedLocals.has(index) || !hasRetainedRows(mask[index])) return [];
        if (identity(mask[index]) !== undefined) return [value];
        const projected = retainedProjection(value, mask[index], serverSources ??= sourcesIn(currentMask));
        return projected === omitted ? [] : [projected];
      }),
    ];
  }
  if (object(current) && object(local) && object(mask) && object(currentMask)) {
    const source = identity(mask);
    if (source !== identity(currentMask) || !object(mask.fields) || !object(currentMask.fields)) return local;
    const fields = mask.fields, serverFields = currentMask.fields;
    const result = { ...current };
    for (const [field, value] of Object.entries(local)) {
      if (hasRetainedRows(fields[field])) result[field] = field in current ? keepRetainedRows(current[field], value, fields[field], serverFields[field]) : value;
    }
    return result;
  }
  return local;
}
