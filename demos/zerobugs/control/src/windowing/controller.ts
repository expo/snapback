import type {ZerobugsDataAdapter} from '../data/queries';
import type {
  AdapterResult,
  CommentCursor,
  Direction,
  IssueCursor,
  ListContext,
  ListIssue,
  Page,
  Refusal,
  RichComment,
} from '../data/types';

// @ref LLP 0183#d4--headless-windowed-query-controller — this is the
// server-backed control lifecycle: identity replacement blanks synchronously,
// every async publication is generation-fenced, and permalink absence is
// accepted only from the authoritative point query.

export type WindowTotal =
  | Readonly<{kind: 'known'; value: number}>
  | Readonly<{kind: 'estimated'; value: number}>
  | Readonly<{kind: 'unknown'}>;

export type LoadedInterval<Cursor> = Readonly<{
  identity: string;
  generation: number;
  direction: Direction;
  requestedFrom: Cursor | null;
  first: Cursor | null;
  last: Cursor | null;
  count: number;
  boundaryComplete: boolean;
}>;

export type WindowItem<Row> = Readonly<{
  index: number;
  key: string;
  row: Row;
  size: number;
}>;

export type WindowSnapshot<Row, Cursor> = Readonly<{
  identity: string;
  generation: number;
  phase: 'pending' | 'hydrating' | 'ready' | 'refused';
  /** A current-generation authoritative frame has finished hydrating. */
  complete: boolean;
  /** Both authoritative boundaries are loaded, not merely estimated. */
  fullyLoaded: boolean;
  rowsEmpty: boolean;
  items: readonly WindowItem<Row>[];
  intervals: readonly LoadedInterval<Cursor>[];
  requested: Readonly<{forward: Cursor | null; backward: Cursor | null}>;
  total: WindowTotal;
  estimatedTotal: number | null;
  knownTotal: number | null;
  spaceBefore: number;
  spaceAfter: number;
  permalinkID: string | null;
  permalinkNotFound: boolean;
  refusal: Refusal | null;
}>;

export type WindowPageRequest<Cursor> = Readonly<{
  limit: number;
  start: Cursor | null;
  dir: Direction;
  inclusive: boolean;
  signal: AbortSignal;
}>;

export type WindowDataSource<Row, Cursor> = Readonly<{
  page(request: WindowPageRequest<Cursor>): Promise<AdapterResult<Page<Row, Cursor>>>;
  target(id: string, signal: AbortSignal): Promise<AdapterResult<Row>>;
  key(row: Row): string;
  cursor(row: Row): Cursor;
  compare(left: Row | Cursor, right: Row | Cursor): number;
}>;

export type WindowControllerOptions<Row, Cursor> = Readonly<{
  identity: string;
  source: WindowDataSource<Row, Cursor>;
  pageSize?: number;
  estimateSize: (row?: Row) => number;
  estimatedTotal?: number | null;
}>;

type MutableState<Row, Cursor> = {
  identity: string;
  generation: number;
  phase: WindowSnapshot<Row, Cursor>['phase'];
  hydrated: boolean;
  rows: Row[];
  intervals: LoadedInterval<Cursor>[];
  forward: Cursor | null;
  backward: Cursor | null;
  beforeRemaining: number | null;
  afterRemaining: number | null;
  estimatedTotal: number | null;
  permalinkID: string | null;
  permalinkNotFound: boolean;
  refusal: Refusal | null;
  awaitingCurrent: Set<Direction>;
};

function stableValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableValue(child)}`)
    .join(',')}}`;
}

/** Canonical identity over query, arguments, order, and optional bounds. */
export function windowIdentity(input: Readonly<{
  query: string;
  args: unknown;
  order: unknown;
  authority: unknown;
  bounds?: unknown;
}>): string {
  return `zerobugs.window.v1:${stableValue(input)}`;
}

function refusal(code: string, message: string, details: Record<string, unknown> = {}): Refusal {
  return Object.freeze({code, message, details: Object.freeze({...details})});
}

function localResultRefusal<Row, Cursor>(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): AdapterResult<Page<Row, Cursor>> {
  return Object.freeze({
    status: 'refused',
    value: undefined,
    reason: null,
    connection: 'error',
    freshness: 'unknown',
    refusal: refusal(code, message, details),
  });
}

export class WindowController<Row, Cursor> {
  readonly #source: WindowDataSource<Row, Cursor>;
  readonly #pageSize: number;
  readonly #estimateSize: (row?: Row) => number;
  #state: MutableState<Row, Cursor>;
  #snapshot: WindowSnapshot<Row, Cursor>;
  #listeners = new Set<() => void>();
  #requests = new Set<AbortController>();
  #heights = new Map<string, number>();
  #inflight = 0;

  constructor(options: WindowControllerOptions<Row, Cursor>) {
    if (!Number.isSafeInteger(options.pageSize ?? 40) || (options.pageSize ?? 40) < 1) {
      throw new TypeError('window pageSize must be a positive safe integer');
    }
    this.#source = options.source;
    this.#pageSize = options.pageSize ?? 40;
    this.#estimateSize = options.estimateSize;
    this.#state = this.#emptyState(options.identity, 0, options.estimatedTotal ?? null);
    this.#snapshot = this.#makeSnapshot();
  }

  #emptyState(identity: string, generation: number, estimatedTotal: number | null): MutableState<Row, Cursor> {
    return {
      identity,
      generation,
      phase: 'pending',
      hydrated: false,
      rows: [],
      intervals: [],
      forward: null,
      backward: null,
      beforeRemaining: null,
      afterRemaining: null,
      estimatedTotal,
      permalinkID: null,
      permalinkNotFound: false,
      refusal: null,
      awaitingCurrent: new Set(),
    };
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getSnapshot = (): WindowSnapshot<Row, Cursor> => this.#snapshot;

  #emit(): void {
    this.#snapshot = this.#makeSnapshot();
    for (const listener of this.#listeners) listener();
  }

  #averageSize(): number {
    if (this.#heights.size === 0) return Math.max(0, this.#estimateSize());
    let total = 0;
    for (const height of this.#heights.values()) total += height;
    return total / this.#heights.size;
  }

  #makeSnapshot(): WindowSnapshot<Row, Cursor> {
    const average = this.#averageSize();
    const before = this.#state.beforeRemaining;
    const after = this.#state.afterRemaining;
    const knownTotal = before !== null && after !== null
      ? before + this.#state.rows.length + after
      : null;
    const total: WindowTotal = knownTotal !== null
      ? Object.freeze({kind: 'known', value: knownTotal})
      : this.#state.estimatedTotal !== null
        ? Object.freeze({kind: 'estimated', value: this.#state.estimatedTotal})
        : Object.freeze({kind: 'unknown'});
    const baseIndex = before ?? 0;
    const items = this.#state.rows.map((row, offset) => {
      const key = this.#source.key(row);
      return Object.freeze({
        index: baseIndex + offset,
        key,
        row,
        size: this.#heights.get(key) ?? Math.max(0, this.#estimateSize(row)),
      });
    });
    return Object.freeze({
      identity: this.#state.identity,
      generation: this.#state.generation,
      phase: this.#state.phase,
      complete: this.#state.hydrated
        && this.#inflight === 0
        && this.#state.awaitingCurrent.size === 0
        && this.#state.refusal === null,
      fullyLoaded: before === 0 && after === 0 && this.#state.hydrated,
      rowsEmpty: this.#state.hydrated && this.#state.rows.length === 0,
      items: Object.freeze(items),
      intervals: Object.freeze([...this.#state.intervals]),
      requested: Object.freeze({forward: this.#state.forward, backward: this.#state.backward}),
      total,
      estimatedTotal: this.#state.estimatedTotal,
      knownTotal,
      spaceBefore: before === null ? 0 : before * average,
      spaceAfter: after === null ? 0 : after * average,
      permalinkID: this.#state.permalinkID,
      permalinkNotFound: this.#state.permalinkNotFound,
      refusal: this.#state.refusal,
    });
  }

  #abortRequests(): void {
    for (const request of this.#requests) request.abort();
    this.#requests.clear();
    this.#inflight = 0;
  }

  replaceIdentity(identity: string, estimatedTotal: number | null = null): void {
    if (identity === this.#state.identity && estimatedTotal === this.#state.estimatedTotal) return;
    this.#abortRequests();
    this.#heights.clear();
    this.#state = this.#emptyState(identity, this.#state.generation + 1, estimatedTotal);
    this.#emit();
  }

  /** Retire transition-time work and leave an already-blank request generation. */
  suspend(): void {
    this.#abortRequests();
    this.#heights.clear();
    this.#state = this.#emptyState(
      this.#state.identity,
      this.#state.generation + 1,
      this.#state.estimatedTotal,
    );
    this.#emit();
  }

  dispose(): void {
    this.#abortRequests();
    this.#listeners.clear();
  }

  measure(key: string, height: number): void {
    if (!Number.isFinite(height) || height < 0 || !this.#state.rows.some(row => this.#source.key(row) === key)) {
      return;
    }
    if (this.#heights.get(key) === height) return;
    this.#heights.set(key, height);
    this.#emit();
  }

  async loadInitial(): Promise<void> {
    if (this.#state.hydrated || this.#inflight > 0) return;
    await this.#load('forward', null, true, 'initial');
  }

  async loadForward(): Promise<void> {
    if (!this.#state.hydrated || this.#state.afterRemaining === 0 || this.#state.rows.length === 0) return;
    const row = this.#state.rows.at(-1);
    if (row) await this.#load('forward', this.#source.cursor(row), false, 'append');
  }

  async loadBackward(): Promise<void> {
    if (!this.#state.hydrated || this.#state.beforeRemaining === 0 || this.#state.rows.length === 0) return;
    const row = this.#state.rows[0];
    if (row) await this.#load('backward', this.#source.cursor(row), false, 'prepend');
  }

  async loadPermalink(id: string): Promise<void> {
    this.#abortRequests();
    const generation = this.#state.generation + 1;
    const identity = this.#state.identity;
    const estimated = this.#state.estimatedTotal;
    this.#heights.clear();
    this.#state = this.#emptyState(identity, generation, estimated);
    this.#state.permalinkID = id;
    this.#state.phase = 'hydrating';
    this.#emit();

    const controller = new AbortController();
    this.#requests.add(controller);
    this.#inflight += 1;
    try {
      const result = await this.#source.target(id, controller.signal);
      if (!this.#isCurrent(generation, controller)) return;
      if (result.status === 'not-found-authoritative') {
        this.#state.hydrated = true;
        this.#state.phase = 'ready';
        this.#state.permalinkNotFound = true;
        this.#state.beforeRemaining = 0;
        this.#state.afterRemaining = 0;
        return;
      }
      if (result.status !== 'complete') {
        const rejected = result.status === 'refused'
          ? result.refusal
          : refusal(
              'ZBUGS_WINDOW_TARGET_INCOMPLETE',
              `permalink target did not produce an authoritative complete row (${result.status})`,
            );
        this.#refuse(rejected);
        return;
      }
      this.#state.rows = [result.value];
      this.#state.hydrated = true;
      this.#state.phase = 'ready';
      this.#state.beforeRemaining = null;
      this.#state.afterRemaining = null;
      const cursor = this.#source.cursor(result.value);
      this.#state.forward = cursor;
      this.#state.backward = cursor;
      this.#state.intervals.push(Object.freeze({
        identity,
        generation,
        direction: 'forward',
        requestedFrom: null,
        first: cursor,
        last: cursor,
        count: 1,
        boundaryComplete: false,
      }));
    } finally {
      if (this.#requests.delete(controller)) this.#inflight -= 1;
      if (this.#state.generation === generation) this.#emit();
    }

    if (this.#state.generation !== generation || this.#state.refusal || this.#state.permalinkNotFound) return;
    const cursor = this.#source.cursor(this.#state.rows[0]);
    await Promise.all([
      this.#load('backward', cursor, false, 'prepend', generation),
      this.#load('forward', cursor, false, 'append', generation),
    ]);
  }

  #isCurrent(generation: number, controller: AbortController): boolean {
    return !controller.signal.aborted && this.#state.generation === generation;
  }

  #refuse(value: Refusal): void {
    this.#abortRequests();
    this.#state.phase = 'refused';
    this.#state.hydrated = false;
    this.#state.rows = [];
    this.#state.intervals = [];
    this.#state.beforeRemaining = null;
    this.#state.afterRemaining = null;
    this.#state.refusal = value;
    this.#state.awaitingCurrent.clear();
    this.#emit();
  }

  #validateFrame(
    result: AdapterResult<Page<Row, Cursor>>,
    direction: Direction,
    start: Cursor | null,
  ): AdapterResult<Page<Row, Cursor>> {
    if (result.status === 'refused' || result.status === 'pending'
      || result.status === 'refreshing' || result.status === 'not-found-authoritative') {
      return result;
    }
    const frame = result.value;
    if (result.status === 'incomplete' && result.reason !== 'page-limit') {
      return localResultRefusal(
        'ZBUGS_WINDOW_INCOMPLETE_FRAME',
        'the page contains an unproved child or bounded-refusal frame',
        {reason: result.reason},
      );
    }
    if (frame.hasMore && (frame.cursor === null || frame.items.length === 0)) {
      return localResultRefusal(
        'ZBUGS_WINDOW_CONTRADICTORY_FRAME',
        'a continuing window frame needs a terminal row cursor',
      );
    }
    if (!frame.hasMore && frame.cursor !== null) {
      return localResultRefusal(
        'ZBUGS_WINDOW_CONTRADICTORY_FRAME',
        'a terminal window frame cannot advertise a cursor',
      );
    }
    const keys = new Set<string>();
    for (const item of frame.items) {
      const key = this.#source.key(item);
      if (keys.has(key)) {
        return localResultRefusal('ZBUGS_WINDOW_DUPLICATE_FRAME', 'a frame repeated a source id', {key});
      }
      keys.add(key);
    }
    for (let index = 1; index < frame.items.length; index += 1) {
      const order = this.#source.compare(frame.items[index - 1], frame.items[index]);
      const valid = direction === 'forward' ? order < 0 : order > 0;
      if (!valid) {
        return localResultRefusal(
          'ZBUGS_WINDOW_ORDER_REFUSED',
          'a frame contradicted its declared query direction',
          {direction, index},
        );
      }
    }
    const first = frame.items[0];
    if (start !== null && first !== undefined) {
      const order = this.#source.compare(first, start);
      const valid = direction === 'forward' ? order > 0 : order < 0;
      if (!valid) {
        return localResultRefusal(
          'ZBUGS_WINDOW_ADJACENCY_REFUSED',
          'a non-inclusive page did not advance beyond its requested cursor',
          {direction},
        );
      }
    }
    if (frame.hasMore) {
      const last = frame.items.at(-1);
      if (!last || stableValue(this.#source.cursor(last)) !== stableValue(frame.cursor)) {
        return localResultRefusal(
          'ZBUGS_WINDOW_CURSOR_REFUSED',
          'the continuation cursor does not identify the terminal query-order row',
        );
      }
    }
    return result;
  }

  async #load(
    direction: Direction,
    start: Cursor | null,
    inclusive: boolean,
    mode: 'initial' | 'append' | 'prepend',
    expectedGeneration = this.#state.generation,
  ): Promise<void> {
    if (this.#state.generation !== expectedGeneration || this.#state.refusal) return;
    const controller = new AbortController();
    this.#requests.add(controller);
    this.#inflight += 1;
    this.#state.phase = 'hydrating';
    if (direction === 'forward') this.#state.forward = start;
    else this.#state.backward = start;
    this.#emit();
    try {
      const raw = await this.#source.page({
        limit: this.#pageSize,
        start,
        dir: direction,
        inclusive,
        signal: controller.signal,
      });
      if (!this.#isCurrent(expectedGeneration, controller)) return;
      const result = this.#validateFrame(raw, direction, start);
      if (result.status === 'refused') {
        this.#refuse(result.refusal);
        return;
      }
      if (result.status === 'pending' || result.status === 'refreshing') {
        this.#state.awaitingCurrent.add(direction);
        return;
      }
      this.#state.awaitingCurrent.delete(direction);
      if (result.status === 'not-found-authoritative') {
        if (mode === 'initial') {
          this.#state.rows = [];
          this.#state.beforeRemaining = 0;
          this.#state.afterRemaining = 0;
          this.#state.hydrated = true;
        } else {
          this.#refuse(refusal(
            'ZBUGS_WINDOW_PARENT_NOT_FOUND',
            'the established window parent became unavailable',
          ));
        }
        return;
      }

      const frame = result.value;
      const queryRows = [...frame.items];
      const canonicalRows = direction === 'backward' ? queryRows.reverse() : queryRows;
      const existing = new Map(this.#state.rows.map(row => [this.#source.key(row), row]));
      for (const row of canonicalRows) {
        const key = this.#source.key(row);
        const prior = existing.get(key);
        if (prior && stableValue(this.#source.cursor(prior)) !== stableValue(this.#source.cursor(row))) {
          this.#refuse(refusal(
            'ZBUGS_WINDOW_DUPLICATE_CURSOR_REFUSED',
            'one source id arrived with contradictory ordering facts',
            {key},
          ));
          return;
        }
        existing.set(key, row);
      }
      const merged = mode === 'prepend'
        ? [...canonicalRows, ...this.#state.rows]
        : mode === 'append' ? [...this.#state.rows, ...canonicalRows] : canonicalRows;
      const deduped: Row[] = [];
      const seen = new Set<string>();
      for (const row of merged) {
        const key = this.#source.key(row);
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(existing.get(key) ?? row);
      }
      for (let index = 1; index < deduped.length; index += 1) {
        if (this.#source.compare(deduped[index - 1], deduped[index]) >= 0) {
          this.#refuse(refusal(
            'ZBUGS_WINDOW_MERGE_ADJACENCY_REFUSED',
            'merged intervals do not form one strict source-order window',
            {index},
          ));
          return;
        }
      }
      this.#state.rows = deduped;
      const remaining = Math.max(0, frame.total - frame.items.length);
      if (mode === 'initial') {
        this.#state.beforeRemaining = 0;
        this.#state.afterRemaining = remaining;
      } else if (direction === 'forward') {
        this.#state.afterRemaining = remaining;
      } else {
        this.#state.beforeRemaining = remaining;
      }
      const first = frame.items[0];
      const last = frame.items.at(-1);
      this.#state.intervals.push(Object.freeze({
        identity: this.#state.identity,
        generation: expectedGeneration,
        direction,
        requestedFrom: start,
        first: first ? this.#source.cursor(first) : null,
        last: last ? this.#source.cursor(last) : null,
        count: frame.items.length,
        boundaryComplete: !frame.hasMore,
      }));
      this.#state.forward = this.#state.rows.length
        ? this.#source.cursor(this.#state.rows.at(-1) as Row)
        : null;
      this.#state.backward = this.#state.rows.length
        ? this.#source.cursor(this.#state.rows[0])
        : null;
      this.#state.hydrated = true;
      this.#state.phase = 'ready';
    } finally {
      if (this.#requests.delete(controller)) this.#inflight -= 1;
      if (this.#state.generation === expectedGeneration && !this.#state.refusal) {
        this.#state.phase = this.#state.hydrated
          && this.#inflight === 0
          && this.#state.awaitingCurrent.size === 0
          ? 'ready'
          : 'hydrating';
        this.#emit();
      }
    }
  }
}

function issueCompare(listContext: ListContext, left: ListIssue | IssueCursor, right: ListIssue | IssueCursor): number {
  const field = listContext.sortField;
  const ordered = left[field] - right[field];
  const tied = ordered !== 0 ? ordered : left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  return listContext.sortDirection === 'asc' ? tied : -tied;
}

export function issueWindowSource(
  adapter: ZerobugsDataAdapter,
  listContext: ListContext,
): WindowDataSource<ListIssue, IssueCursor> {
  return Object.freeze({
    page: async request => adapter.query('issueListV2', {
      listContext,
      limit: request.limit,
      start: request.start,
      dir: request.dir,
      inclusive: request.inclusive,
    }),
    target: async id => {
      const short = /^\d+$/u.test(id) ? Number(id) : null;
      const result = await adapter.query('listIssueByID', {
        listContext,
        idField: short === null ? 'id' : 'shortID',
        idValue: short === null ? id : short,
      });
      if (result.status === 'complete' || result.status === 'incomplete' || result.status === 'refreshing') {
        const item = result.value.items[0];
        if (!item) {
          return Object.freeze({
            status: 'refused',
            value: undefined,
            reason: null,
            connection: result.connection,
            freshness: 'unknown',
            refusal: refusal('ZBUGS_WINDOW_TARGET_EMPTY', 'point query returned no target row'),
          });
        }
        return Object.freeze({...result, value: item}) as AdapterResult<ListIssue>;
      }
      return result as AdapterResult<ListIssue>;
    },
    key: row => row.id,
    cursor: row => Object.freeze({id: row.id, created: row.created, modified: row.modified}),
    compare: (left, right) => issueCompare(listContext, left, right),
  });
}

function commentCompare(left: RichComment | CommentCursor, right: RichComment | CommentCursor): number {
  return left.created - right.created || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

export function commentWindowSource(
  adapter: ZerobugsDataAdapter,
  issueID: string,
): WindowDataSource<RichComment, CommentCursor> {
  return Object.freeze({
    page: request => adapter.query('commentsPage', {
      issueID,
      limit: request.limit,
      start: request.start,
      dir: request.dir,
      inclusive: request.inclusive,
    }),
    target: id => adapter.query('comment', {id}),
    key: row => row.id,
    cursor: row => Object.freeze({id: row.id, created: row.created}),
    compare: commentCompare,
  });
}
