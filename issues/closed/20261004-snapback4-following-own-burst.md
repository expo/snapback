# Following own-write burst: calibration #30 queried the follower

**Status:** Closed — own-write defect not reproduced; reader attribution corrected
**Date:** 2026-10-04
**Scope:** Snapback 4 Following, calibration #30 Grok bundle, grader d-01
**Resolution:** FC regression and LLP 3000.016 own-event publication clarification

The supplied trace describes 25 settled posts, an immediate Following answer
with only 1–2 of them and an early burst member first, then convergence around
three seconds later. The executable reproduction `grading/dbg3.mjs` writes
through `A` (Alice) and calls `sweepHome(B)` (Bob), `sweepGlobal(B)` and a new
Bob client. It never queries Alice's own Following answer. Its terminal write
receipts do not assert completion of foreign delivery. The fresh Bob client is
opened after the three-second and fifteen-second waits, so it is not a
simultaneous control demonstrating stale answers on the original client.

FC reproduced the distinction on eb1000 using npm's actual 0.4.12 client,
Linux binary and wasm artifact, and current-main baseline `1c18847b79`:

- Three unpaced bursts of 25 settled writes per client tier, with the author's
  shaped `home` paginated immediately after the final receipt, pass on online,
  process and wasm clients on both revisions. Every burst has all 25 events in
  descending `(at,eventId)` order. No sleep, sync, drain or other query intervenes.
- A second test checks the author's count and order after each of 25 individual
  settlements; all three tiers pass on both revisions.
- Changing only the first own read to Bob in the published online test fails
  with **3/25**, all from the beginning of the burst, ordered newest first
  within the delivered subset. This is an intentionally failing reader control,
  not an own-write regression on the published package.
- The engine regression holds **all** background delivery: the author still
  sees all 25 across two pages, including equal-time events inserted in reverse
  id order; Bob's complete page remains empty until delivery runs.

`timeline_deliver` synchronously copies the event to its actor with a null edge
epoch, then enqueues foreign delivery. This mechanism predates 0.4.12: commit
`e3355db795` (2026-09-24) introduced durable chunked delivery while retaining
immediate own copies; `18c402220d` added the explicit edge epoch. LU merge
`848b645294` and its subsequent rounds improve pending-item service, not own
copy creation. There is **no newly identified fixing commit** for an own-write
defect, and no runtime change is justified. The regression would reject the
reported truncated answer if it came from the author, but passes the real
published release. Making it red there would require asserting a stronger
foreign-delivery contract than the guide supplies.

Follower observations are separate from that regression. On the minimal
one-follower fixture, three samples per tier measured time from the final
receipt through observing all 25 (including preceding own/global reads and
10 ms polling):

| Revision | Online | Process | Wasm |
| --- | ---: | ---: | ---: |
| Published 0.4.12 | 15.9–50.6 ms | 21.4–52.5 ms | 26.1–62.8 ms |
| Main baseline | 87.6–146.1 ms | 58.8–143.7 ms | 34.8–554.3 ms |

These are shared-host sample ranges, not tail percentiles or a production
comparison: the published binary is optimized and main uses the ordinary
debug build. Initial follower coverage ranged from 18–25/25 on the published
samples and 4–25/25 on main. The supplied 1–2/25 and three-second duration are
not reproduced exactly by this minimal, differently loaded fixture. Neither
revision promises zero-delay foreign delivery. This change leaves the runtime
unchanged; final validation and repeated main samples are in the lane report.

The distinct throughput issue remains open at
[Following replay backlog](../20261002-snapback4-following-replay-delivery-backlog.md).
Do not close that issue or redefine `complete`/`fresh` from this investigation.
Source slots, floors, publication fences and LLP 3000.023 withdrawal semantics
are unchanged. See [LLP 3000.016](../../llp/3000.016-following-on-a-bounded-device.rfc.md#own-event-publication).

Reproduction: `packages/snapback4/test/following-own-writes.test.mjs` and
`crates/snapback4-lang/tests/following_view.rs` under `snapback4/`.
Local retained evidence: `~/sb5-lanes/fc-artifacts/` (published package metadata
and hashes, `published-tests.log`, `grader-reader-control.log`, `main-before.log`,
affected checks and full suite); final operator report: `~/sb5-lanes/fc.report.md`.
