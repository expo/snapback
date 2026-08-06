# Local proof agent-safe publication fixtures drifted from the 2026-08-06 carrier lineage

**Status:** Resolved
**Filed:** 2026-08-06
**Systems:** Local proof, Agent-safe publication, Local persistent store,
Release gating
**Related:** LLP 0162, LLP 0041,
`issues/closed/20260803-first-npm-latest-promotion.md`

## Defect

The fourth 0.1.11 successor-release attempt pinned clean `origin/main`
`85e1e5a160e7080214e15bed02deb3c9c2432380` and ran the complete 134-gate
local proof with Exact required under Node 24.18.0. After 15 gates passed, the
fail-fast run stopped at `agent-safe-publication-fixtures`: 25 fixture cases
passed and three failed.

The production checker was moved to the fresh 2026-08-06 local-store/Triage
receipt lineage in `29d4c3d46585931ebd7756a7bb8ec10fa1b3bd14`, but the checker
self-tests still construct and assert the prior 2026-08-04 paths:

- `localStoreTransformPaths` and its mutation list materialize the 2026-08-04
  local-store carrier plus Triage receipts into a scratch qualification-C
  commit;
- `expectedLocalStorePublicationTransform` now reads the 2026-08-06 paths
  selected by `LOCAL_STORE_PUBLICATION_TRANSFORM`, so both transform tests
  fail at `git show <scratch-C>:...2026-08-06...` because those paths were
  never added to the scratch commit; and
- the publication-path allowlist test still expects the retained
  `triage-graph/move1-exit.2026-08-04.v1.json` path to be admitted, while the
  production allowlist replaced that member with the 2026-08-06 receipt.

The live checker command itself completes and reports both agent-safe records
as `withheld`; that does not make the proof green because the adversarial
self-tests are an explicit, central proof gate.

## Reproduction

From clean candidate `85e1e5a160e7080214e15bed02deb3c9c2432380`:

```sh
volta run --node 24.18.0 node --test tests/agent_safe_publication_checker_v1.mjs
```

Observed failures:

1. `P-vs-C publication path allowlist rejects executable drift`
2. `P-vs-C local-store carrier refresh is an exact digest-only transform`
3. `P-vs-C local-store transform rejects extra carrier or anchor edits`

The complete proof receipt stopped with 15 `PASS` rows followed by this one
`FAIL` row in `target/proof/local-proof-results.jsonl`.

## Required resolution

- Reconcile the self-test fixture with the exact receipt lineage selected by
  the production transform. Prefer one exported, closed path inventory over
  duplicating date-stamped path lists between checker and test.
- Decide explicitly whether the retained 2026-08-04 receipt is historical
  input that must remain allowed or a superseded path that the test must now
  reject; do not make both generations publication-authorized accidentally.
- Preserve the negative cases proving executable drift and extra
  carrier/anchor edits fail closed.
- Run the focused fixture suite and then the complete 134-gate pinned-Node
  proof before another release attempt.

## Release impact

This is the sixth distinct central gate encountered by the 0.1.11 successor
release attempts. Per the release task's fail-fast ruling, attempt 4 stopped
before tarball staging. No 0.1.11 ledger was created, no package was published,
no dist-tag moved, and no public-registry or G4 external smoke proof ran.

## Resolution

Resolved 2026-08-06. The checker now exports its closed local-store
publication-transform inventory, and the adversarial self-test derives its
scratch qualification-C fixture and receipt mutations from that production
inventory. The publication allowlist assertions now admit the shipping
2026-08-06 local-store, Triage, and Fleet receipt lineage and explicitly reject
the retained 2026-08-04 local-store/Triage paths as retired publication
lineage. The negative cases for executable drift and extra carrier/anchor
edits remain intact.

The focused fixture gate passes all 28 cases under repo-pinned Node 24.18.0.
