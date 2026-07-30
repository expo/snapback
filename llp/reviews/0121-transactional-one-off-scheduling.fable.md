# LLP 0121 review — Fable family


## Round 1 — 2026-07-30

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent
**Effort:** session-inherited
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh non-author subagent context, read-only review of the
working tree at commit 40ca18b9, mutually blind (no llp/reviews/
artifacts for LLPs 0116–0125 read)
**Target SHA-256:** `9dfa1164eafb71f49694e24629b34886f8cf48c4d6216ec48a5d8e6f0c3aa985`
**Instruction SHA-256:** `30c38e1a8f68e1684dc5373f8651842526556e278804dcffad9a78e2d216292e`
**Status:** completed

## 1. Overall assessment

This is a strong research document that meets the stated bar. Its central
corrective move — the gap is not a missing design but a missing
implementation plus two named decisions plus an unowned inspection-surface
question — is accurate against the tree, and the three-property
decomposition of Convex's advantage (transactional enqueue, near-zero
ceremony, ordinary-query inspectability) is a genuine analytic contribution
that exposes exactly which parts CV-9's designated slice answers, conditions,
and leaves open. I spot-checked essentially every load-bearing claim:

- Code facts verified: `claim_due_runs` takes an injected `now_ms`
  (`src/cron.rs:614–625`); the forced tick is served at
  `/_snapback/api/cron/tick` (`src/admin.rs:1998`); `SNAPBACK_CRON_DISABLED`
  is parsed in `src/server.rs:174` and wired as `cronDisabled` in
  `demos/_kit/server-process.mjs:100,228`; no jobs/enqueue machinery exists
  anywhere in `src/` (every `enqueue` hit is subscription-delivery or
  action-host bookkeeping, not durable work).
- LLP 0070 quotes verified verbatim: the enqueue/rollback paragraph
  (0070:91–96), the claim boundary (0070:524–525), the cron-handler
  enqueue sentence (0070:379–380), the public-status projection sentence
  (0070:341–342), the capability ladder (0070:392–398), the 2026-07-30
  revision's first-slice designation and two recorded gaps (0070:8–21,
  540–556), and the pure jitter function (0070:217–224).
- LLP 0028's Accepted status and 2026-07-30 amendment (identity model
  rejects runtime-created entries; whole-blob snapshot outside the mutation
  commit path) verified at 0028:4, 8–14.
- LLP 0115 verified: CV-9 (0115:485–517), OQ2 answered
  (0115:691–693), governing constraint 1 = no evidence regression
  (0115:93–96).
- Diary quotes verified verbatim at 0030:758–759, 776–778, 785–786;
  0031:729–731, 739–742; 0038:167–168, 173–176, 192–193; 0039:27, 176–189.
- Option 3's "receipt that today carries the commit version" is grounded:
  `MutationOutput` carries `version` and `receipt` fields today
  (`packages/snapback-client/index.d.mts:130–137`), and Diary 0039:94–95
  records the commit-version proof in the rerun.

The flaws I found are citation-precision issues (one MATERIAL, several
DETAIL), none of which change any finding, option assessment, or open
question. The option space is complete for the document's front, empirical
questions are named as such, and no decision is smuggled.

## 2. Strengths

- **The corrective framing is verified, not asserted** (§Summary, §What
  Snapback does today). The document's core claim — LLP 0070 already
  specifies the primitive; what is missing is implementation, two decisions,
  and an inspection-surface position — matches 0070's text and the tree
  exactly, including the honest note that 0070's inspection surface
  (admin lane + policy-gated public status, 0070:340–342) has no live-query
  composition.
- **The three-property decomposition** (§How they differ) is the document's
  sharpest output. Mapping each diary's evidence to specific properties
  (0038 → 1+2, 0030 → 3, 0031 → 1+3) and then scoring CV-9's slice against
  them (Finding 5: delivers 1, conditions 2 on a paved default queue,
  leaves 3 undecided) converts a vague "parity gap" into a checkable
  three-part exit condition.
- **Option 2's argument is evidentiary, not procedural** (§Option 2,
  Finding 7). Rather than resting on 0070's claim-boundary rule, it derives
  the concrete failure: sweeper receipts where job receipts belong, per-job
  failures hiding inside successful sweep runs, and app-invented attempt
  state reproducing exactly the hand-built ledger Diary 0030:776–778
  catalogued as Convex's weakness. This is the strongest possible
  pre-empirical justification for the bar.
- **The slot-based vs set-based seam distinction** (§The deterministic test
  seam, Finding 8) is real design analysis not present in LLP 0070: the
  cron donor pattern transplants but does not copy, and
  cascade/quiescence semantics are correctly isolated as the genuinely new
  question, with determinism itself correctly grounded in 0070's pure
  jitter function rather than asserted.
- **Option 3's receipt idea over-delivers** (Finding 10): recording enqueues
  in the mutation's own receipt would make rollback-atomicity inspectable —
  something Convex's bare returned ID does not offer — and it is grounded
  in a receipt surface that actually exists today.
- **Provenance hygiene is deliberate** (§What Convex does, §Confidence):
  general-Convex claims are labeled as product knowledge twice, retention
  windows are explicitly omitted, and cost judgments are marked directional.
- **Decision hygiene is clean** (§Relationship): ownership is restated, the
  unowned inspection-surface question is named as needing an owner, and the
  document's evaluative passages (Option 2 "rightly," Option 5's
  keep-two lean) attribute the underlying positions to already-recorded
  document state (0070 §Relationship to cron; 0115 OQ2 answered) rather
  than minting new ones.

## 3. Concerns

1. **MATERIAL — over-broad diary attribution in the proof-direction
   sentence** (§How they differ: "Meanwhile every diary concedes the proof
   direction to Snapback: the Convex arms could not force a tick or drain
   deterministically"; restated in Finding 1). The colon clause is
   diary-evidenced only for the 0038/0039 rerun arm
   (diaries/0038:173–174: "the acceptance suite still lacked Snapback's
   deterministic force-tick seam"). Diaries 0030 and 0031 record no
   attempt to force a tick against their Convex arms; their concessions
   are of a different kind — the hand-built effect ledger and "preserve
   Snapback's stricter authority and settlement model" (0030:776–778,
   818–819) and "preserve Snapback's stronger settlement vocabulary"
   (0031:796–797) — and 0031's Convex arm explicitly recorded settlement
   behavior as *strong* (0031:739–742), which the document itself quotes
   in §What Convex does. The conclusion ("proof direction concedes to
   Snapback") survives on correctly cited evidence; the stated support
   does not. Resolve by tightening the clause: attribute the force-tick
   absence to the 0038 arm, and characterize the 0030/0031 concessions as
   attempt-state-ledger and settlement-vocabulary concessions.
2. **DETAIL — quote misattributed to Diary 0039** (§What Convex does,
   final sentences: "The same diary also records the Convex arm's
   weakness: its recurring minute job 'still lacked Snapback's
   deterministic force-tick seam.'"). The antecedent of "the same diary"
   is 0039, but both the quote and the "recurring minute job" fact are
   Diary 0038:173–174; Diary 0039 contains neither the phrase nor the
   word "lacked." Resolve by citing Diary 0038.
3. **DETAIL — truncated decisive quote** (§Summary "largely because of
   this one primitive"; §How they differ "Diary 0038's decisive sentence
   is about property 1 and 2 together"). Diary 0038:192–194's actual
   sentence has a second conjunct: "...because `runAfter` is the most
   directly useful scheduler primitive **and the installed TypeScript
   workflow is more mature**." The second conjunct belongs to another
   series front (LLP 0117), and "largely" hedges honestly, but the
   truncation slightly inflates the primitive's decisiveness. Resolve
   with a footnote-level acknowledgment of the second conjunct and a
   cross-reference to 0117.
4. **DETAIL — unlabeled general-Convex claim outside the labeled
   background paragraphs** (§The deterministic test seam: "Convex's
   `runAfter(0)` runs promptly after commit in ordinary dev use"). The
   document's own convention labels general-Convex background in place;
   this behavioral claim in the seam section carries no label and no diary
   citation. Resolve by labeling it as background (or citing a diary
   observation if one exists).
5. **DETAIL — hosted-target scope never stated** (§Option space,
   §Relationship). The document notes cron is "fault-proven across local
   and Cloudflare targets" (Option 5) but takes no position on — and does
   not even scope out — what the one-off primitive means for the hosted
   target, where 0070's own candidate assessment is blocked-on
   (0070:405–482) and the platform timer is lossy. One sentence naming
   hosted one-off work as out of scope for this front (single-process
   slice per CV-9) and a later empirical question would complete the map.

## 4. Suggestions

- Mention-and-dismiss the one genuinely distinct mechanism family not
  named: a non-durable in-process one-off timer (ephemeral scheduling,
  honestly labeled non-durable — the analogue of Convex's best-effort
  action-path scheduling). It plainly fails the diaries' durable bar, so
  one dismissal sentence suffices, but its absence leaves the option space
  formally incomplete.
- Name LLP 0063 Step 6 among the governing interactions: 0070's claim
  boundary cites it ("maintainer acceptance and an executable
  target-specific witness before jobs or webhooks count," 0070:525–526),
  and it constrains when any slice landing may be claimed.
- Open question 4 asks whether receipt-recorded enqueues belong to "the
  result-contract family"; naming LLP 0108 explicitly there would give the
  eventual owner a concrete pointer.
- Finding 5's conditional ("delivers the second only if the default queue
  needs no app-side declaration") could usefully be promoted into CV-9's
  exit criteria via a 0115 note when this document is absorbed — as
  written the exit criteria in 0115:513–517 test properties 1 and the
  seam but not ceremony.

## 5. Open questions

- Did any diary actually observe end-to-end `runAfter(0)` completion
  latency in dev (which would ground concern 4's claim empirically), or
  is interactive latency purely OQ6's empirical question?
- Should the inspection-surface owner decision (the document's open
  question 3) be sequenced before or with the first slice? The document
  shows property 3 is undecided but does not discuss whether shipping the
  slice without it forecloses any of the three candidate shapes.
- Is the hosted-target one-off story a 0070 concern only, or does this
  research front owe a successor note once the single-process slice
  lands?

## 6. Verdict

**READY.**

Judged strictly against the stated bar: the document has exhausted what
pre-empirical analysis can deliver on this front. Its factual base is
verified against the tree and the diaries to an unusually high standard;
the option space is complete for its front (the one unnamed option is
dismissible in a sentence); everything only running code could establish
is named as an empirical question (OQ1, OQ5, OQ6, OQ8); and no decision is
smuggled. The concerns are citation-precision flaws — one MATERIAL, four
DETAIL — that are each resolvable by a sentence-level edit and that change
no finding, no option assessment, and no open question. None rises to
BLOCKING-FOR-BAR.

## 7. Recommended next step

Author applies the five concern fixes (especially concern 1's attribution
tightening) as a v0.2 revision; no substantive re-review is required
beyond a delta check of those edits. Then proceed per LLP 0115's
sequencing: this document is ready to serve as the analysis layer for
CV-9's implementation slice, and its Finding 5 conditional (paved default
queue) and open question 3 (inspection-surface owner) should travel with
the slice ticket.
