# LLP 0125 review — Fable family


## Round 1 — 2026-07-30

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent
**Effort:** session-inherited
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh non-author subagent context, read-only review of the
working tree at commit 40ca18b9, mutually blind (no llp/reviews/
artifacts for LLPs 0116–0125 read)
**Target SHA-256:** `9161587d13febe4f5e156a32c438c810fa44ad2a43ea9d223230fb5d0cff2942`
**Instruction SHA-256:** `30c38e1a8f68e1684dc5373f8651842526556e278804dcffad9a78e2d216292e`
**Status:** completed

## 1. Overall assessment

This is a strong research document whose code-facing claims are essentially
flawless and whose analysis genuinely exhausts the pre-empirical space on
its front. Every load-bearing claim about current-main Snapback code that I
spot-checked verified exactly: the retry-eligibility predicate
(`packages/snapback-client/index.mjs` `#isEffectFreeReservationStale`,
~line 3498 — exact closed detail-key set, `effectMayHaveCommitted` guard),
the 40-attempt / 20–80 ms defaults and config names (lines 309–311,
1514–1515), authority/carrier-generation pinning (lines 4917–4945), the
bounded 256-entry diagnostic ring and both accessors, the
`handler_envelope_code` closed allowlist with its `MADE_UP_BY_HANDLER` test
(`src/runtime.rs:3149–3191`, 3554) and the thrown message surviving only as
`details.message` (runtime.rs:2551–2561), the `captured_conflict` detail
payload including `retryPolicy: "reject"` versus the explicit-`readSet`
path's dependency-only details (`src/storage.rs:10609–10620` vs
10449–10462), the mutation route's receipt-carrying error envelope
(`src/server.rs:17575`, `ApiError::with_receipt` at 17638) versus the
action route's HTTP-200 `FunctionResponse<FunctionRunResult>`
(server.rs:17655; `src/local.rs:1372–1397`), the wide 409 family
(server.rs:21220+), and the `convex` 1.42.3 pin. The two-lane conflict
model, the remediation description, and the guide's taught contract are all
accurate.

Where the document falls short of the stated bar — "no flaws" — is
citation and attribution accuracy in its evidence chain. The most
significant: the sentence presenting Diary 0039 as "the strongest evidence
the fix held" attributes to that rerun a check ("Campfire's pagination
under a concurrent insert") that does not exist in Diaries 0039 or 0034 —
it is a Diary 0028 chat-arm fact — and frames the rerun as passing
"concurrency checks" when the string "concurren" appears zero times in
Diary 0039 and the named Relay/Split items are single-actor atomicity
proofs. The conclusion survives on the corrected evidence (40/40 across
seven arms, zero conflict-shaped pain in the fifteen prioritized items),
but the document's own load-bearing correction is presented with a false
example and an overstated category. Around it sit several smaller
misattributions (the codes-authoritative rule assigned to LLP 0094 when
its text lives in LLP 0092; the LLP 0066 decomposition's fourth concern;
the Swift mutation-only citation; "scored as a real defect" for a diary
that says "the server behavior was correct"). All are one-line fixes; none
requires structural rework.

## 2. Strengths (cite sections)

- **Correction-first honesty (Summary, §What the 2026-07-28 remediation
  fixed).** Opening with "the retry half of that complaint was fixed and
  the fix has held" — against the document's own family's earlier
  complaints — is exactly the right posture, and the remediation
  description is code-verified down to the detail-key closure and the
  cross-user replay hazard history (confirmed in
  `demos/backend-bakeoff/reports/remediation-1-report.md`).
- **Provenance discipline (§What Convex does).** The general-background /
  diary-evidence split is explicit, the pinned version (1.42.3) is real,
  and the Confidence section re-states the cutoff caveat. The two closing
  caveats (silent-retry evidence gap; SpacetimeDB as the anti-pattern) show
  genuine even-handedness.
- **Fine-grained code accuracy (§The two-lane conflict model).** The
  captured-path vs explicit-`readSet` `retryPolicy` asymmetry is a subtle,
  true fact (storage.rs:10449–10462 vs 10609–10620) correctly credited to
  LLP 0066's audit (0066:228–231).
- **Evidence-preservation reasoning (§Option space, options 1 and 4).**
  Option 1 keeps precise codes in the receipt layer while collapsing only
  the taught contract; option 4's "retries visible in receipts, invisible
  in application code" is a real differentiated position against Convex's
  silent retry. Both respect LLP 0115's no-evidence-regression constraint
  explicitly.
- **Empirical honesty (§Burst-path performance, Findings 6, Confidence,
  OQ5).** Declaring current-main burst behavior *unknown*, refusing both
  the comfortable "remediation fixed it" reading and the alarmist 20.9 s
  reading, and naming the profiling question, is the document at its best.
- **Preference-signal analysis (§How they differ).** The
  mechanical-vs-semantic visibility split is a genuinely discriminating
  reading of the diaries, and the Diary 0029 quote supporting it is exact
  (0029:51–54).
- **Ownership mapping (§Relationship).** The owner-by-owner confirmation
  list is nearly all correct (LLP 0059 Accepted with the exact never-rerun
  sentence at 0059:733–735 and the 2026-07-26 contention revision; 0003
  Draft with the E3 decision and the "retry the deterministic handler
  against fresh state" text at 0003:349–351; 0094's action-output family
  marked open at 0094:729; 0043; 0070 Draft).

## 3. Concerns

- **C1 — BLOCKING-FOR-BAR. Diary 0039 evidence mischaracterized in the
  load-bearing "fix held" chain.** (Summary ¶2; §What the 2026-07-28
  remediation fixed, final paragraph; Finding 1.) Three specific defects:
  (a) "Campfire's pagination under a concurrent insert" is not in Diary
  0039 or 0034 — 0034:157–164 enumerates six Campfire checks, none
  involving a concurrent insert; the concurrent-insert pagination fact is
  Diary 0028's chat arm (0028:510, frozen-commit era). (b) "passed every
  concurrency check" / "concurrency checks": the string "concurren" occurs
  zero times in Diary 0039; the rerun's checks are correctness/authoring/
  realtime checks. (c) The named Relay and Split items are single-actor
  atomicity/rollback proofs, not contention exercises — so the rerun
  exercised little genuine two-actor contention, and the honest form of
  the evidence is: 40/40 across seven arms, zero conflict-/retry-shaped
  entries among the fifteen prioritized pain items (grep-confirmed), with
  the rerun's own scope note excluding load/latency (0039:67–70). That
  corrected form still supports "the fix held" as absence-of-regression
  evidence, but the current text asserts a check that never ran.
  *Resolves:* re-cite the Campfire example to Diary 0028, drop or reframe
  "concurrency checks," and state the absence-of-contention-exercise
  caveat explicitly.
- **C2 — MATERIAL. Codes-authoritative rule misattributed to LLP 0094.**
  (§The 409 taxonomy as a whole: "codes authoritative and statuses
  advisory (LLP 0094's rule)".) LLP 0094 contains no such statement — its
  §0E refusal-code registry is a plain table. The rule's text lives in
  LLP 0092 (`llp/0092-rqs-manifest-bundle-and-channel-a-contract.spec.md:361`:
  "HTTP status mapping (codes are authoritative; statuses advisory)"). In
  a document whose stated function includes confirming owners, assigning a
  governing rule to the wrong spec matters for where option 1's work would
  land. *Resolves:* attribute to 0092, or note the rule as one 0094 should
  adopt (and flag that as a gap).
- **C3 — MATERIAL. LLP 0066 decomposition misquoted.** (Option 4:
  "eligibility / schedule / evidence / idempotency".) 0066:239–245 names
  the four concerns as failure eligibility, retry schedule, delivery
  evidence, and **terminal settlement**; idempotency is 0066's separate F3
  topic. The substitution also creates redundancy with option 4's
  separately listed LLP 0043 `clientMutationId` piece and drops the
  settlement concern the option actually needs. *Resolves:* correct the
  fourth term and re-derive option 4's parts list.
- **C4 — DETAIL. "Scored as a real defect" overstates Diary 0030.**
  (§What Convex does, closing caveat.) The diary says "The server behavior
  was correct" and the SpacetimeDB arm passed 14/14; the generic
  `InternalError` is recorded as a DX complaint and a lesson (0030:300–303,
  341–350), not a scored defect. The cautionary point stands; the scoring
  claim does not.
- **C5 — DETAIL. Swift mutation-only replay cited to the wrong file.**
  (§remediation bullets.) `guide/clients/swift.md` (read in full) says
  only that the client "retries only HTTP 409 SNAPBACK_AUTH_RESERVATION_
  STALE" — it never says mutation-only. The fact is true and lives in
  `demos/backend-bakeoff/reports/remediation-1-report.md:88` and
  `clients/swift/.../ClientBehaviorTests.swift:1321`.
- **C6 — DETAIL. The 20.9 s Linux run's framing asserts more than the
  diary records.** (§Burst-path performance: "*after* the remediation,
  with no application loop".) Diary 0028's Linux entry (0028:875–922)
  states neither a commit nor loop status; post-remediation status is a
  well-supported inference (dated after, and its 14 PASS / 1 GAP / 0 FAIL
  matches the remediation result, not the original 13/1/1), and "no
  application loop" is unstated. Mark the inference as such — the document
  is otherwise scrupulous about exactly this distinction.
- **C7 — DETAIL. "With no application concurrency code" is not in the
  cited Convex passage.** (§What Convex does, second diary bullet.) Diary
  0027:319–322 records the convergence and the 0..24 permutation but not
  that clause; the nearest support lives in other arms/diaries.
- **C8 — DETAIL. Dispatch's union is a completion union, not a
  rejections-as-data demonstration.** (§(b) capacity paragraph: "which is
  what Dispatch's typed completion union demonstrates".) The actual union
  is `{completed: false} | {completed: true, id, trigger}` (Diary
  0038:84–88); no `{status: "rejected", reason: …}` shape exists anywhere
  in `diaries/`, and LLP 0108 never mentions Dispatch (the reference runs
  diary→0108). Option 2's narrower phrasing — the machinery "proves the
  projection pipeline works" — is the supportable one; align the earlier
  paragraph with it.
- **C9 — DETAIL. CV-9 glossed as "LLP 0070's attempt policy".**
  (§Relationship.) CV-9 is "Transactional one-off scheduling
  (`runAfter`-class)" (0115:158, 485); attempt policy is one cited feature
  of its owner LLP 0070, not CV-9's subject.
- **C10 — DETAIL. Finding 7 omits LLP 0115's own acknowledgment.** "No CV
  item covers…" is verified true (all fifteen CV titles checked), but
  0115 v0.4's Open Question 6 (0115:711–717) already names exactly this
  unowned remainder — failure-shape unification, domain-typed rejections,
  current-main burst measurement — citing LLP 0125. "Covers ground the
  parity plan does not currently schedule" understates the plan-side
  coordination that already exists; cite OQ6.
- **C11 — DETAIL. The guide quote supporting option 3 is stretched.**
  "The action error remains a structured diagnostic envelope"
  (`guide/backend/actions-and-fetch.md:160–164`) governs authoring posture
  (throw rather than launder failure into fake success); in context it
  says nothing about the route's 200-`{ok:false}` transport shape, so it
  is weaker support for "the guide's stated intent" behind the envelope
  migration than presented.
- **C12 — DETAIL. Related header incomplete.** Diary 0029 and Diary 0034
  are load-bearing citations (the preference-signal quote; the
  sequence-scan gap) and absent from **Related**, as are LLPs 0017, 0093,
  0095, and 0117, all leaned on in the body (and 0092 if C2 is fixed).

## 4. Suggestions (non-blocking)

- Add one sentence stating *why* there is no "server absorbs staleness
  without rerunning the handler" option: staleness is detected at
  pre-durable-commit revalidation, after the handler ran
  (`src/server.rs:2029–2040`, @ref LLP 0059#plan-begin-commit-finalize),
  so any server-side absorption necessarily is LLP 0003's deterministic
  re-execution — already named in option 4/OQ4. This closes the reader's
  natural "sixth option" question.
- Name-and-dismiss the merge/last-write-wins lane explicitly, using the
  Diary 0029 evidence already quoted — it makes the option space visibly
  closed rather than implicitly so.
- Consider one line on optimistic client updates (a Convex client
  feature adjacent to conflict rollback ergonomics) as
  named-out-of-front, since the front is otherwise diary-anchored.
- SB-008's actual ledger title is "deterministic ordered append and stable
  cursor paving"; the "contention-safe sequence allocation" gloss is
  Diary 0034's wording. Worth one clause so the ledger pointer is exact.
- Pre-empirical arithmetic available without running code: the default
  budget (40 attempts × 20–80 ms uniform jitter) bounds worst-case
  client-side retry residence near ~4 s, which is the same order as the
  pre-remediation 4.9 s burst median — worth naming as a hypothesis input
  to OQ5's attribution question.
- Label "option 2 is the highest product-value item" explicitly as the
  author's assessment feeding 0115 sequencing (it is overt, not smuggled,
  but the sequencing call belongs to 0115).

## 5. Open questions

- Does the Convex side of Diary 0039 carry any conflict-adjacent check
  that would ground the Summary's "both backends" phrasing once
  "concurrency check" is reworded?
- Should the codes-authoritative/statuses-advisory rule be *adopted* into
  LLP 0094 (making the attribution prospectively right), or does it stay
  0092's? A question for the wire-contract owners, surfaced by C2.
- Can reservation *contention* (the 2026-07-26 LLP 0059 revision) ever
  surface at acquisition time, before the handler runs? The emission
  sites found this session are commit-time revalidation, but the
  acquisition path was not exhaustively traced; if a pre-handler
  contention refusal exists, a bounded server-side acquisition wait would
  be a genuinely distinct sub-option the document should name.

## 6. Verdict

**NOT READY** — strictly against the stated bar. The analysis itself
meets the bar: the option space is complete (my one candidate missing
option dissolves against the commit-time-revalidation fact), empirical
questions are named as empirical, no decision is smuggled, and the
code-level claims are uniformly accurate. What fails "no flaws in this"
is the evidence chain's citation accuracy: one false example inside the
document's central "the fix has held" sentence (C1) plus a cluster of
misattributions (C2–C9). All are surgical fixes; none threatens the
document's conclusions. This is one careful revision away from READY.

## 7. Recommended next step

A single citation-repair revision pass addressing C1–C3 (required) and
C4–C12 (cheap, do them in the same pass), with no structural changes:
re-cite the Diary 0039 evidence in its absence-of-regression form, fix
the 0092/0094 attribution, correct the 0066 decomposition, and true up
the remaining citations and the Related header. On re-review, a
delta-scoped check of those edits should suffice; no full re-read
warranted.
