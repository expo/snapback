# PRL round 0 context

Scope: the Snapback 4 client lifecycle, specifically online observation scheduling
and positive notifications. Orientation used `skills/llp-orient/SKILL.md` after
initializing the pinned `vendor/llp` submodule; no skill or submodule pin changed.

Governing documents: LLP 3000 (Snapback 4 fence), LLP 2000.000 (replica design),
LLP 3000.023 §§3.4, 10, 11 (withdrawals, retention/queue clocks, one-shot settlement),
Snapback 4 AGENTS/NOT-DOING/JOURNAL and the complete current client guide card.
The round-5 and round-6 PR publication audits were read before implementation.

Constraints: no authorization revision or reset weakening; no saved-answer reuse
across publication/refusal; immediate scope/denial/reset/expiry withdrawal;
eight starts per task and eight in flight; no work for disjoint writes;
bounded online revocation even during capacity wait; local queue-clock pause;
no new read cache, protocol or public contract. The online deadline and initial
PQ zero-loading browser test conflict under enough scheduling delay: improve
service/notification cost rather than changing the deadline.

Bisect: main d959efe2ed, publication d1e6061174, midpoint 11ddefd88c,
pre-PR 267788df36, PR merge 096a1b78ef; then PR midpoint 88dcf7bd86,
round 1 c3c4ed0976, round 0 ab2da069c5 and the exact round-1 parent
c586a5904f. Each runs the unchanged original failing test ten times in an
isolated sparse worktree. The React harness uses source TypeScript through Vite;
the SDK is also rebuilt at each commit for its static native import. The ignored
main wasm artifact is shared only to satisfy that build: the selected online
case does not use a device, server binary or wasm.

The exact breaking commit is c3c4ed0976. It constructs online ObservationWork
with pauseQueue=false and starts reload(changed) at notification receipt. This
is the required online revocation fence, not an accidental reset or shared local
authority revision. Its exact parent passes 10/10; it fails 10/10. A trace on
main reports change-timeout withdrawals while final row work starts at 1276.5 ms.

Doc update: record amortized ready notifications and non-timer browser queue
turns in §10 without changing any authority rule. Hand-off: none.
