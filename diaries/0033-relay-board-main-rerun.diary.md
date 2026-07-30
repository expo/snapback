# Diary 0033: Relay Board current-main rerun

**Application:** Relay Board, native Snapback and Convex
**Date:** 2026-07-30
**Snapback revision:** `01e941730306973aadaf21cd50b4c1613d171075`
**Code:** `/Users/ccheever/projects/snapback-workout-matrix-20260729/apps/02-relay-board`
**Prior diary:** `diaries/0024-relay-board-matrix.diary.md`
**Systems:** Snapback, Convex, inline handlers, result contracts, relations,
activity, codegen, native realtime

## Why rerun

The first Relay Board pass used legacy `source`/`exportName` handlers, string
foreign keys, and degraded `unknown` result types. This rerun asks whether
current Snapback main materially improves that authoring experience without
quietly substituting experimental relation/activity profiles or changing the
paired Convex contract.

I re-read the root LLP, guide index, queries, mutations, relational queries,
generated-artifact custody, live queries, and acceptance. The governing
current-main additions were LLP 0108's inline handlers/result contracts and LLP
0110's still-Review bounded-children/write-activity proposal.

## Current-main changes

The Snapback arm now:

- colocates all three handlers directly in `functions.mjs`;
- removes `handlers.mjs`;
- declares typed relation fields with `v.id(...)` instead of strings;
- uses `results.records(...)` for the board view and summary;
- uses `results.value(...)` for the move result; and
- projects the composite board view into a closed result shape, including the
  card/activity commit versions needed by acceptance.

The generated API now carries exact branded IDs and nested readonly result
types. For example, `boardView`'s generated result knows the complete
board/columns/cards/activity record shape, and `moveCard` returns a typed
`{cardId, activityId, sequence}` instead of `unknown`.

The source-authoring trade changed. The old authored backend was 148 lines
across schema/functions/handlers. The current backend is 224 lines across
schema/functions, largely because the exact nested result contract is verbose
and the guide's inline profile steered this app away from a shared sibling
reader helper. Navigation is better—one file contains contract plus
implementation—but source is not smaller.

## Relation and activity honesty

Current Snapback has a stable two-source unique-side relational query, but it
does not fit Relay Board's argument-scoped one-board/many-columns/many-cards
view. `defineBoundedChildrenQuery` would model one child collection, and
`defineWriteWithActivity` would model a source write plus audit append, but
both remain experimental and publication-gated under LLP 0110. The capability
guide explicitly says not to select them merely because their builders exist.

I therefore kept the board view and atomic move as ordinary inline JS
operations. Generated inspection confirms that no operation requires
`bounded_children_v1` or `write_activity_v1`. This is not a claim that relation
or activity publication shipped for the app.

The improvement that is honest today is narrower:

- relation intent is stronger at schema/argument/result boundaries through
  branded table IDs;
- mutation reads/writes remain explicit;
- the ordinary JS transaction still atomically patches the card and inserts
  activity; and
- acceptance still proves both rows share one commit version.

## Code generation and static evidence

Commands:

```sh
cd /Users/ccheever/projects/snapback
node packages/snapback-codegen/index.mjs \
  /Users/ccheever/projects/snapback-workout-matrix-20260729/apps/02-relay-board/snapback-app/snapback

cd /Users/ccheever/projects/snapback-workout-matrix-20260729
npx tsc --noEmit --skipLibCheck \
  --module nodenext --moduleResolution nodenext --target es2022 \
  apps/02-relay-board/snapback-app/snapback/generated/api.d.ts
npx tsc --noEmit \
  -p apps/02-relay-board/convex-app/convex/tsconfig.json
```

Codegen result:

```text
tables 4; operations 3 (query 1, live query 1, mutation 1)
files 21 (review manifest 1, consumer committed 0, ignored cache 20)
warnings 0
inputsHash a741e9ce3279…
```

This closes the prior pass's two
`PROVIDER_INTROSPECTION_RESULT_TYPE_DEGRADED` warnings. Generated Snapback
declarations and the unchanged Convex project both typechecked.

The generated materialized tree is 21 files / 3,203 measured lines / 103,660
bytes. Inline handler bundles and expanded exact result contracts account for
much of that graph. Current codegen's custody summary calls only
`artifacts.json` the review manifest and the other 20 files regenerable cache.
The final external-workout commit migrated to that policy: it retains the
manifest plus measured cache statistics, not the legacy full generated tree.

## Runtime/bootstrap incident

The first authoritative attempt used a clean exact-stamp main binary and failed
both Relay Board and Campfire while loading their first JS operation:

```text
SNAPBACK_RUNTIME_CREATE_FAILED: Ibex runtime could not be created
```

The native cause reproduced in the concurrent runtime investigation as:

```text
Armed startup refused: Hermes promise rejection checkpoint tracking is unavailable
```

The concrete local ordering was revealing:

- `target/debug/snapback` timestamp: `00:52:53`;
- `hermesvm.framework` refresh timestamp: `00:55:00`.

The binary was exact-stamped but dynamically loaded a newer framework than the
one it linked against. `scripts/ibex-doctor` reported the framework present and
did not detect this state. The bootstrap link/launch smoke also does not create
an application JS VM, so a binary can launch and serve health while the first
handler refuses.

Running `scripts/bootstrap-ibex-runtime` after the framework refresh relinked
the exact-main binary at `00:55:57`. Its recovery record reported commit
`01e9417…`, clean, build profile `debug`, and
`SNAPBACK_IBEX_RUNTIME_LINK_OK`. The same Relay Board acceptance then passed.

This is a current-main runtime/bootstrap gap, not an app-source failure. It is
more subtle than the prior run's loud stamp mismatch: the first run's old
binary was visibly mismatched but usable; this run's initially exact-stamped
binary looked authoritative yet could not create a handler runtime.

## Real-backend results

Snapback:

```sh
node apps/02-relay-board/snapback-app/tests/acceptance.mjs
```

Result: **6/6 passed** on an isolated real server after the relink.

- indexed column order: backlog, doing, done;
- deterministic seed: 3 cards, 1 activity;
- derived counts: `1,1,1`;
- move `changed_count`: 2;
- card and activity commit version: 2;
- invalid cross-board move preserved state; and
- native client B observed client A's live move to `col_done`.

Convex:

```sh
cd apps/02-relay-board/convex-app
CONVEX_AGENT_MODE=anonymous npx convex dev \
  --start 'node tests/acceptance.mjs' \
  --tail-logs disable --typecheck disable
```

The unchanged Convex arm ran on isolated port 3230 and again reported **6/6
passed**, including atomic move/audit, rollback, and second-client `onUpdate`.
The watch process was stopped explicitly after the receipt.

## What improved

- Result typing is the largest win. The prior `unknown` boundary is now exact
  through generated native references.
- Handler declaration and implementation are colocated; the name/source/export
  duplication is gone.
- Table-scoped IDs make relationship mistakes visible to generated consumers.
- Codegen emits a concise summary with custody and degraded-result counts.
- The exact-main runtime passed all behavior once binary and framework were
  coherently relinked.

## What remains worse or surprising

- Closed composite result contracts are verbose and increased both authored
  and generated volume.
- The common board-with-children/activity shape still lacks a stable,
  generally publishable closed profile. The available LLP 0110 builders must
  remain a nonclaim.
- Inline colocation duplicated indexed board reads between view and summary.
  A documented safe helper/import pattern would help without restoring the old
  global registry.
- Exact build identity did not protect against a post-link framework refresh.
  Runtime creation needs to be part of bootstrap acceptance, and doctor should
  compare/link-test the exact binary/framework pair.
- Convex remains more concise for this transaction and infers result types from
  TypeScript without an explicit result-schema block. Snapback remains stronger
  at emitted evidence and commit-version proof.

## Priority improvements exposed by the rerun

1. Make bootstrap instantiate and execute a minimal inline handler after the
   final framework refresh, not only link and launch the server.
2. Teach `ibex-doctor` to detect binary/framework ordering or ABI mismatch.
3. Graduate relation/activity profiles only after their publication and target
   evidence gates genuinely close; until then, keep their nonclaim prominent.
4. Reduce composite result-contract boilerplate, ideally through schema-backed
   projection helpers that preserve exact egress validation.
5. Document a safe colocated helper-sharing pattern and keep codegen's concise
   review manifest while avoiding oversized committed cache diffs.
