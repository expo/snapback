import { canonicalSchemaJson } from './certificate-identity';
import { sha256, compareCodepoints } from './hash';
import { indexKeys, type KeyImage } from './index-store';
import { asObject, isVariant, clone, fieldOrNull, canonicalValue, validateWriteRow, wireJson, rowFromWire, type WireRefusal } from './value-runtime';
import type { Value } from './types';

// Per-module capabilities share this module's nominal image identity; never a global registry.
export const preparedChanges = Symbol();
export const preparedProjection = Symbol();
export const preparedDeliveryRows = Symbol();

const imageKeyOwners = new WeakSet<object>();
const rowImageOwners = new WeakMap<object, {
  kind: 'Row' | 'Map';
  schema: string;
  table: string;
  omitted: string[];
  keys: ImageKeys;
  digest?: string;
}>();

export function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

/** A body-free immutable component dictionary; module-private ownership cannot be copied with descriptors. */
export class ImageKeys {
  [name: string]: KeyImage[string];
  private constructor(entries: KeyImage) {
    for (const [name,parts] of Object.entries(entries)) Object.defineProperty(this,name,{ value: parts,enumerable: true });
    imageKeyOwners.add(this);
    Object.setPrototypeOf(this,Object.prototype); immutable(this);
  }
  static is(value: unknown): value is ImageKeys {
    return !!value && typeof value === 'object' && imageKeyOwners.has(value);
  }
  static restore(value: KeyImage): ImageKeys { return ImageKeys.is(value) ? value : new ImageKeys(clone(value)); }
  static forRow(schema: any, table: string, row: RowImage): ImageKeys {
    return new ImageKeys(Object.fromEntries(Object.keys(schema.tables[table].indexes)
      .map(name => [name,indexKeys(schema,table,name,c => fieldOrNull(row,c))])));
  }
}

// @ref LLP 1001#2-what-a-commit-records — execution materializes Optional Null; authenticated image custody preserves omission.
// Module-private ownership certifies deep isolation while keeping lazy caches outside the frozen public image.
export class RowImage {
  declare readonly Row: Record<string, Value>;
  private constructor(schema: any, table: string, value: Value, identity: string, known?: ImageKeys) {
    const entries = asObject(value), kind = isVariant(value,'Row') ? 'Row' : 'Map', omitted: string[] = [];
    Object.keys(schema.tables[table].columns).sort(compareCodepoints).forEach(name => {
      if (kind === 'Row' && schema.tables[table].columns[name]?.Optional !== undefined && !Object.hasOwn(entries,name)) {
        omitted.push(name); Object.defineProperty(entries,name,{ value: 'Null',enumerable: true,writable: true,configurable: true });
      }
    });
    Object.defineProperty(this,kind,{ value: immutable(entries),enumerable: true });
    Object.setPrototypeOf(this,Object.prototype);
    rowImageOwners.set(this,{ kind,schema: identity,table,omitted,keys: known ?? ImageKeys.forRow(schema,table,this) });
    Object.freeze(omitted); Object.freeze(this);
  }
  static is(value: unknown): value is RowImage {
    return !!value && typeof value === 'object' && rowImageOwners.has(value);
  }
  static table(value: RowImage): string { return rowImageOwners.get(value)!.table; }
  static equal(left: unknown, right: RowImage): boolean {
    if (left === right) return true;
    if (!RowImage.is(left)) return false;
    const a = rowImageOwners.get(left)!, b = rowImageOwners.get(right)!;
    return a.kind === b.kind && a.schema === b.schema && a.table === b.table
      && a.omitted.length === b.omitted.length && a.omitted.every((name,i) => name === b.omitted[i])
      && canonicalValue(left) === canonicalValue(right);
  }
  static prepare(schema: any, table: string, value: Value, identity = sha256(canonicalSchemaJson(schema)), known?: ImageKeys): RowImage {
    const image = RowImage.is(value) ? value : undefined;
    const held = image && rowImageOwners.get(image)!;
    if (image && held && held.schema === identity && held.table === table) {
      if (known) RowImage.keys(image,known); return image;
    }
    const owned = image ? RowImage.tagged(image) : clone(value);
    validateWriteRow(schema,table,owned);
    return new RowImage(schema,table,owned,identity,known);
  }
  /** Construction owns every new child; external tagged inputs still clone through prepare. */
  static fromWire(schema: any, table: string, row: Record<string,unknown>, fail: WireRefusal,
    identity?: string, known?: ImageKeys): RowImage {
    const owned = rowFromWire(schema,table,row,fail);
    validateWriteRow(schema,table,owned);
    return new RowImage(schema,table,owned,identity ?? sha256(canonicalSchemaJson(schema)),known);
  }
  static keys(value: RowImage, known?: ImageKeys): ImageKeys {
    const state = rowImageOwners.get(value)!;
    if (known && state.keys !== known) {
      if (imageCanonical(state.keys) !== imageCanonical(known)) throw new TypeError('conflicting immutable image keys');
      state.keys = known;
    }
    return state.keys;
  }
  static digest(value: RowImage): string {
    const state = rowImageOwners.get(value)!;
    return state.digest ??= sha256(imageCanonical(value));
  }
  /** Only Row optionals materialize; Map/JSON retains its exact kind and key set. */
  static wire(value: RowImage): Record<string, unknown> { return wireJson(RowImage.tagged(value)) as Record<string, unknown>; }
  static tagged(value: RowImage): Value {
    const state = rowImageOwners.get(value)!;
    const entries = { ...asObject(value) };
    for (const name of state.omitted) delete entries[name];
    return { [state.kind]: entries } as Value;
  }
}

/** Explicit wire boundary: no toJSON hook, raw/typed mirror, or persistent interning registry. */
export function imageWire<T>(value: T): T {
  return (RowImage.is(value) ? RowImage.wire(value) : value) as T;
}
export function imageField(value: Record<string, unknown>, name: string): unknown {
  return RowImage.is(value) ? wireJson(fieldOrNull(value,name)) : Object.hasOwn(value,name) ? value[name] : undefined;
}

/** Typed images occur only at row slots; metadata uses native JSON without a per-property replacer. */
export function imageRecord<T extends { row: unknown }>(value: T): T {
  return RowImage.is(value.row) ? { ...value,row: imageWire(value.row) } : value;
}
export function imageRecords<T extends { row: unknown }>(rows: Record<string,T>): Record<string,T> {
  return Object.fromEntries(Object.entries(rows).map(([key,row]) => [key,imageRecord(row)]));
}
export function imageState<T extends { rows: Record<string,{ row: unknown }> }>(state: T): T {
  return { ...state,rows: imageRecords(state.rows) };
}

/** Existing carrier canonical encoding, including UTF-16 key ordering and undefined spelling. */
export function imageCanonical(value: unknown): string {
  value = imageWire(value);
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(imageCanonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${imageCanonical((value as Record<string,unknown>)[key])}`).join(',')}}`;
}
