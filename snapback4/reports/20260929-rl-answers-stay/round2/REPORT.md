# Lane RL, round 2 — pending changes and offline ephemeral answers

Branch: `sb4-intent/rl-answers-stay`. First fetched and merged `origin/main`;
merge commit `125723c11` preserves both sides of the append-only journal
conflict. It includes the landed MT/BP/SQ work. Parent commits and toolchain
are in [environment.json](environment.json). No push or publication.

Read both prior prompts/reports and the round 2 prompt. Applied `llp-orient`;
[CONTEXT.md](CONTEXT.md) records the governing constraints. Read Astra's full
round 1 review. Grok's review was still progress notes at the initial check. Read its complete
NOT READY review when it finished; its disposition is below.

## Changes and detecting evidence

| Finding | Resolution | Coverage |
| --- | --- | --- |
| High: locally runnable watch lacks a bound after notification | Every affected watch records the reported cut, retires remembered answers and starts its existing episode. keep:false withdraws immediately. | Real process/wasm `item` and server-classified `mixed`, readable/throwing old replica, all three keep policies, failed sync and later successful sync. |
| Related baseline gap: successful old replica clears the bound | Preserve the pending cut through old reads and withdrawal. Published sync clears the local eligibility floor. A whole server answer at/after the cut can replace earlier; a composed answer cannot qualify its older local fields. | Same cases, plus server replies below/at the cut while sync is held and a later old-replica read after the server replacement. |
| Medium: already-offline ephemeral recovery publishes loading | Carry transport classification into `failed(true)` unless a held read/prediction separately blocks recovery. | Actual offline query and ensuing watch rerun, identity/confirmation/deadline checks, original four-second expiry; explicit loading and denial remain replacements. Existing epoch/incarnation tests pass. |
| Schedule model parks the notification path | Add a notification-before-sync schedule and plain offline ephemeral schedule to every seed. | 300 seeds per host; deletion of `answers.changed(watch, cut)` and removal of ephemeral classification both fail the expanded model. |

No public type/flag, interpreter change, new ordering domain or budget change.
The pending cut is watch-local and uses the existing store sequence. Existing
commit revision, watch version and remembered-answer ticket fences remain.
The replica floor stays until sync even after a qualifying server replacement,
so a later plain local read cannot restore older rows. Normal immediate applied
replacements still produce no loading render. Row deadlines, incarnation/reset
boundaries and explicit unavailable results keep their original meaning.

The client guide, README, operations manual and LLP 3000.023 §10 describe the
same rule. Presence sampling remains the documented quiet-refresh exception;
this work does not claim that all retained quiet failures change freshness.

## Grok review disposition

- High: same durable-notification/failed-sync gap as Astra. Fixed for locally
  runnable and server-classified watches, including readable old replicas.
- Model observations: strengthened the independent reference to reject a
  transient empty answer while the fixture permits the row, and to require
  the sign-out denial instead of accepting loading. A negative reference test
  demonstrates both checks; the strengthened run passes 300/300 on each host.
- Medium, disjoint commits/receipts: **not adopted**. Round 1's binding prompt
  requires the bound on local commits and acknowledged online receipts unless
  an existing proof shows a commit cannot revoke the answer. This round adds
  no such proof. `operationTables` is static program/rule dependency traversal;
  treating it as a complete mutation-effect/non-revocation proof would change
  that commissioned policy. Bounds remain conservative across watches. A slow
  unrelated profile replacement following a commit can therefore still reach
  loading; this report does not claim otherwise. The suggested relaxation is
  recorded as a policy difference, not claimed fixed or approved by Grok.

## Focused and schedule results

- Final round 2 regressions: **33/33** (`review-tests-final.log`).
- Expanded affected run: **409/409** (`affected.log`), including round 0 React
  route/history traces, all round 1 review cases, ephemeral routing/epochs,
  expiry, remembered-answer ordering, presence and resets. The final focused
  run adds all keep policies to the notification cases.
- Same final behavioral tests against saved round 1 dist: **22 fail / 10 pass**
  out of 32 (`review-tests-before-final.log`). The new internal-helper unit is
  excluded from this comparison. Passing cases pin existing behavior; see
  [FAILURES.md](FAILURES.md) for every failed title and attribution.
- Final publication follow-up: **77/77** (`publication-final.log`), covering
  all 33 round 2 cases plus delivery approval/publication. The cut check now
  runs before the publication callback so an ineligible body cannot collect
  delivery metadata. This last placement adjustment happened during the full
  script; these scoped tests ran afterward.
- Full-run corrections: lifecycle **57/57** and delivery await classification
  **1/1** (`lifecycle-final.log`, `await-classification-final.log`). Both failures
  were ours: an obsolete pre-sync ordering assertion and a missed classification
  entry. No production change was needed for these two corrections.
- Whole guide: **98 passed, 0 failed** (`guide.log`).
- Package build/typecheck and reference validation pass; reference output:
  `ref-check: ok — 523 LLP docs, 9862 refs in 28982 files, 0 errors, 0 unchecked`.
- Logs preserve output text with trailing whitespace and extra terminal blank
  lines removed. `git diff --check` passes. `local.ts` remains at the 1,500-line cap.

| Schedule host | Seeds | Failed seeds |
| --- | ---: | ---: |
| process | 300 | 0 |
| wasm | 300 | 0 |

Final strengthened-reference records: `oracle-grok-qualified.log`,
`oracle-grok-qualified-process.json` and `oracle-grok-qualified-wasm.json`:
300/300 per host plus the negative reference test, all passing. Earlier
`oracle-qualified-*` records also pass 300/300 per host. The full script
independently ran those 300 seeds per host again before the extra Grok reference
assertions, both with zero failed seeds. Each seed retains the original mixed/commit,
clock-denial, offline-freshness and sign-out schedules, and adds an independent
client replay in which the notification arrives while the replica remains old.
The schedule varies old completion order, readable/throwing replica recovery
and event-loop turns, fails sync, checks the original bound, then successfully
applies the change. Its reference authority advances from injected fixture
evidence before SDK notification, never from the SDK's emitted null/denial.
The ephemeral reference uses the injected reply's four-second lifetime and
independently fixed confirmation time. Every notification is checked.

Deletion mutation: remove only `answers.changed(watch, cut)` in a copied round 2
SDK. **2/3 seeds fail per host**, with old rows reappearing after notification
and failed sync. The third seed independently withdraws on its injected replica
exception. Ephemeral mutation: remove only its transport classification;
**3/3 seeds fail per host**, before the fixture's row expiry. See the respective
`mutant-final-change-call-*` and `mutant-final-ephemeral-*` records. No mutation touched
working sources. Model limits remain LV's native-plugin/cutless variants;
existing ordering suites continue to cover their own cases.

Test shutdowns overlap in batches of at most eight after synchronous client
close has fenced callbacks; evaluation histories themselves remain sequential.
This avoids serially paying the existing one-second failed-follow sleep per
seed, without changing SDK timers, seed count or model timeout.

The first 300-seed run passed process but hit a missing wasm file during the
full suite's rebuild. That was my run overlap; the later complete 600-seed run
above replaces it as qualification. The failed run remains in the ledger.

## Full script

Ran `scripts/test.sh` **exactly once**, exit 1. Exact summary:

```text
== 1 failure(s) in 1363 s
   client tests
```

Client stage: **4,732 tests; 4,720 passed; 2 failed; 10 skipped; 0 cancelled**.
Both failures are **ours**, corrected afterward in scoped runs: the lifecycle
assertion and delivery await-classification entry listed above and in
[FAILURES.md](FAILURES.md). **0 baseline and 0 environmental failures** in the
full run. Its separate final model stage passed **79/79**. Every other script
stage passed, including Rust tests, fixture wrappers, builds/typechecks, guide,
docs budget, release guard and the canonical wasm budget.

The full script's red result is retained. It was not rerun; this is not a claim
that the final tree passed the whole script together. The new source checks
and the test corrections have their scoped passing records. The existing
60-second target is still missed; no budget or timeout was raised.

## Wasm

Canonical full-script build: **2,040,529 B raw; 592,975 B gzip**. Cap:
**593,719 B**, leaving **744 B**. Measurement uses the build script's exact
`gzip -9 -c <artifact>` command; [wasm.json](wasm.json) records the result.
SHA-256: `3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.

## Reproduction

From `snapback4/`:

```sh
bun run --cwd packages/snapback4 build
node --test packages/snapback4/test/answers-stay-round2.test.mjs
RL_ORACLE_OUT=reports/20260929-rl-answers-stay/round2/oracle-qualified node --test packages/snapback4/test/mixed-evidence-oracle.test.mjs
cargo test -p snapback4-lang --test guide
bash scripts/test.sh
```

Run the standalone schedules after the wasm build completes, not during the
full script's wasm rebuild. `RL_TEST_SDK` and `RL_ORACLE_SDK` select the copied
dist for before/mutation runs. Commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
