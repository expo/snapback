import type { Refusal } from "./contract.ts";

export type Run = [number, number];
export interface DeliveryBinding { table: string; mutation: string; args: [string, string, string] }
export interface DeliveryRefused extends DeliveryBinding { group: string; from: number; through: number; why: Refusal }
export interface Attempt { id: string; run: Run; retries: number; readyAt: number }
export interface Parked { run: Run; kind: "full" | "start" | "retry"; at: number; ready?: boolean; attempt?: Attempt }
export interface DeliveryGroup {
  binding: DeliveryBinding; group: string; incarnation: number; collected: number;
  owed: Run[]; reported: Run[]; refused: Run[]; parked: Parked[];
  saturated: boolean; wake: boolean; ready: number; attempt?: Attempt;
  /** New collections since the current attempt; online membership refusals cannot erase them. */
  recent: Run[];
  scope?: string;
}
export interface DeliveryState {
  serial: number;
  groups: Record<string, DeliveryGroup>;
  retired: Record<string, { refused: Run[]; saturated: boolean; scope?: string | undefined }>;
  // The device owns these fields; queue transactions preserve them.
  cursors?: Record<string, unknown>;
  bindings?: unknown;
}
export const emptyDelivery = (): DeliveryState => ({ serial: 0, groups: {}, retired: {} });
export const deliveryKey = (b: DeliveryBinding, group: string) => JSON.stringify([b.table, b.mutation, group]);
export function mergeRuns(runs: Run[]): Run[] {
  const merged: Run[] = [];
  for (const [a, b] of [...runs].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}
export function subtractRuns(runs: Run[], covered: Run[]): Run[] {
  let result = runs;
  for (const [a, b] of covered) result = result.flatMap(([x, y]): Run[] =>
    b < x || a > y ? [[x, y]] : [...(x < a ? [[x, a - 1] as Run] : []), ...(y > b ? [[b + 1, y] as Run] : [])]);
  return result;
}
export function groupFor(state: DeliveryState, binding: DeliveryBinding, group: string, cap: number): DeliveryGroup {
  const key = deliveryKey(binding, group);
  let value: DeliveryGroup | undefined = state.groups[key];
  if (value && JSON.stringify(value.binding.args) !== JSON.stringify(binding.args)) {
    delete state.groups[key]; delete state.retired[key]; value = undefined;
  }
  if (!value) {
    if (Object.keys(state.groups).length >= cap) {
      const oldest = Object.entries(state.groups).sort(([, a], [, b]) => a.collected - b.collected)[0]!;
      if (oldest[1].refused.length || oldest[1].saturated) state.retired[oldest[0]] = { refused: oldest[1].refused, saturated: oldest[1].saturated, scope: oldest[1].scope };
      delete state.groups[oldest[0]];
    }
    const kept = state.retired[key];
    value = state.groups[key] = { binding, group, incarnation: ++state.serial, collected: state.serial,
      owed: [], reported: [], refused: kept?.refused ?? [], saturated: kept?.saturated ?? false,
      parked: [], wake: false, ready: state.serial, recent: [] };
  }
  return value;
}
export function collectRuns(state: DeliveryState, value: DeliveryGroup, runs: Run[]): void {
  if (value.saturated) return;
  value.collected = ++state.serial;
  value.wake = true;
  const fresh = subtractRuns(mergeRuns(runs), [...value.reported, ...value.refused, ...value.parked.map(p => p.run)]);
  value.owed = mergeRuns([...value.owed, ...fresh]);
  value.recent = mergeRuns([...value.recent, ...fresh]).slice(-256);
  boundDebt(value);
}
/** Collection and outcomes can both split intervals; enforce the same bound. */
export function boundDebt(value: DeliveryGroup): void {
  // Parked runs count towards the same debt bound. Lowest positions are lost first.
  while (value.owed.length + value.parked.length > 256) {
    const p = value.parked.reduce((min, item, i, all) => item.run[0] < all[min]!.run[0] ? i : min, 0);
    if (!value.parked.length || (value.owed[0]?.[0] ?? Infinity) < value.parked[p]!.run[0]) value.owed.shift();
    else value.parked.splice(p, 1);
  }
  // An evicted uncertain interval cannot survive secretly in the attempt.
  if (value.attempt && subtractRuns([value.attempt.run], value.owed).length) delete value.attempt;
}
export function acceptManifest(state: DeliveryState, manifest: unknown, cap: number): boolean {
  if (!Array.isArray(manifest)) return false;
  let changed = false;
  for (const item of manifest) {
    if (!item || typeof item.table !== "string" || typeof item.mutation !== "string"
      || !Array.isArray(item.args) || item.args.length !== 3 || !item.args.every((s: unknown) => typeof s === "string") || !Array.isArray(item.rows)) continue;
    const binding: DeliveryBinding = { table: item.table, mutation: item.mutation, args: item.args };
    const groups = new Map<string, Run[]>();
    for (const row of item.rows) if (Array.isArray(row) && typeof row[0] === "string" && Number.isSafeInteger(row[1])) {
      const runs = groups.get(row[0]) ?? []; runs.push([row[1], row[1]]); groups.set(row[0], runs);
    }
    for (const [group, runs] of groups) { collectRuns(state, groupFor(state, binding, group, cap), runs); changed = true; }
  }
  return changed;
}
