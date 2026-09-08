# M3 group receipt choreography omits seeded recipient Erin

**Date:** 2026-09-08
**Area:** Clique benchmark instrument
**Source:** Published Snapback2 0.0.19 cold diagnostic run; independent source audit

The frozen starter M3 log adds Bob, Carol and Erin to Alice’s “Weekend Plans”
group (`benchmarks/fixtures/social-messenger/starter-m3.log:2–4`). The brief
requires group receipt state to cover every send-time recipient, except members
subsequently removed or departed (`benchmarks/briefs/social-messenger.md:500–507`).

`benchmarks/tools/social-messenger/choreography/choreography.mjs:1757–1781`
sends as Alice, opens Bob’s and Carol’s conversations, then requires aggregate
`read`. Its browser contexts at lines3069–3108 never include Erin, and the
choreography does not remove her before the assertion. It therefore cannot
establish the final all-recipient read expectation. The earlier delivered
expectation likewise has no evidence that Erin fetched the message.
The calibration app’s `control-lane.mjs:119,135–138` uses only Alice/Bob/Carol
and hides the mismatch.

A read-only independent audit by `/root/invalidation_audit` confirmed the
fixture/choreography contradiction. This is an instrument finding, not an
independent application verdict. The current cold run retains its failed M3
receipt and does not claim a complete M3 pass or weaken receipt semantics.

## Next action

In the next instrument revision, align calibration membership with the
canonical starter fixture and exercise every recipient, holding one unread
until the final expected transition. Preserve the current frozen instrument
and report this wave’s result as limited by the inconsistency.

Related: LLP0201; `benchmarks/runs/2026-09-08-release-cold-headroom/README.md`.
