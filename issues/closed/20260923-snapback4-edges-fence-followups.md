# Snapback 4: EDGES and FENCE follow-ups before 0.3.0

**Status:** Resolved — 2026-09-23 (see Resolution)
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

## Update (2026-09-23, 06:58)

The integrated suite on EDGES+FENCE, before landing, also found regressions
that neither lane's affected-test run covered. Both lanes now run a second
fix round that includes the three items above and these regressions:

- **EDGES:** `publication_round7::cleanup_failure_preserves_the_original_apply_and_observe_error`.
- **FENCE:**
  - both device publication tests;
  - `w13g_probe`'s `thousand_lane_merge_loads_boundaries_once`;
  - three orphan-import and adoption client tests.

Neither lane has landed yet. The integrated suite is the gate.

## Resolution — 2026-09-23 (before 0.3.0 was published)

Every item landed before publication:
- Items 1 and 2 (the authorization charge split, and metered witness scans):
  EDGES round 2, `8a60f0eca`.
- Item 3 (legacy F2+F3 schemas reopen): FENCE round 2. The legacy branch
  infers the full capability set, re-emits one `Capabilities` carrier, and
  is covered by a genuine legacy fixture.
- The integrated-suite regressions (publication cleanup, device publication
  store-read counts, w13g's boundary loads, orphan adoption): both second
  rounds.

The EDGES+FENCE landing's integrated suite passed. `snapback4@0.3.0` was
published from `1a8165ae4`, with its complete suite at 0 failures.
