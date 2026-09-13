// @ref LLP 1018.008.007.002#10-receipt-groups-and-the-full-application-client —
// durable indexes preserve the Quarry value order, including nominal types.
import { RowImage } from '../../evaluator/src/row-image.js';
import { variant, asString, field } from '../../evaluator/src/value-runtime.js';
import { compareCodepoints } from '../../evaluator/src/hash.js';
import type { Value } from '../../evaluator/src/types.js';
import type { LogicalIndexAtom } from '../../evaluator/src/search-key.js';

/** IndexedDB compares binary keys bytewise; JS strings instead use UTF-16 order. */
export function scalarKey(value: Value): IDBValidKey {
  if (value === 'Null') return [0];
  const [kind, data] = variant(value);
  switch (kind) {
    case 'Bool': return [1, data ? 1 : 0];
    case 'Int': return [2, data];
    case 'String': return [3, codepoints(data)];
    case 'Id': return [4, codepoints(data)];
    case 'Bytes': return [5, codepoints(data)];
    case 'Row': case 'Map': {
      const names = Object.keys(data).sort(compareCodepoints);
      return [kind === 'Row' ? 6 : 8, names.length, names.map(name => [codepoints(name), scalarKey(data[name])])];
    }
    case 'Array': return [7, data.map(scalarKey)];
    default: throw new TypeError('durable index requires a Quarry value');
  }
}
function codepoints(value: string): ArrayBuffer {
  // Three bytes encode every Unicode scalar and preserve prefix/nominal order.
  // Encoding directly also preserves isolated surrogate order in diagnostic keys.
  const bytes = new Uint8Array([...value].length * 3);
  let at = 0;
  for (const scalar of value) {
    const n = scalar.codePointAt(0)!;
    bytes[at++] = n >>> 16; bytes[at++] = n >>> 8; bytes[at++] = n;
  }
  return bytes.buffer;
}
export function indexPrefix(table: string, index: string, prefix: readonly LogicalIndexAtom[]): IDBValidKey[] {
  return [codepoints(table), codepoints(index), ...prefix.map(atom => {
    if ('Scalar' in atom) return scalarKey(atom.Scalar);
    if (atom.WordPrefix.token === null) throw new TypeError('empty word prefix has no durable posting');
    return scalarKey({ String: atom.WordPrefix.token });
  })];
}
/** One directory record owns these keys; an IDB multiEntry index owns postings. */
export function directoryKeys(table: string, row: RowImage): IDBValidKey[][] {
  const keys: IDBValidKey[][] = [];
  for (const [index, parts] of Object.entries(RowImage.keys(row))) {
    const derived = parts.findIndex(part => 'Words' in part);
    const base = [codepoints(table), codepoints(index)];
    const tie = scalarKey({ Id: asString(field(row, 'id')) });
    if (derived < 0) keys.push([...base, ...parts.map(part => scalarKey((part as { Scalar: Value }).Scalar)), tie]);
    else {
      const prefixes = new Set<string>();
      for (const word of (parts[derived] as { Words: string[] }).Words) {
        let prefix = '';
        for (const scalar of word) { prefix += scalar; prefixes.add(prefix); }
      }
      for (const prefix of prefixes) keys.push([...base, ...parts.map((part, i) =>
        scalarKey(i === derived ? { String: prefix } : (part as { Scalar: Value }).Scalar)), tie]);
    }
  }
  return keys;
}


/** Scopes exist even when every source field has no searchable word. */
export function directoryScopeKeys(table: string, row: RowImage): IDBValidKey[][] {
  return Object.entries(RowImage.keys(row)).flatMap(([index, parts]) => {
    const derived = parts.findIndex(part => 'Words' in part);
    return derived < 0 ? [] : [[codepoints(table), codepoints(index), ...parts.slice(0, derived)
      .map(part => scalarKey((part as { Scalar: Value }).Scalar))]];
  });
}
export function scalarFromKey(key: IDBValidKey): Value {
  if (!Array.isArray(key) || typeof key[0] !== 'number') throw new TypeError('invalid durable scalar key');
  if (key[0] === 0 && key.length === 1) return 'Null';
  if ((key[0] === 6 || key[0] === 8) && key.length === 3 && Array.isArray(key[2]) && key[1] === key[2].length) {
    const entries: Array<[string, Value]> = [];
    for (const entry of key[2]) {
      if (!Array.isArray(entry) || entry.length !== 2) throw new TypeError('invalid durable object key');
      const name = stringFromKey(entry[0]);
      if (entries.length && compareCodepoints(entries.at(-1)![0], name) >= 0) throw new TypeError('invalid durable object order');
      entries.push([name, scalarFromKey(entry[1])]);
    }
    return { [key[0] === 6 ? 'Row' : 'Map']: Object.fromEntries(entries) } as Value;
  }
  if (key.length !== 2) throw new TypeError('invalid durable scalar key width');
  switch (key[0]) {
    case 1: if (key[1] === 0 || key[1] === 1) return { Bool: key[1] === 1 }; break;
    case 2: if (Number.isSafeInteger(key[1])) return { Int: key[1] as number }; break;
    case 3: return { String: stringFromKey(key[1]) };
    case 4: return { Id: stringFromKey(key[1]) };
    case 5: return { Bytes: stringFromKey(key[1]) };
    case 7: if (Array.isArray(key[1])) return { Array: key[1].map(scalarFromKey) }; break;
  }
  throw new TypeError('invalid durable scalar key value');
}
export function stringFromKey(key: IDBValidKey): string {
  const bytes = key instanceof ArrayBuffer ? new Uint8Array(key)
    : ArrayBuffer.isView(key) ? new Uint8Array(key.buffer, key.byteOffset, key.byteLength) : undefined;
  if (!bytes || bytes.length % 3) throw new TypeError('invalid durable text key');
  let text = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const scalar = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    if (scalar > 0x10ffff) throw new TypeError('invalid durable codepoint');
    text += String.fromCodePoint(scalar);
  }
  return text;
}
/** Every scalar key starts with a number, so this sorts beyond every scalar. */
export const KEY_END: IDBValidKey = [[]];
export function prefixRange(prefix: IDBValidKey[]): IDBKeyRange {
  return IDBKeyRange.bound(prefix, [...prefix, KEY_END], false, true);
}
