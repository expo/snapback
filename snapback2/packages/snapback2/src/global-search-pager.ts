export type GlobalSearchState = "complete" | "capped" | "held" | "partial" | "denied" | "refused" | "hydrating";

/** The structural subset of Snapback query results consumed by the pager. */
export interface GlobalSearchReceipt<T, C extends string = string> {
  readonly state: GlobalSearchState;
  readonly data?: readonly T[];
  readonly next?: C | null;
  readonly reason?: string;
}

export interface GlobalSearchIssue<C extends string = string> {
  readonly phase: "scopes" | "messages";
  readonly scope?: string;
  readonly receipt: GlobalSearchReceipt<unknown, C>;
}

export interface GlobalSearchPage<Row, C extends string = string> {
  readonly state: GlobalSearchState;
  readonly items: readonly Row[];
  readonly hasMore: boolean;
  readonly issues: readonly GlobalSearchIssue<C>[];
}

export interface GlobalSearchPagerOptions<Scope, Row, C extends string = string> {
  /** Page the complete current authorization directory until `next` is null. */
  readonly loadScopes: (after: C | null) => Promise<GlobalSearchReceipt<Scope, C>>;
  /** Fetch at most one descending search row for one authorized scope. */
  readonly loadMessages: (scope: Scope, after: C | null) => Promise<GlobalSearchReceipt<Row, C>>;
  readonly scopeId: (scope: Scope) => string;
  readonly messageId: (row: Row) => string;
  /** Positive means `left` precedes `right`; match the Quarry index suffix exactly. */
  readonly compare: (left: Row, right: Row) => number;
  readonly pageSize?: number;
  readonly concurrency?: number;
  /** Refuse rather than silently omit a larger directory. */
  readonly maxScopes?: number;
}

type Lane<Scope, Row, C extends string> = {
  scope: Scope;
  id: string;
  cursor: C | null;
  cursors: Set<C>;
  head?: Row;
  done: boolean;
};

const priority: Record<GlobalSearchState, number> = {
  refused: 0, denied: 1, partial: 2, hydrating: 3, held: 4, capped: 5, complete: 6,
};

/**
 * Builds stable global pages from a complete scope walk and one-row certified
 * searches. Create a new pager when the term or membership directory changes.
 * @ref LLP 1012#indexed-held-search — a client union cannot promote a weaker
 * per-scope receipt or changing authorization directory to complete.
 */
export function createGlobalSearchPager<Scope, Row, C extends string = string>(
  options: GlobalSearchPagerOptions<Scope, Row, C>,
): { next(): Promise<GlobalSearchPage<Row, C>> } {
  const pageSize = integer(options.pageSize ?? 20, "pageSize");
  const concurrency = integer(options.concurrency ?? 16, "concurrency");
  const maxScopes = integer(options.maxScopes ?? 1000, "maxScopes");
  let lanes: Lane<Scope, Row, C>[] | undefined;
  const emitted = new Set<string>();

  async function discover(): Promise<GlobalSearchIssue<C> | undefined> {
    const scopes = new Map<string, Scope>();
    const cursors = new Set<C>();
    let after: C | null = null;
    for (;;) {
      const receipt = await options.loadScopes(after);
      const issue = validate(receipt, "scopes");
      if (issue) return issue;
      for (const scope of receipt.data!) {
        scopes.set(options.scopeId(scope), scope);
        if (scopes.size > maxScopes) return synthetic("scopes", `scope directory exceeds maxScopes ${maxScopes}`);
      }
      if (receipt.next == null) {
        if (receipt.state === "capped") return synthetic("scopes", "capped scope page has no continuation");
        lanes = [...scopes].map(([id, scope]) => ({ scope, id, cursor: null, cursors: new Set<C>(), done: false }));
        return;
      }
      if (cursors.has(receipt.next)) return synthetic("scopes", "scope cursor repeated");
      cursors.add(receipt.next);
      after = receipt.next;
    }
  }

  async function fill(lane: Lane<Scope, Row, C>): Promise<GlobalSearchIssue<C> | undefined> {
    while (!lane.done && lane.head === undefined) {
      const receipt = await options.loadMessages(lane.scope, lane.cursor);
      const issue = validate(receipt, "messages", lane.id);
      if (issue) return issue;
      if (receipt.data!.length > 1) return synthetic("messages", "search page returned more than one row", lane.id);
      if (receipt.next == null) {
        if (receipt.state === "capped") return synthetic("messages", "capped search page has no continuation", lane.id);
        lane.done = true;
      } else {
        if (receipt.next === lane.cursor || lane.cursors.has(receipt.next)) return synthetic("messages", "search cursor repeated", lane.id);
        lane.cursors.add(receipt.next);
        lane.cursor = receipt.next;
      }
      lane.head = receipt.data![0];
    }
  }

  async function advance(): Promise<GlobalSearchPage<Row, C>> {
    if (!lanes) {
      const issue = await discover();
      if (issue) return failed([], [issue]);
    }
    let issues = (await mapLimit(lanes!.filter(lane => !lane.done && lane.head === undefined), concurrency, fill))
      .filter((issue): issue is GlobalSearchIssue<C> => issue !== undefined);
    if (issues.length) return failed([], issues);

    const items: Row[] = [];
    while (items.length < pageSize) {
      const ready = lanes!.filter((lane): lane is Lane<Scope, Row, C> & { head: Row } => lane.head !== undefined);
      if (!ready.length) break;
      const lane: Lane<Scope, Row, C> = ready.reduce(
        (best, candidate) => options.compare(candidate.head, best.head) > 0 ? candidate : best,
      );
      const row = lane.head!;
      lane.head = undefined;
      if (!emitted.has(options.messageId(row))) {
        emitted.add(options.messageId(row));
        items.push(row);
      }
      if (!lane.done) {
        const issue = await fill(lane);
        if (issue) {
          issues = [issue];
          break;
        }
      }
    }
    if (issues.length) return failed(items, issues);
    const hasMore = lanes!.some(lane => lane.head !== undefined || !lane.done);
    return { state: hasMore ? "capped" : "complete", items, hasMore, issues: [] };
  }

  let tail: Promise<void> = Promise.resolve();
  return { next() {
    const result = tail.then(advance, advance);
    tail = result.then(() => undefined, () => undefined);
    return result;
  } };
}

function validate<C extends string>(receipt: GlobalSearchReceipt<unknown, C>, phase: GlobalSearchIssue<C>["phase"], scope?: string): GlobalSearchIssue<C> | undefined {
  if ((receipt.state === "complete" || receipt.state === "capped") && Array.isArray(receipt.data)) return;
  return { phase, ...(scope ? { scope } : {}), receipt };
}

function synthetic<C extends string>(phase: GlobalSearchIssue<C>["phase"], reason: string, scope?: string): GlobalSearchIssue<C> {
  return { phase, ...(scope ? { scope } : {}), receipt: { state: "partial", reason } };
}

function failed<Row, C extends string>(items: readonly Row[], issues: readonly GlobalSearchIssue<C>[]): GlobalSearchPage<Row, C> {
  const state = issues.reduce((weakest, issue) => priority[issue.receipt.state] < priority[weakest] ? issue.receipt.state : weakest, "complete" as GlobalSearchState);
  return { state, items, hasMore: true, issues };
}

function integer(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

async function mapLimit<T, R>(values: readonly T[], limit: number, fn: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await fn(values[index]!);
    }
  }));
  return results;
}
