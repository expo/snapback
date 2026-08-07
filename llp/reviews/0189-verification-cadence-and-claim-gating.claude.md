# Review artifact — LLP 0189, Claude family

## Round 1 — 2026-08-07

- Reviewer: claude-fable-5, fresh-context general-purpose subagent
  (capsule-only instructions; not the orchestrating/revising session)
- Target revision r1 (branch commit `485582c60`) sha256
  `9726125565d9b428feab289559b3438cce69851eaf17a40d65f9823b93ee0479`;
  capsule `78653c9a6f675353`; instructions
  `aac8a48a96b1b7a7088a818cc98c3f58e312f0f925af5454a9eae99398057ff3`
- Runtime 317 s; 7 tool uses; no redaction (capsule-only, no external sends)
- Author scope guidance in force: cadence philosophy ruled, mechanism flaws
  in scope
- Body below is verbatim from the reviewer's final message.

---

# Review — LLP 0189: Verification cadence and claim gating (round 1)

**Reviewer:** Claude (Fable 5), independent fresh-context reviewer, dual-family blind round.
**Target:** `0189-verification-cadence-and-claim-gating.decision.md`
**Binding:** `sha256(target) = 9726125565d9b428feab289559b3438cce69851eaf17a40d65f9823b93ee0479` (verified against the capsule copy).
**Capsule read in full:** the target, LLP 0175 (all ~814 lines), both tickets, the landing diff, and the instructions.

**Scope discipline:** The cadence philosophy — fast/affected landings, scheduled complete battery with fix-forward tickets, claims as snapshots — is ruled and I do not contest it. Every finding below is a flaw *in the mechanism as designed*, and every proposed fix stays inside the ruled framework (none reintroduces exact-commit gating or blocks landings on complete verification).

Overall: the decision is well-motivated, the incidents genuinely support the diagnosis, and D-1/D-2/D-5/D-7 are sound. The material problems cluster in D-3/D-4/D-6 — the parts the implementation ticket has to build — where the current text leaves loopholes that would let coverage move in name but vanish in substance, and would make an invalid or impugned claim visually indistinguishable from a clean one.

---

## MATERIAL findings

### M1 — D-4's "coverage moves; it never vanishes" is not true as specified: a frozen-record drift gate is not equivalent coverage to digest membership

D-4: *"Wave-shared proof harnesses, metrology, and fixture files move out of claim digests and are protected instead by their own frozen-record drift gates… Coverage moves; it never vanishes: removing a file from a digest is legal only in the same change that adds (or names the existing) drift gate covering it."*

These two protections have different semantics, and the decision treats them as interchangeable:

- **Digest membership** means: if this file changes, the *claim must be requalified* — the capability is re-proven under the new bytes.
- **A frozen-record drift gate** (per the substrate's admission rule, LLP 0175 D2.1: *"An entry is admitted only when its canonical gate recomputes a value from source and compares that value with a committed frozen record"*) means: a committed projection must be regenerated in the same change. It says nothing about whether any standing claim still holds under the changed file.

Three concrete failure modes follow:

1. **Vacuous gates for record-less files.** Many wave-shared proof-harness files are pure executable logic with no natural recomputable frozen record. Under the 0175 admission rule they cannot get a legitimate registry entry at all. An implementer forced to satisfy D-4's removal rule will either violate the registry admission rule or install a hash-pin pseudo-record — a gate whose record is regenerated in the same change as any edit and therefore fires only when someone forgets to regenerate. That satisfies D-4's letter ("a gate covering it exists") while protecting nothing about any claim. This is exactly the "silently lose coverage" loophole the mechanism must not have, and it is reachable by an honest implementer, not only a gaming one.
2. **Dependency closure is cut.** D-4 keeps "the checkers that define that claim's semantics" in the digest, but those checkers import the wave-shared harnesses that just left it. A harness change that alters what an in-digest checker actually computes changes the claim's effective semantics — with no digest rotation, no requalification, and only the harness's (possibly vacuous) record-freshness gate in between. The 2026-08-07 fork withdrawal happened precisely because the v2 digest covered this transitive surface; D-4 removes that coverage without a stated replacement for the semantic-dependency case.
3. **No classification rule or reviewer for the scoping decision.** Nothing in D-4 says who decides which checkers "define the claim's semantics" versus which are "wave-shared harness," or that this classification is itself part of the reviewed, author-accepted claim record. Under landing pressure, an inconvenient checker gets classified as harness and exits the digest with a trivial gate.

**Fix within the ruled framework (small):** (a) require that a departing file's replacement gate protect a record the claim's scoped checkers *consume* (e.g., behavioral fixtures / checker-output records), and state explicitly that a bare content-hash pin does not satisfy D-4; (b) require the scoped digest to close over semantics-affecting imports of in-digest checkers, or pin those imports by content in the claim record so their change is detectable as claim-relevant; (c) make the in-scope/out-of-scope classification part of the named-author-accepted claim record. The implementation ticket's fixture ("a departing file without its gate refuses") tests only gate *presence*, so none of this is currently caught anywhere.

### M2 — Re-scoping a published claim's digest is not itself gated, which makes D-3's invalidation rule bypassable

D-4 constrains *how* a file leaves a digest (same-change drift gate) but never says that narrowing a **published** claim's digest is itself a claim-relevant change. D-3 invalidates a claim when "the scoped surface changed without requalification" — but if the scope definition can be edited without requalification or named-author acceptance, the obvious game is: about to land a change that would invalidate a claim → first land a re-scope that moves the file out (with a trivial gate, per M1) → land the change out-of-scope → claim survives untouched. The fork requalification happens to bundle re-scope with a fresh qualification C, but that is the ticket's choice, not a rule in the decision; the general rule is absent.

**Fix (one sentence):** any change to a published claim's digest membership is itself a scoped-surface change under D-3 — it requires requalification, or at minimum fresh named-author acceptance binding the new scope. Without this sentence D-3 and D-4 together are gameable end-to-end.

### M3 — Nothing connects battery reds to the standing claims they impugn; "fix forward promptly" has no teeth; a claim with a red defining checker is indistinguishable from a clean one

D-1: *"A battery red does not retroactively invalidate unrelated landings or standing claims; it names work."* D-3 makes withdrawal warranted **only** for (a) unrequalified scoped-surface change or (b) discovered factual wrongness. Read together:

- After promotion/publication, a claim's *own* claim-relevant gate can go red in the battery. That is prima facie evidence toward D-3(b), but no mechanism performs the connection: the battery-red automation (D-1, implementation ticket piece 3) files `battery-<gate>` tickets keyed by gate, with no cross-reference from failing gate to the published claims whose scoped digests include that surface. D-6 checks claim-relevant battery greenness only at promotion time; afterwards, never.
- There is also a genuine parse tension inside the decision: D-1's "does not… invalidate **unrelated** landings or standing claims" can be read as leaving *related* standing claims invalidatable by a battery red, while D-3's exclusive two-condition list says a battery red alone never invalidates anything. An implementer cannot tell which is intended.
- "The fleet fixes promptly" and the Non-goals' "Battery reds are never ignored" have no enforcement anywhere: no aging rule, no escalation, no cap, no consequence except at promotion time for the specific gates a future promotion happens to need. The 433-commit incident shows this repo does sustain long-lived reds; under the old regime a red at least blocked something, forcing attention. Under the new regime a red on a gate that is claim-relevant only to *already-published* claims blocks nothing, forever.

Net effect: the capability index can advertise a capability whose defining checker has been red in the authoritative battery for days, and a reader cannot distinguish that claim from a healthy one. That is precisely "mask regressions indefinitely / honest claims indistinguishable from stale ones" — a mechanism defect, not a cadence complaint.

**Fix within the ruled framework:** battery-red ticket automation cross-references published claims whose scoped digest (or claim-relevant gate set) intersects the failing gate, and the claim record / capability-index row must name the open ticket while it stands — a visible "standing, with known red" state. Optionally add an aging rule (a battery ticket open past N cycles escalates to the author). Fix-forward is preserved; only the distinguishability is restored.

### M4 — D-3's withdrawal semantics are underspecified in exactly the ways an implementer must resolve: interim state, "warranted" vs. required, "next natural cycle," and ownership

D-3: *"Withdrawal is warranted only when (a) the scoped surface changed without requalification, or (b)… Requalification then happens on the next natural cycle, not as an emergency that races the fleet."*

- **"Warranted" is not "required."** When the oracle detects an unrequalified scoped-surface change, is withdrawal (capability row → `none`/`withheld`) mandatory and immediate, or discretionary? If discretionary, a claim known-invalid by the decision's own definition may keep advertising "until someone gets to it" — the dishonest window is unbounded because…
- **"Next natural cycle" is undefined.** Cycle of what — the six-hour battery, a release train, a wave? No bound, no definition. The implementation ticket cannot encode it.
- **No owner.** The fork ticket names Charlie as owner; the general rule assigns requalification to nobody. The review instructions' question — "who requalifies a claim whose scoped surface changed" — has no answer in the text.
- The instruction to requalify "not as an emergency" is right, but it is only honest if the claim is *withdrawn or visibly flagged* during the interim. The decision never says which.

**Fix:** one paragraph — on detected unrequalified scoped-surface change, the claim's advertised row drops to its prior honest state (or gains a mandatory "invalid, requalification pending: <ticket>" marker) within one battery period; requalification tickets name an owner; define "natural cycle" (e.g., the next scheduled battery plus the claim's normal qualification protocol). This is D-3's core semantics, listed in the instructions as a build target; as written it would produce a gameable system, not merely an incomplete one.

### M5 — D-6's battery reference can be satisfied by a battery that never contained the candidate

D-6: *"(b) the most recent scheduled complete battery green on its claim-relevant gates."* The battery runs latest-main every six hours; landings gap ~0.1 min. A candidate can land and promote minutes later, referencing a battery run on a revision that predates the candidate entirely. The battery — the *authoritative verdict* whose whole purpose (0175 D2.3) is catching cross-subsystem interactions that scoped evidence misses — then vouches for a world without the promoted code, and the window is deliberately exploitable: land a risky change immediately after a green battery and promote inside the stale-green window. For external-facing promotions (npm), fix-forward after the next battery is far more expensive than for internal landings.

**Fix that does not reintroduce exact-commit binding:** require the referenced battery's tested revision to *contain* (be a descendant of) the qualification commit — achievable by waiting at most one scheduled cycle or using D-1's on-demand battery; still coalesced latest-main, never exact-commit, never racing the fleet. If the author instead deliberately accepts the stale window, D-6 should say so explicitly, because as written clause (b) implies a guarantee it does not deliver.

### M6 — The landing amends LLP 0175's Revised header but leaves the substrate's body contradicting D-6, and telemetry's exact-current authority is left in a D-6/D-7 limbo

The landing diff touches only 0175's Revised header. Left standing in the Accepted substrate:

- 0175 Acceptance #10: *"a complete latest-main proof is green before release or capability promotion"* — directly contradicts D-6's *"any unrelated red gates ticketed and named in the promotion record rather than blocking it."*
- 0175 D2.4: *"Release claims remain blocked unless their complete required matrix is recent and green"* — same conflict.
- 0175 D2.4 also makes exact-current telemetry evidence a "release / capability-promotion authority" for a frozen candidate (LLP 0154's amended trust contract). Is that swept by D-6's blanket *"Existing 'green local proof at the exact candidate SHA' preconditions are re-scoped to this form"*, or preserved as a D-7 stricter per-claim protocol? D-7 names only LLP 0162 row 13. An implementer wiring the open telemetry release/promotion blocker cannot decide which document governs.

Two live normative documents now disagree on whether unrelated battery reds block promotion, and the decision's own D-7 carve-out is ambiguous for a named, already-tracked case. The instructions list substrate mismatches as in-scope real flaws; this one was created by the same landing that had the diff open. **Fix:** amend 0175 Acceptance #10 and the D2.4 release sentences in this landing (or in the decision's Required updates), and state telemetry exact-current's disposition (re-scoped vs. D-7-preserved) explicitly.

---

## MINOR findings

1. **D-1 cadence floor vs. D-6 staleness.** "At least twice daily" permits a 12-hour battery staleness window while D-6 leans on battery recency; state the maximum staleness D-6 tolerates or tie the floor to it.
2. **Battery ticket idempotency can mask a second root cause.** Keying idempotency on an open `battery-<gate>` ticket means a *new, distinct* failure of the same gate while the first ticket is open files nothing; the D-1 text says "one per root failure" but the implementation keys per gate. Align text and key (e.g., include a failure signature), or accept and note the masking.
3. **Transition rule for other published claims with legacy unscoped digests.** The Consequences resolve only the derived-fork claim. Until other claims re-scope, D-3 ("wave-shared churn never invalidates") and their current all-inclusive digests (oracle refuses on any covered change) contradict; say which wins in the interim (presumably: legacy digests keep their old semantics until re-scoped).
4. **"Authoritative verdict" wording.** D-1 calls the battery authoritative while giving its reds no invalidating force over anything; the word invites over-reading. "Authoritative completeness signal" or similar would be more precise.
5. **Sequencing wording.** Consequences say "select the fresh qualification C once" while the amended ticket says select C *after* the re-scope and the two checker-hardening tickets land; not contradictory (the "once" targets HEAD-chasing) but worth one clarifying clause.
6. **D-6 "claim-relevant gates" enumeration.** Who enumerates the claim-relevant gate set for a promotion record should be stated (naturally: derived from the D-4 scoped digest in the claim record) so promoters cannot narrow it ad hoc — this becomes automatic if M1(c)/M2 are fixed.

---

## Assessment

The ruling's direction is coherent and the incidents genuinely demand it. But the mechanism, as currently written, has (i) a coverage-equivalence claim at the heart of D-4 that can be satisfied vacuously, (ii) an ungated scope-editing path that defeats D-3, (iii) no post-publication linkage between the authoritative battery and the claims it exists to underwrite, (iv) withdrawal semantics too underspecified to implement honestly, (v) a timing hole in D-6, and (vi) a substrate left contradicting the decision by the same landing. Each fix is small and none touches the ruled cadence philosophy, but M1–M4 in particular are exactly the class of loophole the instructions ask to catch before the implementation ticket encodes them.

VERDICT: NOT READY

## Round 2 — 2026-08-07 (delta round)

- Reviewer: claude-fable-5, fresh-context general-purpose subagent
  (capsule-only; not the orchestrating/revising session; blind to round 1)
- Target revision r2 (branch commit `b13a15cb6`) sha256
  `f3a60433815f80488cab369c9eea3c59fa6ad910fc7cedaa954e58c5e9e8354b`;
  capsule `1cd5fb7a6fb04efb`; instructions
  `945f5cd980ca4f849ce4b723ccc29e2a09a40f055e820820d360e4a0139a34d4`
- Delta-round protocol: every concern classified IN-DELTA vs PRE-EXISTING
- Runtime 309 s; 8 tool uses; no redaction (capsule-only, no external sends)
- Body below is verbatim from the reviewer's final message.

---

# Review — LLP 0189 r2 (delta round, independent reviewer)

**Target:** `0189-verification-cadence-and-claim-gating.decision.md`, revision r2
**Hash binding:** `sha256(target r2) = f3a60433815f80488cab369c9eea3c59fa6ad910fc7cedaa954e58c5e9e8354b` (recomputed from the capsule copy; matches the instructions)
**Capsule read in full:** target r2 (212 lines), `delta-r1-to-r2.patch` (253 lines, line by line), LLP 0175 (881 lines), both tickets, instructions.
**Scope honored:** the cadence ruling (scheduled battery as authority, fast/affected landings, claims as snapshots) is treated as ruled; this review examines only whether the mechanism as designed is internally consistent, implementable, and not gameable — with special force on the r2 delta text.

## Delta audit summary

The r1→r2 delta does six things: (1) D-1 gains signature-keyed tickets, claim cross-references, "standing, with known red" as a named state, and a four-run author escalation; (2) D-3 gains the prima-facie-(b) triage rule for claim-relevant battery reds, a mandatory demotion-or-marker window, and the scope-edit-is-a-scoped-surface-change rule; (3) D-4 gains semantic-role scoping, input closure pinned in the claim record, author-accepted scope classification, and the drift-gate admission bar; (4) D-5 gains the semantic-integration clause; (5) D-6 gains revision-containment, on-demand eligibility, newest-run-controls, two-period freshness, and scope-derived gate sets; (6) D-7 names the telemetry exact-current carve-out, matched by the LLP 0175 D2.4/Acceptance-#10 re-scopes and the two ticket amendments.

I cross-checked each delta edit against its surrounding pre-existing text and against the coordinated edits in 0175 and both tickets. The edits are mutually consistent where it matters most:

- D-1's "standing, with known red" reconciles cleanly with D-3's prima-facie-(b) triage rule and with pre-existing "a battery red does not retroactively invalidate … standing claims" — the delta resolves what would otherwise have been a contradiction between those two clauses, rather than creating one.
- D-3's mandatory demotion for validator-detected (a) does not contradict pre-existing "Withdrawal is warranted only when (a)…or (b)…": withdrawal remains a *permitted* resolution; demotion-or-marker within one battery period is the *mandatory floor*. Coherent.
- The D-4 admission bar ("a content-hash pin regenerated alongside any edit is presence, not coverage") matches LLP 0175 D2.1's registry admission text and is backed by concrete fixtures in the implementation ticket, including "a semantics-defining checker cannot leave via a generic gate." This closes the most obvious r1-shaped loophole (laundering digest coverage into a rubber-stamp pin).
- The D-7 carve-out, 0175's D2.4 parenthetical ("preserved as a stricter per-claim protocol under LLP 0189 D-7, not re-scoped by its D-6"), and the re-scoped Acceptance #10 are mutually consistent, and correctly do not claim the telemetry wiring itself (which the capsule notes landed independently) as part of this delta.
- Defense in depth on scope edits is coherent: the implementation ticket's fixture makes an unauthorized scope-manifest edit *refuse* at the oracle (a same-change drift gate, so it runs at landing per D-2), while D-3's mandatory demotion covers the case where such an edit slips past (bypass, unselected path) and is detected later. These are two layers, not a contradiction.

I found no MATERIAL defect. Concerns follow, each classified.

## Concerns

### C1 — MINOR, IN-DELTA: the requalification-pending marker has no forcing function, and "next scheduled opportunity" is undefined for unscheduled qualification protocols

D-3 (delta text): "within one battery period the claim's advertised state drops to its prior honest tier **or gains an explicit requalification-pending marker** naming the ticket, and that ticket names an owner… Requalification then happens on the next natural cycle — **the claim's normal qualification protocol at the next scheduled opportunity**."

Two observations. First, the OR-branch means the fleet can always choose the marker over demotion, so "demotion is mandatory" in practice means "a visible state change is mandatory" — that is substantive (marker + named ticket + named owner within one battery period), but it is weaker than the word "mandatory demotion" suggests. Second, for claims like the derived fork, the normal qualification protocol (fresh C, lifecycle evidence, review heads, author acceptance) has no schedule, so "next scheduled opportunity" defines nothing, and the pending state has no bound. Note the asymmetry with the delta's own D-1: battery reds get a four-consecutive-run author escalation; requalification-pending markers get none. A pending marker older than N battery periods should escalate the same way. This is a gap, not a vacuity — the state is honest, visible, and owned, which is the ruled philosophy — so I classify it MINOR, but it is the concern I would most want the author or implementer to settle.

### C2 — MINOR, IN-DELTA: the amended derived-fork Consequences sentence is garbled

"proceeds under D-4: select the fresh qualification C once — after the digest re-scope and the two deferred checker-hardening tickets land, per the amended ticket — **re-scope the digest with drift gates** for the departing wave-shared files, and future wave landings stop rotating it."

The r2 insertion says C is selected *after* the re-scope lands, but the retained r1 tail then instructs "re-scope the digest" as a subsequent step, so the sentence reads circularly (select-after-re-scope, then re-scope). The amended requalification ticket is unambiguous ("select the fresh C *after* the digest re-scope and the two deferred checker-hardening tickets land"), so intent is recoverable, but the Decision's own sentence should be repaired to sequence cleanly.

### C3 — MINOR, IN-DELTA: D-6's opening "most recent scheduled complete battery" vs the amendment's on-demand eligibility

The pre-existing opening of D-6(b) says "the most recent **scheduled** complete battery green," while the delta then makes on-demand complete runs eligible and rules "the newest eligible completed run controls." The delta's tiebreak resolves the semantics (and "a newer red is never trumped by an older green" is exactly right), but the word "scheduled" in the opening sentence now conflicts with the amendment two sentences later and should be dropped or qualified.

### C4 — MINOR, IN-DELTA: ticket-keying phrasing diverges between the Decision and the implementation ticket

D-1 says a new distinct failure "files **or updates** a ticket rather than silently coalescing"; the implementation ticket says same gate + same signature = update, "a new distinct signature **files or appends**." Whether a new signature on an already-ticketed gate opens a second ticket or appends to the first is left open in both texts, and they use different verbs. Implementable either way, but the implementer should pick one and the two texts should agree.

### C5 — MINOR, IN-DELTA: legacy-digest transition semantics are ambiguous at the (a) boundary

New Consequences bullet: legacy unscoped claims "keep their pre-0189 semantics until re-scoped under D-4." When wave churn rotates a legacy unscoped digest, does the claim get pre-0189 withdrawal, or D-3's demotion-or-marker (since under the legacy scope, the whole digest *is* the scoped surface, so rotation is a (a) event)? Both readings are honest; the validator implementation will have to pick one. State which.

### C6 — MINOR, IN-DELTA: which existing registry gates qualify as nameable coverage under the admission bar

D-4 permits a departing file to "name the existing" drift gate, and simultaneously requires the named gate to meet the admission bar. Several current LLP 0175 registry entries are described as "source-pinned" carriers; whether their records are genuinely frozen or regenerated-alongside-any-edit determines whether they are "coverage" or "presence" under the new bar. The fixture set in the implementation ticket covers the checker case; the implementer must also adjudicate the existing registry entries when the derived-fork re-scope names them. Not a contradiction — a strict outcome (file stays in digest if no qualifying gate exists) is coherent — but it should be settled before the first re-scope, which is exactly the derived-fork landing.

### C7 — MINOR, IN-DELTA: D-5's lander self-judgment

"the lander judges which it was and records it" makes the person who did the integration the judge of whether it needs fresh scrutiny. Any stricter rule would chase `main` (explicitly out of scope), and the mandatory record makes the judgment auditable after the fact, so this is acceptable as designed; noting it only so the recorded-judgment requirement is not dropped in implementation.

### C8 — MINOR, PRE-EXISTING: deriving the claim-relevant gate set from a file-scoped digest

D-6 (delta) says the gate set "is derived from the claim record's D-4 scope, not enumerated ad hoc" — correct direction (it removes promotion-time discretion) — but the derivation function (scope files → battery gates, presumably via the checked selection policy's path map) lives in unchanged substrate and is unspecified. Straightforward implementation-phase material; flagged so the implementation ticket picks the selector as the single derivation authority rather than inventing a second map.

## Pre-existing text sweep

I re-read the unchanged r1 text against the delta for induced contradictions and found none MATERIAL: D-2's ban on complete-battery-at-exact-commit landing preconditions does not collide with D-7 (whose stricter protocols are claim/promotion-scoped, not landing-scoped, as the telemetry example in 0175 D2.4 confirms — publication/promotion gates, not push gates); D-4's "coverage moves; it never vanishes" is strengthened, not weakened, by the delta; the Non-goals promises ("no gate is weakened without its replacement drift gate landing in the same change," "no BLOCKED/FAIL becomes a silent skip") survive every delta edit — the D-6/Acceptance-#10 re-scope replaces the exact-SHA precondition with a defined battery-referencing form rather than deleting it, and battery reds still terminate in tickets, never skips.

## Verdict rationale

The r2 delta is a genuine tightening: every addition closes a real gap (signature keying vs silent coalescing, escalation bounds, the scope-edit rule, the admission bar, battery freshness and revision containment, the telemetry carve-out), and the coordinated 0175/ticket edits are consistent with the Decision text and with each other. The concerns above are wording repairs, one sequencing garble, and boundary choices an implementer or the author can settle without reopening any decision; none identifies a defective decision, an internal contradiction that breaks the mechanism, or a coverage rule that is vacuous or gameable as written. C1 is the one to watch — mirroring D-1's four-run escalation onto stale requalification-pending markers would close the only unbounded state the design leaves open — but the state it leaves open is visible, ticketed, and owned, which is the ruled posture, not a defect in it.

VERDICT: READY
