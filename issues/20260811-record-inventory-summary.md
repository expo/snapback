# LLP 0232 D-2 frozen-record inventory summary

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 2
**Confidence:** 5
**Systems:** Testing, CI, Generated records, Developer experience
**Date:** 2026-08-11
**Related:** LLP 0232 D-1/D-2; LLP 0175 D2.1; LLP 0189 D-4

## Scope and method

This is the complete inventory of the 18 `driftProneGates` registered in
`scripts/local-proof-selection-policy.v1.json` at
`b112d4a031e171bd6e302eccd64b5d1a3332820a`.

Safe Node-only regeneration was run in an isolated temporary clone under the
repository-pinned Node 24.18.0. Native/Cargo commands were not run. Their costs
are conservative estimates from LLP 0175, the LLP 0232 evidence tickets, and
retained receipt timestamps. Measurements here are inventory samples, not the
ten-cold/ten-warm p95 acceptance benchmark required by LLP 0232.

Classification precedence used here is:

1. `NEEDS-WORK` when non-semantic rebase, ambient, calendar, or inventory
   inputs must leave the record;
2. `NEEDS-RECEIPT` when the remaining honest regeneration is over 10 seconds
   and must be protected by LLP 0232 D-1;
3. `FAST-REGEN-OK` for deterministic generators measured below 10 seconds; and
4. `INVARIANT-OK` for static/historical records whose check does not rewrite
   bytes and whose commit/date fields, if any, are semantically required.

## Classification table

| Gate | Frozen records | Rebase/toolchain/calendar analysis | Cost basis | Classification |
| --- | --- | --- | ---: | --- |
| `agent-safe-publication-fixtures` | reviewed leaf set inside `tests/agent_safe_publication_checker_v1.mjs` | Generator reads HEAD only to enumerate the committed tree; it serializes a sorted path set, not SHA/date/toolchain identity. | 0.43s measured | `FAST-REGEN-OK` |
| `ci-workflow-fixtures` | reviewed invariants in `tests/ci_workflows_v0.mjs` | Immutable action SHAs and toolchain assertions are authored semantics. Temporary Git commits used by fixtures are not retained. | 2.04s measured | `INVARIANT-OK` |
| `diary-identity` | `KNOWN_COLLISIONS` in `scripts/check-diary-identity.mjs` | The 11 aliases are author-ruled historical facts; no HEAD, clock, or ambient tool input enters the bytes. | 0.04s measured | `INVARIANT-OK` |
| `client-bundle-metrology` | `tests/fixtures/client-bundle-metrology/current.v1.json` plus active profile/baseline ledgers | `method.runtime.{node,zlib,brotli}`, `method.bundler`, lock/profile hashes, and historical `source.revision`/package-tree identities are required for comparable size baselines. Node is hook-pinned and esbuild is lock-pinned. | >21.19s observed before sandbox socket refusal; full 56-profile train is longer | `NEEDS-RECEIPT` |
| `local-proof-inventory` | canonical gate inventory in `tests/local_proof_inventory_v0.mjs` | Authored command/producer invariants; no generated SHA/date/toolchain bytes. | 0.34s measured | `INVARIANT-OK` |
| `module-ownership` | `ownership.manifest.json`, `ownership.baseline.json` | `observationRevision` is historical attribution; waiver `deadline` is the intentionally semantic expiry. The check reads today's date but does not rewrite records. | 6.38s measured | `INVARIANT-OK` |
| `generated-artifacts` | policy-selected review manifests/projections under `admin-ui/generated/`, `demos/`, CLI fixtures, and React fixtures | Codegen is content-derived and emits stable `generatedAt: 0`; no current commit/calendar/tool identity was found in generated records. | about 18–19s for 29 non-blocked jobs; four signed-activation jobs currently refuse before the final checks | `NEEDS-RECEIPT` |
| `contract-meta` | non-generated `demos/**/*.contract-meta.ts` mirrors | Pure TypeScript-AST parameter mirrors; no commit, clock, or ambient method bytes. | 0.26s measured | `FAST-REGEN-OK` |
| `guide` | all 65 outputs: manifest, whole/section flats, diagnostics records/type union, symbol registry, and 46 generated reference pages | Resolved 2026-08-12: source records use content digests only; historical page-review verdicts migrated to authority-byte digests; exact carrier commit remains runtime-injected. Repeated and gate-disjoint-commit regeneration changed zero record hashes. | 3.61s inventory measurement; 7.99s post-remedy cold regeneration on this worktree | `INVARIANT-OK` — `issues/closed/20260811-record-inventory-guide.md` |
| `telemetry-receipt-check` | `tests/acceptance/telemetry-phase1-evidence.v1.json` | `createdAt`, `sourceRevision`, build commits, Linux/x86_64 environment, and filesystem witnesses are semantically required retained evidence; LLP 0189 D-7 preserves exact-current telemetry for release candidates. | about 5.7 min from LLP 0175 | `NEEDS-RECEIPT` |
| `auth-invalidation-report` | `tests/acceptance/auth-invalidation-v1-composed-receipt.json` | Output is normalized deterministic behavior evidence with a fixed property seed; no HEAD/date/toolchain fields were found. Cost comes from qualified Rust/runtime preparation. | cold battery about 10 min dominated by bootstrap; prepared-runtime target about 2 min, from LLP 0232 evidence | `NEEDS-RECEIPT` |
| `control-catalog` | catalog JSON and generated Guide blocks | JSON serializes `buildIdentity.sourceCommit`, `buildIdentity.dirty`, and `generatedAtCommit`, although check strips them. Registry names nonexistent `guide/reference/control-catalog.md` and misses actual `guide/operating/agent-controls.md`. | 0.60s measured | `NEEDS-WORK` — `issues/20260811-record-inventory-control-catalog.md` |
| `deployment-identity` | `cloudflare/generated/deployment-identity.{notes,all-aboard}.json` | Only normalized input lists and content-derived schema/bundle/input hashes; esbuild is lock-pinned. No SHA/date/ambient platform fields. | 0.55s prepare + 0.11s regenerate measured | `FAST-REGEN-OK` |
| `result-transform-ship-gate` | `tests/conformance/result-transform-ship-gate-v1.receipt.json` | `rustOutcomes.producingRevision` is semantically required execution provenance and `date` is a fixed historical evidence label; corpus and Rust outcomes are SHA-256 bound. The native producer must move behind D-1 reuse. | cold Cargo build conservatively 4–6 min from LLP 0175; warm execution unmeasured | `NEEDS-RECEIPT` |
| `relation-activity-publication` | carrier, `src/manifest.rs`, and conformance reader; qualification receipt is transitively hash-pinned | Carrier and readers contain only receipt/source/carrier hashes. The receipt's historical date is not regenerated by the refresh command. | 0.77s shared carrier refresh measured | `FAST-REGEN-OK` |
| `sequence-allocation-publication` | carrier, conformance reader, retained receipt, `src/manifest.rs` | Content hashes are stable; retained `date` and contention timings are historical qualification evidence, not current-calendar inputs. | 0.77s shared carrier refresh measured | `FAST-REGEN-OK` |
| `local-store-publication` | `src/local-persistent-store-publication.v1.json` and anchor | Carrier bytes are content-hashed, but registry triggers name 2026-08-04 evidence while refresh/check/Rust readers use fixed/latest 2026-08-06 records. Calendar paths are competing authorities. | cold native finalize conservatively multi-minute; warm unmeasured | `NEEDS-WORK` — `issues/20260811-record-inventory-local-store-publication.md` |
| `local-store-carrier-receipt` | registry declares 2026-08-04 pair; checker actually selects latest 2026-08-06 pair | Latest record serializes start/end time, Node/platform/arch, exact revision, `dirty`, and dozens of unrelated `dirtyPaths`; per-file hashes already provide semantic identity. | 135.518s latest retained run; 161.830s prior run | `NEEDS-WORK` — `issues/20260811-record-inventory-local-store-carrier-receipt.md` |

Totals: 5 `INVARIANT-OK`, 5 `FAST-REGEN-OK`, 5 `NEEDS-RECEIPT`, and
3 `NEEDS-WORK`.

## Priority order

The required work follows LLP 0232 D-2's evidence-led order:

1. **Guide projections** — remove the HEAD cascade and declare every generated
   projection.
2. **Diagnostics registry** — remove its redundant commit witness and retain
   `sourceDigest` as semantic identity; this lands with the Guide repair.
3. **Deployment identities** — no repair found; retain their normalized,
   content-derived design as the reference pattern.
4. **Receipts** — first normalize the local-store carrier/publication custody;
   then give telemetry, auth invalidation, result transform, and the repaired
   local-store gates D-1 closure-validated reuse.
5. **Codegen** — add D-1 reuse for the >10-second 33-job train, then decide
   whether parallelism or narrower honest projections are needed to meet the
   direct regeneration target.
6. **Metrology** — add D-1 reuse for the >21-second train while preserving its
   pinned Node/zlib/Brotli/esbuild method and historical baseline identity.

## Completion condition

Close this summary only when the four `NEEDS-WORK` tickets are resolved, every
`NEEDS-RECEIPT` gate has an admitted LLP 0232 D-1 semantic closure and reusable
green receipt, and the formal ten-cold/ten-warm benchmarks demonstrate the D-2
bounds or document the authorized D-1 exception.
