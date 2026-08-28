---
title: Loading large deterministic fixtures
id: testing.large-fixtures
order: 3
audience: agent-first
capabilities: [testing.large-fixtures, testing.headless-replay]
authorities: [llp/0109-versioned-seed-evolution.spec.md, llp/0183-zerobugs-quality-surface.rfc.md, llp/0307.000-headless-replay-surface.spec.md, packages/snapback-acceptance/replay.mjs, demos/zerobugs/control/scripts/load-fixture.mts, demos/zerobugs/control/snapback/functions.mjs, demos/zero-bakeoff/apps/fleet-observatory/snapback/functions.mjs, crates/snapback-kernel/src/seed_identity.rs, crates/snapback-kernel/src/storage.rs]
examples: [demos/zerobugs/control, demos/zero-bakeoff/apps/fleet-observatory]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-24
reviewed-authorities-digest: sha256:05ade0a59515ce3e0885e36dcd6e410f70ffa0e82391ca2ef81c719107c82c7a
---

# Loading large deterministic fixtures

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

A [versioned seed](../backend/versioned-seeds.md) installs at most **1,024
effects** — direct rows plus changed maintained-projection outputs — and
refuses a larger fixture with `SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED`. A single
mutation has the same order of ceiling: at most **1,024 buffered writes**
(`SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED`; see
[bound and resume bulk work](../backend/mutations.md#bound-and-resume-bulk-work)).
Both ceilings are deliberate. When an acceptance suite needs a deterministic
fixture bigger than that — thousands of ordered actions across many actors —
do not fight the seed protocol. Use `defineReplay` from
`@expo/snapback-acceptance`, or the thin `snapback replay` CLI, to drive a
JSONL action log through the generated mutation API. Replay is sequential,
keeps a small actor-client pool, stores crash-safe receipts, resumes without
re-running terminal actions, and owns retained-settlement acknowledgement.

Reserve an **app-authored, acceptance-only batch-ingest mutation** for the
special case where fixture installation itself must be a gated bootstrap
window, or one logical action naturally expands to hundreds of writes. Keep
each such action within the ≤900-row headroom described below; replay cannot
shrink an over-ceiling mutation handler.

This page distills the paved shape from two CI-exercised sources: the minimal
loader in the fleet-observatory bakeoff app
([functions](repo:demos/zero-bakeoff/apps/fleet-observatory/snapback/functions.mjs),
driven by its own acceptance suite) and the hardened sessions-app loader in
the zerobugs control
([functions](repo:demos/zerobugs/control/snapback/functions.mjs) +
[loader script](repo:demos/zerobugs/control/scripts/load-fixture.mts), whose
compiled-plan/handler/digest pipeline runs under the demo's
`bun run test:fixture` suite and whose live path runs in its `test:lane*:live`
acceptance lanes).

## General bulk path: headless replay

<!-- diagnostic-primary: SNAPBACK_REPLAY_DEFINITION_INVALID -->

`SNAPBACK_REPLAY_DEFINITION_INVALID` means the closed `defineReplay(...)`
record is malformed. Follow the diagnostic's named field: paths must be
non-empty filesystem paths (or `file:` URLs), `actions` must be a JSONL path or
async iterable, positive budgets and `clientPool` must stay within the
diagnostic's admitted integer ranges, and `actors` must select exactly one of
`mint` or `bearerFor`. Explicit and Familiar generated mutation references use
the same replay definition.

Each JSONL line is `{seq, actor, fn, args, intent?}`. The function is a
generated mutation reference; `intent` names the bounded settlement projection
available to later mapper steps as `ctx.settled(intent)`. Start a local target,
then run:

```sh
snapback replay snapback --actions fixtures/scale-log.jsonl \
  --ready-file .snapback/dev.ready.json --custody minted --json
```

Use `--custody none` only when receipt-level at-most-once delivery is enough.
Keep the receipts and owner-only session-custody sidecar together; after a dead
runner, rerun the same command with `--resume`. For the full packed 100k proof,
run `node scripts/prove-packed-headless-replay-100k.mjs --ready-file … --api …
--actions …`.

The dispatch WAL stores the mapper-resolved function and arguments, so resume
does not rerun mapper reads for an attempted action. Generated mutation-IR
references currently refuse before dispatch with
`SNAPBACK_REPLAY_GENERATED_IR_UNSUPPORTED`; their speculative identities need
a future public exact-retry carrier. A custom `bearerFor` also receives
`SNAPBACK_REPLAY_BEARER_RETENTION_UNKNOWN`, because replay cannot see retained
settlements that authority owned before the run.

## Bootstrap-window exception: declare a batch-ingest mutation

The minimal shape is one JS mutation that takes a table name and a bounded
array of rows, refuses anything outside its closed table set, and returns a
count receipt:

```js source=demos/zero-bakeoff/apps/fleet-observatory/snapback/functions.mjs
export const ingestFixtureBatch = defineJsMutation({
  args: {kind: v.string(), rows: v.json()}, writes: ['fleets', 'fleetMemberships', 'owners', 'devices', 'events'], result: results.value(v.integer()),
  handler: async (ctx, args) => {
    if (!Array.isArray(args.rows) || args.rows.length > 900) throw new Error('fixture batch must contain at most 900 rows');
    if (!['fleets', 'fleetMemberships', 'owners', 'devices', 'events'].includes(args.kind)) throw new Error('unknown fixture table');
    for (const row of args.rows) await ctx.db.insert(args.kind, row);
    return args.rows.length;
  },
});
```

The **≤900-row batch bound is headroom, not superstition**: the 1,024 ceiling
counts every write expanded into the same commit, including maintained
projections and membership commands, so a batch sized at the ceiling breaks
the moment a table gains a projection. Size batches so direct rows plus
generated effects stay comfortably under 1,024.

Each batch is its own atomic commit — the whole fixture load is **not** one
transaction. That is fine for a fixture: batches are deterministic, ordered,
and verified as a whole at the end (below).

## Gate the loader in a sessions app

An ungated ingest mutation is a general data-import API wearing a test badge.
The zerobugs control gates its loader three ways — `auth: 'authenticated'`
(the loader mints a real dev session, below), refusal of caller-authored
system fields, and a **bootstrap window** that closes the mutation forever
once the fixture is complete:

```js source=demos/zerobugs/control/snapback/functions.mjs
async function requireFixtureBootstrapWindow(db) {
  // @ref LLP 0109#155-quantitative-and-acceptance-closure — this fixture is a
  // sequence of ordinary bounded commits, not a partially installed seed.
  // `searchEpoch` is deliberately last in the frozen load order and therefore
  // acts as the completion sentinel: any later ingest attempt fails closed.
  const completed = await db.query('searchEpoch').take(1).collect();
  if (completed.length !== 0) {
    throw new Error('fixture ingestion is closed after fixture completion');
  }

  // Bootstrap is circular: the fixture creates the source users that a later
  // identityBinding maps to session principals. While the sentinel is absent,
  // only the frozen user population may exist. A foreign source user closes
  // the acceptance loader rather than widening this into a general import API.
  const expected = fixtureUserRoles();
  const users = await db.query('user').take(15).collect();
  if (
    users.length > 14
    || users.some(user => (
      user.role === 'crew'
        ? !expected.crew.includes(user.id)
        : user.role !== 'user' || !expected.user.includes(user.id)
    ))
  ) {
    throw new Error('fixture ingestion found source users outside the frozen fixture');
  }
}
```

The pattern generalizes: pick the table that is **last** in your frozen load
order as the completion sentinel (any row in it means the load finished, so
further ingest refuses), and refuse ingestion whenever data outside the frozen
fixture already exists (the empty-of-source refusal). Together they make the
loader a one-shot bootstrap channel, not an import surface.

## Mint the loader's session from the readiness descriptor

In a sessions-mode app the loader needs a real bearer. `snapback session mint`
is an **admin-gated host operation**; the dev server's readiness descriptor
(`.snapback/dev.ready.json`, schema
[host-ready](repo:schemas/host-ready.schema.json)) names the managed
admin-token carrier in its `adminTokenFile` field — the same owner-only
sidecar described in
[acceptance testing](./acceptance.md#bootstrap-a-backend-without-the-js-kit).
Given `--ready-file`, the CLI discovers that auto-minted token itself when the
declared carrier is the descriptor's mechanical sibling; a loader can also
read the carrier explicitly, as the zerobugs loader does, instead of asking
the caller to export secrets:

```ts source=demos/zerobugs/control/scripts/load-fixture.mts
  const command = process.env.SNAPBACK_RUNTIME_BINARY
    ?? join(CONTROL_ROOT, 'node_modules/.bin/snapback');
  // `session mint` is an admin-gated host-op: it requires the dev server's
  // admin token (SNAPBACK_ADMIN_TOKEN or --token). The readiness descriptor
  // names the managed token carrier; read it here rather than requiring the
  // caller to export secrets.
  const adminTokenFile = ready.adminTokenFile;
  const mintEnv = {...process.env};
  if (!mintEnv.SNAPBACK_ADMIN_TOKEN && typeof adminTokenFile === 'string') {
    mintEnv.SNAPBACK_ADMIN_TOKEN = (await readFile(adminTokenFile, 'utf8')).trim();
  }
  const {stdout} = await execFileAsync(
    command,
    ['session', 'mint', '--email', email, '--ready-file', readyFile],
    {cwd: CONTROL_ROOT, env: mintEnv, maxBuffer: 1024 * 1024},
  );
```

The mint envelope carries `data.token` (the bearer) and
`data.session.userId` (the principal); check `ok === true` before trusting
either. Drive the loader's mutations through
`createExternalSessionClient(baseUrl, { bearerToken })` — see
[native-app auth](../auth/native-apps.md) for that client's contract.

## Batch in frozen order, map the minted IDs

Fixture rows on disk carry **placeholder** identities; the server mints the
real row `_id` at insert. Split each table into ≤900-row batches in one frozen
load order (references only ever point at already-loaded tables):

```ts source=demos/zerobugs/control/scripts/load-fixture.mts
export function fixtureLoadPlan(
  tables: FixtureTables,
): Array<{table: TableName; rows: FixtureRow[]}> {
  const plan: Array<{table: TableName; rows: FixtureRow[]}> = [];
  for (const table of LOAD_ORDER) {
    const rows = tables[table];
    for (let offset = 0; offset < rows.length; offset += MAX_FIXTURE_BATCH_ROWS) {
      plan.push({table, rows: rows.slice(offset, offset + MAX_FIXTURE_BATCH_ROWS)});
    }
  }
  return plan;
}
```

Have the ingest mutation return the minted IDs in input order (the zerobugs
`fixtureIngestBatch` returns `{inserted, ids}`), and maintain the
placeholder↔runtime maps as each batch's receipt arrives; rewrite reference
fields in later batches through that map before sending them. Refuse duplicate
mappings — one placeholder must map to exactly one runtime ID.

## Verify by digest under the null/absent canonical form

After loading, read every table back through the ordinary query surface and
compare a canonical digest against the fixture's compiled contract. One
runtime fact matters here: **an unset optional field is stored — and returned —
as an explicit `null`**. The query surface does not distinguish `null` from
absent, so canonicalization must fold them into one form before digesting (the
zerobugs loader drops nulls, strips server-owned system fields, and maps
runtime IDs back to placeholders):

```ts source=demos/zerobugs/control/scripts/load-fixture.mts
    const normalized: Record<string, JsonValue> = {_id: placeholder};
    for (const [field, value] of Object.entries(row)) {
      if (field === '_id' || field === '_version' || field === '_createdAt' || field === '_updatedAt') {
        continue;
      }
      // Canonical form: unset optional fields are omitted. The runtime's query
      // surface returns them as explicit null and does not distinguish null
      // from absent, so nulls are dropped before digesting.
      if (value === null) {
        continue;
      }
      if (REFERENCE_FIELDS[table].includes(field) && typeof value === 'string') {
        const reference = actualToPlaceholder.get(value);
        if (!reference) fail(`${table}.${field} returned unknown runtime id ${value}`);
        normalized[field] = reference;
      } else {
        normalized[field] = value;
      }
    }
```

Digest the normalized, identity-sorted rows with a key-sorted canonical JSON
encoding and compare per-table counts and digests, plus one overall digest,
against the checked-in contract. Any mismatch is a hard failure naming the
first differing row — determinism is the whole point of the fixture.

## Anti-patterns

- **Do not fight `SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED` by chaining seeds or
  reset-installs.** The versioned-seed protocol is fixture *identity*, not
  bulk transport; use headless replay, with a gated batch mutation only for
  the bootstrap-window exception.
- **Do not size batches at the 1,024 ceiling.** The ceiling counts expanded
  writes (maintained projections, membership commands), not just your rows;
  ≤900 direct rows is the proven headroom.
- **Do not leave the ingest mutation open.** Require a session, refuse
  caller-authored system fields, and close the bootstrap window with a
  completion sentinel plus an empty-of-source refusal — otherwise you have
  shipped a general import API.
- **Do not compare observed rows to fixture bytes raw.** Strip `_version`/
  `_createdAt`/`_updatedAt`, map minted IDs back to placeholders, and fold
  explicit `null` and absent optional fields into one canonical form first.
- **Do not ask callers to export admin secrets.** The readiness descriptor
  already names the managed `adminTokenFile` carrier; discover it (or let
  `--ready-file` discovery do it) instead of pasting tokens into shells or CI
  configuration.
