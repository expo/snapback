# LLP 0150 agent token acquisition review — Fable family

## Round 1 — 2026-08-01

**Reviewer family:** Anthropic Claude (Fable)
**Provider / runtime:** Claude Code Agent tool, fresh `general-purpose`
subagent context (model `claude-fable-5`), non-author
**Date:** 2026-08-01
**Method:** fresh non-author subagent over the working tree; mutually blind —
instructed not to read any `llp/reviews/` artifact concerning LLP 0150 nor
any 0150 super-refine journal; the reviewer recorded its compliance and its
consulted-source list in the artifact below. SHA-pinned target and
instruction capsule. 20 tool uses, ~119k tokens, ~10.5 minutes.
**Instruction capsule SHA-256:** `59a56d9ebbca47bca2ec9fae5b36d8f85915ba378b8553709c315fa94002b142`
**Target:** `llp/0150-agent-token-acquisition.rfc.md` (v0.1, 389 lines, Draft)
**Target SHA-256:** `e83032382335b7901c52210e8b574c7efdf714ac977a3d8c4a9ed69c637fcaa8`
**Repo revision at review start:** `main` `67628399` (target file untracked)
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

# LLP 0150 review — round 1 (Fable family, independent reviewer)

**Blindness compliance:** I did not read any file under `llp/reviews/` concerning LLP 0150, nor any 0150 super-refine journal. Sources consulted: the target, LLPs 0031, 0045, 0053, 0055, 0057, 0062, 0072, 0077, 0098, 0106, 0146, 0149, and the implementation under `src/` (grep-verified, not review artifacts).

## Overall assessment

This is a well-motivated, mostly honestly-argued RFC that gets the big architectural moves right: key-bound grants eliminate the secret-transit class entirely; the no-user-named request flow genuinely dissolves the handle-enumeration oracle that killed 0055's round-3 design (verified against `llp/0055:971-985`); the boundary table correctly assigns ownership to 0055/0077/0106/0149/0053; and the author-decisions section is faithfully reflected in the body (OQ1/OQ4/OQ5/OQ6 all match their sections). The factual grounding is largely accurate — I verified the pairing-code TTL and cap figures, the `GRANT_PENDING`/`GRANT_INVALID` poll semantics, the CAS approval shape, the consent-digest contract, the `auth.mintAgentGrant` profile gating, and the 0053 24-hour lease ceiling against 0055 and 0053, and the sender-replay-epoch machinery against `src/auth/sender_proof.rs`.

But the document is not yet at the bar. Two load-bearing design elements are asserted safe under predicates the document never defines: the standing-delegation binding ("keys enrolled from this machine") that gates the tier-0 silent-mint path, and what approval of a first-contact request actually *creates* — a question 0055's registration model (default `disabled`, owner assignment, registration provenance) answers in ways this RFC silently bypasses. A third structural gap — who sees an unbound pending request in the approvals inbox — quietly re-admits the unsolicited-contact property the document claims to have preserved from 0055's inversion. Beyond those, the escalation/supersede transaction is under-analyzed (concurrent-escalation races, ceremony tier of the union, and the live-state destruction cost that 0053's delete disposition imposes on every mid-task escalation), and there are several misattributions: a refusal code that exists nowhere in the corpus or code, a rotation operation mislabeled as 0055 "re-credentialing," and a file-custody discipline attributed to 0077 that 0077 does not contain.

None of this undermines the direction. It is the difference between "the design is right" and "the design is thought through as far as it can be without code" — the latter requires the trust anchors to be named, and they are not yet.

## Findings

### BLOCKING

**B1. The standing-delegation enrollment predicate — the tier-0 trust anchor — is undefined and, as stated, unverifiable.**
Evidence: `llp/0150:274-282` — "*agents presenting keys enrolled from this machine/installation may be granted scopes matching this template*"; `llp/0150:293-297` — "every subsequent agent, task, and session on that machine acquires read authority with zero human interaction." But the request flow's identity/provenance metadata is agent-supplied (`llp/0150:164-165`), and 0055 is explicit that declared facts about a caller are honor-system (`llp/0055:1293-1300`, "Attestation, honestly"). Nothing in this RFC says how the host establishes that a key was "enrolled from this machine": there is no enrollment ceremony bound to a local channel (loopback callback, an existing session on that machine, a machine-held secret) — only self-asserted provenance. On a served or LAN-reachable host, any remote key can assert the matching provenance and receive silent tier-0 grants under a delegation the owner believed was machine-scoped. The entire ceremony ladder rests on tier 0 being narrowly reachable, and the reachability predicate is missing. Resolution: pin the enrollment binding mechanically (e.g., a key is "enrolled from machine M" iff its first grant was approved through a session or loopback completion on M, recorded host-side; or delegations bind to an explicit key-family list the owner accretes), and state the honest limit for whatever binding is chosen. Until then, tier 0 cannot be evaluated.

**B2. What approval of a first-contact request creates is unreconciled with 0055's registration model.**
Evidence: `llp/0150:172-186` (unknown key, no prior credential, may mint a request; default `open`); 0055 pins agent principal creation behind `auth.agents.mode`, **default `disabled`** (`llp/0055:600`), with distinct creation paths (`register`, invitations) that mint the `kind: "agent"` user row, its **immutable `registration_provenance`**, and — decisively — the **owner** relationship that determines who can later re-credential the agent and assume its accrued authority (`llp/0055:280-298, 589-629`). 0150's approval of an unknown-key request must create a principal, a credential, and a grant in one act, but the document never says: (a) how the first-contact policy knob composes with `auth.agents.mode` (two overlapping policy knobs; under 0055's default, the RFC's default-`open` "cold-start path one step" is unreachable because no principal can be created); (b) whether the approver becomes the **owner** (which carries 0055's ownership-assumption power) or the agent lands unowned (which on `prod` makes it permanently unrecoverable per `llp/0055:792-799`); (c) what `registration_provenance` records for a wholly self-asserted first contact. The RFC promises its deltas land as "named, dated amendments" into 0055 (`llp/0150:328-330`), but this delta — a fourth registration path — is not named as one. Resolution: an explicit subsection pinning the created objects, the owner assignment, the provenance record, and the knob composition (or collapsing the first-contact policy into `auth.agents.mode`).

### MATERIAL

**M1. `SNAPBACK_AUTH_SCOPE_INSUFFICIENT` misnames the pinned, implemented refusal.**
Evidence: `llp/0150:226-227` presents it with the definite article ("the typed refusal (`SNAPBACK_AUTH_SCOPE_INSUFFICIENT`)"). The corpus and the code pin `SNAPBACK_AUTH_GRANT_SCOPE_DENIED` — already carrying "the missing scope and a reason kind" (`llp/0055:1139-1142`) — and it is implemented (`src/diagnostic.rs:233`, `src/auth/invocation.rs:1549`). `SNAPBACK_AUTH_SCOPE_INSUFFICIENT` appears nowhere else in the repository. Either use the existing code (the natural home, since it already carries the missing scope) or explicitly register a new code and say why the existing one is not extended. As written it is a misattributed fact about the corpus in the section that defines the RFC's escalation mechanism.

**M2. Approvals-inbox visibility is undefined, and it silently re-admits unsolicited contact.**
Evidence: `llp/0150:210-218` makes the inbox the "trust-anchored path"; `llp/0150:166-169` makes requests name **no user**. So whose inbox shows an unbound pending request? If every authenticated user's, then in a multi-user production app every spam request under the default `open` policy is delivered to every user — precisely the unsolicited-request property the document credits 0055's inversion with eliminating (`llp/0150:80-84`) and claims to have preserved ("the inversion's guarantees survive," `llp/0150:204-208`). It also contradicts "an unapproved request creates no state a user must clean up" (`llp/0150:222-223`) in spirit: inbox rows are user-facing state. Relatedly, the document never states that the approver becomes the grant's effective user. Resolution: pin inbox scoping (e.g., unbound requests are visible only to operators/owners, or only via the capability URI, with the inbox listing only requests the viewing user has opened), pin the effective-user binding at approval, and re-derive the spam analysis under that rule.

**M3. The supersede transaction is under-analyzed on three axes.**
Evidence: `llp/0150:238-247`. (a) **Concurrent escalations.** 0055's CAS is per-request ("concurrent approvals yield exactly one grant," `llp/0055:994-996`). Two *distinct* pending escalation requests naming the same predecessor G (union G+A, union G+B) are a different race: approving both serially either loses A (second union is over already-revoked G) or fails opaquely. The document must pin it (e.g., a pending escalation whose predecessor is superseded is terminally invalidated or re-based, with the non-enumerating refusal). (b) **Ceremony tier of the union.** If predecessor G contains a tier-2 scope (`authorityCreating`, consented under step-up per `llp/0055:1164`), what tier does approving an escalation whose *increment* is tier-1 require? Tier-by-increment launders tier-2 scopes into new grants through one-click ceremonies; tier-by-union ratchets every later escalation to step-up forever. Either answer is defensible; neither is stated. (c) **The destruction cost.** "Tokens fenced to the predecessor die with it" (`llp/0150:246-247`) understates: under 0055/0053, grant revocation projects pending-revoked with **delete** disposition onto the agent's connections and client state (`llp/0055:1239-1248`), and queued work settling against the durable axis fails settlement when the grant is revoked (`llp/0055:531-546`). So every mid-task escalation — the RFC's motivating scenario — destroys the agent's live subscriptions and strands its queued mutations at the moment of approval. That may be acceptable, but it is a real cost of supersede-over-stacking that the trade-off discussion omits, and mitigations (successor re-basing as a named 0055/0053 amendment) are unexplored.

**M4. Supersede launders delegation-minted scopes out of the delegation's revocation set.**
Evidence: `llp/0150:281-282` ("revoking the delegation revokes the grants it minted") composed with `llp/0150:239-241` (escalation mints a successor by explicit consent, union of predecessor scopes). A tier-0, delegation-minted grant that is later superseded through one explicit escalation carries the delegation-template scopes into a grant the delegation did **not** mint — so revoking the delegation no longer reaches them, contrary to the owner's mental model ("revoke the delegation, kill what it authorized"). The consent at escalation makes this defensible, but the composition is unstated: pin whether successor grants record delegation lineage and whether delegation revocation propagates through supersede chains.

**M5. Key rotation is mislabeled as 0055 "re-credentialing," and the re-bind operation is unspecified.**
Evidence: `llp/0150:130-133` — "roll its key and re-bind without a consent ceremony (same authority, new key — this is re-credentialing in 0055's sense and inherits its owner-assumption disclosures)." In 0055, **re-credentialing** is the owner path that atomically **terminally revokes every grant** and requires step-up (`llp/0055:653-661, 1170`); the grant-preserving, no-ceremony operation is **rotation** (`POST /auth/agents/rotate`, generation bump, durable 1/hour throttle, `llp/0055:836-858`). A key roll that keeps grants live is rotation's analog, and owner-assumption disclosures attach to *owner* re-issue, not self-rotation. Beyond the mislabel, the operation itself is unpinned: what authenticates binding a new public key (a proof under the old key, presumably — but if the old key is being rolled because it is suspected stolen, the thief can also re-bind); whether the rotation throttle and the tombstoned-family `revoke-self` semantics (`llp/0055:843-867`) carry over with thumbprints in place of secret hashes. These are exactly the custody edge cases the capsule's threat model cares about.

**M6. Agent-side key custody is unowned, and the cited 0077 discipline does not cover it.**
Evidence: `llp/0150:104-108` attributes to 0077 "unexportable where the platform allows, file-custody with tight permissions where it does not." 0077 specifies non-extractable WebCrypto P-256 keys in browser IndexedDB (`llp/0077:1002-1008, 1110`); it contains no file-custody discipline (no hit for file/keychain/0600 custody in the document). For the population this RFC actually serves — CLI/daemon agent processes — the custody questions (key location, permissions, per-agent vs per-machine keys, multi-agent hosts, what "the same machine" means for B1) are new surface this RFC must own or explicitly assign, not inherit by citation. The honest cost paragraph (`llp/0150:141-143`) concedes host compromise loses everything, which is right, but the non-compromise custody spec is still missing.

**M7. Hosted-target posture is unstated.**
Evidence: 0055 v1 refuses **all** agent-management routes wholesale on hosted targets (`llp/0055:1191-1196`). 0150 adds new agent-management surface (grant-request route, poll, consent page, approvals inbox) and never states whether it inherits that refusal — while invariant 5's "the host is sovereign" framing (`llp/0150:56-60`) invites the reading that the surface exists everywhere the host runs. One sentence pinning "inherits 0055's hosted refusal; un-refusing rides the same gates" would close it; its absence leaves the deployment envelope of the whole design ambiguous.

**M8. "Per source" is undefined exactly where it must carry the load.**
Evidence: `llp/0150:162-163, 219-223` — the route is "capped and throttled per source," with a "stricter cap" for unauthenticated first contact. For credentialed requests the source is the credential; for a wholly unknown key, the key itself cannot be the source (keypairs are free to mint), leaving IP — which 0055 itself flags as bounded-abuse posture only, since on a local box all sources are loopback (`llp/0055:620-622`). Under the default `open` policy, the only real backstops are whatever global/per-app pending ceiling exists and the inbox posture (M2). Pin the cap key (per-IP plus a global unauthenticated-pending ceiling per app, or similar) and state its honest limits.

### DETAIL

**D1. The tier-2 roster is an unnamed 0055 amendment.** 0055 requires step-up at approval **iff** the request contains an `authorityCreating` scope (`llp/0055:1164`); 0150 tier 2 adds action scopes, delegations, and app-marked functions (`llp/0150:262`). Reasonable, but it changes 0055's approval-route contract and should appear in the named-amendments list.

**D2. Requested "ceilings" are not expressible in 0055 grants today.** The request payload includes "TTL, ceilings" (`llp/0150:165-166`), but 0149 F6 is explicit that only expiry is a configurable grant fact and call-count/concurrency/spend ceilings are "new surface the compiler can only propose once 0055 grows them" (`llp/0149:304-311`). State the dependency.

**D3. The preflight citation points at the wrong finding.** "The same facts the preflight surface exposes (LLP 0149 F2)" (`llp/0150:229-230`): the effective-actionability/preflight surface — including "what additional grant would it require" — is F1 (`llp/0149:137-172`); F2 is the operation-safety-facts finding. Cite F1 (or F1/F2).

**D4. Dev auto-approve leaves the effective user unbound.** Tier-0/1 auto-approval under the `sbat_` holder (`llp/0150:307-311`): for a delegated grant, which effective principal does the auto-approved grant bind? Unstated.

**D5. Tier-0 mint proliferation vs 0055 caps.** "Every subsequent agent, task, and session" minting grants (`llp/0150:296-297`) will meet the 50-grants-per-actor/effective-user caps with "consent never silently evicted" (`llp/0055:898-900`); silent mints will start failing typed on busy machines. Name the interaction (coalescing, delegation-scoped grant reuse, or a cap carve-out).

**D6. Escalation delta-rendering invites salami-slicing.** The consent page "renders the delta" (`llp/0150:241-243`); an agent can accumulate broad authority through many small one-click increments. The union framing ("everything grant G could do, plus…") helps; make rendering the **full effective scope set** normative, and consider surfacing escalation count/cadence on the page.

**D7. "Paid and measured" is asserted for 0077's token-exchange shape without a pointer.** (`llp/0150:117-119, 135-136`.) The exchange machinery exists and was drilled (`llp/0077` v2 lane; `src/auth/sender_proof.rs`), but I found no measurement record for the verify-cost claim. Cite one or soften to "paid."

## Commissioned debates

### OQ2 — credential-kind coexistence: recommend **exclusive**

The coexistence case ("one identity spanning a key-capable machine and a constrained CI runner") fails the pressure test on three grounds:

1. **Min-security composition defeats the RFC's own headline.** The key-bound path's core sell is that leaked bytes are inert (`llp/0150:126-129`). A coexisting `sbac_` bearer on the same identity reopens exactly that leak class *for the same principal*: the identity's effective custody is the weaker of the two kinds, and every audit fact ("agent X did Y") stops distinguishing which custody did it without new per-credential attribution surface. Coexistence quietly converts "this agent is sender-constrained" from a property of the principal into a property of one of its credentials — a distinction no consent surface currently renders.
2. **The invariant being reworked is load-bearing, not incidental.** One-live-credential is what keeps `(credentialId, credentialGeneration)` unambiguous in every fencing tuple, keeps rotation/registration/recovery atomic, keeps the rotation throttle and tombstoned-family `revoke-self` semantics coherent, and keeps "revoke the agent" one act (`llp/0055:815-822, 836-867`). Coexist-per-kind must rework all of it for a use case that is, at bottom, an anti-pattern: a dev machine and a CI runner are different trust domains, and identities should not span trust domains.
3. **Separate-agents is not the fragmentation it sounds like.** A CI runner enrolled as its own principal gets honest attribution, an independent blast radius, and independent revocation — which is what an operator *wants* when CI is compromised. The consent-history "fragmentation" cost is real but small, and §4's standing delegations amortize the extra ceremony on the machine where it recurs.

So: keep 0055's invariant unchanged; kind-switch is a rotation (the author's lean), and the guidance for constrained environments is a separate principal. If a genuine spanning use case materializes, coexistence can be revisited with the per-credential attribution surface it would require — but the RFC should not pay for it speculatively.

### OQ7 — flow consolidation: recommend **keep both**, pinned to shared substrate

Retiring the pairing code would be a mistake, for four reasons:

1. **It is load-bearing inside this RFC's own design.** The `credentialed` first-contact position names "pairing code, or invitation" as its satisfiers (`llp/0150:174-177`). The stricter policy's mechanism cannot be the flow being retired.
2. **Its guarantee is structural, not quantitative.** Pairing makes unsolicited requests *impossible by construction*; the approval link makes them *bounded by caps* — and findings M2/M8 show the bounding is currently underspecified. Until the inbox scoping and cap keying are pinned and proven, the structurally stronger flow is the system's safety margin, not redundancy.
3. **The "inbox subsumes it" argument reinvents it.** A user-initiated request minted *from* the inbox must still be carried to the agent and bound to its key — which is a pairing code with different formatting. The user-initiated entry point doesn't obsolete pairing; it demonstrates the need for it.
4. **The direction of out-of-band carriage differs.** Pairing moves a short code human→agent and needs no consent page reachable from the human's network position; the approval link moves a URI agent→human and requires the human's browser to reach the host's served surface. The air-gapped/ops case (`llp/0150:312-315`) is real, and it is pairing-shaped. Meanwhile the retirement savings are small: the pairing state machine is specified in 0055 and already implemented (`src/server.rs:7701-7709`, `/auth/pairing-codes`), and both flows already share the poll semantics, request records, CAS approval, and consent digest.

The acceptance-matrix cost should be controlled the other way: pin normatively that both flows converge on **one** request-record type and **one** approval transaction, so the matrix multiplies only at the entry edge. Keep pairing as the trust-anchored, user-initiated primitive backing `credentialed` policies and constrained topologies; keep the approval link as the ergonomic default.

## Strengths worth preserving

- **The key-bound inversion and its honest cost ledger** (§1) — no secret transits, stolen tokens inert, and the compromised-host limit stated rather than hidden. The rejected hash-enrollment middle option is a model of recording a considered alternative.
- **The no-user-named request shape** — correctly diagnoses and preserves the lesson of 0055's round-3 failure (verified against `llp/0055:971-985`); the enumeration-oracle claim survives attack as far as the request/poll surfaces go.
- **The static-facts-only rule for escalation descriptors** (§3) — a crisp, checkable line that keeps the refusal from becoming an authorization oracle; it held up under my attempts to break it.
- **Supersede-over-stacking's legibility rationale** — "one legible record per agent-user pair, one revocation act" is the right north star even though the transaction needs the M3/M4 work.
- **Raise-only tier floors with non-overridable tier-2 pins** (§4) — the correct monotonicity, cleanly stated.
- **Invariant 5 and §6** — the sovereign-host boundary with Expo as pure projection is exactly right and consistently maintained through the body.
- **The boundary table and named-amendment discipline** — the document mostly knows what it does not own; the fixes above are about completing that discipline, not replacing it.

## Verdict

**NOT READY.** The bar is "thought through as much as possible without running code," and the document falls short of it in identifiable, fixable ways: the tier-0 trust anchor (B1) and the first-contact creation semantics (B2) are asserted-safe under predicates the document never defines — those are design questions, not empirical ones, and they must be answered on paper; the inbox scoping gap (M2) undercuts the document's own central security claim about preserving 0055's inversion guarantees; and the supersede transaction (M3/M4) has un-analyzed races and costs at exactly the consent-critical moment the RFC exists to design. The misattributions (M1, M5, M6) are individually small but sit on security-load-bearing sentences. The direction is sound, the scaffolding is strong, and both commissioned debates can close in the author's favor with the arguments above — one more revision that names the missing predicates and reconciles the 0055 seams should reach READY.

## Round 2 — 2026-08-02

**Reviewer family:** Anthropic Claude (Fable)
**Provider / runtime:** Claude Code Agent tool, fresh `general-purpose`
subagent context (model `claude-fable-5`), non-author
**Date:** 2026-08-02
**Method:** delta-scoped round — the reviewer read its own family's round-1
artifact only; excluded the Codex artifact and the super-refine journal
(compliance recorded in the artifact below). SHA-pinned target and capsule.
35 tool uses, ~103k tokens, ~7.8 minutes.
**Instruction capsule SHA-256:** `ee86cdd86e452012e464f4349039029e1c597ff67df5f23352027370a8c2fb7b`
**Target:** `llp/0150-agent-token-acquisition.rfc.md` (v0.2, 618 lines, Draft)
**Target SHA-256:** `daf4a58509e6a45788a2985bee74eb8944f8b3f3dacd58c35134419864ac2343`
**Status:** completed
**Verdict:** NOT READY (all 17 round-1 findings resolved; 3 MATERIAL + 4
DETAIL new, all in v0.2-introduced surface)

## Verbatim review (round 2)

# LLP 0150 review — round 2 (Fable family, independent reviewer)

**Blindness compliance:** I read exactly one review artifact: my own family's round-1 artifact (`llp/reviews/0150-agent-token-acquisition.fable.md`). I did not read `llp/reviews/0150-agent-token-acquisition.codex.md`, any other 0150 review artifact, or any 0150 super-refine journal. Sources consulted: the v0.2 target, LLPs 0031, 0045, 0053 (via 0055's incorporated text), 0055, 0057, 0077, 0106, 0149, and `src/diagnostic.rs` / `src/auth/invocation.rs`.

## Round-1 resolution table

| Finding | Status | Evidence |
| --- | --- | --- |
| B1 — delegation subject predicate undefined | **Resolved** | Subject is now an owner-accreted key list with explicit rejection of self-asserted machine identity (`llp/0150:413-426`), and the honest floor ("one click per new key, zero per subsequent request") is stated rather than the false "zero human interaction" promise (`llp/0150:428-436`) |
| B2 — first-contact creation unreconciled with 0055 | **Resolved** | Rides `auth.agents.mode` (`llp/0150:240-259`, matching `llp/0055:600-621`); the `approvalLink` atomic transaction pins principal + credential + grant, owner binding with 0055's owner-assumption disclosure, and unverified `registration_provenance` (`llp/0150:261-271`); named as amendment §7.3 |
| M1 — misnamed refusal code | **Resolved** | `SNAPBACK_AUTH_GRANT_SCOPE_DENIED` used (`llp/0150:315-317`), matching `llp/0055:1141` and `src/diagnostic.rs:233`, `src/auth/invocation.rs:1549` |
| M2 — inbox visibility undefined | **Resolved** | Unbound requests invisible until capability presented; the three listable classes pinned (`llp/0150:286-301`); effective-user binding at approval pinned (`llp/0150:230`) |
| M3 — supersede under-analyzed (races, union tier, destruction cost) | **Resolved — but the fix introduced N2** | Sibling invalidation (`llp/0150:350-353`), union-tier ratchet (`llp/0150:359-361`), destruction cost named and verified against `llp/0055:1242-1248` (delete disposition) and `llp/0055:539-542` (settlement fails) (`llp/0150:374-383`) |
| M4 — supersede launders delegation scopes | **Resolved** | Lineage recorded; delegation revocation propagates through supersede chains (`llp/0150:368-372`) |
| M5 — rotation mislabeled re-credentialing | **Resolved — but the fix introduced N1** | Rotation-vs-recovery split now correct against `llp/0055:836-867` (throttle, tombstoned family, thief-can-rotate honesty) and `llp/0055:651-658` (owner re-credentialing terminally revokes, delegators re-consent) (`llp/0150:172-185`) |
| M6 — key custody unowned | **Resolved** | Custody floor owned here: per-agent keys, keychain-else-0600, honest compromised-host limit (`llp/0150:166-171`); 0077's browser-only coverage correctly restated (`llp/0150:148-151`, matching `llp/0077:1179-1181`) |
| M7 — hosted posture unstated | **Resolved** | Every new route inherits 0055's wholesale refusal (`llp/0150:479-483`, matching `llp/0055:577-581`) |
| M8 — "per source" undefined | **Resolved** | Credential-keyed caps, per-IP with the loopback honesty, global per-app unauthenticated ceiling, proof-gate pricing, 10-minute TTL (`llp/0150:303-311`); the "pending cap of 10" attribution is real (`llp/0055:902`) |
| D1 — tier roster unnamed amendment | **Resolved** | §7.6 (`llp/0150:515-516`) |
| D2 — inexpressible "ceilings" in payload | **Resolved** | Request payload now scope records + TTL + unknowns only (`llp/0150:212-215`) |
| D3 — wrong preflight citation | **Resolved** | F1 cited (`llp/0150:120`, matching `llp/0149:140`) |
| D4 — dev auto-approve effective user unbound | **Resolved** | Pinned to the impersonated dev principal (`llp/0150:472`) |
| D5 — tier-0 mints vs grant caps | **Resolved** | Reuse-coalescing named against the 50-grant cap (`llp/0150:442-447`) |
| D6 — escalation salami-slicing | **Resolved** | Full union rendered normatively at consent (`llp/0150:279-280`) |
| D7 — unsupported "measured" claim | **Resolved** | Claim removed; costs restated as "bounded, not eliminated" (`llp/0150:190-193`) |

All seventeen round-1 findings are substantively resolved. Two resolutions introduced new defects, reported below.

## New findings

### MATERIAL

**N1. The key-bound `revoke-self` mapping makes public data an authorizer — and `revoke-self` is missing from the proof-on-every-use enumeration.** *(v0.2-introduced.)*
Evidence: `llp/0150:176-178` — "the 0055 rotation throttle and tombstoned thumbprint family retained (with thumbprints standing where secret hashes stand in `revoke-self`)". In 0055, the retained *hash* is the matcher and presenting the secret **preimage** is the authorization (`llp/0055:844-845`: "accepts any attributable secret in the credential's tombstoned family"; `llp/0055:862-864`: "an attributable tombstoned bearer"). The preimage of a JWK thumbprint is the **public key** — public data by construction, printed in every grant request and rendered on every consent page (`llp/0150:281`). A literal implementation of "thumbprints stand where secret hashes stand" accepts a bare public key as the family-destruction credential, letting anyone who has ever *seen* the agent's public key destroy its credential family — forcing owner re-credentialing (step-up, every grant terminally revoked, delegators re-consent, `llp/0055:653-658`). The enumeration at `llp/0150:139-140` ("Every authenticated use — token mint, invocation, poll, rotation — carries a per-request proof") omits exactly this route. In 0055's secret world the same construction was safe because the preimage was secret; the v0.2 mapping ports the mechanism without porting the authorization property. Resolution (displacement-neutral): add `revoke-self` to the line-139 enumeration, and replace the line-177 parenthetical with "with a proof under any tombstoned-family key standing where the presented secret stands — the bare thumbprint, being public, authorizes nothing."

**N2. The supersede expiry rule's exception is vacuous — the guard cannot fire under the document's own rules.** *(v0.2-introduced.)*
Evidence: `llp/0150:354-358` — expiry is `min(requested, predecessor's remaining)` "**unless** the consent ceremony is performed at the **union's** tier over the full union — only a full re-consent can extend life." But `llp/0150:359-361` makes *every* escalation approval occur at the union's tier ("Ceremony tier is the union's tier"), and `llp/0150:279-280` makes *every* escalation consent page render "the predecessor and the full union." Both conditions of the exception are therefore satisfied by every ordinary escalation approval, so the clamp never binds and the stated goal — "a tier-1 increment can never quietly prolong tier-2 authority" — is not achieved by the rule as written. "Full re-consent" is undefined and indistinguishable from what §2 already mandates. Resolution (net-shorter): make the clamp unconditional — successor expiry is always `min(requested, predecessor's remaining)`; extension is a renewal, which 0055 already defines as "a fresh consent, never a silent extension" (`llp/0055:1012-1014`). Delete the exception clause.

**N3. The supersede transaction never pins who may approve — cross-user approval revokes another user's grant, and autonomous predecessors are unhandled.** *(v0.2-introduced surface.)*
Evidence: the approval-binding rule is general — "Approval binds the approving user as the grant's effective user" (`llp/0150:230`) — and the capability URI grants "the ability to *see and decide* the request" to whoever opens it (`llp/0150:222-224`, `llp/0150:288-292`: any authenticated viewer who imports the URI gets the request listed). The predecessor-live CAS validates liveness, recovery generation, and credential family (`llp/0150:344-349`) but **not** that the approver is the predecessor's effective user. So user B, opening an escalation URI the agent printed, can approve — atomically **revoking user A's grant** (an act A never consented to, with the §3 destruction cost landing on A's delegation) and re-binding the union under B (`_auth_grants.effective_user_id`, `llp/0055:930`). Worse, an **autonomous** predecessor (effective user null, minted via template or `auth.mintAgentGrant`) reaching §3 would be converted into a *delegated* grant by whoever approves. Resolution (one clause in the CAS bullet): the transaction additionally validates that the approver is the predecessor's effective user; autonomous predecessors are outside the §3 path (their escalation is a re-mint through the authority that created them). Add an approver-mismatch row to §8's matrix (non-enumerating refusal).

### DETAIL

**N4. "Widening" vs key admission tier seam.** Table row 2 puts "creating or widening delegations" at tier 2 unconditionally (`llp/0150:399`); the §4 text puts key admission at "tier 2 the first time and tier 1 for subsequent key admissions" (`llp/0150:424-427`). Whether subject-set growth counts as "widening" is left to inference on a gate that guards tier-0. One-word fix: in the table row, say "creating or template-widening delegations" and cross-reference the admission rule.

**N5. Challenge issuance is the one unpriced route in the flood analysis.** §1 pins "no request state for a key whose private half the requester has not demonstrated" (`llp/0150:134-136`) and §2 prices request minting at a keypair plus signature (`llp/0150:308-310`) — but the challenge-nonce issuance that *precedes* the proof is a bare POST, and if challenges are server-state the flood just moves one route earlier. The commissioned 0077 extension names the exchange (`llp/0150:152-154`) but not the requirement. One clause: challenges must be stateless (self-authenticating, 0077's epochal-nonce shape) or counted under the same global ceiling.

**N6. Dev auto-approval of delegated requests is new 0055 surface not in §7.** `auth.mintAgentGrant` covers **autonomous** grants only (`llp/0055:1175`, `llp/0055:1026`); §5's auto-approval of tier-0/1 *delegated* requests with a pinned impersonated effective user (`llp/0150:467-474`) is a new approval path under those capabilities. Add one line to §7.3 (it composes naturally with the `approvalLink` amendment) rather than a new item.

**N7. The Expo overlay does not inherit the inbox routing rule.** §6 says "pending requests **may** additionally be *visible* in an account-level view" (`llp/0150:487-489`) with no scoping, while §2 makes unbound requests invisible to everyone on the host itself (`llp/0150:286-296`). Read literally, the account view could re-create the broadcast consent-fatigue queue §2 just eliminated — at the account level. One clause: the overlay projects only what the host inbox would show that viewer.

## Commissioned debates

**OQ2 — credential-kind coexistence: confirm exclusive.** My round-1 arguments (min-security composition defeats the headline; the one-live-credential invariant is load-bearing across fencing, rotation throttle, and `revoke-self`; separate-agents gives the honest blast radius) all survive against v0.2 — and v0.2 *strengthens* the case: the supersede CAS now validates "credential family unchanged" (`llp/0150:346-347`), so coexistence would have to define which family fences a grant across a kind-switch mid-escalation-chain, another surface reworked for a use case that remains an anti-pattern (identities spanning trust domains). Keep the author's lean: exclusive; kind-switch is a rotation; constrained environments enroll as separate principals.

**OQ7 — flow consolidation: confirm keep both.** v0.2 adopted the shared-substrate pin my round-1 recommended (one request record, one approval transaction, one digest, one poll contract, closed `userSeeded`/`agentRequested` discriminator — `llp/0150:610-614`), which caps the acceptance-matrix cost at the entry edge. My round-1 point that the caps were underspecified is now weaker (M8 resolved), but the structural points stand: `invited` mode's mechanism *is* the pairing code (`llp/0150:250-251`), the carriage direction differs (headless/air-gapped case, `llp/0150:475-478`), and the document's own observation that an inbox-minted user-bound seed "*is* pairing semantics under another UI" (`llp/0150:616-618`) concedes the primitive is irreducible. Retiring it would save one entry edge and lose a structural guarantee.

**OQ3 re-scoping: correct.** Pinning proof-bound terminal release (`llp/0150:158-161`) closes the security half on paper; the remaining classification decisions (bearer-status semantics of the bare request id, sensitivity rows for user code / nonce / access token) are honestly named as open inside §7.8 (`llp/0150:599-605`). No objection.

## Verdict

**NOT READY** — narrowly, and for a different reason than round 1. Every round-1 finding from this family is substantively resolved; the architecture, the boundary discipline, and the honesty of the cost ledger are now at the bar, and both commissioned debates can close as recommended. What holds it back is exactly the failure mode the capsule warns about: the v0.2 fixes introduced three MATERIAL defects in the new normative surface — a public-key-authorizes-family-destruction hole in the ported `revoke-self` mapping (N1), a supersede-expiry guard that cannot fire under the document's own tier and display rules (N2), and an approver-identity gap that makes escalation approval a cross-user revocation primitive (N3). All three sit in text that §7 will transplant verbatim into the 0055/0077 amendments, and all three are answerable on paper with clause-level, displacement-neutral edits (N2 is net-shorter). "Thought through as much as we can without writing code" is not yet true of these three corners; one disposition pass that applies N1–N3 (and sweeps N4–N7) should reach READY without re-opening any design question.

## Round 3 — 2026-08-02

**Method note (orchestrator):** delta-scoped round; the reviewer's own
provenance block is embedded in its verbatim review below. 18 tool uses,
~99k tokens, ~7.1 minutes.
**Status:** completed
**Verdict:** READY (all 7 round-2 findings resolved; 1 MATERIAL + 6 DETAIL
new, all clause-level; author recommendation: accept after a disposition
pass gating on F1)

## Verbatim review (round 3)

# LLP 0150 review — round 3 (Fable family, independent reviewer)

**Reviewer family:** Anthropic Claude (Fable)
**Provider / runtime:** Claude Code, non-author reviewer (model `claude-fable-5`)
**Date:** 2026-08-02
**Method:** delta-scoped round per the round-3 capsule. Read exactly one review artifact: my own family's (`llp/reviews/0150-agent-token-acquisition.fable.md`, rounds 1–2).
**Exclusions (blindness compliance):** did NOT read `llp/reviews/0150-agent-token-acquisition.codex.md`, any other 0150 review artifact, or any 0150 super-refine journal. Sources consulted: the v0.3 target, LLPs 0055, 0077, 0149 (grep-verified at cited lines), and `src/diagnostic.rs` / `src/auth/invocation.rs`.
**Instruction capsule SHA-256:** `888597e6e9ea93d9699df72247a68aa060f7f046c1fcac88d5b9de6e04cf9fbb`
**Target:** `llp/0150-agent-token-acquisition.rfc.md` (v0.3, 745 lines, Draft, untracked)
**Target SHA-256:** `9226e013f50372b6376f422795481d79ea5d08e9dd00ebd174dc38fde36b6d83`
**Repo revision at review start:** `main` `67628399`
**Verdict:** **READY** (all 7 round-2 findings resolved; 1 MATERIAL + 6 DETAIL new, all clause-level; author recommendation below)

## Round-2 resolution table

| Finding | Status | Evidence |
| --- | --- | --- |
| N1 — bare public key authorizes family destruction; `revoke-self` missing from proof enumeration | **Resolved** | `revoke-self` added to the proof-on-every-use enumeration (`llp/0150:153-157`); the parenthetical replaced exactly as recommended — "a **proof under any tombstoned-family key** stands where 0055's presented secret stands — the bare thumbprint, being public data …, authorizes nothing" (`llp/0150:199-202`); §8 carries the row (`llp/0150:660-661`). The "tombstoned-family" wording mirrors 0055's own (`llp/0055:844-845`, `llp/0055:1167`), so any live-key ambiguity is inherited, not introduced |
| N2 — vacuous expiry-clamp exception | **Resolved** | Clamp is unconditional, exception deleted, net-shorter as recommended: "The successor's expiry is `min(requested, predecessor's remaining)`, always. Extension is a **renewal**, which 0055 already defines as a fresh consent" (`llp/0150:422-426`) |
| N3 — approver identity unpinned; autonomous predecessors unhandled | **Resolved** | CAS validates "**the approver is the predecessor's effective user**" with the not-a-cross-user-revocation-primitive rationale (`llp/0150:408-411`); autonomous predecessors (`effective_user_id` null) excluded from §3 entirely (`llp/0150:411-414`); approver-mismatch row added to §8 (`llp/0150:663-665`) |
| N4 — "widening" vs key-admission tier seam | **Resolved** | Table row reads "creating or **template-widening** delegations (subject admission is governed by §4's explicit-act rule)" (`llp/0150:467`); §4 pins admission as an explicit tier-1 act with a stated rationale (`llp/0150:497-502`) — the rationale has a small gap, see F7 |
| N5 — challenge issuance unpriced in the flood analysis | **Resolved** | "The challenge nonces that precede requests (§1) are stateless — self-authenticating in 0077's epochal shape — or counted under the same global ceiling, so the flood cannot simply move one route earlier" (`llp/0150:358-361`) |
| N6 — dev auto-approval of delegated requests not in §7 | **Resolved** | §7 item 2 names it: "a new approval path under `AdminWrite` + `ImpersonationCapability`, which today gate autonomous grants only" (`llp/0150:604-609`), composed into the `approvalLink` amendment as recommended |
| N7 — Expo overlay doesn't inherit inbox routing | **Resolved** | Overlay projects "**exactly what the host's approvals inbox would show the host user they map to**"; "Unbound first-contact requests project to no one: §2's routing rule carries over" (`llp/0150:578-586`) |

All seven round-2 findings from this family are substantively resolved, and — breaking the pattern of the previous two rounds — none of the v0.3 fixes I audited introduced a security defect. I specifically attacked the new surface for the failure mode the capsule warns about: the proof-bound `revoke-self` (checked against 0055's family/preimage semantics), the rotation-invalidates-pending rule (covered by the §3 CAS for escalations and by digest v2's credential-generation field for ordinary requests — consistent), the approver-bound CAS (checked against owner-vs-effective-user and pairing-seeded routing), the unconditional clamp (no interaction defects with `maxGrantTTL` or lineage revocation), and the "dropped by re-credentialing" subject-entry claim (verified true: owner re-credentialing mints a *new credential id, same principal*, `llp/0055:661-662`, so credential-id subject entries do drop). The scope-denied "today its details carry only `reason: missing_scope`" claim is true of the implementation (`src/auth/invocation.rs:1553`) and honestly distinguished from 0055's spec promise (`llp/0055:1140-1142`). The F5-thread non-goal citation is correct (`llp/0149:248`).

## New findings

### MATERIAL

**F1. The `invited` lane's invitation-consumption timing is stated twice, incompatibly, and its pending budget is unpinned — leaving the "separate budgets" flood-immunity claim unverifiable.** *(v0.3-introduced.)*
Evidence: `llp/0150:277-283` — "an unknown key's request **must consume** a live creation invitation (`sbagi_`)" (consumption at request minting); `llp/0150:286-290` — "an `invited` approval **consumes only a still-live invitation**" (consumption at approval — impossible if the request already consumed it; 0055 invitations are "single-use under CAS," `llp/0055:829`). The same invitation cannot be consumed at both moments, and each reading has different consequences the document doesn't choose between: consume-at-mint burns an invitation on a request that may expire unapproved (and contradicts "an unapproved request creates no state any user must clean up," `llp/0150:346-347`); consume-at-approval means one live invitation can seed unboundedly many pending requests (keys are free, the cap is one pending *per key*, `llp/0150:354`), and nothing says whether invitation-bearing requests count under the "global per-app ceiling on **unauthenticated** pending requests" (`llp/0150:355-357`). That matters because the starvation-residual paragraph asserts "the flood cannot touch credentialed, `invited`, or pairing-seeded requests, which **draw from separate budgets**" (`llp/0150:365-368`) — but the `invited` budget is never named, so the claim cannot be checked from the document. Resolution (clause-level, rewrites in place): pin consume-at-approval (the request *references* the invitation; the approval transaction CAS-consumes it — this is what the same-commit revalidation already implies); pin the `invited` budget (e.g., at most one pending request per live invitation, or state that invitation-bearing requests count under the global ceiling); and let the "separate budgets" sentence point at it. No design question reopens; §7 item 2 transplants this text into 0055, so it should be right before transplant.

### DETAIL

**F2. The digest-mismatch sentence attributes mode-change refusal to a digest that does not contain the mode.** *(v0.3-introduced.)*
Evidence: the pinned canonical field set (`llp/0150:321-329`) contains no `auth.agents.mode` or invitation field, yet the mismatch parenthetical says "a manifest, tier-policy, **mode**, or request change since display" refuses via digest comparison (`llp/0150:330-332`). The mode-change refusal actually comes from the separate same-commit revalidation (`llp/0150:286-291`), so no security hole — but an implementer of digest v2 from the field list would find the sentence false. Fix: drop "mode" from the parenthetical (attributing it to §2's revalidation) or add the effective mode/invitation identity to the canonical set — pick one mechanism and say so.

**F3. The journal key cannot express per-scope first-use, and the text is singular where grants are plural.** *(v0.3-introduced.)*
Evidence: the key is `(grantId, eventKind)` (`llp/0150:529`), but the tier-2 row is "a compare-and-insert on the first successful invocation under **the flagged scope**" (`llp/0150:531-533`). A post-escalation union grant can carry several tier-2 scopes; under the pinned key, first use of scope A exhausts the event and scope B's first use is silent. Per-grant notification is defensible — but then say "first successful invocation under any flagged scope"; if per-scope is intended, the key needs a scope component. One clause either way.

**F4. The delegation record's `createdBy` field is unexplained.** *(v0.3-introduced surface.)*
Evidence: `{grantingUser, createdBy, subject: …}` (`llp/0150:489-491`); the text explains `grantingUser` (and its deliberate distinction from 0055's `owner_user_id`) but never says when `createdBy ≠ grantingUser` is possible or what authorizes creating a delegation of *another* user's effective authority — a tier-2 ceremony performed by whom? If `createdBy` is audit provenance only (e.g., the dev-profile impersonation path), one sentence saying so closes it; if it permits cross-user creation, that needs a rule.

**F5. An autonomous agent's escalation descriptor is a dead end with no specified refusal point.** *(v0.3-introduced seam.)*
Evidence: the scope-gate refusal carries the descriptor unconditionally (`llp/0150:372-380`) and "the agent converts the descriptor into a grant request (§2) with one call" (`llp/0150:384`) — but autonomous predecessors are outside §3 (`llp/0150:411-414`), and an escalation request naming one routes to no inbox (nobody "issued" the predecessor, `llp/0150:339-341`), so it pends invisibly until TTL. Benign but unspecified. Fix: refuse such a request at mint with the non-enumerating code (the mint can see the predecessor's null `effective_user_id`), and add a §8 row.

**F6. The coalescing claim overreaches: "does not walk into 0055's 50-live-grants caps" is only true for repeated identical requests.**
Evidence: coalescing keys on "a request **fully covered** by a live delegation-minted grant for the same key" (`llp/0150:522-524`); distinct scope subsets under one template mint distinct grants and still accumulate toward the cap (`llp/0055:898-900`, "consent is never silently evicted"), so a busy agent iterating varied read sets can still hit `SNAPBACK_AUTH_GRANT_CAP` on a tier-0 mint. Soften the claim ("bounds sibling proliferation; the cap remains reachable and fails typed") or coalesce upward (mint the covering template once per key).

**F7. The admission-tier-1 rationale covers only one of the two admission paths.** *(v0.3-introduced.)*
Evidence: the justification — "admission extends silence to a key whose grant the user is approving **in the same breath**" (`llp/0150:497-502`) — fits the secondary-confirmation path (`llp/0150:494-496`) but not the standalone "admits it from the delegation's inbox page" path (`llp/0150:496-497`), where no grant is being approved in any breath. The rule (admission is tier 1) is clear and the other rationale leg ("adds no scope class the template does not already carry") covers both paths; one clause acknowledging that the inbox-page act leans on the second leg alone keeps the rationale honest.

## Commissioned debates

**OQ2 — credential-kind coexistence: confirm exclusive.** My position has been stable for two rounds (min-security composition defeats the headline; the one-live-credential invariant is load-bearing across fencing, rotation throttle, and `revoke-self`; separate principals give the honest blast radius) and v0.3 changes nothing relevant — if anything the thumbprint-bound CAS (`llp/0150:404-407`) adds yet another surface coexistence would have to rework. Close it: exclusive; kind-switch is a rotation; constrained environments enroll as separate principals.

**OQ7 — flow consolidation: confirm keep both, with one leg revised.** v0.3's `invited`-mode correction *removes* one of my round-2 legs: `invited`'s mechanism is now the `sbagi_` creation invitation, not the pairing code (`llp/0150:277-283`) — and that decoupling was correct (pairing-as-principal-creation would have bypassed `invitedBy`, exactly the hole v0.3 closes). The position survives on the remaining legs: the pairing inversion's structural (not cap-bounded) immunity to unsolicited requests; the carriage-direction difference that makes the headless/air-gapped case pairing-shaped (`llp/0150:562-569`); and the shared-substrate pin (one request record, one approval transaction, one digest, one poll, closed `userSeeded`/`agentRequested` discriminator, `llp/0150:735-741`) that caps the acceptance-matrix cost at the entry edge. Keep both; the RFC's own concession that an inbox-minted user-bound seed "*is* pairing semantics under another UI" (`llp/0150:741-744`) means retiring the code would rename the primitive, not remove it.

## Verdict

**READY.** The bar is "thought through as much as we can without writing code," and v0.3 clears it: all seven of this family's round-2 findings are resolved with the recommended clause-level edits applied faithfully; I attacked every rewritten corner named in the capsule — the proof-bound `revoke-self`, the rotation/pending-request invalidation, the approver- and thumbprint-bound CAS, the unconditional clamp, the digest v2 field set, the `invited` creation-invitation rule, the delegation record and journal transactions, the overlay projection — and, for the first time in this loop, found no security defect introduced by the previous round's fixes. What remains is one MATERIAL internal inconsistency (F1: the `invited` lane's consumption timing and budget) and six DETAIL seams, all answerable in a single disposition pass without reopening any design question. Both commissioned debates can close as recommended, and OQ3's remaining registry decisions are honestly named open inside §7 item 11.

**Author recommendation:** accept after a disposition pass, not before. F1 should gate acceptance — it sits in the exact text §7 item 2 transplants into LLP 0055, and the "separate budgets" sentence is currently an unverifiable claim; the fix is two clauses (consume-at-approval with the request holding a reference, plus a named per-invitation pending bound or ceiling membership). F2–F7 should ride the same pass (each is a sentence or less; F2 and F3 also live in §7-transplant surface). None of the seven requires another full review round from this family — a self-checked disposition suffices — and nothing else should hold the document from Draft → Review/Accepted under the author's normal process.

## Round 4 — 2026-08-02 (final round)

**Method note (orchestrator):** delta-scoped final round; the reviewer's own
provenance block is embedded in its verbatim review below; search-scoping
honored (no repo-wide greps). 15 tool uses, ~97k tokens, ~6.2 minutes.
**Status:** completed
**Verdict:** READY (all 7 round-3 findings resolved; 1 MATERIAL + 6 DETAIL
new; author recommendation: accept after a final self-checked disposition
pass gating G1, with G2 riding it)

## Verbatim review (round 4)

# LLP 0150 review — round 4, FINAL (Fable family, independent reviewer)

**Reviewer family:** Anthropic Claude (Fable)
**Provider / runtime:** Claude Code, non-author reviewer (model `claude-fable-5`)
**Date:** 2026-08-02
**Method:** delta-scoped final round per the round-4 capsule. Read exactly one review artifact: my own family's (`llp/reviews/0150-agent-token-acquisition.fable.md`, rounds 1–3).
**Exclusions (blindness compliance):** did NOT read `llp/reviews/0150-agent-token-acquisition.codex.md`, any other 0150 review artifact, or any 0150 super-refine journal. All searches were scoped to the target, `llp/0055-*.md`, `llp/0106-*.md`, `llp/0031-*.md`, and `src/` — no repo-wide greps.
**Target:** `llp/0150-agent-token-acquisition.rfc.md` (v0.4, 853 lines, Draft, untracked)
**Target SHA-256:** `3ddde9576a2715e80e93c17886545db24e7e312a98ccdca5554f3c8d70f384b3`
**Repo revision at review start:** `main` `67628399`
**Verdict:** **READY** (all 7 round-3 findings resolved; 1 MATERIAL + 6 DETAIL new, all clause-level; author recommendation below)

## Round-3 resolution table

| Finding | Status | Evidence |
| --- | --- | --- |
| F1 — `invited` consumption timing contradictory; budget unpinned | **Resolved** | Replaced by a reservation state machine: mint atomically **reserves** one live invitation under CAS, approval **consumes**, denial/expiry **release** (`llp/0150:302-315`); the budget is named in place — "one live invitation binds at most one pending request, which is also the `invited` lane's pending budget: bounded by 0055's ten live invitations per minting user" (`llp/0150:305-307`), and the 0055 fact is real (`llp/0055:613-614`, "Per-user budget (10 live unconsumed)"; `llp/0055:903`). The "separate budgets" sentence now points at named budgets (`llp/0150:415-420`), the same-commit revalidation consumes "its reserved, still-live invitation" consistently (`llp/0150:317-322`), and §8 carries the lifecycle rows (`llp/0150:763-765`). The consume-at-approval reading I recommended is exactly what was pinned |
| F2 — digest mismatch sentence attributed mode-refusal to a digest lacking the mode | **Resolved** | The canonical set now contains "the effective `auth.agents.mode` and, for `invited` requests, the reserved invitation's identity, class, and creator" (`llp/0150:368-371`), so the mismatch parenthetical including "mode" (`llp/0150:380-381`) is now true of the mechanism it names; the same-commit revalidation is retained independently — both mechanisms named, no ambiguity left |
| F3 — journal key couldn't express per-scope first-use | **Resolved** | Key is now `(grantId, scopeRecord, eventKind)` for first-use, "per flagged **scope**, so a union grant with several tier-2 scopes journals each scope's first use" (`llp/0150:602-607`) — the per-scope option, with the key gaining the scope component as required |
| F4 — delegation `createdBy` unexplained | **Resolved** | "`createdBy` is **audit provenance only** (it differs from `grantingUser` only on the dev-profile impersonation path of §5 …); no path creates a delegation of another user's authority" (`llp/0150:550-553`) — the audit-only sentence I asked for; the referenced §5 path has a residual seam, see G3 |
| F5 — autonomous-predecessor escalation dead end | **Resolved** | Refused at mint with the non-enumerating code, "the mint sees the null `effective_user_id`, and §3's path is delegated-only end to end, so no request can pend invisibly" (`llp/0150:439-443`); §8 row added (`llp/0150:762-763`) |
| F6 — coalescing claim overreached against the 50-grant cap | **Resolved** | Coalescing is now **upward** — first tier-0 mint mints the full template as one grant, "one delegation grant per credential per delegation, so tier-0 traffic is bounded … by construction," with the cap named as still reachable and failing typed (`llp/0150:592-599`, matching `llp/0055:898-900`) — the stronger of my two offered fixes; it opens one v0.4 seam, see G5 |
| F7 — admission-tier-1 rationale covered one of two paths | **Resolved** | "(The standalone inbox-page admission has no same-breath grant; it rests on the no-new-scope-class leg alone.)" (`llp/0150:572-573`) — exactly the acknowledging clause recommended |

All seven round-3 findings from this family are resolved, each in the recommended shape. I then attacked every v0.4-rewritten corner the capsule names: the reservation state machine (reservation cannot be burned by third parties — only the invitation holder can mint the reserving request; a reserved invitation survives denial/expiry to its own TTL; approval of an expired-mid-pendency invitation refuses via the still-live check); the per-mode ownership displacement (verified against 0055: bare `open` self-registration **is** unowned, `llp/0055:277-279`, and the prod-unrecoverable residual is real, `llp/0055:793` — so approver-as-owner is a justified, honestly-labeled displacement; operator invitations **are** dev/test/demo-only, `llp/0055:608-611, 1159`); the digest additions (mode + invitation identity + delegation policy digest close the render-identically hole; concurrent admissions of *other* keys correctly don't perturb this admission's digest); the pre-handler first-*attempted*-use rule (the actions-can't-share-a-post-success-transaction rationale is sound, and attempted-use semantics are honestly labeled); the tier-0 expiry formula (all four min-terms real — "0055's delegated bounds" exists: delegated grants must carry `expires_at` with a hard max, `llp/0055:1012, 1731-1732`); the autonomous-predecessor mint refusal (no oracle: the requester knows its own grant); the 0106 gate ("Application end users remain a separate identity plane," `llp/0106:118`, verbatim support); and the narrowed absolutes (the short-lived key-bound token is correctly outside "durable authority secrets"). The diagnostic codes cited all exist (`SNAPBACK_AUTH_PERMISSION_DENIED`: `src/diagnostic.rs:159,226`; `GRANT_CAP`/`GRANT_PENDING`/`GRANT_INVALID`: `llp/0055:900, 998, 1005`).

## New findings

### MATERIAL

**G1. The escalation-request mint never binds the named predecessor to the requesting credential — re-admitting a targeted unsolicited-contact channel the document claims does not exist.** *(Seam between v0.2 routing and the v0.4 mint-refusal clause.)*
Evidence: the inbox auto-lists "escalation requests naming a predecessor grant they issued" with no capability-import act (`llp/0150:388-390`), and §2 claims "no unsolicited-contact channel" (`llp/0150:393`). The approval CAS validates the predecessor is "bound to the exact requesting credential generation and thumbprint" (`llp/0150:463-466`) — but only at *approval*. At *mint*, the only predecessor check stated is the null-`effective_user_id` refusal (`llp/0150:440-443`). So any credentialed key (or, under `open`, any fresh keypair) that learns a foreign grant id can mint an escalation request naming it, and that request routes straight into the victim issuer's inbox — rendered as a plausible escalation of their own grant. Grant ids are not secret-classified, and the document's own custody section names transcripts and logs as the dominant leak class (`llp/0150:213-215`) — grant ids transit agent transcripts on every approval, so "the id is unguessable" is not a defense the document gets to lean on silently. The blast radius is bounded — an approval attempt fails harmlessly at the thumbprint CAS with the non-enumerating code, so no authority is reachable — but the inbox-spam/phishing-surface channel contradicts the stated claim. Resolution (one clause, zero design impact): the mint — which already reads the predecessor row for the autonomy check — additionally validates that the named predecessor is bound to the requesting credential's thumbprint, refusing with the non-enumerating code; add a requester-mismatch-at-mint row to §8 (which today carries only "approver-mismatch on escalation approval," `llp/0150:761-762`). This text lives in §7-item-4 transplant surface, so it should be right before transplant.

### DETAIL

**G2. The `invited` lane carries a durable authority secret through the human, and invariant 1's acknowledgement doesn't cover it.** *(Exposed by the v0.4-narrowed absolute.)*
Evidence: invariant 1 — "Durable authority secrets never transit the human"; the parenthetical acknowledges only the ephemeral URI and user code, which "grant … never authority" (`llp/0150:90-99`). But the `invited` lane's `sbagi_` invitation (`llp/0150:302-311`) is, in 0055's own words, "a durable secret" (`llp/0055:1157` — step-up is required to mint it for exactly that reason), TTL-bounded at 7 days (`llp/0055:825`), it authorizes principal creation, and the inviter must see/copy/paste it to the agent. The mechanism is fine (inherited 0055 surface); the absolute as written is false for one of the RFC's three first-contact modes, unacknowledged. Fix: one clause extending invariant 1's acknowledgement — the `invited` lane's creation invitation is a durable ceremony secret inherited from 0055, named honestly as the price of the stricter posture (displacement: extends the existing parenthetical, replaces nothing).

**G3. `createdBy`'s only stated divergence path cannot occur under the document's own tier rules.** *(v0.4-introduced.)*
Evidence: `createdBy` "differs from `grantingUser` only on the dev-profile impersonation path of §5" (`llp/0150:550-552`) — but §5's impersonation path auto-approves "tier-0/1 requests" only (`llp/0150:635-636`), and creating a delegation is tier 2 (`llp/0150:566-567`), so no specified path produces `createdBy ≠ grantingUser`. Either §5 gains one sentence naming operator delegation-creation under impersonation (dev/test only), or `createdBy` should be stated as always-equal in v1, reserved. One clause either way.

**G4. Creation-time admission of the first key is not one of the enumerated admission acts.** *(v0.4-introduced ceremony count.)*
Evidence: the corrected count has the tier-2 creation ceremony "admitting that first key with it" (`llp/0150:581-582`), but the accretion rule reads exhaustively — "A credential enters the subject **only by** an explicit act …: the first tier-1 approval … or the user admits it from the delegation's inbox page" (`llp/0150:563-566`) — neither of which is admission-at-creation. Add creation-time admission as a third enumerated act (it is the same secondary-confirmation mechanics at the union's tier 2).

**G5. Template widening versus the upward-coalesced grant is unspecified.** *(v0.4-introduced coalescing.)*
Evidence: coalescing pins "one delegation grant per credential per delegation" with "every later covered request returns that grant" (`llp/0150:592-595`); a tier-2 template widening (`llp/0150:566-567`) leaves existing coalesced grants carrying the old template — 0055 grants are immutable — so a newly-covered request either mints a second delegation grant (violating one-per-credential) or is not covered. One clause: the next covered request after a widening supersedes the coalesced grant with the widened template (reusing §3's supersede transaction, or a plain re-mint with the old grant revoked in the same commit).

**G6. Rotation-invalidation is a third terminal state the reservation machine doesn't enumerate.**
Evidence: "denial and expiry **release** the reservation" (`llp/0150:308-309`), but rotation "terminally invalidates the agent's pending grant requests" (`llp/0150:226-230`) — an `invited` request invalidated this way strands its reserved invitation until the request's own TTL sweeps it (≤10 min; self-healing but unstated). One-word-scale fix: "denial, expiry, and any other terminal non-approval outcome release."

**G7. The approver rule for operator-invitation requests is unstated.**
Evidence: approver-must-be-inviter is conditioned on "a user-minted invitation" (`llp/0150:346-349`); operator-minted invitations get an ownership rule (unowned, `llp/0150:348-350`) but no approver constraint, so any authenticated user who imports the URI approves and becomes effective user. Dev/test/demo-only per 0055's gating, so low stakes — but §7 item 2 transplants the ownership rules into 0055, and the transplant should say it (one clause: any authenticated user may approve; principal lands unowned per 0055).

## Commissioned debates

**OQ2 — credential-kind coexistence: confirm exclusive.** Stable for three rounds and v0.4 changes nothing — the thumbprint-and-approver-bound CAS and the reservation machine each add yet more surface coexistence would have to rework for a use case (identities spanning trust domains) that remains an anti-pattern; close it: exclusive, kind-switch is a rotation, constrained environments enroll as separate principals.

**OQ7 — flow consolidation: confirm keep both.** Stable for three rounds and v0.4 strengthens it — the reservation machine now leans on the invitation/pairing distinction ("a pairing code … never substitutes for an invitation," `llp/0150:311-315`), and the shared-substrate pin caps the acceptance-matrix cost at the entry edge; retiring the pairing code would rename the primitive, not remove it.

## Verdict

**READY.** The bar is "thought through as much as we can without writing code," and v0.4 clears it more decisively than v0.3 did: all seven of this family's round-3 findings are resolved in the recommended shapes; every load-bearing corpus claim I attacked in the rewritten surface — the ten-invitation budget, the unowned-`open`/prod-unrecoverable displacement justification, the operator-invitation gating, the delegated expiry bounds, the identity-plane claim, the diagnostic codes — is true at the cited sources; and the invitation reservation machine, the ownership displacement, the digest additions, the attempted-use journal rule, and the 0106 gate all survived adversarial reading intact. What remains is one MATERIAL seam (G1 — a free, one-clause mint-side check whose absence contradicts the "no unsolicited-contact channel" claim under the document's own transcript-leak threat model, though no authority is reachable through it) and six DETAIL clauses, none of which reopens a design question or requires another review round.

**Author recommendation:** accept after one final self-checked disposition pass — no further review round from this family is needed. G1 should gate acceptance: it is a single clause plus a §8 row, it sits in §7-item-4 transplant surface, and it converts a headline security claim from conditionally-true to true. G2 should ride the same pass (it keeps invariant 1 honest, and honesty of absolutes has been this document's hardest-won property across the loop). G3–G7 are nice-to-haves — each a sentence or less, all worth sweeping in the same pass since G4/G5/G7 also live in §7 transplant text, but none would justify holding the document if the author disposed only G1/G2. With that pass applied, nothing should keep LLP 0150 from Draft → Review/Accepted under the author's normal process.
