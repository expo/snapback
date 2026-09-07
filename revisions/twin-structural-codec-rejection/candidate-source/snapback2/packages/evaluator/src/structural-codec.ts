// @ref LLP 1001#10-what-binds-and-how-it-is-checked — structural construction has
// separate field/output and refusal orders; the grammar never certifies its input.
import { compareCodepoints, utf8Length } from './hash';
import { EvalError } from './errors';
import coreIrContract from '../../../crates/snapback2-core/ir-contract.json' with { type: 'json' };
import { asObject, canonicalBytes, canonicalValue, scalarText, validateIdentity,
  validHttpUrl, wireObject } from './value-runtime';
import type { Value } from './types';
import { decodeCursor } from './cursor';

/** Fixed source grammar, not a compiled or cached representation of a caller's schema. */
export type Form = string | null | readonly any[];
export type Grammar = Record<string, Form>;
const omitted = Symbol();
type Context = { descriptor?: any; label?: string; fanout?: boolean; internal?: boolean; asset?: boolean;
  fail?: (path: string, detail: string) => never; reserved?: boolean };

/** Array policies preserve the original hole behavior: inspection visits holes,
 * while map/forEach construction and refinement preserve/skip them respectively. */
function sequence(value: any, visit: (item: any, index: number) => any, mode = 'map', receiver = 'value'): any {
  if (mode === 'all') { let i = 0; for (const item of value) visit(item, i++); return; }
  if (mode === 'forEach') return value.forEach(visit);
  // Native TypeErrors include these expressions on JSC/Bun. The callbacks only
  // dispatch into this codec; no former recursive constructor survives here.
  if (receiver === 'data') { const data = value, normalizeValue = visit; return data.map(normalizeValue); }
  if (receiver === 'setup') { const setup = value, normalizeStatement = visit; return setup.map(normalizeStatement); }
  if (receiver === '(value ?? [])') { const normalizeConstraint = visit; return (value ?? []).map(normalizeConstraint); }
  const normalize = visit;
  return value.map(normalize);
}

export function structural(value: any, form: Form, grammar: Grammar = {}, context: Context = {}): any {
  if (form === null) return value;
  if (typeof form === 'string') return structural(value, grammar[form], grammar, context);
  const [op, a, b, c, mode, pre] = form;
  const child = (input: any, rule: Form, ctx = context) => structural(input, rule, grammar, ctx);
  switch (op) {
    case 'list': return sequence(value, item => child(item, a), b, c);
    case 'map': {
      const out = Object.create(null), keys = Object.keys(value);
      if (b !== false) keys.sort(compareCodepoints);
      for (const key of keys) out[key] = child(value[key], a);
      return out;
    }
    case 'record': {
      const fields: readonly string[] = b;
      if (a !== null) {
        if (typeof value !== 'object' || value === null || Array.isArray(value))
          throw new EvalError('E_SCHEMA', `${a} must be an object`);
        const unknown = Object.keys(value).filter(key => !fields.includes(key));
        if (unknown.length) throw new EvalError('E_SCHEMA', `unknown ${a} field ${unknown.join(', ')}: a schema shape newer than this evaluator`);
      }
      if (mode === 'validate') return;
      for (const [name, rule] of pre ?? []) child(value[name], rule);
      const out: Record<string, any> = {};
      if (!mode) for (const field of fields) if (value[field] !== undefined) out[field] = value[field];
      for (const field of mode ? fields : Object.keys(c ?? {})) {
        const result = child(value[field], c?.[field] ?? null);
        if (result === omitted) delete out[field]; else out[field] = result;
      }
      return out;
    }
    case 'variant': {
      if (c === 'primitive' && (typeof value !== 'object' || value === null) || c === 'string' && typeof value === 'string') return value;
      const keys = Object.keys(value);
      if (keys.length !== 1) throw new Error('E_TRACE_SUBSET: malformed externally tagged IR');
      const kind = keys[0], payload = value[kind];
      if (Object.hasOwn(a, kind)) return { [kind]: child(payload, a[kind]) };
      if (mode && kind in a) return child(payload, ['record', `${mode === true ? '' : mode}${kind}`, a[kind]]);
      if (b === 'whole') return value;
      if (b === 'opaque') return { [kind]: payload };
      if (b === 'deep') return { [kind]: child(payload, ['deep']) };
      if (typeof b === 'string' && b.startsWith('error:')) throw new EvalError('E_SCHEMA', b.slice(6));
      return child(value, b);
    }
    case 'deep':
      return Array.isArray(value) ? child(value, ['list', ['deep']])
        : value !== null && typeof value === 'object' ? child(value, ['map', ['deep']]) : value;
    case 'default': return child((a === 'nullish' ? value == null : value === undefined) ? b : value, c);
    case 'nullable': return value === null || a && value === undefined ? value : child(value, b);
    case 'omit':
      if (a === 'always' || a === 'falsy' && !value || a === 'nullish' && value == null || a === 'unlessTrue' && value !== true) return omitted;
      return child(value, b);
    case 'check':
      if (value !== undefined && (a === 'u32' ? !Number.isInteger(value) || value < 0 || value > 0xffffffff
        : a === 'format' ? value !== 'handle' && value !== 'url' : typeof value !== 'boolean')) throw new TypeError(b);
      return value;
    case 'lane': {
      const { setup, ...lane } = value;
      const out = setup?.length ? { setup: child(setup, ['list', 'statement', 'map', 'setup']) } : {};
      return { ...out, ...child(lane, ['record', 'merge lane', ['scan','source','binding'], { scan: 'scan' }]),
        ...(lane.source == null ? {} : { source: child(lane.source, 'scan') }) };
    }
    case 'scope': {
      const d = { scope: value }, normalizeExpression = (input: any) => child(input, 'expression');
      return d.scope.map((s: any) => ({ column: s.column, value: normalizeExpression(s.value) }));
    }
    case 'truthy': return value ? child(value, a) : value;
    case 'inspect': {
      if (value === 'Null') return;
      if (!value || typeof value !== 'object' || Object.keys(value).length !== 1)
        throw new EvalError('E_INPUT', `${context.label} is not a tagged value`);
      const kind = Object.keys(value)[0], data = value[kind];
      if (kind === 'Bool' && typeof data === 'boolean' || kind === 'Int' && Number.isSafeInteger(data)) return;
      if ((kind === 'String' || kind === 'Id') && typeof data === 'string') {
        if (kind === 'Id') validateIdentity(data); else scalarText(data);
        context.reserved ||= kind === 'Id' && data === coreIrContract.systemPrincipalId; return;
      }
      if (kind === 'Bytes' && canonicalBytes(data)) return;
      if (kind === 'Array' && Array.isArray(data)) return child(data, ['list', ['inspect'], 'all']);
      if ((kind === 'Row' || kind === 'Map') && data !== null && typeof data === 'object' && !Array.isArray(data)) {
        for (const [key, item] of Object.entries(data)) { scalarText(key); child(item, ['inspect']); }
        return;
      }
      throw new EvalError('E_INPUT', `${context.label} is not a valid value`);
    }
    case 'admit': {
      const ctx = { ...context, reserved: false };
      child(value, ['inspect'], ctx);
      if (!ctx.internal && ctx.reserved) throw new EvalError('E_INPUT', `${ctx.label} cannot carry the reserved system principal`);
      let descriptor = ctx.descriptor;
      while (descriptor?.Image === undefined && descriptor?.Video === undefined) {
        if (descriptor?.Optional !== undefined) descriptor = descriptor.Optional;
        else if (descriptor?.List?.of != null) descriptor = descriptor.List.of;
        else break;
      }
      ctx.asset = descriptor?.Image !== undefined || descriptor?.Video !== undefined;
      child(value, ['type'], ctx); return;
    }
    case 'row': {
      const columns = a;
      if (columns === undefined) throw new EvalError('E_SCHEMA', `missing table ${b}`);
      const object = asObject(value);
      if (!Object.hasOwn(object, 'id')) throw new EvalError('E_SCHEMA', `${b} row lacks id`);
      const unknown = Object.keys(object).find(name => !Object.hasOwn(columns, name));
      if (unknown !== undefined) throw new EvalError('E_INPUT', `${b} row contains undeclared field ${unknown}`);
      for (const [name, descriptor] of Object.entries<any>(columns)) {
        const item = Object.hasOwn(object, name) ? object[name] : undefined;
        if (item === undefined && descriptor?.Optional === undefined) throw new EvalError('E_INPUT', `${b}.${name} is required`);
        if (item !== undefined) child(item, ['admit'], { descriptor, label: `${b}.${name}`, fanout: false });
      }
      return;
    }
    case 'wireRow': {
      const columns = a?.tables?.[b]?.columns, fail = context.fail!;
      if (!wireObject(columns)) fail(`schema.tables.${b}.columns`, 'is missing');
      const tagged: Record<string, Value> = Object.create(null);
      for (const [name, item] of Object.entries(value)) {
        if (!(name in columns)) fail(`rows.${b}.${name}`, 'is not a declared column');
        tagged[name] = child(item, ['wire'], { ...context, descriptor: columns[name], label: `rows.${b}.${name}` });
      }
      return { Row: tagged };
    }
    case 'json': {
      if (value === null) return 'Null';
      const kind = typeof value;
      if (kind === 'boolean') return { Bool: value };
      if (kind === 'number') return { Int: value };
      if (kind === 'string') return { String: value };
      return Array.isArray(value) ? { Array: child(value, ['list', ['json']]) }
        : { Map: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, child(item, ['json'])])) };
    }
    case 'wire': {
      const descriptor = context.descriptor, label = context.label!, fail = context.fail!;
      if (wireObject(descriptor) && 'Optional' in descriptor)
        return value === null ? 'Null' : child(value, form, { ...context, descriptor: descriptor.Optional });
      if (value === null) return 'Null';
      if (descriptor === 'Id' || descriptor === 'Principal' || wireObject(descriptor) && 'Ref' in descriptor) {
        if (typeof value !== 'string') fail(label, 'expected id string');
        validateIdentity(value); return { Id: value };
      }
      if (wireObject(descriptor) && ('Text' in descriptor || 'Enum' in descriptor)) {
        if (typeof value !== 'string') fail(label, 'expected text string');
        const tagged = { String: value }; child(tagged, ['admit'], { ...context, fanout: false }); return tagged;
      }
      if (['Int','Time'].includes(String(descriptor)) || wireObject(descriptor) && ('Decimal' in descriptor || 'Money' in descriptor)) {
        if (!Number.isSafeInteger(value)) fail(label, 'expected safe integer'); return { Int: value };
      }
      if (descriptor === 'Bool') { if (typeof value !== 'boolean') fail(label, 'expected boolean'); return { Bool: value }; }
      if (wireObject(descriptor) && 'Bytes' in descriptor) {
        const bytes = wireObject(value) && 'Bytes' in value ? value.Bytes : undefined;
        if (!wireObject(value) || Object.keys(value).length !== 1 || typeof bytes !== 'string' || !canonicalBytes(bytes)) fail(label, 'expected canonical Bytes');
        return { Bytes: bytes };
      }
      if (wireObject(descriptor) && 'List' in descriptor) {
        if (!Array.isArray(value)) fail(label, 'expected array');
        return { Array: sequence(value, (item, index) => child(item, form, { ...context, descriptor: descriptor.List.of, label: `${label}[${index}]` })) };
      }
      if (wireObject(descriptor) && ('Image' in descriptor || 'Video' in descriptor)) {
        const tagged = child(value, ['json']);
        try { child(tagged, ['admit'], { ...context, fanout: false }); }
        catch (error) { if (error instanceof EvalError && error.code === 'E_ASSET_TYPE') fail((error as any).path ?? label, error.message); throw error; }
        return tagged;
      }
      if (wireObject(descriptor) && 'Json' in descriptor) return child(value, ['json']);
      fail(label, 'has an unsupported schema descriptor');
    }
    case 'type': {
      const descriptor = context.descriptor, label = context.label!, { asset, fanout } = context;
      if (descriptor?.Optional !== undefined) return value === 'Null' ? [] : child(value, form, { ...context, descriptor: descriptor.Optional });
      const kind = value === 'Null' ? 'Null' : Object.keys(value)[0], data = value === 'Null' ? null : value[kind];
      const refuse = (message: string, overflow = false): never => { throw asset ? assetError(label, message)
        : new EvalError(fanout && overflow ? 'E_FANOUT' : 'E_INPUT', `${label} ${message}`); };
      if (descriptor?.List !== undefined) {
        if (kind !== 'Array') return refuse('must be a list');
        if (data.length > descriptor.List.max) refuse(`exceeds list max ${descriptor.List.max}`, true);
        const ids: string[] | undefined = asset ? [] : undefined;
        if (descriptor.List.of != null) sequence(data, (item, index) => {
          const found = child(item, form, { ...context, descriptor: descriptor.List.of, label: asset ? `${label}[${index}]` : label });
          if (ids && found) for (const id of found) ids.push(id);
        }, 'forEach', 'value.Array');
        if (ids) {
          const seen = new Set<string>(), duplicate = ids.find(id => seen.has(id) || !seen.add(id));
          if (duplicate !== undefined) throw assetError(label, `repeats asset id ${duplicate}; asset ids in a list must be unique`);
        }
        return ids;
      }
      if (asset) {
        const name = descriptor?.Image !== undefined ? 'image' : descriptor?.Video !== undefined ? 'video' : null;
        if (name === null) throw new EvalError('E_SCHEMA', `unsupported asset type for ${label}`);
        if (kind !== 'Map') throw assetError(label, `must be a closed ${name} asset map`);
        const fields = name === 'image' ? ['height','id','width'] : ['duration','height','id','width'];
        const keys = Object.keys(data).sort(compareCodepoints);
        if (keys.length !== fields.length || keys.some((key, i) => key !== fields[i])) throw assetError(label, `must contain exactly ${fields.join(', ')}`);
        const id = data.id?.String ?? '';
        if (!/^s2id-[0-9a-f]{32}-[0-9a-f]{16}$/.test(id) || id.endsWith('-0000000000000000')) throw assetError(`${label}.id`, 'must be a minted s2id');
        for (const field of name === 'image' ? ['width','height'] : ['width','height','duration']) {
          const member = data[field];
          if (member === 'Null' || !Object.hasOwn(member, 'Int') || !Number.isSafeInteger(member.Int) || member.Int <= 0)
            throw assetError(`${label}.${field}`, 'must be a positive i53 integer');
        }
        return [id];
      }
      if (descriptor === 'Cursor') { if (kind !== 'String') refuse('must be a cursor string'); decodeCursor(data); return; }
      if (descriptor === 'Scalar') return;
      if (descriptor === 'Id' || descriptor === 'Principal' || descriptor?.Ref !== undefined) { if (kind !== 'Id') refuse('must be an id'); return; }
      if (descriptor?.Text !== undefined) {
        if (kind !== 'String') refuse('must be text');
        for (const character of data) {
          const code = character.codePointAt(0)!;
          if (code < 0x20 && ![9,10,13].includes(code)) refuse(`contains disallowed control character U+${code.toString(16).toUpperCase().padStart(4, '0')}`);
        }
        const length = Array.from(data).length;
        if (length > descriptor.Text.max) refuse(`exceeds text max ${descriptor.Text.max}`);
        if (fanout && length < (descriptor.Text.min ?? 0)) refuse(`is shorter than text min ${descriptor.Text.min}`);
        if (fanout && descriptor.Text.format !== undefined && !(descriptor.Text.format === 'handle'
          ? /^[a-z0-9_]*$/.test(data) : descriptor.Text.format === 'url' && validHttpUrl(data))) refuse(`has invalid ${String(descriptor.Text.format)} format`);
        return;
      }
      if (descriptor?.Bytes !== undefined) {
        if (kind !== 'Bytes' || !canonicalBytes(data)) refuse('must be bytes');
        if (data.length / 2 > descriptor.Bytes.max) refuse(`exceeds bytes max ${descriptor.Bytes.max}`); return;
      }
      if (['Int','Time'].includes(descriptor) || descriptor?.Decimal !== undefined || descriptor?.Money !== undefined) { if (kind !== 'Int' || !Number.isSafeInteger(data)) refuse('must be an i53 integer'); return; }
      if (descriptor === 'Bool') { if (kind !== 'Bool') refuse('must be a boolean'); return; }
      if (descriptor?.Json !== undefined) { if (utf8Length(canonicalValue(value)) > descriptor.Json.max_bytes) refuse(`exceeds JSON max ${descriptor.Json.max_bytes} bytes`); return; }
      if (descriptor?.Enum !== undefined) { if (kind !== 'String' || !descriptor.Enum.variants.includes(data)) refuse('is not a declared enum value'); return; }
      throw new EvalError('E_SCHEMA', `unsupported type for ${label}`);
    }
    default: throw new Error(`unknown structural operation ${op}`);
  }
}

// @ref LLP 1006#6-the-write-validated-not-stamped — shape/path checking owns no ledger authority.
function assetError(path: string, message: string): EvalError {
  return Object.assign(new EvalError('E_ASSET_TYPE', `${path} ${message}`), { path });
}
