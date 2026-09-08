// @ref LLP 1018.003.000#2-correspondence —
// the app names correspondence; the shared query publication attaches work.
import { referenceName, type Op } from "./api.js";
import { intentLabel, type Snapshot } from "./snapshot.js";
import type { OutboxEntry } from "./store/range-store.js";
import { itemAddress } from "./query-frame.js";
export { itemAddress } from "./query-frame.js";

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
export type ItemSnapshot<Result, Row extends ItemRow, Draft> = Snapshot<Result> & {
  readonly items: readonly QueryItem<Row, Draft>[];
};
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
  readonly rows: (data: Result) => readonly unknown[];
  readonly select: (row: unknown) => Row | null | undefined;
  readonly order?: "reverse";
  readonly bindings: readonly Binding<Args, Draft>[];
}

interface ItemSpec<Args, Source, Row, CreateArgs, UpdateArgs, RemoveArgs, Draft> {
  table: string;
  select(row: Source): Row | null | undefined;
  order?: "reverse";
  create?: Create<CreateArgs, Args, Draft>;
  update?: Target<UpdateArgs>;
  remove?: Target<RemoveArgs>;
}
export function defineItems<Args, Result extends readonly unknown[], Row extends ItemRow,
  CreateArgs = never, UpdateArgs = never, RemoveArgs = never, Draft = never>(
  query: Op<Args, Result>,
  spec: ItemSpec<NoInfer<Args>, Element<NoInfer<Result>>, Row, CreateArgs, UpdateArgs, RemoveArgs, Draft>,
): Items<Args, Result, Row, Draft>;
export function defineItems<Args, Result, Source, Row extends ItemRow,
  CreateArgs = never, UpdateArgs = never, RemoveArgs = never, Draft = never>(
  query: Op<Args, Result>,
  spec: ItemSpec<NoInfer<Args>, NoInfer<Source>, Row, CreateArgs, UpdateArgs, RemoveArgs, Draft> & {
    rows(data: NoInfer<Result>): readonly Source[];
  },
): Items<Args, Result, Row, Draft>;
export function defineItems<Args, Result, Source, Row extends ItemRow,
  CreateArgs, UpdateArgs, RemoveArgs, Draft>(
  query: Op<Args, Result>,
  spec: ItemSpec<Args, Source, Row, CreateArgs, UpdateArgs, RemoveArgs, Draft> & { rows?(data: Result): readonly Source[] },
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
  return Object.freeze({ query: referenceName(query), table: spec.table,
    rows: spec.rows ?? ((data: Result) => Array.isArray(data) ? data : []),
    select: spec.select as Items<Args, Result, Row, Draft>["select"],
    ...(spec.order ? { order: spec.order } : {}), bindings: Object.freeze(bindings) });
}

// @ref LLP 1018.006#1-the-declaration — the declaring items alone decide row
// and draft; a history must describe the same table and match those types,
// and custody has one level.
export interface ItemsWithHistory<Args, Result, Row extends ItemRow, Draft, HistoryArgs = unknown, History = unknown>
  extends Items<Args, Result, Row, Draft> {
  readonly history: {
    readonly items: Items<HistoryArgs, History, Row, Draft>;
    /** Pure and deterministic; runs once per observation. */
    readonly args: (args: Args) => HistoryArgs;
  };
}
export function withHistory<Args, Result, Row extends ItemRow, Draft, HistoryArgs, History>(
  items: Items<Args, Result, Row, Draft>,
  history: { items: Items<HistoryArgs, History, NoInfer<Row>, NoInfer<Draft>>; args: (args: NoInfer<Args>) => HistoryArgs },
): ItemsWithHistory<Args, Result, Row, Draft, HistoryArgs, History> {
  if ("history" in items) throw new TypeError("these items already declare a history");
  if ("history" in history.items) throw new TypeError("a history cannot declare a history of its own");
  if (history.items.table !== items.table) {
    throw new TypeError(`history items describe table ${history.items.table}, not ${items.table}`);
  }
  return Object.freeze({ ...items, history: Object.freeze({ items: history.items, args: history.args }) });
}

/** An observed query whose items declare a history (LLP 1018.006 §2). */
export type HistorySnapshot<Result, Row extends ItemRow, Draft, History = unknown> = ItemSnapshot<Result, Row, Draft> & {
  /** Where `items` come from: the usable query, its declared history, or only this device's drafts. */
  readonly itemsFrom: "query" | "history" | "drafts";
  /** The history's own snapshot, present exactly while the query's receipt is partial. */
  readonly history?: Snapshot<History>;
};

// @ref LLP 1018.006#2-the-published-record — eligibility is the composite's
// partial receipt; usability is a complete or capped receipt with data; a
// readable history supplies items; otherwise only this device's drafts,
// republished without the row image a draft may already sit beside.
export function composeHistory<Result, Row extends ItemRow, Draft, History>(
  primary: ItemSnapshot<Result, Row, Draft>,
  history: ItemSnapshot<History, Row, Draft> | undefined,
  previous?: HistorySnapshot<Result, Row, Draft, History>,
): HistorySnapshot<Result, Row, Draft, History> {
  const outcome = primary.receipt?.outcome;
  const eligible = outcome === "partial" ? history : undefined;
  const usable = (outcome === "complete" || outcome === "capped") && primary.data !== undefined;
  const itemsFrom = usable ? "query" : eligible?.status === "ready" ? "history" : "drafts";
  const items = itemsFrom === "query" ? primary.items : itemsFrom === "history" ? eligible!.items
    : draftsOnly(primary.items, previous?.itemsFrom === "drafts" ? previous.items : undefined);
  return Object.freeze({ ...primary, items, itemsFrom, ...(eligible === undefined ? {} : { history: eligible }) });
}

function draftsOnly<Row extends ItemRow, Draft>(
  items: readonly QueryItem<Row, Draft>[], previous: readonly QueryItem<Row, Draft>[] | undefined,
): readonly QueryItem<Row, Draft>[] {
  const before = new Map((previous ?? []).map(item => [item.key, item] as const));
  const drafts = items.filter(item => item.draft !== undefined).map(item => {
    const kept = before.get(item.key);
    if (kept && kept.draft === item.draft && kept.predicted === item.predicted && kept.pending === item.pending) return kept;
    return item.data === undefined ? item : Object.freeze({ key: item.key, draft: item.draft, predicted: item.predicted, pending: item.pending });
  });
  const same = previous !== undefined && previous.length === drafts.length && drafts.every((item, index) => previous[index] === item);
  return same ? previous : Object.freeze(drafts);
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
  /** A complete answer to this query decides page membership, not row contents. */
  readonly selection?: ItemObservation;
  readonly observations: ReadonlyMap<string, ItemObservation>;
  /** Only overlays contributing to this published value, beneath its selectors. */
  readonly predicted: ReadonlyMap<string, readonly { intent: string; kind: ItemActionKind }[]>;
  /** Object identity proves the selector returned a row, not a computed lookalike. */
  readonly values?: ReadonlyMap<object, string>;
}

// @ref LLP 1018.003.000#4-observation-and-retention —
// successful projection is a causal read, not equality with submitted arguments.
function observed(entry: OutboxEntry, observation: ItemObservation | undefined, kind: ItemActionKind): boolean {
  const seq = (entry.response as { seq?: unknown } | undefined)?.seq;
  if (entry.state !== "committed" || typeof seq !== "number" || !Number.isSafeInteger(seq) || !observation) return false;
  const fresh = observation.through > entry.issuedSeq
    || (observation.order !== undefined && entry.order !== undefined && observation.order > entry.order);
  return fresh && observation.through >= seq && (kind !== "remove" || observation.absent === true);
}

const noActions: readonly ItemAction[] = Object.freeze([]);
type Work<Args, Draft> = { entry: OutboxEntry; binding: Binding<Args, Draft>; key?: string; position: number };
interface WorkIndex<Args, Draft> {
  targets: Map<string, Work<Args, Draft>[]>;
  creates: Work<Args, Draft>[];
  intents: Map<string, { entry: OutboxEntry; position: number }>;
}
const indexes = new WeakMap<object, WeakMap<object, WorkIndex<any, any>>>();
// Committed creates below this cut have a post-admission, post-commit query
// answer. Invalid/missing receipts and every non-success stay candidates.
function selectionCut(entry: OutboxEntry): number {
  const seq = (entry.response as { seq?: unknown } | undefined)?.seq;
  return entry.state === "committed" && typeof seq === "number" && Number.isSafeInteger(seq)
    ? Math.max(seq, entry.issuedSeq + 1) : Infinity;
}
function workIndex<Args, Result, Row extends ItemRow, Draft>(
  spec: Items<Args, Result, Row, Draft>, entries: ItemInputs["entries"],
): WorkIndex<Args, Draft> {
  let specs = indexes.get(entries);
  if (!specs) { specs = new WeakMap(); indexes.set(entries, specs); }
  let index = specs.get(spec);
  if (index) return index;
  index = { targets: new Map(), creates: [], intents: new Map() };
  const bindings = new Map<string, Binding<Args, Draft>[]>();
  for (const binding of spec.bindings) bindings.set(binding.op, [...(bindings.get(binding.op) ?? []), binding]);
  for (const [position, entry] of entries.entries()) {
    index.intents.set(entry.intent, { entry, position });
    for (const binding of bindings.get(entry.op) ?? []) {
      const key = binding.key(entry), work = { entry, binding, key, position };
      if (key !== undefined) {
        const target = index.targets.get(key) ?? [];
        target.push(work); index.targets.set(key, target);
      }
      if (binding.kind === "create") index.creates.push(work);
    }
  }
  index.creates.sort((a, b) => selectionCut(b.entry) - selectionCut(a.entry) || a.position - b.position);
  specs.set(spec, index);
  return index;
}
/** Pure join. In particular, reading or projecting an intent never dismisses it. */
export function attachItems<Args, Result, Row extends ItemRow, Draft>(
  spec: Items<Args, Result, Row, Draft>, args: Args, data: Result | undefined,
  inputs: ItemInputs, previous: readonly QueryItem<Row, Draft>[] = [],
): readonly QueryItem<Row, Draft>[] {
  const selected = data === undefined ? [] : spec.rows(data).flatMap(value => {
    const row = spec.select(value);
    return row == null ? [] : [row];
  });
  if (spec.order === "reverse") selected.reverse();
  const items = new Map<string, { key: string; data?: Row; draft?: Draft; predicted: boolean; pending: ItemAction[] }>();
  for (const row of selected) if (!items.has(row.id)) items.set(row.id, {
    key: row.id, data: row, predicted: (!inputs.values || inputs.values.get(row) === itemAddress(spec.table, row.id))
      && inputs.predicted.has(itemAddress(spec.table, row.id)), pending: [],
  });
  const index = workIndex(spec, inputs.entries), work = new Set<Work<Args, Draft>>();
  for (const item of items.values()) {
    for (const target of index.targets.get(item.key) ?? []) work.add(target);
    if (item.predicted) for (const prediction of inputs.predicted.get(itemAddress(spec.table, item.key)) ?? []) {
      const source = index.intents.get(prediction.intent);
      if (source) work.add({ ...source, key: item.key, binding: { op: source.entry.op, kind: prediction.kind, key: () => item.key } });
    }
  }
  for (const create of index.creates) {
    if (selectionCut(create.entry) <= (inputs.selection?.through ?? -1)) break;
    work.add(create);
  }
  const attached = new Map<string, Set<string>>();
  for (const { entry, binding, key } of [...work].sort((a, b) => a.position - b.position)) {
    if (binding.belongs && !binding.belongs(entry, args)) continue;
    let item = key === undefined ? undefined : items.get(key);
    const selected = !item?.data || !inputs.values || inputs.values.get(item.data) === itemAddress(spec.table, key!);
    const observation = key === undefined || !selected ? undefined : inputs.observations.get(itemAddress(spec.table, key));
    // A positive observation resolves a create only when this view contains its
    // row. Explicit absence can resolve an omitted target without inventing one.
    const contributing = key !== undefined && inputs.predicted.get(itemAddress(spec.table, key))?.some(mark => mark.intent === entry.intent);
    if (!contributing && (item || observation?.absent) && observed(entry, observation, binding.kind)) continue;
    // A post-commit answer to this exact query may exclude an old create from
    // this page. It cannot settle an indicator on a displayed, unobserved row.
    if (!item && binding.kind === "create" && observed(entry, inputs.selection, "create")) continue;
    if (!item && binding.kind !== "create") continue;
    if (!item) {
      const stableKey = key ?? `intent:${entry.intent}`;
      item = items.get(stableKey) ?? { key: stableKey, draft: binding.draft!(entry), predicted: false, pending: [] };
      items.set(stableKey, item);
    }
    // Keep the submitted representation available while a create is pending,
    // including when another presentation cannot yet authorize its row image.
    if (binding.draft && item.draft === undefined) item.draft = binding.draft(entry);
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

function sameValue(left: unknown, right: unknown, seen = new WeakMap<object, object>()): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object"
    || Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;
  if (!Array.isArray(left) && Object.getPrototypeOf(left) !== Object.prototype) return false;
  if (seen.has(left)) return seen.get(left) === right;
  seen.set(left, right);
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key)
    && sameValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], seen));
}
