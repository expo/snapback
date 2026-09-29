# WK round 2 — custody follows the credential and source bytes

Branch: `sb4-intent/wk-supervised-workers`. Started from round 1 `ce50badf6`.
First action fetched and merged origin/main; merge `69e02e475` preserves main's
refusal-log managed shutdown and both appended journal histories. Linux / Node
24.13.1. No push or publication.

All four requested repairs and the completed Grok follow-ups are implemented:

1. Removing a declaration marks its worker as retiring and retains ownership
   until family deletion commits. Failed retirement remains blocked and retries;
   the stopped status is written only after success. On host exit a failed
   deletion remains marked blocked, with its durable marker for startup cleanup.
   Ordinary query, mutation, route and change-poll authentication now share the
   existing service revision fence inside their session snapshot. Manual seats
   keep their ordinary liveness rules.
2. Each named launch/restart validates the whole declaration tree and copies
   opened regular entry/helper files to a private temporary snapshot. Node and
   secret selection both consume that copy. A rejected or missing declaration
   cannot mint a replacement token. Package dependencies stay installed on the
   host; private ancestor scopes preserve Node package lookup and module type.
3. A watchdog exit by signal, including SIGKILL/OOM, makes the supervisor kill
   the retained Node process group before clearing its ownership or replacing it.
   The shutdown wait path performs the same cleanup. Catchable watchdog signals
   (TERM/INT/HUP) initiate its own bounded cleanup, including without a live host.
4. The ledger regression reads PRAGMA values on the actual connection at both
   initialization and completion commits. FULL synchronization, a durable journal
   mode and asynchronous contention handling are pinned. The FULL→OFF mutation
   now fails (SQLite reports 0 rather than 2).

Grok additionally found a newly added declaration forgotten after initial
admission failure. Its name and backoff now remain under supervisor ownership;
repairing Node starts it without another source edit. Ledger-open contention has
a real locked-writer test, which kills Grok's newly identified open-path busy
mutation. Refresh rechecks the family fence after taking the engine guard.
Every review disposition is in `REVIEWS.md`.

Tests against the pre-fix binaries reproduced each defect. A delayed-Node wrapper
also replaces both entry and helper source paths after validation but before
execution: the repaired launch still executes the validated bytes. The removal
witness holds SQLite's writer lock through retirement failure, then separately
checks immediate query refusal and eventual session/marker deletion. Watchdog
SIGKILL checks both the original Node PID and its descendant at replacement.

LLP 3000.009 §5.3, the effects guide and the operations manual record the current
contract. Existing effect identity, ordering, leases, attempts, meter behavior,
provider ambiguity, standalone workers and native jobs are unchanged. Node code
and installed dependencies remain trusted application code. Linux evidence does
not qualify macOS execution or promise exactly-once provider delivery.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Worker regressions, dev/serve supervision, standalone ledger and existing worker HTTP/context suite | **73/73 pass** | `affected-final.log.gz` |
| Final host unit tests (canonical two-thread concurrency) | **203 passed / 0 failed / 4 ignored** | `host-final-canonical.log.gz` |
| Core effect policy, including owner/detached named-versus-manual seat fences | **13/13 pass** | `effect-policy.log.gz` |
| Whole guide | **98/98 pass** | `guide-final.log.gz` |
| Snapshot `.ts` helper, ESM type and local/ancestor package resolution | pass | `package-snapshot.log.gz`, runnable `package-snapshot.mjs` |
| FULL→OFF mutation on a disposable compiled module | killed: **0 pass / 1 fail** | `mutant-durability.log.gz` |
| Ledger-open SQLITE_BUSY mutation on a disposable compiled module | killed: **0 pass / 1 fail** | `mutant-open-busy.log.gz` |
| Reference audit | zero errors / unchecked | `ref-check-final.log.gz` |

Every red control and setup error is attributed in `FAILURES.md`. Source digests
are recorded in `source-digests.json`; the affected sources at the full run's
start are retained separately in `full-start-source-digests.json`.

## Required full suite

Ran `scripts/test.sh` **once**, exit **0**. Exact summary:

```text
== 0 failure(s) in 1400 s
```

Every stage passed. Rust completed in 596 s; clients **4,595 passed / 0 failed /
10 declared skips** in 486 s; final models **79/79 passed** in 304 s. There are
**no full-suite test failures** to attribute to ours, baseline or environment.
The standing 60-second suite target remains a **baseline process-budget miss**
(round 1 already took 1,319 s); no ceiling or timeout was raised.

Grok's completed review arrived after the full run's Rust stage and late in its
client stage. The final watchdog signal handling, new-declaration retries and
refresh recheck were therefore qualified afterward by the **73/73 affected**,
**203/203 host-unit** and **98/98 whole-guide** runs above. The full invocation
was not repeated, and this is not a claim that it tested one atomic snapshot of
all final follow-up changes. The original output is retained in `test-sh.log.gz`.

An extra host-unit invocation outside the full suite hit the process's 1,024
file-descriptor limit at Cargo's default concurrency: three environmental
failures. The unchanged source passed all 203 tests at the suite's canonical
two-thread concurrency. All three names, symptoms and attribution are retained
in `FAILURES.md`; they are not erased by the successful rerun.

## Wasm

Canonical `scripts/build-wasm.sh` within the full run, independently measured
with its same `gzip -9 -c` command: **2,040,529 B raw / 592,975 B gzip**.
Cap **593,719 B gzip**; margin **744 B**. SHA-256:
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
No cap increase. See `wasm.json` and the original full-suite build log.

## Reviews

Astra's full round-1 NOT READY review is retained in `review-astra.md`; its three
findings and surviving durability mutation are addressed above. Grok's completed
READY WITH CHANGES review is retained in `review-grok.md`; every finding and
surviving mutation is addressed in `REVIEWS.md`. Both review files are rechecked
before commit. No independent READY verdict is claimed for this round.
