# Snapback 4: EDGES and FENCE follow-ups before 0.3.0

**Status:** Open — must land before 0.3.0 is published
**Date:** 2026-09-23
**Owner:** the Snapback 4 0.3 program lead
**Source:** Astra xhigh's delta reviews of EDGES (`63dab2a2f7`) and FENCE
(`70d3680ff1`). Both were READY WITH CHANGES and both closed their previous
findings. Both landed before these fixes, to unblock F1a, which needs
FENCE's capability registry.

## EDGES

1. **Splitting authorization charges can predict a mutation the server
   refuses** (`engine/read_auth.rs`, around line 24). The server charges one
   insert-rule probe plus one per point read. After EDGES round 1, the
   device's server-equivalent read-probe reservations moved to the separate
   device allowance, so at 8,192 point reads of a provisional note the
   device predicted (8,193 server probes). **Fix:** keep the
   server-equivalent read-probe reservations on the mutation meter, and
   charge only the additional device authorization work to the separate
   allowance. Add a mixed write-and-read authorization boundary test
   against the server, on both stores.
2. **Provisional witness scans are still unbounded by the allowance**
   (`engine/local.rs`, around line 151; `engine/read.rs`, around line 179).
   `probe_witness` calls `lookup_live(.., false)`, whose expired-sibling loop
   uses an unmetered `tx.scan`; materialization and cursor decoding bypass
   allocation accounting too. The aggregate-witness source loop has the same
   gap. With 9,000 expired witnesses and one live one, prediction
   succeeded. **Fix:** meter witness scanning and allocation during
   prediction authorization, stop at the remaining device allowance, and
   queue unpredicted. Query behavior is unchanged.

## FENCE

3. **Legacy schemas combining recorded attribution and timelines cannot
   reopen** (`schema/capabilities.rs`, around lines 88–96). Before FENCE,
   `main` emitted only `Recorded` markers even when a timeline was also
   declared, and the legacy branch declares only `recorded-attribution`.
   **Fix:** infer the full capability set for pre-FENCE legacy schemas,
   keep strict validation of modern carriers, add a genuine legacy F2+F3
   fixture with reopen coverage, and re-emit one `Capabilities` carrier
   holding both.
