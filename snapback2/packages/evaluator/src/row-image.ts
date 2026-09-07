import { canonicalSchemaJson } from './certificate-identity';
import { sha256, compareCodepoints } from './hash';
import { indexKeys, type KeyImage } from './index-store';
import { asObject, isVariant, clone, fieldOrNull, canonicalValue, validateWriteRow, wireJson, rowFromWire, type WireRefusal } from './value-runtime';
import type { Value } from './types';

// Per-module capabilities share this module's nominal image identity; never a global registry.
export const preparedChanges = Symbol();
export const preparedProjection = Symbol();
export const preparedDeliveryRows = Symbol();

export function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

/** A body-free immutable component dictionary; private branding cannot be forged by shallow freeze. */
export class ImageKeys {
  [name: string]: KeyImage[string];
  #owned = true;
  private constructor(entries: KeyImage) {
    for (const [name,parts] of Object.entries(entries)) Object.defineProperty(this,name,{ value: parts,enumerable: true });
    Object.setPrototypeOf(this,Object.prototype); immutable(this);
  }
  static is(value: unknown): value is ImageKeys { return !!value && typeof value === 'object' && #owned in value; }
  static restore(value: KeyImage): ImageKeys { return ImageKeys.is(value) ? value : new ImageKeys(clone(value)); }
  static forRow(schema: any, table: string, row: RowImage): ImageKeys {
    return new ImageKeys(Object.fromEntries(Object.keys(schema.tables[table].indexes)
      .map(name => [name,indexKeys(schema,table,name,c => fieldOrNull(row,c))])));
  }
}

// @ref LLP 1001#2-what-a-commit-records — execution materializes Optional Null; authenticated image custody preserves omission.
// The private brand certifies deep isolation. A frozen external wrapper cannot acquire it.
export class RowImage {
  declare readonly Row: Record<string, Value>;
  #kind: 'Row' | 'Map';
  #schema: string;
  #table: string;
  #omitted: number[];
  #keys: ImageKeys;
  #digest?: string;
  private constructor(schema: any, table: string, value: Value, identity: string, known?: ImageKeys) {
    const entries = asObject(value); this.#kind = isVariant(value,'Row') ? 'Row' : 'Map';
    this.#omitted = [];
    Object.keys(schema.tables[table].columns).sort(compareCodepoints).forEach((name, ordinal) => {
      if (this.#kind === 'Row' && schema.tables[table].columns[name]?.Optional !== undefined && !Object.hasOwn(entries,name)) {
        this.#omitted.push(ordinal); Object.defineProperty(entries,name,{ value: 'Null',enumerable: true,writable: true,configurable: true });
      }
    });
    Object.defineProperty(this,this.#kind,{ value: immutable(entries),enumerable: true });
    Object.setPrototypeOf(this,Object.prototype); this.#schema = identity; this.#table = table;
    this.#keys = known ?? ImageKeys.forRow(schema,table,this);
    Object.freeze(this.#omitted); Object.freeze(this);
  }
  static is(value: unknown): value is RowImage { return !!value && typeof value === 'object' && #schema in value; }
  static equal(left: unknown, right: RowImage): boolean {
    return left === right || RowImage.is(left) && left.#kind === right.#kind && left.#schema === right.#schema
      && left.#table === right.#table && left.#omitted.length === right.#omitted.length
      && left.#omitted.every((ordinal,i) => ordinal === right.#omitted[i]) && canonicalValue(left) === canonicalValue(right);
  }
  static prepare(schema: any, table: string, value: Value, identity = sha256(canonicalSchemaJson(schema)), known?: ImageKeys): RowImage {
    if (RowImage.is(value) && value.#schema === identity && value.#table === table) {
      if (known) RowImage.keys(value,known); return value;
    }
    const owned = RowImage.is(value) ? RowImage.tagged(value) : clone(value);
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
    if (known && value.#keys !== known) {
      if (imageCanonical(value.#keys) !== imageCanonical(known)) throw new TypeError('conflicting immutable image keys');
      value.#keys = known;
    }
    return value.#keys;
  }
  static digest(value: RowImage): string { return value.#digest ??= sha256(imageCanonical(value)); }
  /** Only Row optionals materialize; Map/JSON retains its exact kind and key set. */
  static wire(value: RowImage): Record<string, unknown> { return wireJson(RowImage.tagged(value)) as Record<string, unknown>; }
  static tagged(value: RowImage): Value {
    const entries = { ...asObject(value) }, names = Object.keys(entries).sort(compareCodepoints);
    for (const ordinal of value.#omitted) delete entries[names[ordinal]];
    return { [value.#kind]: entries } as Value;
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
