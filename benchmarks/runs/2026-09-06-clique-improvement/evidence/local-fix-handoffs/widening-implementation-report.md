Local successor recovery — committed candidate for root review, 6 September 2026

The repair is **ecb3c6ed058d17f62a85f97b06ce23718467c57b**, parent **0236bda88698e98a045c7b05fbe1aef10f35c580**, on `s2/clique-successor-widening-local-recovery`. The worktree is clean. The committed patch equals the tested patch byte-for-byte. This was independent local work from frozen source, with the sole Astra writer and no subagents, external reviews, remote SSH, main edits, merges, pushes, or publication. Remote writer 46084 remains UNKNOWN and untouched. Root owns fresh dual reviews and integration; this is implementation evidence and focused self-review, not an independent acceptance verdict.

The material finding is repaired: rebuilt maintain targets no longer receive a whole-table exemption from applicable stored-row admission. Both the additive survivor case and the exact archive-drop case failed on frozen product source before the repair and pass after it. The new ordinary Quarry/public-client witness demonstrates the baseline violation and fixed refusal with identical authored source and candidate generation hashes. All **47 selected Rust tests pass**: 19 successor, 11 successor_maintains (6 existing plus 5 additions), 10 successor_narrowing, 4 successor:: unit tests, and 3 existing text_constraints writer/certification tests. Package build, caps, ref-check, and diff --check passed.

**Repair and ordering.** `successor.rs` shares required-column admission with selected stored-value/text-constraint validation. It first admits ordinary non-rebuilt tables, including source required fields, before deriving successor projection IDs. It then admits rebuilt-target survivors, excluding only the union of predecessor/successor projection IDs that rebuild actually owns. The existing column-selection predicate and text-constraint selection remain unchanged: new declarations, applicable type changes including text widening, and new/changed minimum/format constraints are checked; unrelated historical fields remain outside the selection. A new/retyped required target field refuses a surviving row with E_SUCCESSOR_COLUMN_REQUIRED, while a replaced projected ID may be regenerated with that field.

`registry.rs` passes the already captured pre-drop predecessor IDs into the same additive admission helper used inside exact migration. Successor IDs are derived after drops and source admission. Exact plan equality still occurs before transaction creation, projection reads, or drops. Rebuild consumes the same original predecessor map and derives the same successor IDs. No ownership algorithm, row deletion behavior, text-inclusion relation, Optional narrowing rule, write validator, projection insert/delete constraint, unique/cap rule, certificate bound, or generation persistence path was changed. Existing projection constraints and writes remain enforced by the unchanged engine paths. A survivor error now reaches the existing transaction rollback mechanism before installation; this repairs omitted admission, not SQLite rollback.

LLP1001 §4 records the precise survivor exemption and ordering beside projection ownership. No guide/diagnostic source changed; the existing command-guide test was therefore not rerun. The package was built once to supply the coherent public compiler/client witness and its guide checks. No new repository test target, gate, script, configuration, registry, or design document was added. The private diagnostic scripts here are external evidence helpers only.

**Frozen baseline and NEW witness provenance.** `prior/astra-review.md` was read in full, along with `prior/original-implementation-report.md`; all copied prior bytes remain unchanged and are hashed in `baseline/source-identity.json`. The original candidate's terminal review is CHANGES_REQUIRED and source-bound. Its referenced scratch scripts and raw logs are unavailable locally. Nothing here claims to recover or rerun those exact files or original remote timings. `context-pack.md` records the scoped llp-orient reading: the root and Snapback2 AGENTS, rules, LLP1000, LLP1001 §4/§9, LLP1016 D4, LLP1002 owner semantics, current package operator/Quarry pages, and relevant source refs. No v1 bootstrap or gates ran.

Before product edits, `baseline/source.tar` and the source manifest froze exact 0236bda. The native baseline was built from unchanged product source and copied to `baseline/snapback2`; only NEW test code was introduced for the core red. Its executed source is preserved at `baseline/new-core-reproduction.rs`; `baseline/new-public-reproduction.mjs` retains the successful baseline harness revision. The first failures and their earlier harness/test sources are separately preserved under `failures/`, not replaced by later success.

Core red: `baseline-core-invariant` exits **101**, with two failed required-invariant tests. The additive test first proves min=2 with unchanged max=80 refuses at totals.legacy, then observes max=2000 wrongly succeed. The exact mixed test obtains precisely `Drop::Table {name: archive, rows: 1}` and observes that application wrongly succeeds rather than rolling back. These are new local core fixtures using ordinary Runtime seed/installation APIs. The unrelated-historical-field positive control added later is explicitly a synthetic closed-store fixture, separate from the entirely public reproduction.

Public scenario in `proof/baseline-52011/` and `proof/candidate-52012/`:

1. Ordinary events and totals declare group:text <=80; totals has value:int and unique byGroup:group. The bundled `createClient` and `api` invoke named `ops.addEvent` and `ops.addLegacy` as alice through /api/mutation: event(group=valid), legacy(group=x,value=9). No raw row injection, operator write, bearer session, or mocked API is used.
2. Ordinary totals becomes `maintain totals = count events by group` with read allow. Queries use lawful `totals[] first 10 by byId` and read wire `data`. The projection and legacy survivor are observed at sequence 2.
3. Source group becomes text 2..2000. Actual compiled schemas declare both events.group and totals.group Text(max=2000), with the target Text constraint min=2. The source conventional group/byGroup spelling is retained.

The gen2 installed hash is `a343f89f5f6e5922a3155fc5598f474254ac3104eef7d5d1aae812fff83d528a`; the checked gen3 hash is `1d006ec58029526bdced7871905ab44e4c5b0d10577dcc2cde3f44f5e74c4af2`. Baseline installs gen3 as ready and serves legacy.group=x, violating its min2; the baseline witness's exit **0 asserts the violation**, not conformance. Fixed gen3 is actually refused with **E_SUCCESSOR_ROW_INVALID**, site totals.legacy, while the installed generation stays gen2. Public event/target rows, IDs, and seq2 are unchanged. Status names the refused gen3, and check/status hashes are matched exactly; an old ready poll cannot establish this result. The retained baseline responses were also audited against all three actual check hashes in `exact-generation-audit.json`.

Each proof retains authored .q files, compiled project/schema, commands and exits, sanitized public requests/responses, statuses, and stopped-store observations. Fixed generation directories retain the actual build certificates, lowered Quarry, and declarations. Baseline gen3's actual build cache is retained too; the earlier gen1/gen2 certificate bodies were generated in **NEW supplementary certification** of the saved exact source using the frozen binary. Their hashes of the checked generation match the original local witness, and they are labeled supplemental, not historical raw evidence. Full compiler output and the native serialized build project differ in default-field serialization; that comparison failure is retained rather than claiming byte equality.

**Regression selection.** The five additions stay in the existing successor_maintains integration file:

- Invalid non-projection survivors refuse min/handle changes both at unchanged max and while widening.
- Exact archive drop rolls back on the survivor error; checks bind the in-memory installed generation, durable _meta, sequence, every base/archive/target row, and all c0–c7 index observations.
- Valid survivors preserve projection IDs, values, and indexes through additive and exact mixed widening; a synthetic unrelated historical reserved-ID field remains unexamined.
- Adding a maintain with a new required value field exempts an actually replaced successor projection ID (whose old row lacks value and fails the new minimum), but refuses an unrelated survivor. Both additive and exact archive-drop paths are covered, including rollback observations.
- A missing new required source group refuses E_SUCCESSOR_COLUMN_REQUIRED before successor projection can attempt to read it.

The unchanged existing cases additionally cover pre-drop predecessor IDs during optional group retype, stale exact plans, projection uniqueness/rebuild, Optional narrowing, malformed/wrong stored values, and text writer semantics. No broad Rust/compiler suite, full test.sh, Hermes production build, benchmark, scale run, browser, simulator, or publication qualification was run. No test timeout or product deadline changed.

**Source and executable identities.** Git tree: `bf353e09e203c049c5939a60e092610b90a08344`; Snapback2 subtree: `840b654835a22dd847cf14d04256004288acaa4e`. Exactly four tracked files differ from 0236bda; all other tracked source in the frozen manifest matches. Versions and both lockfiles are unchanged (workspace version remains 0.0.10). `candidate/commit-binding.json`, `candidate/precommit-audit.json`, and the final manifest bind the reviewable delta. The native executable is the default development owner, effects engine `none`, not production Hermes or a published npm artifact.

| Artifact | SHA-256 |
|---|---|
| Frozen baseline source archive | `ed8a2c2b88f85029644df173b02cd7df27e72e37539e582042e92e628d0d0735` |
| Frozen baseline source manifest | `dffe69e4e13058a33fb211d8de6d3385166d17c0c6b2c3782c5e4b7ef492b12b` |
| Candidate source archive | `cfae13822d9eb77dc916eae0f1aefc1c44db00e53892d444815c4b540f4fb599` |
| Tested and committed delta | `211b8c1f062d309f42b07fdd45f5648d8b019c55f5aeef46b7d5490eadf9f44c` |
| One-commit format patch | `7adcc5a0a1fce587e8760fb60aa9c42b3df4cf7086b9a16df31b55ef2424d58c` |
| Baseline native executable | `e9d3c0d102c6dc9aa814a65fcfa2aabeebc961f5d3efb7006a5c58a0b6091d84` |
| Candidate native executable | `c1080c95b4809953d1191521b520256ab429be08e79b723ec2e7c9288a8842a9` |
| Compiler worker | `9c93d2adc425eab14d977a2a8b0d1228a0a5c8c27c4e59bc889efe9863490a78` |
| Compiler core | `49e6fa63fdeb01977d11c569617074e2a0f60ad132a3ecbdc28345ea4a4fdcd6` |
| Public client | `5aaa45d49028733f2cde0e6c5fc9ec89d8a85ab439c40f1dc477d5a87f2038f9` |

| Changed file | Frozen SHA-256 | Committed SHA-256 |
|---|---|---|
| `llp/1001-query-engine.spec.md` | `ad0a357022ea444fb5a0d7032bc1a2fecaddd75bec75bb4f434920be138ede8c` | `793a98a0ad4f98febf6236e158e3e06ecafbab9bd4b7c836f931e6b660768b68` |
| `snapback2/crates/snapback2-core/src/registry.rs` | `084930fff5af711897182e313b2172cd3d119e53d55e24ef232d6a7e05ae6f4c` | `8c33e5818dfe6feacb806cdd830e6eb818b8300a32e8dc951cc2782f5953ff1a` |
| `snapback2/crates/snapback2-core/src/successor.rs` | `caf3316572749d6ceb5c9ada03d74a61d0e1eb5626c5663a44d4366d0a60b1a4` | `5b7df76b6e0a4a1675d4a3b4182e117e2970e14656717723c53a052c10cb8a53` |
| `snapback2/crates/snapback2-core/tests/successor_maintains.rs` | `f65cc5008fb9b1fc6386bab2cac0231ba67f6eb04e92b2404bf4e019afd593e6` | `709418aa3a56f27693d51e765217fd1488c1c619464600a2e2c1d04143e4c6f1` |

The complete built package dist is copied under `candidate/package-dist/`; every package leaf remains identical to the one package build used by baseline and fixed witnesses. `candidate/source.tar`, `candidate/committed.patch`, and `candidate/candidate.patch` retain source and both patch forms. `final-candidate-manifest.json` binds the evidence and all tracked frozen-scope source leaves.

**Actual local execution.** Apple M1 Max arm64, macOS 26.6, rustc/Cargo 1.97.0, Node 22.23.2, Bun 1.3.12; details and version argv/exits are in `environment.json`. The supplied private APFS target preparation is bound by warm-target-copy.json. Cargo used only this lane's target, the existing default Cargo registry, --offline --locked, -j2 / CARGO_BUILD_JOBS=2; test threads=2. No host-silence or remote-machine requirement. The warm build budget stayed 300s: baseline native build 143.249s, candidate native build 47.775s. These are local receipts, not a performance qualification or original remote timing comparison.

`commands/*.json` records exact argv, cwd, environment selection, local timeout, elapsed time, exit, and full-log hash. `logs/*.log` preserves complete output. The table lists actual children of external run.py; Cargo runs from this lane's snapback2/, package build from snapback2/packages/snapback2/, other listed outer commands from the repository root. Public harness internal compiler/check/status/stop commands and exits have their own commands.json in each fixture; fetch records carry exact route/body, 5s deadline, HTTP status and sanitized response. Compiler/check commands have a locally selected 35s outer limit (the product's existing compiler request stays 30s), status commands 10s, generation waits 35s, stop/wait 10s. These local deadlines never increased after failure.

| Label | Exact child command | Timeout s | Elapsed s | Exit |
|---|---|---:|---:|---:|
| baseline-build | `cargo build --offline --locked -j2 -p snapback2` | 300 | 143.249 | 0 |
| install-js | `bun install --frozen-lockfile` | 120 | 2.646 | 0 |
| package-build | `node build.mjs` | 300 | 19.241 | 0 |
| baseline-core-red | `cargo test --offline --locked -j2 -p snapback2-core --test successor_maintains survivor -- --test-threads=2 --nocapture` | 300 | 182.829 | 101 |
| baseline-public | `node /Users/ccheever/clique-improvement/revisions/successor-widening-local-recovery/public-witness.mjs baseline 52010` | 180 | 46.863 | 1 |
| baseline-core-invariant | `cargo test --offline --locked -j2 -p snapback2-core --test successor_maintains survivor -- --test-threads=2 --nocapture` | 300 | 4.458 | 101 |
| baseline-public-predicate-fixed | `node /Users/ccheever/clique-improvement/revisions/successor-widening-local-recovery/public-witness.mjs baseline 52011` | 180 | 19.706 | 0 |
| format | `rustfmt --edition 2024 --config skip_children=true snapback2/crates/snapback2-core/src/successor.rs snapback2/crates/snapback2-core/src/registry.rs snapback2/crates/snapback2-core/tests/successor_maintains.rs` | 30 | 0.858 | 0 |
| fixed-successors | `cargo test --offline --locked -j2 -p snapback2-core --test successor --test successor_narrowing --test successor_maintains --no-fail-fast -- --test-threads=2` | 300 | 122.754 | 0 |
| caps | `node scripts/caps.mjs` | 60 | 4.477 | 0 |
| diff-check | `git diff --check` | 30 | 0.479 | 0 |
| ref-check | `./ref-check --verbose` | 60 | 25.084 | 0 |
| fixed-core-unit | `cargo test --offline --locked -j2 -p snapback2-core --lib successor:: -- --test-threads=2` | 300 | 69.965 | 0 |
| baseline-supplemental-certificates-g1 | `/Users/ccheever/clique-improvement/revisions/successor-widening-local-recovery/baseline/snapback2 check --project /Users/ccheever/clique-improvement/revisions/successor-widening-local-recovery/proof/baseline-52011/generation-1/supplemental-certification --json` | 35 | 1.774 | 0 |
| fixed-text-writers | `cargo test --offline --locked -j2 -p snapback2-core --test tier0_authorization text_constraints:: -- --test-threads=2` | 300 | 10.816 | 0 |
| baseline-supplemental-certificates-g2 | `/Users/ccheever/clique-improvement/revisions/successor-widening-local-recovery/baseline/snapback2 check --project /Users/ccheever/clique-improvement/revisions/successor-widening-local-recovery/proof/baseline-52011/generation-2/supplemental-certification --json` | 35 | 2.134 | 0 |
| candidate-build | `cargo build --offline --locked -j2 -p snapback2` | 300 | 47.775 | 0 |
| candidate-public | `node /Users/ccheever/clique-improvement/revisions/successor-widening-local-recovery/public-witness.mjs candidate 52012` | 180 | 24.307 | 0 |
| commit | `git commit -m 'Validate surviving maintained target rows during succession'` | 60 | 0.278 | 0 |

**First failures and limits.** baseline-core-red exited 101 on fixture compilation (usize versus u32 max; Option versus u32 minimum), after an attempted correction used a wrong cwd-relative path. The test source/log and setup notes are retained. Corrections also fixed the unexecuted snapshot SQL to inspect actual c0–c7 columns. baseline-core-invariant then exposed both genuine product reds on the unchanged engine. baseline-public exited 1 after its 35s ready predicate incorrectly expected an object; actual ready is a string. Its zero-row store, commands, output, harness, timeout and successful cleanup remain retained. The predicate was corrected, without extending any deadline, before the new 52011 fixture. The supplemental raw-project comparison assertion failed only because native serialization materializes/removes defaults; its complete delta is in failures/supplemental-project-comparison.json. That successful native certification was not rerun; generation equality was checked against the retained response. Exploratory missing-path/unmatched-glob reads and one failed partial-line LLP patch are in the session output and auxiliary failure notes. No product failure has been relabeled as a pass, and no failed evidence was deleted.

There are no known remaining affected product failures. This candidate still needs root's independent reviews and integration. The public proof covers the ordinary maintained-target minimum scenario at three stored rows; mixed migration and historical compatibility are focused core proofs. No claim is made about unavailable original scratch executions or unrun broad/production/scale surfaces.

**Owned cleanup and privacy.** Only the following three owners launched, each after current port availability was checked. Their exact argv/PID/start time/binary hash and cleanup receipts are retained. Each stopped through its own dev control route, exited 0, and was waited for; the final audit checks recorded PIDs absent and used ports available. No process-name/pattern kill or other PID operation occurred. All public stores, including the failed setup, remain privately in proof/. Read-only immutable inspection occurred after no owner/no WAL and preserved each database hash. No public store exceeded 3 rows (limit 100). The external evidence root remains private; auth headers are not captured, no bearer/session secrets are written into responses/report, and the stores' identity state remains only in the private stores.

| Fixture | Owner PID | Port | Retained rows | Cleanup |
|---|---:|---:|---:|---|
| baseline-52010 | 50067 | 52010 | 0 | exited 0, waited, PID absent, port available |
| baseline-52011 | 50766 | 52011 | 3 | exited 0, waited, PID absent, port available |
| candidate-52012 | 54385 | 52012 | 3 | exited 0, waited, PID absent, port available |

`phase.json` is the progress/terminal receipt; `final-answer.md` is the separate final handoff. Main, other lanes, and remote writer 46084 were untouched.
