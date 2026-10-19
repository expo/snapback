# COLR workstream report

Status: COMPLETE — implemented, independently reviewed READY by both families, and fully checked. Final packed-consumer proof is bound to source commit `1ab2105e0a`; the final report/evidence commit changes no product code. No push; package version remains 0.4.34 with a 0.4.35 changes entry.

## Commits

- `317602e731` — initial column-authority amendment, independent first reviews, baseline survey.
- `771aab745f` — resolve independent design reviews; fresh Codex and Muse both READY on round 3.
- `f037999d06` — end-to-end implementation, guide/client/Lean coverage, explicit wasm budget increase.
- `25bea0b961` — five copied lane comparisons, candidate survey and differential campaign evidence.
- `25793d4824` — close implementation/amendment review at round 9: both independent families READY on one revision.
- `66804424c6` — composed read/write authority fixes, optional native decoding, omission-preserving spreads, nullable blind insert results, conditional-write model and regression coverage.
- `1ab2105e0a` — final campaign reports, original/copied module digests, copied-app result narrowing and packed fixture horizon. This is the fresh packed/qualified source commit.

## Changes

Inline `secret: type read <- policy` and grouped `read (a, b) <- policy` intersect row authority and existing owner-private authority. Whole rows omit hidden cells; explicit selections return null. Generated read properties are optional by audience; mutation inputs remain their declared types. The ordinary hooks and clients keep their existing API.

Disclosure precedes caller-visible pricing, copying and output. Keys, indexes, search/order, authority/lifetime inputs, immutable constraints and maintained derivations cannot depend on protected payloads. Plain row counts remain valid. Raw catalogs and inferred plans share the structural census. Row-local gates replicate projected cells; witness-dependent cells never replicate and use automatic online fallback with honest offline unknown/held refusal. Live invalidation includes column-rule dependencies, even for empty reads.

Downloads intersect row and cell authority. Explicit blind asset placement must prove uploader ownership even when a guessed id matches the hidden old value. A device cannot acquire an omitted secret by changing its public selector: it queues for the server. Column invariants prove against effective column authority; audit reports the gates and residency boundary. Column-rule changes use ordinary adoption and do not alter captured parent identity.

The 0.4.35 guide-changes entry and the rule-recipes examples use column rules. The exact recipe runs from packed tarballs; a separate packed wasm witness covers nested and fallback spreads. Separate entities remain the alternative. `check` emits N_COLUMN_READ for a possible one-to-one privacy extension without claiming equivalence or rewriting data.

## Review provenance and decisions

LLP 3000.036 §22 is the governing amendment. Round 1 rejected immutable guessing, blind asset assignment and omitted-to-readable prediction; §§22.8–22.9 resolve them. Round 3 fresh `gpt-6.1-sol` high and Muse `muse-spark-1.3-contributor` high both returned READY on the same revision. Exact prompts, verbatim responses, stderr and amendment digest are under `llp/reviews/3000.036-colr-r3.*`. Muse's quota fallback succeeded without reading or printing its key.

Final round 9 fresh Codex and Muse both returned READY after implementation corrections. Verbatim artifacts, compressed amendment snapshot and digest are under `llp/reviews/3000.036-colr-r9.*`. The corrections cover Following staged/replay/refresh grants, through-child selectors, insert bindings/completed captures/nullable blind results, preservation certificates, extrema, nested/fallback/write spreads, native decoding and the independent conditional-write model. The sequence concern was disproved by an executable regression: the pre-existing allocation read guard refuses both consumed and discarded hidden allocations before counter work; readable Alice receives ordinal 1.

DORM owns reverse projections, renames, forward backfill catch-up and dormant inspection; this lane changes only column-rule release narration/dependencies. SEC4 owns campaign quality and general diagnostic ranking. Witness-based payload reads conservatively run on the server: this reviewed boundary avoids inventing revocable offline witness envelopes.

## Five copied lanes

Original evidence directories were read-only. Source snapshots and rewrites live under `snapback4/reports/colr/lane-copies/`. Tests use deterministic synthetic records against those complete copied schemas, not live original stores or browsers. Every rewritten schema passes `check --json`; allowed/denied probes, v1 primary-record visibility and forward cell restoration pass.

| Lane | Original v2 code lines | Column-rule code lines | Saved | Original rollback | Column rollback |
|---|---:|---:|---:|---|---|
| 006 trampoline reports | 185 | 157 | 28 | parentReports row dormant | no dormant payload; existing photo column |
| 037 dairy pickups | 189 | 171 | 18 | pickupSizes row dormant | pickups.size cell dormant |
| 039 countertop jobs | 225 | 211 | 14 | jobReviews row dormant | jobs.summary cell dormant |
| 043 safe-deposit boxes | 199 | 186 | 13 | rentalArrangements row dormant | boxes.arrangement cell dormant |
| 049 pavilion bookings | 175 | 161 | 14 | depositReviews row dormant | bookings.description cell dormant |

Full app source copies are also at ~/sb4-loop/colr-app-copies/. All five frontends pass TypeScript noEmit against the fresh packed SDK (with the checkout dependency toolchain); no browser/simulator claim is made for those five. Copies 037, 039 and 043 explicitly handle missing protected values; copies 006/049 already do. The 006 proof import needed its frozen v1 generated API copied alongside it. All five final production-binary schema checks and fresh-packed-SDK TypeScript checks pass (10.16, 93.91, 35.68, 36.20 and 82.30 seconds on this shared host, including TypeScript). SEC4/DX4 pointer: the large existing security campaign dominates those checks; do not attribute the elapsed time solely to column rules.

Four copied bindings (two in 006, one in 039 and the 049 operator bootstrap) use the standard `! else NOT_FOUND` before passing nullable write-result references into another write. These remain on the same source lines and preserve the counts above. DX4 pointer: the existing generic nullable-reference diagnostic says “upsert result” even for a column-bearing insert; its narrowing repair is correct.

Code counts exclude blank/comment-only lines and include all copied modules (including pavilion bootstrap). Detailed physical counts, original paths/hashes and inventories are in lane-copy-inputs.json and lane-probes.json. Lane 006 deliberately widens the primary report's row audience to parents while withholding its photo; the v1 rollback restores the original staff-only row audience.

## Verification

- Focused language: 17/17 pass (including independent hidden-payload worlds, serialized meters/dependencies, raw/inferred refusals, assets, invariants, existing-rule adoption and dormant restoration).
- Focused device: 4/4 pass on memory and SQLite via real snapshot/stream/admit paths; native event-slot prerequisites 2/2 pass.
- Five copied lanes: audience/rollback/forward comparison passes.
- Final-source Mac Studio, only ~/sb4-ws-colr: all 29 affected tests pass (1 five-lane comparison, 17 language, 3 Following, 4 preservation, 4 device). Owned build outputs and unrelated copied report artifacts were removed after the successful run.
- Full client pool: all 419 ordinary/timer files plus both full-count model files executed. The only final-pool failed file was the new wasm fixture’s expected-note mismatch; its bounded horizon correction passes all 24 tests in the packed-file recheck. Across the pool and that recheck: 421 files, 7,862 tests, 7,806 pass / 56 platform skips / zero remaining failures. Models retain all 5,000 app-session and 3,000 online sequences. The exact guide recipe and separate nested/fallback wasm witness run through real packed client/native packages.
- Complete Rust coverage: all seven workspace crates (the five requested product crates plus native/difftest), 6,923 passed / 45 ignored / zero failed across 434 unique Cargo/doc-test groups. The workspace run completed 418 targets before its 90-minute timeout in sim/union; its interrupted tail then passed with the identical workspace feature set, and all six workspace doc-test groups passed (17 tests). An independent complete sim run also passed 749 tests / 7 ignored. The combined count excludes nested subprocess tests and deduplicates rerun binaries. Earlier failed fixtures and the real missing column dependency in preservation certification were corrected before the final run.
- Native difftest: 20,000 schemas, 1,222,111 executions, zero disagreements.
- Device difftest: seeds 0–999, 1,000 schemas, 27,922 executions, zero disagreements.
- Lean difftest: 20,000 schemas; 16,697 passed comparisons, 3,173 unsupported, 130 disagreements belonging only to the four existing classified signatures. Zero new signatures. New column-specific surface-AST/engine oracle: 132 comparisons pass, including 24 conditional-write and 12 blind-insert comparisons.
- Lean build/check: 60 build jobs; 81 theorems, standard axioms only, no sorry/new axioms; 116/116 examples and 7 oracle fixtures agree.
- Final production-binary 200-schema survey (100 wave15, 50 wave16, 50 wave18): baseline and candidate 200/200, zero false refusals; original source hashes unchanged. An additional pass with an unused column-gated table appended to every copied schema also passes 200/200, guarding unrelated planner/type lowering against feature presence. Both use the fresh musl binary.
- Production CLI diagnostic fixture: N_COLUMN_READ appears for a one-to-one private extension.
- Strict wasm serde-family and server/Unicode-table absence audits pass.
- Final locked wasm: 2,401,963 raw / 732,824 gzip bytes. Budget 733,324 = measured +500; whole-artifact increase 16,121 raw / 5,811 gzip versus baseline. Rationale in budget, journal and implementation commit. No runtime ceiling increase.
- Final root prerequisites pass: frozen install, workspace hoist, generated artifacts. check-inventories passes (365 package tests, 35 script tests, 31 demos/catalog entries, 487 publication leaves). check-guide passes all 22 groups, no failures/skips/preconditions, 162 pages/1,937 snippets. Existing legacy gap-review warnings remain outside the Snapback 4 fence. ref-check: 556 LLP docs, 12,108 refs, zero errors/unchecked. Docs budget: README 319/320 and focused guide test pass. A final attempt first found missing root dependencies; the required setup was repeated and both root checks passed afterward.
- Fresh-pack Linux consumer qualification passes from clean source `1ab2105e0a` via proot: static ELF/distro matrix, production, staging, migration, security, frontend, starters and exact packed guide recipes. The receipt, client/Expo/platform integrities and binary digest are archived under reports/colr. Consumer-only mode avoids the explicitly forbidden scripts/test.sh; complete Rust/client checks run separately. The receipt correctly says publicationQualified=false. No qualification claim is made from an earlier pack invalidated by subsequent source fixes.

## Scope decisions and remaining baseline limits

No requested COLR implementation is deferred. Witness-dependent column gates deliberately use server fallback, as specified and independently reviewed; this is the supported confidentiality boundary for offline devices. The four pre-existing Lean signature classes remain baseline differences, with no new class introduced. The copied-app timing figures are shared-host measurements, not a controlled bakeoff speed claim. DORM migration primitives and DX4 generic diagnostic wording remain with their owning lanes. The consumer-only qualification is a consumer proof, not publication authorization.

## Evidence and cleanup

Committed evidence: `snapback4/reports/colr/`. Full logs and final packed qualification artifacts: `~/sb4-loop/colr-*.log`, `~/sb4-loop/colr-fresh-pack-fixed/` and `~/sb4-loop/colr-qualify-linux-fixed/`. The archived qualification-summary.json records final totals and proof-log digests. The final report/evidence commit follows the qualified source without changing its product inputs. Removed this worktree’s 27 GiB Rust target and 275 MiB Lean build directory after every test process exited. No COLR-prefixed scratch remains under /tmp. Removed superseded and final qualification installation trees (over 12 GiB) and the allowed Mac worktree’s build outputs; retained the final client/Expo/platform tarball tuple, proof receipts, logs and copied apps for reproduction. No original app stores were opened or mutated, no other local worktree was modified, and the publication MacBook was not used.
