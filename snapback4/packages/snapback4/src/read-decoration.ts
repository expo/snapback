import type { Read } from "./contract.ts";
import type { ProgramJson } from "./backend.ts";

// @ref LLP 3000.028#3.3.1 — the page-wide deadline cannot prove any individual
// decoration fresh. Mask all point-dependent output fields, never source fields.
const fields = new WeakMap<ProgramJson, string[]>();
export function decorationFields(program: ProgramJson | undefined): string[] {
  if (!program) return [];
  const cached = fields.get(program); if (cached) return cached;
  const object = (value: unknown): Record<string, any> => value && typeof value === "object" ? value as Record<string, any> : {};
  const point = (value: unknown): boolean => {
    const expr = object(value);
    if (expr.Get) return true;
    if (expr.Field) return point(object(expr.Field).base);
    if (expr.Shape || expr.Object) return Object.values(object(expr.Object ?? object(expr.Shape).fields)).some(point);
    if (expr.Builtin) return (object(expr.Builtin).args ?? []).some(point);
    return false;
  };
  const loop = object(object(program.body[1]).For), push = object(object(loop.body?.[0]).Push);
  const value = object(push.value), projection = object(value.Object ?? object(value.Shape).fields);
  const names = Object.keys(projection).filter(key => point(projection[key]));
  fields.set(program, names); return names;
}
type Values = { fields: readonly string[]; device: number | null; server: number | null; deviceNow(): number; serverNow(): number };
const values = new WeakMap<object, Values>();
const masked = new WeakMap<object, Read<unknown>>();
export const decorationDue = (deadline: number | null | undefined, now: number): boolean => deadline != null && (!Number.isFinite(deadline) || deadline <= now);
export function withDecorations<T>(read: Read<T>, fields: readonly string[], device: number | null, server: number | null,
  deviceNow: () => number, serverNow: () => number): Read<T> {
  if (fields.length && "data" in read) values.set(read, { fields, device, server, deviceNow, serverNow });
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
  const data = read.data.map(row => {
    if (!row || typeof row !== "object") return row;
    const copy = { ...row as Record<string, unknown> };
    for (const field of value.fields) if (Object.hasOwn(copy, field)) copy[field] = null;
    return copy;
  }) as T;
  const next = { ...read, data } as Read<T>; masked.set(read, next); masked.set(next, next); values.set(next, value); return next;
}
