import type { Read } from "./contract.ts";
import type { ProgramJson } from "./backend.ts";

// @ref LLP 3000.028#3.3.1 — the page-wide deadline cannot prove any individual
// decoration fresh. Mask all point-dependent output fields, never source fields.
export type DecorationPaths = readonly (readonly string[])[];
// Required on every internal query result, including loading and refusals.
// null proves no deadline; NaN records an unknown decoration deadline.
export interface ValueDeadlines { valueDevice: number | null; valueServer: number | null }
export function valueDeadline(value: unknown, decorated: boolean): number | null {
  return typeof value === "number" ? value : value === null || !decorated ? null : NaN;
}
export function mergeValueDeadlines(a: ValueDeadlines, b: ValueDeadlines): ValueDeadlines {
  const earliest = (a: number | null, b: number | null) => a === null ? b : b === null ? a : Math.min(a, b);
  return { valueDevice: earliest(a.valueDevice, b.valueDevice), valueServer: earliest(a.valueServer, b.valueServer) };
}
const paths = new WeakMap<ProgramJson, DecorationPaths>();
export function decorationPaths(program: ProgramJson | undefined): DecorationPaths {
  if (!program) return [];
  const cached = paths.get(program); if (cached) return cached;
  const object = (value: unknown): Record<string, any> => value && typeof value === "object" ? value as Record<string, any> : {};
  const output = (value: unknown): Record<string, any> => {
    const expr = object(value), field = object(expr.Field);
    if (field.base) {
      const base = output(field.base), projection = object(base.Object ?? object(base.Shape).fields);
      if (Object.hasOwn(projection, field.name)) return output(projection[field.name]);
    }
    return expr;
  };
  const point = (value: unknown): boolean => {
    const expr = output(value);
    if (expr.Get) return true;
    if (expr.Field) return point(object(expr.Field).base);
    if (expr.Shape || expr.Object) return Object.values(object(expr.Object ?? object(expr.Shape).fields)).some(point);
    if (expr.Builtin) return (object(expr.Builtin).args ?? []).some(point);
    return false;
  };
  const loop = object(object(program.body[1]).For), push = object(object(loop.body?.[0]).Push);
  const found: string[][] = [];
  const visit = (value: unknown, path: string[]) => {
    const expr = output(value), projection = expr.Object ?? object(expr.Shape).fields;
    if (projection) for (const [key, child] of Object.entries(object(projection))) visit(child, [...path, key]);
    else if (point(value)) found.push(path);
  };
  visit(push.value, []);
  paths.set(program, found); return found;
}
type Values = { paths: DecorationPaths; device: number | null; server: number | null; deviceNow(): number; serverNow(): number };
const values = new WeakMap<object, Values>();
const masked = new WeakMap<object, Read<unknown>>();
export const decorationDue = (deadline: number | null | undefined, now: number): boolean => deadline != null && (!Number.isFinite(deadline) || deadline <= now);
export function withDecorations<T>(read: Read<T>, paths: DecorationPaths, device: number | null, server: number | null,
  deviceNow: () => number, serverNow: () => number): Read<T> {
  if (paths.length && "data" in read) values.set(read, { paths, device, server, deviceNow, serverNow });
  return read;
}
export function copyDecorations<T extends object>(from: object, to: T): T {
  const value = values.get(from); if (value) values.set(to, value);
  return to;
}
export function currentDecorations<T>(read: Read<T>): Read<T> {
  const value = values.get(read);
  if (!value || !("data" in read) || !Array.isArray(read.data)
    || !(decorationDue(value.device, value.deviceNow()) || decorationDue(value.server, value.serverNow()))) return read;
  const cached = masked.get(read); if (cached) return cached as Read<T>;
  const mask = (row: unknown, path: readonly string[], depth = 0): unknown => {
    if (depth === path.length) return null;
    const key = path[depth]!;
    if (!row || typeof row !== "object" || !Object.hasOwn(row, key)) return row;
    const object = row as Record<string, unknown>;
    return { ...object, [key]: mask(object[key], path, depth + 1) };
  };
  const data = read.data.map(row => value.paths.reduce<unknown>((row, path) => mask(row, path), row)) as T;
  const next = { ...read, data } as Read<T>; masked.set(read, next); masked.set(next, next); values.set(next, value); return next;
}
