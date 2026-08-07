import {describe, expect, test} from 'bun:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

import type {AdapterResult, Page} from '../src/data/types';
import {
  WindowController,
  windowIdentity,
  type WindowDataSource,
  type WindowPageRequest,
} from '../src/windowing/controller';
import {
  readWindowScrollState,
  windowScrollState,
} from '../src/windowing/history-state';

type Row = Readonly<{id: string; order: number}>;
type Cursor = Readonly<{id: string; order: number}>;
const issueFixture = JSON.parse(await readFile(resolve(
  import.meta.dirname,
  '../fixtures/normal-seed-v1/issue.json',
), 'utf8')) as readonly Readonly<{id: string; created: number}>[];
const rows: readonly Row[] = Object.freeze(issueFixture
  .toSorted((left, right) => left.created - right.created || left.id.localeCompare(right.id))
  .slice(0, 10)
  .map((row, index) => Object.freeze({id: row.id, order: index + 1})));

const current = {connection: 'live' as const, freshness: 'current' as const};

function frame(
  items: readonly Row[],
  total: number,
  hasMore: boolean,
): AdapterResult<Page<Row, Cursor>> {
  return {
    status: hasMore ? 'incomplete' : 'complete',
    value: {
      items,
      total,
      examined: items.length,
      hasMore,
      cursor: hasMore && items.length > 0 ? {...items.at(-1)!} : null,
    },
    reason: hasMore ? 'page-limit' : null,
    ...current,
  };
}

function source(options: Readonly<{
  rows?: readonly Row[];
  override?: (request: WindowPageRequest<Cursor>) => AdapterResult<Page<Row, Cursor>> | null;
}> = {}): WindowDataSource<Row, Cursor> {
  const all = options.rows ?? rows;
  return {
    async page(request) {
      const overridden = options.override?.(request);
      if (overridden) return overridden;
      const index = request.start === null
        ? (request.dir === 'forward' ? 0 : all.length - 1)
        : all.findIndex(row => row.id === request.start?.id);
      const candidates = request.dir === 'forward'
        ? all.slice(index + (request.start !== null && !request.inclusive ? 1 : 0))
        : all.slice(0, index + (request.start !== null && request.inclusive ? 1 : 0)).toReversed();
      const items = candidates.slice(0, request.limit);
      return frame(items, candidates.length, items.length < candidates.length);
    },
    async target(id) {
      const row = all.find(value => value.id === id);
      return row
        ? {status: 'complete', value: row, reason: null, ...current}
        : {status: 'not-found-authoritative', value: null, reason: 'missing', ...current};
    },
    key: row => row.id,
    cursor: row => ({id: row.id, order: row.order}),
    compare: (left, right) => left.order - right.order,
  };
}

function controller(dataSource = source(), pageSize = 3): WindowController<Row, Cursor> {
  return new WindowController({
    identity: windowIdentity({query: 'fixture', args: {}, order: 'asc', authority: 'fixture'}),
    source: dataSource,
    pageSize,
    estimateSize: () => 10,
  });
}

describe('Lane 6a window controller', () => {
  test('walks forward and backward without duplicate or skipped source ids', async () => {
    const window = controller();
    await window.loadInitial();
    expect(window.getSnapshot().items.map(item => item.key)).toEqual(rows.slice(0, 3).map(row => row.id));
    expect(window.getSnapshot().spaceAfter).toBe(70);
    while (window.getSnapshot().knownTotal !== window.getSnapshot().items.length) {
      await window.loadForward();
    }
    expect(window.getSnapshot().items.map(item => item.key)).toEqual(rows.map(row => row.id));
    expect(window.getSnapshot().fullyLoaded).toBe(true);

    await window.loadPermalink(rows[7].id);
    expect(window.getSnapshot().items.some(item => item.key === rows[7].id)).toBe(true);
    while (window.getSnapshot().spaceBefore > 0) await window.loadBackward();
    while (window.getSnapshot().spaceAfter > 0) await window.loadForward();
    expect(window.getSnapshot().items.map(item => item.key)).toEqual(rows.map(row => row.id));
  });

  test('permalink not-found is authoritative and unknown totals stay honest while hydrating', async () => {
    const window = controller();
    expect(window.getSnapshot().total.kind).toBe('unknown');
    expect(window.getSnapshot().complete).toBe(false);
    await window.loadPermalink('absent');
    const snapshot = window.getSnapshot();
    expect(snapshot.permalinkNotFound).toBe(true);
    expect(snapshot.rowsEmpty).toBe(true);
    expect(snapshot.knownTotal).toBe(0);
  });

  test('generation fencing blanks immediately and discards predecessor publication', async () => {
    let release!: (value: AdapterResult<Page<Row, Cursor>>) => void;
    let calls = 0;
    const deferred = source({
      override() {
        calls += 1;
        if (calls !== 1) return null;
        return null;
      },
    });
    const wrapped: WindowDataSource<Row, Cursor> = {
      ...deferred,
      page(request) {
        calls += 1;
        if (calls === 1) return new Promise(resolve => { release = resolve; });
        return deferred.page(request);
      },
    };
    const window = controller(wrapped);
    const predecessor = window.loadInitial();
    expect(window.getSnapshot().phase).toBe('hydrating');
    window.replaceIdentity(windowIdentity({
      query: 'fixture', args: {open: true}, order: 'asc', authority: 'fixture',
    }));
    expect(window.getSnapshot().items).toEqual([]);
    expect(window.getSnapshot().generation).toBe(1);
    release(frame(rows.slice(0, 3), rows.length, true));
    await predecessor;
    expect(window.getSnapshot().items).toEqual([]);
    await window.loadInitial();
    expect(window.getSnapshot().items.map(item => item.key)).toEqual(rows.slice(0, 3).map(row => row.id));
  });

  test('disconnect refresh stays hydrating until a current frame arrives', async () => {
    let calls = 0;
    const reconnecting = source({
      override: request => {
        if (request.start !== null || calls++ > 0) return null;
        return {
          status: 'refreshing',
          value: frame(rows.slice(0, 3), rows.length, true).value,
          serverStatus: 'incomplete',
          reason: 'page-limit',
          connection: 'stale',
          freshness: 'retained',
        };
      },
    });
    const window = controller(reconnecting);
    await window.loadInitial();
    expect(window.getSnapshot().phase).toBe('hydrating');
    expect(window.getSnapshot().complete).toBe(false);
    expect(window.getSnapshot().items).toEqual([]);
    await window.loadInitial();
    expect(window.getSnapshot().phase).toBe('ready');
    expect(window.getSnapshot().complete).toBe(true);
  });

  test('session settlement retires a refused generation and re-requests the window', async () => {
    let calls = 0;
    const transitioning = source({
      override: request => {
        if (request.start !== null || calls++ > 0) return null;
        return {
          status: 'refused',
          value: undefined,
          reason: null,
          connection: 'error',
          freshness: 'unknown',
          refusal: {
            code: 'SNAPBACK_AUTH_TRANSITION_IN_PROGRESS',
            message: 'query refused while auth custody is transitioning',
            details: {},
          },
        };
      },
    });
    const window = controller(transitioning);
    await window.loadInitial();
    const refusedGeneration = window.getSnapshot().generation;
    expect(window.getSnapshot().phase).toBe('refused');

    window.suspend();
    expect(window.getSnapshot().generation).toBe(refusedGeneration + 1);
    expect(window.getSnapshot().phase).toBe('pending');
    await window.loadInitial();

    expect(calls).toBe(2);
    expect(window.getSnapshot().phase).toBe('ready');
    expect(window.getSnapshot().items.map(item => item.key)).toEqual(
      rows.slice(0, 3).map(row => row.id),
    );
  });

  test('refuses duplicate, non-adjacent, and contradictory cursor frames', async () => {
    const duplicate = controller(source({
      override: request => request.start === null
        ? frame([rows[0], rows[0]], 3, true)
        : null,
    }));
    await duplicate.loadInitial();
    expect(duplicate.getSnapshot().refusal?.code).toBe('ZBUGS_WINDOW_DUPLICATE_FRAME');

    const adjacent = controller(source({
      override: request => request.start !== null
        ? frame([rows[2], rows[3]], 4, true)
        : null,
    }));
    await adjacent.loadInitial();
    await adjacent.loadForward();
    expect(adjacent.getSnapshot().refusal?.code).toBe('ZBUGS_WINDOW_ADJACENCY_REFUSED');

    const cursor = controller(source({
      override: request => request.start === null
        ? {
            ...frame(rows.slice(0, 2), 10, true),
            value: {...frame(rows.slice(0, 2), 10, true).value, cursor: {...rows[5]}},
          } as AdapterResult<Page<Row, Cursor>>
        : null,
    }));
    await cursor.loadInitial();
    expect(cursor.getSnapshot().refusal?.code).toBe('ZBUGS_WINDOW_CURSOR_REFUSED');
  });

  test('spacer math reacts to dynamic measured heights', async () => {
    const window = controller();
    await window.loadPermalink(rows[7].id);
    let snapshot = window.getSnapshot();
    expect(snapshot.spaceBefore).toBe(40);
    for (const item of snapshot.items) window.measure(item.key, 20);
    snapshot = window.getSnapshot();
    expect(snapshot.spaceBefore).toBe(80);
    expect(snapshot.items.every(item => item.size === 20)).toBe(true);
  });

  test('scroll history value is compatible with an opaque wouter state slot', () => {
    const identity = windowIdentity({
      query: 'fixture', args: {label: 'bug'}, order: 'desc', authority: 'fixture',
    });
    const value = windowScrollState({
      identity,
      anchor: {...rows[3]},
      offset: -7,
      scrollTop: 341,
    });
    expect(readWindowScrollState<Cursor>(value, identity)).toEqual(value);
    expect(readWindowScrollState<Cursor>(value, `${identity}:other`)).toBeUndefined();
  });
});
