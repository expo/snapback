# L2 dynamic `take(limit)` verdict

**Status:** Inconclusive — downgraded in review from "not reproducible"
**Opened:** 2026-08-28
**Systems:** Code generation, JavaScript handler runtime, Query builder, Guide verification
**Source:** LLP 0317.000 lane L2; LLP 0317 row O10; `sol-snapback-explicit` run-log event `1787864590`

## Verdict

**Inconclusive** (downgraded in review; the original claim was "not
reproducible"). The matrix below is sound and the runtime result is real, but it
does not meet LLP 0317.000 P1's evidence bar: it ran on **macOS arm64** against a
binary stamped `92c0033…`, which is **not an ancestor** of the reviewed checkout,
while the reported lane ran **Linux x86_64 on published 0.1.29**. P1 requires the
reported platform and a binary from the tested checkout, so this closes as
inconclusive rather than as a negative. Re-running the same matrix on Linux
x86_64 with a matching binary would settle it.

**What the matrix does establish:** A positive runtime argument passed to `.take(args.limit)`
did not produce an empty projection in any tested configuration. The 14 cells
that can reach the runtime each produced their expected result for **10
consecutive runs** against a real Snapback server and a 1,125-row table. The
two remaining cells are inline handlers with a literal `take(1_025)`; codegen
correctly refuses those before runtime.

The guide's `.take(args.limit)` example is not broken by the mechanism alleged
in run-log event `1787864590`. Do not remove or generation-refuse dynamic
`take`. The historical empty history page remains real evidence, but the
retained run-log has neither the pre-workaround handler source nor a runtime
trace that can identify its actual cause. A different application, argument,
predicate, projection, or test-fixture cause is therefore still possible.

## Exact reproduction

```sh
export SNAPBACK_RUNTIME_BINARY=/Users/ccheever/projects/snapback/target/debug/snapback
node packages/snapback-codegen/guide-time-windowed-live-reads.test.mjs --runtime-matrix
```

Result:

```text
dynamic take runtime matrix: 14 runtime cells x 10 consecutive runs pass; 2 literal-over-inline cells refuse generation; 4 dynamic zero-limit and 4 empty-range controls return intentional empty projections
guide-time-windowed-live-reads.test.mjs: guard, indexed windows, refusal, paging, boundaries, renewal, scale, and owner isolation pass; real-runtime take matrix pass
```

The harness generates a temporary Explicit-profile backend, provisions 1,100
rows in the selected `target` range plus 25 rows in another range, and invokes
the generated operations through `SnapbackClient.query` against the prebuilt
native server. It covers inline `handler:` functions and closed-script module
handlers registered through `globalThis.__snapbackHandlers`.

The required binary reports embedded commit
`92c00336f998295371a5ca78df866e8456dccfe0`; the checkout tested was
`4d4ce40bd9b3921a88d37063b47693923ca8c1d3`. The lifecycle helper reported
that stamp mismatch and launched because the binary was explicitly configured,
which is the lane-prescribed reuse path. No runtime or Hermes build was run.

## Condition matrix

`under` is 7 and `over` is 1,025. A successful cell returned exactly seven
rows on every run. Range cells used the declared `by_bucket_sequence` index and
an equality predicate before `take`.

| Bound form | Bound | Preceding range | Inline handler | Module handler |
|---|---:|---|---|---|
| literal | under | no | 7 rows, 10/10 | 7 rows, 10/10 |
| literal | under | yes | 7 matching rows, 10/10 | 7 matching rows, 10/10 |
| literal | over | no | generate-time `SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN` | runtime `SNAPBACK_QUERY_LIMIT_INVALID`, 10/10 |
| literal | over | yes | generate-time `SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN` | runtime `SNAPBACK_QUERY_LIMIT_INVALID`, 10/10 |
| `args.limit` | under | no | 7 rows, 10/10 | 7 rows, 10/10 |
| `args.limit` | under | yes | 7 matching rows, 10/10 | 7 matching rows, 10/10 |
| `args.limit` | over | no | runtime `SNAPBACK_QUERY_LIMIT_INVALID`, 10/10 | runtime `SNAPBACK_QUERY_LIMIT_INVALID`, 10/10 |
| `args.limit` | over | yes | runtime `SNAPBACK_QUERY_LIMIT_INVALID`, 10/10 | runtime `SNAPBACK_QUERY_LIMIT_INVALID`, 10/10 |

No positive, in-ceiling bound returned an empty projection. An excessive bound
also never degraded to empty: it refused. Empty projections were reachable
only under ordinary empty-prefix conditions in the controls:

- runtime `args.limit === 0` returned `[]` in all four inline/module ×
  range/no-range dynamic shapes; and
- a positive under-ceiling bound returned `[]` when the preceding range
  predicate matched no rows, in all four literal/dynamic × inline/module range
  shapes.

These are expected query semantics, not a dynamic-bound failure. The reported
lane said its caller validated `limit` to 1–100 and described a first page that
should contain history, so neither control explains that event unless the
actual value or range differed from the retained attribution.

## What the Guide CI checks actually prove

Two different checks touch this recipe:

1. `node scripts/check-guide.mjs` checks that the fenced example remains an
   exact transclusion of
   `tests/fixtures/guide-time-windowed-live-reads/functions.mjs`, plus Guide
   corpus/manifest consistency. It does not start Snapback or invoke the
   handler.
2. `bun run --cwd packages/snapback-codegen test` includes
   `guide-time-windowed-live-reads.test.mjs`. Its ordinary CI path does execute
   the exact `.take(args.limit)` handler with `limit: 7` over 1,025 matching
   rows, and asserts a seven-row newest-first page. It is more than a type
   check, but it calls the imported inline handler with the test's
   `createHandlerHarness()` JavaScript query-builder double. It does **not**
   cross the native Snapback runtime boundary.

Therefore the pre-existing “CI-verified” claim is behaviorally stronger than
type-checking but weaker than real-runtime acceptance. The new
`--runtime-matrix` mode supplies the missing native-runtime evidence without
making the ordinary codegen package gate depend on a local native binary.

The full package command was run. It stopped before reaching the recipe test
because the earlier, unrelated `offline-replay-authoring-packed.test.mjs`
failed with `SNAPBACK_CLIENT_REFUSED: packed fixture offline`. The exact recipe
test was therefore also run directly; it passed, including the mocked
`.take(args.limit)` behavior. This lane changes neither the offline-replay test
nor its code paths.

## Verification

- `node packages/snapback-codegen/guide-time-windowed-live-reads.test.mjs` — pass
- real-runtime matrix command above — pass
- `node scripts/check-package-test-inventory.mjs` — pass, 364 declared tests
- `./ref-check --verbose` — pass, 0 errors and 0 unchecked refs
- `node scripts/check-guide.mjs` — 19 checks passed with 0 content failures,
  but the command exited 1 on three existing generated-artifact preconditions
  (missing competitive-checkpoint and Exact/Contract demo outputs); the snippet
  sweep enumerated 1,890 snippets
- `bun run --cwd packages/snapback-codegen test` — stopped before this recipe
  test on the unrelated packed-offline failure described above

No Guide source was changed, no product behavior was changed, and no generated
artifact was edited. The existing Guide check preconditions name
`./scripts/check-generated-artifacts` plus the Contract demo install/acceptance
commands; per lane policy, the supervisor should materialize those once over
the integrated tree rather than this lane editing generated outputs.
