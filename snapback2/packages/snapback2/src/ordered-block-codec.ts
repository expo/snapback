// @ref LLP 1018.008.007.002#11-block-index-acquisition-restart — serialization
// compresses keys without defining their order; comparison retains IDB meaning.
export type BlockKey = { kind: number; value: number | string | Uint8Array | BlockKey[]; text: string };
export function bad(message: string): never { throw new TypeError(`ordered blocks: ${message}`); }
const dataError = (): never => { throw new DOMException('Invalid IndexedDB key', 'DataError'); };
function base64(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.length; at += 8192) text += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return btoa(text);
}
function binary(text: unknown): Uint8Array {
  if (typeof text !== 'string') bad('invalid binary encoding');
  let decoded: string;
  try { decoded = atob(text); } catch { return bad('invalid binary encoding'); }
  const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
  if (base64(bytes) !== text) bad('noncanonical binary encoding');
  return bytes;
}
function numberText(value: number): number | string { return value === Infinity ? '+' : value === -Infinity ? '-' : value === 0 ? 0 : value; }
function node(kind: number, value: BlockKey['value']): BlockKey {
  if (kind === 4) return { kind, value, text: `[4,[${(value as BlockKey[]).map(key => key.text).join(',')}]]` };
  const payload = kind === 0 ? numberText(value as number) : kind === 3 ? base64(value as Uint8Array)
    : value;
  return { kind, value, text: JSON.stringify([kind, payload]) };
}
/** The rank is IndexedDB's number, date, string, binary, array order. */
export function ownKey(input: IDBValidKey, memo = new WeakMap<object, BlockKey>()): BlockKey {
  const active = new Set<object>();
  const visit = (value: unknown): BlockKey => {
    if (value && typeof value === 'object') {
      if (active.has(value)) dataError();
      const known = memo.get(value); if (known) return known;
    }
    if (typeof value === 'number') { if (Number.isNaN(value)) dataError(); return node(0, value === 0 ? 0 : value); }
    if (value instanceof Date) {
      const time = Date.prototype.getTime.call(value); if (Number.isNaN(time)) dataError();
      const result = node(1, time); memo.set(value, result); return result;
    }
    if (typeof value === 'string') return node(2, value);
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      const buffer = value instanceof ArrayBuffer ? value : value.buffer;
      if (!(buffer instanceof ArrayBuffer)) dataError();
      try {
        const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(buffer, value.byteOffset, value.byteLength);
        const result = node(3, new Uint8Array(bytes)); memo.set(value, result); return result;
      } catch { return dataError(); }
    }
    if (Array.isArray(value)) {
      if (active.has(value)) dataError(); active.add(value);
      const items: BlockKey[] = [];
      for (let i = 0; i < value.length; i++) items.push(visit(value[i]));
      active.delete(value); const result = node(4, items); memo.set(value, result); return result;
    }
    return dataError();
  };
  return visit(input);
}
export function compareKeys(a: BlockKey, b: BlockKey): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.text === b.text) return 0;
  if (a.kind < 3) return (a.value as number | string) < (b.value as number | string) ? -1 : 1;
  const left = a.value as Uint8Array | BlockKey[], right = b.value as Uint8Array | BlockKey[];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const compared = a.kind === 3 ? (left[i] as number) - (right[i] as number) : compareKeys(left[i] as BlockKey, right[i] as BlockKey);
    if (compared) return compared < 0 ? -1 : 1;
  }
  return left.length < right.length ? -1 : 1;
}
export function nativeKey(key: BlockKey): IDBValidKey {
  if (key.kind === 1) return new Date(key.value as number);
  if (key.kind === 3) return new Uint8Array(key.value as Uint8Array).buffer;
  if (key.kind === 4) return (key.value as BlockKey[]).map(nativeKey);
  return key.value as number | string;
}
export function readKey(text: unknown): BlockKey {
  if (typeof text !== 'string') bad('invalid encoded key');
  const visit = (value: any): BlockKey => {
    if (!Array.isArray(value) || value.length !== 2) bad('invalid encoded key');
    const [kind, data] = value;
    if (kind === 0 && (typeof data === 'number' && Number.isFinite(data) || data === '+' || data === '-'))
      return node(0, data === '+' ? Infinity : data === '-' ? -Infinity : data);
    if (kind === 1 && typeof data === 'number' && Number.isFinite(data) && new Date(data).getTime() === data) return node(1, data);
    if (kind === 2 && typeof data === 'string') return node(2, data);
    if (kind === 3) return node(3, binary(data));
    if (kind === 4 && Array.isArray(data)) return node(4, data.map(visit));
    return bad('invalid encoded key');
  };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return bad('invalid encoded key JSON'); }
  const key = visit(parsed);
  if (key.text !== text) bad('noncanonical encoded key');
  return key;
}

// Values are exactly the finite JSON data carried by directory records and
// posting references. Build an owned graph before the first carrier await.
export function ownValue(value: unknown): string {
  const active = new Set<object>();
  const copy = (value: any): any => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || active.has(value)) bad('value must be finite JSON');
    active.add(value);
    if (Object.getOwnPropertySymbols(value).length) bad('value must have JSON property names');
    let result: any;
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) bad('value array must be dense JSON');
      result = [];
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(value, i)) bad('value array must be dense JSON');
        result.push(copy(value[i]));
      }
    } else {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) bad('value must be plain JSON');
      if (Object.getOwnPropertySymbols(value).length) bad('value must have JSON property names');
      result = Object.create(null);
      for (const key of Object.keys(value)) result[key] = copy(value[key]);
    }
    active.delete(value); return result;
  };
  return JSON.stringify(copy(value));
}
export function readValue(text: unknown): any {
  if (typeof text !== 'string') bad('invalid encoded value');
  let value: any;
  try { value = JSON.parse(text); } catch { return bad('invalid encoded value JSON'); }
  // JSON.parse accepts overflowing numbers; those are outside finite JSON.
  const finite = (v: any): void => {
    if (typeof v === 'number' && !Number.isFinite(v)) bad('invalid nonfinite value');
    if (v && typeof v === 'object') for (const child of Object.values(v)) finite(child);
  };
  finite(value); return value;
}
