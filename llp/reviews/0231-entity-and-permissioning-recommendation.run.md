# LLP 0230 + 0231 — super-refine run journal

**Targets (lockstep cluster):**
- `llp/0231-entity-and-permissioning-recommendation.rfc.md` — **primary**
- `llp/0230-data-layer-authorization-prior-art.research.md`

**Invoked:** 2026-08-11 by the author (Charlie Cheever), "push just the two new
LLPs now then do an /llp-super-refine".
**Orchestrator/reviser:** Claude Opus 5 (this session).
**Round budget:** 3 per document (skill default) · **Launch cap:** 6 per family
per target.

## Topology

**One lockstep cluster, not two independent loops.** 0231 cites 0230 throughout
and 0230's §Summary defers the recommendation to 0231; they share `Systems:` and
were written in one pass. Reviewing them separately would let a reviewer accept
a claim in one that the other contradicts.

Per the skill's cluster rule, reviewers see both documents, each review is
preserved verbatim **once** in the primary target's artifact
(`0231-*.<family>.md`), and every review carries **per-target verdict sections**
plus a set-level verdict.

## Authorization and disclosure

- **Document authority:** the author invoked the loop directly on these targets.
  The `Author:` line on both reads "Charlie Cheever / Claude (Opus 5)", matching
  the invoking user.
- **Status transition applied before launch:** `Draft → Review` on both — the one
  transition this skill is authorized to make.
- **Pre-transition hashes:**
  - 0230 `sha256 5503bfb6ad3f0a291a6aeee431bde9f1c71aea2d73ac16534dfbb758a9b9c681`
  - 0231 `sha256 9c6a4d34686d16aed7d0b54ffa658a4ad9d69179ee691ec3c07662570f6235fa`
- **Post-transition hashes — the round-1 entering revision:**
  - 0230 `sha256 2b910b243d1f6ba73deecdc57c58ec299702a5f5a6301e3635dc56e836ea64a8`
  - 0231 `sha256 1ce122fb4448f46b4c2afd5c787672d632c551396ac6b9eff07ed8d57f0b4c64`
- **Outbound disclosure:** each capsule instructs the reviewer to read both
  targets in full plus, at its discretion, the LLPs and source files they cite —
  LLP 0011, 0053, 0056, 0170, 0172, 0173, `demos/*/snapback/functions.mjs`,
  `packages/snapback-codegen/define.mjs`, and `diaries/0031`, `diaries/0074`. No
  credentials or secrets are in scope. Destinations: **Anthropic** (claude
  family, fresh subagent in this local checkout) and **OpenAI** (gpt-5 family,
  local `codex exec`, sandbox read-only, in this same checkout).

## ⚠ Blindness is instruction-based, not structural

Both reviewers run inside this same repository checkout with filesystem read
access. There is no `git archive` export excluding `llp/reviews/023*`. Each is
explicitly instructed not to read `llp/reviews/0230-*`, `llp/reviews/0231-*`, or
this journal. That is **self-attested instruction-based blindness** (LLP 0010
§2), disclosed here per the invariant.

Neither reviewing session authored these documents: the claude reviewer is a
fresh subagent with no prior context, and `codex exec` is a fresh process. The
orchestrator wrote both targets and therefore **does not review** — it only
revises between rounds, per the reviser-never-reviews-its-own-edit invariant.

## Prior-context disclosure specific to this run

The orchestrator gathered the evidence in 0231 §Evidence itself (the card-game
finding, the query counts, the counter-evidence census). A reviewer that
re-derives those counts and disagrees should be believed over the document;
they are single-source and unreplicated. This is flagged in both capsules as a
priority check rather than left for the reviewer to notice.

## Round 1

- **Entering revision:** hashes above.
- **Entering status:** Review (transition applied pre-launch).
- **Reviewers:** claude family = fresh Opus 5 subagent, no prior context;
  gpt-5 family = local `codex exec -m gpt-5.6-sol` at `xhigh` reasoning effort,
  sandbox read-only.
- **Lens:** none declared (standard review).
- **Known asymmetry:** the gpt-5 family was unavailable for every earlier refine
  attempt this session (codex was unauthenticated until 2026-08-11). This is the
  first genuine dual-family round in this session.

Round record persisted; launching.

### Round 1 — results

**gpt-5 family: delivered.** Verdicts NOT READY / NOT READY / NOT READY, bound
to the round-1 entering revision. Body preserved verbatim in
`0231-entity-and-permissioning-recommendation.gpt-5.md`. Seven MATERIAL
findings, including recounts that contradict 0231 §Evidence.

**claude family: launch failed.** The subagent went idle three times without
producing a review and did not respond to two direct requests for its output.
No partial text was received, so there is nothing to record verbatim. Per the
skill's invariant, a failed response is recorded as failed and **never counted**;
nothing is fabricated or reconstructed.

**Round 1 therefore did not converge and is not a completed dual-family round.**
One family reviewed; the other did not run. Launch 2 of 6 for the claude family
follows, against the **same** entering revision so both verdicts bind to one
hash vector.

**Orchestrator note on the gpt-5 findings.** Before relaunching, the
orchestrator independently re-derived the disputed census rather than accepting
either its own original numbers or the reviewer's. Result: the reviewer is
correct. `demos/*/snapback/functions.mjs` at this revision has 96 `define*Query`
call sites (0231 said "~90"), 9 textual `membership:` properties, and 31 raw
`authUserId()` occurrences — of which **13 are comparison form** (`eq('userId',
authUserId())`, a read filter) and **9 are write payloads** (`hostId:
authUserId()`, stamping an owner on insert). 0231's "3–4×" ratio conflated the
two categories. The corrected comparison is roughly 13 read-filter uses against
10 membership-gated queries.

This correction is recorded here rather than applied to the target, because
revision is pending the author's decision on whether to revise now or read the
review first.

### Round 1 — terminal state

**Claude-family launch 2 also failed.** The relaunched subagent idled twice
without producing a review and did not answer a direct request. Six subagent
launches in this session have now failed the same way, across three different
task types, which indicates an environment-level delivery failure rather than
anything about the prompt. No partial text was received from either launch.

**Terminal condition reached: a specified reviewer family is unavailable.** The
skill's invariant is that this *stops the loop* and never substitutes silently.
The orchestrator wrote both targets and is therefore barred from reviewing them
itself, so no in-session substitution is legitimate. This escalates to the
author.

**Round 1 final state — single family, no convergence:**

| family | outcome |
| --- | --- |
| gpt-5 | delivered; NOT READY on 0231, 0230, and the set |
| claude | unavailable; 2 launches, no output, nothing recorded |

The single verdict set binds to revision
`0231 sha256 1ce122fb…` / `0230 sha256 2b910b24…`. **No dual-READY convergence
was reached and none is claimed.**

### Orchestrator verification of the delivered review

Two of its findings were re-derived independently rather than accepted:

1. **The census correction holds.** 96 `define*Query` call sites; 31 raw
   `authUserId()` of which 13 are comparison form (read filters) and 9 are write
   payloads. 0231's "3–4×" conflated read scoping with write-side owner
   stamping. Corrected comparison ≈ 13 read filters against 10 membership-gated
   queries.
2. **The pointing-room refutation holds, and it is the material one.**
   `demos/pointing-room/snapback/functions.mjs:69` reads
   `value: round.revealed || vote.userId === ctx.auth.userId ? vote.value : null`.
   That boundary is field-level (the row is always returned; only `value` is
   masked), disjunctive, and cross-table. No row predicate can express it, so
   D3 cannot accept this query and D2 would force it to declare `public()` —
   leaving the handler as the real boundary, which is the situation 0231 exists
   to end. 0231 cites this demo as supporting evidence; it is a counter-example
   to the proposed mechanism.

### Recommendation to the author

0231 needs a **redesign of D3**, not an editing pass. Field-level masking is
common (hidden votes, hidden hands, redacted columns), so the expressiveness cap
fails on ordinary workloads rather than exotic ones. Pointing-room should become
the worked test case any replacement mechanism must satisfy before the RFC
advances.

Proposed next step for the author to choose: **revert both documents to `Draft`**
(the errors are in evidence and in a core mechanism, so `Review` overstates
their maturity), or leave at `Review` with the findings recorded and revise in
place. This skill does not apply either transition without the author.
