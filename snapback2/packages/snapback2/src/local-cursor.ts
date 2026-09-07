// @ref LLP 1012#indexed-held-search — h1 fences local pages; only its ordinary position enters the local evaluator.
import { decodeCursor, decodeCursorFor, encodeCursor, type CursorPosition } from '../../evaluator/src/cursor.js';
import { EvalError } from '../../evaluator/src/errors.js';
import { sha256 } from '../../evaluator/src/hash.js';
import { canonicalJson } from '../../evaluator/src/value-runtime.js';
import { SearchExecution } from '../../evaluator/src/search-runtime.js';
import type { HeldOperation } from './store/range-store.js';

export function cursorArgument(operation: HeldOperation | undefined): string | undefined {
  const args = (operation?.ir as any)?.args ?? {};
  return Object.keys(args).find(k => args[k] === 'Cursor' || args[k]?.Optional === 'Cursor');
}
export const isLocalCursor = (value: unknown): value is string => typeof value === 'string' && value.startsWith('h1.');
/** Shared by query POST, SSE subscription, reconnect and resume. Local positions never enter transport. */
export function serverArguments(args: unknown, cursor?: string): unknown {
  if (!cursor || !args || typeof args !== 'object' || Array.isArray(args)) return args;
  const record = args as Record<string, unknown>;
  return isLocalCursor(record[cursor]) ? { ...record, [cursor]: null } : args;
}
export interface LocalFence {
  partition: string; operation: string; program: string; schema: string; generation: string;
  incarnation: string; revisions: number[];
  timed?: boolean; readTime?: number;
}
export class StaleLocalPage extends EvalError {
  readonly restartLocalPage = true;
  constructor() { super('E_INPUT', 'local cursor incarnation or revisions changed'); }
}
const fail = (): never => { throw new EvalError('E_INPUT', 'invalid or mismatched local cursor'); };
const identity = (f: LocalFence) => [f.partition, f.operation, f.program, f.schema, f.generation];

/** Hash exact other arguments, replacing only trusted bounded search argument paths by their normalized meaning. */
export function localBinding(operation: HeldOperation, args: unknown, search = new SearchExecution()): string {
  const ir = operation.ir as any;
  const record = structuredClone(args ?? {}) as Record<string, any>;
  const cursor = cursorArgument(operation); if (cursor) delete record[cursor];
  type Bindings = Map<string, string[] | undefined>;
  const bindings: Bindings = new Map(Object.keys(ir.args ?? {}).map(name => [name, [name]]));
  const path = (expr: any, env: Bindings): string[] | undefined => {
    if (expr?.Variable !== undefined) return env.get(expr.Variable);
    if (expr?.Field) { const base = path(expr.Field.base, env); return base && [...base, expr.Field.name]; }
  };
  const terms = new Map<string, { path: string[]; max: number; contract: any }>(), ordinary: string[][] = [];
  const visit = (v: any, env: Bindings): void => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const item of v) visit(item, env); return; }
    const definition = v.Const ?? v.Let ?? v.Assign;
    if (definition) {
      // Capture the origin now. A later rebinding cannot retarget an earlier alias.
      const origin = path(definition.value, env);
      if (!origin) visit(definition.value, env);
      env.set(definition.name, origin); return;
    }
    if (v.If || v.For) {
      const d = v.If ?? v.For;
      visit(d.condition ?? d.domain, env);
      const branches = v.If ? [d.then_body, d.else_body] : [[], d.body];
      const arms = branches.map(body => { const arm = new Map(env); if (v.For) arm.set(d.binding, undefined); visit(body, arm); return arm; });
      for (const name of new Set(arms.flatMap(arm => [...arm.keys()]))) {
        const a = arms[0].get(name), b = arms[1].get(name);
        if (canonicalJson(a ?? null) === canonicalJson(b ?? null)) env.set(name, a);
        else { if (a) ordinary.push(a); if (b) ordinary.push(b); env.set(name, undefined); }
      }
      return;
    }
    if (v.WordPrefix) {
      const p = path(v.WordPrefix.source, env);
      if (p) terms.set(JSON.stringify(p), { path: p, max: v.WordPrefix.source_max, contract: v.WordPrefix.contract });
      else visit(v.WordPrefix.source, env);
      return;
    }
    const p = path(v, env);
    if (p) { ordinary.push(p); return; }
    // held_search repeats the certified lane expressions; actual IR above owns their lexical usage.
    for (const [key, child] of Object.entries(v)) if (key !== 'held_search') visit(child, env);
  };
  visit(ir.body, bindings);
  for (const { path, max, contract } of terms.values()) {
    // A source shared with an ordinary key, projection or predicate must retain its exact binding.
    if (ordinary.some(p => p.slice(0, Math.min(p.length, path.length)).every((part, i) => part === path[i]))) continue;
    let target = record;
    for (const p of path.slice(0, -1)) { target = target?.[p]; if (!target || typeof target !== 'object') break; }
    if (!target || typeof target[path.at(-1)!] !== 'string') continue; // The evaluator validates required/narrowed inputs.
    const atom = search.atom({ WordPrefixes: { fields: [], contract } },
      { WordPrefix: { source: target[path.at(-1)!], contract } }, max);
    if ('WordPrefix' in atom) target[path.at(-1)!] = atom.WordPrefix.token;
  }
  return sha256(canonicalJson(record));
}

export function encodeLocalCursor(fence: LocalFence, binding: string, position: CursorPosition): string {
  if (fence.timed && (!Number.isSafeInteger(fence.readTime) || Object.is(fence.readTime, -0))) fail();
  return `h1.${JSON.stringify([identity(fence), binding, fence.incarnation, fence.revisions, encodeCursor(position), ...(fence.timed ? [fence.readTime] : [])])}`;
}
export function decodeLocalCursor(token: string, fence: LocalFence, binding: string, pages?: Array<Omit<CursorPosition, 'values'>>, schema?: any): string {
  if (!isLocalCursor(token) || token.length > 16_384) fail();
  let payload: any;
  try { payload = JSON.parse(token.slice(3)); } catch { fail(); }
  if (!Array.isArray(payload) || payload.length !== (fence.timed ? 6 : 5) || `h1.${JSON.stringify(payload)}` !== token
    || canonicalJson(payload[0]) !== canonicalJson(identity(fence)) || payload[1] !== binding
    || typeof payload[2] !== 'string' || !Array.isArray(payload[3]) || payload[3].length !== fence.revisions.length
    || payload[3].some((v: any) => !Number.isSafeInteger(v) || v < 0) || typeof payload[4] !== 'string'
    || (fence.timed && (!Number.isSafeInteger(payload[5]) || Object.is(payload[5], -0)))) fail();
  decodeCursor(payload[4]); // Structural decode; current-schema value admission precedes a restart decision.
  if (pages && !pages.some(page => {
    try { decodeCursorFor(payload[4], page, schema); return true; }
    catch (error) { if (!(error instanceof EvalError)) throw error; return false; }
  })) fail();
  if (payload[2] !== fence.incarnation || canonicalJson(payload[3]) !== canonicalJson(fence.revisions)) throw new StaleLocalPage();
  if (fence.timed) fence.readTime = payload[5];
  return payload[4];
}
