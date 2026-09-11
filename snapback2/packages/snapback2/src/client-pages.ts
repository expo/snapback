import { referenceName, referencePath, type Op } from "./api.js";
import { composeHistory, withoutHistory, type HistorySnapshot, type ItemRow, type Items,
  type ItemSnapshot, type ItemsWithHistory, type QueryItem } from "./client-items.js";
import { workModel } from "./client-outbox-observed.js";
import { itemInputs } from "./query-frame.js";
import { operationArgs } from "./store/canonical.js";
import { summarize, type Snapshot } from "./snapshot.js";
import { initialQueryState, type ConnectionState, type Cursor, type ObservedQuery } from "./types.js";
import { toRefusal } from "./client-wire.js";

interface PageState {
  loadMore(): void;
  readonly hasMore: boolean;
  readonly status: Snapshot<unknown>["status"];
  readonly reason?: Snapshot<unknown>["reason"];
}
export interface PageSnapshot<Result extends readonly unknown[]> extends PageState {
  readonly items: readonly Result[number][];
  readonly pages: readonly Snapshot<Result>[];
}
export type ItemPageSnapshot<Result, Row extends ItemRow, Draft, History = never> = PageState & {
  /** Only the primary head supplies scalar authority. */
  readonly head: ItemSnapshot<Result, Row, Draft>;
  readonly items: readonly QueryItem<Row, Draft>[];
} & (
  | { readonly itemsFrom: "query"; readonly pages: readonly ItemSnapshot<Result, Row, Draft>[]; readonly history?: undefined }
  | { readonly itemsFrom: "drafts"; readonly pages: readonly []; readonly history?: ItemSnapshot<History, Row, Draft> }
  | ([History] extends [never] ? never : {
    readonly itemsFrom: "history"; readonly pages: readonly ItemSnapshot<History, Row, Draft>[];
    readonly history: ItemSnapshot<History, Row, Draft>;
  })
);
export interface ObservedPages<Value> {
  getSnapshot(): Value;
  subscribe(notify: () => void): () => void;
}
export interface ObservePages {
  <Args, Result, Row extends ItemRow, Draft, HistoryArgs, History, Key extends string = "c">(
    ref: Op<Args, Result>, args: NoInfer<Omit<Args, Key>>,
    options: { cursor?: Key; items: ItemsWithHistory<Args, Result, Row, Draft, HistoryArgs, History> },
  ): ObservedPages<ItemPageSnapshot<Result, Row, Draft, History>>;
  <Args, Result, Row extends ItemRow, Draft, Key extends string = "c">(
    ref: Op<Args, Result>, args: NoInfer<Omit<Args, Key>>, options: { cursor?: Key; items: Items<Args, Result, Row, Draft> },
  ): ObservedPages<ItemPageSnapshot<Result, Row, Draft>>;
  <Args, Result extends readonly unknown[], Key extends string = "c">(
    ref: Op<Args, Result>, args: NoInfer<Omit<Args, Key>>, options?: { cursor?: Key; items?: undefined },
  ): ObservedPages<PageSnapshot<Result>>;
}
export interface PageOptions<Args, Result, Row extends ItemRow = ItemRow, Draft = unknown> {
  cursor?: string;
  items?: Items<Args, Result, Row, Draft>;
}
export interface PageHost {
  observe(ref: Op<any, any>, args: any, options?: any): ObservedQuery<any, any>;
  cursor?(op: string): string | null | undefined;
  prepare?(op: string): Promise<string | undefined>;
  active?(): boolean;
  connection?(): ConnectionState;
  retain?(pages: ClientPages<any, any>): () => void;
}

type Page = Snapshot<any> & { readonly items?: readonly QueryItem<any, any>[] };
type Entry = { cursor: Cursor | null; query: ObservedQuery<any, any>; off?: () => void };
type Attachment = { notify: () => void; closed: boolean };
const empty = Object.freeze([]) as readonly never[];
const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((value, i) => value === b[i]);

/** A live cursor chain, shared by primary arrays, composite items, and history. */
class PageChain {
  private entries: Entry[] = [];
  constructor(private readonly host: PageHost, private readonly ref: Op<any, any>,
    private readonly args: any, private readonly cursor: string | null, private readonly items?: Items<any, any, any, any>) {}

  reconcile(wanted: number, listening: boolean, notify: () => void): void {
    let next: Cursor | null = this.cursor === null ? null : this.args[this.cursor] ?? null;
    const visited = new Set<Cursor>();
    let length = 0;
    for (; length < wanted; length++) {
      if (length > 0 && (next === null || visited.has(next))) break;
      if (next !== null) visited.add(next);
      let entry = this.entries[length];
      if (entry && entry.cursor !== next) { this.trim(length); entry = undefined!; }
      if (!entry) {
        const args = this.cursor === null ? this.args : { ...this.args, [this.cursor]: next };
        entry = { cursor: next, query: this.host.observe(this.ref, args, this.items ? { items: this.items } : undefined) };
        this.entries.push(entry);
      }
      if (listening && !entry.off) {
        const captured = entry;
        entry.off = entry.query.subscribe(() => { if (this.entries.includes(captured)) notify(); });
      }
      next = entry.query.getSnapshot().next;
    }
    this.trim(length);
  }
  snapshots(): readonly Page[] {
    const pages: Page[] = [];
    let next: Cursor | null = this.cursor === null ? null : this.args[this.cursor] ?? null;
    const visited = new Set<Cursor>();
    for (const entry of this.entries) {
      if (entry.cursor !== next || (pages.length > 0 && (next === null || visited.has(next)))) break;
      if (next !== null) visited.add(next);
      const page = entry.query.getSnapshot();
      pages.push(page); next = page.next;
    }
    return pages;
  }
  trim(length: number): void { for (const entry of this.entries.splice(length)) entry.off?.(); }
  detach(): void { for (const entry of this.entries) { entry.off?.(); entry.off = undefined; } }
}

function pageItems(pages: readonly Page[], binding: Items<any, any, any, any>, previous: readonly QueryItem<any, any>[]) {
  const rows = new Map<string, QueryItem<any, any>>();
  const drafts = new Map<string, { item: QueryItem<any, any>; order: number }>();
  for (const page of pages) {
    const selected = (page.items ?? empty).filter(item => item.data !== undefined);
    if (binding.order === "reverse") selected.reverse();
    for (const item of selected) if (!rows.has(item.key)) rows.set(item.key, item);
    for (const item of page.items ?? empty) {
      if (item.data !== undefined || item.draft === undefined || drafts.has(item.key)) continue;
      const inputs = itemInputs(page), intent = item.pending.find(action => action.kind === "create")?.intent;
      const entry = inputs && intent ? workModel(inputs.entries).byIntent.get(intent)?.entry : undefined;
      drafts.set(item.key, { item, order: entry?.order ?? Infinity });
    }
  }
  const result = [...rows.values()];
  if (binding.order === "reverse") result.reverse();
  result.push(...[...drafts.values()].filter(value => !rows.has(value.item.key))
    .sort((a, b) => a.order - b.order).map(value => value.item));
  return same(result, previous) ? previous : Object.freeze(result);
}

/** @ref LLP 1018.008.005.000#page-and-history-lifecycle — one active source,
 * independently bound cursors, and no receipt for the accumulated collection. */
export class ClientPages<Args, Result> implements ObservedPages<any> {
  private readonly ref: Op<Args, Result>;
  private readonly args: Args;
  private readonly options: PageOptions<Args, Result, any, any>;
  private readonly declared?: ItemsWithHistory<Args, Result, any, any, any, any>;
  private readonly primaryItems?: Items<Args, Result, any, any>;
  private primary?: PageChain;
  private history?: PageChain;
  private mapped?: any;
  private primaryPending?: Promise<void>;
  private historyPending?: Promise<void>;
  private primaryFailure?: Page;
  private historyFailure?: Page;
  private wanted = 1;
  private readonly listeners = new Set<Attachment>();
  private release?: () => void;
  private retired = false;
  private refreshing = false;
  private again = false;
  private readonly initial: Page;
  private readonly fallback: any;
  private basis: readonly unknown[] = [];
  private snapshot: any;
  private notified: any;
  private composition?: HistorySnapshot<any, any, any, any>;

  constructor(private readonly host: PageHost, ref: Op<Args, Result>, args: unknown,
    options: PageOptions<Args, Result, any, any> | string = {}) {
    const op = referenceName(ref);
    this.ref = Object.freeze({ op, [referencePath]: op }) as Op<Args, Result>;
    this.args = structuredClone(args) as Args;
    this.options = typeof options === "string" ? { cursor: options } : { ...options };
    const items = this.options.items;
    this.primaryItems = items && withoutHistory(items);
    this.declared = items && "history" in items ? items as ItemsWithHistory<Args, Result, any, any, any, any> : undefined;
    this.initial = Object.freeze({ ...summarize(initialQueryState(), host.connection?.() ?? "reconnecting"), ...(items ? { items: empty } : {}) });
    this.fallback = Object.freeze({ ...(items ? { head: this.initial, itemsFrom: "drafts" } : {}),
      items: empty, pages: empty, status: this.initial.status, hasMore: false, loadMore: this.loadMore });
    this.snapshot = this.fallback;
    this.notified = this.fallback;
    this.refresh();
  }
  private active(): boolean { return !this.retired && (this.host.active?.() ?? true); }
  private cursor(op: string, primary: boolean): string | null | undefined {
    if (primary && (this.options.cursor !== undefined || !this.primaryItems)) return this.options.cursor ?? "c";
    const declared = this.host.cursor?.(op);
    return declared === undefined && !this.host.prepare ? "c" : declared;
  }
  private initialize(primary: boolean, cursor: string | null): void {
    if (primary) {
      const args = operationArgs(cursor === null ? this.args : { ...(this.args as any), [cursor]: null }, cursor);
      this.primary = new PageChain(this.host, this.ref, args, cursor, this.primaryItems);
      if (this.declared) this.mapped = structuredClone(this.declared.history.args(args as Args));
    } else {
      const binding = this.declared!.history.items, op = binding.query;
      const ref = Object.freeze({ op, [referencePath]: op }) as Op<any, any>;
      this.history = new PageChain(this.host, ref, operationArgs(this.mapped, cursor), cursor, binding);
    }
  }
  private prepare(primary: boolean): void {
    const op = primary ? referenceName(this.ref) : this.declared!.history.items.query;
    if (primary ? this.primary || this.primaryFailure : this.history || this.historyFailure) return;
    const cursor = this.cursor(op, primary);
    if (cursor !== undefined) { this.initialize(primary, cursor); return; }
    if (!this.listeners.size || (primary ? this.primaryPending : this.historyPending)) return;
    const pending = this.host.prepare!(op).then(value => {
      if (!this.active()) return;
      const known = this.host.cursor?.(op);
      this.initialize(primary, known === undefined ? value ?? null : known);
    }, error => {
      if (!this.active()) return;
      const refused = Object.freeze({ ...summarize({ state: "refused", live: false, refusal: toRefusal(error) },
        this.host.connection?.() ?? "reconnecting"), items: empty });
      if (primary) this.primaryFailure = refused; else this.historyFailure = refused;
    }).then(() => { if (this.active()) this.refresh(); });
    if (primary) this.primaryPending = pending; else this.historyPending = pending;
  }
  private select(primary: Page, history?: Page): HistorySnapshot<any, any, any, any> {
    if (!this.declared && primary.data !== undefined && primary.status === "ready") {
      return { ...primary, items: primary.items ?? empty, itemsFrom: "query" } as HistorySnapshot<any, any, any, any>;
    }
    return composeHistory(primary as ItemSnapshot<any, any, any>, history as ItemSnapshot<any, any, any> | undefined, this.composition);
  }
  private refresh = (): void => {
    if (this.refreshing) { this.again = true; return; }
    if (!this.active()) { this.retire(); return; }
    this.refreshing = true;
    try {
      do {
        this.again = false;
        this.prepare(true);
        const wasPrimary = !this.primaryItems || this.snapshot.itemsFrom === "query";
        this.primary?.reconcile(wasPrimary ? this.wanted : 1, this.listeners.size > 0, this.refresh);
        const head = this.primary?.snapshots()[0] ?? this.primaryFailure ?? this.initial;
        const eligible = !!this.declared && head.receipt?.state === "partial";
        if (eligible) {
          this.prepare(false);
          this.history?.reconcile(this.snapshot.itemsFrom === "history" ? this.wanted : 1, this.listeners.size > 0, this.refresh);
        } else {
          this.history?.trim(0); this.history = undefined;
        }
        const fallback = eligible ? this.history?.snapshots()[0] ?? this.historyFailure ?? this.initial : undefined;
        const from = this.primaryItems ? this.select(head, fallback).itemsFrom : "query";
        if (from === "query") this.primary?.reconcile(this.wanted, this.listeners.size > 0, this.refresh);
        else {
          this.primary?.trim(1);
          if (from === "history") this.history?.reconcile(this.wanted, this.listeners.size > 0, this.refresh);
          else this.history?.trim(1);
        }
        this.project();
        if (this.snapshot !== this.notified) { this.notified = this.snapshot; this.notify(); }
      } while (this.again);
    } finally { this.refreshing = false; }
  };
  private project(): void {
    const primaryPages = this.primary?.snapshots() ?? empty;
    const rawHead = primaryPages[0] ?? this.primaryFailure ?? this.initial;
    const eligible = !!this.declared && rawHead.receipt?.state === "partial";
    const historyPages = eligible ? this.history?.snapshots() ?? empty : empty;
    const historyHead = eligible ? historyPages[0] ?? this.historyFailure ?? this.initial : undefined;
    const basis = [rawHead, historyHead, ...primaryPages, ...historyPages];
    if (same(basis, this.basis)) return;
    this.basis = basis;
    let pages = primaryPages, head = rawHead, from = "query", history: Page | undefined;
    if (this.primaryItems) {
      const composed = this.select(rawHead, historyHead);
      this.composition = composed; from = composed.itemsFrom;
      if (this.declared && from !== "query") head = Object.freeze({ ...rawHead, data: undefined });
      history = historyHead;
      pages = from === "query" ? primaryPages : from === "history" ? historyPages : empty;
    }
    const states = pages.length ? pages : [head, ...(history ? [history] : [])];
    const unavailable = states.find(page => page.status === "unavailable");
    const loading = states.find(page => page.status === "loading");
    const reason = states.find(page => page.reason?.code === "refused")?.reason ?? unavailable?.reason ?? states.find(page => page.reason)?.reason;
    const status = unavailable ? "unavailable" : loading ? "loading" : "ready";
    const items = this.primaryItems ? from === "drafts" ? this.composition!.items
      : pageItems(pages, from === "history" ? this.declared!.history.items : this.primaryItems, this.snapshot.items)
      : Object.freeze(pages.flatMap(page => page.data ? [...page.data] : []));
    this.snapshot = Object.freeze({
      ...(this.primaryItems ? { head, itemsFrom: from, ...(history ? { history } : {}) } : {}),
      items, pages: Object.freeze([...pages]), status, ...(reason ? { reason } : {}),
      hasMore: pages.at(-1)?.next != null, loadMore: this.loadMore,
    });
  }
  private notify(): void {
    for (const attachment of [...this.listeners]) {
      if (!attachment.closed) try { attachment.notify(); } catch { /* independent consumers */ }
    }
  }
  private loadMore = (): void => {
    const snapshot = this.getSnapshot();
    if (!this.active() || !snapshot.hasMore || snapshot.status === "loading") return;
    this.wanted = snapshot.pages.length + 1;
    this.refresh();
  };
  getSnapshot = (): any => {
    if (!this.active()) return this.fallback;
    this.project();
    return this.snapshot;
  };
  subscribe = (notify: () => void): (() => void) => {
    if (!this.active()) return () => undefined;
    const attachment = { notify, closed: false };
    this.listeners.add(attachment);
    this.release ??= this.host.retain?.(this);
    this.refresh();
    return () => {
      if (attachment.closed) return;
      attachment.closed = true; this.listeners.delete(attachment);
      if (!this.listeners.size) {
        this.primary?.detach(); this.history?.detach();
        this.release?.(); this.release = undefined;
      }
    };
  };
  retire(): void {
    if (this.retired) return;
    this.retired = true; this.primary?.trim(0); this.history?.trim(0);
    this.release?.(); this.release = undefined;
    this.notify();
    for (const attachment of this.listeners) attachment.closed = true;
    this.listeners.clear();
  }
  retireInactive(): void { if (!this.active()) this.retire(); }
}
