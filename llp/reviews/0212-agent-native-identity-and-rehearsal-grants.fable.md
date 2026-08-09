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

_pending — appended on receipt_
