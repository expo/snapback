# LLP 0129 super-refine review — Codex family

Loop: `/llp-super-refine` on LLP 0129, opened 2026-08-01 by the author.
Target document status at loop start: **Accepted** — this loop cannot
advance it; it exists to make the document correct.

## Round 1 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** OpenAI Codex CLI `codex-cli 0.146.0` (banner:
"OpenAI Codex v0.146.0"), model `gpt-5.6-sol`, provider `openai`,
non-interactive `codex exec`, sandbox `read-only`, approval `never`
**Effort:** `model_reasoning_effort="ultra"`
**Session ID:** `019fbcae-64c3-7ef2-a0e0-32752872b342`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-resumed session; read the working tree at commit
`a9286aba` plus the uncommitted 2026-08-01 revision of the target;
blind to this loop's Fable artifact and to the prior, already-closed
`0115-0129-lockstep.*` artifacts (the instruction capsule barred both)
**Target:** `llp/0129-local-first-program.plan.md`
**Target SHA-256:** `0bbc11efcb0fa0994bbc0d4791b14751a48def6bd118973e69237e2ab805ecca`
**Instruction capsule SHA-256:** `5698b78a576c15327758e6bdf9d9629b0b02fbdc1a8e0c436798ba3390a36713`
**Status:** completed
**Verdict:** NOT READY

**Orchestrator note (outside the verbatim body).** The orchestrating
session for this loop is Claude Opus 5, not Claude Fable 5 Max as the
`llp-super-refine` runtime contract pins. The reviewer-independence
invariants are intact — the orchestrating/editing session is neither
reviewer, and it belongs to neither reviewer family. Recorded here
rather than silently.

**Concurrency note (reviewer's own, §1 scope note).** The reviewer
observed `llp/0138-...` and `issues/20260801-fleet-burst-mutation-not-visible.md`
changing under it mid-review (other fleet sessions edit this worktree
live) and pinned its reading to the hash-matched snapshots it was
given. Recorded as received.

### Review (verbatim as received)

## 1. Overall assessment

This is a strong strategic direction: pre-register the decision experiment, test the least-powerful mechanism first, require real crash/restart evidence, and preserve the author’s exclusive Option-C authority. The larger Plan remains disciplined about staged evidence, explicit nonclaims, and owning-document boundaries.

Plainly, the new section’s body-level characterization of the bakeoff is **supported in substance, with needed precision**:

- Latency Kanban duplicated one move transformation between the server handler and React reducer ([Diary 0043:88](/Users/ccheever/projects/snapback/diaries/0043-latency-kanban-zero-bakeoff.diary.md:88), [handler:66](/Users/ccheever/projects/snapback/demos/zero-bakeoff/apps/latency-kanban/snapback/functions.mjs:66), [React:6](/Users/ccheever/projects/snapback/demos/zero-bakeoff/apps/latency-kanban/snapback/src/App.tsx:6)).
- Contention Calendar’s server-minted branded ID forced an honest component-local pending sidecar ([Diary 0044:32](/Users/ccheever/projects/snapback/diaries/0044-contention-calendar-zero-bakeoff.diary.md:32), [App.tsx:8](/Users/ccheever/projects/snapback/demos/zero-bakeoff/apps/contention-calendar/snapback/src/App.tsx:8)).
- Field Notebook preserved queued intent but deliberately did not reconstruct speculative UI after restart and exposed no semantic three-way conflict surface ([Diary 0046:41](/Users/ccheever/projects/snapback/diaries/0046-field-notebook-zero-bakeoff.diary.md:41), [acceptance:133](/Users/ccheever/projects/snapback/demos/zero-bakeoff/apps/field-notebook/acceptance/snapback.mjs:133)).

Those are credible pressures warranting a lab. They are not evidence that the IR rung itself has failed, and the restart finding was a declared capability/API GAP rather than standards-real-browser failure evidence. The Revised header’s stronger claim that the recorded trigger was already detected is therefore unsupported.

The protocol does not pre-commit the author: outcomes are recommendations only ([LLP 0129:547](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:547)), and the admission reservation at [LLP 0129:744](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:744) matches ER-1 ([LLP 0130:88](/Users/ccheever/projects/snapback/llp/0130-program-standing-decisions.decision.md:88)). Nevertheless, several material correctness, ownership, and experimental-design defects remain.

Scope note: I verified both supplied hashes at the beginning. LLP 0138 and the Fleet ticket changed concurrently during review; this review uses the originally supplied, hash-matched `c64185…` LLP 0138 snapshot and the evidence tree as initially observed. LLP 0129 remained at the requested `0bbc11…` hash.

## 2. Strengths

- **Conservative evidence posture.** The body correctly says the bakeoff evidence starts the lab rather than choosing its result ([LLP 0129:528–536](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:528)).

- **Least-authority escalation.** A precedes B, B precedes C, safety beats brevity or latency, and mixed evidence defaults to the less-powerful surface ([LLP 0129:547–570](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:547), [715–742](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:715)).

- **The new carrier matrix repairs the bakeoff’s largest evidence limitation.** It requires standards-real IndexedDB, browser-process termination, full-resync-before-replay, identity changes, lost acknowledgements, revocation, and independent-observer convergence ([LLP 0129:636–655](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:636)).

- **Good anti-laundering discipline.** The decision lab must freeze its own manifests and may not weaken a check because one candidate cannot pass it ([LLP 0129:572–600](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:572)).

- **Useful measurement separation.** Input-to-paint, server result, and observer convergence remain separate; source duplication, assistance, resource custody, crash recovery, and diagnostics are recorded independently ([LLP 0129:686–708](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:686)).

- **Most Phase 0 tree facts are real.** The three named commits exist and are ancestors of `a9286aba`; the acceptance starts the actual server, is registered in the workout inventory, and its retained report records 9/9 ([report:2](/Users/ccheever/projects/snapback/demos/public-dashboard/offline-acceptance-report.json:2)). The problem is carrier and claim scope, not fabricated execution.

## 3. Concerns

### 1. MATERIAL — The Revised header falsely says the recorded trigger fired

**Evidence:** The header says the bakeoff “detected the recorded expressiveness trigger” ([LLP 0129:8–10](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:8)). The body instead says it found pressure sufficient only to run the lab ([531–536](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:531)), and formally defines trigger detection as Candidate A failing a frozen fact ([717–727](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:717)). The governing trigger is specifically that “the IR rung proves insufficient … after measurement” ([LLP 0115:1442–1447](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:1442), [LLP 0130:88–91](/Users/ccheever/projects/snapback/llp/0130-program-standing-decisions.decision.md:88)). Phase 0 expressly had no local execution, while Candidate A remains Phase 1 work ([LLP 0129:261–295](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:261)).

**Resolution criterion:** Change the header to say the bakeoff detected precursor pressure sufficient to commission the lab. Reserve “recorded trigger detected” for a retained Candidate-A failure. If the author intends the bakeoff itself to fire the trigger, amend the recorded 0115/0130 decision explicitly.

### 2. MATERIAL — Phase 0’s browser/React/IndexedDB capability claims exceed its acceptance

**Evidence:** The Plan names the chosen carrier the “JS/React browser arm” and marks its diary-grade evidence gate cleared ([LLP 0129:220–245](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:220), [272–275](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:272)). The named acceptance is actually a Node/file-store test: it imports `node:fs`, `node:os`, and `node:path`, forces `SNAPBACK_CLIENT_RQS_DIR`, and asserts `implementation === 'file'` ([acceptance:23](/Users/ccheever/projects/snapback/demos/public-dashboard/tests/acceptance/offline-local-first.mjs:23), [52](/Users/ccheever/projects/snapback/demos/public-dashboard/tests/acceptance/offline-local-first.mjs:52), [109](/Users/ccheever/projects/snapback/demos/public-dashboard/tests/acceptance/offline-local-first.mjs:109)). It never exercises React or standards-real IndexedDB.

The same suite tests two public queries, not protected/auth-scoped refusal ([functions.mjs:17](/Users/ccheever/projects/snapback/demos/public-dashboard/snapback/functions.mjs:17), [32](/Users/ccheever/projects/snapback/demos/public-dashboard/snapback/functions.mjs:32)). Nevertheless, the Plan and guide claim browser IndexedDB and protected/auth-scoped refusal ([LLP 0129:256–260](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:256), [capabilities:60](/Users/ccheever/projects/snapback/guide/capabilities.md:60), [offline guide:34–46](/Users/ccheever/projects/snapback/guide/sync/offline-and-retention.md:34)). The final acceptance check’s name mentions memory fallback and no-`Parity`, but its body tests only explicit opt-out and the environment kill switch ([acceptance:294–311](/Users/ccheever/projects/snapback/demos/public-dashboard/tests/acceptance/offline-local-first.mjs:294)).

This violates the Plan’s own “claims equal acceptance” rule ([LLP 0129:464–467](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:464)).

**Resolution criterion:** Either add a standards-real browser acceptance using the React surface and durable IndexedDB across browser-process restart, plus protected refusal and degradation/claim checks, or narrow the Phase 0 gate and guide claims to the proven headless-JS/Node-file/public-query slice and retain explicit browser/React/IndexedDB GAPs.

### 3. MATERIAL — The lab may fail to discriminate the motivating Calendar gap, and Candidate C’s matrix is contradictory

**Evidence:** Calendar requires provisional rendering and reconciliation ([LLP 0129:584–589](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:584)), but trigger detection disqualifies only treating sidecar state “as query-store truth” ([717–725](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:717)). The existing workaround is explicitly honest presentation state, not query-store truth ([Diary 0044:32–38](/Users/ccheever/projects/snapback/diaries/0044-contention-calendar-zero-bakeoff.diary.md:32)). Candidate A could therefore retain the exact motivating sidecar and still plausibly reach Outcome 1.

Separately, Candidate C is implemented only for workloads still inexpressible after B ([625–630](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:625)), but Outcome 3 requires C to pass all gates on all three workloads ([729–739](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:729)).

**Resolution criterion:** Freeze an explicit Calendar composability fact—e.g. provisional items must participate in the same typed query-derived ordering/filter/count lifecycle without an application-owned parallel collection—or explicitly decide that honest sidecars are acceptable. Also choose and state either a complete three-workload C implementation or a selective blocked-workload evaluation with a separately defined common safety suite.

### 4. MATERIAL — The section crosses its own owning-document boundary

**Evidence:** Constraint 7 says substantive design belongs in owning Specs/RFCs, never this Plan ([LLP 0129:205–208](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:205)). The new section nevertheless defines public B extension classes, C’s local-store/rebase powers, normative conflict/identity/revocation rules, and says an “exact candidate and contract” will be recorded by amending this section ([555–567](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:555), [612–684](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:612), [744–754](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:744)).

Existing owners already control this territory:

- LLP 0133 owns settlement lanes, divergence, and identity ([LLP 0133:94–123](/Users/ccheever/projects/snapback/llp/0133-local-settlement.spec.md:94)) and already specifies lane-L canonical-ID reconciliation through an ID map ([423–499](/Users/ccheever/projects/snapback/llp/0133-local-settlement.spec.md:423)).
- LLP 0051 deliberately keeps application reducers first-class ([LLP 0051:761–784](/Users/ccheever/projects/snapback/llp/0051-language-neutral-data-tier.rfc.md:761)).
- LLP 0008 pins field-level LWW/delete-wins as the v1 default ([LLP 0008:372–386](/Users/ccheever/projects/snapback/llp/0008-local-first-sync-and-realtime.rfc.md:372)), whereas the new safety gate appears to require per-operation declaration.
- LLP 0053 owns the distinctions among deletion, retirement, and quarantine under different authority-loss events.

**Resolution criterion:** Keep the experiment’s workloads, evidence gates, recommendation algorithm, and author disposition in LLP 0129. Put the implementation protocol in a separately owned Plan/Research document, and require every shippable B/C mechanism to land through the relevant owner or a new Spec. A later 0129 amendment should record evidence and the author’s disposition, not own the exact product contract. Add LLP 0133 to `Related`.

### 5. MATERIAL — The lab has no coherent place in sequencing or completion

**Evidence:** Existing text says Option C is not a phase and “This Plan schedules nothing for it” ([LLP 0129:331–338](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:331)); the new section conditionally instructs implementation of Candidate C and assigns builder rules ([625–630](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:625), [710–713](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:710)). The lab is absent from the program-completion boundary ([478–494](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:478)), has no owner or timebox, and depends on the Phase 1 evaluator plus still-unlanded ledger designs. SD-5 advances only the named phase gates ([LLP 0130:74–77](/Users/ccheever/projects/snapback/llp/0130-program-standing-decisions.decision.md:74)).

**Resolution criterion:** Define the lab as a named workstream/phase or move it to its own Plan; state whether its disposition gates Phase 2a or program completion; name its owner, timebox, and start prerequisites. Explicitly distinguish a non-shipping Candidate-C prototype from an admitted product implementation.

### 6. MATERIAL — “Every safety gate” conflicts with permitting protected evidence to be unavailable

**Evidence:** The protocol allows the protected-browser case to remain unavailable ([LLP 0129:653–655](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:653)), says every candidate must pass every gate ([660–661](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:660)), then qualifies Outcome 3’s protected-revocation requirement with “where admitted” ([733–734](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:733)). As written, an unavailable gate is neither a pass nor a well-scoped admission boundary.

LLP 0126 also says Option C lacks the same-code pin and is honest only below `Parity`, as Online-plus-speculation ([LLP 0126:942–960](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:942)); the new section leaves claim vocabulary open.

**Resolution criterion:** Either wait for the protected JS-arm capability and test it, or make any recommendation expressly authority-independent/public-only, use an explicit PASS/N/A matrix, retain protected data as a hard nonclaim, and require a later owned admission/conformance gate before widening. Pin Candidate C as never earning `Parity` merely from this experiment.

### 7. DETAIL — Several precision and state records are stale

**Evidence and resolution criteria:**

- OQ4 still says who observes and where admission is recorded are open ([LLP 0129:816–823](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:816)), although the new decision-artifact section answers both. Mark that residue resolved while preserving ER-1.
- Exit criterion 2 still says arm-scoped rows do not exist ([446–452](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:446)); `guide/capabilities.md` now has the JS-arm shipped and protected-GAP rows, although `auth.authorized-leases` remains arm-agnostic. Rewrite the criterion to describe the current partial structure and the exact missing closure.
- `Related` omits LLP 0133 even though row 1 and the new trusted-input gate depend on it. Add it.
- The Phase 0 status names two ticketed remainders, while the ticket also records unbounded per-origin default-store blob accumulation ([issue:33–38](/Users/ccheever/projects/snapback/issues/20260731-js-arm-lease-custody-and-sessions-outbox.md:33)). Record that remainder or its resolution.
- Replace “ordinary optimistic updates” with “Kanban’s move,” and split the Notebook wording into speculative restart reconstruction versus typed semantic conflict. Those are the exact facts the evidence establishes.
- Clarify Candidate A’s “same deterministic host-answer ledger”: under LLP 0133 lane L, local answers are recorded as claims and the server re-derives them, rather than consuming the same values.

## 4. Suggestions

- Make every safety gate a machine-readable row mapping candidate, workload, check IDs, required artifacts, PASS/GAP/FAIL/N/A semantics, and claim consequence.
- Have the author or named product authority approve the frozen “must-have” facts before implementation; otherwise workload selection can silently force the recommendation.
- Clarify the builder design. “Two independent builders” conflicts with assigning one person only to review. Either require two genuinely independent first attempts or say “builder plus independent reviewer.”
- Treat seven-sample nearest-rank p95 as exploratory—it is simply the maximum—or retain more samples before making comparative performance claims.
- Reconcile the supplied snapshot’s Fleet regression before treating atomicity/idempotence as broadly passed, or carry it as an explicit nonclaim outside the three-workload lab.
- Change “the least powerful outcome … wins” to “is the program’s recommendation; only the author may adopt or reject it.”

## 5. Open questions

1. Who approves that a frozen fact is genuinely must-have product behavior rather than merely an experiment-selected discriminator?
2. Is an honest application-local pending sidecar acceptable, or must provisional creates compose inside the normal typed query view?
3. Does the lab implement Phase 1’s evaluator, run as part of Phase 1 acceptance, or begin only after Phase 1 and its owner-ledger prerequisites land?
4. Does completing this newly commissioned lab gate Phase 2a or overall program completion?
5. Must Candidate C implement all three workloads, or only B’s residual gaps?
6. What exact public/protected scope may be recommended before JS-arm lease custody exists?
7. Does Candidate C require a new settlement lane or an LLP 0133 amendment, and what claim class is permanently available to it?
8. Are B’s provisional identity and conflict mechanisms extensions of existing LLP 0133/0051/0008 designs, or genuinely new product surfaces?

## 6. Readiness verdict

NOT READY

The proposal’s direction is good, the body-level bakeoff pressure claim is substantially supported, and ER-1 remains intact. But the premature trigger claim, Phase 0 claim/acceptance mismatch, under-discriminating experiment, contradictory Candidate-C matrix, missing sequencing/ownership, and unavailable safety gate are unresolved material correctness and decision-quality concerns.
## Round 2 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** OpenAI Codex CLI `codex-cli 0.146.0`, model
`gpt-5.6-sol`, provider `openai`, non-interactive `codex exec`, sandbox
`read-only`, approval `never`
**Effort:** `model_reasoning_effort="ultra"`
**Session ID:** `019fbcd6-8e0b-74a2-904e-a3c0c8bbc675`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-resumed session; barred from `llp/reviews/`
**Target:** `llp/0129-local-first-program.plan.md`
**Target SHA-256:** `ea33e2e80433a42fd98f7849f48b0d0c587d8d509d45561c247400e014d2bd0d`
**Instruction capsule SHA-256:** `4653d1f07945f30fe31b1409fa6c01d0ce34fd6fd55bdf0d272e3a7bbc347f9e`
**Status:** completed
**Verdict:** NOT READY

**Attempt note (LLP 0005 honesty).** A first round-2 Codex session
(`019fbcae`-era retry, launched against the same target hash) was killed
by the harness before producing any output. Per the skill's failure
rule that attempt is **not** counted and **not** recorded as a review;
the session above is a fresh retry against the identical, unchanged
target snapshot.

**Orchestrator verification (outside the verbatim body).** Decisive
claims checked against the tree before acting:

- **Blocking 2 CONFIRMED.** `llp/0043-offline-replay-retention.rfc.md`
  pins "**no local execution means no local-first/parity claim** … The
  shipped composition may therefore report `Parity` only for a
  store-configured surface whose complete mutation set is locally
  IR-derivable. Retention or queue [support alone stays `Online`]."
  Phase 0 has no local execution by its own status text, so its
  "carry the retention/replay `Parity` claims" wording is wrong on its
  face. The `shipped` vs `partial` half is the same defect Fable
  raised independently as its C2.
- **Blocking 4 CONFIRMED.** `llp/0053-authorization-invalidation.rfc.md`
  explicitly separates session revocation from authorization events —
  "**Not on this list, and deliberately so: session revocation.**
  Logout, session expiry, and admin *session* revocation are
  **authority transitions**, not authorization events" — so safety
  gate 7's single undifferentiated "authority loss" row does conflate
  dispositions its owner keeps distinct.
- **Material 5 CONFIRMED**, and independently found by Fable (its C1).
  Both reviewers are correct that the cited ticket is absent; the
  corrected diagnosis is in LLP 0138's own 2026-08-01 Revised header and
  the fix landed on `origin/main` as `b52e3b9c`. Codex could not see
  `issues/closed/20260801-fleet-query-implicit-limit.md` because that
  commit is not an ancestor of this branch's HEAD — the orchestrator
  confirmed it exists in `b52e3b9c`.

Reviewer's own concurrency note, recorded as received: `HEAD` had moved
to `440aa536` by the time it checked, though the pinned target and
evidence files were unchanged.

### Review (verbatim as received)

## 1. Overall assessment

This is a strong program direction, and the Option-C protocol is substantially better calibrated than the bakeoff report itself. It correctly treats the bakeoff as evidence of browser-write pressure—not proof that the IR rung is insufficient—and preserves the author-only admission rule.

It is not ready, however. Phase 0 still has contradictory advancement and capability claims; its acceptance proves less than the Plan and guide say; Phase 1 lacks the end-to-end gate needed for its promised `Parity`; and the Option-C safety and recommendation rules contain material decision-quality gaps.

The target matched SHA-256 `ea33e2e…bd0d` at the beginning and end of review. By the time I checked, repository `HEAD` was `440aa536`, not the stated `cfbee870`, but the target and evidence files I pinned remained unchanged. I did not inspect anything under `llp/reviews/`.

## 2. Strengths

- The bakeoff characterization in [LLP 0129:584](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:584) is accurate. Kanban duplicated its move transform ([Diary 0043:86](/Users/ccheever/projects/snapback/diaries/0043-latency-kanban-zero-bakeoff.diary.md:86)); Calendar used an application-local pending sidecar because it could not forge the server-minted branded ID ([Diary 0044:32](/Users/ccheever/projects/snapback/diaries/0044-contention-calendar-zero-bakeoff.diary.md:32)); Notebook preserved intent but not speculative restart UI or a semantic conflict interface ([Diary 0046:41](/Users/ccheever/projects/snapback/diaries/0046-field-notebook-zero-bakeoff.diary.md:41)). Calling this “pressure” rather than trigger detection is correct because no Phase-1 browser IR evaluator ran.

- The A → B → C sequence orders candidates by increasing authority surface, makes safety failures controlling, and refuses to let uncertainty default to the more powerful mechanism ([LLP 0129:706](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:706), [861](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:861)).

- ER-1 is preserved. The program may recommend, but only the author may record admission ([LLP 0129:891](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:891)), matching [LLP 0130:88](/Users/ccheever/projects/snapback/llp/0130-program-standing-decisions.decision.md:88). I found no author-precommit defect.

- The required real-browser carrier, process termination, IndexedDB profile reuse, fault matrix, protected-scope nonclaims, independent observer, and evidence-review role form a serious decision-evidence design ([LLP 0129:747](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:747), [831](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:831)).

- The Phase 0 correction accurately identifies the existing receipt as Node/file/headless/public-query evidence. The acceptance forces the file store ([offline-local-first.mjs:52](/Users/ccheever/projects/snapback/demos/public-dashboard/tests/acceptance/offline-local-first.mjs:52), [109](/Users/ccheever/projects/snapback/demos/public-dashboard/tests/acceptance/offline-local-first.mjs:109)); both exercised queries are public ([functions.mjs:17](/Users/ccheever/projects/snapback/demos/public-dashboard/snapback/functions.mjs:17)); and no React or client/browser-process restart is exercised.

## 3. Concerns

### 1. BLOCKING — Phase 0 has not passed its defined gate, but its status still implies advancement

Evidence: Phase 0 chooses the “JS/React browser arm,” includes M1 lease custody and the unbuilt delta-resume consumer, and names one diary-grade acceptance gate on that arm ([LLP 0129:224](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:224)). SD-5 likewise names one Phase 0 gate and says advancement follows gate success ([LLP 0130:74](/Users/ccheever/projects/snapback/llp/0130-program-standing-decisions.decision.md:74)).

The status correctly concedes that browser/React/IndexedDB evidence is “NOT CLEARED,” but still labels the phase “LANDED” and says Phase 1 is “un-blocked on Phase 0’s side” ([LLP 0129:243](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:243), [281](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:281)). There is no defined “browser half” of the gate.

The proof is also public, whereas exit criterion 1 requires an authenticated shell and retained authorized rows after browser restart ([LLP 0129:476](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:476)). Therefore “the cold-boot beat is claimed at file-store/headless reach” ([LLP 0129:317](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:317)) still overstates the result: authentication and authorized retention are missing, not merely the browser carrier.

The same phase status conflicts with its pre-start rule: open question 5 says every phase needs an owner and timebox before starting, while assigning none ([LLP 0129:978](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:978)).

Resolution criterion: mark the implementation as a landed Node/file/public slice but Phase 0 and its gate as open; remove or explicitly supersede the stale “CLEARED” and phase-level “LANDED” language. If Phase 1 is independently startable under the non-dependency rule, say that directly instead of implying Phase 0 advanced it. Any split gate, waived prerequisite, or retrospective owner/timebox exception needs a dated author disposition.

### 2. BLOCKING — Capability claims still exceed both the acceptance and the guide’s actual maturity

Evidence: Phase 0 says it will carry retention/replay ``Parity`` claims ([LLP 0129:227](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:227)), while its own status says there is no local execution ([LLP 0129:270](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:270)). LLP 0043 is explicit: retention or queue support without local execution remains `Online`, not `Parity` ([LLP 0043:48](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:48)); LLP 0114 says the same for React ([LLP 0114:663](/Users/ccheever/projects/snapback/llp/0114-first-class-react-and-query-groups.spec.md:663)).

The Plan calls `sync.offline-js-arm` “shipped” ([LLP 0129:268](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:268), [491](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:491)), but the actual capability row is `partial` and explicitly Node/file-only ([guide/capabilities.md:60](/Users/ccheever/projects/snapback/guide/capabilities.md:60)). Exit criterion 2 also first names the Contract-oriented `sync.offline` and arm-agnostic `auth.authorized-leases`, then switches to JS-specific rows, leaving no literal terminal row set ([LLP 0129:486](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:486)).

The guide says “The headless witness proves” before including protected `SNAPBACK_RETENTION_NOT_RETAINABLE` refusal and full-snapshot-before-replay behavior ([offline-and-retention.md:42](/Users/ccheever/projects/snapback/guide/sync/offline-and-retention.md:42)). But:

- The only refusal assertion is the public `SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE` case ([offline-local-first.mjs:128](/Users/ccheever/projects/snapback/demos/public-dashboard/tests/acceptance/offline-local-first.mjs:128)).
- The pending-outbox check merely catches a `TypeError`; it never observes whether retained rows were briefly published ([offline-local-first.mjs:192](/Users/ccheever/projects/snapback/demos/public-dashboard/tests/acceptance/offline-local-first.mjs:192)).
- The reconnect check waits for queue drain and then current freshness, without proving their order ([offline-local-first.mjs:209](/Users/ccheever/projects/snapback/demos/public-dashboard/tests/acceptance/offline-local-first.mjs:209)).
- Refused replay/drop-and-mark-failed is absent from this acceptance.

Resolution criterion: describe Phase 0 as `Online`-class, `partial` JS-client retention/replay. Add assertion-level evidence for zero pre-resync publication, the snapshot-before-replay ordering, protected refusal, persisted-first ordering, and rejected replay—or narrow every Plan/guide claim and attribute unit-only evidence precisely. Define exact JS-arm capability rows and statuses required for exit criterion 2.

### 3. BLOCKING — Phase 1’s gate is insufficient for its promised end-to-end `Parity`

Evidence: Phase 1’s named gate is only the evaluator sizing spike plus D5 conformance on both evaluators ([LLP 0129:323](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:323)). Yet it promises local optimistic overlays and `Parity`, and later says those claims make criterion 3 live ([LLP 0129:530](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:530)).

LLP 0133 is accepted semantic design, not implementation evidence. It delegates receipt wire shape, queue/lease mechanics, and schema-at-capture policy to other owners ([LLP 0133:109](/Users/ccheever/projects/snapback/llp/0133-local-settlement.spec.md:109)); lane L requires server re-derivation and client reconciliation ([LLP 0133:179](/Users/ccheever/projects/snapback/llp/0133-local-settlement.spec.md:179)); and its acceptance sketches explicitly land with future implementing slices ([LLP 0133:597](/Users/ccheever/projects/snapback/llp/0133-local-settlement.spec.md:597)). Owner-document landing does not prove those mechanisms execute correctly.

Resolution criterion: split Phase 1 into evaluator/conformance and end-to-end shipping slices, or add a gate covering lane-L settlement, id mapping/cascade, receipt projection, schema/identity fencing, partial-read admission, browser store/outbox behavior, React presentation, and authoritative convergence. No IR `Parity` claim or Phase-1 exit should occur on D5 evaluator passage alone. These common mechanisms must also exist before Candidate A can be judged inexpressive rather than merely incomplete.

### 4. BLOCKING — The protected-revocation gate weakens and conflates its owner’s safety contract

Evidence: the lab combines logout, user switch, and authority revocation in one fault row, while safety gate 7 allows protected state to be “retired or quarantined” for undifferentiated “authority loss” ([LLP 0129:762](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:762), [804](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:804)).

LLP 0053 requires distinct behavior:

- Logout/session revocation deletes retained state outright ([LLP 0053:412](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:412)).
- Connected permission revocation uses obligation-backed retirement.
- Disconnected authorization cannot be discovered immediately; an unexpired lease is the bound ([LLP 0053:206](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:206)).
- Every auth-scoped reconnect requires a fresh resnapshot ([LLP 0053:308](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:308)).

As written, a candidate could pass by quarantining after logout or be read as required to detect an impossible offline revocation.

Resolution criterion: split the gate into session logout/user-switch deletion, connected permission-revocation retirement, disconnected lease-bounded behavior, and mandatory reconnect resnapshot plus execution-time mutation rejection. Give each case an exact expected disposition and timing.

### 5. MATERIAL — The Fleet standing nonclaim is stale and attached to the wrong safety gate

Evidence: LLP 0129 calls the retained Fleet result an open mutation atomicity/visibility failure under gate 2 ([LLP 0129:818](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:818)). The historical observation is real, but exact-fixture follow-up proved all 1,000 writes committed. The defect was a silently incomplete 1,024-row query prefix; the corrected handler and platform fix produced 7 PASS, 1 browser GAP, 0 FAIL ([LLP 0138:303](/Users/ccheever/projects/snapback/llp/0138-zero-replicache-bakeoff.plan.md:303), [summary.md:81](/Users/ccheever/projects/snapback/demos/zero-bakeoff/reports/summary.md:81), [Diary 0047:183](/Users/ccheever/projects/snapback/diaries/0047-fleet-observatory-zero-bakeoff.diary.md:183)).

That is historical gate-9/no-false-completion evidence, not a standing gate-2 atomicity defect. The cited `issues/20260801-fleet-burst-mutation-not-visible.md` was absent. The corrected closed-ticket path cited by LLP 0138 was also absent, so I could not verify either ticket.

Resolution criterion: restate this as a remediated query-completeness failure, retain the immutable v1 failure and v2 witness, and place it under gate 9. Preserve a product-wide gate-2 nonclaim only if separate current evidence supports one, and cite an artifact that exists.

### 6. MATERIAL — Candidate B can win through unbounded “typed extension soup”

Evidence: the lab records files, lines, concepts, escape hatches, implementation time, runtime cost, and diagnostic burden ([LLP 0129:831](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:831)). But the recommendation rule automatically selects Outcome 2 whenever some collection of typed extensions expresses all facts; Candidate C is not attempted unless B is literally inexpressive ([LLP 0129:628](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:628), [874](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:874)). There is no ceiling on extension count, app-specificity, bundle/runtime burden, or diagnostic complexity.

Consequently, the collected burden evidence cannot change the recommendation even if B becomes a less coherent product than a bounded C contract.

Resolution criterion: preregister coherence and burden ceilings for B and connect the recorded metrics to eligibility. Alternatively, explicitly narrow this to a pure authority/expressiveness experiment and stop claiming that DX/runtime evidence determines whether C is justified.

### 7. MATERIAL — The lab’s start boundary is contradictory and potentially circular with Phase 1

Evidence: Measurement says the lab runs “after the successor rerun” ([LLP 0129:579](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:579)), but “When the lab can run” exhaustively lists D5, owner, and timebox without the rerun ([LLP 0129:667](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:667)).

The intervening-work rule also freezes “shared/generated optimistic transforms” until after the lab ([LLP 0129:693](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:693)), while Phase 1 is itself the shared IR evaluator generating optimistic overlays and must exist before the lab. That can be read as forbidding the Candidate-A surface required to start the experiment.

Resolution criterion: make the successor rerun an explicit prerequisite or remove that sequencing claim. Explicitly exempt D5-qualified Candidate-A IR overlays from the Outcome-2 freeze, or make the lab a Phase-1/program gate and revise completion accordingly.

### 8. MATERIAL — The program-completion state machine remains non-executable

Evidence: Measurement says the program “must answer” the mobile spike and Option-C lab ([LLP 0129:569](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:569)), while completion explicitly excludes mobile and the lab explicitly does not gate completion ([LLP 0129:542](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:542), [683](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:683)).

More concretely, Phase 2a’s only gate is “the WASM assessment, dated”; it supplies no pass/fail criteria or working-artifact acceptance ([LLP 0129:339](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:339)). That contradicts the Plan’s rule that a phase without a falsifiable criterion cannot exit and its definition requiring Phase 2a execution for program completion ([LLP 0129:471](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:471), [538](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:538)).

Resolution criterion: distinguish mandatory completion measurements from conditional/out-of-boundary research. Give Phase 2a a falsifiable artifact/conformance exit, or reclassify it as an assessment with an explicit author disposition rule.

## 4. Suggestions

- Rename Outcome 3 to “Recommend bounded Option-C admission” so even its heading cannot be mistaken for the admission act.
- Add a claim matrix mapping each Phase 0 fact to carrier, query/auth scope, maturity, exact check, and evidence class.
- Preserve builder-specific sealed first-attempt logs before producing the three synthesis diaries.
- Qualify “IndexedDB in browsers”: the resolver also requires Web Locks and otherwise degrades.
- Rename the ninth Phase 0 check; its title claims `Parity`, retained-marking, and memory-fallback coverage, but its assertions only exercise explicit store disablement.
- Correct the stale `@snapback/client` package name if `@expo/snapback-client` is now canonical.

## 5. Open questions

1. Is Phase 1 intentionally independently startable while the Phase 0 gate remains open, and where is that author-approved state transition recorded?
2. Is the successor rerun a mandatory Option-C-lab prerequisite?
3. Which common lane-L settlement, identity, receipt, store, and reconciliation mechanisms must exist before Candidate A may be classified as inexpressive?
4. What quantitative or structural burden makes Candidate B no longer an acceptable “constrained” extension outcome?
5. Does Phase 2a mean shipping a D3 WASM artifact, or only deciding whether one should be built?
6. What exact public/protected authority scope may an Option-C recommendation include when JS-arm authorized leases have not shipped?

## 6. Readiness verdict

NOT READY

The empirical protocol has a sound core and preserves the author’s authority, but the unresolved phase-gate contradiction, false `Parity` wording, acceptance/claim mismatches, incomplete Phase-1 shipping gate, and weakened revocation matrix are blocking correctness and safety defects. The stale Fleet classification and decision-rule ambiguities add independent material concerns.
## Round 3 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** OpenAI Codex CLI `codex-cli 0.146.0`, model
`gpt-5.6-sol`, provider `openai`, non-interactive `codex exec`, sandbox
`read-only`, approval `never`
**Effort:** `model_reasoning_effort="ultra"`
**Session ID:** `019fbceb-c48c-7420-ab3e-b535c214cb5c`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-resumed session; barred from `llp/reviews/`
**Target:** `llp/0129-local-first-program.plan.md`
**Target SHA-256:** `ffb631508a063e33678de943d6a4c118b4eb12811063cfd515d5d50a3208e96f`
**Instruction capsule SHA-256:** `53bf0f6b7934cf764d2d74500fded1d4bcbf2d59bf7913662cddb8942543818d`
**Status:** completed
**Verdict:** NOT READY

**Round-3 split verdict.** Fable returned READY on this same revision;
Codex did not. The loop therefore did **not** converge at round 3, and
the document was revised again (v0.5) rather than stopped.

**Orchestrator verification (outside the verbatim body).** The decisive
new findings were checked against their owning documents before acting,
and all held:

- **Material 3 CONFIRMED and the sharpest catch of the round.**
  `llp/0053-authorization-invalidation.rfc.md`'s disposition table maps
  "every ordinary coarse permission/activation/out-of-band revocation
  event" to **`quarantine`**, and `delete` only to *proof* (typed
  `SNAPBACK_AUTH_PERMISSION_DENIED`, a superseding snapshot, or lease
  expiry). Its prose is explicit — "Coarse events quarantine; only proof
  deletes" — and records that mapping coarse events to `delete` was
  attempt four's bug. The v0.4 gate 7(b) wording "obligation-backed
  retirement" used a disposition name LLP 0053 does not have.
- **Blocking 2 CONFIRMED.** No owning document defines a degraded local
  external effect: LLP 0133 excludes action replay and LLP 0126 pins
  actions/external effects as impossible offline and never automatically
  replayed. "Degrade" was therefore not an executable acceptance
  condition.
- **Material 5 CONFIRMED in both halves.**
  `guide/sync/offline-and-retention.md` still introduced its bullets with
  "The headless witness proves" while listing the
  `SNAPBACK_RETENTION_NOT_RETAINABLE` refusal that no test asserts, and
  the acceptance script's own header still called itself the "Phase 0
  evidence gate, self-advancing under LLP 0130 SD-5," contradicting the
  Plan's corrected disposition. Both are fixed in the same landing.
- **Suggestion CONFIRMED.** LLP 0133's metadata says `Accepted` while its
  closing §Status still said `Draft`; reconciled.

Reviewer's own snapshot note, recorded as received: the checkout's HEAD
had moved to `47403ab6` (two unrelated `.eas/workflows` files) while the
pinned target hash held.

### Review (verbatim as received)

## 1. Overall assessment

The local-first program is a good idea and its governing direction is sound: preserve server authority, build the shared IR rung before considering duplicated client semantics, keep browser and desktop ladders independent, and require capability claims to match acceptance evidence.

Round 3 materially improves the document. The Phase 0 status now describes the Node/file proof honestly, the bakeoff is correctly treated as evidence of pressure rather than proof of the Option-C trigger, the Fleet failure is accurately reclassified as false query completion, and Option C remains an author-only admission decision.

The Plan is nevertheless not ready. Its Option-C lab can become nominally runnable before Candidate A’s required substrate exists; two safety gates disagree with their owning documents; Phase 2a still has no falsifiable exit; Phase 0’s corrected narrative has not been reconciled completely with the guide, tickets, and terminal criterion; and the decision protocol lacks both a sufficient negative-evidence rule and a total outcome set.

Snapshot note: I read the complete target and verified its SHA-256 remained `ffb631508a063e33678de943d6a4c118b4eb12811063cfd515d5d50a3208e96f`. The checkout’s HEAD was `47403ab6`, rather than the brief’s `1daf6aa4`; the committed difference comprised only two unrelated `.eas/workflows` files. Relevant uncommitted evidence remained stable. I did not open anything under `llp/reviews/`.

## 2. Strengths

- **The bakeoff characterization is now appropriately conservative.** LLP 0129 says the bakeoff found “credible browser-write expressiveness pressure” but did not detect the trigger because Candidate A has not run (`llp/0129-local-first-program.plan.md:666-675`). That is supported by the evidence:

  - Kanban duplicated its move transform (`diaries/0043-*-zero-bakeoff.diary.md:88-93`).
  - Calendar needed an application-local pending sidecar around server-minted IDs (`diaries/0044-*-zero-bakeoff.diary.md:32-38,97-99`).
  - Notebook retained intent without reconstructing speculative UI or exposing a typed semantic-conflict surface (`diaries/0046-*-zero-bakeoff.diary.md:41-46,140-143`).
  - The browser carrier remained unproven because the witness used `fake-indexeddb` (`diaries/0046-*-zero-bakeoff.diary.md:100-103,151-159`).

  This Plan is more accurate than the bakeoff summary’s statement that the evidence “appears to satisfy” the reconsideration condition (`demos/zero-bakeoff/reports/summary.md:40-48`).

- **The Fleet correction is accurate.** LLP 0129 correctly says all 1,000 writes were durable and that an implicit 1,024-row prefix was silently treated as complete (`llp/0129...:929-946`). LLP 0138 reports the same diagnosis (`llp/0138-zero-replicache-bakeoff.plan.md:300-315`), while the remediated receipt reports 7 PASS / 1 GAP / 0 FAIL (`demos/zero-bakeoff/reports/summary.md:81-98`). Commit `b52e3b9c` is therefore characterized correctly as a gate-9 false-completion remediation, not proof of a mutation-durability failure.

- **The central Phase 0 correction is true.** The acceptance explicitly forces a file store and asserts `implementation === 'file'` (`demos/public-dashboard/tests/acceptance/offline-local-first.mjs:54-56,109-125`). It imports the framework-neutral client, not React (`offline-local-first.mjs:23-31`; `demos/_kit/client.mjs:1-3`). Both exercised queries are public (`demos/public-dashboard/snapback/functions.mjs:17-39`), and its only refusal assertion is `SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE` (`offline-local-first.mjs:128-140`). LLP 0129’s conclusion that implementation landed but the React/browser/authenticated evidence gate did not pass is correct (`llp/0129...:321-380`). The `sync.offline-js-arm` capability row is also appropriately `partial` (`guide/capabilities.md:60-61`).

- **Option C is not pre-admitted.** The lab recommends; only the author admits (`llp/0129...:688-712,1062-1066`). Candidate B and C remain non-shipping prototypes whose public contracts must return to owning RFCs/Specs (`llp/0129...:821-835`). This respects LLP 0130 ER-1 and substantially respects constraint 7.

- **Claim vocabulary is disciplined.** Candidate C is capped at `Online` plus labeled speculation (`llp/0129...:924-927`), consistent with LLP 0126’s classification.

- **Several protocol choices are strong.** The standards-real-browser requirement, process-restart workload, least-power rule, immutable v1 evidence, separation of LLP 0090 policy collisions from IR insufficiency, and refusal to generalize the Fleet remediation beyond its tested workloads are all good decision-quality safeguards.

## 3. Concerns

### 1. BLOCKING — The lab can run before Candidate A’s necessary substrate exists

**Evidence:** Measurement says `§When the lab can run` states the prerequisites “exhaustively” (`llp/0129...:649-655`). That subsection requires only a D5-qualified evaluator, an owner, and a timebox (`:749-767`).

Open question 8 then says Candidate A cannot be judged without lane-L settlement and ID mapping, partial-read admission, schema/identity fencing, receipt projection, browser store/outbox, and React presentation (`:1156-1172`). LLP 0051 confirms D5 is evaluator/corpus conformance; D6 separately owns end-to-end store, outbox, overlay, and claim composition (`llp/0051-language-neutral-data-tier.rfc.md:680-728,754-805`). LLP 0114 owns React semantics and says React remains `Online` absent a separate LLP 0064 profile (`llp/0114-first-class-react-and-query-groups.spec.md:47-52,70-71,663-667`).

There is also remaining circularity in the product-work freeze: provisional/canonical identity settlement is frozen as Outcome-2-shaped work (`llp/0129...:775-779`), while accepted LLP 0133 already requires lane-L id-map delivery and logical-mint mapping (`llp/0133-local-settlement.spec.md:423-467`). The explicit carve-out covers only the evaluator and IR-derived overlays (`llp/0129...:781-787`).

The lab could therefore measure missing shared implementation rather than IR expressiveness and then feed that false negative into an Option-C recommendation.

**Resolution criterion:** Resolve OQ8 before scheduling the lab. Define Candidate A’s exact end-to-end acceptance surface; add every Candidate-A-neutral mechanism to the runnable prerequisites and freeze carve-outs; and name the LLP 0114/0064 React proof. Alternatively, restrict the experiment to pure IR-language analysis and prohibit it from recommending C.

### 2. BLOCKING — Safety gate 6 has no owning external-effect semantics

**Evidence:** Gate 6 says external effects “degrade or re-derive according to the settlement Spec” (`llp/0129...:898-900`). LLP 0133 expressly excludes action replay (`llp/0133...:691-699`), while LLP 0126 says actions and external effects remain impossible offline and are never automatically replayed (`llp/0126-local-first-and-local-sync.research.md:646-654`).

Consequently, the gate neither identifies an owner nor defines what a passing Candidate-C sandbox may do with network, action, clock, or other ambient powers. “Degrade” is not an executable acceptance condition.

**Resolution criterion:** State that every local candidate is denied external effects and undeclared ambient capabilities, define its complete capability/input surface, and add negative sandbox tests. Any broader behavior must first land in an owning design.

### 3. MATERIAL — Safety gate 7(b) misstates LLP 0053’s revocation dispositions

**Evidence:** LLP 0129 maps connected permission revocation to obligation-backed “retirement” (`llp/0129...:901-917`). LLP 0053’s normative table instead maps ordinary coarse or out-of-band permission revocation to `quarantine`; only typed denial or superseding-snapshot proof causes `delete` (`llp/0053-authorization-invalidation.rfc.md:1196-1203`). Its subsequent text explicitly says “Coarse events quarantine; only proof deletes” and requires resnapshot before release or deletion (`:1218-1246`). Matcher-mediated shrinking delivery is a separate connected path, not a blanket permission-revocation disposition.

**Resolution criterion:** Split the connected cases according to LLP 0053: matcher-proven shrinking delivery, coarse-event quarantine/resnapshot, and proof-backed deletion. Use LLP 0053’s actual disposition names and test each path.

### 4. BLOCKING — Phase 2a still has no falsifiable exit

**Evidence:** Phase 2a’s only evidence gate is “the WASM assessment, dated” (`llp/0129...:403-409`). The Plan simultaneously says a phase without a falsifiable criterion does not exit (`:535-538`) and that program completion requires Phase 2a to execute and pass its gate (`:600-616`). Open question 9 explicitly concedes this contradiction (`:1173-1180`).

**Resolution criterion:** Either define a Phase-2a artifact, pass/fail thresholds, and failure disposition, or reclassify it as conditional research outside the phase-completion boundary with a dated author disposition. The current two rules cannot both stand.

### 5. MATERIAL — The Phase 0 correction has not fully reconciled the guide, exit target, and closure tickets

**Evidence:**

- LLP 0129 correctly says the protected `SNAPBACK_RETENTION_NOT_RETAINABLE` branch is implemented but untested (`llp/0129...:354-380`; implementation at `packages/snapback-client/index.mjs:8053-8061`). Nevertheless, `guide/sync/offline-and-retention.md:42-53` introduces its bullets with “The headless witness proves” and includes protected/auth-scoped refusal and both diagnostic codes. That remains an evidence overclaim.
- The test’s own header still calls itself the “Phase 0 evidence gate, self-advancing under LLP 0130 SD-5” (`offline-local-first.mjs:1-7`), contrary to the Plan’s corrected disposition.
- The JS client deliberately rejects sessions-custody queueing with `SNAPBACK_OFFLINE_QUEUE_CUSTODY_UNSUPPORTED` (`packages/snapback-client/index.mjs:4997-5016`). The Plan acknowledges that boundary (`llp/0129...:315-321`), and the custody ticket permits either implementation or making Contract the permanent sessions carrier (`issues/20260731-js-arm-lease-custody-and-sessions-outbox.md:23-31`). Exit criterion 2 nevertheless says JS retention/replay claims must “match the Contract arm’s” and calls browser/React/protected proof plus the lease row the “exact remaining closure,” omitting sessions queue custody (`llp/0129...:550-570`).
- Exit criterion 1 requires a full browser restart rendering an authenticated shell and retained authorized rows (`llp/0129...:540-549`). The browser ticket requires a public React surface, an authority-independent retained query, and protected refusal (`issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md:40-49`); the lease ticket permits a headless witness (`issues/20260731-js-arm-lease-custody-and-sessions-outbox.md:40-43`). Both tickets could close without proving the criterion’s full browser + React + authenticated authorized-retention conjunction.

**Resolution criterion:** Establish one explicit proof matrix or cross-ticket gate for every terminal claim. It must identify carrier, process boundary, React/headless surface, public/protected scope, lease state, and sessions custody. Either implement sessions-custody parity or permanently narrow criterion 2 and all guide claims to dev/external-bearer custody. Rewrite the guide and test header to match the evidence actually retained.

### 6. MATERIAL — The protocol cannot turn failed implementations into a reliable “inexpressible” finding

**Evidence:** Two builders attempt A across all workloads before seeing the other’s diary (`llp/0129...:979-986`), but the artifact contract asks for one diary per workload and exactly three diaries (`:976-977,1050-1052`). It does not specify isolated source trees, sealed builder evidence, or disagreement handling.

The trigger uses the universal conclusion that A “cannot express” a fact (`:988-1012`), but there is no negative-result certificate. It does not state the obvious controlling rule that one valid A implementation disproves inexpressibility. Outcome 3 then requires only “a concrete B attempt,” singular (`:1033-1043`).

The performance evidence is similarly vulnerable: candidates always run A→B→C (`:796-823`), while authoring time and assistance are measured (`:962-969`). Later candidates inherit workload and harness familiarity. The twenty-sample floor also leaves process/profile independence and pooling unspecified.

**Resolution criterion:** Retain sealed evidence per builder × workload × attempt. Require both independent implementations to fail the same fact, treat any valid pass as defeating that inexpressibility claim, identify the missing admitted primitive, and require the relevant IR/profile owner to validate the classification. Apply an equivalent independent standard to B before recommending C. Either make timing/performance descriptive only or preregister sampling units, clean-profile repetitions, pooling rules, and bias controls.

### 7. MATERIAL — The claimed three-outcome protocol is not total

**Evidence:** The Plan says the lab recommends “exactly one of three outcomes” (`llp/0129...:686-710`) but later says mixed evidence retains the current decision and triggers a narrower follow-up (`:1045-1046`).

There are at least two concrete no-outcome states:

- An A failure caused solely by LLP 0090 D3 is not trigger detection; it requires an owner amendment and rerun (`:1001-1012`). Outcome 1 is not yet demonstrated, while Outcomes 2 and 3 are unjustified.
- If B expresses every fact but exceeds its coherence ceilings, Outcome 2 is barred (`:1018-1031`) while Outcome 3 condition 1—remaining inexpressibility—is false (`:1033-1043`).

**Resolution criterion:** Add an explicit fourth disposition: no Option-C recommendation; retain the current authority decision pending an owner-policy amendment, repaired protocol, or narrower follow-up. Define whether that disposition closes the lab and what permits a rerun.

### 8. MATERIAL — Several mandatory measurements do not bind program completion

**Evidence:** Measurement says all listed questions except mobile and the Option-C lab “must answer,” including client-store footprint, hydration cost, local-versus-settlement latency, and resume-storm behavior (`llp/0129...:639-662`). Program completion, however, is defined solely through phase gates, binding exit criteria, and the Option-F disposition (`:600-616`). None of the phase gates names those three measurements or an acceptance artifact for them.

The Plan can therefore declare itself complete without answering measurements it calls mandatory.

**Resolution criterion:** Assign every mandatory measurement an owner, artifact, target, and binding phase or completion criterion. Otherwise relabel it as non-binding research.

## 4. Suggestions

- Add a machine-checkable decision-lab manifest that names each prerequisite receipt, owner, target identity, hash, and acceptance result. The harness should refuse to start if a required shared-substrate receipt is absent. This would make the evidence graph much harder to misread than another prose checklist.

- Append a dated erratum to the bakeoff summary’s “appears to satisfy” statement (`demos/zero-bakeoff/reports/summary.md:40-48`) so the live evidence documents agree with LLP 0129’s more accurate “pressure, not trigger” conclusion. Preserve the raw receipts unchanged.

- Qualify “durable outbox” by carrier in the guide. The memory store explicitly reports warm-session-only, non-durable behavior; it should not inherit file/IndexedDB restart language.

- Reword “largest planned measurement after the successor rerun” (`llp/0129...:649-654`) as “second-largest by scope, behind the successor rerun.” The current sentence still reads temporally despite its clarification.

- Repair LLP 0133’s internal status drift: its metadata says `Accepted` (`llp/0133...:3-10`), while its closing status section still says `Draft` (`:725-731`).

## 5. Open questions

1. Is Candidate A the D2/D5 evaluator in isolation, or the complete browser/store/outbox/settlement/React composition?

2. Which lane-L and identity mechanisms are shared substrate, and which are genuinely optional Candidate-B extensions?

3. What exact sandbox denies external effects and ambient authority for Candidates A, B, and C?

4. What evidence proves inexpressibility when builders disagree or both merely fail to discover a valid construction?

5. Must Candidate B receive the same independent-attempt standard as Candidate A before C can be recommended?

6. Are performance and authoring-cost results descriptive, or can they determine Outcomes 2 and 3?

7. Does the JS arm intend to gain sessions-custody replay, or is Contract permanently the sessions offline carrier?

8. What artifact and decision rule let Phase 2a exit—or remove it from program completion?

9. What formal disposition records an expressive-but-incoherent B result or an owned-policy collision?

## 6. Readiness verdict

NOT READY

The proposal’s direction is strong, and the round-3 factual corrections are substantial. It still has unresolved correctness, safety, feasibility, and decision-quality defects: the lab can start without the substrate required for a valid Candidate-A judgment, two safety gates do not match their owners, Phase 2a cannot exit under the Plan’s own rule, Phase 0’s terminal proof remains under-specified, and the empirical protocol can produce evidence for which it has no valid outcome. These are material defects, not optional polish.
## Round 4 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** OpenAI Codex CLI `codex-cli 0.146.0`, model
`gpt-5.6-sol`, provider `openai`, non-interactive `codex exec`, sandbox
`read-only`, approval `never`
**Effort:** `model_reasoning_effort="ultra"`
**Session ID:** `019fbd01-8603-72e0-9d8b-d357228c7a3d`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-resumed session; barred from `llp/reviews/`
**Target:** `llp/0129-local-first-program.plan.md`
**Target SHA-256:** `251ded42c41fcadd53cd343fbbd4bd572dcf29fea5919a35531b219138241989`
**Instruction capsule SHA-256:** `7f459f35f2ec635b25fa133f19358a04ad6bbc40f76b701f2bd659d64e1a6795`
**Status:** completed
**Verdict:** NOT READY

**Second split verdict.** Fable returned READY on this revision; Codex
did not. Severity is falling across rounds (round 3: 3 blocking; round
4: 1 blocking), and no round has yet produced a finding refuted by
verification.

**Orchestrator verification (outside the verbatim body).** The two
strongest new evidence claims were checked in the tree and both hold:

- **Material 3 CONFIRMED.** `demos/zero-bakeoff/apps/field-notebook/acceptance/snapback.mjs`
  records `fn.stretch-offline-restart` and `fn.stretch-concurrent-rebase`
  as immediate `suite.gap(...)` declarations — the bakeoff never
  restarted the pending client or introduced a concurrent remote edit.
  The Plan had been reading a declared GAP plus source audit as an
  executed restart/rebase observation.
- **Material 4 CONFIRMED.** The Phase 0 acceptance's "cold relaunch"
  disposes the handle, calls `closeClient(clientA)`, stops the server,
  and constructs `clientB` **in the same Node process**. That is fresh
  client/store instances over persisted bytes, not a client-process
  restart — so exit criterion 1's process-restart element is unproven on
  every carrier, not merely the browser one.
- **Material 2 CONFIRMED, and found independently by Fable as its C2** —
  see the Fable round-4 artifact's orchestrator note for the LLP 0090
  §D3 quotation. Two families converging on the same mischaracterization
  from different directions is the strongest signal this loop produced.

### Review (verbatim as received)

## 1. Overall assessment

This is a strong, worthwhile program plan, and the Option-C decision lab is directionally excellent. It preserves server authority, compares progressively more powerful approaches, uses frozen workloads, and requires standards-real browser evidence before recommending a new authority surface.

It is not ready yet. One safety rule is incorrectly scoped, the trigger protocol relies on a policy prohibition absent from its cited owner, and several evidence and gate claims remain internally inconsistent. In particular, the Phase 0 correction still credits a same-process client re-instantiation as a cold boot, while the exit criterion requires a full process restart.

I reviewed the working-tree snapshot whose target hash remained `251ded42c41fcadd53cd343fbbd4bd572dcf29fea5919a35531b219138241989` throughout. No relevant file changed during the review, and I did not open anything under `llp/reviews/`.

## 2. Strengths

- The document respects ER-1. The lab detects and recommends; only the author can admit Option C ([LLP 0129:735](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:735), [775](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:775), [1214](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1214)). This matches [LLP 0130 ER-1](/Users/ccheever/projects/snapback/llp/0130-program-standing-decisions.decision.md:88).

- The empirical design is unusually good. Frozen provider-neutral manifests, real browser-process termination, same-profile restart, Web Locks contention, duplicate delivery, lost acknowledgements, and independent-observer convergence directly address the bakeoff’s admitted headless-carrier limits ([LLP 0129:789](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:789), [924](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:924); [bakeoff summary:232](/Users/ccheever/projects/snapback/demos/zero-bakeoff/reports/summary.md:232)).

- The candidate sandbox and denial of external effects are owner-consistent and safety-forward ([LLP 0129:985](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:985)). The Plan correctly avoids inventing a degraded offline action contract.

- The two-builder rule, sealed evidence, “one valid implementation defeats inexpressibility,” missing-primitive attribution, and B coherence ceilings are all strong decision-quality mechanisms ([LLP 0129:1093](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1093), [1146](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1146), [1189](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1189)).

- The Phase 0 block now honestly recognizes most of the retained acceptance’s scope: Node/file, headless, public queries, no React or standards-real IndexedDB, and no test of the protected refusal ([LLP 0129:392](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:392)). Its conclusion that Phase 0 has not exited is correct ([LLP 0129:359](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:359)).

- The Fleet correction is accurate. LLP 0138 and the summary support the durable 1,000 writes, false-complete 1,024-row prefix diagnosis, and 7 PASS / 1 GAP / 0 FAIL remediation. `git show b52e3b9c` confirms the named diagnostic, closed ticket, and local/workerd regressions. Reclassification from gate 2 to gate 9 is justified ([LLP 0129:1043](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1043)).

- Constraint 7 is generally handled well: prototypes remain non-shipping and any product surface must land through its owning RFCs/Specs ([LLP 0129:917](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:917), [1216](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1216)).

## 3. Concerns

### 1. BLOCKING — The public-data branch incorrectly exempts authority-transition safety

**Evidence:** Gate 7 says that when protected JS retention is unshipped, cases (a)–(c), including logout, expiry, and user switch, are `N/A` because protected retained state does not exist ([LLP 0129:1026](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1026)). That does not follow from the owners:

- LLP 0053 requires logout/session expiry to delete the client’s retained data outright ([LLP 0053:412](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:412)).
- Its dispositions explicitly cover retained bytes, optimistic overlays, and pending mutations, with separate queue custody ([LLP 0053:1231](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:1231), [1248](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:1248)).
- LLP 0039 requires authenticated→anonymous and authenticated→different-user transitions to delete retained rows and queued mutations ([LLP 0039:1073](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:1073)).

Absence of protected-query retention does not prove absence of authority-bound queues, overlays, public retained data held by an authenticated client, or user-switch state. Conversely, “reconnect resnapshot applies to any authenticated session” at 1029–1031 is too broad: owners require it for auth-scoped subscriptions, while full-resync-before-replay comes separately from LLP 0043/0090.

Cases (b) and (c) also both claim lease expiry at lines 1013–1022 despite being introduced as distinct cases.

**Resolution criterion:** Make `N/A` depend on the frozen recommendation containing no authority-bound retained rows, overlays, or outbox work—not merely on the protected capability row being unshipped. Always test session/user authority transitions when an authenticated client is in scope. Correctly separate auth-scoped reconnect resnapshot from general pending-work replay, and make the lease-expiry cases mutually exclusive.

### 2. MATERIAL — LLP 0090 is falsely cited as prohibiting speculative reconstruction

**Evidence:** The trigger logic calls Field Notebook a known `pin-collision`, asserting that LLP 0090 D3 “deliberately refuses to reconstruct speculative render state” ([LLP 0129:1129](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1129)).

LLP 0090 D3 says something narrower: a client with a non-empty outbox must not send `resumeFromToken`; it performs full resync and then replay ([LLP 0090:698](/Users/ccheever/projects/snapback/llp/0090-resumable-query-snapshots.rfc.md:698)). It does not prohibit restoring a distinctly labeled speculative overlay. LLP 0043 even records “local optimistic patch metadata” and an optimistic overlay as M2 state ([LLP 0043:147](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:147)).

This false preclassification can suppress a legitimate Candidate-A deficiency before the lab applies its attribution test.

**Resolution criterion:** Remove the “known pin” classification and let the lab classify the gap against the owners as written. Treat it as a pin only if an owning amendment explicitly adopts the presentation prohibition before the experiment.

### 3. MATERIAL — The Notebook evidence is described as more empirical than it was

**Evidence:** The Plan says the bakeoff found that Notebook “neither reconstructed speculative UI after restart nor exposed a typed semantic-conflict surface,” while caveating only that standards-real-browser restart was not proven ([LLP 0129:743](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:743)).

The Snapback acceptance did not restart the pending client or introduce a concurrent remote edit. It queued work on `offlineClient`, restarted only the server, and drained that same client ([field-notebook acceptance:72](/Users/ccheever/projects/snapback/demos/zero-bakeoff/apps/field-notebook/acceptance/snapback.mjs:72), [100](/Users/ccheever/projects/snapback/demos/zero-bakeoff/apps/field-notebook/acceptance/snapback.mjs:100)). The restart and rebase rows are immediate `suite.gap(...)` declarations ([acceptance:133](/Users/ccheever/projects/snapback/demos/zero-bakeoff/apps/field-notebook/acceptance/snapback.mjs:133)); their receipt durations are approximately 0.00058 ms ([receipt:113](/Users/ccheever/projects/snapback/demos/zero-bakeoff/apps/field-notebook/evidence/snapback.v1.json:113)). The React source does lack either UI surface, so a source-audit conclusion is supportable ([SnapbackApp.tsx:5](/Users/ccheever/projects/snapback/demos/zero-bakeoff/apps/field-notebook/src/SnapbackApp.tsx:5)).

The Kanban duplication and Calendar sidecar claims are supported; this defect is specific to how the Notebook GAP is characterized.

**Resolution criterion:** State that the bakeoff recorded declarative/source-audit GAPs for Notebook and did not execute pending-client restart or concurrent-edit rebase. Preserve those as motivations for the new lab, not as observed restart/rebase failures.

### 4. MATERIAL — Phase 0 still overclaims “cold boot,” and guide alignment remains incomplete

**Evidence:** Exit criterion 1 defines the cold-boot beat as a full process/browser restart ([LLP 0129:578](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:578)), yet the proof correction says that beat “is claimed at file-store/headless reach” ([LLP 0129:419](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:419)). The acceptance merely closes `clientA` and constructs `clientB` in the same Node process; only the backend process stops ([offline-local-first.mjs:153](/Users/ccheever/projects/snapback/demos/public-dashboard/tests/acceptance/offline-local-first.mjs:153)). That proves fresh client/store instances, not client-process restart.

The claimed guide/code agreement is also incomplete:

- The actual resolver requires IndexedDB **and** Web Locks and can degrade to memory; Node files require a usable state directory ([rqs-store-default.mjs:61](/Users/ccheever/projects/snapback/packages/snapback-client/rqs-store-default.mjs:61), [82](/Users/ccheever/projects/snapback/packages/snapback-client/rqs-store-default.mjs:82)). The capability row categorically says browsers select IndexedDB and Node selects files ([capabilities.md:60](/Users/ccheever/projects/snapback/guide/capabilities.md:60)).
- The guide introduces its bullets as facts proven by the headless witness, then includes refused-replay failure recording ([offline-and-retention.md:42](/Users/ccheever/projects/snapback/guide/sync/offline-and-retention.md:42), [61](/Users/ccheever/projects/snapback/guide/sync/offline-and-retention.md:61)). That behavior is instead covered by a stubbed package unit test ([outbox-store.test.mjs:262](/Users/ccheever/projects/snapback/packages/snapback-client/outbox-store.test.mjs:262)), not the nine-check acceptance.

**Resolution criterion:** Either add an actual client subprocess/hard-termination witness or consistently rename the current evidence to same-process client/store re-instantiation. Update the capability row and guide to state the exact carrier prerequisites and fallbacks, and reattribute refused-replay evidence or extend the named acceptance.

### 5. MATERIAL — Exit criterion 2’s “exact remaining closure” is incomplete

**Evidence:** The literal terminal set requires all three rows, including `sync.offline-js-arm-protected`, to report `shipped` ([LLP 0129:588](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:588)). But the “exact remaining closure” lists only splitting `auth.authorized-leases` and widening the main `sync.offline-js-arm` proof ([LLP 0129:603](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:603)). It omits M1 implementation/proof and promotion of the protected row, even though the Phase 0 status explicitly says M1 remains unshipped ([LLP 0129:353](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:353)).

The browser ticket proves public React/IndexedDB plus protected refusal, while the lease ticket asks for lease-valid rows without requiring the integrated authenticated React/browser/process-restart scenario. Both could close without satisfying criterion 1.

**Resolution criterion:** Add M1 implementation, protected-row promotion, and an integrated authenticated React/browser/full-process witness as explicit closure work, with a named owning ticket or artifact.

### 6. MATERIAL — Phase 1 has a reachable premature auto-advance path

**Evidence:** SD-5 automatically advances Phase 1 when its determinism corpus passes ([LLP 0130:74](/Users/ccheever/projects/snapback/llp/0130-program-standing-decisions.decision.md:74)). LLP 0129 names sizing plus D5 as the gate ([LLP 0129:425](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:425)), while OQ8 admits that those checks omit settlement/id mapping, partial reads, fencing, receipt projection, browser storage, and React presentation needed by the phase’s promised end-to-end behavior ([LLP 0129:1322](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1322)).

The document blocks the Option-C lab on OQ8 but does not suspend Phase 1’s own automatic advancement; Phase 1 may also start independently of Phase 0.

**Resolution criterion:** Before SD-5 can fire, authoritatively define separate evaluator/conformance and end-to-end shipping gates—or explicitly suspend Phase 1 auto-advancement pending OQ8’s disposition.

### 7. MATERIAL — The machine-readable recommendation protocol is internally inconsistent

**Evidence:**

- It says the lab recommends “exactly one of three outcomes” ([LLP 0129:761](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:761)) but later defines reachable Outcome 0 ([1173](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1173)).
- Outcome 3 permits one “concrete B attempt” ([1161](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1161)), while the controlling proof rule says one B attempt is insufficient ([1204](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1204)). The role assignment explicitly requires both builders only for A.
- The safety matrix permits only `PASS`, `FAIL`, or `N/A` ([961](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:961)), while measurement requires safety rows to use `PASS/GAP/FAIL/N/A` ([1072](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1072)). The eligibility effect of `GAP` is undefined.

**Resolution criterion:** Publish one executable schema with four outcomes, require two independent failed B attempts on the same fact before Outcome 3, and specify that every applicable safety row must be `PASS`; `GAP` and `FAIL` both make the candidate ineligible, while `N/A` remains limited to excluded scope.

## 4. Suggestions

- Replace the prose safety matrix with a checked manifest containing `gate_id`, scope predicate, test IDs, expected disposition, evidence status, and eligibility effect.
- Tag every evidence item as `executed`, `source-audit`, or `declared-gap`; this would have prevented the Notebook rows from reading like executed restart/rebase observations.
- Represent client-process restart, browser-process restart, server restart, and client-object recreation as separate fault axes.
- Add a small validator for outcome cardinality, status vocabulary, required attempts, and N/A justification before a lab artifact can be sealed.
- Consider a blinded second implementation brief for Candidate B to reduce the fixed A→B learning-order effect beyond merely declaring authoring-time data descriptive.

## 5. Open questions

1. Will the public-data lab run anonymously, authenticated with only public queries, or both? Which rows, overlays, and queues exist in each authority scope?
2. Is distinctly labeled speculative reconstruction after restart required and owner-permitted? If it is missing shared substrate, which LLP owns it?
3. What exact integrated witness closes Phase 0: public browser restart, protected lease custody, and authenticated shell/authorized-row restart separately or together?
4. Does Phase 1 have an evaluator gate and a distinct shipping gate, and which one controls SD-5?
5. What falsifiable artifact and threshold close Phase 2a, or should it leave the completion boundary?
6. Who owns and timeboxes the Option-C lab after OQ8 is resolved?

## 6. Readiness verdict

NOT READY

The proposal is a good idea and close to a high-quality decision protocol, but the unsafe gate-7 exemption, unsupported LLP 0090 policy attribution, remaining Phase 0 claim overreach, incomplete closure map, and contradictory outcome rules are substantive correctness and decision-quality defects. They must be resolved before the Plan can safely govern an Option-C recommendation or automatic phase advancement.
## Round 5 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** OpenAI Codex CLI `codex-cli 0.146.0`, model
`gpt-5.6-sol`, provider `openai`, non-interactive `codex exec`, sandbox
`read-only`, approval `never`
**Effort:** `model_reasoning_effort="ultra"`
**Session ID:** `019fbd12-c3b1-7470-b0eb-864798727671`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-resumed session; barred from `llp/reviews/`
**Target:** `llp/0129-local-first-program.plan.md`
**Target SHA-256:** `80397b59b3251bd9c639e85a34d7e27ade322017c88243fcffecac886ccfea3a`
**Instruction capsule SHA-256:** `bbfbbf45b1c5dee903057691a163948dc480f3531d63dff1ec95c14a8e6d7d7e`
**Status:** completed
**Verdict:** NOT READY

**Orchestrator verification (outside the verbatim body).** Decisive
claims checked before acting; all held:

- **Blocking 3 CONFIRMED, and it is the round's most important finding.**
  LLP 0053 defines auth-scoped **fail-closed** — "every subscription is
  auth-scoped unless its function is explicitly declared
  `authorityIndependent`. Undeclared means auth-scoped." LLP 0080 keeps
  even all-`public-read` relational plans auth-scoped in v1. So "the lab
  uses public data" never licensed `N/A` on gate 7(b). The same concern
  also correctly identified that v0.5/v0.6 had flattened LLP 0053's
  durable, level-triggered shrink obligation — carried by an exact
  remove delta or conservative replacement, discharged only on
  acknowledgement of a snapshot at or after the causing version — into
  "the resnapshot carries it," dropping the property that stops a lost
  removal leaving forbidden rows visible.
- **Blocking 1 CONFIRMED.** v0.6 withdrew the cold-boot claim and then
  re-asserted it three lines later ("the cold-boot beat is claimed at
  file-store/headless reach"), with `guide/sync/offline-and-retention.md`
  and the acceptance header still saying "cold boot"/"relaunch."
- **Material 6 CONFIRMED as a constraint-7 violation by this loop's own
  v0.6 text:** LLP 0130 owns SD-5, so this Plan cannot "suspend" it.
  Reframed as invoking SD-5's existing scope-change escalation.
- **Material 7 PARTIALLY CONFIRMED.** `journal_resume_requires_resnapshot`
  does have a caller (`src/local.rs:12736`) — server-side — and LLP 0008
  names LLP 0090's ladder as this consumer's widening, so the flat
  "unbuilt … no client caller" wording is stale. But Codex's stronger
  "mark it landed" reading goes beyond what this orchestrator could
  verify end to end, and Fable's round-5 C6 was the more careful framing
  of the same finding. Row 7 was therefore re-scoped and left **open
  pending a dated wire-path verification**, not marked landed.

### Review (verbatim as received)

## 1. Overall assessment

The program’s core strategy is sound: stage local-first capability from the least powerful shared mechanism, preserve server authority, demand measured evidence, and admit an app-authored client-mutator surface only after a bounded experiment. The revised Option-C section now characterizes the bakeoff honestly and respects both LLP ownership and the author-only admission reservation.

The document is nevertheless not ready. It still contains a direct Phase 0 capability overclaim, an Option-C inference procedure that can mistake shared defects for language inexpressibility, and materially incomplete security and execution-identity gates. Its advancement and completion rules also remain unresolved despite the Plan’s Accepted status. These are decision-quality and safety defects, not optional polish.

I reviewed the requested `80397b59…` target; that hash matched at the beginning and end. Repository HEAD advanced concurrently from `2506ed72` to unrelated commit `87cc4ac3` (`scripts/snapback-package-cold-install.mjs` only), while the target and hash-tracked evidence files remained unchanged. This review is pinned to the requested target snapshot and the evidence contents read from it. I did not open anything under `llp/reviews/`.

## 2. Strengths

- The bakeoff characterization is now accurate and appropriately narrow (§Option-C empirical decision protocol, [LLP 0129:816](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:816)). Kanban duplicated its move transformation ([Diary 0043:86](/Users/ccheever/projects/snapback/diaries/0043-latency-kanban-zero-bakeoff.diary.md:86)); Calendar used an app-local pending sidecar because it could not forge the branded server ID ([Diary 0044:32](/Users/ccheever/projects/snapback/diaries/0044-contention-calendar-zero-bakeoff.diary.md:32)); and Notebook’s restart/rebase findings were non-executing `suite.gap(...)` declarations ([snapback.mjs:133](/Users/ccheever/projects/snapback/demos/zero-bakeoff/apps/field-notebook/acceptance/snapback.mjs:133)). The Plan correctly treats these as pressure sufficient to design a lab, not proof that the trigger fired.

- Most of the Phase 0 proof-scope correction is unusually candid and correct ([LLP 0129:432](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:432)). The acceptance forces the file store ([offline-local-first.mjs:59](/Users/ccheever/projects/snapback/demos/public-dashboard/tests/acceptance/offline-local-first.mjs:59)), uses public queries, has no React or real IndexedDB, and reconstructs the client in the same Node process ([offline-local-first.mjs:153](/Users/ccheever/projects/snapback/demos/public-dashboard/tests/acceptance/offline-local-first.mjs:153)). The Plan correctly leaves the Phase 0 evidence gate unmet.

- Constraint 7 and LLP 0130 ER-1 are respected. Candidate implementations are non-shipping prototypes, and an adopted mechanism must return to an owning RFC or Spec ([LLP 0129:1006](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1006)). The program may detect and recommend, but only the author may admit Option C ([LLP 0129:1358](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1358); [LLP 0130:88](/Users/ccheever/projects/snapback/llp/0130-program-standing-decisions.decision.md:88)).

- The real-browser and fault matrix is appropriately demanding (§Required carrier and fault matrix, [LLP 0129:1013](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1013)). It requires real IndexedDB, hard process termination, ambiguous delivery, schema skew, multi-tab contention, and independent-observer convergence.

- The revised Fleet diagnosis is substantively correct. All 1,000 writes committed; the failure was an implicit 1,024-row query prefix falsely presented as complete, and the remediation receipt is 7 PASS / 1 GAP / 0 FAIL ([LLP 0138:300](/Users/ccheever/projects/snapback/llp/0138-zero-replicache-bakeoff.plan.md:300); [summary.md:81](/Users/ccheever/projects/snapback/demos/zero-bakeoff/reports/summary.md:81)).

## 3. Concerns

### 1. BLOCKING — Phase 0 still claims a cold-boot result it explicitly proves did not occur

**Evidence:** The correction says “Cold boot is the wrong word,” that the run remained in one Node process, and that a full client-process restart is unproven “at any carrier” ([LLP 0129:459](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:459)). Three lines later it says, “the cold-boot beat is claimed at file-store/headless reach” ([LLP 0129:472](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:472)). The guide likewise calls the result “Cold-boot retained render” and “A relaunch” ([offline-and-retention.md:44](/Users/ccheever/projects/snapback/guide/sync/offline-and-retention.md:44)), while the test header says “cold boot … after server restart + client relaunch” ([offline-local-first.mjs:15](/Users/ccheever/projects/snapback/demos/public-dashboard/tests/acceptance/offline-local-first.mjs:15)). The code merely closes one store-backed client and constructs another in the same process.

This directly violates constraint 2 and exit criterion 4. It also remains short of criterion 1’s authenticated React shell, authorized rows, and full browser-process restart ([LLP 0129:646](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:646)).

The Plan correctly observes that the required conjunction needs its own owner ([LLP 0129:681](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:681)), but no such ticket exists. The browser ticket covers public React/IndexedDB restart plus protected refusal ([browser-proof issue:38](/Users/ccheever/projects/snapback/issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md:38)); the lease ticket permits a separate lease witness ([lease issue:40](/Users/ccheever/projects/snapback/issues/20260731-js-arm-lease-custody-and-sessions-outbox.md:40)).

**Resolution criterion:** Replace “cold boot/relaunch” everywhere this receipt is cited with “same-process client/store re-instantiation”; state explicitly that no full client-process restart has been proven on any carrier; remove the claimed cold-boot consequence; and create or name one owning artifact requiring an authenticated React shell, real IndexedDB, hard browser-process termination, offline restart in the same profile, authorized retained rows, and reconnect settlement in one run.

### 2. BLOCKING — The Option-C protocol can convert implementation or experimental defects into false trigger detection

**Evidence:** Every Candidate-A gap must be classified as exactly one of `{IR-inherent, pin-collision, missing shared mechanism}` ([LLP 0129:1226](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1226)). There is no category for a candidate implementation bug, harness/evidence defect, environment failure, ambiguous frozen fact, or unresolved diagnosis.

That omission is demonstrably relevant: the bakeoff initially misread fulfilled Zero errors ([Diary 0043:72](/Users/ccheever/projects/snapback/diaries/0043-latency-kanban-zero-bakeoff.diary.md:72)), and Fleet’s first diagnosis was reversed after an exact-fixture investigation ([Diary 0047:183](/Users/ccheever/projects/snapback/diaries/0047-fleet-observatory-zero-bakeoff.diary.md:183)). Two independent builders can also share a defective evaluator, settlement integration, store, or React path.

The “proof of inexpressibility” rule requires two failures and a named missing primitive ([LLP 0129:1319](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1319)), but two failed searches are necessary evidence, not proof of a universal claim. Candidate B makes this worse: it is an open-ended list of example extensions, including an application-defined presentation mapper and conflict resolver ([LLP 0129:984](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:984)). Its ceilings constrain counts and costs, not its semantic language ([LLP 0129:1274](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1274)). Two failed B implementations therefore cannot establish that every permitted B design is inexpressive; B does not yet even have a named owner competent to validate that universal claim.

**Resolution criterion:** Add at least `candidate-implementation-defect`, `harness/evidence-defect`, `environmental`, and `unresolved` attribution outcomes for A and B. None may detect the trigger; each must produce Outcome 0 and require repair plus a fresh sealed rerun. Require an owner-signed minimal counterexample or semantic argument over a closed, enumerated Candidate-A language. Before testing B, freeze its typed inputs, outputs, allowed computation/effects, composition rules, explicit prohibition on duplicated mutation semantics, and adjudicating owner. Otherwise the only valid conclusion is “two preregistered B designs failed,” which is insufficient for Outcome 3.

### 3. BLOCKING — Safety gate 7 weakens and contradicts LLP 0053’s revocation contract

**Evidence:** Gate 7(b) reduces matcher-mediated shrink to “the resnapshot carries it” ([LLP 0129:1104](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1104)). LLP 0053 requires substantially more: every auth-scoped result shrink raises a durable, level-triggered delivery obligation; an exact remove delta or conservative replacement may carry it; and it is discharged only after acknowledgement of a snapshot at or after the causing version ([LLP 0053:248](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:248), [LLP 0053:266](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:266)). Without that ACK-backed obligation, a lost removal can leave forbidden data visible indefinitely.

The Plan also lists “lease expiry without revalidation” among connected-case 7(b) delete proofs ([LLP 0129:1110](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1110)), then says lease expiry belongs exclusively to disconnected case 7(c) ([LLP 0129:1137](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1137)).

Finally, allowing 7(b) to be `N/A` merely because a lab is “public-data-only” is unsafe ([LLP 0129:1134](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1134)). LLP 0053 defines every subscription as auth-scoped unless explicitly `authorityIndependent` ([LLP 0053:297](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:297)); even all-`public-read` relational plans remain auth-scoped in v1 ([LLP 0080:329](/Users/ccheever/projects/snapback/llp/0080-portable-relational-queries-and-projections.rfc.md:329)).

**Resolution criterion:** Import LLP 0053’s exact durable-obligation, remove-or-replace, causing-version, and ACK-discharge requirements into gate 7(b); remove lease expiry from 7(b); permit 7(b) `N/A` only when the frozen scope proves that no subscription or result is auth-scoped or permission-dependent; and permit 7(c) `N/A` only when there is no lease-backed retained auth state.

### 4. MATERIAL — Exit criterion 3 does not prove execution-identity element 5

**Evidence:** The Plan defines element 5 as “store semantics and schema epoch” ([LLP 0129:305](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:305)), but criterion 3 requires only “an activation-carry check in the settlement submission” ([LLP 0129:697](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:697)). Field carriage proves neither store-semantic compatibility nor safe behavior on a schema/artifact mismatch.

This is load-bearing: LLP 0133 says the activation travels only as an untrusted claim and that mismatch disposition remains owned elsewhere; silently settling as matched is forbidden ([LLP 0133:569](/Users/ccheever/projects/snapback/llp/0133-local-settlement.spec.md:569)). LLP 0126 requires the whole tuple before a same-code claim ([LLP 0126:507](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:507)).

**Resolution criterion:** Make element 5 an owned, versioned store-semantics-and-activation artifact. Require conformance on both executions plus tests for activation mismatch refusal/quarantine/resync before any same-code or `Parity` claim.

### 5. MATERIAL — The Plan’s completion contract is knowingly non-executable

**Evidence:** A phase without a falsifiable criterion may not exit ([LLP 0129:641](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:641)); completion requires Phases 0, 1, 2a, and 2b to execute with their gates passed ([LLP 0129:719](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:719)); and the document then concedes completion is unreachable because Phase 2a has no named artifact or pass/fail condition ([LLP 0129:739](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:739)). OQ9 remains open ([LLP 0129:1469](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1469)), while four mandatory measurements still lack named targets and defined threshold semantics ([LLP 0129:800](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:800)).

Recording the collision is honest, but does not make an Accepted Plan executable.

**Resolution criterion:** Answer OQ9 by either giving Phase 2a named artifacts, thresholds, pass/fail branches, and a failed-target disposition, or moving it outside program completion. Name the artifact and target for every mandatory measurement and state whether each is informational or gating. Apply the same falsifiability audit to Phase 1’s “sizing” gate and Phase 2b’s “working sidecar” gate.

### 6. MATERIAL — Phase 1’s gate remains unresolved, and the Plan appears to amend an owner it does not control

**Evidence:** Phase 1’s named gate is sizing plus D5 ([LLP 0129:478](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:478)), but the Plan admits that this omits the end-to-end substrate its promised overlays and `Parity` require. It responds by declaring “SD-5 auto-advance is SUSPENDED” ([LLP 0129:494](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:494)).

LLP 0130 owns SD-5, says successful gates do not escalate while gate failure or scope change does, and reserves amendments to dated revisions of LLP 0130 ([LLP 0130:74](/Users/ccheever/projects/snapback/llp/0130-program-standing-decisions.decision.md:74), [LLP 0130:104](/Users/ccheever/projects/snapback/llp/0130-program-standing-decisions.decision.md:104)). OQ8 is still open, and the Option-C lab is consequently unrunnable.

**Resolution criterion:** Either characterize the discovery as SD-5’s existing scope-change escalation without claiming to suspend SD-5, or land an author-dated LLP 0130 amendment. Answer OQ8 by separating evaluator/conformance evidence from end-to-end shipping evidence and naming exactly which gate SD-5 keys off.

### 7. MATERIAL — The owner ledger’s delta-resume status is false in the reviewed working tree

**Evidence:** The Plan twice says the version-based delta-resume consumer is “unbuilt,” including the stronger claim that the journal floor has “no client caller” ([LLP 0129:353](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:353), [LLP 0129:634](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:634)). LLP 0008 says LLP 0090’s D1.3 ladder is exactly that consumer ([LLP 0008:612](/Users/ccheever/projects/snapback/llp/0008-local-first-sync-and-realtime.rfc.md:612)). Current code checks `journal_resume_requires_resnapshot`, performs rung-2 replay, and emits `CurrentAsOf` or deltas ([src/local.rs:12736](/Users/ccheever/projects/snapback/src/local.rs:12736)); the client test sends a membership witness and applies predicate-exit replay ([rqs-resume-suite.mjs:267](/Users/ccheever/projects/snapback/packages/snapback-client/rqs-resume-suite.mjs:267)).

**Resolution criterion:** Mark ledger row 7 landed or partial at its exact `rqsEligible`/`mset1` reach, name only genuine remaining proof classes, and reconcile LLP 0127’s same stale “unbuilt” assertion.

### 8. MATERIAL — Safety gates 2 and 9 assign the Fleet failure inconsistently

**Evidence:** Gate 2 literally requires a claimed-successful intent to be “visible exactly once” ([LLP 0129:1064](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1064)). The Fleet paragraph then assigns a successful-but-not-visible result exclusively to gate 9 and says no gate-2 nonclaim remains ([LLP 0129:1154](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1154)). Proving that all writes committed disproves partial/duplicate commit, but does not satisfy the literal visibility wording.

**Resolution criterion:** Define gate 2 as authoritative effects committing atomically and idempotently exactly once, reserving query visibility and completeness for gate 9; alternatively, classify Fleet under both. The candidate eligibility test must have one unambiguous partition.

### 9. DETAIL — The independence artifact scheme is under-specified

**Evidence:** The protocol requires one diary per workload, says builders cannot see “the other’s diary,” requires per-builder × workload × attempt evidence to be sealed, and promises exactly three diaries ([LLP 0129:1201](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1201), [LLP 0129:1326](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1326), [LLP 0129:1344](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1344)). That does not specify one auditable blinding mechanism.

**Resolution criterion:** Keep three synthesis diaries, but require separately named, access-controlled per-builder attempt capsules—six for Candidate A and analogous B capsules—with source-tree digests, timestamps, notes, and evidence sealed before cross-disclosure.

### 10. DETAIL — Workload and safety status vocabularies blur in the measurement schema

**Evidence:** Workload checks use only `PASS/GAP/FAIL`, while safety rows additionally permit scoped `N/A` ([LLP 0129:1050](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1050)). The measurement list later records “frozen checks and safety rows as PASS/GAP/FAIL/N/A” ([LLP 0129:1181](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1181)).

**Resolution criterion:** Use separate typed fields/enums and state explicitly that a required workload fact never accepts `N/A`.

## 4. Suggestions

- Remove the unsupported “second-largest planned measurement” ranking and replace “prerequisites exhaustively” with a single consolidated scheduling checklist.

- Add a known-expressible negative-control workload and a bounded synthesis/minimal-counterexample pass before declaring either candidate language inexpressible.

- Freeze common numeric bounded-custody ceilings; merely requiring each candidate to choose some finite ceiling weakens cross-candidate comparison.

- Qualify the guide’s default-store prose with the same Web Locks and usable-directory prerequisites already present in `guide/capabilities.md` ([offline-and-retention.md:29](/Users/ccheever/projects/snapback/guide/sync/offline-and-retention.md:29); [capabilities.md:60](/Users/ccheever/projects/snapback/guide/capabilities.md:60)).

- Say the Fleet repair landed “on `origin/main` as `b52e3b9c`.” It was not an ancestor of the requested `2506ed72` review base.

- Correct Diary 0046 and the bakeoff summary’s residual suggestion that LLP 0090 intentionally forbids speculative restart rendering; the Plan now correctly establishes that D3 governs `resumeFromToken`, not presentation.

## 5. Open questions

1. Will Phase 0’s gate remain whole or split, and who owns the integrated authenticated browser-restart witness?

2. What are Phase 1’s evaluator gate and end-to-end shipping gate, and which one governs SD-5 advancement?

3. Is Phase 2a a required phase or conditional research? What are the artifacts, thresholds, and failure dispositions for it and the other mandatory measurements?

4. What closed semantic language constitutes Candidate B, who owns it, and what evidence can establish universal inexpressibility rather than two failed implementations?

5. What classifications represent implementation, harness, environmental, compound-cause, and unresolved Candidate-A/B failures?

6. Which auth-scoped subscription and lease-backed retention cases are actually included in each Option-C recommendation boundary?

7. Which owner defines execution-identity element 5’s store-semantics profile and schema/artifact mismatch disposition?

## 6. Readiness verdict

NOT READY

The proposal’s direction is good, its revised bakeoff narration is honest, and its ownership boundary is sound. However, the remaining cold-boot overclaim violates the Plan’s own claim rule; the decision lab can still infer inexpressibility from shared defects or an unbounded Candidate-B space; the revocation gate omits a load-bearing security obligation; and the tuple, advancement, and completion gates are not yet executable. These defects can change capability claims, safety outcomes, phase progression, or the Option-C recommendation itself.
## Round 6 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** OpenAI Codex CLI `codex-cli 0.146.0`, model
`gpt-5.6-sol`, provider `openai`, non-interactive `codex exec`, sandbox
`read-only`, approval `never`
**Effort:** `model_reasoning_effort="ultra"`
**Session ID:** `019fbd2b-914c-7022-87e4-0513bebf7c5e`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-resumed session; barred from `llp/reviews/`
**Target:** `llp/0129-local-first-program.plan.md`
**Target SHA-256:** `5b04d52f0b908669a45226dba5d565d2f72641e7f6921cc9dbdb2ed15652474d`
**Instruction capsule SHA-256:** `2208029c14caa96ddd7e80e433ef816e39ac4023af0731bef0f0ca5b5131f992`
**Status:** completed
**Verdict:** NOT READY

**Third split verdict; the loop closed after this round.** Fable
returned READY on this revision (its third READY, at rounds 3, 4, and
6); Codex did not. Per the skill's stop rule the loop halts here, with
the fixable residue applied as v0.8 and the author-owned residue routed
as §Open questions 5–11 — the reviewers exposed human product decisions,
which this loop may not settle.

**Orchestrator verification (outside the verbatim body).** Both blocking
findings are CONFIRMED and both are defects in text this loop itself
wrote:

- **Blocking 1.** Gate 6's v0.5 sandbox list ("the retained query store,
  the outbox, the IR plan and its ledger, **and nothing else**") is
  literally wrong. LLP 0051 D5's contract requires schema, initial rows,
  an IR plan **or module**, arguments, ledger, and principal, and LLP
  0133 treats explicit application arguments as legitimate validated
  data. Read as written, no arg-bearing Candidate A could execute and
  Candidate C — whose defining artifact is an app-authored mutator, not
  an IR plan — could not exist, while gate 6 binds every candidate.
- **Blocking 2.** "The matrix marks protected cases `N/A`" left
  "protected cases" undefined, and because `N/A` changes eligibility the
  unsafe reading (waiving gate-7 authority tests) had to be closed
  rather than merely disfavoured.
- **Blocking 3 / material 4 / material 5** are the same author-owned
  residues the document already routes (element 5's owner; the
  cold-process vocabulary collision, which reaches LLP 0043/0053 and is
  therefore *their* owners' amendment under constraint 7; the unowned
  integrated witness). v0.8 raises criterion 3's element-5 harness and
  states the normative consequence, and files both remaining
  obligations as tickets.

### Review (verbatim as received)

## 1. Overall assessment

I reviewed the hash-matched working-tree snapshot of LLP 0129 (`5b04d52f…474d`). It remained unchanged during review.

The program’s core direction is good: prefer the shared IR, increase client authority only on measured evidence, preserve server settlement, and require the author to admit Option C. The revised empirical protocol is unusually disciplined about frozen workloads, independent builders, real-browser carriers, misattribution, and nonclaims. Its characterization of the Zero/Replicache bakeoff is accurate.

It is nevertheless not ready. Three normative defects can make the decision lab impossible or unsafe to score, and the Phase 0 correction has not been propagated through all retained evidence and governing claims. These are correctness and decision-quality problems, not optional polish.

## 2. Strengths

- **The bakeoff is characterized honestly.** The Plan correctly distinguishes Kanban’s duplicated transform, Calendar’s pending sidecar, and Notebook’s unexecuted restart/rebase GAPs ([LLP 0129, lines 884–904](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:884)). Notebook’s checks are indeed immediate GAP declarations, not executed failures ([acceptance, lines 133–138](/Users/ccheever/projects/snapback/demos/zero-bakeoff/apps/field-notebook/acceptance/snapback.mjs:133)).

- **The Phase 0 proof-scope correction is substantially accurate.** The acceptance forces the file store and runs in one Node process ([acceptance, lines 61–65](/Users/ccheever/projects/snapback/demos/public-dashboard/tests/acceptance/offline-local-first.mjs:61), [lines 155–166](/Users/ccheever/projects/snapback/demos/public-dashboard/tests/acceptance/offline-local-first.mjs:155)); it does not exercise React, real IndexedDB, or protected refusal. The Plan, capability row, and guide now agree on that reach ([capability row](/Users/ccheever/projects/snapback/guide/capabilities.md:60), [guide, lines 36–60](/Users/ccheever/projects/snapback/guide/sync/offline-and-retention.md:36)).

- **Option C is not pre-admitted.** The outcomes are least-power ordered, Outcome 3 is only a recommendation, and admission remains the author’s decision ([LLP 0129, lines 915–946](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:915), [lines 1468–1472](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1468)). This agrees with ER-1 ([LLP 0130, lines 88–91](/Users/ccheever/projects/snapback/llp/0130-program-standing-decisions.decision.md:88)).

- **The experimental design is strong.** Frozen product facts, real browser-process restart, independent attempts, separate workload/safety vocabularies, sealed evidence, and owner-validated attribution make this much more decision-grade than a conventional prototype comparison.

- **The Fleet correction is accurate.** The retained failure was false query completeness, not failed atomic commit, and `b52e3b9c` remediated it on `origin/main` ([LLP 0129, lines 1251–1268](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1251), [summary, lines 81–98](/Users/ccheever/projects/snapback/demos/zero-bakeoff/reports/summary.md:81)).

## 3. Concerns

### 1. BLOCKING — Gate 6’s exhaustive sandbox contract excludes required candidate inputs

**Evidence:** Gate 6 says every candidate’s “complete input surface” is the retained store, outbox, IR plan, and host-answer ledger “and nothing else” ([LLP 0129, lines 1159–1171](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1159)). That omits validated mutation arguments, schema/activation data, the operation artifact, and principal/context projection. It also requires an IR plan for Candidate C, whose defining artifact is an app-authored client mutator ([lines 1067–1074](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1067)).

The owning D5 contract explicitly requires schema, initial rows, an IR plan **or module**, arguments, ledger, and principal ([LLP 0051, lines 687–690](/Users/ccheever/projects/snapback/llp/0051-language-neutral-data-tier.rfc.md:687)). LLP 0133 likewise classifies explicit application arguments as legitimate validated data ([lines 133–139](/Users/ccheever/projects/snapback/llp/0133-local-settlement.spec.md:133)).

Taken literally, ordinary arg-bearing Candidate A mutations cannot execute and Candidate C cannot exist, yet every candidate must pass gate 6.

**Resolution criterion:** Replace the list with a complete typed surface conforming to the owning contracts: schema/store snapshot, operation artifact appropriate to the candidate, validated arguments, bounded client-visible authority projection labeled non-authoritative, outbox, and deterministic-answer ledger. Retain the explicit network, action, ambient-clock, randomness, and undeclared-capability denials. If “input surface” meant only ambient capabilities, say so and separately enumerate ordinary execution inputs.

### 2. BLOCKING — The protected/public `N/A` instructions have incompatible operational readings

**Evidence:** The required matrix first says all four gate-7 authority cases run separately ([LLP 0129, lines 1098–1101](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1098)), then says that without shipped protected lease custody “the matrix marks protected cases `N/A`” ([lines 1110–1114](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1110)).

The later gate-7 rule says precisely that unshipped protected capability and public data do **not** license `N/A`: authenticated clients still exercise session transitions, and permission-change testing is omitted only after proving no result is auth-scoped or permission-dependent ([lines 1212–1239](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1212)). That matters because undeclared subscriptions are auth-scoped ([LLP 0053, lines 297–302](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:297)), and even all-`public-read` relational plans remain auth-scoped in v1 ([LLP 0080, lines 331–339](/Users/ccheever/projects/snapback/llp/0080-portable-relational-queries-and-projections.rfc.md:331)).

The narrow interpretation—only protected-retention variants become N/A—is probably intended, but “protected cases” is undefined. Because `N/A` changes eligibility, the unsafe reading cannot remain available.

**Resolution criterion:** Rewrite lines 1110–1114 to say only protected-retention recommendation scope is excluded. State that gate-7 applicability is determined exclusively by 7(a)–(d), including applicable public/auth-scoped authority transitions, and require every `N/A` to name its exact excluded scope.

### 3. BLOCKING — Element 5 can pass without proving compatibility, and the lab’s “exhaustive” prerequisites omit it

**Evidence:** Exit criterion 3 requires only an “activation-carry check” for store semantics/schema epoch ([LLP 0129, lines 765–772](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:765)). OQ11 then correctly admits that carriage proves neither store-semantic compatibility nor safe mismatch behavior ([lines 1592–1604](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1592)). Transparency about the defect does not repair the normative criterion.

LLP 0133 says activation travels as an untrusted claim, mismatch must be detectable, and silent settle-as-matched is forbidden ([lines 569–587](/Users/ccheever/projects/snapback/llp/0133-local-settlement.spec.md:569)). The decision lab also requires store/schema fencing in safety gate 5 ([LLP 0129, lines 1156–1158](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1156)), with every GAP making a candidate ineligible. Nevertheless, the scheduling prerequisites advertised as exhaustive mention OQ8, evaluator readiness, owner, and timebox—but not OQ11 ([lines 983–1005](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:983)).

Thus all listed prerequisites can pass while every candidate is still incapable of passing gate 5; separately, the current exit harness permits a same-code claim after proving only that an untrusted value was transported.

**Resolution criterion:** Name element 5’s owner; land or explicitly bound its store/schema compatibility and mismatch contract; replace activation carriage with conformance on both executions plus mismatch refusal/quarantine/resync tests; and add that closure to Phase 1 and decision-lab prerequisites. Until then, state normatively that criterion 3 cannot pass and no affected claim can ship.

### 4. MATERIAL — The Phase 0 correction has not propagated to retained artifacts or governing evidence claims

**Evidence:** The Plan now correctly says no client process was restarted ([LLP 0129, lines 498–520](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:498)), but its earlier operative description still says “cold boot” ([lines 413–416](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:413)). The suite and retained JSON receipt likewise retain “cold relaunch” check names ([suite, lines 155–166](/Users/ccheever/projects/snapback/demos/public-dashboard/tests/acceptance/offline-local-first.mjs:155), [receipt, line 34](/Users/ccheever/projects/snapback/demos/public-dashboard/offline-acceptance-report.json:34)).

More importantly, the owning corpus still claims a “cold process” Contract proof ([LLP 0043, lines 381–384 and 422–423](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:381), [LLP 0053, lines 2093–2098](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:2093)). Their cited card-game test actually constructs new wrappers in the same process over the same explicitly shared memory-store state ([authority-scope, lines 255–257](/Users/ccheever/projects/snapback/demos/card-game/tests/acceptance/authority-scope.mjs:255), [lines 461–489](/Users/ccheever/projects/snapback/demos/card-game/tests/acceptance/authority-scope.mjs:461)).

Even if LLP 0129’s “any carrier” is read narrowly as only JS-arm carriers, the project currently uses “cold process” for two different proof classes. That conflicts with constraint 2’s claim honesty and constraint 7’s ownership discipline.

**Resolution criterion:** Rename the same-process checks directly and regenerate retained reports. Amend LLPs 0043/0053 to say “fresh wrappers over retained state in one process,” or land a genuinely process-isolated witness before retaining “cold-process” claims.

### 5. MATERIAL — Phase 0’s required integrated witness is recognized but remains unowned and outside OQ7’s stated resolution path

**Evidence:** Exit criterion 2 correctly observes that the two existing tickets can both close without proving the required authenticated React/browser/full-process conjunction and says a separate named artifact is necessary ([LLP 0129, lines 749–757](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:749)). No such ticket or owner is named.

OQ7 nevertheless frames one possible disposition as holding the whole gate open only until the existing browser ticket lands ([lines 1548–1558](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1548)). That ticket proves a public authority-independent query, browser restart, and protected refusal—not lease-valid authorized rows in an authenticated shell ([browser issue, lines 40–49](/Users/ccheever/projects/snapback/issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md:40)). The lease ticket permits a headless witness ([lease issue, lines 40–43](/Users/ccheever/projects/snapback/issues/20260731-js-arm-lease-custody-and-sessions-outbox.md:40)).

Consequently, OQ7 can be answered and its named browser ticket closed while criteria 1/2’s conjunction remains unproved; the relationship between SD-5 gate advancement and Phase 0 exit remains ambiguous.

**Resolution criterion:** Create and name one owned integrated artifact covering authenticated shell, authorized retained rows, React, real IndexedDB, full browser-process restart, lease behavior, reconnect, and observer convergence. State explicitly whether it is a conjunct of the SD-5 Phase 0 gate, the Phase 0 exit criteria, or both, and prevent a public-browser-only witness from auto-advancing the phase.

## 4. Suggestions

These are non-blocking once the concerns above are repaired:

- Split the lab into an **A expressiveness probe** and a later **B/C admission lab**. A can yield Outcome 0/1 once shared substrate is ready; B/C should have separate entry criteria covering Candidate B’s closed language, element 5, and all admission-grade safety owners.

- Rename exit criterion 2 from “Arm claim parity” to “Retention/replay reach parity” to avoid confusion with capital-P `Parity`.

- Rename acceptance check 9: its current title claims no-`Parity`, retained-label, and memory-fallback coverage, while its body tests only explicit opt-out/kill-switch behavior ([lines 303–320](/Users/ccheever/projects/snapback/demos/public-dashboard/tests/acceptance/offline-local-first.mjs:303)).

- Replace “the lab’s output is a decision recommendation” with “decision disposition, possibly a recommendation,” because Outcome 0 is explicitly no recommendation.

- Remove or define the unsupported “second-largest planned measurement by scope” ranking.

- Say the Fleet fix “landed on `origin/main`” because `b52e3b9c` is not an ancestor of this branch’s reviewed HEAD.

## 5. Open questions

1. What is Candidate B’s closed language—typed inputs/outputs, computation, effects, composition, anti-duplication rule—and who adjudicates it? The current OQ10 safely prevents B testing and Outcome 3, but this must be answered before that branch can run.

2. Does Phase 1 have separate evaluator/conformance and end-to-end product gates, and which one controls SD-5 advancement?

3. Who owns execution-identity element 5 and its store-semantics/schema-epoch mismatch disposition?

4. Is the integrated authenticated browser-restart witness part of Phase 0’s SD-5 gate, its exit criteria, or both?

5. Is Phase 2a a phase with a falsifiable threshold or conditional research outside completion? The Plan correctly blocks false completion today, but completion remains intentionally unreachable until OQ9 is answered ([LLP 0129, lines 807–818](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:807)).

6. Who owns and timeboxes the remaining phase and decision-lab work? The general before-start rule is not a substitute for the missing concrete assignments.

## 6. Readiness verdict

NOT READY

The architecture and evidence posture are fundamentally sound, and the revised bakeoff and Phase 0 characterizations are mostly accurate. However, gate 6 currently excludes necessary execution inputs, the protected/public `N/A` language can waive required authority tests, and element 5’s knowingly insufficient proof can still feed both scheduling and same-code claims. The unreconciled cold-process evidence vocabulary and unowned integrated Phase 0 witness add material claim and execution gaps. These must be resolved before the Plan has no remaining material correctness, safety, or decision-quality concern.