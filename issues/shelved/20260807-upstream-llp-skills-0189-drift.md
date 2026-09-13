# Upstream llp skills encode pre-0189 exact-SHA review/verify binding

**Status:** Open
**Opened:** 2026-08-07
**Systems:** LLP governance, Tooling
**Related:** LLP 0189, vendor/llp (github.com/ccheever/llp),
`llp/0189-verification-cadence-and-claim-gating.decision.md`

LLP 0189 D-5 rules that reviews bind content, not HEAD, and D-2 bars re-gate
loops triggered solely by base advance. Three clauses in the vendored
upstream skills still encode the older binding (found in the 2026-08-07
alignment sweep):

1. `vendor/llp/skills/llp-ship/SKILL.md` — VERIFIED/REVIEWED verdicts bind
   "exactly that SHA" and "any new commit re-enters gating"; a REVIEWED
   verdict should survive a normal merge of newer base, with only genuinely
   new conflict-resolution (including semantic integration) re-entering.
2. `vendor/llp/skills/llp-ship/SKILL.md` — delivery "moved → reintegrate and
   re-gate" re-gates on base movement alone rather than on content change
   from integration.
3. `vendor/llp/skills/llp-super-refine/SKILL.md` — the cross-consistency
   pass loops "until the hash vector passes a round unchanged", which
   unrelated doc churn can restart; the void/extra-round trigger should be
   scoped to semantically relevant deltas.

These are upstream files (do not patch the submodule in-repo). Action: file
the three items against github.com/ccheever/llp, referencing LLP 0189's
D-2/D-5 text and the 2026-08-06 landing-discipline precedent
(`issues/shelved/20260803-0163-public-operation-identity-carrier.md`); pull the fix
via the normal `scripts/sync-agent-skills` update path. Until then,
orchestrating sessions in this repo follow LLP 0189/AGENTS.md over the
vendored clauses where they conflict (repo policy outranks vendored skill
prose here).
