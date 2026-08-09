# Reviews: LLP 0212 — Codex family

Review artifacts for `llp/0212-agent-native-identity-and-rehearsal-grants.rfc.md`,
Codex family. Verbatim bodies; never edited after receipt.

## Round 1 — 2026-08-09

**Round record (persisted before launch):**

- Round: 1
- Target revision under review: `6a8ed34194a49bfe93099c5623956f08435167a9ad720eb57494f08e9987d684`
  (git `HEAD` at loop start: the Draft→Review commit)
- Topology: single target, independent dual-family round (Claude/Fable +
  Codex), mutually blind
- Reviewer: Codex `gpt-5.6-sol`, reasoning effort xhigh, via `codex exec`,
  read-only sandbox, cwd = capsule directory
- Capsule: `capsule-0212-r1` (target + LLPs 0011/0045/0055/0057/0058/0060/
  0096/0150/0151/0203 + `guide/auth/*`), aggregate hash
  `573e042acfb3a3b72c81eaba7b58658af8f9a08c02a6b3e8c405f298a4afb044`
- Instructions hash:
  `af59cc7869d223d746ac73d36690c1227117cce15ae4e50fb6050d0d24a20988`
- Blindness: instruction-based (read-only sandbox can technically reach the
  repository), self-attested per LLP 0010 disclosure rule; capsule
  structurally excludes `llp/reviews/*` and orchestrator notes
- Authorization: author (Charlie Cheever) invoked `/llp-super-refine` on
  this target 2026-08-09; the author holds repository-disclosure authority;
  outbound inventory disclosed = the capsule listing above (already-public
  repo docs)
- Provenance note: the Codex family also produced the commissioned
  pre-draft brainstorm of 2026-08-09 that this RFC synthesizes. This round
  is a fresh, blind review of the resulting document, not a continuation of
  that session.

**Review body (verbatim):**

Blindness self-attestation: I read only the capsule as review material and did not inspect prior review artifacts or orchestrator notes.

## Overall assessment

The RFC has a strong product thesis, a useful rejected-ideas record, and mostly accurate grounding of the shipped local auth surface. The principal/identity/credential/assurance split is promising, and the insistence on non-production provenance, closed effects, finite budgets, and no client-carried override is directionally right.

The rehearsal design is not yet safe enough to commission as written. Several claimed structural protections do not cover authority derived from a grant, application state created under simulated assurance, or public callers admitted through a rehearsal window. There are also unresolved ownership and sequencing contradictions.

## Strengths

- The shipped-surface account correctly identifies the capture-only email provider, two-carrier mailbox ceremony, reset-reissued principal ids, missing production delivery, and missing verified claims in `ctx.auth`.
- The RFC preserves important corpus boundaries around provider integrations, notification durability, client-asserted identity, and hosted readiness.
- Rejecting wildcard scopes, browser-carried override capabilities, deterministic fixture principal ids, automatic email linking, and production impersonation is sound.
- Mint-and-honor production refusals, instance/boot/activation binding, protected provenance, gated diagnostics, and explicit acceptance matrices are the right categories of control.
- The six author decisions are recorded clearly enough to identify their intended normative consequences.

## MATERIAL findings

### M1. A rehearsal window disconnects development authority from the caller receiving the waiver

R2 says a grant installs a window under which “matching signups get capture delivery, simulated assurance, and a separate rehearsal budget,” while “ordinary signup UI runs unmodified” and carries no capability. The grant section likewise says the carrier proves authority to “install or exercise” the grant, but window callers present no proof beyond matching a selector such as `*@example.invalid`.

That moves the bearer problem rather than eliminating it: after an authorized installation, anyone who can reach the same `dev`/`test`/`demo` deployment can select the predictable domain and obtain the waiver. This is especially unsafe for `demo`, which may be deliberately exposed. A successful simulated-assurance session also reveals that the window and selector are active, even if the initial HTTP response is uniform.

The profile check is not sufficient. Existing mailbox and mint operations require per-operation `AdminWrite` plus `ImpersonationCapability`; the window removes that second line of proof for downstream public requests.

Resolve by pinning how a window request is bound to the installing runner without putting reusable authority in application code: for example an unguessable, bounded, one-use selector namespace and launcher-bound connection, together with a target-authored non-public reachability requirement. Public/demo exposure needs an explicit refusal or separate threat model. The acceptance matrix must include foreign callers guessing valid selectors and transcript-equivalence tests.

### M2. Grant/window termination does not terminate the authority they create

The prod-bleed list says restart, reset, or activation change invalidates “grants and windows,” but the only rule for derived sessions is: “Rehearsal sessions cannot refresh after their grant ends.” That still permits an ordinary session—and its simulated assurance—to remain usable until its normal expiry after the grant is expired or revoked.

Consequently, the claim that “finite budgets, TTL, revocation, and concurrency ceilings bound a runaway agent loop” is not established. One budgeted session mint can yield a long-lived caller capable of an unbounded number of ordinary app operations. Nothing states when a simulated assurance expires or whether grant/window revocation invalidates it at every invocation gate.

R5 creates a related teardown defect. It says clock advancement is an input to the durable clock floor. LLP 0057 states that floor is non-decreasing and governs later durable auth writes. Once rehearsal advances it, ending the grant or restarting cannot lower it; a non-disposable database can remain far in the future and prematurely expire later ordinary sessions, challenges, or retention deadlines. This contradicts the claim that teardown invalidates everything.

The implementing contract needs:

- rehearsal-session expiry clamped to the governing grant/window;
- immediate projection and invocation-gate refusal when that authority ends;
- use-time validity rules for simulated assurances;
- explicit cleanup semantics for derived identities and sessions; and
- clock advancement confined to an irreversibly disposable store/clone, or a separately modeled simulation domain that cannot raise the ordinary durable floor.

### M3. Rehearsal taint stops at auth state, leaving a production-bleed channel through app state and external effects

The structural copy defense covers only “identities, sessions, and assurances.” But the RFC also promises:

- provisioning hooks that create profile, binding, and membership rows;
- fixtures containing memberships; and
- sessions that “run the same app code that runs in production.”

A rehearsal session with simulated `email_verified` assurance can faithfully invoke an ordinary function or provisioning hook that writes app-owned authorization/configuration state. It can also invoke an action with an external side effect. Deleting the rehearsal identity afterward satisfies “zero rehearsal-tainted identity state,” while the ordinary app row or external effect remains. An app-data-only export/import can therefore carry the result into production without carrying protected auth taint.

This is a concrete hole in the claim that the copied-dev-database channel “fails closed.” Resolve by choosing and enforcing one of these boundaries:

- transitively taint all app writes derived from rehearsal authority and reject their export/import;
- make any store that ever admits rehearsal permanently ineligible for production promotion;
- run rehearsal only on disposable forks whose app data cannot be imported; and
- refuse real external egress under rehearsal unless a declared simulator/test adapter owns it.

Release qualification must cover derived app state, not merely live grants and protected identity rows.

### M4. The assurance model conflates assurance kind with rehearsal provenance

The four-layer frame lists `rehearsal_simulated` alongside `email_verified` as an assurance kind. Later, prod-bleed protection calls `rehearsal_simulated` the protected provenance carried by assurances. Functions meanwhile require `email_verified`.

These readings produce different systems:

- If `rehearsal_simulated` is a distinct kind, it does not satisfy `requires: ['email_verified']`, so the rehearsal mechanism cannot perform its stated job.
- If rehearsal creates an `email_verified` assurance, then the distinguishing field must be source/provenance, not the assurance kind.
- If it creates both without a precise admissibility rule, an implementation can accidentally accept simulated evidence in a context that intended real contact verification.

The load-bearing frame must pin a representation such as `{kind: 'email_verified', source/provenance: 'rehearsal', issuedAt, expiresAt, governingGrant}` and define requirement evaluation by deployment posture. The read-only `ctx.auth` projection from OQ3 must preserve the relevant distinction, even if ordinary application logic is encouraged not to branch on it.

### M5. The claimed closed effect and finite-budget model is not actually closed

R1’s scope enum contains no authority to install a rehearsal window, although R2 says a grant can install one and the audit paragraph separately names every “install.” Installing a public policy window is materially more powerful than a single `challenge.capture` or `verification.simulate` effect and cannot be inferred through scope substitution while claiming a closed enum.

The conceptual record also contradicts “per-effect budgets”:

- it contains no counter for window installs, capture operations, verification simulations, clock advances, or budget allocations;
- `budget.rehearsal.allocate` has no immutable parent ceiling or conservation rule;
- `maxUses` bounds call count, not the quantity allocated in one call; and
- no rule says allocation cannot replenish the grant’s own exhausted budget.

R3 introduces the same closure problem by allowing fixtures to name memberships. There is no membership effect in the enum, while the invariant says rehearsal must never bypass membership rules. An implementation must either invent an unlisted authority, fail to provide the promised fixture, or run a genuine app-authorized membership transition.

Before commissioning the Spec, the RFC must pin:

- an explicit window-install effect;
- whether membership reconciliation is ordinary app work under real authority or is excluded;
- a closed effect-to-counter mapping;
- immutable parent ceilings for all allocations;
- non-recursive/non-renewable allocation;
- atomic charge at each effect’s linearization point; and
- idempotent retry semantics that neither double-charge nor obtain a free effect.

### M6. The claimed authority ownership contradicts LLP 0055 and leaves privileged hooks unowned

The landing section says “This RFC creates no second authority,” and the non-goals say “grants and scopes stay with 0055.” But LLP 0055’s grants are application-plane function authority for service principals. It explicitly says scoped tokens cannot satisfy `Admin*`, `ImpersonationCapability`, provisioning, lifecycle, or host-operation policy.

The rehearsal grant is instead minted through `AdminWrite` plus `ImpersonationCapability`, carries host/provider effects, and introduces a new `sbrc_` carrier. It is therefore a distinct operator/test capability system—not an LLP 0055 grant—unless the RFC improperly crosses 0055’s plane boundary. Calling both things “grant” is acceptable only if their non-substitution and ownership are explicit.

The verified provisioning hook has a parallel gap. It can create bindings and memberships, but no owner is assigned for its sealed invocation authority, permission-backing provenance, allowed write set, or interaction with ordinary authorization. “Generated transactional hook” alone is not a mechanism preventing it from becoming arbitrary system-authority application code.

The RFC should explicitly classify rehearsal authority as a new, non-substitutable operator/test effect capability owned by the rehearsal Spec, revise the categorical 0055 non-goal, and assign the provisioning hook’s invocation and permission-backing rules to an owning LLP.

The same ownership section should correct I3: LLP 0011 specifies stable guest principals and collision refusal, while treating merge as out of scope with an app-level migration escape hatch. `switch_existing`, checkpointed `merge`, quarantine, and reaping are additions proposed by LLP 0151, not hard parts already designed by the 0011 amendment.

### M7. The build-first order is not a feasible dependency order

Move 2 claims to ship R1–R4, including simulated assurance and finite rehearsal budgets. But the assurance layer is move 3 and the effect-budget authority is move 5. Move 6’s guest/password/recovery floor also depends on the move-4 lifecycle state machines and move-5 guessing budgets.

OQ1’s combined release decision is not itself defective, but its recording is ambiguous: either the “first wave” actually includes moves 1–6, or move 2 must ship an unsafe/incomplete substitute for assurances and budgets before their owners exist. “The wedge still leads the wave internally” is particularly incompatible with the floor’s acceptance suites consuming the complete wedge.

Remote/CI carriage adds another undeclared prerequisite: LLP 0150 describes its key-bound proof path as a commissioned Draft extension, not shipped machinery. The first wave must either include that protocol or state that its initial rehearsal carrier is local ready-file/stdin only.

Replace the linear list with an explicit dependency DAG and release boundary. At minimum, the full rehearsal surface cannot be declared ready until the assurance, lifecycle, and effect-budget contracts it consumes are present.

### M8. OQ6’s JWT bridge is a second bearer model despite the categorical non-goal

This is a MATERIAL defective-decision challenge to the recording of ruled OQ6, not a preference against migration support.

The RFC commissions “short-lived, audience-constrained token issuance plus a JWKS endpoint,” while its non-goal says: “No second token or session model—sessions, bearers, rotation, and fencing stay with 0057/0059/0077.” A JWT validated offline through JWKS is a new bearer authority with materially different fencing: an external verifier cannot observe Snapback session revocation, grant termination, generation changes, or sender-binding state until token expiry.

“Audience-constrained” and “short-lived” do not resolve that contradiction, especially without a hard maximum lifetime or source-authority clamp. A faithfully implemented bridge could continue authorizing external production work after the source session or principal has been terminated.

The ruled bridge needs to be recorded as an explicit exception with a security contract: never accepted by Snapback itself; exact issuer/subject/audience rules; authority no wider and expiry no later than its live source; hard maximum TTL; no refresh or delegation; key-compromise rotation behavior; and an explicit bounded-revocation-lag residual for offline verifiers. The categorical non-goal must then be narrowed accordingly.

## DETAIL findings

### D1. “Profile” should be disambiguated

The RFC uses `profile` for `dev`/`test`/`demo` deployment posture, while LLP 0096 already owns “auth profiles” such as `auth/rr` and `auth/live`. Use `deploymentProfile` or another explicit term in the rehearsal schema and diagnostics.

### D2. Captured-inbox listing needs a bulk-disclosure contract

V2 promotes an exact challenge-id lookup into “list pending challenges.” That is a larger disclosure surface even when gated. The LLP 0057 amendment should pin pagination and count caps, whether addresses are returned or redacted, the exact `AdminWrite`/`ImpersonationCapability`/`AdminSecretRead` composition, and planted-sentinel coverage proving bulk results never reach logs, receipts, browser endpoints, or model-visible default output.

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
- Reviewer: Codex `gpt-5.6-sol`, effort xhigh, `codex exec`, read-only sandbox, cwd = capsule

**Review body (verbatim):**

_pending — appended on receipt_
