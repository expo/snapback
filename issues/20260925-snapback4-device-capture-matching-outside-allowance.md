# snapback4: device capture matching runs outside the request allowance

**Status:** Open · **Filed:** 2026-09-25 · **Systems:** `snapback4-core/src/engine/through_read.rs` (`captures_match`), device store · **Source:** merge review of the LLP 3000.015 landing (Grok, 2026-09-25)

## What

After the 0.4.2 + LLP 3000.015 merge, every 0.4.2 authorization-dependent read draws from the request-owned physical allowance except one: the device-only `captures_match` uses `metered_scan`, which does not set `authorizing`, so it does not consume the 8,192-candidate counter, and SQLite's `scan_metered` charges `octet_length` of each held child onto the query meter. One held child larger than the remaining heap returns `E_BOUND` carrying that length instead of `ParentVerdict::Unknown`. The parent fetch and `read_authority` beside it already use the allowance.

## Done when

`captures_match` is routed like `current_children` (`device_work` plus `authorized_scan`), or LLP 3000.015 §2 documents it as a device-meter limit; a paired-world device test shows a held child of any size yields `Unknown`, never a size-bearing `E_BOUND`.
