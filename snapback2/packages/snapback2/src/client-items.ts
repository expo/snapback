// @ref LLP 1018.003#8-declare-correspondence-once-keep-mechanics-in-the-sdk —
// the app names correspondence; the shared query publication attaches work.
import { referenceName, type Op } from "./api.js";
import { intentLabel } from "./snapshot.js";
import type { OutboxEntry } from "./store/range-store.js";

type Element<Result> = Result extends readonly (infer Row)[] ? Row : never;
export type ItemRow = { readonly id: string };
export type ItemActionKind = "create" | "update" | "remove";
export interface ItemAction {
  readonly intent: string;
  readonly op: string;
  readonly kind: ItemActionKind;
  readonly state: OutboxEntry["state"];
  readonly label: string;
  readonly dismissible: boolean;
  readonly response?: unknown;
}
export interface QueryItem<Row, Draft> {
  readonly key: string;
  readonly data?: Row;
  readonly draft?: Draft;
  readonly predicted: boolean;
  readonly pending: readonly ItemAction[];
}
interface Create<Args, Query, Draft> {
  op: Op<Args, unknown>;
  belongs(args: NoInfer<Args>, query: Query): boolean;
  key(intent: Readonly<OutboxEntry>): string | undefined;
  draft(args: NoInfer<Args>): Draft;
}
interface Target<Args> {
  op: Op<Args, unknown>;
  key(args: NoInfer<Args>): string | undefined;
}
interface Binding<Query, Draft> {
  readonly op: string;
  readonly kind: ItemActionKind;
  key(entry: OutboxEntry): string | undefined;
  belongs?(entry: OutboxEntry, args: Query): boolean;
  draft?(entry: OutboxEntry): Draft;
}
/** An inert presentation declaration. The named query still owns data and its receipt. */
export interface Items<Args, Result, Row extends ItemRow, Draft> {
  readonly query: string;
  readonly table: string;
  readonly select: (row: Element<Result>) => Row | null | undefined;
  readonly order?: "reverse";
  readonly bindings: readonly Binding<Args, Draft>[];
}

export function defineItems<Args, Result extends readonly unknown[], Row extends ItemRow,
  CreateArgs = never, UpdateArgs = never, RemoveArgs = never, Draft = never>(
  query: Op<Args, Result>,
  spec: {
    table: string;
    select(row: Element<NoInfer<Result>>): Row | null | undefined;
    order?: "reverse";
    create?: Create<CreateArgs, NoInfer<Args>, Draft>;
    update?: Target<UpdateArgs>;
    remove?: Target<RemoveArgs>;
  },
): Items<Args, Result, Row, Draft> {
  const bindings: Binding<Args, Draft>[] = [];
  if (spec.create) {
    const { op, belongs, key, draft } = spec.create;
    bindings.push(Object.freeze({ op: referenceName(op), kind: "create", key,
      belongs: (entry: OutboxEntry, args: Args) => belongs(entry.args as CreateArgs, args),
      draft: (entry: OutboxEntry) => draft(entry.args as CreateArgs) }));
  }
  const target = <A>(kind: "update" | "remove", binding: Target<A> | undefined) => {
    if (!binding) return;
    const { op, key } = binding;
    bindings.push(Object.freeze({ op: referenceName(op), kind, key: (entry: OutboxEntry) => key(entry.args as A) }));
  };
  target("update", spec.update);
  target("remove", spec.remove);
  return Object.freeze({ query: referenceName(query), table: spec.table, select: spec.select,
    ...(spec.order ? { order: spec.order } : {}), bindings: Object.freeze(bindings) });
}

/** Private evidence bound to the value being published, never a partition watermark. */
export interface ItemObservation {
  /** The owner read this exact authoritative base through this sequence. */
  readonly through: number;
  /** Durable observation order, when an unchanged read must advance admission. */
  readonly order?: number;
  readonly absent?: true;
}
export interface ItemInputs {
  readonly entries: readonly OutboxEntry[];
  readonly observations: ReadonlyMap<string, ItemObservation>;
  /** Only overlays contributing to this published value, beneath its selectors. */
  readonly predicted: ReadonlyMap<string, readonly { intent: string; kind: ItemActionKind }[]>;
}
export const itemAddress = (table: string, id: string): string => `${table}\0${id}`;

// @ref LLP 1018.003#10-retirement-is-a-read-model-decision-dismissal-is-a-write —
// successful projection is a causal read, not equality with submitted arguments.
function observed(entry: OutboxEntry, observation: ItemObservation | undefined, kind: ItemActionKind): boolean {
  const seq = (entry.response as { seq?: unknown } | undefined)?.seq;
  if (entry.state !== "committed" || typeof seq !== "number" || !Number.isSafeInteger(seq) || !observation) return false;
  const fresh = observation.through > entry.issuedSeq
    || (observation.order !== undefined && entry.order !== undefined && observation.order > entry.order);
  return fresh && observation.through >= seq && (kind !== "remove" || observation.absent === true);
}

const noActions: readonly ItemAction[] = Object.freeze([]);
/** Pure join. In particular, reading or projecting an intent never dismisses it. */
export function attachItems<Args, Result, Row extends ItemRow, Draft>(
  spec: Items<Args, Result, Row, Draft>, args: Args, data: Result | undefined,
  inputs: ItemInputs, previous: readonly QueryItem<Row, Draft>[] = [],
): readonly QueryItem<Row, Draft>[] {
  const selected = Array.isArray(data) ? data.flatMap(value => {
    const row = spec.select(value);
    return row == null ? [] : [row];
  }) : [];
  if (spec.order === "reverse") selected.reverse();
  const items = new Map<string, { key: string; data?: Row; draft?: Draft; predicted: boolean; pending: ItemAction[] }>();
  for (const row of selected) if (!items.has(row.id)) items.set(row.id, {
    key: row.id, data: row, predicted: inputs.predicted.has(itemAddress(spec.table, row.id)), pending: [],
  });
  const bindings = new Map<string, Binding<Args, Draft>[]>();
  for (const binding of spec.bindings) bindings.set(binding.op, [...(bindings.get(binding.op) ?? []), binding]);
  const predictions = new Map<string, Binding<Args, Draft>[]>();
  for (const item of items.values()) for (const prediction of inputs.predicted.get(itemAddress(spec.table, item.key)) ?? []) {
    const related = predictions.get(prediction.intent) ?? [];
    related.push({ op: "", kind: prediction.kind, key: () => item.key });
    predictions.set(prediction.intent, related);
  }
  const attached = new Map<string, Set<string>>();
  for (const entry of inputs.entries) for (const binding of [...(bindings.get(entry.op) ?? []), ...(predictions.get(entry.intent) ?? [])]) {
    if (binding.belongs && !binding.belongs(entry, args)) continue;
    const key = binding.key(entry);
    const observation = key === undefined ? undefined : inputs.observations.get(itemAddress(spec.table, key));
    let item = key === undefined ? undefined : items.get(key);
    // A positive observation resolves a create only when this view contains its
    // row. Explicit absence can resolve an omitted target without inventing one.
    const contributing = key !== undefined && inputs.predicted.get(itemAddress(spec.table, key))?.some(mark => mark.intent === entry.intent);
    if (!contributing && (item || observation?.absent) && observed(entry, observation, binding.kind)) continue;
    if (!item && binding.kind !== "create") continue;
    if (!item) {
      const stableKey = key ?? `intent:${entry.intent}`;
      item = items.get(stableKey) ?? { key: stableKey, draft: binding.draft!(entry), predicted: false, pending: [] };
      items.set(stableKey, item);
    }
    const seen = attached.get(item.key) ?? new Set<string>();
    if (seen.has(entry.intent)) continue;
    seen.add(entry.intent);
    attached.set(item.key, seen);
    item.pending.push({ intent: entry.intent, op: entry.op, kind: binding.kind, state: entry.state,
      label: intentLabel(entry), dismissible: entry.state !== "queued",
      ...(entry.response === undefined ? {} : { response: entry.response }) });
  }
  const prior = new Map(previous.map(item => [item.key, item]));
  const result = [...items.values()].map(item => {
    const old = prior.get(item.key);
    const pending = item.pending.length === 0 ? noActions : item.pending;
    if (old && old.data === item.data && old.predicted === item.predicted
      && sameValue(old.draft, item.draft) && sameValue(old.pending, pending)) return old;
    return Object.freeze({ ...item, pending: Object.freeze(pending) });
  });
  return result.length === previous.length && result.every((item, at) => item === previous[at]) ? previous : Object.freeze(result);
}

function sameValue(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}
