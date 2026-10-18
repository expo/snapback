# STAGE workstream report

Branch: `sb4-b16-stage`. Qualified product candidate: `dc79450ff94c0a48fda73cf3b5585c92512ecd20`.
Status: complete and committed; final Muse and Codex reviews READY; all requested verification completed.
No push, publication or version bump. Next-version behavior is recorded under 0.4.32 in `guide changes`.

## Per-item delivery

| Item | Change | Commits |
| --- | --- | --- |
| Staging with real users | `deploy --staging` classifies only a newly created store under exclusive custody. Existing/legacy/unknown stores are production and cannot be relabelled. Classification survives releases, rollback, restart and copy. `startServe(...,{seedUsers})` / `seedAccounts()` use real signup and an ordinary operator-authorized application mutation for roles. Production bulk setup refuses before token mint/signup. | e25de6ae10, 33db30b649 |
| First admin | Complete password-only recipe uses an operator-chosen email/password and the existing local store-owner token protocol. `operatorToken()` captures its bearer in memory. Both the mutation and roster rule require `service:operator`; no public first-caller privilege path exists. | e25de6ae10, 33db30b649, 575f3643cf |
| Dev doors | Password-only dev closes `/seed`, `/dev/*` and persona headers by default; fixture tools require `--unsafe-dev-doors`. Personas require declaration. `/auth/config` reports development, environment and devDoors. Protected local token minting and existing serve diagnostic refusals remain intact. Delayed/queued effects revalidate under the writer; persona readers revalidate against their engine and current cast without holding publication locks through I/O. Action, route and asset admission also revalidate. | e25de6ae10, 575f3643cf, a09b85cc7e, f5c19ffbed, a87106a9e7, bda003c332 |
| Proof kit | Default `startDev` follows native persistent storage. Disposable proofs explicitly select memory. Generated/frontend/fixture callers migrate accordingly. Exact old templates and digests update managed proofs while preserving custom scripts. Qualified mutation handles work with staging setup; setup failures stop the owned host. | e25de6ae10, 575f3643cf, bda003c332, 90b029573b |
| Runnable guides | `guide staging` contains the complete schema, staging-user/data script and first-admin script. Packed qualification executes the installed schema and JS fences unchanged. Testing/client fixture and browser recipes also run verbatim, preserving a prepopulated developer database byte-for-byte. All helper refusal codes have defining/recovery text; keyword, application-file and mutation registries are reconciled without relaxing checks or budgets. | 33db30b649, 575f3643cf, 90b029573b, dc79450ff9 |

Five deterministic native staging tests cover slow bodies, writer queues, memory/file replacement readers, action/route admission and asset-intent transitions. Client cases cover real login, role/data writes, self-grant refusal, production refusal before mint, first admin, durable classification and dev closure/adoption.

## Decisions and ownership

LLP 3000.000.000.001 amends the release/proof contracts. Staging is a store-lifetime classification, stronger than a mutable release label. There is no promotion flag: production uses a separate store. Bulk setup uses normal signup and declared operator grants, so no serve system-seeding endpoint or new first-admin grant verb is needed. The supported packaged recipe fulfills the staging path instead of adding a native seed-users flag.

SEC owns self-promotion lint/invariants; KIT4 owns unrelated proof helpers; PROD2 owns production adaptation; DAY5 owns unrelated starter custody. Affected docs carry one-line pointers. No other worktree or publication machine was used. Mac work stayed in `ccheever@macstudio-charlie-apt101-a:~/sb4-ws-stage`.

## Reviews

Fresh round-7 Muse (`muse-spark-1.3-contributor`, high) and Codex (`gpt-6.1-sol`, high) both returned READY on dc79450ff9. They were mutually blind and received no author report or other review output. Complete verbatim transcripts, briefs, exact commands, capture times and SHA256 provenance are under `llp/reviews/3000.000.000.001-stage-r7.*`.

All earlier received reviews are preserved too. Findings led to writer/read admission guards, lock-order repair, action/asset guards, qualified mutation support and complete published caller migration. Earlier READY verdicts were not treated as approval of later source. Initial Muse quota/unavailability and provider fallback are recorded; its key file was never read or printed.

## Tests and qualification

All final commands use timeouts. Cargo commands set `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`. One early indirect docs-budget invocation used the default Cargo profile; it was rerun with the required environment. The prohibited full `scripts/test.sh` was not run.

| Check | Result |
| --- | --- |
| Setup | Frozen Snapback4 Bun install, native build, wasm build and client build passed. Wasm gzip 723275/723775 bytes. |
| Complete CLI crate | `cargo test -p snapback4 --no-fail-fast` completed all targets. Its one stale literal assertion was corrected; complete cli_friction rerun passed 40/40. Other targets passed. Final native unit rerun passed 476, with 5 existing ignores. |
| Complete core crate | `cargo test -p snapback4-core --no-fail-fast` passed: 761 passing results, 5 ignores, including generated disclosure and compile-fail tests. |
| Complete remaining crates | `cargo test -p snapback4-device -p snapback4-difftest -p snapback4-lang -p snapback4-sim --no-fail-fast` completed 319 result targets. Its three red targets were guide/census integration: full final readauth 88/88, guide 125/125, surf4_guide 4/4 all passed. All other targets passed. Original full-run output retains 4503 passes, 10 red cases and 25 ignores; corrections are verified by full target reruns, not skipped cases. |
| Affected clients | 50/50 staging, proof-host, fixture and password-browser-authority tests passed on final source. Further identity/headless/production/persona set 27/27 passed. TypeScript check passed. |
| Assigned Mac Studio | Final native build passed; guide 125/125, native unit 467 passed/5 ignored, affected clients 31/31 passed. The guide initially needed its referenced LLP 3000.025 copied into the same assigned workspace; full rerun passed. CLI compilation also uses two existing benchmark include fixtures copied there. |
| Fresh pack | `publish.mjs --prepare-client --prepare-directory /tmp/stage-pack-r7` passed at dc79450ff9. Client 1283867 bytes/311 files; matching Expo and Linux tarballs retained. |
| Linux qualification | `qualify-linux.mjs --consumer-only` passed (exit 0) on the fresh pack: staging users/data, first admin, production refusal before mint, production relabelling refusal, 12 generated frontend proofs, six host starter cases and complete Ubuntu 24.04 plus Alpine matrices. |
| Root checks | Frozen root Bun install, ensure-workspace-hoist and check-generated-artifacts passed. Final inventory passed: 365 package tests, 35 script tests, 31 demos, 487 publication leaves. Guide passed 22/22 checks, 162 pages/1937 snippets; 121 existing warnings. |
| References and docs | ref-check passed: 552 docs/12005 refs, zero errors/unchecked. docs-budget passed: README 317/320 and named self-containment test 1/1. docs-budget lives under snapback4/scripts. |

The complete suites were split into CLI, core and the remaining crates after an initial 20-minute whole-workspace bound. Original reds are retained honestly. Full target reruns cover every affected failure; no expensive unchanged suite was rerun just to produce a uniformly green historical log. Rust output totals include nested recovery subprocess results.

Earlier packed runs caught generated chat proofs relying on implicit memory and incomplete guide-corpus registration. Both were corrected; superseded runs are not final qualification claims. Consumer-only qualification is supplemented by the complete manual crate runs and cannot produce a publication-qualified receipt.

## Bakeoff witnesses

Private copies of 002 (orchard spray reentry), 011 (freezer rack ledger) and 045 (instrument loan bank) use `reports/20261018-stage/repro-probe.mjs` as `probe:serve`. Each adds only an operator-only stagingProvision operation and corresponding roster insert permission, then uses actual application mutations for data. Originals stayed read-only.

Final-tarball reruns all passed: 24 real password users, at least two per role; authenticated catalog and application-data operations; `development=false`, `environment=staging`, `devDoors=false`; unauthenticated seed/status 403; persona 401; frontend 200; alive at measurement end. Credentials stay in memory and are omitted from evidence. The driver stops its launch-recorded process group, and temporary staging stores are cleaned on shutdown. Sanitized JSON and reusable drivers are under `snapback4/reports/20261018-stage/`.

## Cleanup and final disposition

Removed 2984 SQLite sidecars from this worktree's completed owned test processes, against an initially empty scratch baseline. Local and assigned Mac target database-scratch scans returned zero. Superseded qualification dependency directories were removed to recover shared disk; result records and source copies remain.

No product item is deferred. SEC's lint/invariant work stays with SEC. No push, package version bump or publication was performed.

Final Linux evidence: `/tmp/stage-linux-r7/consumer.json`; retained tarballs in `/tmp/stage-pack-r7/` and `/tmp/stage-linux-r7/`. Source is dc79450ff9; client integrity `sha512-XxIaI369UiZ92SbtpHQN3WysPNJr6I5LIHgU/tr32oDl00Emt+3Ll+EFe8nTM+Q7A2I7wie66vODLJlWlCYc7Q==`. The durable verification index is `snapback4/reports/20261018-stage/verification.json`, including digests, commands, corrected-target evidence and final probe witnesses. The closing commit adds evidence/workflow status only; qualified product code remains unchanged from dc79450ff9.
