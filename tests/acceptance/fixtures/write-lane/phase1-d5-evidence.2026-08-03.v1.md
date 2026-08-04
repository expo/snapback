# LLP 0129 Phase-1 D5 evidence

**Evidence date:** 2026-08-03  
**Presentation due:** 2026-08-10  
**Scope:** the D5-evidence half of the Phase-1 gate only  
**Machine receipt:** `phase1-d5-evidence.2026-08-03.v1.json`

## Outcome

The existing LLP 0051 D5 corpus now replays completely through both the Rust
host evaluator and the JavaScript evidence executor:

| Result | Count |
| --- | ---: |
| Corpus cases | 37 |
| Committed with exact result/count/output ledger | 26 |
| Rejected with exact typed code and atomic rollback | 11 |
| Formerly skipped multi-table cases replayed | 5 |
| Skipped | 0 |
| Blocked or unpinnable | 0 |
| Rust-vs-JS exact normalized outcomes | 37 |

For every case, the machine receipt carries a per-field pinning matrix, both
runner statuses, an exact normalized-outcome digest, sidecar disposition, and
an honest per-case finding. All 37 findings are `null`: no case is blocked or
unpinnable under the existing v1 corpus contract.

## Exactness established

Every case now carries a literal v1 `ctxLedger`. The runners validate the
ledger, use its frozen `now`, consume its ordered ids, and require exact id
consumption on a commit. A committed Rust or JS outcome must echo the consumed
recording as its output ledger. A rejected mutation has no return value,
changed count, or output ledger.

The six formerly placeholder-bearing cases are literal pins now:

- `todo-v2-create-todo` and `todo-create-guarded` pin their inserted ids and
  whole-plan id returns;
- `all-aboard-reset-feed`, `all-aboard-apply-feed-tick`,
  `all-aboard-apply-feed-tick-first-run`, and
  `all-aboard-live-snapshot-fragments` pin every `RuntimeNow` result;
- `all-aboard-live-snapshot-fragments` additionally pins both `InsertEach`
  row ids.

There are zero `$ANY_ID` or `$ANY_NOW` values in the 37 case files. All 26
committing cases have exact whole-plan `result` and `changedCount` values. All
11 rejecting cases have exact whole-plan rejection codes; both runners verify
that every declared table retains its seeded state.

The receipt compares these fields structurally for each Rust/JS pair:

1. commit or rejection status;
2. whole-plan return value;
3. changed count;
4. every declared table's resulting rows;
5. input ctx-answer ledger;
6. output ctx-answer ledger;
7. typed rejection code.

Row comparison removes runtime-owned system fields, fills absent declared
optional fields with `null`, and orders tables and rows deterministically. It
therefore compares the complete declared application-row state without
pretending the browser evidence workspace mints SQLite commit metadata.

## The five former skips

The test-only browser-safe workspace replays all five cases that the previous
single-table reducer loop skipped:

| Case | Tables | Outcome |
| --- | ---: | --- |
| `all-aboard-reset-feed` | 4 | exact commit |
| `all-aboard-apply-feed-tick` | 4 | exact commit |
| `all-aboard-apply-feed-tick-first-run` | 4 | exact commit |
| `all-aboard-live-snapshot-fragments` | 4 | exact commit |
| `reject-insert-each-non-array` | 4 | exact `SNAPBACK_PLAN_SOURCE_INVALID` rejection |

The workspace clones every seeded table, runs the whole plan atomically, and
discards the clone on rejection. It imports the shipped JS value evaluator for
expression semantics. It is deliberately under `tests/conformance/`, is not
exported or registered, and does not widen a shipping capability.

## Sidecar disposition

No case requires the nonexistent coverage/read-requirement sidecar. D5 cases
provide complete schemas and seeded ephemeral workspaces; they test executor
semantics, not whether a partial retained replica satisfies a mutation's read
requirements. No sidecar was built. Partial-read admission remains outside
this evidence and is not inferred from the D5 result.

## Evidence machinery

- `packages/snapback-codegen/data-tier-corpus.mjs` is still the generated
  corpus authority and now emits one exact replay ledger per case.
- `tests/conformance/data-tier/js-d5-harness.mjs` is the unregistered
  multi-table evidence executor.
- `packages/snapback-contract/derived-overlay.test.mjs` makes the complete
  37-case JS replay part of the existing package suite.
- `tests/data_tier_corpus_v0.rs` requires exact results, counts, output
  ledgers, rejection codes, and rollback; an opt-in environment path emits
  normalized Rust outcomes for evidence comparison.
- `phase1-d5-evidence.2026-08-03.v1.mjs` runs the Rust leg, runs the JS leg,
  compares every normalized case exactly, and generates or verifies the
  hash-bound machine receipt.

## Verification record

Observed in this checkout on 2026-08-03:

```text
scripts/bootstrap-ibex-runtime
  SNAPBACK_IBEX_RUNTIME_LINK_OK; restricted no-eval handler VM qualified

node packages/snapback-codegen/data-tier-corpus.test.mjs --write
  37 cases written; builder-parity assertions passed

node packages/snapback-contract/derived-overlay.test.mjs
  26 committed, 11 rejected, 5 multi-table, 0 skipped

cargo test --locked --test data_tier_corpus_v0 \
  -- --nocapture
  2 passed; 0 failed

node tests/acceptance/fixtures/write-lane/phase1-d5-evidence.2026-08-03.v1.mjs --write
  37/37 Rust-vs-JS exact, 5/5 multi-table replayed, 0 skipped

node tests/acceptance/fixtures/write-lane/phase1-d5-evidence.2026-08-03.v1.mjs
  committed receipt verified byte-for-byte

env SNAPBACK_CLIENT_RQS_DIR=/private/tmp/snapback-contract-rqs-d5-20260803 \
  bun run --cwd packages/snapback-contract test
  full package suite passed

node packages/snapback-codegen/data-tier-corpus.test.mjs
  37 cases verified; builder-parity assertions passed

rustfmt --check tests/data_tier_corpus_v0.rs
  passed

./ref-check --verbose
  167 LLP docs; 3133 refs in 7056 files; 0 errors; 0 unchecked
```

The receipt records the exact corpus-manifest and source hashes plus the Node,
Cargo, and Rust toolchain versions used by the comparison.

One non-D5 package-inventory finding remains explicit: the full
`@expo/snapback-codegen` suite stops at the untouched
`mixed-route-v2.test.mjs` format-1 golden. Current bytes hash to
`f5263f6c…`, while that test pins `ca4e8547…`. The focused test reproduces the
same mismatch under both ambient Node 25.9 and the repository-required Node
24.19. None of the mixed-route generator, test, or shipping evaluator files
changed in this evidence work, so the unrelated golden was not re-pinned. The
D5 corpus generator test that owns these changes passes independently.
`node scripts/check-package-test-inventory.mjs` also reports the already-landed
sizing spike's
`spike/phase1-ir-evaluator.2026-08-03/browser-evaluator.spike.mjs` in addition to
its frozen expected inventory. This D5 work did not add or register that test,
so the unrelated inventory was left unchanged.

## Limits and gate interpretation

This is exact D5 evaluator/conformance evidence, not a claim that Phase 1 is
sufficient to ship `Parity` or same-code behavior. The JavaScript whole-plan
workspace is evidence-only. It does not establish partial-read admission,
materialization coverage, speculative receipt projection, schema/identity
fencing, browser store/outbox reconciliation, React presentation, or
authoritative settlement. LLP 0129 OQ8 and the execution-identity/store
semantics gates remain outside this artifact. No LLP, capability row, or
shipping registration is changed by this work.
