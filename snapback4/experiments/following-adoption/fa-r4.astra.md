All three round-3 findings are fixed. I found no shipping blocker.

- **Sync admission:** `/sync` has its own atomic, bounded 32-permit pool. The regression fills all 32 slots, verifies `/q/home` and `/schema` still serve the predecessor, and rejects a 33rd sync. Authentication precedes the launch wait on file-backed stores; expired or revoked credentials are rejected afterward. I found no other writer-dependent request assigned to the query/discovery pool. Outside adoption, sync remains detached, but its separate admission allocation applies permanently.
- **Sparse sources:** candidate defaults now precede mapped reads in original-card lookup, both edge passes, and slot filling. Event walks already materialize before applying filters and removal flags. Existing values remain intact; optional fields become null, and contextual defaults are not invented. Public-source and owner-write prerequisites remain enforced. The four sparse-image cases pass through CLI check, preflight, construction, attribution, and slots.
- **Aggregate ceiling:** two individually admissible estimates of 3,001,001 correctly refuse their combined 6,002,002 before writes. The new test distinguishes `sum()` from `max()`.

One nonblocking test finding remains:

**Low — the writer-lock recheck lacks an interleaving regression.** [following_atomic_launch.rs:156](/home/ccheever/sb4-intent/review-fa-r4-astra/snapback4/crates/snapback4-lang/tests/following_atomic_launch.rs:156)

The ceiling tests use quiescent sources. A mutation that reuses the unlocked estimates instead of repeating preflight at [activation.rs:111](/home/ccheever/sb4-intent/review-fa-r4-astra/snapback4/crates/snapback4-core/src/store/activation.rs:111) would survive them.

Concrete scenario: 1,000 originals and 4,999 followers estimate exactly 5,000,000 copies. After that estimate, another connection commits one additional follow before activation acquires SQLite’s writer lock. The new total is 5,001,000. Current code correctly refuses; the mutant would proceed.

**Smallest fix:** add a deterministic pause between the two admission points, commit that follow, then assert refusal before candidate writes and unchanged generation, sequence, slots, and owned catalog entries.

The atomic boundary remains sound: construction, slots, births, copies, indexes, sequence, and generation commit together. Crash recovery preserves the predecessor. Launch implements all own retained events plus the newest 1,000 per current follow, without refill. Device adoption discards predecessor images and reacquires. I found no new disclosure path or bypass of deployment permission or the aggregate ceiling.

I ran the requested diff and **29 passing tests** using existing binaries from the implementation checkout at `15234d8ee`: all eight launch tests, all fifteen CLI adoption tests, four HTTP admission/adoption tests, and both device launch-reacquisition tests. I also inspected the recorded unfixed failures and mutation logs; I did not independently revert or mutate source. Both checkouts remain clean.

**Verdict: READY.**