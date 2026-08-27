import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';
import {
  HOUR_MS,
  SOON_MS,
  openExpiringSoon,
  openTrendingWindow,
  refreshTimeWindow,
} from '../../tests/fixtures/guide-time-windowed-live-reads/time-windowed-live-reads.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(packageDir, '../..');
const fixtureDir = join(root, 'tests/fixtures/guide-time-windowed-live-reads');
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const fixtureDefineSpecifier = '@expo/snapback-codegen/define';
const tempDirs = [];

function materialize(functionsFile) {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-guide-time-window-'));
  tempDirs.push(dir);
  for (const [source, target] of [
    ['schema.mjs', 'schema.mjs'],
    [functionsFile, 'functions.mjs'],
  ]) {
    const text = readFileSync(join(fixtureDir, source), 'utf8')
      .replaceAll(fixtureDefineSpecifier, defineUrl);
    writeFileSync(join(dir, target), text);
  }
  return dir;
}

function createHandlerHarness() {
  const rows = {
    events: [],
    typingLeases: [],
  };
  const indexFields = {
    events: {
      by_owner_and_created_at: ['ownerId', 'createdAt'],
    },
    typingLeases: {
      by_owner_and_expires_at: ['ownerId', 'expiresAt'],
      by_owner_and_typer: ['ownerId', 'typerLabel'],
    },
  };
  const traces = [];
  let nextId = 1;

  function context(userId, nowMs) {
    const query = (table) => {
      const state = {
        table,
        index: null,
        filters: [],
        order: [],
        take: null,
      };
      const builder = {
        withIndex(index) {
          assert(indexFields[table]?.[index], `unknown ${table} index ${index}`);
          state.index = index;
          return builder;
        },
        eq(field, value) {
          state.filters.push({ op: 'eq', field, value });
          return builder;
        },
        gt(field, value) {
          state.filters.push({ op: 'gt', field, value });
          return builder;
        },
        gte(field, value) {
          state.filters.push({ op: 'gte', field, value });
          return builder;
        },
        lt(field, value) {
          state.filters.push({ op: 'lt', field, value });
          return builder;
        },
        lte(field, value) {
          state.filters.push({ op: 'lte', field, value });
          return builder;
        },
        order(field, direction) {
          assert(
            ['asc', 'desc'].includes(direction),
            `unsupported query direction ${direction}`,
          );
          state.order.push({ field, direction });
          return builder;
        },
        take(limit) {
          state.take = limit;
          return builder;
        },
        async collect() {
          return execute(false);
        },
        async first() {
          return execute(true);
        },
      };

      function execute(first) {
        traces.push({
          table,
          index: state.index,
          filters: state.filters.map((filter) => ({ ...filter })),
          order: state.order.map((entry) => ({ ...entry })),
          take: state.take,
          first,
        });
        let selected = rows[table]
          .filter((row) => row.ownerId === userId)
          .filter((row) => state.filters.every(({ op, field, value }) => {
            if (op === 'eq') return row[field] === value;
            if (op === 'gt') return row[field] > value;
            if (op === 'gte') return row[field] >= value;
            if (op === 'lt') return row[field] < value;
            if (op === 'lte') return row[field] <= value;
            assert.fail(`unsupported query operation ${op}`);
          }));
        const order = state.order.length > 0
          ? state.order
          : state.index
            ? indexFields[table][state.index].map((field) => ({ field, direction: 'asc' }))
            : [];
        if (order.length > 0) {
          selected = selected.toSorted((left, right) => {
            for (const { field, direction } of order) {
              const sign = direction === 'desc' ? -1 : 1;
              if (left[field] < right[field]) return -1 * sign;
              if (left[field] > right[field]) return sign;
            }
            return left._id.localeCompare(right._id);
          });
        }
        if (first) return selected[0] ?? null;
        if (state.take !== null) return selected.slice(0, state.take);
        if (selected.length >= 1_024) {
          const error = new Error('SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED');
          error.code = 'SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED';
          throw error;
        }
        return selected;
      }

      return builder;
    };

    return {
      auth: { userId },
      runtime: { now: () => nowMs },
      db: {
        query,
        async insert(table, values) {
          assert.equal(values.ownerId, undefined, 'owner policy fields are host-stamped');
          const row = {
            _id: `${table}:${nextId}`,
            _version: 1,
            ...values,
            ownerId: userId,
          };
          nextId += 1;
          if (table === 'typingLeases') {
            assert(!rows[table].some((candidate) => (
              candidate.ownerId === userId
              && candidate.typerLabel === row.typerLabel
            )), 'the owner/typer unique index rejects duplicate leases');
          }
          rows[table].push(row);
          return row._id;
        },
        async patch(table, id, values) {
          assert.equal(values.ownerId, undefined, 'owner policy fields are immutable');
          const row = rows[table].find((candidate) => (
            candidate._id === id && candidate.ownerId === userId
          ));
          if (!row) return false;
          Object.assign(row, values, { _version: row._version + 1 });
          return true;
        },
      },
    };
  }

  return { context, rows, traces };
}

function labels(result, field) {
  return result.map((row) => row[field]).toSorted();
}

try {
  const naive = await generate(materialize('naive-functions.mjs'));
  assert.equal(naive.ok, false, 'ambient runtime time must fail protected live codegen');
  assert(naive.diagnostics.some((entry) => (
    entry.code === 'SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY'
    && entry.function === 'eventsVisibleNow'
  )), JSON.stringify(naive.diagnostics));

  const recipeDir = materialize('functions.mjs');
  const recipe = await generate(recipeDir);
  assert.equal(recipe.ok, true, JSON.stringify(recipe.diagnostics));
  const schema = JSON.parse(readFileSync(
    join(recipeDir, 'generated/schema.manifest.json'),
    'utf8',
  ));
  assert.deepEqual(
    schema.tables.find((table) => table.name === 'events').indexes,
    [{ name: 'by_owner_and_created_at', fields: ['ownerId', 'createdAt'] }],
    'events declare the owner/time range index used by the live query',
  );
  assert.deepEqual(
    schema.tables.find((table) => table.name === 'typingLeases').indexes,
    [
      { name: 'by_owner_and_expires_at', fields: ['ownerId', 'expiresAt'] },
      {
        name: 'by_owner_and_typer',
        fields: ['ownerId', 'typerLabel'],
        unique: true,
      },
    ],
    'typing leases retain renewal uniqueness and add the owner/expiry range index',
  );
  const manifest = JSON.parse(readFileSync(
    join(recipeDir, 'generated/functions.manifest.json'),
    'utf8',
  ));
  const query = manifest.functions.find((entry) => entry.name === 'eventsVisibleAtPinnedClock');
  assert(query, 'trending recipe query is emitted');
  assert.deepEqual(
    query.argsContract.fields.map((field) => field.name),
    ['clockMs', 'windowMs'],
    'the pasted recipe emits the load-pinned clock argument contract',
  );
  const pagedQuery = manifest.functions.find(
    (entry) => entry.name === 'mostRecentEventsVisibleAtPinnedClock',
  );
  assert(pagedQuery, 'bounded trending recipe query is emitted');
  assert.deepEqual(
    pagedQuery.argsContract.fields.map((field) => field.name),
    ['clockMs', 'windowMs', 'limit'],
    'the bounded recipe emits its pinned clock, window, and deliberate limit',
  );
  const typingQuery = manifest.functions.find((entry) => entry.name === 'typingLeasesExpiringSoon');
  assert(typingQuery, 'typing-lease recipe query is emitted');
  assert.deepEqual(
    typingQuery.argsContract.fields.map((field) => field.name),
    ['clockMs', 'soonWithinMs'],
    'the typing-lease recipe emits the pinned clock and expiry horizon contract',
  );

  const authored = await import(`${pathToFileURL(join(recipeDir, 'functions.mjs')).href}?runtime`);
  const eventQueryHandler = authored.eventsVisibleAtPinnedClock.js.inlineHandler;
  const pagedEventQueryHandler = authored.mostRecentEventsVisibleAtPinnedClock.js.inlineHandler;
  const eventMutationHandler = authored.insertServerTimedEvent.js.inlineHandler;
  const leaseQueryHandler = authored.typingLeasesExpiringSoon.js.inlineHandler;
  const leaseMutationHandler = authored.renewTypingLease.js.inlineHandler;
  const harness = createHandlerHarness();
  const alice = 'user-alice';
  const bob = 'user-bob';
  const clockMs = 10_000_000;
  const cutoffMs = clockMs - HOUR_MS;

  for (let index = 0; index < 1_025; index += 1) {
    await eventMutationHandler(harness.context(alice, cutoffMs - 1), {
      label: `old-prefix-${index}`,
    });
  }
  for (const [label, createdAt] of [
    ['event-cutoff-inclusive', cutoffMs],
    ['event-inside', cutoffMs + 1],
    ['event-clock-inclusive', clockMs],
    ['event-after-clock', clockMs + 1],
  ]) {
    await eventMutationHandler(harness.context(alice, createdAt), { label });
  }
  await eventMutationHandler(harness.context(bob, cutoffMs + 1), {
    label: 'bob-event-inside',
  });

  harness.traces.length = 0;
  const aliceEvents = await eventQueryHandler(
    harness.context(alice, clockMs),
    { clockMs, windowMs: HOUR_MS },
  );
  assert.deepEqual(labels(aliceEvents, 'label'), [
    'event-clock-inclusive',
    'event-cutoff-inclusive',
    'event-inside',
  ], 'event range includes both boundaries after more than 1,024 older rows');
  assert.deepEqual(harness.traces.at(-1), {
    table: 'events',
    index: 'by_owner_and_created_at',
    filters: [
      { op: 'eq', field: 'ownerId', value: alice },
      { op: 'gte', field: 'createdAt', value: cutoffMs },
      { op: 'lte', field: 'createdAt', value: clockMs },
    ],
    order: [],
    take: null,
    first: false,
  }, 'event handler range-filters through the owner/time index before collection');
  const bobEvents = await eventQueryHandler(
    harness.context(bob, clockMs),
    { clockMs, windowMs: HOUR_MS },
  );
  assert.deepEqual(labels(bobEvents, 'label'), ['bob-event-inside'],
    'a different owner sees only their event window');

  const busyHarness = createHandlerHarness();
  for (let index = 0; index < 1_025; index += 1) {
    await eventMutationHandler(busyHarness.context(alice, cutoffMs + index), {
      label: `busy-window-${index}`,
    });
  }
  await assert.rejects(
    eventQueryHandler(
      busyHarness.context(alice, clockMs),
      { clockMs, windowMs: HOUR_MS },
    ),
    (error) => error.code === 'SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED',
    'an unpaged window with more than 1,024 matching rows must refuse loudly',
  );
  busyHarness.traces.length = 0;
  const mostRecentEvents = await pagedEventQueryHandler(
    busyHarness.context(alice, clockMs),
    { clockMs, windowMs: HOUR_MS, limit: 7 },
  );
  assert.equal(mostRecentEvents.length, 7, 'the bounded page returns exactly its limit');
  assert.deepEqual(
    mostRecentEvents.map((row) => row.label),
    [
      'busy-window-1024',
      'busy-window-1023',
      'busy-window-1022',
      'busy-window-1021',
      'busy-window-1020',
      'busy-window-1019',
      'busy-window-1018',
    ],
    'the bounded page returns the newest matching events first',
  );
  assert.deepEqual(busyHarness.traces.at(-1), {
    table: 'events',
    index: 'by_owner_and_created_at',
    filters: [
      { op: 'eq', field: 'ownerId', value: alice },
      { op: 'gte', field: 'createdAt', value: cutoffMs },
      { op: 'lte', field: 'createdAt', value: clockMs },
    ],
    order: [{ field: 'createdAt', direction: 'desc' }],
    take: 7,
    first: false,
  }, 'the bounded page range-filters before newest-first ordering and take');

  for (let index = 0; index < 1_025; index += 1) {
    await leaseMutationHandler(harness.context(alice, clockMs - 10_000), {
      typerLabel: `expired-prefix-${index}`,
    });
  }
  await leaseMutationHandler(harness.context(alice, clockMs - 5_000), {
    typerLabel: 'lease-clock-exclusive',
  });
  await leaseMutationHandler(harness.context(alice, clockMs - 4_999), {
    typerLabel: 'lease-after-clock',
  });
  await leaseMutationHandler(harness.context(alice, clockMs + SOON_MS - 5_000), {
    typerLabel: 'lease-horizon-inclusive',
  });
  await leaseMutationHandler(harness.context(alice, clockMs + SOON_MS - 4_999), {
    typerLabel: 'lease-after-horizon',
  });
  const renewedLeaseId = await leaseMutationHandler(
    harness.context(alice, clockMs - 10_000),
    { typerLabel: 'lease-renewed' },
  );
  const sameRenewedLeaseId = await leaseMutationHandler(
    harness.context(alice, clockMs),
    { typerLabel: 'lease-renewed' },
  );
  assert.equal(sameRenewedLeaseId, renewedLeaseId,
    'renewal patches the existing owner/typer row');
  assert.equal(harness.rows.typingLeases.filter((row) => (
    row.ownerId === alice && row.typerLabel === 'lease-renewed'
  )).length, 1, 'renewal does not create a duplicate lease');
  await leaseMutationHandler(harness.context(bob, clockMs), {
    typerLabel: 'bob-lease-inside',
  });

  harness.traces.length = 0;
  const aliceLeases = await leaseQueryHandler(
    harness.context(alice, clockMs),
    { clockMs, soonWithinMs: SOON_MS },
  );
  assert.deepEqual(labels(aliceLeases, 'typerLabel'), [
    'lease-after-clock',
    'lease-horizon-inclusive',
    'lease-renewed',
  ], 'lease range excludes the clock and includes the horizon after a 1,025-row prefix');
  assert.deepEqual(harness.traces.at(-1), {
    table: 'typingLeases',
    index: 'by_owner_and_expires_at',
    filters: [
      { op: 'eq', field: 'ownerId', value: alice },
      { op: 'gt', field: 'expiresAt', value: clockMs },
      { op: 'lte', field: 'expiresAt', value: clockMs + SOON_MS },
    ],
    order: [],
    take: null,
    first: false,
  }, 'lease handler range-filters through the owner/expiry index before collection');
  const bobLeases = await leaseQueryHandler(
    harness.context(bob, clockMs),
    { clockMs, soonWithinMs: SOON_MS },
  );
  assert.deepEqual(labels(bobLeases, 'typerLabel'), ['bob-lease-inside'],
    'a different owner sees only their lease window');

  const calls = [];
  let disposals = 0;
  const client = {
    async liveQuery(reference, options) {
      calls.push({ reference, options });
      return { async dispose() { disposals += 1; } };
    },
  };
  const trendingReference = Object.freeze({ name: 'eventsVisibleAtPinnedClock' });
  const typingReference = Object.freeze({ name: 'typingLeasesExpiringSoon' });
  const first = await openTrendingWindow(client, trendingReference, 'guide-proof-trending');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.args.clockMs, first.clockMs);
  assert.equal(calls[0].options.args.windowMs, HOUR_MS);
  assert.equal(calls[0].options.transport, 'stream');
  const second = await refreshTimeWindow(
    first,
    () => openTrendingWindow(client, trendingReference, 'guide-proof-trending'),
  );
  assert.equal(disposals, 1, 'refresh disposes the predecessor generation');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.args.clockMs, second.clockMs);
  const typing = await openExpiringSoon(client, typingReference, 'guide-proof-typing');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].options.args.clockMs, typing.clockMs);
  assert.equal(calls[2].options.args.soonWithinMs, SOON_MS);
  assert.equal(calls[2].options.transport, 'stream');
} finally {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
}

console.log('guide-time-windowed-live-reads.test.mjs: guard, indexed windows, refusal, paging, boundaries, renewal, scale, and owner isolation pass');
