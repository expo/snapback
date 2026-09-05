# snapback2 test wedges at ~98% CPU when seeds populate rule-restricted tables

**Opened:** 2026-08-31 · **Systems:** snapback2 test runner
**Status:** Resolved 2026-09-05 — bounded verification qualified on current Clique-shaped seeds; exact historical seed was not retained.

With seed rows present in rule-restricted tables, `snapback2 test` spun at
~98% CPU for 9+ minutes and had to be killed. Likely the derived battery
re-evaluating rules pathologically. Repro: the Quarry lane's app
(spikes/clique-diagnostic-runs/quarry-lane) + its seed.

## Implementation and reproduction — 2026-09-05

The original seed was not retained alongside the historical Quarry sources,
so the exact nine-minute spin is not claimed as independently reproduced.
On current main (`11e2e6098`), the ordinary chat template spent 26.345 s in
invalidation alone: 142 attempts and 104 physical probes. The fixed harness
witnesses one representative per query/certificate-intersection signature,
retains the physical trace and SSE oracle, limits candidate searches, and
reports missing witnesses as blocked. Rules remain exhaustive within a stated
16,384 row/persona budget; oversized seeds block before probing. Replay now
resets once and compares independent forks of that unchanged seeded store.

The initial regression used a 67-operation, 12-conversation,
122-message chat seed using real template policies, maintained counts, feeds,
and all three named authorization proofs. It passed every derived check with
37 invalidation attempts; debug elapsed was 30.264 s while four integration
tests ran concurrently. All 22 integration tests passed in 35.32 s. A larger
242-message version also passed all semantic checks, but debug elapsed under
shared-machine load was 59–63 s. The integrated production-profile binary completed that 242-message seed in
29.195 s, with every check passing (rules 579 ms, invalidation 14,998 ms,
replay 3,466 ms). The full workspace test suite was running concurrently.
These are diagnostic/regression runs, not the fresh-agent Clique benchmark.

The blocking regression retains all 67 operations and assertions with four
conversations and 32 messages (still more than one page). Extra scopes beyond
the two-scope candidate limit add repeated seeding cost without additional
search coverage; the larger production run above remains the scale evidence.
