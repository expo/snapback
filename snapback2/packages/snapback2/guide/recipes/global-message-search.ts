import {
  api,
  type Cursor,
  type ResultOf,
  type SnapbackClient,
} from "snapback2/client";
import { createGlobalSearchPager } from "snapback2/global-search-pager";

type Scope = ResultOf<typeof api.feeds.searchScopes>[number];
type Message = ResultOf<typeof api.feeds.conversationMessageSearch>[number];

/**
 * Interim client N-way merge; create afresh on term/membership changes.
 * Each term walks all scope pages, then one head per chat, then refills.
 * Frozen Clique hub (1,000 memberships): first 20 `busy` matches cost 1,030
 * HTTP queries (10 scope pages + 1,000 heads + 20 refills), 669/616 ms on
 * localhost EPYC with 0.0.25; absent term costs 1,010 queries / 576 ms.
 * Later pages add refill requests. maxScopes bounds the directory, not total
 * requests across empty capped pages, retries, or duplicate rows.
 * LLP 1024 records the one-lane capability gap and write-side price.
 */
export function createGlobalMessageSearch(client: SnapbackClient, term: string) {
  const capturedTerm = term;
  return createGlobalSearchPager<Scope, Message, Cursor>({
    loadScopes: (after) => client.query(
      api.feeds.searchScopes,
      after === null ? {} : { c: after },
    ),
    loadMessages: (scope, after) => client.query(
      api.feeds.conversationMessageSearch,
      {
        conversation: scope.conversation,
        term: capturedTerm,
        ...(after === null ? {} : { c: after }),
      },
    ),
    scopeId: (scope) => scope.conversation,
    messageId: (message) => message.id,
    // bySearch fixes conversation and term; its descending suffix is (at, id).
    compare: (left, right) => left.at - right.at || compareId(left.id, right.id),
    pageSize: 20,
    concurrency: 16,
    maxScopes: 1000,
  });
}

export type GlobalMessageSearch = ReturnType<typeof createGlobalMessageSearch>;

/** Render `messages`; surface `issues` and retry the same search when appropriate. */
export async function nextGlobalMessagePage(search: GlobalMessageSearch) {
  const page = await search.next();
  return {
    messages: page.items,
    state: page.state,
    hasMore: page.hasMore,
    issues: page.issues,
  };
}

function compareId(left: string, right: string): number {
  let a = 0, b = 0;
  while (a < left.length && b < right.length) {
    const x = left.codePointAt(a)!, y = right.codePointAt(b)!;
    if (x !== y) return x - y;
    a += x > 0xffff ? 2 : 1;
    b += y > 0xffff ? 2 : 1;
  }
  return left.length - a - (right.length - b);
}
