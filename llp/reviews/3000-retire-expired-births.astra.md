**Reviewer family:** GPT (Codex CLI, gpt-6-astra, xhigh)
**Date:** 2026-09-24
**Scope:** retirement at commit end of the rows a program commit inserted already expired (`Runner::retire_expired_births`). This closes `issues/closed/20260923-snapback4-already-expired-grant-names-ids.md`.
**Method:** Blind and read-only, one model family. Each round's brief named the commit range and the previous findings. Each round's report is recorded verbatim below and followed by its disposition. The briefs are not reproduced. The commits named are pre-squash checkpoints. Round 1 began before the lane was rebased onto `8d87df1e0` and finished after it.

# LLP 3000 review — retiring expired births at commit (Astra)

## Round 1 — `origin/main..c5bcc01e9`

Reviewed through `c5bcc01e96df`, against `origin/main` `8d87df1e0514`. Three findings, all source-traced.

1. **Medium — retirement can reject a successful mutation through an artificial aggregate overflow.**  
   [write.rs:230](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/engine/write.rs:230), [maintains.rs:177](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/engine/maintains.rs:177)

   Reproduction: use an expiring source with `maintain totals: sum entries of amount by owner`. Start with one live contribution of `9007199254740991` (`I53_MAX`). At `now = 100`, insert these two expired rows in one mutation:

   | ID | amount | expiry |
   |---|---:|---:|
   | `a` | −1 | 0 |
   | `z` | +1 | 0 |

   The program’s physical total goes `MAX → MAX−1 → MAX`; every write succeeds. Retirement sorts by ID and removes `a` first, attempting `MAX+1`. `apply_aggregate` returns `E_OVERFLOW`, rolling back the mutation. Removing `z` first would succeed, and the final live total is valid either way.

   The device does not execute this additional refusal path. Retirement needs to handle the combined aggregate change without making irrelevant intermediate totals observable as failures.

2. **Medium — the retirement pass is quadratic for expired siblings.**  
   [write.rs:227](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/engine/write.rs:227), [partition.rs:263](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/partition.rs:263)

   Reproduction: extend `EXPIRING` with a mutation inserting **N** already-expired memberships for the same `(group, person)`, using distinct IDs. Run as the system at time 150.

   Each retirement invokes `remove`, whose `replaced` check scans every remaining expired sibling searching for a live replacement. Cleanup therefore examines:

   `N−1 + N−2 + … + 1 = N(N−1)/2`

   For 64 siblings that is 2,016 visits; for 128, 8,128. `PendingEvents` avoids whole-event-buffer scans, but does not fix this loop. The temporary meter neither cuts nor reports these additional visits.

   Insertion already pays separate metered uniqueness scans; that is inherited. The **new retirement pass itself** nevertheless violates the requested linear-cost requirement. Replacement detection needs sharing across retirements of the same audience key.

3. **Low — an admitted raw-schema expiring maintain target causes retirement to refuse its own work.**  
   [write.rs:220](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/engine/write.rs:220), [write.rs:356](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/engine/write.rs:356)

   Reproduction through the Rust schema API: define a count grouped by a required `deadline: time`; give its generated target `expire = deadline` and an index leading with `deadline`. Current schema validation accepts this. Insert a source with `deadline = 0` at time 100.

   Maintenance creates the expired target and records its birth. Retirement selects it, but `remove` calls `refuse_engine_owned`, producing “is a maintained aggregate; write its source rows instead.” Quarry-generated targets have no expiry, so this is confined to raw schemas. Reject this shape at admission or define its retirement behavior explicitly.

For the other requested checks:

- **Birth accounting:** insert, delete/reinsert, expired-row upsert and partition moves preserve the intended birth boundary and pre-birth events.
- **Disclosure:** I found no new dropped revocation or ID leak. Retirement of a replacement beside a pre-commit predecessor retains the owed scope; born siblings retain their shared marker.
- **Program semantics:** returned values and outbox payloads are already captured; later reads already treat these rows as absent. Final-exists probes use logical liveness. Asset release follows ordinary deletion. References do not imply cascades.
- **Maintains:** ordinary counts unwind correctly. Generated targets have no expiry, aggregate cascades are refused, and timeline-mapped sources cannot expire. Signed sums have finding 1.
- **Determinism:** sorted retirement keys and ordered event compaction give deterministic surviving events. Sorting itself is O(N log N).
- **Exemptions:** acceptable for an explicitly program-write-only fix. Existing stored rows and never-live seed/load rows still retain the original later-sweep disclosure; this is not universal remediation.

The single targeted Cargo test was blocked by `.cargo-build-lock` permissions. **I could not authenticate a test binary to HEAD** and did not trust cached binaries. No files changed and no full suite ran.

NOT READY

**Disposition.** All three findings were accepted and fixed in `004a53984`:

- **Finding 1.** `Runner.retiring` defers each aggregate change during retirement. `apply_retired_aggregates` then applies one net change per target row, in key order. The test is `retirement_reaches_no_total_the_commit_never_held`, the reviewer's reproduction.
- **Finding 2.** `Retiring.live_keys` memoizes, per audience key, whether a live row remains. During the removal loop the only changes are removals of expired rows, because aggregate writes are deferred until after `retiring` is cleared. The test is `engine::retire_tests::retiring_expired_siblings_scans_their_key_once`: 200 siblings examine 199 rows, against 19,900 without the memo.
- **Finding 3.** `validate_maintain` refuses `expire` on a maintained target. The test is `a_maintained_table_cannot_expire`.

The author disabled each production hunk in turn. Each named test failed, and the files were restored byte-for-byte.

## Round 2 — delta `c5bcc01e9..004a53984`

No new actionable findings in `004a53984`. The three round-1 fixes hold under source tracing.

- **Memo:** I found no reachable write that invalidates a cached audience key during retirement. Asset release touches only its ledger; attribution capture and rebuilds are outside this loop. Private maintains require non-expiring sources, and aggregate cascades are rejected. Deferred targets—including audience tables—change only after `retiring` is cleared. See [write.rs:235](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/engine/write.rs:235).
- **Aggregates:** Net changes preserve final physical totals. Zero-sum occupancy is evaluated after all removals. I traced `mirror_column`, prepaid-state restoration, `written_tables`, birth withdrawal, and event coalescing without finding a regression. Device prediction never calls retirement. See [maintains.rs:71](/Users/ccheever/lanes/f188/snapback4/crates/snapback4-core/src/engine/maintains.rs:71).
- **Schema compatibility:** Compiler-generated targets have `expire: None`. A read-only scan of 331 JSON files found 600 maintain declarations across 604 schema objects, with no expiring maintained targets. The Rust matches were ordinary tables or deliberate rejection cases.

I also traced mutation, interpreted-job, native-chunk, and Postgres integration, including rollback and Postgres cache invalidation. The overflow fix removes retirement-order overflow; existing range checks on physical totals remain.

Tests were not run because the sandbox cannot write the Cargo build lock. I inspected the three regression tests but did not independently repeat the author’s mutation proof. No files were changed.

READY

**Disposition.** READY; landed.
