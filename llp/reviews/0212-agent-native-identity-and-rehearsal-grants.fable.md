# Reviews: LLP 0212 — Claude family (Fable)

Review artifacts for `llp/0212-agent-native-identity-and-rehearsal-grants.rfc.md`,
Claude family. Verbatim bodies; never edited after receipt.

## Round 1 — 2026-08-09

**Round record (persisted before launch):**

- Round: 1
- Target revision under review: `6a8ed34194a49bfe93099c5623956f08435167a9ad720eb57494f08e9987d684`
  (git `HEAD` at loop start: the Draft→Review commit)
- Topology: single target, independent dual-family round (Claude/Fable +
  Codex), mutually blind
- Reviewer: fresh Claude (Fable 5) session via general-purpose subagent —
  the orchestrating session is the reviser and does not review
- Capsule: `capsule-0212-r1` (target + LLPs 0011/0045/0055/0057/0058/0060/
  0096/0150/0151/0203 + `guide/auth/*`), aggregate hash
  `573e042acfb3a3b72c81eaba7b58658af8f9a08c02a6b3e8c405f298a4afb044`
- Instructions hash:
  `af59cc7869d223d746ac73d36690c1227117cce15ae4e50fb6050d0d24a20988`
- Blindness: instruction-based (the reviewer process can technically reach
  the repository), self-attested per LLP 0010 disclosure rule; capsule
  structurally excludes `llp/reviews/*` and orchestrator notes
- Authorization: author (Charlie Cheever) invoked `/llp-super-refine` on
  this target 2026-08-09; the same author holds repository-disclosure
  authority for the external family's capsule

**Review body (verbatim):**

# Review — LLP 0212: Agent-native identity and rehearsal grants (super-refine round 1)

**Blindness attestation:** I read only files inside the capsule directory `capsule-0212-r1` (the target, the ten context LLPs, the `guide-auth/` pages, and REVIEW-INSTRUCTIONS.md). I did not read the repository, `llp/reviews/`, or any prior review artifact.

## Overall assessment

This is a strong RFC doing an unusual thing well: it records a genuine two-family brainstorm with provenance, converts the author's "special token" prompt into a shape (profile-bound, effect-enumerated, budgeted, boot-bound, window-mediated) that is structurally incapable of the god-token failure mode, and its rejected-ideas record is exactly the corpus culture it claims to be. The grounding section is substantially accurate: I verified the throttle constants (per-address 5/10min in `test`+`prod`, global 120/60s in every profile — 0057 §Constants, §Request-code transaction), the prod refusal of `/auth/request-code` (0057: "The capture provider is available in `dev`, `test`, and `demo`, never `prod`"), the two-carrier persona recipe and reset-reissues-principals rule (guide `sessions-and-principals.md`), the binding gap (guide `app-identity-binding.md` §"What Snapback does not give you yet"), 0150 invariants 1 and 5, 0151's Option D / SMS tier-2 / generated-domain-passkeys rulings and its commissioned-but-unowned lifecycle spec, 0045's plaintext-challenge prohibition, 0060's simultaneous multi-bucket throttle and conjunctive readiness, and 0203's P1/P2/P4/P7 with auth-adjacent refusals as the named P2 evidence. The "what rehearsal must never do" list and the seven prod-bleed rules are mechanisms, not wishes, with one exception noted in M4.

Four findings are material. All are repairable without disturbing any of the six author rulings.

## MATERIAL findings

**M1. The OQ1 splice was not reconciled with the build-first order it modifies; move 5's rationale is now false as written, and wave-1 dependencies on later-move vocabularies are unstated.**
§Build-first item 5 reads: "Effect budgets + explanation traces (A1, A6) — abuse control that explains itself, **landed before password/delivery/OAuth expansion multiplies the surfaces that need it**." But the OQ1 ruling (recorded at the top of the same section) ships the password floor (I6) in the *combined first wave*, i.e., before move 5. The sentence's rationale is directly contradicted by the ruling two paragraphs above it. This is not a challenge to the ruling — it is a defect in its recording: the seven-move list was left in its pre-ruling shape. The same unreconciled splice leaves three wave-1 dependencies dangling with no stated interim:
- OQ4 says "the rehearsal budgets reference it [the effect-budgets Spec]" — but A1 is move 5, after the wave that ships rehearsal budgets. Does the budgets Spec's vocabulary land in wave 1 (with only 0057's constant-migration deferred), or do rehearsal budgets ship against a provisional vocabulary?
- `verification.simulate` mints "simulated assurance" with `rehearsal_simulated` provenance in wave 1, but the assurance layer that defines assurance kinds and provenance (I4) is move 3.
- I6's "non-enumerating guessing defenses" for password are, per the document's own frame ("Rate limits bound abuse cost → replace with named budgets"), A1 machinery — move 5.
Each is resolvable (e.g., "the budgets Spec is authored in wave 1; the 0057 constant migration follows," "wave-1 taint is provenance on identities/sessions; the full assurance layer generalizes it in move 3"), but the document currently asserts an order its own first wave violates. Fix: rewrite the move list to reflect the post-ruling order and state the interim for these three dependencies.

**M2. The landing shape omits owners for work this revision commits to v1, violating the document's own "deltas land by owner" discipline.**
§Landing shape items 1–10 assign: the rehearsal Spec, the lifecycle Spec, 0151 amendments (I4, O2, O3, I3 *posture*), the budgets Spec, 0057 amendments (V2, V5, A1), 0024, 0036, 0045, 0203, and the migration surface. Nothing owns:
- **I1** (`defineAuth(...)` declared auth program) and **I2** (the four-layer catalog v3) — build-first move **1**, bucketed "Foundational v1." Item 7 even presupposes `defineAuth` exists ("secret-reference consumption from `defineAuth`") without any item owning it. Catalog versions have owners today (0057 owns v1, 0055 owns v2); catalog v3 has none.
- **I8 + the read-only `ctx.auth` claims surface** — OQ3 rules "Both in v1," but no landing item names an owning document for the provisioning hook or the claims surface.
- **I6 and I3 implementation** — OQ1 puts the password/guest floor in the *first wave*, but item 3 commissions only the guest-first *template posture* amendment; no delta owns the password authenticator or the guest implementation (0151's own sequencing had password at #9 as roadmap, not owned spec work).
Given the RFC's opening commitment — "This RFC creates no second authority. Deltas land by owner" — unowned v1 commitments either become de facto owned by 0212 (the competing authority it disclaims) or are commissioned nowhere. Fix: add the missing owner rows (even if the answer is "new Spec, number at implementation time" as items 1 and 4 already do).

**M3. The guest-claiming continuation design is attributed to the wrong authority, and OQ2's normative recording inherits the error.**
§I3 says: "The 0011 guest-claiming amendment already designed the hard parts (continuous `userId`, typed collision refusal with `switch_existing` / declared `merge`, reaping policy)." Verified against the capsule: 0011's dated amendment specifies continuous `userId` and the typed collision refusal — but it explicitly records merge as **out of scope** ("v1 records merge as out of scope, with an explicit app-level migration hook as the escape hatch"). The `switch_existing`/`merge` continuations, the reaping/retention limit, and the cleanup-policy requirement ("Acceptance may not claim switch/merge for an app until its cleanup policy is pinned") are **0151's proposal on top of the amendment** (0151 §Anonymous/guest identities: "On top of the amendment, this RFC proposes the post-collision continuation…"), in a Draft RFC, with the full transition contract expressly delegated to the still-unowned lifecycle spec. OQ2's ruling text then binds the template default "per the 0011 amendment's cleanup-policy requirement" — a requirement 0011 does not contain. In a document whose landing discipline is per-owner deltas, a normative ruling recorded against the wrong owner is a corpus-fidelity defect, and "already designed" overstates the settledness of Draft-proposed, spec-delegated design. Fix: attribute the continuations and cleanup-policy requirement to 0151 (building on 0011's amendment), and have OQ2 cite 0151.

**M4. The bounding source of `budget.rehearsal.allocate` is unspecified, so the claimed runaway-loop protection can be faithfully implemented as self-refilling budget.**
The leak-controls paragraph claims: "finite budgets, TTL, revocation, and concurrency ceilings bound a runaway agent loop," and the rejected-ideas record insists "Nothing ever reports 'unlimited.'" But the design also says "'turn off rate limiting' is expressible only as `budget.rehearsal.allocate` — a separate, finite, audited budget" — without ever stating what *bounds the allocator*. As written, an implementer can faithfully build a grant that, holding `budget.rehearsal.allocate`, repeatedly allocates fresh finite budgets: every individual budget is finite, nothing reports "unlimited," and yet the total is unbounded and the runaway-loop claim is a wish. The hazard is confined to non-prod profiles by rules 1–2, so this is not a production bypass — but it is precisely a "claimed protection [that] is actually a wish (no mechanism)" in the centerpiece design. One sentence fixes it: allocation draws down a ceiling fixed at mint time and recorded in the grant; no effect reachable under a grant can raise that grant's own ceiling.

## DETAIL findings

**D1. "the four reserved `_auth_*` tables" is a wrong count.** 0057's catalog v1 DDL defines **five** `_auth_*` tables (`_auth_users`, `_auth_identities`, `_auth_sessions`, `_auth_session_tokens`, `_auth_verification_codes`), fresh activations install 0055's v2 shape, and the reservation is a namespace rule ("is `_auth` or begins `_auth_`"), not a fixed set. The "four" likely conflates 0057's *four catalog object ids* (`usr_`/`idn_`/`ses_`/`aut_`, the LLP 0148 amendment). No design weight rests on the count, but it sits in the "grounding, per the corpus" section.

**D2. Selector enforcement on direct effects is implicit.** The grant record carries `selectors` (fixture namespaces, email domains), and R2 explicitly binds the *window* to them — but nothing states that direct exercise of `challenge.capture`/`challenge.redeem`/`fixture.identity.create`/`fixture.session.mint` is refused outside the grant's selectors. The Spec owns the full matrix, but the RFC's structural-rules list is where this belongs, since it is the difference between "scoped grant" and "profile-wide grant with scoped window."

**D3. §Non-goals bullet 1 ("No second token or session model") reads as contradicted by landing item 10's JWT bridge**, which commissions Snapback-minted, externally verifiable tokens plus JWKS. The intent is clearly compatible (the bridge issues external-audience assertions; Snapback never consumes them), but the absolute sentence invites an implementation-review challenge. Add the carve-out explicitly, mirroring the fence already present in the rejected-ideas record.

**D4. V3's "cheap win" bucketing understates its dependency.** The delivery simulator's receipt vocabulary (`bounced`, `provider_unavailable`, `duplicate_callback`) presupposes the classified-result seam of V4's adapter contract, which is bucketed "Production mechanisms" and lands via item 8 (LLP 0045). Either state that the simulator can precede real adapters by targeting the challenge seam directly, or note the ordering.

**D5. The prod-refusal citation points at the weaker source.** "`prod` refuses `/auth/request-code` outright — … (guide/auth/sessions-and-principals.md)": the guide page states "no production email delivery yet" and the *mailbox route* refusal; the request-code profile refusal is normative in 0057 §Request-code transaction. The fact is true; the cite should be 0057.

## Answers to the specific review questions

1. **Internal coherence:** mostly high — inventory, buckets, rejections, and the rehearsal section reinforce each other (e.g., the budget-allocation framing matches the "rate limiting disabled" rejection; R2 matches the bundle-carriage rejection). The defects are M1 (ruling vs. move order) and M2 (landing shape vs. v1 commitments), plus D3.
2. **Corpus fidelity:** good throughout except M3 (0011 vs 0151 ownership of the claiming continuations) and the D1/D5 grounding nits. It does not create a competing authority *in text*; M2 is where it risks doing so by omission.
3. **Rehearsal-grant design:** threat model and prod-bleed rules are structural and complete against the channels I could enumerate (deploy/import taint, boot-nonce binding, refresh cutoff, manifest legibility, carrier custody per 0057's sidecar discipline). M4 is the one protection that is currently a wish; D2 is Spec-delegable.
4. **Feasibility:** the landing shape's per-owner decomposition is realistic for this corpus; the combined first wave is large (rehearsal machinery + a brand-new password authenticator + guest principals on a system that today ships exactly one authenticator) but decomposable, and the ruling's internal ordering ("the wedge still leads the wave") is sound. The feasibility risk is the unstated dependencies in M1 and the unowned floor work in M2, not the ruling itself.
5. **Safety:** I found no path by which a faithful implementation of the written rules yields a production bypass or a public enumeration oracle — prod refuses mint and honor by token class, windows and grants cannot exist in prod, taint import fails closed, public endpoints keep their non-enumerating shapes, and rehearsal diagnostics live on the gated plane. The residual hazards (M4's unbounded non-prod allocation; D2's selector ambiguity) are dev/test-confined.

All four material findings are recording/specification repairs; none requires relitigating a ruled decision.

VERDICT: NOT READY

## Round 2 — 2026-08-09 (delta round)

**Round record (persisted before launch):**

- Round: 2 (delta round per LLP 0010 §2 addendum — every concern
  classified IN-DELTA vs PRE-EXISTING)
- Target revision under review: v0.2,
  `6686052997b3f7999595cedd0486d900fe904fec3cf1b965f295cdc0c7923e0d`
  (commit 0f76b1ac7)
- Topology: single target, independent dual-family round, mutually blind
- Capsule: `capsule-0212-r2` (v0.2 target + same context set as round 1),
  aggregate hash
  `85c8591f31898dbf8714c8a1237f09f2879cf4fe1ac4aec955195ba4439b24cf`
- Instructions hash (delta enumeration included):
  `30d396812e7d116263109ec2a9162976ebe9d9738de905588b0f7d82b257f353`
- Growth disclosure: v0.2 is ~31% net over v0.1, above the ~20% advisory
  budget; disclosed to reviewers as a legitimate finding surface
- Blindness: instruction-based, self-attested, as in round 1
- Reviewer: fresh Claude (Fable 5) session via general-purpose subagent

**Review body (verbatim):**

# LLP 0212 v0.2 — Super-refine round 2 review (delta round)

**Blindness compliance (self-attested):** I read only files inside `/private/tmp/claude-501/-Users-ccheever-projects-snapback/f38f3edc-aa45-44dc-872b-c2b7eef91a0b/scratchpad/capsule-0212-r2/` — the target RFC, REVIEW-INSTRUCTIONS.md, the ten governing LLPs, and the guide-auth pages. I did not read anything under the project checkout, `llp/reviews/`, or any round-1 artifact, and I have not attempted to reconstruct round 1 beyond the enumeration disclosed in the instructions.

## Method

I treated the fourteen enumerated delta items as claims to verify against the capsule authorities, then swept the whole document (including pre-existing v0.1 text) for internal consistency, cross-reference integrity, and anything the revision broke.

## Delta verification against capsule authorities

| Delta item | Check | Result |
| --- | --- | --- |
| 2 — "five `_auth_*` tables / namespace rule" | LLP 0057 catalog DDL defines exactly five tables (`_auth_users`, `_auth_identities`, `_auth_sessions`, `_auth_session_tokens`, `_auth_verification_codes`); §"reserved namespace" (line ~352) is written as a name-prefix rule, ASCII-case-insensitive | **Verified** |
| 2 — prod request-code refusal cited to 0057 | 0057 §Request-code transaction: "The capture provider is available in `dev`, `test`, and `demo`, never `prod`"; request-code accepted only when a delivery provider is available | **Verified** |
| 3 — assurance record paragraph | Internally consistent with rule 5 (use-time validation against `governingGrant`) and rule 3 (prod never sees rehearsal provenance anyway — belt and suspenders) | **Verified**, one DETAIL below (D6) |
| 4 — I3 attribution split | LLP 0011 §"Guest auth with account claiming (proposed-in-amendment)": continuous `userId`, typed collision refusal, "v1 records merge as out of scope, with an explicit app-level migration hook as the escape hatch". LLP 0151 §guest section: `switch_existing`/`merge` continuations "proposed on top of the amendment", reaping/retention, and the cleanup-policy requirement ("Acceptance may not claim switch/merge for an app until its cleanup policy is pinned"), delegated to the commissioned lifecycle implementing spec | **Verified** — the layering is now exactly right |
| 5 — V2 bulk-disclosure / V3 ordering | V2's contract items match the guide's actual gating (admin + impersonation, sibling-file custody); V3 ordering note is coherent with V4's adapter seam and LLP 0045's plaintext-never-durable rule (0045 Revised 2026-07-13 entry confirms) | **Verified** |
| 6 — R1 enum + profile disambiguation | LLP 0096 is titled and framed as *client* "auth profiles"; the "deployment profile" disambiguation is correct and consistently used | **Verified** |
| 7 — R2 minted selectors + reachability refusal | Minted one-use namespace is sound and preserves transcript equivalence (the test types an in-namespace address into unmodified UI) | **Verified**, one DETAIL below (D4) |
| 8 — R3 memberships via ordinary authority | Coherent; the escape ("fixture fails typed if no such transition exists") closes the invite-only case. The carrier-level reading of "a rehearsal capability never invokes application functions" is consistent because personas act under their own minted sessions, which rule 5 terminates with the grant | **Verified** |
| 9 — R5 disposable-store confinement | Self-consistent (LLP 0059 is not in the capsule so the non-decreasing-floor premise is taken on the RFC's citation; the reasoning from that premise is airtight) | **Verified**, one DETAIL below (D5) |
| 10 — dependency-spine build order | 1a resolves the forward-reference problem cleanly; the carrier interim correctly leans on LLP 0150's commissioned extractable-key agent profile (0150 §Authorities, §1) and claims nothing before it exists; release boundary matches LLP 0189 claim discipline as described | **Verified**, two DETAILs below (D2, D3) |
| 11 — plane classification, budget model, prod-bleed rules | LLP 0055 §Plane boundary confirms the cited direction verbatim ("app-plane authority never satisfies operator-plane policy"; everything `Admin*`/`ImpersonationCapability`-gated refuses `servicePrincipal`). The added reverse direction is new but stated as a deliberate boundary, not attributed to 0055. The four-rule budget model's effect-to-counter mapping is total over the eight-effect enum | **Verified**, one DETAIL below (D1 on the illustrative record) |
| 12 — landing items renumbered + JWT-bridge contract | Item 2 (identity-core Spec) gives the floor transitions, assurance record, hook contract, and `ctx.auth` an owner; item 11's bridge contract is coherent (issue-only, source-clamped, hard TTL, honest revocation-lag residual) | **Verified**, but the renumbering broke one cross-reference — D0 below |
| 13 — non-goals fenced exceptions | Both named exceptions point at their owning landing items correctly (items 11 and 1) | **Verified** |
| 14 — OQ2/OQ6 updates | OQ2's cleanup-policy citation matches 0151; OQ6's item-11 pointer is correct | **Verified** |

Other grounding spot-checks that pass: throttle constants (0057 table: per-address 5/10min in `test`+`prod`, global 120/60s), the guide's no-production-delivery and reset-reissues-principals statements, `authProgramReadiness` (guide + 0058), LLP 0203 P1/P2/P4/P7 numbering and content, 0151's dated rulings (Option D, SMS tier 2, generated-domain passkeys preview-only 2026-08-08), 0150 invariants 1 and 5, and the idea count (32).

## Findings

**D0. OQ4's landing-shape pointer is stale after the renumbering.** — DETAIL, IN-DELTA.
§Author decisions OQ4 ends "(Landing-shape item 4.)", but after the delta inserted the identity-core Spec as item 2, the effect-budgets Spec is **item 5**; item 4 is now the LLP 0151 amendments. Line 791 itself correctly tags item 5 with "(new number; OQ4 ruling)". A reader disambiguates by name, so this is not material, but it is exactly the class of breakage a renumbering causes and should be fixed to "item 5".

**D1. The illustrative grant record is internally inconsistent: a `clockAdvances` budget with no `clock.auth.advance` scope.** — DETAIL, IN-DELTA.
The record's `scopes` array lists seven of the eight enum effects (omitting `clock.auth.advance`) while its `budgets` include `clockAdvances: 20`. Under budget rule 1 every counter pairs with an effect; a grant carrying a budget for an effect it doesn't hold is either dead weight or implies budgets can exist unscoped. The record is flagged "illustrative, not the Spec's schema", but an illustration of a *closed, total* mapping should itself be closed and total — either add the scope or drop the counter.

**D2. R5 and V6 lost their wave slots in the build-order rewrite.** — DETAIL, IN-DELTA.
The bucket table calls V2, V3, V5, R4, **R5**, A6, **V6** "cheap wins — land early", and the wedge bucket is "R1–R5". But wave 1b lists only "(R1–R4, V2, V5)"; R5 appears nowhere in waves 1–3, even though its effect (`clock.auth.advance`) and counter are in the wave-1 enum and budgets — so wave 1's rehearsal Spec specifies an effect whose implementing feature has no stated wave. V6 appears in no wave *and* no landing-shape item (item 9 covers only V3/V4). The spine disclaims being "a linear wish list", but the doc's own round-1 repair standard was "every v1 commitment is owned"; these two should be placed explicitly (even if the placement is "R5 mechanics land with 1b; V6 rides the identity-core Spec's readiness surface" or similar).

**D3. "Two waves" heading vs. a numbered wave 3.** — DETAIL, IN-DELTA.
The section is titled "Build order: two waves over a dependency spine" and the OQ1 framing is "one combined first wave", yet the list under "Wave 2 and later" ends with an item numbered "3." (OIDC engine…). Harmless, but either the heading should say "two waves plus a later tranche" or item 3 should be "2e"/unnumbered.

**D4. "Declared reachability" is a new predicate with no stated fail-closed default.** — DETAIL, IN-DELTA.
R2 refuses window installation "on targets whose declared reachability is public", but no capsule authority defines a reachability declaration (LLP 0060 discusses public reachability as a threat premise, not a declared target fact). The Spec will own the mechanism, which is fine for an RFC — but this document's own style is to state fail-closed at every boundary, and it doesn't say what happens when reachability is *undeclared*. One clause ("undeclared reachability refuses, same as public") would close it.

**D5. R5's parenthetical mis-attributes the ineligibility trigger to rule 3.** — DETAIL, IN-DELTA.
R5 says a store "marked disposable at creation (… is thereby permanently ineligible for production promotion, per §Rehearsal grants rule 3)". Rule 3's marker is set by *the first honored rehearsal effect*, not by creation-time disposable marking. The safety property holds either way (any clock advance is itself a rehearsal effect, so rule 3 fires before any floor moves), but the cross-reference conflates two distinct markers; the Spec should get them stated separately (disposable-at-creation marking vs. rehearsal-admission taint), and this sentence should not imply rule 3 covers the former.

**D6. `import` provenance's production admissibility is left implicit.** — DETAIL, IN-DELTA.
The assurance-record paragraph enumerates provenances (`delivery`, `import`, `rehearsal`, …) but pins admissibility only for `rehearsal`. M1 imports "provenance-marked verified claims" — presumably admissible in prod, since that's the point of the import — but nothing says so, and the paragraph's framing ("production admission policy never accepts rehearsal provenance") invites the question for every other provenance. One sentence assigning the import-admissibility ruling to the identity-core Spec (or M1's pipeline contract) would complete the picture.

**D7. "Cannot launder" slightly overstates what store-level taint can enforce.** — DETAIL, IN-DELTA.
Rule 3's claim that "an app-data-only export from a rehearsal store cannot launder derived state into prod" holds only for exports/imports that ride Snapback's own paths, where the marker's lineage can travel; app-level reads copied out by hand are unpreventable by any design. The intent (paved-path fail-closed refusal) is right and the acceptance matrix in landing item 1 already includes store-taint promotion refusal; the Spec should ensure export-artifact lineage carriage is an acceptance row, and this sentence could scope itself to Snapback-mediated deploy/import.

**Pre-existing text sweep:** I found no MATERIAL concern in the untouched v0.1 text. The idea inventory's provenance tagging, the rejected-ideas record, the naming rationale, the bucket overlaps (deliberate multi-lens membership), and the motivation's grounding claims all check against the capsule authorities. The Summary's "thirty-odd" matches the inventory's 32. Citations to documents outside the capsule (0059, 0053, 0106, 0036, 0024, 0189) are used consistently with how the in-capsule corpus refers to them; I could not independently verify their contents and note that as a capsule limitation, not a finding.

## Growth-budget judgment

v0.2's ~31% growth exceeds the ~20% advisory, but I do not judge any of it bloat. The additions are precisely the contract text a NOT-READY×2 round demands: the budget model's four rules, the plane classification, the JWT-bridge security contract, the assurance record, and the dependency spine each carry normative weight that a Spec author or a future reviewer would otherwise have to invent. Nothing reads as padding; the document remains unusually dense per line.

## Verdict reasoning

Every enumerated delta item checks out against the capsule authorities, several with exact-text verification (0011's amendment, 0055's plane boundary, 0057's five tables and profile refusal, 0151's cleanup-policy and dated rulings). The revision introduced seven DETAIL-grade rough edges — one genuinely broken cross-reference (D0), one inconsistent illustration (D1), two unplaced ideas (D2), and four precision gaps the commissioned Specs will have to close anyway — but no unresolved MATERIAL concern anywhere in the document, in-delta or pre-existing.

VERDICT: READY

## Round 3 — 2026-08-09 (delta round, final in budget)

**Round record (persisted before launch):**

- Round: 3 (delta round verifying the v0.3 in-delta closures)
- Target revision under review: v0.3,
  `a434929e2a205d26e71ee445356762e15691a7d546cb7dcfd672f8b704b02a29`
- Topology: single target, independent dual-family round, mutually blind
- Capsule: `capsule-0212-r3`, aggregate hash
  `0072195a8bc5f331a8529289b4e5f402e715b10c8885e3a0b2909ca4b81ed887`
- Instructions hash:
  `6aacfcb957c391ed42863856119da2d741aeb571a276f588774c210476409d52`
- Growth disclosure: v0.3 ~45% net over the entering revision (advisory
  ~20% exceeded; round-2 reviewers judged prior growth load-bearing;
  disclosed again as a finding surface)
- Blindness: instruction-based, self-attested, as in prior rounds
- Reviewer: fresh Claude (Fable 5) session via general-purpose subagent

**Review body (verbatim):**

# LLP 0212 v0.3 — Super-refine round 3 review (delta round)

**Blindness attestation:** I read only files inside `/private/tmp/claude-501/-Users-ccheever-projects-snapback/f38f3edc-aa45-44dc-872b-c2b7eef91a0b/scratchpad/capsule-0212-r3/` — the target RFC, REVIEW-INSTRUCTIONS.md, the nine context LLPs (0011, 0045, 0055, 0057, 0058, 0060, 0096, 0150, 0151, 0203), and the `guide-auth/` pages. I did not read anything under the repository, any prior review artifact, or any orchestrator note, and I have no knowledge of rounds 1–2 beyond the disclosure in the instructions.

## Method

This being a delta round, I verified each of the eleven enumerated v0.3 delta items against the document text, checked the delta's load-bearing external claims against the capsule's governing documents, and swept the whole document for internal contradictions the delta may have introduced. Pre-existing text got a consistency spot-check (held to the disclosed round-1/2 result of zero MATERIAL pre-existing findings across both families), with external anchors verified where the delta leans on them.

## External anchor verification (all pass)

- **0057 wrong-code charge** (budget rule 1's "preserving 0057's wrong-code charge"): confirmed — 0057 §Challenge states and exchange increments `attempts` for every submitted code and states "the wrong-code and locked outcomes are transaction outcomes, not errors that roll back attempt accounting."
- **0060 atomic charge-on-denial**: confirmed — 0060 states "the v1 transition is charge-on-denial and fail-closed" with atomic multi-bucket acquisition ("no partial charge").
- **R2's loopback-behind-proxy honesty framing**: confirmed as exactly 0060's documented limit ("`127.0.0.1` or `::1` behind a public reverse proxy still appears loopback to Snapback… proves nothing about the proxy… public reachability"), and 0060's deployment flag is explicitly "a request, never an operator assertion" — the RFC's "a mere operator description is not a security fact" and the target-authored-admission-fact framing are faithful to the cited authority.
- **Landing item 1a's substrate**: 0058 §Shared invocation authority exists with the sealed `ResolvedAppAuthority` layer-set; hanging rehearsal-provenance propagation off that lineage as a named amendment is a real, ownable seam.
- **Prod-refuses-request-code, capture mailbox, no-production-email**: confirmed in 0057 §Request-code transaction ("The capture provider is available in `dev`, `test`, and `demo`, never `prod`") and guide-auth/sessions-and-principals.md ("'email-code login, React web' has no self-serve path today").
- **0055 plane non-substitution**: confirmed ("app-plane authority never satisfies operator-plane policy").
- **0151 anchors** (commissioned lifecycle spec, Option D, cleanup-policy requirement, generated-domain passkeys ruled 2026-08-08) and **0011's guest-claiming amendment** (continuous `userId`, no auto-merge, collision behavior): all present as the RFC characterizes them, including the layered I3 attribution.
- **0203 P1/P2/P4/P7**: all exist as cited.

## Delta closure verification

| Delta item | Status |
| --- | --- |
| 1. `governingAuthority`, use-time window validation, import admissibility assignment | Verified in §Design frame and prod-bleed rule 5; internally consistent (window-mediated mints die with the window even under a live parent grant, stated in both places). One wording residue — see D1. |
| 2. R2 selector-namespace disambiguation, entropy-as-boundary, fail-closed reachability, loopback-behind-proxy | Verified; the "one-use = one namespace per installation, unlimited in-window matches up to budgets" reading is unambiguous, and the acceptance rows are named in both R2 and landing item 1. |
| 3. R5 creation-time disposable marking vs. rule-3 taint | Verified; the two markings are cleanly distinguished and both independently bar promotion, with the observation that any advance also fires rule 3's taint. |
| 4. `clock.auth.advance` in the illustrative record | Verified; the scope list now matches the R1 enum (8/8) and the budgets block gives every scope its counter (`clockAdvances: 20` present). Counter mapping is total. |
| 5. Total effect-to-selector mapping | Present and total over the 8-effect enum, with the refusal rule. But it is contradicted by the illustration two paragraphs later — see D2 — and has one conceptual wrinkle for `window.install` — see D3. |
| 6. Budget rule 1: request-bound idempotency, denials charge, attempt vs. quota counters | Verified; consistent with the 0057 and 0060 semantics it claims to preserve (anchor-checked above). |
| 7. Prod-bleed rule 3 rewrite: same-transaction marker, survival set, provenance envelope, fail-closed import, scoped laundering claim, egress → 1a | Verified; the crash-cut closure is airtight as written, and the hand-copied-bytes honesty scoping is the right epistemic posture. |
| 8. Landing item 1 expansion + new item 1a | Verified; 1a names the propagation path (sessions → nested calls → actions → hooks → adapters → one egress gate) and its acceptance rows, and rule 3's egress sentence now points at it. |
| 9. Wave 1b includes R5 + V6; wave 1c complete floor enumeration; **landing item 2 mirrors** | **Partially applied — the landing-item-2 half is missing. See M1.** |
| 10. Heading "two waves and a provider tranche"; Wave 3 label; OQ4 → item 5 | Verified (item 5 is the effect-budgets Spec; OQ4 says "Landing-shape item 5"). |
| 11. Revised line + v0.3 revision-history entry | Verified. |

## Findings

### M1 — MATERIAL, IN-DELTA: landing item 2 was not updated to mirror the wave-1c closure; the identity-core Spec's commission is now internally contradicted

The disclosed round-2 closure (delta item 9) has two halves. The first half landed: wave 1c enumerates the floor's producer paths completely — guest principal/session creation, guest claim, password account creation and authentication, password set/change, recovery-code issuance/consumption/rotation with one-time plaintext custody and redaction, session consequences, last-authenticator enforcement — "each specified in the identity-core Spec with LLP 0151 as the requirements authority."

The second half did not land. Landing item 2 — the commissioning record for that same identity-core Spec, in the section whose contract is "Deltas land by owner" — still carries the stale, three-item gloss: "the floor's own lifecycle transitions (guest claim, password set/change, recovery-code consume)." It omits guest/password/recovery *creation and authentication* paths, session consequences, custody/redaction, and last-authenticator enforcement — i.e., most of what the round-2 finding evidently existed to pin. It also carries neither of the two other assignments the v0.3 body makes to this Spec:

- **V6's readiness posture** — wave 1b says V6 "rides the identity-core Spec's readiness facts"; item 2's ownership list has no readiness-facts entry.
- **Import-provenance admissibility** — §Design frame says non-rehearsal provenance admissibility is "owned by the identity-core Spec"; item 2 names only "the assurance record and its **posture-scoped** admissibility rule," which by the document's own kind/provenance vocabulary is the *rehearsal* rule, not the posture-*independent* import rule.

Why MATERIAL rather than DETAIL: this round exists to verify the v0.3 closures, and a closure enumerated as applied is absent from the document — so either the edit was dropped or the revision record overclaims; both need repair. On its own merits it is also the exact drift class the round-2 finding targeted: two divergent enumerations of one Spec's owned scope inside one normative document, where the shorter one sits in the register a future Spec author will actually work from. The fix is cheap and shrinks the document: make item 2's floor entry point at the wave-1c enumeration as the single source ("the floor transitions enumerated in wave 1c") rather than restating a list, and add the readiness-facts and import-admissibility ownership lines.

### D1 — DETAIL, IN-DELTA: "governing grant recorded" residue in §Design frame

The assurance-record paragraph first (correctly) defines `governingAuthority` as naming "the exact minting authority, *window included* when one mediated the mint," then three sentences later says `verification.simulate` mints with "the governing **grant** recorded." Under R2, simulation typically happens under a window, in which case the recorded authority is the window. Say "governing authority recorded" to avoid re-importing the ambiguity this delta item existed to remove.

### D2 — DETAIL, IN-DELTA: the illustrative grant record violates the selectors bullet it now sits next to

The selectors bullet declares mandatory selector fields for all eight effects and "an effect whose required selector is absent or incompatible is refused." The illustrative record grants all eight scopes but its `selectors` object contains only `fixtureNamespaces` — under the stated rule, this grant would refuse its own `verification.simulate` (no identity selector), `budget.rehearsal.allocate` (no budget name/axes), and `clock.auth.advance` (no store/clock domain). Delta item 4 made the illustration counter-total; leaving it selector-non-total in the same revision that made selector totality normative invites the reading that selectors are optional for most effects. The "illustrative, not the Spec's schema" disclaimer softens but does not cure this: illustrations teach. Add the missing illustrative selector fields or a one-clause note that the example elides them.

### D3 — DETAIL, IN-DELTA: `window.install`'s mandatory selector is circular as stated

The mandatory selector for `window.install` is "the minted namespace" — but R2 establishes that the namespace is minted *by* installation and returned to the caller; it cannot be supplied as an input selector, so the absent-selector-refuses rule is vacuous for exactly this effect. Presumably the intent is that the selector is the *output binding* (the installed window is bound to its minted namespace), or that the grant-side selector constrains install parameters (budget envelope, TTL class). One clarifying clause, or an explicit delegation of this case to the Spec, closes it.

### D4 — DETAIL, PRE-EXISTING: load-bearing normative dependencies missing from Related

R5's confinement rationale rests on LLP 0059's non-decreasing durable clock floor, and prod-bleed rule 5's level-triggered termination rests on LLP 0053's obligation pattern; non-goals also lean on 0059/0077. None of 0053, 0059, 0077 appears in the Related header, which lists lighter-weight dependencies (0024, 0036, 0045, 0096). Header hygiene only.

### D5 — DETAIL, IN-DELTA: one-sided V6 completion pointer

Wave 1b says V6 "completes in 2a," but 2a's own bullet (I4 complete, I8, V1 general) doesn't mention V6. Harmless if deliberate; a two-word addition to 2a makes the pointer bidirectional.

## Growth and compression

v0.3's growth over v0.2 is load-bearing: the same-transaction taint commit, the export provenance envelope with fail-closed import, the egress-gate owner (1a), charge-on-denial semantics, and selector totality are all security-substance, not prose. The one real compression opportunity is the M1 fix itself — single-sourcing the floor enumeration between wave 1c and landing item 2 removes the only material duplication the delta introduced. I do not find bloat elsewhere; the ~45% cumulative growth is justified by what it pins.

## Pre-existing sweep

No MATERIAL concern found in pre-existing text. The rejected-ideas record, plane classification, naming section, non-goals fencing (two named exceptions), and author-decision records are internally consistent and consistent with the capsule's governing documents as spot-checked above. No ruled author decision is challenged.

## Summary

Ten of the eleven v0.3 delta items verify cleanly, and the security-model closures (taint envelope, egress-gate ownership, charge-on-denial, window-authority termination) are genuinely closed. The single unresolved MATERIAL is a dropped edit, not a design defect: landing item 2 never received its half of the delta-item-9 closure, leaving the identity-core Spec's commission contradicting the wave-1c enumeration the same revision made normative. It is a small, mechanical repair — but it is exactly the kind of closure this round exists to verify, and it did not verify.

VERDICT: NOT READY

## Round 4 — 2026-08-09 (focused delta verification)

**Round record (persisted before launch):**

- Round: 4 — the single focused verification round the delta-convergence
  rule authorizes (convergence reached at round 3: zero pre-existing
  MATERIAL across both families in two consecutive post-revision rounds)
- Target revision under review: v0.4,
  `f3da1baed35afcf35c8b4e05fb5f39413286889c36e27c6b1f454889e67c7b33`
- Topology: single target, independent dual-family round, mutually blind
- Capsule: `capsule-0212-r4`, aggregate hash
  `a6e8c20850774518b246ffd4c14e650226e60f730be2b1b9c5e15da485cf0bd2`
- Instructions hash:
  `7d8f8bfbf2ecca7375c8d413e9173ddfce97c26b61488a80ef9394e30cef5fc6`
- Scope: v0.4 delta only (9 items); pre-existing text passed two
  consecutive cross-family sweeps
- Blindness: instruction-based, self-attested, as in prior rounds
- Reviewer: fresh Claude (Fable 5) session via general-purpose subagent

**Review body (verbatim):**

# LLP 0212 v0.4 — Round 4 focused delta verification (Fable family reviewer)

**Self-attestation:** I am a fresh reviewer with no knowledge of rounds 1–3 beyond what REVIEW-INSTRUCTIONS.md discloses. I read only files inside the capsule directory `capsule-0212-r4/`: the target RFC (0212 v0.4), REVIEW-INSTRUCTIONS.md, and the context documents (0011, 0045, 0055, 0057, 0058, 0060, 0096, 0150, 0151, 0203, guide-auth/). I did not read anything under the project repository, any prior review artifact, or any orchestrator note.

**Scope discipline:** Per instructions, I reviewed the nine enumerated v0.4 delta items only, touching pre-existing text only where a delta item lands in it.

## Delta item verification

**1. Landing item 2 pointer-commissioning (floor set, V6 derivation, import admissibility) — VERIFIED.** Landing item 2 commissions "the complete floor transition set enumerated in wave 1c" with the single-source rule stated explicitly, and wave 1c's enumeration is genuinely complete (guest principal/session creation, guest claim, password account creation/authentication, set/change, recovery-code issuance/consumption/rotation with custody rules, session consequences, last-authenticator). No second restated list exists anywhere — landing item 4 correctly commissions the I6/I3 *implementing* work into "the identity-core Spec's floor transitions" by reference, not by restatement. V6's derivation is consistent across all three sites: 1b ("rides the identity-core Spec's readiness facts here and completes in 2a"), 2a ("becoming enforceable here"), and landing item 2 ("readiness facts present from wave 1b; the deploy-time check becomes enforceable in 2a"). The posture-independent non-rehearsal admissibility commission in landing item 2 matches §Design frame exactly ("owned by the identity-core Spec — `import` in particular is admissible in production"), with the posture-scoped rule correctly confined to rehearsal provenance in both places.

**2. `window.install` selector precommitment — VERIFIED, one DETAIL.** The three sites agree: R2's opening ("generated by the host at *grant mint*, precommitted as the `window.install` selector, and consumed by installation"), the per-effect selector mapping in §Rehearsal grants ("mint-time-fixed with no output-as-input circularity"), and the carrier bullet ("a minted, unguessable selector namespace"). The circularity that precommitment resolves is real — a selector generated at installation time could not have been recorded on the grant at mint — and the acceptance additions (collision, reuse, post-mint mutation, concurrent installs) are present in the selector-mapping parenthetical.

- **DETAIL, IN-DELTA (D1):** The precommitment text speaks of "the unguessable namespace" (singular) per grant, bound to "exactly one window installation," while the budget model gives `window.install` its own `windowInstalls` counter that nothing constrains to 1. A grant minted with `windowInstalls: 2` but one precommitted namespace has a dead second budget unit (or an undefined second install). The commissioned Spec should pin the multiplicity relation — e.g., precommit one namespace per budgeted install, or clamp the counter to the precommitted selector count. The named "reuse" and "concurrent installs" acceptance rows show awareness of the adjacent hazards; this is a schema-coherence point for the Spec, not a design defect.

**3. Reachability recast in R2 — VERIFIED, sound against LLP 0060.** The recast is the strongest part of the delta. Selector entropy as the authoritative foreign-caller boundary is the same discipline the corpus applies to its 256-bit session bearers (0057 §credential table) and 0150's entropy floors, and the honesty framing matches 0060 precisely: 0060's D1 limit says verbatim that a loopback bind "proves nothing about the proxy … public reachability, or alternate paths," and 0060 states the local target "reports no effective-source capability" and that hosted readiness is false "including when its listener is loopback and an operator happens to place a proxy in front of it." So the three-way split — published target-authored public fact refuses (demo-class positive case, with R3/R4 as the operator's path); no fact (wave-1 local target) proceeds on entropy with the residual named; operator prose never a security fact — is exactly 0060-shaped. The explicit rejection of fail-closed-on-unknown carries its rationale (it would refuse the only wave-1 topology while adding nothing entropy doesn't provide), which is correct: the outer boundary is already the non-prod deployment profile plus the `AdminWrite`+`ImpersonationCapability` mint ceremony, and a foreign caller behind a proxy still faces a 128-bit namespace guess whose attempts charge budgets (rule 1's charge-on-denial). The updated acceptance rows (loopback-behind-proxy now "installation proceeds; the guessing rows hold"; declared-public refusal) match the recast rather than the old posture. No laundering: the text never converts entropy into a reachability claim.

**4. Landing item 1a provenance derivation and persistence — VERIFIED.** "Derives from the effective authority and assurance decision — not merely the live session" is the right derivation base: it composes correctly with rule 5's use-time validation (an invocation admitted on a rehearsal-provenance assurance is marked even if its session were somehow clean). The durable-persistence path matches LLP 0045's actual mechanics — 0045's outbox uses cron-sweep claim with at-least-once delivery and process-restart survivability, so "carries the marker through claim, retry, process restart, and delivery" names the real seams, and the clean-`System`-runner case is exactly the hole a session-only derivation would leave. The scope narrowing ("initiated or durably enqueued … not arbitrary downstream causality") is honest and correctly bounded: transitively-influenced egress from later clean invocations is covered at the promotion boundary by rule 3's store taint, not by provenance chasing, and the RFC does not overclaim otherwise. Acceptance rows (direct, nested, hooks, adapters, outbox/cron, queued replay, restart, retry; declared simulators usable) cover the enumerated persistence seams.

**5. Export envelope integrity binding — VERIFIED, one DETAIL.** Rule 3 now binds the envelope to payload, store identity, and marker state under a host-held key, names the 0057 keyring lineage as the mechanism family (the `<db>.auth-keyring.json` deployment sidecar with keyed digests is a real, shipped lineage for exactly this kind of host-held-key integrity), defers the primitive to the Spec, and fails closed on missing/malformed/unverifiable envelopes "exactly as on a tainted one." The splice sentence closes the syntactic-clean-envelope hole and correctly downgrades the claim from syntactic to structural. Landing item 1's matrix gains the matching negatives (envelope-edit, clean-envelope/tainted-payload splice, payload-substitution, replay) plus the disposable-marker persistence and its pre-effect promotion negative — which correctly exercises the disposable marker *independently* of rule 3's admission taint, per R5's deliberate distinction.

- **DETAIL, IN-DELTA (D2):** Two contract points the commissioned Spec must pin are currently implicit: (a) **verification-key custody across hosts** — the importing production host must verify an envelope minted under the *exporting* host's key, and the trust model for that verification path (and therefore the boundary of the "structural, not syntactic" claim — a party holding the exporter's key is presumably outside it, alongside hand-copied bytes) should be named in the Spec's commission; (b) what the "replay negative" concretely asserts, since a genuinely pre-taint export replayed later is legitimately clean and the interesting replay cases largely reduce to substitution. Neither is a defect in the decision — the mechanism family and fail-closed posture are right — but the Spec commission is the place to name them.

**6. Illustrative grant reduction — VERIFIED.** The example now holds exactly the four contact/namespace-selector effects; its selectors (`fixtureNamespaces`, `emailDomains` with a minted `.rehearsal.invalid` namespace) and budgets (`identityCreates`, `challengeAttempts`, `sessionMints`) are mutually total under the stated effect-to-counter mapping (capture/redeem → `challengeAttempts`; the other two → their own counters). The explanatory note correctly directs a fuller grant to the per-effect mappings rather than implying the example is schema.

**7. Governing-authority wording — VERIFIED.** §Design frame's assurance-record text and its `verification.simulate` sentence now both read "the window when one mediated the mint," matching rule 5's use-time formulation ("the window when one mediated the mint, else the grant") with no residue of a conflicting formulation.

**8. Related header + wave 2a — VERIFIED.** 0053, 0059, and 0077 all have load-bearing in-text references (rule 5's level-triggered termination pattern; R5's non-decreasing durable clock floor, corroborated by 0057's clock-floor sections; the non-goals' session/fencing ownership and A2's sender-bound tier), so the header additions are alignment, not decoration. Wave 2a carries "V6 enforcement" consistently with items 1's cross-checks above.

**9. Header and revision history — VERIFIED.** The Revised line leads with v0.4; the v0.4 revision-history entry accurately and completely summarizes the applied delta, including the round-3 verdict record and the dropped-edit repair it closes.

## Cross-cutting consistency check (delta-touching only)

The delta introduces no contradiction with the pre-existing budget model (window installs and clock advances retain their counters), the plane classification, the prod-bleed rules (rule 3's egress sentence and landing item 1a point at each other correctly), or the R5 disposable-store confinement (the envelope now carries "marker state" generically, covering both the admission taint and the creation-time disposable marker).

- **DETAIL, IN-DELTA (D3):** The RFC now states the rehearsal-Spec acceptance matrix in two partial enumerations: R2's list (which names the declared-public refusal row and the "installation proceeds" loopback row) and landing item 1's longer condensed list (which names loopback-behind-proxy and guessing but omits the declared-public refusal row, and omits the namespace collision/reuse/mutation/concurrency rows that live in the selector-mapping parenthetical). Since landing item 1 is the commissioning text, either add the missing rows there or add a phrase incorporating the R2/selector rows by reference, so the Spec author has one authoritative superset. Cosmetic; the rows all exist somewhere in the document.

## Findings summary

| # | Class | Scope | Finding |
|---|-------|-------|---------|
| D1 | DETAIL | IN-DELTA | Precommitted-namespace multiplicity vs. a `windowInstalls` budget > 1 — Spec must pin the relation |
| D2 | DETAIL | IN-DELTA | Envelope verification-key custody across export/import hosts, and the concrete meaning of the replay negative — name both in the Spec commission |
| D3 | DETAIL | IN-DELTA | Landing item 1's condensed acceptance list omits rows named in R2/selector text — unify or incorporate by reference |

No MATERIAL findings, in-delta or pre-existing. No pre-existing concern rises to a defective decision. No ruled author decision is challenged. The v0.4 delta is faithfully and coherently applied, and the two substantive recasts (selector precommitment; entropy-authoritative reachability) are correct against the governing corpus documents in the capsule.

VERDICT: READY

## Loop close-out — 2026-08-09

**Final report (orchestrator; identical text in both family artifacts).**

- Rounds run: 4 (1 full + 3 delta; round 4 was the single focused
  verification round the delta-convergence rule authorizes). Launches
  per family: Fable 4/4 clean; Codex 5 (1 environment-failure void in
  round 1 — no review produced — + 4 clean). Caps respected.
- Revisions: v0.1 (entering) → v0.2 → v0.3 → v0.4 → v0.5.
- **Final loop verdicts bind to v0.4**
  (`f3da1baed35afcf35c8b4e05fb5f39413286889c36e27c6b1f454889e67c7b33`):
  Fable **READY** (3 DETAIL, all dispositioned into the Spec
  commissions in v0.5); Codex **NOT READY** (1 MATERIAL — the
  pre-taint envelope replay — + 1 DETAIL).
- **Convergence claim, scoped honestly:** the loop converged under the
  LLP 0010 delta rule — rounds 2, 3, and 4 each found **zero MATERIAL
  concerns in pre-existing text across both families**; every MATERIAL
  from round 2 onward was in-delta closure work on the loop's own
  revisions. Dual-READY on a single revision was **not** achieved:
  round-4 Fable READY and Codex NOT READY split on v0.4, and Codex's
  final MATERIAL was repaired in **v0.5, which no family has
  reviewed** (the v0.5 delta is labeled UNREVIEWED in the target's
  §Revision history; it adopts the first of Codex's two offered
  resolutions — pre-taint exports promotable by design with the
  policy stated precisely — rather than new infrastructure).
- Altitude-rule dispositions: all round-4 DETAILs (Fable D1–D3, Codex
  D-reachability) identify no defective decision and are folded into
  the v0.5 Spec-commission text; none blocks.
- Growth: v0.5 is ~63% over the entering revision, far past the ~20%
  advisory. Disclosed every round; both families judged the growth
  load-bearing contract text in rounds 2–4 and the round-2/3 reviews
  found no bloat beyond the illustration (which v0.4 shrank).
- No author decision was overturned; Codex's round-2 M8 challenge to
  OQ6's *recording* was absorbed by pinning the bridge contract, with
  the ruling intact.
- **Proposed next step:** stay `Review`. The author may accept on the
  strength of the scoped convergence, or commission one more blind
  delta round on the v0.5 delta (a fifth round exceeds the loop's
  authorized budget and would be a fresh authorization). The three
  commissioned Specs (rehearsal-grants, identity-core, effect-budgets)
  are the implementation gate either way, and each carries the
  round-4 DETAIL closures as commission requirements.
