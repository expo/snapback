# snapback4: partition delivery scans with an unbounded reader (pre-existing)

**Status:** Open · **Filed:** 2026-09-25 · **Systems:** `snapback4/crates/snapback4-core/src/partition.rs` · **Source:** B2 landing review (Grok, 2026-09-25), noted as not introduced by LLP 3000.015

## What

`partition.rs:552` still calls `Rows::scan` on the store trait with an unbounded reader and then `check_rule`, outside the request-owned physical allowance that the LLP 3000.015 landing threaded through every other authorization-dependent scan (`engine/authorized_scan.rs`). Horizon sync is capped by `last N`, so the exposure is delivery over a large partition whose rule denies most rows: physical work grows with the hidden population, which LLP 3000 §7's bounded-work law forbids elsewhere.

## Done when

Partition delivery draws from the same per-request physical allowance (or a maintenance-side allowance with the same fail-closed behavior), with a paired-world test that a hidden population of 8,192 and 20,000 denied rows costs the same bounded work and produces identical delivery.
