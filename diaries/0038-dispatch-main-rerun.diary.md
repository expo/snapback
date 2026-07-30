# Diary 0038: Dispatch current-main rerun

**Application:** durable jobs, actions, atomic completion events, reactive
queue state, and recurring work
**Rerun:** 2026-07-30
**Snapback revision:** `01e941730306973aadaf21cd50b4c1613d171075`
**Systems:** Snapback, Convex, inline handlers, result contracts, actions,
cron, live queries, generated custody, Ibex/Hermes runtime, acceptance
**Related:** Diary 0029 on the superseded bakeoff branch; LLP 0010, LLP 0028,
LLP 0041, LLP 0108;
`/Users/ccheever/projects/snapback-workout-matrix-20260729/apps/07-dispatch`

## Why rerun

The first Dispatch arm used the legacy declaration-plus-`handlers.mjs` form,
left computed rows and mutation/action values without exact result contracts,
committed a large generated tree, and tested cron inspection through an older
combination of public and admin projections.

Current main has changed all four areas. I kept the same five-check parity
contract and the Convex control unchanged, then migrated only the Snapback
authoring and proof surface:

- `jobStats`, `enqueue`, and `completeNext` now carry direct, self-contained
  handlers beside their declarations;
- `dispatchNext` uses the same direct-handler form for an action;
- computed counts, table IDs, and the completion discriminated union have
  exact `results.records(...)` / `results.value(...)` contracts;
- the legacy `handlers.mjs` file is gone; and
- recurring-work evidence uses the documented authenticated `AdminClient`
  inspection and asserts a successful run in the cron ledger.

## Commands and final evidence

```sh
cd /Users/ccheever/projects/snapback-workout-matrix-20260729/apps/07-dispatch/snapback-app
node ../../../../snapback/packages/snapback-codegen/index.mjs snapback
npm test
```

Snapback passed **5/5** against a real isolated server:

1. deterministic seed and backend-derived status counts;
2. action → mutation completion plus durable event;
3. invalid enqueue rejection without a queue change;
4. forced cron tick observed through the native live connection; and
5. registered job plus successful run in authenticated admin inspection.

The final server binary and clean checkout both identify
`01e941730306973aadaf21cd50b4c1613d171075`.

The unchanged Convex arm passed **5/5** against its real anonymous local
backend on isolated ports 3270/3271:

```sh
cd /Users/ccheever/projects/snapback-workout-matrix-20260729/apps/07-dispatch/convex-app
CONVEX_AGENT_MODE=anonymous ../../../node_modules/.bin/convex dev --once \
  --typecheck disable --tail-logs disable \
  --start 'node tests/acceptance.mjs'
../../../node_modules/.bin/tsc -p convex/tsconfig.json --noEmit
```

Functions were ready in 121.06 ms, all five checks passed, and the direct
TypeScript check was clean.

## What improved in Snapback

### One-file handler authoring is the default I wanted

The operation's arguments, declared data access, result contract, and
implementation now form one review unit. Dispatch no longer has a parallel
registry of `source` and `exportName` strings to keep synchronized. The action
also fits the same form, so `ctx.runMutation("completeNext", ...)` is visible
beside its declared write reach.

This is materially closer to Convex's function authoring loop. Convex still
has the advantage of TypeScript context inference and generated function
references inside server code, but the old navigation tax is gone here.

### Result contracts closed the most important type holes

`jobStats` now returns a closed record with integer `total`, `queued`,
`succeeded`, and `other` fields. Both the mutation and action return the same
closed union:

- `{ completed: false }`; or
- `{ completed: true, id: Id<"jobs">, trigger: string }`.

Codegen validates those shapes at the runtime boundary and publishes them in
the generated API. The prior diary's complaint that the computed stats row was
`unknown` is fixed.

The remaining degradation is deliberate and narrow: the contract permits an
arbitrary job `payload`, so both the stored field and enqueue argument use
`v.json()`. Codegen emitted two actionable
`PROVIDER_INTROSPECTION_RESULT_TYPE_DEGRADED` warnings for that value. Convex's
matching `v.any()` boundary is also intentionally unstructured, although its
surrounding TypeScript loop makes the loss less visually prominent.

### Generated custody is much better

Codegen reported:

```text
files 28 (review manifest 1, consumer committed 0, ignored cache 27)
```

The full graph still exists for runtime, Contract, provider, and capability
consumers, but only deterministic `generated/artifacts.json` belongs in source
control. This directly fixes the old “commit roughly 140 KiB for a tiny
backend” complaint. The external matrix began as a legacy repository with the
whole generated tree tracked, so this rerun also had to migrate that repository
to the current custody policy; that migration is mechanical but not automatic.

### Cron proof is clearer

The guide's current cron page points to authenticated `AdminClient.inspect()`
or `openHeadlessApp(...).admin.inspect()`. The resulting `state.cron.jobs`
shape contained the configured job and its `recentRuns` ledger exactly where
the guide said it would. There was no source dive or public/admin projection
guessing.

The deterministic tick remains one of Snapback's strongest advantages in this
matrix: autonomous scheduling stayed disabled, the test forced one tick, and
the proof crossed action, mutation, durable rows, live delivery, and admin
ledger without sleeping.

## What remained painful or surprising

### Runtime qualification had an ordering blind spot

The first current-main run failed every JS-backed operation with
`SNAPBACK_RUNTIME_CREATE_FAILED`, even though:

- `scripts/ibex-doctor` found the framework;
- `scripts/bootstrap-ibex-runtime` returned exit 0;
- the exact binary linked and launched;
- binary and checkout provenance matched; and
- declarative/live/ephemeral paths in other arms still worked.

Running the server with inherited output exposed:

```text
Armed startup refused: Hermes promise rejection checkpoint tracking is unavailable
```

The ignored Hermes artifact had been refreshed after an earlier binary link.
A subsequent exact relink through the paved bootstrap restored Dispatch to
5/5 and restored every other affected inline-handler arm. No application code
change was required.

This is much better than the prior stale-binary mismatch—the final provenance
is exact—but it reveals that “link + launch smoke passed” is not yet equivalent
to “an armed handler VM can be created.” The follow-up is recorded in
`issues/20260730-bootstrap-smoke-does-not-create-armed-handler-vm.md`.

### External consumption is still a source-checkout exercise

The app imports codegen, client, admin client, and test-kit modules through
relative paths into the sibling Snapback checkout and runs the checkout's
native binary. The generated custody policy is ready for normal repositories,
but this experiment still does not prove a published package/starter/runtime
installation that a new application can consume without monorepo knowledge.

### Convex scheduling is still more composable

Convex's `ctx.scheduler.runAfter(0, ...)` lets enqueue atomically register
durable follow-up work. It is a tiny and useful ordinary function primitive.
Snapback's recurring cron definition and action path are explicit and
testable, but there is still no equally obvious transactional one-off schedule
primitive in this app-authoring surface.

Convex's recurring minute job could be deployed and inspected as source, but
the acceptance suite still lacked Snapback's deterministic force-tick seam.
So the scheduling result remains split: Convex wins authoring/composition;
Snapback wins deterministic recurring-work proof.

## Direct comparison

This pair is much closer than the first bakeoff:

- handler colocation is effectively tied;
- structured result typing is close for explicitly declared Snapback results;
- both provide clean action → atomic mutation composition;
- both pass the same real-backend behavior;
- Snapback now wins generated source-control economy rather than losing it;
- Convex wins transactional one-off scheduling and native TypeScript inference;
  and
- Snapback wins forced recurring ticks, capability evidence, trusted runtime
  values, isolated server ownership, and run-ledger inspection.

For Dispatch alone I would still choose Convex for a conventional product
backend because `runAfter` is the most directly useful scheduler primitive and
the installed TypeScript workflow is more mature. The margin is no longer
large. Snapback is the better test/evidence system for recurring work, and its
old authoring and generated-tree disadvantages are substantially closed.
