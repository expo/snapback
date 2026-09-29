# WK round 5 — coordinate worker cleanup across host restarts

Branch: `sb4-intent/wk-supervised-workers`. Started at round 4 `74757c866b`.
Read every prior prompt/report. The inherited fetch/merge step produced
`22e37b564f`; only the append-only journal conflicted, and both histories remain.
Linux / Node 24.13.1. Nothing pushed or published.

## Changes

Each watchdog inherits the same store ownership flock as its host and retains
it through worker-group cleanup, including the two-second SIGTERM grace after
host SIGKILL. Close-on-exec changes happen only in the forked watchdog, never
in the threaded host; the watchdog restores close-on-exec before launching Node.
Node and its descendants therefore cannot release or extend this ownership.
A replacement dev/serve obtains ownership before opening the store, retiring
old credentials or launching workers. It waits up to five seconds for an
announced host without a reachable loopback listener; a reachable host or an
unannounced CLI owner still refuses immediately. The address is only a wait/refusal
hint; the actual sidecar lock always decides admission. Non-loopback hints are
never dialed. The sidecar must remain in place, as LLP 3000.019 already requires.
Fresh dev stores remain independent.

Grok’s late review is addressed too. Snapshots now live in private 0700 directories
under the project’s .snapback4 runtime directory, so global temporary parents cannot
add package lookup. Schema/project/ancestor package manifests use no-follow
regular-file descriptor copies. Startup removes prior worker-status rows atomically
with old-family retirement; removed declarations cannot keep stale running reports.
Eight new controls fail before repair and pass after it. The existing commit test
now holds its real reader through 110 observed busy COMMITs and detects Grok’s
100-retry-cap mutation, including post-provider cancellation.

The ledger initialization guard was already correct. Its new test observes a
real SQLITE_BUSY while a writer holds BEGIN IMMEDIATE, aborts WorkerLedger.open,
releases the writer and requires AbortError. Removing the open-loop abort check
from a disposable compiled module makes the test fail.

LLP 3000.009 §5.3, the effects guide and operations manual record restart
coordination. The merged baseline's six-card guide census exceeded its word
budget by 12 words; two language-card prose lines now remove duplication while
preserving the recorded Details text and all compiled examples. No ceiling changed.
Effect identity, ordering, attempts, meters, authorization, the busy-COMMIT repair,
credential custody and the provider-call/receipt-commit ambiguity remain unchanged.
No contract.ts or wasm-engine edit. Linux evidence does not qualify macOS or
actual providers.

## Detecting evidence and affected checks

| Check | Result | Evidence |
| --- | --- | --- |
| Immediate SIGKILL/restart under dev and serve, with a SIGTERM-resistant Node worker and helper | Before: both record overlap at replacement startup; after: both pass, old bearer refused and new bearer works | restart-before.log.gz, restart-fixed.log.gz, affected-final.log.gz |
| Node descriptor exclusion | Changing close-on-exec restoration makes both tests fail on an inherited ownership descriptor | node-owner-mutant.log.gz; restored source qualified by affected-final.log.gz |
| Initialization cancellation | Correct guard passes; guard deletion opens after cancellation and fails | open-abort-fixed.log.gz, open-abort-mutant.log.gz |
| Pre-Grok final five-file suite | 117 passed / 0 failed | affected-final.log.gz |
| Grok snapshot, manifest and stale-status controls | Before: 0/8; repaired: 8/8 pass | grok-before.log.gz, grok-fixed.log.gz |
| Extended reader contention/cancellation | 4/4 pass; 100-attempt cap fails both commit variants | contention-extended.log.gz, commit-cap-mutant.log.gz |
| Final five-file suite against an unchanged CLI copy | 125 passed / 0 failed | affected-stable.log.gz, qualified-binary.json |
| Final host unit suite | 204 passed / 0 failed / 4 declared ignores | host-final.log.gz |
| Final server end-to-end suite | 9/9 pass | server-final.log.gz |
| Final route suite after the CLI rebuild ended | 13/13 pass | routes-quiet-final.log.gz |
| Signal cleanup under dev and serve | 1/1 pass | lifecycle-final.log.gz |
| Store ownership unit tests | 9 passed / 0 failed | store-owner.log.gz |
| Final replay and run-admission suites after startup-wait correction | 15 + 27 passed / 0 failed | admission-fixed.log.gz |
| Final whole guide | 99 passed / 0 failed | guide-grok-final.log.gz |
| Final host build | pass | build-grok-fixed.log.gz; lifecycle-final.log.gz |
| Final documentation budget and reference audit | pass | docs-budget-qualified.log.gz, ref-check-record.log.gz |

The tests record overlap inside the replacement process, avoiding a delayed
parent observation that could miss the two-second window. Node descriptor
inspection is Linux-specific. Both replacement credentials and old-credential
refusal are exercised over the real claim wire. The original test assertions
for prompt competing-host/CLI refusal remain unchanged.

## Required full script — one invocation

Ran `scripts/test.sh` from snapback4/ **exactly once**, exit **1**. Exact summary:

```text
== 1 failure(s) in 1379 s
   cargo test
```

The failed stage contains three failed tests, all **ours**:

| Failed test | Cause | Final qualification |
| --- | --- | --- |
| `familiar::every_moved_fact_has_its_why_or_details_home` | Intermediate language-card wording moved a required fact. | Restored its Details home; whole guide 99/99. |
| `competing_starts_preserve_the_live_replay_policy` | Unconditional five-second waiting delayed prompt live-host refusal. | Live listeners again refuse immediately; replay 15/15. |
| `release_token_owns_the_resolved_database_before_sqlite_open` | Waiting behind a token CLI outlasted its SQLite deadline. | Unannounced CLI owners again refuse immediately; run-admission 27/27. |

Every other full-script stage passed. Clients: **4,830 total / 4,820 passed /
0 failed / 10 declared skips / 0 cancelled**. Final models: **79/79 pass**.
**Zero baseline or environmental full-script test failures** are assigned.
The inherited 60-second process budget remains missed; no budget or timeout
ceiling was raised. See test-summary.json and the retained original log.

The final extra five-file run passed **125/125**, using a byte-identical private
copy of the CLI after a concurrent Cargo relink disrupted two earlier follow-up
checks. The route file then passed 13/13 unchanged; server end-to-end passed 9/9.
These setup failures and the limits of their attribution remain in FAILURES.md.

The Rust stage captured an intermediate guide edit and the initial unconditional
startup wait. The resulting three failures are ours and repaired; final whole-guide,
replay/run-admission and affected-worker checks above qualify the corrections.
Grok’s completed review arrived during the client phase, so its final source has
separate qualification above; no full-run claim is extended to that follow-up.
The full invocation is not repeated or relabeled as an atomic test of final source.
Full-start and final source hashes are retained separately. Every failed control,
editorial attempt and setup error is listed in [FAILURES.md](FAILURES.md).

## Wasm

Canonical full-script build, independently measured using gzip -9 -c:
**2,040,529 B raw / 592,975 B gzip**. Cap **593,719 B gzip**; margin **744 B**.
SHA-256: `3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
See wasm.json. No cap increase.

## Reviews and retained limits

Astra's complete round-4 NOT READY review is saved as review-astra.md. Both
requested findings have detecting controls and are addressed above. Grok was
checked at the start and throughout. Its completed **READY WITH CHANGES** review
arrived during the full client phase and is saved as review-grok.md. Its Medium,
two Low findings and surviving retry-cap mutation are addressed with detecting
controls above. Both input hashes were rechecked before commit and match review-inputs.json.
No independent READY verdict for round 5 is claimed.

The known Low process-group-ID reuse concern remains open in
[its existing ticket](../../../../issues/20260929-snapback4-watchdog-fallback-group-identity.md).
It is not fixed or covered by a forced-ID-reuse test. Doctor still reports its
last recorded state. One append-only journal entry and a local commit with
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>` accompany this report.
