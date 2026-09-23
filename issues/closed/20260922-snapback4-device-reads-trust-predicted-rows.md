# Snapback 4: device reads trust predicted rows that the writer cannot read

**Status:** Resolved — 2026-09-23 (see Resolution)
**Owner:** the Snapback 4 0.3 program lead (Claude Opus 5.5). A decision and a shared correction are required before 0.3.0 is published.
**Date:** 2026-09-22
**Scope:** `snapback4-core` device read path (`engine/read.rs`, around line 243: every row in a synced table is trusted), and device prediction.
**Source:** Astra xhigh's review of lane F3b (the declared timeline on devices), under LLP 3000 decision 4's partition review focus.

## What happens

Device reads assume every row a device holds in a synced table was delivered
by the server, and so is readable by the device's principal. Predicted rows
break that assumption. A mutation whose insert rule admits a row that its
writer cannot read is still predicted locally. Until settlement, the row is
visible to that writer's point reads, scans and merges, and the page is
marked complete. An example is a report row that only moderators can read.

Astra reproduced it for the declared timeline. Alice's predicted post wrote
Bob's private inbox copy into Alice's store, and Alice's reads of Bob's
inbox returned it. The feeds recipe's device witness has the same exposure,
because it expects the follower's copy to be predicted.

## Resolution so far

F3b stops predicting foreign private owned rows: the predictor never writes
a row its principal's read rule denies (lane F3b, fix round 1).

## Open

- Decide the general fix. Either:
  - (a) the device applies read rules to provisional rows; or
  - (b) prediction never writes a row that the writing principal cannot
    read.

  (b) matches what a device can know. (a) costs a rule evaluation on
  every provisional row a read touches.
- Census the existing cards, recipes and templates for insert rules that
  admit unreadable rows.

## Ownership (2026-09-22)

An independent Astra review of the 0.3 program asked for a named owner and a
shared correction: this is a provisional-versus-delivered provenance problem,
not a timeline special case. The 0.3 program lead owns it. It will be
resolved in the integration milestone, before 0.3.0 is published, with one
provenance rule on the device read path or the predictor, shared by every
table, and tests on both stores.

## Resolution — 2026-09-23

Resolved by READAUTH, landed as `590fe6f64`, `001dd0be8` and `7877454ff`.
Devices authorize provisional rows at read time, using raw witnesses and
three-way verdicts: readable, denied or unknown. That is one provenance rule
on the device read path, shared by every table, with tests on both stores.
EDGES (`340676bed`, rounds 1–3) closed READAUTH's remaining edge cases.
Published in `snapback4@0.3.0` (source `1a8165ae4`).
