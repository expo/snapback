# Diary 0032: Streak Lab current-main rerun

**Application:** owner-scoped habit check-ins and derived streak analytics on
Snapback and Convex
**Rerun:** 2026-07-30
**Snapback revision:** `01e941730306973aadaf21cd50b4c1613d171075`
**Systems:** Snapback, Convex, Inline handlers, Result contracts, Code
generation, Ibex/Hermes runtime, Live queries, Acceptance
**Related:** Diary 0023; LLP 0003, LLP 0004, LLP 0008, LLP 0010, LLP 0108;
`/Users/ccheever/projects/snapback-workout-matrix-20260729/apps/01-streak-lab`

## Why rerun

The first Streak Lab implementation used the legacy
`source: "handlers.mjs"` / `exportName` authoring path. Snapback codegen warned
that the computed dashboard result degraded to `unknown`, and the prior diary
ranked colocated handlers and precise result typing among the highest-value
improvements.

Current main ships both. This rerun migrated the same contract without changing
the Convex control:

- `habitDashboard` is one direct inline `defineJsLiveQuery` handler;
- `recordCheckIn` is one direct inline `defineJsMutation` handler;
- the dashboard uses an exact `results.records(v.object(...))` contract,
  including bounded `recentDates`, integer streaks, and all exposed stored
  habit fields;
- the mutation returns `results.value(v.id("checkins"))`; and
- the mutation declares `outgrewIr: "filtered-read-guards"` instead of leaving
  its tier choice implicit.

The legacy `handlers.mjs` file was deleted.

## Orientation and guide experience

I reread the root/capability index and current query, mutation, live-query,
acceptance, and first-backend pages, then oriented through LLP 0108. The
governing rules were:

- the inline handler must be a direct self-contained expression;
- result omission is explicitly degraded, never inferred;
- computed query rows use `results.records`, mutation scalars/IDs use
  `results.value`;
- result contracts validate the post-JSON image before publication or commit;
  and
- generated references carry precise result types.

The query and mutation pages showed the current path clearly. The
first-backend page still leads with the legacy separate-handler form and says
JS logic lives in `handlers.mjs`. That page now conflicts with the paved
current examples. I did not open a repository issue because this delegated
scope was restricted to apps 01/05 and the two rerun diaries, but it is a real
guide freshness gap.

## Commands

Generation and checks:

```sh
node /Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs \
  apps/01-streak-lab/snapback-app
node --check apps/01-streak-lab/snapback-app/functions.mjs
npx tsc -p apps/01-streak-lab/convex-app/convex/tsconfig.json
```

Real Snapback acceptance:

```sh
node apps/01-streak-lab/snapback-app/acceptance.mjs
```

Runtime diagnosis and paved preparation:

```sh
/Users/ccheever/projects/snapback/scripts/ibex-doctor
/Users/ccheever/projects/snapback/scripts/bootstrap-ibex-runtime
node apps/01-streak-lab/snapback-app/acceptance.mjs
```

Real isolated Convex control:

```sh
cd apps/01-streak-lab/convex-app
CONVEX_AGENT_MODE=anonymous bunx convex dev --once \
  --start 'node acceptance.mjs' --tail-logs disable
```

The ignored Convex local config used ports 3250/3251. The one-shot process
exited afterward.

## What current-main authoring fixed

### Colocation is real

There is now one operation declaration containing arguments, declared reads or
writes, result contract, tier classification, and implementation. The
name/source/export registry duplication from Diary 0023 is gone. Navigation is
substantially better, and codegen reports both operations as inline.

This was not automatically fewer lines. Inline v1 requires the direct handler
to be self-contained, so the civil-date parser/inverse must appear in both the
query and mutation. The old separate module shared those helpers. The migration
traded cross-file wiring for local duplication.

### Result typing is precise

Codegen completed with **zero warnings**. Generated `api.d.ts` now exposes:

- `habitDashboard` as a live query returning a readonly array of the exact
  closed habit analytics record;
- `recentDates` as `ReadonlyArray<string>`;
- table-scoped IDs for habits/check-ins; and
- `recordCheckIn` as returning `Id<"checkins">`.

Provider introspection records `snapback.result-contract.v1`, `allowExtra:
false`, bounds `completedLast7` to 0–7, and bounds `recentDates` to seven
items. This directly closes the prior `unknown` warning and cast pressure.

### Tier intent is visible

`recordCheckIn` performs a compound indexed duplicate guard that is not a
simple closed mutation plan. `outgrewIr: "filtered-read-guards"` makes that
choice machine-readable rather than leaving readers to infer why JS was used.

## What remains painful

- Self-contained direct handlers cannot share the nontrivial calendar helper.
  This app's total Snapback authored/acceptance volume rose from 345 lines /
  11,636 bytes to 389 lines / 13,831 bytes despite deleting a file.
- External authoring still imports the codegen package and test kit through
  checkout-relative paths. The installable starter/package experience is not
  exercised here.
- The complete materialized graph grew from 927 lines / 32,892 bytes to 1,848
  lines / 62,664 bytes across the same 18 files. The extra contract,
  implementation-identity, and custody evidence is substantive. Under current
  custody only `artifacts.json` is committed, so this is cache/generation
  volume rather than an 18-file source-review burden.
- The getting-started guide still teaches the legacy handler split before the
  newly paved inline form.

## Runtime evidence: exact build, recovered bootstrap ordering

The coordinator prepared `target/debug/snapback` from clean main and confirmed
that both the binary stamp and checkout were exactly
`01e941730306973aadaf21cd50b4c1613d171075`. This fixes Diary 0023's
`stamp-mismatch` provenance caveat.

The first app attempt nevertheless could not create an Ibex VM:

- deterministic seed/owner query: `SNAPBACK_RUNTIME_CREATE_FAILED`;
- derived analytics: same;
- live second-client update: same;
- duplicate test: same; and
- invalid-date/cross-owner rejection check: superficially passed.

That initial nominal **1/5** must not be counted as positive Snapback evidence:
check only asserts that invalid calls reject, and VM-creation failure satisfied
the broad rejection predicate before application validation ran.

`scripts/ibex-doctor` found the Hermes framework present and warned only that
the vendored Ibex CLI was not built. `scripts/bootstrap-ibex-runtime` exited 0
with:

```text
vendored Ibex/Hermes artifacts are already usable
validating Snapback native runtime: exact cargo link + launch smoke
```

An immediate sequential retry failed identically. At that point the evidence
showed:

- binary provenance is fixed;
- link and server-launch smoke are green;
- actual JS handler VM creation is not covered by those gates; and
- the current artifact ordering had no positive current-main Snapback query,
  mutation, or live runtime evidence.

The coordinator then reproduced the native refusal and captured the underlying
cause:

```text
Armed startup refused: Hermes promise rejection checkpoint tracking is unavailable
```

Ignored native artifacts were refreshed through the paved vendored
bootstrap/download cache—not by editing or copying framework files by hand.
Exact linking initially continued to pass while handler creation failed. A
parallel matrix lane then identified the ordering defect: bootstrap had run
before the final framework refresh. Rerunning the same paved bootstrap *after*
that refresh rebuilt/relinked the exact binary against the final framework.

The sequential Streak Lab rerun then passed **5/5**:

1. deterministic seed, index, and server-derived owner scope;
2. exact current/longest/seven-day analytics;
3. a second native client receiving the live check-in;
4. duplicate rejection with one durable row; and
5. invalid date plus cross-owner rejection.

Final provenance:

- checkout and binary embedded commit:
  `01e941730306973aadaf21cd50b4c1613d171075`;
- binary modified `2026-07-30T00:55:57-0700`;
- framework artifact modified `2026-07-30T00:55:00-0700`; and
- framework SHA-256
  `7c3dd1a82c329c187d57939071dbffb8fa699518559a32019f17077a4413bfb6`.

The acceptance harness printed `spawned snapback binary identity: unpinned`,
so the diary does not use that label as provenance evidence; the explicit
configured binary path, checkout hash, embedded binary commit string, and
framework digest above provide the exact evidence.

The final classification is **recovered bootstrap-ordering friction**, not a
runtime outage and not an application logic failure. It is still a significant
developer-experience gap: link/launch smoke passed in the bad ordering, while a
real handler VM failed. Retained machine evidence is at
`apps/01-streak-lab/results/main-rerun.json`.

## Convex control

The unchanged Convex arm passed **5/5** against a real anonymous local backend:

1. deterministic indexed owner filtering;
2. exact frozen-clock analytics;
3. second-client `onUpdate`;
4. duplicate rejection without a second row; and
5. invalid date plus cross-owner rejection.

Functions were ready in 268.93 ms on the recorded run. The earlier limitations
remain: owner identity is caller-supplied in this anonymous exercise, duplicate
uniqueness lives in mutation code rather than the schema, and agent-local mode
is beta with colliding default ports.

## Size and generation evidence

Current Snapback codegen:

```text
tables 2; operations 2; live 1
files 18 (review manifest 1, consumer committed 0, ignored cache 17)
warnings 0
inputsHash 4226eb7a7c151b3dceb46cf9e967ff4b52a35ebc368727b8727e0507027e957a
real 1.33s; user 0.66s; sys 0.09s
```

| Arm | Authored source + acceptance | Generated |
| --- | ---: | ---: |
| Snapback current main | 389 lines / 13,831 bytes | 18 files, 1,848 lines / 62,664 bytes |
| Convex unchanged | 296 lines / 10,187 bytes | 5 files, 368 lines / 12,444 bytes |

The generated comparison is not feature-equivalent: Snapback includes
Contract/provider/capability/identity review artifacts. It still matters to
repository review and artifact custody.

## Verdict against Diary 0023

Fixed:

- duplicate function/handler registry and navigation;
- unknown dashboard result typing;
- lack of runtime egress contract;
- implicit JS-tier rationale; and
- binary/check-out provenance mismatch.

Still open:

- installable external-package ergonomics;
- helper reuse within direct inline handlers;
- dense review-manifest ergonomics and complete-cache generation volume;
- first-backend guide freshness; and
- atomic bootstrap/download ordering, plus a readiness gate that creates a real
  handler VM and proves every armed-startup prerequisite—including
  promise-rejection checkpoint tracking—after the final framework refresh.

Against Convex, Snapback's authoring/type gap is now much narrower and its
schema-level unique constraint plus server-derived owner remain strengths.
Both arms ultimately passed the same 5/5 contract. Convex reached its green run
without the native artifact-order incident; Snapback recovered only after the
final-framework/bootstrap ordering was corrected.
