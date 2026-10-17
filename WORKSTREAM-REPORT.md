# Integration 15 — Snapback 4 0.4.31

Complete on `sb4-loop`; no push or publication. Base `4ef9f77fb3` (0.4.30).
All seven current requested branch tips are integrated. `sb4-w14-live` is
excluded; live-parent authority continues separately for 0.4.32.

## Commits and integration

| Workstream | Merge | Result |
|---|---|---|
| REG | `154f5e3b0f` | Persona-only fixture loading/dev catalog; Expo floor/upgrade; missing-export advice. |
| DAY4 | `00081c70ad` | Full proof ownership, explicit day-two opt-in, custom/adapt custody and directional rollback advice. |
| PROD | `e84766710d` | Independent production adapt module; explicit roster/first-writer plan, real-account and release-aware screen recipes. |
| KIT3 | `07d9d4e36a` | Explicit async form claims, reason enum, fresh-text returns, dev clock/reporting and bounded overdue reads. |
| RULES4 | `3a80814cbb` | Private refusal layers, conservative mixed-gate advice and executable bounded authorization recipes. |
| LANG3 | `f5e63f9203` | Held-parent completeness, enum/sort facts, private readable P18 cases and precise note categories. |
| SURF4 | `67c9b95849` | Captured host imports/package scopes, startup/shutdown, help/parser parity and truthful printed surfaces. |
| 0.4.30 publication records | `61060eeeb1` | Integrates `7508c4ef2a`; preserves both journal entries. |

Version bump: **`8d068a7577` — `snapback4 0.4.31: reliable upgrades, proofs,
production adaptation and precise diagnostics`**. Its exact ten-file scope
matches `1f6b75ff27`'s 0.4.30 bump.

`201ec02ca3` writes one coherent 0.4.31 guide-changes entry, including runtime,
existing-store/app behavior, Expo acquisition/floor, fixture credentials/catalog,
clock reporting/each-boundary/deadline reads, day-two opt-in, production adapt,
new notes/refusals and captured authority. `0130e0f041` adds LLP 3000.037 §18;
the final evidence commit updates its revision and final-schema reconciliation.

Conflicts preserve both intents: production dispatch beside day-two adaptation;
`startDev` has **personas and async now()**; todo screens retain denied/empty
states and scoped proof results; diagnostic categories and private rule layers
coexist; all new help flags and every consumer slice are retained. Overlapping
LLP material is preserved under subheadings with repaired anchors. Root report
conflicts keep the integration side. Generated records were regenerated rather
than hand-merged.

Additional integration corrections:

- `ecc0f2c305`: qualify RULES4's guide blocks against the exact prepared packs;
  preserve DAY4/PROD/client proof records in qualifier output.
- `263f8b0d2e`, `516a73cb31`: canonical proof digests and delivery-await census,
  fixture/module/mock updates; API/guide/message corrections across the small
  integration commits. Structured error-code assertions remain intact.
- `077fc71f81`: serialize two 130-socket overload cases so their parent respects
  macOS's ordinary 256-descriptor limit; all saturation/recovery assertions stay.
- `dc6f2b9de9`: worker error formatting contains E_EFFECT_LEASE exactly once,
  while the wire message remains unprefixed. Four focused real-wire cases pass.
- `19fbc756c0`: stop wire-fixture hosts before deleting directories. Mac exposed
  ENOTEMPTY in the earlier after-hook, which skipped the stop hook and left a
  server/pipe alive. Raw TAP/process sample retained; both wire cases pass on
  Linux and Mac. No timeout, workload or assertion was weakened.

## Final verification

All Cargo invocations use `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
CARGO_PROFILE_TEST_DEBUG=0`; build jobs are six. Every shell command is bounded
by timeout. No full `scripts/test.sh` invocation, publication directory or
publication worktree was used.

| Check | Final result |
|---|---|
| Linux exact five-crate command, complete after last fix | PASS exit 0; 402 targets, 6467 passed, 0 failed, 45 ordinary ignores. |
| Mac same complete five-crate command | PASS exit 0; 402 targets, 6502 passed, 0 failed, 45 ordinary ignores. |
| Linux full client pool, one pass | PASS 411/411 files; 7660 passed, 0 failed, 56 ordinary platform/environment skips (7716 total). |
| Full-default seeded client models | PASS 81/81, no skips; 5000/3000 sequence settings unchanged. |
| Fixture wrapper | PASS 9/9. All three client invocation stages exit 0. |
| Mac changed/platform-sensitive client scope | PASS 96/96 files; 1669 passed, 0 failed, 17 platform skips. |
| Native difftest | PASS 20,000 cases, seed 0, six workers; no disagreement. |
| Device difftest | PASS 1000 cases, seeds 0–999, both memory/SQLite; no disagreement. |
| Lean differential control | 20,000 cases: exactly 130 baseline mismatches, no new signature; pinned oracle built successfully. |
| Fresh packed consumers | PASS `qualify-linux.mjs --consumer-only` at `bbf8dfaae4`, including every new H9 case. |
| 100 final-schema check survey | PASS 100/100, 358 notes, both Quarry-only and full source/metadata copies. |
| 0.4.30 store/Expo upgrade | PASS real registry installation, adoption/open, upgrade, exact rows/store-id/file preservation, Expo floor repair, typecheck and web export. |
| Exact synced and bare-identity online apps | PASS fresh clone, generation/types, two web-test repetitions per app: 8 authored tests. |
| Mac native Expo peer floor | PASS Xcode 27.0, Expo 57.0.22/core 57.0.23, installed Release offline/restart witnesses. |
| Docs budget | PASS 317/320 README lines and named self-contained screen test. |
| Root inventories | PASS inventories of 365 package tests, 35 script tests, 31 demos/catalog entries, 487 publication leaves. |
| Root guide | PASS 22 checks; 0 failed, 0 skipped, 0 preconditions; 162 pages/1937 snippets. |
| References | PASS 551 LLP docs, 12,000 refs, 0 errors/unchecked. |

The native command is:

```sh
cargo test -p snapback4-core -p snapback4-lang -p snapback4-device -p snapback4-sim -p snapback4 --no-fail-fast
```

Linux's final full command starts after `19fbc756c0`. Mac uses eight libtest
threads; no test content, count or deadline changes. Its two intermittent cases
pass alone **and** in the complete repeat. Their investigation tickets remain
open; passing repetitions do not identify a cause. The first runs and controlled
cancellations are retained separately, never relabelled green. The final one-pass
client invocation uses the rebuilt merged CLI for every helper, including legacy
helpers which read target/debug directly.

## Packed and platform evidence

Fresh `publish.mjs --prepare-client --prepare-directory target/integ15-pack3`
then `qualify-linux.mjs --consumer-only` with its client and Expo packs, output
`target/integ15-qualification2`, exit 0. Includes verbatim guide loadFixtures on
persona-only and identity apps, all three Expo acquisition paths (including the
actual previous published starter), five DAY4 custom/removed/legacy/opt-in/template
cases, production adapt/real accounts, KIT3 contracts and RULES4 exact-pack guide
blocks. All 12 frontend proofs, six starter proofs and clean Alpine consumers pass.
This mode emits **publicationQualified=false**; the full native/client suites above
are separate. No publication qualification receipt or npm publication is claimed.

The packed snapshot is `bbf8dfaae4`; later changes are the two test-only fixes
above and evidence/docs. Production source and prepared artifact bytes are
unchanged. Pack integrities and static Linux binary digest are preserved in
`packed-consumer.json` and component records.

Mac used only `ccheever@macstudio-charlie-apt101-a`, scratch `~/sb4-ws-integ15`,
private Node 24.13.1/browser, Xcode 27.0. The black M5 was never used. The native
floor framework was built for iOS device and simulator; actual installed versions
are recorded in `mac-native-floor.json`. Native witness source `0130e0f041` has the
same core/device/client/Expo production source as the final tree. Scratch reference
app Babel/signing setup failures are retained along with the successful normally
signed Release run. Owned simulator shut down/deleted. Generated witness metric
append was preserved verbatim before restoring that file for a fast-forward;
there was no hand merge of generated metrics.

## Upgrade, Exact and schema controls

The upgrade begins with the requested
`npm install --save-exact snapback4@0.4.30 snapback4-expo@0.4.30 --registry
http://127.0.0.1:4873/`. A real row is written before upgrade. Candidate delivery
uses a temporary read-only registry overlay, not publishing. Acquire the .31
helper, then run `npx snapback4 upgrade --to 0.4.31`: valid Expo 57.0.30 stays;
a deliberately lowered 57.0.20 manifest moves to 57.0.22/core 57.0.23. Exact
row data, ids, store id and authored App/client/schema hashes remain unchanged.
Check, typecheck, export and final row read pass; exact commands/results retained.

Exact is a fresh `https://github.com/ccheever/exact2` origin/main clone at
`85cc746b56437e8897720538cd9d8f9dbbb8cfc8`, `~/sb4-loop/prewave15/exact2`.
`bun scripts/exact.mjs setup` installs tools; only scratch Cargo manifest/lock
paths bind its core/lang/device to this merged .31 tree. Final projects
`synced-final` (personas) and `online-guest-final` (bare `use identity`, await
`guest()` before reads) install pack3. Each runs `bun exact.mjs snapback`,
Contract type generation and `bun exact.mjs test web --backend <url>` twice.
`exact-final-commands.json`, driver, manifest/lock patch and numbered logs record
exactly what ran, including backend launch details in the evidence README.

Both 100-schema surveys use read-only copies of wave14/apps/*/snapback;
original source hashes are unchanged and identical between the .30 and merged
checks. Current local-registry .30 control reports **371** notes; merged **358**.
Every LANG3 final code count (357) matches, plus RULES4's N_REQUIRE_REFUSED in
079. RULES4's earlier 373/374 record differs by one note each at 063 and 065;
its absent source hashes do not establish the cause. The current controls do not
reproduce those two notes. Delta: conditional completeness −2, immutable patch −5,
hidden lookup −3, never-complete −1, unchecked reference −1, unreadable probe −2,
require-refused +1; all other code counts stay unchanged.

| Code | Count |
|---|---:|
| `N_CASCADE_DORMANT` | 4 |
| `N_CONDITIONAL_COMPLETE` | 8 |
| `N_DELETE_NEEDS_READ` | 3 |
| `N_DELETE_RESTRICTED` | 2 |
| `N_EPHEMERAL_SERVER` | 1 |
| `N_IMMUTABLE_PATCH` | 11 |
| `N_LOOKUP_HIDDEN` | 4 |
| `N_MAINTAINED_COLUMN_DISCLOSURE` | 2 |
| `N_MAINTAIN_AUTHORIZATION` | 2 |
| `N_MAINTAIN_DELTA` | 7 |
| `N_MAINTAIN_SYNCED` | 1 |
| `N_NEVER_COMPLETE` | 20 |
| `N_NO_CURSOR` | 193 |
| `N_NO_HORIZON` | 14 |
| `N_NO_PRODUCTION_WRITER` | 53 |
| `N_PATCH_CLEARS` | 1 |
| `N_REQUIRE_REFUSED` | 1 |
| `N_SPARSE_FILTER` | 19 |
| `N_SYNC_ORDER` | 2 |
| `N_UNREADABLE_PROBE` | 8 |
| `N_WIDE_MERGE` | 2 |

Authoring census regenerated: **497 mutations, same 94 private eligible sites**.
Delivery-await census regenerated: three proof files updated, **213 delivery sites
and their fault recipes unchanged**. Proof digests regenerated canonically;
root diagnostics/symbol registry and guide manifest regenerated and inventories
checked. Root setup actually completed frozen Bun install, workspace hoist and
check-generated-artifacts; no missing-artifact precondition was skipped.

Lean's baseline has 16,697 agreements, 3,173 unsupported cases and 130 mismatches:
3 E_RULE/NOT_FOUND, 25 prelude, 67 next and 35 continuation. All oracle counts
and signatures exactly match RULES4's independently reproduced `4ef9f77fb3`
control. This is a baseline limitation, not a green Lean equivalence claim.

## Wasm and delivery

Clean locked Linux measurement at `61060eeeb1`, recorded in `bbf8dfaae4`:
**2,372,829 B raw / 723,275 B gzip / 545,364 B Brotli**. Strict family and
absence audits pass; dirty=false, over=0. Budget **723,775 B = gzip + exactly
500 B**, reason recorded in wasm-budget.json/JOURNAL. Whole artifact versus
0.4.30: +392 B raw/+115 B gzip; no runtime ceiling increase or independent
feature attribution. Brotli quality 11 uses Node zlib because the CLI is absent.

Durable evidence index: `snapback4/reports/20261017-integration15/README.md`.
Raw lane reports, final commands, source/artifact digests, JSON results and
compressed raw logs are retained there; scratch apps/packs remain reviewable.

No requested check is deferred. Full scripts/test.sh, push/publication and the
live workstream are intentionally excluded as instructed. Ordinary test ignores
and platform skips retain their reasons. No credentials were copied; no other
worktree was modified; target/publication and publication worktrees were not touched.
