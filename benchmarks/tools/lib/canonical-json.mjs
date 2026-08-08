import { createHash } from 'node:crypto';

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(sortValue(value))}\n`;
}

export function recordDigest(record) {
  const unsigned = structuredClone(record);
  delete unsigned.recordDigest;
  return `sha256:${createHash('sha256').update(canonicalJson(unsigned)).digest('hex')}`;
}
