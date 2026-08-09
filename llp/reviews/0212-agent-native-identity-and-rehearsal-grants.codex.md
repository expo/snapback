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

Self-attestation: I read only files inside this capsule directory. I did not seek or inspect the other family’s review, prior review artifacts, or orchestrator notes.

# Delta review — LLP 0212 v0.2

## Findings

### 1. MATERIAL — IN-DELTA: Store taint does not yet support the claimed export and crash guarantees

Lines 664–675 say the first honored rehearsal effect durably marks the store, that the mark is permanent, and that even an app-data-only export cannot launder derived state into production. The commissioned contract and acceptance matrix do not define:

- Whether the marker commits before or atomically with the first effect. A crash after an effect but before a separate marker write could leave a falsely clean store.
- Whether the marker survives reset, physical backup/restore, cloning, and logical export/import.
- How an app-data-only export carries a protected store marker that is not itself app data.
- How production import distinguishes an untainted export from one whose provenance envelope was omitted.

The current capsule’s logical-export contract does not supply those properties automatically. The rehearsal-grants Spec must own marker ordering, preservation through every supported copy/export path, and fail-closed treatment of missing or malformed provenance. Its acceptance matrix needs crash cuts around the first effect and reset/backup/restore/export/import negatives. If manual data copying is outside the threat model, “cannot launder” must be narrowed to supported Snapback promotion/import paths.

### 2. MATERIAL — IN-DELTA: External-egress refusal has no enforcing authority path or owner

Lines 675–676 say real external egress under rehearsal authority is refused unless a declared simulator/test adapter owns the channel. Yet lines 598–600 correctly prohibit the rehearsal capability itself from invoking application functions. The code that can cause real egress is therefore ordinary app code running under a rehearsal-derived session or simulated assurance.

The RFC does not commission the mechanism that propagates rehearsal provenance through prepared invocation authority, nested calls, actions, provisioning hooks, and provider adapters to a central egress gate. Store taint cannot undo an email, webhook, payment, or arbitrary network action.

The landing shape needs an explicit runtime/egress owner and acceptance rows proving that fixture- and window-derived sessions cannot initiate real egress through direct actions, nested calls, hooks, or delivery adapters, while declared simulators remain usable.

### 3. MATERIAL — IN-DELTA: Window-derived assurance lifetime is not closed

The assurance record has `governingGrant?` but no window lineage (lines 159–165). Rule 5 clamps a session to its grant/window, but validates simulated assurances only against the governing grant (lines 679–686).

Consequently, the text does not require an assurance created through a shorter-lived window to become inadmissible when that window expires or is revoked while the parent grant remains live. `expiresAt?` could implement the expiry case, but no mandatory clamp is stated, and it cannot represent early window revocation by itself.

Either the assurance needs a governing-window reference, or window termination must atomically terminate every assurance and session derived through it. The Spec’s matrix needs window-expiry and window-revocation cases with the parent grant deliberately kept live.

### 4. MATERIAL — IN-DELTA: The closed budget model omits charge-on-denial semantics

Lines 629–637 charge counters at an effect’s linearization point. That does not say what happens when no successful effect occurs—for example, a wrong password, wrong challenge code, malformed credential, enumeration probe, or a request refused because one bucket is exhausted.

That omission is security-significant because A1 explicitly covers guessing and enumeration, while the capsule’s existing contracts require wrong-code attempts to commit their charge and hosted buckets to charge atomically even on denial. Without outcome-specific rules, an implementation could treat failed guesses as free while still conforming to the stated “effect” rule.

The effect-budgets Spec must distinguish attempt/debt counters from successful-effect quota counters, preserve LLP 0060’s atomic multi-bucket charge-on-denial behavior, and bind idempotency identity to the complete normalized request so one key cannot be reused across different guesses.

### 5. MATERIAL — IN-DELTA: “Selectors bind every effect” lacks a total selector mapping

Lines 572–578 make selector binding universal, but describe selector behavior only for capture, redeem, identity creation, and session minting. The illustrative record contains only `fixtureNamespaces`, while the enum also includes:

- `verification.simulate`
- `window.install`
- `budget.rehearsal.allocate`
- `clock.auth.advance`

Those effects require different attenuation axes: identity/contact, generated window namespace, budget name and charge axes, and disposable store/clock domain. The landing item commissions the window selector mint and scope-substitution tests, but not a total effect-to-selector schema analogous to the new effect-to-counter mapping.

Because attenuation is central to the claim that this is not a profile-wide override, the rehearsal Spec must define mandatory selector fields for every effect and reject an effect whose required selector is absent or incompatible.

### 6. MATERIAL — IN-DELTA: Public-reachability refusal depends on a merely declared fact

R2 refuses window installation when “declared reachability is public” (lines 312–314). LLP 0060 explicitly establishes that caller/operator description is not a security fact and that a loopback server may still be exposed by a reverse proxy.

If public refusal is normative, it must consume a target-authored, unforgeable admission fact and fail closed when reachability is unknown. Otherwise the RFC should state that selector entropy—not the reachability declaration—is the actual foreign-caller boundary and describe public refusal as advisory defense in depth. Acceptance should cover a loopback target exposed through a proxy.

### 7. MATERIAL — IN-DELTA: The wave-one password/guest floor still has unowned producer and recovery paths

Wave 1 promises guest creation plus a zero-dependency password-and-recovery-code authenticator, but enumerates only guest claim, password set/change, and recovery-code consume (lines 469–476 and 770–790).

That leaves at least these launch-critical paths implicit:

- Guest principal/session creation.
- Password account creation and password authentication.
- Initial recovery-code issuance.
- Replacement/rotation after use or suspected disclosure.
- One-time plaintext recovery-code custody and redaction.
- Session consequences and last-authenticator enforcement for those operations.

LLP 0151 supplies requirements for several of these, but the new landing decomposition does not assign their implementing contract explicitly. They must be added to the identity-core/0151 commission before the OQ1 “complete floor” release can be claimed.

### 8. DETAIL — IN-DELTA: R5 disappears from the new build order

The evaluation classifies R1–R5 as the wedge and R5 as an early cheap win (lines 433–435), but wave 1b contains only R1–R4 and no later build-order item names R5. Place the clock laboratory explicitly or state that it is deferred.

### 9. DETAIL — IN-DELTA: OQ4 points to the wrong landing item

Line 870 says the budgets Spec is landing-shape item 4. Renumbering made it item 5.

### 10. DETAIL — IN-DELTA: “One-use selector namespace” is ambiguous

R2 describes a “one-use selector namespace” while also describing matching signups in the plural and budget-bounded repeated effects. Clarify whether one-use applies to installation, the namespace itself, each address, or the first matching signup. The choice changes concurrency and retry semantics.

## Delta verification

The revision successfully repairs the grounding of the five-table namespace statement and production request-code refusal; guest-claiming attribution; application/operator-plane separation; membership fixture authority; disposable-store clock confinement; the JWT bridge’s named-exception status; and the OQ6 pointer. The V2 disclosure addition and V3 ordering note are also coherent with the supplied authorities.

I found no PRE-EXISTING concern that independently rises to MATERIAL based on the enumerated delta boundary.

The approximately 31% growth is justified by load-bearing contract text. I do not find a separate bloat concern; the problem is incomplete closure of several new guarantees, not unnecessary addition.

VERDICT: NOT READY

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
- Reviewer: Codex `gpt-5.6-sol`, effort xhigh, `codex exec`, read-only sandbox, cwd = capsule

**Review body (verbatim):**

Blind-review compliance attestation: I did not seek or read the other family’s review, prior review artifacts, or orchestrator notes. All substantive evidence below comes only from capsule files.

## Overall assessment

v0.3 materially improves the proposal. In particular, use-time validation of window-governed assurances, charge-on-denial semantics, durable store taint, and explicit egress-gate ownership are the right closures.

The revision is not ready, however. Five v0.3 changes remain internally incomplete or contradictory. I found no MATERIAL concern in pre-existing text.

## Strengths

- `governingAuthority` correctly prevents assurances minted through a short-lived window from inheriting the parent grant’s longer lifetime.
- The attempt-versus-successful-effect distinction preserves LLP 0057 wrong-code accounting and LLP 0060 charge-on-denial behavior.
- Same-transaction tainting plus crash-cut and lifecycle acceptance is substantially stronger than row-only provenance.
- The complete Wave 1c producer-path enumeration is appropriately concrete.
- Naming selector entropy as the real foreign-caller boundary is more honest than treating loopback binding as proof of private reachability.

## Concerns

### 1. MATERIAL · IN-DELTA — Landing item 2 does not commission the Wave 1c contract it purportedly owns

Wave 1c enumerates guest principal/session creation, guest claim, password account creation and authentication, password set/change, recovery-code issuance/consumption/replacement, plaintext custody, session consequences, and last-authenticator enforcement (§Build order, lines 492–506). Landing item 2 reduces this to “guest claim, password set/change, recovery-code consume” (lines 841–850).

It also does not explicitly commission V6’s readiness rule or posture-independent import-provenance admissibility. “Posture-scoped admissibility rule” does not cover the separately stated posture-independent import contract.

Because the landing section is the ownership handoff, the omitted paths remain uncommissioned despite being described earlier. Resolve by mirroring the complete Wave 1c list in item 2, assigning V6’s readiness derivation, and explicitly assigning import-provenance validation/admissibility. Clarify whether V6 is minimally enforceable in Wave 1b or only becomes enforceable in 2a.

### 2. MATERIAL · IN-DELTA — The window selector has an impossible mint/install ordering

The document says:

- window installation returns a host-minted namespace (§R2, lines 315–320);
- the namespace is a mandatory selector for `window.install` (lines 602–612); and
- all exact selectors are fixed when the grant is minted (lines 691–694).

An output generated during installation cannot simultaneously be an exact mint-time selector authorizing that installation. Calling the output a selector does not scope the pre-install authorization decision.

Choose one coherent protocol:

- mint the namespace with the grant and have installation consume that precommitted value; or
- give `window.install` a mint-time constraint selector, then treat the generated namespace as immutable output and selector of the resulting window authority.

Acceptance should cover namespace collision, reuse, post-mint mutation, and concurrent installs.

### 3. MATERIAL · IN-DELTA — Fail-closed reachability leaves no positive Wave 1 window topology

R2 refuses a window whenever reachability is undeclared or unknown, but no landing item owns a producer of the required target-authored fact or names an eligible positive topology. This matters because Wave 1 carriage is explicitly local-only.

LLP 0060 says a loopback bind cannot prove absence of a public reverse proxy; therefore the ordinary local target cannot truthfully derive “not publicly reachable” merely from its listener. Adding the loopback-behind-proxy negative proves refusal but does not establish any case in which installation succeeds. As written, R2 can be fail-closed everywhere.

Resolve by commissioning a concrete, target-owned admission fact and naming at least one Wave 1 topology that can prove it, with both positive and reverse-proxy-negative acceptance. If no local topology can prove non-reachability, the alternative is to make selector entropy authoritative and narrow the reachability check so unknown does not make the headline window feature unusable.

### 4. MATERIAL · IN-DELTA — Egress provenance is not preserved across durable/deferred work

Landing item 1a carries provenance “from the session” through immediate nested calls, actions, hooks, and adapters. That is insufficient for the capsule’s existing egress model:

- LLP 0045 commits a durable notification intent and delivers it later through a cron sweep.
- LLP 0058 separately recognizes queued/replayed and `System`/cron invocation paths.
- A prepared invocation is an in-memory authority object; a later cron invocation does not inherit the originating session.

A rehearsed mutation can therefore enqueue a real notification, return successfully, and later have the clean `System` runner perform external delivery without rehearsal provenance at the gate.

The amendment must derive provenance from the effective authority or assurance decision—not merely the session—and persist it onto deferred intents or queued work. Rehydrated work must carry it through claim, retry, and delivery. Acceptance should include outbox/cron, queued replay, process restart, and retry. If arbitrary downstream causality is intentionally out of scope, narrow the claim explicitly to egress initiated or durably enqueued by a rehearsal-provenance invocation.

### 5. MATERIAL · IN-DELTA — A merely well-formed export envelope cannot prevent laundering

Production import refuses missing, malformed, and tainted envelopes (lines 707–724), but nothing integrity-binds the envelope to the exported payload. A tainted artifact can receive a syntactically valid “clean” envelope and still enter through the Snapback importer. That remains a Snapback-mediated path, not the disclaimed hand-copy path.

Either:

- authenticate the envelope and bind it to the exact payload, store identity, and relevant marker state using a verifiable trust root; or
- narrow the guarantee to accidental paved-path protection and stop claiming structural prevention of laundering.

Acceptance needs envelope-edit, clean-envelope/tainted-payload splice, payload substitution, and replay negatives.

### 6. DETAIL · IN-DELTA — The illustrative grant is invalid under the new selector rule

The example grants every scope but supplies only `fixtureNamespaces` (lines 638–655). The normative prose says missing selectors for verification, window installation, allocation axes, and clock domain must refuse the effect.

Delete the example—lossless compression because it is explicitly not schema—or show a smaller grant whose scopes and selectors are actually compatible.

### 7. DETAIL · IN-DELTA — Disposable-at-creation marking lacks commissioned persistence and acceptance

R5 says the creation-time disposable marker independently and permanently bars production promotion. Landing item 1 commissions survival and promotion refusal only for rehearsal admission taint.

Specify whether the disposable marker shares the export envelope and reset/backup/restore mechanics, and add a production-promotion negative for a disposable store before any clock advance or rehearsal effect.

### 8. DETAIL · IN-DELTA — One assurance sentence regresses to “governing grant”

The assurance definition correctly requires the exact governing authority, including a mediating window, but the next sentence says `verification.simulate` records “the governing grant” (lines 160–171). Replace that phrase with “governing authority” to prevent the Spec from copying the old lifetime bug.

## Growth assessment

Most v0.3 growth is load-bearing: the new lifecycle enumeration, provenance propagation owner, crash-cut requirements, and denial-accounting language should remain explicit. The illustrative grant record is the clear lossless-compression candidate because it is non-normative, currently invalid, and duplicates the surrounding mappings.

## Recommended next step

Revise only the v0.3 delta: complete landing item 2, choose a coherent namespace mint protocol, name a positive reachability-fact producer, extend provenance through deferred work, and integrity-bind or narrow the export-envelope guarantee. Then run one focused delta verification.

VERDICT: NOT READY
