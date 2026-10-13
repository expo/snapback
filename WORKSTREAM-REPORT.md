# PAGE2 — planner and rules language

Worktree `/home/ccheever/projects/sb4-w10-page2`, branch `sb4-w10-page2`, base `f9e40ef515` (published npm 0.4.25 plus records). All changes are local commits by Charlie Cheever <ccheever@firewoodagent.com>. No push, publication, other-worktree changes or edits to the source evidence lanes.

## Result and review status

Search discovery (`829bc19b2a`), actual-publication evidence (`47a1d4b098`), pending logical-read rollback (`098e0d5357`) and durable metadata forwarding/backend refusal (`46b75b6822`) are implemented with passing old-code negative controls. Simulator and both-store device original-id retry/restart coverage is committed in `6a516216cb`. Pending job reads roll back the whole chunk and retain queue state for the next scheduler turn. Round-nine Muse marks both proposals READY; fresh Codex marks the planner READY and time audiences NOT READY because Quarry/native job writer transactions do not pin the durable lifetime floor. That finding is fixed in `d0e1c30841`: all row writers pin inside their transaction; all read snapshots re-observe their own durable floor, and timed asset homes withhold bytes until publication. Quarry/native job tests pass 5/5; the four timed cases all fail when the job pin is removed. Tenth-round Muse is READY for both. Fresh Codex marks time audiences READY but PAGE2 NOT READY: the Lean classifier lacks the fully pinned total-unique discovery alternative admitted by Rust/emitter when the original positional point probe is nullable. The formal admission mismatch is fixed in `361ed2628d`; round-eleven fresh Codex finds two further planner gaps, intrinsic-id typing across competing uniques and step-abort handling inside discovery expressions. Both are being fixed; round-eleven Muse is pending. Its exact native/Lean negative control reproduces the same granted row but Lean `complete:false` versus native `complete:true`. Final campaigns, host clocks and metrology pass. Review records, including every NOT READY finding and subsequent fix, are preserved verbatim in `llp/reviews/3000.036-page2.r1.*` through `r11.*`. Every round uses the required Muse contributor/high and a fresh `codex exec -m gpt-6.1-sol`/high session, mutually blind. The Muse wrapper successfully retried exhausted plan quota using its authorized API fallback; no credential file was inspected or printed. Time audiences are recorded Implemented at `d0e1c30841`, with both round-ten reviewers READY and its current link archived. PAGE2 remains pending fresh reviews of its committed formal fix. Reviews bind semantic content rather than subsequent documentation HEAD changes.

## #11 — owner-or-membership pages

The planner now admits an exact plain unique membership probe with a total point witness, fully pinned total-unique discovery, or an applicable declared cap. `unique parent, principal` proves one witness for one target/caller, not a bound on the caller's total memberships. Uncapped discovery is metered and all-or-nothing: incomplete discovery returns an empty incomplete page without continuation; heap exhaustion remains `E_BOUND`. This avoids silently dropping a late membership or claiming a partially discovered page is complete.

The merge supports intrinsic target `.id`, including `byId` continuations, and readable/public parent-owner points such as `exists offers[.offer, baker = viewer]`. Every lane uses the shared cursor order and opens its head before emitting. `branch-membership-v2` fences the new shapes while preserving the old capped v1 classifier. Where a cap can repair the shape, the note names the exact declaration, e.g. `cap 50 by principal`, and explains that this is a hard write/adoption limit. Nullable unique keys are not treated as total; incompatible `set null` cap groups remain refused before Lean classification.

The indexes guide's **Private lists** section documents unique/cap inference, metered uncapped discovery, own-id and parent-owner pages, and the exact-cap repair. The amendment is LLP 3000.036.001 §15.

Key commits: `3011e3db92`, `50ea8d6df2`, `4ea5074f12`, `a9ac5d2ea5`, `a81f7cb480`, `521d42629f`, `e72d916b0c`, `2ae1b0d5b4`, `8a2104f458`, `abbf5bdad7`, `56b43a797c`, `7e3a3b6732`, `7af7790777`.

### All 50 odd-lane final schemas

All 50 baseline and all 50 updated checks succeed. `N_NEVER_COMPLETE` falls from **20 notes in 13 schemas to 18 notes in 11 schemas**. Removed: lane 001 `incomingRequests` (parent owner) and lane 037 `myChildren` (own-id membership). The raw reduction is 2/20 notes; this is not a claim that the broad corpus mostly consisted of ordinary memberships.

The remaining 18 notes are 12 party-plus-static-role-grant pages, 3 compound/non-equality/multi-branch rules, 2 hidden parent-source inversions, and 1 pure-membership page. Among the five odd-lane membership-shaped notes, two are fixed, two require discovery of a source the caller cannot read, and one has no owner/static party branch. Safe admission of hidden-source or pure-membership plans is outside this owner-or-X amendment; those exclusions are explicit rather than advertised as complete pages.

The additional named even-lane audit clears lane 002 `myHouseholds` and lane 098 `myEstates` (both own-id membership). Of the analysis's named affected apps 001/002/033/098, three are repaired; 033 has the hidden-source and pure-membership exclusions. Lane 037 is an additional repaired new app.

Exact source/binary/output hashes, commands and per-shape accounting are in [planner report](snapback4/reports/20261013-page2/planner.md); machine-readable aggregate is [farm survey](snapback4/reports/20261013-page2/farm-survey.json). Source digest: `7a4725fa4895937190b6532280d8497ca9151ccfbb2fdbad6160885485af34ab`. Final comparisons ran on copied schemas outside the repository. An initial baseline `check` ran directly against the original app directories; a post-run artifact search found no changed generated files, and no cleanup or mutation was performed there.

## #17 — rules and timed disclosure

`not before .opensAt` adds a lower read lifetime beside `expire at .expiresAt`: visibility is `[opensAt, expiresAt)`, and a nullable lower time means immediate visibility. The parser, schema IR, capability carrier, core, server, device and generated artifacts carry it. LLP 3000.036.002 specifies the semantics and supported compositions; the time/recipes guide contains a compiled timed-disclosure recipe.

Future payloads remain server-side. A private `(at, table, id)` opening ledger advances one due entry per natural request/poll transaction, without an application job. A durable monotonic server clock floor prevents reopening/backtracking under clock rollback. Overdue unpublished rows remain unavailable until the atomic opening commit. Stale and never-live entries advance private state without a public event. Pending writes, deletes, reschedules, restarts and adoption reconcile the queue with final physical state. Independent durable publication evidence for the current image survives missed-window queue removal, suppresses never-published expiry identities, and preserves positive expired revocation. Generation snapshots reconstruct markers; ordinary restart preserves them and a state-version bootstrap upgrades older stores. Server snapshots/acquisitions require live and published.

Completeness is current at the applied authoritative position, never a future guarantee. A device clock cannot disclose an unopened row or supply a future wake hint. Atomic clock/watermark/event application and backend adoption clear/fence previously held rows and groups before the successor lower boundary. Future rows reserve physical unique keys and unexpired cap slots; blind writes can address them without granting read access. Expiry cleanup remains separate. Upper expiry is checked before lower-lifetime witness refunds, preserving the legacy authorization allowance for expired/never-live witnesses. The distinct-key 4,200-witness regression was run against the old ordering, failed as intended, and passes against the fixed code. Non-uniform and compact membership search heads now classify lifetime before spending a public allowance; candidate selection retains the opening column. The 8,193-future-word paired-world regression fails old code with `E_RULE` and passes fixed code, including live same-word siblings and never-live heads before/at opening.

Opening publication has a conservative static work/decode/event envelope. Join acquisition expands in 64-row batches under an 8,192-event / 16 MiB reply-wide retained-memory/wire bound; it never retains an unbounded group then measures it. Refusal is atomic `E_BOUND`, with identity, watermark and `snapshot: true` even at stream limit one; existing paged snapshots recover every row. The 5,000-row × 4,000-byte HTTP regression and 8,193-row core regression exercise both refusal and recovery.

The first timed slice refuses union sync, read-through inheritance, maintained source/target/member tables, timelines and ephemeral on the same table. Unrelated ephemeral tables remain valid; their overlay forwards durable pending/publication state. Experimental PostgreSQL evaluation explicitly refuses lower lifetimes until it owns their floor/ledger/publication mechanisms. Private `written-by` fields require probe-free read rules because per-opening probe fanout cannot be statically admitted; ordinary timed tables may still have read probes. These are located compile-time refusals, not accepted programs with missing events.

The existing rules recipes also cover a child writer who cannot read its parent (041), a copied-column alternative in `E_READ_THROUGH` over mutable parents, and exact full `unique principal, role` probes that preserve multiple roles (071). No new blind-write bypass or unbounded role scan was introduced.

Search coverage commit `476c7e4fca` adds deterministic generated timed non-uniform search, a full-outcome future-absence oracle, explicit Lean `index-computed-or-words` exclusion, simulator and both-store device search cases. Difftest smoke 16/16, simulator timed search 2/2, device timed search 2/2 pass. Seeds 0–399 reach the new native property (first seed 8).

Key commits: language/schema `cbe172b276`; ordinary recipes/diagnostic `142b2aa37d`; compiled timed recipe `276f036df3` / `b013a127f5`; runtime `aedb2ac030`; physical occupancy `5736d841d8`; witness metering `4b117ab067`, `81ab5706d8`, `bf31f1f599`; strong negative control `1ae0a39c7b`; search head and selected lifetime repair `829bc19b2a`; adoption `3ded597c06`; ordinary clock compatibility `83faaeed27`, `d1372c0063`; private-probe admission `6601a7139a`; bounded join delivery `36bcd17e01`; base decode admission `b52248bf14`; durable actual publication `47a1d4b098`; amended record `e979db7bb9`; pending-read rollback `098e0d5357`; metadata adapters `46b75b6822`; transport retries `6a516216cb`; transaction clocks and timed assets `d0e1c30841`.

## Verification

Setup passed: frozen Bun install, Cargo CLI build, locked wasm build, client package build. Every Cargo invocation carried `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`. The full `scripts/test.sh` was never run.

Affected suites passed at their implementation checkpoints:

| Area | Check | Result |
|---|---|---|
| Planner | lang `page2_membership`; lang `branch_merge` | 5/5; 57/57 |
| Existing rules | `wave10_rules_expressiveness`; `membership_paths`; `read_through`; `wave9_rule_diagnostic_rewrites` | 5/5 final; 9/9; 10/10; 4/4 |
| Timed syntax | lang `time_audiences` | 6/6 |
| Guide | lang `guide` | 120/120 compiled/card checks |
| Core final rerun | `time_audiences`; `delivery_bounds`; `expiring_adoption`; `meter`; `review_walk` | 21/21; 2/2; 5/5; 9/9; 16/16 |
| Transaction clock audit | `job_time_audiences`; `dev_reset`; `file_assets`; `ephemeral` | 5/5 Quarry/native and untimed; 4/4; 6/6; 16/16 |
| Delivery helpers | bounded delivery unit suite; `sync_count_batch` | 2/2; 1/1 |
| HTTP | host clock suite; ordinary-clock restart; large timed join repair | 27/27 final integration suite; targeted pass; targeted pass |
| Device | `time_audiences`; intrinsic-id two-page regression | 6/6 across Memory/SQLite; both stores pass |
| Simulator | `time_audiences`; membership cursor revoke/acquisition | 4/4; targeted pass |
| Lean | `lean/check.sh`; emitter | 58-theorem audit, 71/71 examples, 7 generated fixtures; Lean difftests 31/31, smoke 17/17; emitter 12/12 checkpoint plus set-null regression pass |
| Generator | native/Lean by-id membership smoke | pass |
| Package | client TypeScript/wasm build | pass after final wasm |
| Corpus | `./ref-check`; `git diff --check` | 544 LLPs / 11,131 refs, no errors; pass |

Final campaign binary was rebuilt after `d0e1c30841`; each command used seed 0, 400 cases, 4 workers, and a separate output directory:

```sh
target/release/snapback4-difftest run --seed 0 --cases 400 --workers 4 --out /tmp/sb4-page2-final-native-r10
target/release/snapback4-difftest run-devices --seed 0 --cases 400 --workers 4 --out /tmp/sb4-page2-final-devices-r10
target/release/snapback4-difftest run-lean --seed 0 --cases 400 --workers 4 --out /tmp/sb4-page2-final-lean-r10
```

- Native: 400 generated/compiled, 20,605 executions, zero disagreements/signatures across all nine oracles, including 7/7 timed-search absence comparisons; exit 0.
- Device: 400 generated/compiled, 13,114 executions, zero disagreements/signatures across eight Memory/SQLite oracles and all ten meter dimensions; exit 0.
- Lean: 400 generated/compiled, 1,072 executions, 317 passes, 80 explicit unsupported cases, 3 disagreements. Only existing `CLASSIFIED` signatures occur: `lean--continuation-next--next~no-next` twice and `lean--next--next~no-next` once. **Zero new signatures**; CLI exit 1 because it reports classified disagreements too. No claim of an entirely green Lean campaign.

The Lean model covers the pinned lower-bound operation fragment (`opened`) and exact membership/by-id merge, including physical future writes; upper expiry, durable publication ledger and clock floors are checked by native/simulator/device tests and are not claimed as Lean proofs. Four timed scenario families (before, exact, future, nullable), own-id and uncapped membership generation are reached. Reports are committed under [PAGE2 evidence](snapback4/reports/20261013-page2/).

## Wasm

Baseline at `f9e40ef515`: 2,291,429 B raw / 698,386 B gzip. Final locked Linux web device: **2,302,339 B raw / 701,955 B gzip / 530,689 B brotli**, whole-artifact delta +10,910 raw / +3,569 gzip. Budget **702,455 B = measured gzip + 500 B**, with the reason in `metrics/wasm-budget.json` and the journal; latest ratchet commit `96cf6eee5b`.

`measure-wasm.sh` passes serializer-family and forbidden-absence audits; final receipt is `dirty:false`, source checkpoint `0f97de33c5`, no overage. Server-only queue/join delivery is absent from the device. No runtime ceiling increase, per-feature attribution, Mac measurement or publication qualification is claimed. Brotli was extracted from a small package into `/tmp` for measurement, without a system/repository dependency change. Receipts are append-only in `snapback4/metrics/wasm.jsonl` and copied into the evidence directory.

## Decisions, ownership and deferrals

- Hidden-source parent inversions and pure-membership pages remain excluded from this exact readable-source owner-or-X merge. The report's raw farm counts take precedence over a misleading large-majority claim.
- The timed first-slice exclusions and bounded `E_BOUND`/snapshot recovery are explicit supported boundaries. They prevent unbounded expansion and early private disclosure.
- HS owns broad handshake negotiation, DOM-free declarations and starter Vite types; REL2 owns publication/release; DX2 owns starters/upgrade/witness/general client recipes; DIAG owns general lint/diagnostic changes. One-line ownership pointers are in LLP 3000.036 §19. PAGE2 only declares its new semantic capabilities and requested rules/planner guide changes.
- The root inventory checker belongs outside the Snapback4 fence and needs absent Snapback1–3 artifacts. Its attempted invocation failed that setup precondition; no unrelated bootstrap/regeneration was done. Snapback4 affected checks above passed.
- A final Lean verification command accidentally ran in the repository root, and an unnecessary root Ibex bootstrap was started. Both owned bootstrap attempts were interrupted; no process remains. The vendor gitlink is initialized clean at its exact recorded commit, with no unrelated tracked source changes; all final checks run in the independent Snapback4 workspace.
- A formatter accidentally touched unrelated workspace Rust files. Those unrelated changes were restored, active edits recovered with a lexical token audit, and compilation/affected checks passed. No remaining intentional unrelated formatting delta or history rewrite.
- An initial timed difftest harness used wall time for seed state and a by-id generator emitted an inadmissible extra nullable filter. Both were fixed (`9eedca0f41`, `8a2104f458` and subsequent generator checkpoints); all final 400-case campaigns compile without generator errors. The first never-live regression reused a cached constant witness and passed old code; the distinct-key replacement demonstrably fails old code.

The local small-step implementation/review commit list is retained in `snapback4/reports/20261013-page2/implementation-commits.txt`; final documentation/evidence commits follow that list. No push was performed.
