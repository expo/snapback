# LLP 0129 Phase 2a browser-IR coverage gate — third run, after the single-row Delete admission

Date: 2026-08-07
Status: gate evidence run; not a phase-exit, capability, or Parity claim
Scope: LLP 0129 Phase 2a browser ladder, OQ9-designated exit gate
Runner: `tests/acceptance/browser-ir-coverage-v1.mjs` (`--retain` produced the sibling receipt)
Receipt: `browser-ir-coverage.2026-08-07.v3.json`
Predecessor: `browser-ir-coverage.2026-08-07.v2.{json,md}` (common-path axis 11/12 FAIL — single-row delete refused by the M1 effect ceiling)

## What changed since the second run

The author ruled (Charlie Cheever, 2026-08-07, resolving
`issues/20260807-single-row-delete-effect-ceiling.md`): **single-row `Delete`
is admitted into the M1 local evaluator verb set.** The admitted shape is
exactly the designated `todo-v2-delete-todo` form — a plan whose steps include
at most one `Delete` step addressing one row by id, `ChangedCount` semantics,
missing row a soft no-op. Multi-row, filtered, and fanout deletes
(`DeleteWhere`, `InsertEach`, plans with two or more `Delete` steps) remain
refused with `SNAPBACK_PLAN_EFFECT_CEILING`.

Implementation (all in `packages/snapback-client/`): `Delete` joined the
classifier's local verb set in `ir-evaluator.mjs` (execution needed no change —
the shipping D5 executor already carried the Rust host's exact semantics); a
`Delete` step's target row became a declared point read in
`local-read-admission.mjs` so the admitted workspace materializes the row
being deleted; and `applyPrivateOptimisticLayerV1` in `optimistic-rebase.mjs`
folds `delete` writes (remove by `_id`, missing row a soft no-op). The
`snapback.browser-ir.insert-get-guard-patch.v1` effect-class string is kept
stable and widened in place.

**Not tuned:** the corpus (37/37 SHA-256 exact against the same pinned
manifest), the frozen designation (`handler-coverage.v1.json`, same digest as
the v2 run), the browser carrier, and the comparison policy are all unchanged.

## Component results

| Component | Threshold | Result |
| --- | --- | --- |
| Semantic IR coverage of the frozen corpus | ≥90% | **12/13 = 92.3% — PASS** (carried from the pinned, dated assessment classification; not re-audited) |
| Exact LLP 0051 D5 results in a real browser | exact for all 37 pinned cases | **37/37 — PASS** (browser-vs-Node byte-identical after IndexedDB read-back; manifest-digest-chained to the Phase-1 Rust receipt) |
| Execution coverage of designated browser common-path mutations | 100% of the frozen 12-case designation | **12/12 — PASS** (`todo-v2-delete-todo` now `SNAPBACK_IR_READY`, admitted, real-browser suite completed) |
| Whole gate | all of the above | **PASS** |

The semantic axis is honestly unchanged at 12/13: its audited miss is
all-aboard `applyLiveFeedSnapshot` (general data-dependent control flow), not
delete — `deleteTodo` was already classified IR-expressible in the pinned
assessment. The admission changed the common-path execution axis only.
Contextual plan-shape admission counts over the full 37-case corpus moved from
22 ready / 10 refused / 5 server-only to **23 ready / 9 refused / 5
server-only** (the delete case flipped; `delete-where-filtered` and the
fanout/power-path cases stay refused).

## Rust-side note

The corpus manifest is unchanged and remains digest-chained to the retained
Phase-1 Rust receipt, so Rust-host equality follows from manifest identity
(the receipt's `rustChain: chained` fact). `cargo test --test
data_tier_corpus_v0` was **not** rerun in this lane's worktree (no
bootstrapped Ibex runtime); no Rust source changed and the pinned corpus is
the authority on the executor semantics this change had to match.

## Environment

Same carrier as the prior runs: Google Chrome 151.0.7922.76 (headless, raw CDP
over Node's WebSocket), esbuild-bundled shipping
`@expo/snapback-client/ir-evaluator` closure, per-case IndexedDB persist and
read-back, profile under literal `/tmp` per
`issues/20260806-chrome-indexeddb-profile-macos-tmpdir.md`. Cleanup deleted
the database, stopped the owned Chrome tree, and removed the profile. Run from
the uncommitted gate worktree by design; executed bytes are digest-bound in
the receipt.

## Nonclaims

- No phase exit or advancement: per LLP 0129's standing rule, advancement is
  author-presented; this artifact records the post-ruling measurement for that
  presentation (2026-08-14 timebox).
- No Parity, capability, store, settlement, or React-presentation claim.
- Semantic coverage is a carried, digest-pinned classification of the frozen
  corpus — this run adds no new audit of demo handler sources.
- Codegen still classifies delete handlers
  `SNAPBACK_GENERATED_IR_EFFECT_SERVER_ONLY`; nothing here claims a generated
  local artifact exists for any demo delete mutation (the emission-side
  widening is a named follow-up in the closed ruling ticket).

## Reproduce

```sh
node tests/acceptance/browser-ir-coverage-v1.mjs --dry-run   # corpus + designation + bundle only, no browser
node tests/acceptance/browser-ir-coverage-v1.mjs --retain    # full run, writes the dated receipt
```
