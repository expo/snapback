**READY WITH CHANGES — two P2 admission defects remain.** The round-1 findings are fixed, but the reader audit is incomplete.

1. **P2: Reading the scope counter can still drop a valid write.**
   [Dependency detection](/home/ccheever/sb4-intent/review-ry-r2-astra/snapback4/crates/snapback4-core/src/engine/sequences.rs:121) requires the counter’s owning row to be provisional. Pending sends leave the confirmed scope row unchanged.

   Reproduction: insert a message, then read its conversation and `require c.lastOrdinal > 0 else NEED_COUNTER`. Both memory and SQLite return terminal `NEED_COUNTER`, leaving no outbox entry; the server accepts the mutation with counter 1. A separate follow-up after a pending send fails identically, leaving only the send queued. Counter reads need to observe pending sends in that receipt family/group. [Four reproductions](/tmp/ry-r2-astra-zq5346kq/snapback4/crates/snapback4-lang/tests/declarative_receipts/review.rs:96).

2. **P2: Aggregate maintenance consumes provisional receipt fields without tracking the dependency.**
   The new observer runs when reading an aggregate, but [maintenance itself](/home/ccheever/sb4-intent/review-ry-r2-astra/snapback4/crates/snapback4-core/src/engine/maintains.rs:49) evaluates its predicate, key and contribution without recording that dependency.

   Reproduction with full acquisition: give messages a score defaulting to `9007199254740991`, and maintain `sum messages of .score where .recipients = 0 by .conversation`. The first offline send predicts; the second is terminally refused with `AggregateOverflow` (`E_OVERFLOW`) and dropped. Both server sends succeed: their recipient counts are 1, so neither contributes. This reproduces on both stores. Track dependencies during maintenance before a provisional contribution can cause refusal. [Reproductions](/tmp/ry-r2-astra-zq5346kq/snapback4/crates/snapback4-lang/tests/declarative_receipts/review.rs:132).

The concrete checks support the remaining claims:

| Claim | Independent check |
|---|---|
| **Listed rule, final-exists, settlement and aggregate-read fixes** | All eight original Astra reproduction/control tests pass. The added regressions verify deferred outbox custody, reopen and server settlement. |
| **42 witnesses fail on round 1** | Restoring the round-1 engine produced **42 failures and six passing controls**. Every failure was the intended admission assertion. Restoring round 2 passes all **49 dependency tests**, including the compiler control. |
| **Post-suite capture fix** | Removing only its two engine changes produces **four admission failures**. All four pass with the fix restored. |
| **Affected checks and offline UX** | **365 existing affected tests pass**, including receipts **115/115**, guide **107/107**, ordinary send/create/join prediction, and terminal-refusal controls. The eight original review tests also pass. |
| **Suite evidence** | All **1,779 final source hashes** and the documented four-file post-suite delta match. The retained log reports `== 0 failure(s) in 1271 s`. I audited that run; I did not rerun the full suite. |
| **Wasm** | Independent rebuild matches size **and SHA-256**: **2,005,133 B raw / 601,629 B gzip**. The **1,361 B increase (~0.23%)** is proportionate. |

The review checkout is unchanged. Nothing was pushed.
