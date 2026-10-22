# DX7 — wave-24 fixes for 0.4.40

Worktree: `/home/ccheever/projects/sb4-b24-dx7`; branch: `sb4-b24-dx7`.
All four items are implemented and committed. No push, publication, or version
bump. The source version remains 0.4.38. The 0.4.40 changelog entry feeds
`guide changes` when that release version is selected; the current CLI filters
future entries. SEC8's security questionnaire, intent, invariant-test and
lifecycle work has a one-line ownership pointer in the entry.

## Per-item changes

### 3. Reused staging clock

Persist cumulative offset, logical time and unfinished maintenance pause with
the staging store. Recovery uses the maximum retained checkpoint, wall-plus-offset,
commit, schedule and disclosure evidence. A smaller explicit offset cannot rewind.
Checkpoint persistence and credential/lease shifts share the existing transaction;
startup never shifts credentials twice. Failed persistence rolls both back, and
an uncertain commit stops admission. Restart retains a paused drain; successful
`drain()` finishes it without replaying a jump. Production controls remain refused.

Main commits: `591af24176`, `0f383b76ac`, `afa505baff`, `5e7e3f6856`.
Tests: two rollback/recovery units; 45 clock integration tests on Mac; DX6/DX7
client consumers; packed repeated restart/advance/pause/drain cases, lower explicit
offset and production refusal. The packed staging group also passes.

### 6. Scrollable rendered text

`renderedText` counts mounted text reachable through legal per-axis scroll ranges,
composing nested clips without scrolling the application. Hidden content, real
clips, unreachable negative origins and fixed text outside the viewport stay
excluded. Fixed/sticky nodes use current geometry. Existing exact-match and
smallest-element ambiguity behavior remains.

Main commits: `d96fe03861`, `bd6ee0388e`.
Tests: composed React Native labels below a ScrollView fold, nested scroll/hidden
clips, hidden controls, fixed geometry and unchanged scroll positions. These run
in the Linux client pool, fresh packed consumer and Mac Chromium tests.

### 7. Gate and upgrade messaging

Upgrade snapshots include security notes and pending gates while reading older
snapshots compatibly. Deltas distinguish compiler refusals from pending security
review gates. E_UPGRADE names individual `check --ack-security ID --reason ...`
remediation. Refuted invariants explicitly suppress acknowledgment, explain the
counterexample boundary and leave persisted review decisions unchanged. Numeric
advance advice follows actual numeric consumption of that result, rather than
unrelated operators elsewhere in the file. It remains a non-gating heuristic.

Main commits: `c37460090b`, `c956cb4db3`, `bd6ee0388e`.
Tests: gate/acknowledgment Rust integration, warning scanner positives/negatives,
client upgrade/history tests, and actual published 0.4.35 and 0.4.37 wrappers
upgrading through a private candidate registry. Both historical paths pass.
Only candidate package manifests are aliased to 0.4.40; executable bytes remain
unchanged. This is test metadata, not a publication or version bump.

### 8. Schema ergonomics

Protected immutable payloads are allowed: inserts initialize them, and updates
or existing upserts ignore supplied guesses for every viewer without comparing
the stored value. Device prediction retains the known cell or omission; ignored
asset guesses cannot create placements. Pure typed audience helpers expand
hygienically into the existing rule grammar before planning, with cycle/depth/node
limits and no effects or accidental caller captures.

Hidden program probes name the hiding rule and explain caller-visible absence.
They gain no implicit privilege. The executable recipe demonstrates private roles
and an explicitly public minimal eligibility projection, atomically maintained
by its operator. Use that projection only when eligibility is public in the spec.
The exact recipe is available through:
`guide rule-recipes --section "Private immutable payloads and audience helpers"`.

Main commits: `16fa79d8a2`, `6c3f8f064f`, `646415c8e7`, `0e551c8095`,
`afa505baff`, `d0ac63f779`, `5d54630f3e`. Final explanations and independent
fact pins: `3456537bf8`, `ea692a0505`. The legacy rule test now proves helper/inline
equivalence and retains the ordered-read-rule refusal (`057441f038`).
Tests: 23 language column-read cases, six device column-read cases, three helper
cases, the full 127-case guide audit, asset placement/system-viewer cases and the
fresh packed recipe. Packed rule recipes pass too.

## Design and reviews

Amended LLP 3000.000.000.001 §12 and parent LLP 3000.036 §22.8/22.9; updated
guides, changelog and journal with the implementation. Metadata: `0990be73d9`.
Three required review rounds used Muse `muse-spark-1.3-contributor high` and fresh
independent `codex gpt-6.1-sol high` sessions. **Both marked the same frozen r3
amendment READY.** Verbatim transcripts, proposals, briefs and SHA-256 provenance
are under `llp/reviews/dx7/`; recorded hashes were verified. Muse's prescribed
fallback succeeded after a plan-quota refusal. No key file was read or printed.

## Verification results

Logs and retained artifacts below are under `~/sb4-loop/`. Every shell command
was timeout-bounded. Every cargo invocation inherited `CARGO_INCREMENTAL=0`,
`CARGO_PROFILE_DEV_DEBUG=0`, and `CARGO_PROFILE_TEST_DEBUG=0`. The prohibited
full `scripts/test.sh` was never run.

| Check | Result / evidence |
| --- | --- |
| Setup | Frozen Bun install, CLI/SDK/wasm builds passed. Wasm gzip 734,816 bytes, below the existing 735,388-byte budget. |
| Affected Rust | 170 passed; clock units separately 2 passed. `dx7-affected-r2.log`, `dx7-clock-unit-r3.log`. |
| Final guide/helper checks | 130 passed; legacy rule-language target passed. `dx7-guide-final.log`, `dx7-rule-language-final.log`. |
| Client pool | Final repeat: 8/8 files, 66/66 tests passed, zero skipped. Git status clean afterward. `dx7-client-pool-last.log`. |
| Mac Studio | 217 Rust tests and 28 client tests passed. `dx7-mac-tests.log`, `dx7-mac-results.json`, `dx7-mac-client-final.{json,log}`. |
| Root setup | Frozen install, workspace hoist and generated-artifact checks passed, including a final restoration of missing root dependencies. `dx7-root-setup-restored.log`. |
| Post-merge root inventories | PASS: 365 package tests, 35 scripts, 31 demos, 487 publication leaves, 162 guide pages / 1,937 snippets. `dx7-inventories-merged.log`. |
| Post-merge root guide | 22 passed, zero failed/skipped/preconditions. `dx7-root-guide-merged.log`. Existing warnings remain warnings. |
| Post-merge ref-check | 565 LLPs, 12,378 references, zero errors/unchecked. `dx7-ref-check-merged.log`. |
| Docs budget | README 319/320 physical lines; named self-containment test passed. Rules card stays at 374 lines. `dx7-docs-budget-reviewed-docs.log`. |
| Final native artifact | Production musl build and static ELF validation passed. `dx7-native-reviewed-docs.log`. |
| Final fresh packed DX7 cases | PASS, including both published old-CLI paths and installed native guide explanations. Source/integrities/binary hash: `dx7-scoped-final.json`; log: `dx7-scoped-final.log`. |

Mac work stayed in `~/sb4-ws-dx7` on `macstudio-charlie-apt101-a`; no other Mac
was used. Five source hashes were checked before compilation. Missing fixture,
LLP and packed-JS inputs in the initial transfer were supplied without changing
assertions. The initial client attempt lacked Vite/TypeScript and used the
machine's Chrome; the final serial retry used the exact test dependencies and
pinned Playwright Chromium and passed all 28. Mac source snapshot: `5d54630f3e`;
subsequent DX7 changes affect guide copy, fact expectations, legacy tests and
records, rather than runtime semantics.

### Full five-crate run

The requested complete cargo command finished with exit 101: **7,334 passed,
28 failed, 275 pre-existing ignored**, across 454 reported targets including
doc-tests (`dx7-cargo-test-final.log`). It was started during development; seven
failures in its early-built DX7 test artifacts were subsequently corrected and
passed current targeted reruns: gate fixture, store-port ratchet, guide census,
two helper expectations, guide budget, and the legacy helper ban. The affected
checks above supersede those seven observations. No full-suite green is claimed.

The remaining **21 failures reproduce on unmodified origin/main `cadb7c55be`**:
20 source-reservation admission failures, plus one authentic predecessor-store
execution-facts mismatch. Disposable baseline snapshots used original git inputs,
with no assertion or fixture edits, and were deleted after comparison.

- Residency/init (2): `dx7-baseline-provenance.json`, `dx7-residency-baseline-{1,2}.log`.
- Timeline adoption (2), device readauth recipes/bridges (8):
  `dx7-baseline-extra-results.json`, `dx7-baseline-{timeline_adoption,readauth}.log`.
- Live-parent reservation cases (6), authentic predecessor admission (1):
  `dx7-baseline-lang-results.json`, `dx7-baseline-{live_parent,declarative_receipts}.log`.
- Recorded-maintenance simulation (2): `dx7-baseline-sim-results.json`,
  `dx7-baseline-maintains_recorded.log` (baseline 17 passed, 2 failed).

Tickets retain exact cases and evidence:
`issues/20261022-snapback4-residency-source-reservations-baseline.md` and
`issues/20261023-snapback4-predecessor-execution-facts-baseline.md`.
No bound, ratchet, admission check or historical fixture was weakened to clear them.

### Packed Linux qualification

`qualify-linux --consumer-only` ran on fresh SDK/Expo packs. Consumer-only mode
honors the prohibition on `scripts/test.sh` and cannot emit a publication receipt.
The first attempt passed DX7 but hit a shared npm-cache ENOENT during historical
Expo installation. The isolated-cache retry passed DX7, DX5/DX6, all three
historical Expo upgrade modes, day4, release transitions and dormant cases, then
stopped at the day5 installed residency recipe on the baseline reservation error
(`dx7-qualify-isolated.log`).

All ten later groups passed in independent continuation: production, proof kit,
client recipes, security, migrations, staging, rules, frontend proofs, starters,
and clean Ubuntu 24.04 / Alpine userspaces (`dx7-qualify-continuation.{json,log}`).
The original refusal remains recorded; there is no overall qualification receipt.

A separate final fresh-pack DX7 qualification includes the corrected explanations
and both actual old-CLI upgrade paths. Its recorded source is `057441f038`; exact
artifact integrities and native hash are in `dx7-scoped-final.json`. Final tarballs
are retained in `dx7-pack-reviewed-docs/`. Earlier qualified packs remain separate
so their existing integrity records stay verifiable.

## Integration, cleanup and deferrals

Final fetch found origin/main `fc5b38f511` (RT5, still 0.4.38), merged as
`37610aec49`. The only conflict was appended journal text; both entries were kept.
RT5 adds guarded PostgreSQL test/experiment codec support with no serving caller;
it leaves the DX7 tested semantic delta unchanged. Per repository optimistic
integration policy, the expensive battery was not repeated just because main
advanced. Post-merge ref-check, inventories and root guide checks passed. Packed
claims remain explicitly bound to their recorded snapshot, not the merged HEAD.
0.4.39 was not present on origin/main at this final integration.

All requested DX7 implementations are complete. The inherited failures and the
overall residency qualification refusal are outside this lane and remain the
only validation deferrals. SEC8 owns its parallel items.

Task-owned Linux and Mac build targets, installed qualification scratch,
npm/browser caches and obsolete stages were removed after their processes exited.
No process used the Linux build outputs and no DX7 temporary scratch remained.
Mac cleanup detected no owned processes. Source, logs, JSON evidence and qualified
tarballs are preserved. Cleanup receipts: `dx7-cleanup.json`, `dx7-mac-cleanup.json`.
Workspace dependencies needed for future checks are preserved.
