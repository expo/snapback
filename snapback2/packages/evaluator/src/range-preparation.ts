// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — one immutable typed range meaning, with source spelling kept at the boundary.
import { canonicalJson, clone, columnDescriptor, valueFromWire, type WireRefusal } from './value-runtime';
import { components, indexTuple, preparePrefix, prepareScanBounds } from './index-store';
import type { IndexAtom, IndexComponent, LogicalIndexAtom } from './search-key';
import type { ReceiptRange, Value } from './types';
import { EvalError } from './errors';
import { SearchExecution } from './search-runtime';
import { immutable } from './row-image';
import { sha256 } from './hash';

type ScanSite = { table: string; index: string; bounds: (number | undefined)[]; shape: boolean[]; identity: string };
const sites = new WeakMap<object, Map<string, ScanSite>>();
const admissions = new WeakMap<object, SearchExecution>();
export function scanBounds(program: any): Map<string, ScanSite> {
  if (!program || typeof program !== 'object') return new Map();
  const cached = sites.get(program); if (cached) return cached;
  const result = new Map<string, ScanSite>();
  const visit = (value: any): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.prefix) && typeof value.site === 'string') {
      const site = { table: value.table, index: value.index,
        bounds: value.prefix.map((p: any) => p.WordPrefix?.source_max),
        shape: value.prefix.map((p: any) => Object.hasOwn(p, 'WordPrefix')),
        identity: canonicalJson(value) };
      const prior = result.get(value.site);
      if (prior && prior.identity !== site.identity) throw new EvalError('E_TRACE_SUBSET', 'ambiguous issuing scan site');
      result.set(value.site, site);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(program); sites.set(program, result); return result;
}
/** A delivered descriptor borrows Q only from its exact issuing scan and derived slot. */
export function prepareRange(schema: any, range: Pick<ReceiptRange, 'site' | 'table' | 'index' | 'prefix'>,
  program?: any, search?: SearchExecution): LogicalIndexAtom[] {
  const site = scanBounds(program).get(range.site);
  const derived = range.prefix.some(a => 'WordPrefix' in a);
  if (derived && (!site || (site.table !== range.table || site.index !== range.index
    || site.shape.length !== range.prefix.length || site.shape.some((word, i) => word !== ('WordPrefix' in range.prefix[i])))))
    throw new EvalError('E_INPUT', 'range does not match its trusted issuing scan');
  if (!search && program && typeof program === 'object') {
    search = admissions.get(program);
    if (!search) { search = new SearchExecution(() => {}, 64); admissions.set(program, search); }
  }
  return preparePrefix(schema, range.table, range.index, range.prefix, site?.bounds ?? [], search?.atom);
}

export const preparedDeliveryRanges = Symbol();
export const boundNames = ['after','before','gt','gte','lt','lte'] as const;
type BoundName = typeof boundNames[number];
type Parameters = Pick<ReceiptRange, 'site'|'table'|'index'|'prefix'|'order'|'take'|'rule_hash'|BoundName>;
export interface RangeMeaning {
  site: string; ruleHash: string; table: string; index: string; prefix: LogicalIndexAtom[]; order: 'Asc'|'Desc';
  after: Value[] | null; before: Value[] | null; gt: Value[] | null; gte: Value[] | null; lt: Value[] | null; lte: Value[] | null;
}
/** Identity only; shape checks remain at their existing field/typed admission phases. */
export const rangeSchemaIdentity = (schema: any): string => sha256(canonicalJson(schema));
const issuing = (range: Pick<ReceiptRange,'site'|'table'|'index'|'prefix'>, program?: any): string | undefined =>
  range.prefix.some(a => 'WordPrefix' in a) ? scanBounds(program).get(range.site)?.identity : undefined;

/** Contains no membership, row pool, authority, callbacks, or owner backlink. */
export class PreparedRange {
  private constructor(readonly value: Parameters, readonly meaning: RangeMeaning,
    readonly parts: IndexComponent[], readonly columns: IndexComponent[], readonly suffix: IndexComponent[],
    private readonly schema: string, private readonly site: string | undefined) { immutable(this); }
  static finish(schema: any, value: Parameters, logical: LogicalIndexAtom[], program: any, identity: string): PreparedRange {
    const parts = components(schema,value.table,value.index);
    const { after,before } = prepareScanBounds(schema,value.table,parts,{ ...value,
      range: Object.fromEntries(boundNames.slice(2).map(name => [name,value[name]])) });
    const scalar = (value: Value | null): Value[] | null => value === null ? null : [value];
    const ownedParts = clone(parts);
    value.prefix = value.prefix.map((atom,i) => 'Scalar' in atom ? logical[i] as IndexAtom : atom);
    return new PreparedRange(value,{ site: value.site,ruleHash: value.rule_hash,table: value.table,index: value.index,
      prefix: logical,order: value.order,after,before,gt: scalar(value.gt),gte: scalar(value.gte),lt: scalar(value.lt),lte: scalar(value.lte) },
      ownedParts,ownedParts.filter(c => 'Column' in c),ownedParts.slice(value.prefix.length),identity,issuing(value,program));
  }
  static tagged(schema: any, range: ReceiptRange, program?: any, identity = rangeSchemaIdentity(schema)): { value: ReceiptRange; prepared: PreparedRange } {
    const held = RangeReceipt.get(range,false);
    if (held && held.matches(schema,program,identity)) { held.held(schema,range.held_suffix); return { value: range,prepared: held }; }
    const value = clone(range), logical = prepareRange(schema,value,program);
    const fields = Object.fromEntries(['site','table','index','prefix','order','take','rule_hash',...boundNames].map(name => [name,(value as any)[name]])) as Parameters;
    const prepared = PreparedRange.finish(schema,fields,logical,program,identity);
    prepared.held(schema,value.held_suffix);
    return { value: RangeReceipt.own(value,prepared,false) as unknown as ReceiptRange,prepared };
  }
  matches(_schema: any, program: any, identity: string): boolean {
    return this.schema === identity && this.site === issuing(this.value,program)
      && (!this.value.prefix.some(a => 'WordPrefix' in a) || this.site !== undefined);
  }
  held(schema: any, value?: Value[]): void {
    if (value !== undefined && !(this.suffix.length === 0 && Array.isArray(value) && !value.length))
      indexTuple(schema,this.value.table,this.suffix,{ Array: value });
  }
  position(schema: any, values: Value[]): Value[] {
    return indexTuple(schema,this.value.table,this.columns,{ Array: values })!;
  }
}

/** Nominal owner leaf: generic JSON persists only its original enumerable fields. */
export class RangeReceipt {
  #prepared: PreparedRange;
  #wire: boolean;
  private constructor(value: object, prepared: PreparedRange, wire: boolean) {
    for (const [key,child] of Object.entries(value)) Object.defineProperty(this,key,{ value: child,enumerable: true });
    this.#prepared = prepared; this.#wire = wire;
    Object.setPrototypeOf(this,Object.prototype); immutable(this);
  }
  static is(value: unknown): value is RangeReceipt { return !!value && typeof value === 'object' && #prepared in value; }
  static get(value: unknown, wire: boolean): PreparedRange | undefined {
    return RangeReceipt.is(value) && value.#wire === wire ? value.#prepared : undefined;
  }
  /** The caller owns the copied DTO; the prepared parameter object itself is immutable. */
  static own<T extends object>(value: T, prepared: PreparedRange, wire: boolean): T {
    return new RangeReceipt(value,prepared,wire) as unknown as T;
  }
  static change<T extends object>(value: T, changes: Partial<T>): T {
    const held = RangeReceipt.is(value) ? value : undefined;
    const allowed = ['rowIds','row_ids','haloId','halo','evictedIds','evicted_ids','heldSuffix','held_suffix'];
    if (Object.keys(changes).some(key => !allowed.includes(key))) throw new TypeError('range parameter changes require admission');
    const next = { ...value,...clone(changes) };
    for (const key of Object.keys(changes)) if ((changes as any)[key] === undefined) delete (next as any)[key];
    return held ? new RangeReceipt(next,held.#prepared,held.#wire) as unknown as T : next;
  }
  static tagged(range: any, prepared: PreparedRange): ReceiptRange {
    const value: ReceiptRange = { ...prepared.value,row_ids: range.rowIds,stop: range.stop,absence: range.absence,
      halo: range.haloId === undefined ? null : { table: range.table,id: range.haloId },n2_suffix: null,
      ...(range.heldSuffix === undefined ? {} : { held_suffix: range.heldSuffix }),
      ...(range.evictedIds === undefined ? {} : { evicted_ids: range.evictedIds }) };
    return new RangeReceipt(value,prepared,false) as unknown as ReceiptRange;
  }
}

export function wireIndexValues(schema: any, table: string, index: string, values: unknown[], offset: number, fail: WireRefusal): Value[] {
  const parts = components(schema,table,index);
  return values.map((value,at) => {
    const part = parts[offset+at], name = part && ('Column' in part ? part.Column : '');
    if (name === undefined) fail(`schema.tables.${table}.indexes.${index}`,'has too few columns');
    return valueFromWire(columnDescriptor(schema,table,name),value,`${table}.${index}[${offset+at}]`,fail,schema);
  });
}
export function wireBoundary(schema: any, range: { table: string; index: string; prefix: unknown[] }, value: unknown, fail: WireRefusal): Value | null {
  if (value === null) return null;
  const values = wireIndexValues(schema,range.table,range.index,Array.isArray(value) ? value : [value],range.prefix.length,fail);
  return Array.isArray(value) ? { Array: values } : values[0];
}
/** Field parsing stays outside schema admission; neither path grants an unbound derived Q. */
export function wireRangePrefix(schema: any, range: any, program: any, fail: WireRefusal,
  atomShape: (value: unknown,path: string) => void): { atoms: IndexAtom[]; logical: LogicalIndexAtom[] } {
  const parts = components(schema,range.table,range.index);
  const atoms: IndexAtom[] = range.prefix.map((atom: any,i: number) => {
    atomShape(atom,'range.prefix');
    const part = parts[i];
    if (!part) fail('range.prefix','too many components');
    if ('Column' in part && 'Scalar' in atom) return { Scalar: valueFromWire(columnDescriptor(schema,range.table,part.Column),atom.Scalar,'range.prefix',fail,schema) };
    if ('WordPrefixes' in part && 'WordPrefix' in atom) return clone(atom);
    return fail('range.prefix','atom does not match its component');
  });
  return { atoms,logical: prepareRange(schema,{ ...range,prefix: atoms },program) };
}
/** All input fields are tagged before full-bound validation, exactly like the public receipt boundary. */
export function prepareWireRanges<T extends object>(schema: any, ranges: T[], program: any, fail: WireRefusal,
  atomShape: (value: unknown,path: string) => void, missingBounds = false, identity = rangeSchemaIdentity(schema)): T[] {
  const drafts = ranges.map((input: any) => {
    const held = RangeReceipt.get(input,true);
    if (held?.matches(schema,program,identity)) { held.held(schema,input.heldSuffix); return { input,held }; }
    const { atoms,logical } = wireRangePrefix(schema,input,program,fail,atomShape);
    const value: Parameters = { site: input.site,table: input.table,index: input.index,prefix: atoms,order: input.order,take: input.take,
      ...Object.fromEntries(boundNames.map(name => [name,wireBoundary(schema,input,missingBounds ? input[name] ?? null : input[name],fail)])),rule_hash: input.ruleHash } as Parameters;
    return { input,value,logical };
  });
  return drafts.map(draft => {
    if (draft.held) return draft.input;
    const prepared = PreparedRange.finish(schema,draft.value!,draft.logical!,program,identity);
    prepared.held(schema,draft.input.heldSuffix);
    return RangeReceipt.own(clone(draft.input),prepared,true);
  });
}
