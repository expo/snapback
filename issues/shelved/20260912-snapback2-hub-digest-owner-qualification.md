# Complete the 1,000-chat / 500-follow digest owner witness

**Status:** Open
**Priority:** P2
**Owner:** Codex, LLP 1025 qualification follow-up
**Date:** 2026-09-12
**Systems:** Snapback 2 copied Clique test population
**Related:** LLP 1025.000 §7; `benchmarks/runs/2026-09-12-snapback2-1025/`

The recipient-period recipe certifies all 70 production programs at the
500-follow / 1,000-membership envelope. Seven smaller real-owner journeys and
the disk-backed restart/outbox retry witness pass. The actual simultaneous
100-group / 900-DM / 500-follow owner witness has **not run**: startup refused
its setup before the journey began. Do not turn that certificate into a runtime
hub claim, or report the seed refusal as a digest execution failure.

The first literal seed held 15,804 rows and exceeded the unchanged rule-probe
budget (40,500 > 10,240). The final setup moves conversations, membership and
unread custody into a test-only chunked population job. That job is type-correct
and certifies at `first 2`; `first 16` exceeded the step budget. Its remaining
3,904-row static seed still refuses at 41,336,564 heap bytes against 8,388,608,
with repeated cap-500 checks for the follow tables dominating. The exact failed
receipt, seed and helper inputs are retained as benchmark evidence, outside the
runnable correction fixtures. No journey ran and no hub timer result exists.

Continue by putting follow/post population into admitted bounded setup writes,
leaving a small static seed, then execute the existing owner-only assertions:
1,000 live memberships (100 groups, 900 DMs), rejection at membership 1,001,
500 current follows, and one scheduled period receipt containing 1 new follower,
500 followed posts, 1,000 unread messages and 1,000 unread chats. Keep SDK clients
closed at emission. Validate setup invariants and the actual receipt, not just
row counts. Use the existing owner/job and observation surfaces; do not enlarge
seed, transaction or journey limits or add a gate/runner to bypass this refusal.

The qualification attempt was descoped after its bounded fix rounds under
`rules/RULES.md`; production implementation and its narrower passing evidence
are independent of this remaining scale witness.
