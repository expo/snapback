# Integration 17 — bakeoff fixes / 0.4.33

Worktree `/home/ccheever/projects/snapback-sb4loop`, branch `sb4-loop`, base
`8416d092c3`. Local commits only: no push or npm publication. The requested initial
fetch and ff-only merge found main already current. Repeated closing fetches:
origin/main remains `8416d092c3`; no parallel publication records appeared through the
final fetch. Root report conflicts kept integration's copy; this report replaces the
inherited Integration 16 report. Publication directories and publication worktrees were
not used.

Evidence paths below are relative to `snapback4/reports/integration17/`.

## Merges and release

| Lane | No-ff merge | Result |
|---|---|---|
| STAGE | `371b393ac5` | Real-user staging, first admin, password dev-door closure, startServe |
| FRONT | `c2f6ad1965` | Query/auth hooks, starter recipe removal, completeness presentation, hourOfDay |
| SEC2 (contains SEC) | `50e424577c` | Independent security intent, audit, generated engine/HTTP campaigns, bakeoff fixes |

All three merges were performed in the requested order. Lane reports were read at their
own sections, excluding inherited Integration 16 text. Main's KIT4, PROD2, DAY5, SURF5,
LANG4 and RULES5/LIVE behavior was retained. In particular:

- Whole inherited/live-parent invariant obligations remain unproved; no direct
  rule proof is promoted into a proof of its live parent. Both observer cases
  are covered. Sweep-deadline advice deduplicates table/status/job sites,
  including qualified module job names, without suppressing distinct notes.
- Note review retains new/acknowledged partitions; refuted security checks
  neither create nor overwrite acknowledgement evidence and print failure.
- Test-time personas are explicit unsafe dev fixtures. Production HTTP probes
  use actual declared authentication and refresh/logout-all, not development
  bypasses. Existing reset/clock reply and proof-kit behavior is preserved.
- Initial app readiness remains PROD2's release/restoration decision. Every
  shipped historical/current starter proof digest is registered (51 records,
  including all 36 base records); installed recipe assets replace removed app
  recipe copies. No custom application proof is silently rewritten.
- Help/parser checks include staging, unsafe dev doors, audit and check --audit.

The separate ten-file bump `999598649f`, **snapback4 0.4.33: security invariants,
real-user staging and simpler clients**, matches `08fa452c31`'s bump scope. One coherent
0.4.33 guide-changes entry explains proof limits, audit, automatic upgrade campaigns and
missing-intent notes, staging/admin, password dev doors, client hooks and recipe-free
starters. The 0.4.32 entry remains intact.

Integration repairs are recorded in `c588ed5f0c`, `c0488f24bb`, `7728195385`,
`44f858508d`, `8e3fd53c4c`, `f1514782bb`, `d9b90af4fb` and `fc7a63ea0f`. These reconcile
generated records, installed packed proofs, explicit fixture hosts, qualified-job
advice, failed-check acknowledgement and the deploy card's 150-line/feature-introduction
contract. `56d6f58e45` records the wasm budget. `0d47731300` preserves early
differential, survey, upgrade and Exact evidence. `288dc52478` records completed
packed/Mac/final-consumer evidence and the latest research aggregate; the closing report
commit adds the final full Rust verdict.

## Corpus, release notes and generated records

Applied llp-orient/llp-ship within the user's local branch/no-push instruction. Read the
SB4 fence and relevant guide/design pages. Existing lane RFC reviews remain intact;
integration adds research observations and implementation fixes, not a new
RFC/amendment. A fresh independent Codex review identified the failed security-check
acknowledgement issue; its fresh follow-up returns READY after that fix. Both full
reviews are retained verbatim with provenance under reviews/. The scoped independent
security review also led to module-job deduplication.

LLP 3000.037 §20 records wave 16/17 paired bakeoffs, confounders, finite security
findings and what 0.4.33 changes. Its latest regenerated wave 17 reverify aggregate has
49/50 all-five passes on each backend; Snapback 50/50 live probes versus Convex 49/50.
Counts and raw aggregate snapshots are retained under research/. No older-wave
builder-time/security improvement is attributed to the new release.

Generated records were regenerated, never hand-merged: authoring census, diagnostics
registry, guide manifest/projections, proof API and inventories. The compiled authoring
census is 544 mutation occurrences/95 private write sites (base 529/95). New guide
contexts account for repeated occurrences; this is not a claim of 15 new independent
write sites.

Wasm: **2,380,489 raw / 726,002 gzip / 547,673 Brotli bytes**. Budget **726,502 =
measurement + 500 bytes**. Relative to 0.4.32: +64 raw / +15 gzip. Clean measurement
`7728195385` and strict family/absence audits pass; later changes leave device inputs
unchanged. SHA256 `cb88bc19f627d3a272b17c625407c7bd8f391982a2f506bae9590a1b458139e5`.
The prepared client contains exactly these bytes. Brotli uses the documented Node zlib
quality 11 shim, as on Integration 16. The first missing-shim attempt is retained as an
unsuccessful attempt, not counted as the measurement.

## Linux

All Cargo commands inherit `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
CARGO_PROFILE_TEST_DEBUG=0`. Every shell command is timeout-bounded.

The required full post-fix rerun **exits 0**, captured both from the driver subprocess
and tool completion. It reports **429 successful result summaries / 6,668 reported
passes / 45 intentional ignores**, zero failed summaries. Counts include 13 nested
targeted self-test invocations; they are execution counts, not distinct top-level Cargo
target counts. The second complete log has the same clean totals; its tool return was
lost during the provider interruption, so no captured exit code is claimed for it. The
final run began after the last deploy-guide fix and completes through doctests. See
linux/results.json and all three compressed full logs.

Exact requested full command (final repeat also uses build jobs 12 / test threads 8):
`cargo test -p snapback4-core -p snapback4-lang -p snapback4-device -p snapback4-sim -p
snapback4 --no-fail-fast`. The initial run exposed old proof-digest/day5 fixtures and
the deploy card's missing title separator. Those are repaired; failed attempts remain in
logs. No intermittent cleanup/resolver flake was observed. The three initial failures
were deterministic stale digest/guide fixtures and are fixed; both subsequent complete
logs are clean. The mandatory final run provides the captured successful full-command
exit.

Final full client pool: **422/422 files, 7,755 passed, 56 expected skips, zero
failures/cancellations** (7,811 tests). The pool completes in one pass before any final
debug-CLI rebuild. Both seeded models use the full default 5,000/3,000 sequence counts:
81/81 pass. Fixture discovery: 9/9 pass. The first full pool's 22 failed files exposed
stale fixtures/API census and our overlapping prepare-client removal of dist; all were
repaired. Final pool runs with stable dist/debug CLI; the later guide-only blank-line
fix has no client semantic effect. Models/fixtures are unchanged.

Differential: 20,000 native cases/1,220,035 executions, zero mismatches; 1,000 device
cases (seeds 0–999)/27,922 executions, zero mismatches. Lean 20,000: 16,697 agree /
3,173 unsupported / 130 known mismatches in the exact 4 base signatures (3/35/67/25),
identical to committed `8416d092c3` evidence. No new signatures. These semantic inputs
are unchanged by later note/proof/doc/fixture fixes.

Root frozen Bun install, workspace hoist and check-generated-artifacts all ran. Root
inventory checks pass: 365 registered package test files, 35 script test files, 31 demos
and 487 publication leaves. Root guide: 22 passed, 0 failed/skipped/preconditions, 121
inherited warnings. Ref-check: 555 LLP documents / 12,067 references, zero errors or
unchecked references; repeated after evidence/research updates. Docs budget 319/320 and
its named self-containment test passes; the full guide card target passes 126/126 after
the final guide fix.

## Packed consumers

Final installed consumer qualification **passes** against product source
`fc7a63ea0fbbb23005df12f83ae4c4b25955ca02`, via proot Ubuntu 24.04 and Alpine 3.23.3.
Both distro receipts pass all six starter categories. The immutable static production
binary SHA256 is `a744bf6a29189dbcfd5fe1ecc9197db94ee79443eff2873cc4a3288cc3e5ce43`.
Final source/integrity guard passes; see linux/packed/consumer.json and the complete
compressed qualification log. Artifacts remain in `/tmp/integ17/prepared-qualified` and
`/tmp/integ17/linux-final-clean`. Fresh `publish.mjs --prepare-client` pack: client
SHA256 `fef9ff1ce28975a3c85873ebc881d08e68795a0db130c21df3c7edb773a82683`. Prepared
snapshots are byte-identical. The final qualifier runs every installed consumer case,
including staging users/production refusal, security guide and starter declarations,
hooks and recipe copies, production accounts, proof kit, frontend/starter controls and
both clean distro toolchains.

`--consumer-only` deliberately avoids the forbidden scripts/test.sh. Requested
full Rust/client/root suites run separately. Evidence correctly says
publicationQualified: false / suite: not-run; no publication receipt is invented.
Security evidence includes exact guide counterexamples and finite campaigns,
7 unsigned HTTP doors plus 14 credential-revocation challenges for each guest and
password configuration. Native/action/effect starter HTTP without complete
deployed artifacts stays explicitly not-covered; engine campaigns execute and
cannot turn unsupported obligations into proofs. Offline-device freshness is
not certified. Earlier wrong-source/dirty-test-scratch attempts are retained.

## Schema survey, upgrade and Exact

Final closeout replay binds the rebuilt product-source `fc7a63ea0f` CLI, SHA256
`73e0a3f56daed048998beefd4299c2e8efb0c8ce255060097df224a8f73caa7b`, and immutable
prepared client. Survey, Exact and upgrade smoke all pass. All 304 installed client dist
files in both Exact apps match the pack. See bindings-closeout-README.md, its command
ledger and the final/closeout evidence directories; initial full upgrade and contract
migration evidence is also retained. The final 150-schema survey uses read-only copies
and verifies all original hashes: 100 wave 15 + 50 wave 16 pass, 0 diagnostics. Ordinary
note counts 488/147 reconcile exactly to LANG4/RULES5/LIVE's 458/131 base plus 30/16
N_SWEEP_DEADLINE notes. Security advice is separate: 968/582 notes, with exactly 100/50
aggregate N_SECURITY_INTENT notes. Dedup reduces provisional N_SWEEP_ONLY_DEADLINE 23→7
and 8→6; all other security code counts are unchanged. All 150 apps have no invariants;
the aggregate note is not a failure. Per-code evidence is retained.

Actual 0.4.32 store and Expo setup used npm install --save-exact snapback4@0.4.32
snapback4-expo@0.4.32 from `http://127.0.0.1:4873/`. The full actual upgrade/adopt path
pins both 0.4.33 packages and passes Expo typecheck/web export. Old store row/schema
survive; final private-backup replay proves signup/write/read, one missing-intent note,
closed default password dev doors/forged personas, and explicit unsafe legacy workflow.
Original source/store hashes remain unchanged.

Exact clean clone origin/main b28c0c1a642 includes EX10 contract migrate. Synced and
online apps are built with merged core/device/lang and the supplied packed client. Both
bun exact.mjs snapback --rebuild and bun exact.mjs test web pass (2 tests per mode), and
contract migrate passes. Commands, local dependency patch and final byte/source bindings
are retained under exact/. No non-scratch Exact checkout was modified.

## Mac

**All required Mac work passes.** The 61-file client union reports 1,097 passed / 14
normal platform skips / zero failures or cancellations. Affected Rust targets pass,
including all 126 guide and 14 check-notes cases. Fresh device/simulator XCFramework and
fresh Expo Release build succeed; the dedicated iOS 27 simulator passes offline and
restart native witnesses. Darwin installed-pack proof-kit, real-user staging and
security probes pass. mac/README.md records exact commands, per-target totals, retained
earlier same-input checks and final source custody. Required Studio only
(`ccheever@macstudio-charlie-apt101-a`, Xcode 27.0), scratch ~/sb4-ws-integ17. No black
M5 use. Final source transfer has 3,531 files matching fc7a63ea0f exactly; no
mismatches. Platform-sensitive file union and affected cargo targets are enumerated in
mac/ evidence. Retained checks name their source and unchanged semantic inputs; no
skipped Mac obligation is claimed as passed.

## Deferrals and delivery

No requested verification was omitted. The complete scripts/test.sh was intentionally
not run, as instructed; the requested full Rust/client/root suites and installed packed
consumer qualification ran separately. Declared platform/opt-in skips, the unchanged 130
Lean baseline mismatches, and explicitly unsupported security proof/HTTP scopes are
recorded above rather than claimed as proved. No push, registry publication, publication
receipt or zero-security-hole claim. Final local report/evidence commits are listed by
git log; all recoverable work remains on sb4-loop. All intended changes are committed
locally on sb4-loop; the closing status is clean. The qualified product snapshot is
fc7a63ea0f; later commits contain research/evidence/report updates only and do not
change its tested semantic inputs.
