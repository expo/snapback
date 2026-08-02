# LLP 0150 agent token acquisition review — Codex family

## Round 1 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-01
**Method:** fresh non-author `codex exec` context, read-only sandbox over the
working tree; mutually blind — instructed not to read any `llp/reviews/`
artifact concerning LLP 0150 nor any 0150 super-refine journal, and verified
after the fact not to have done so (the only occurrences of that path in its
10,380-line transcript are the capsule's own prohibition at line 39,
unrelated skill-description text, and the root LLP's pointer to the 0000
review; none concern 0150). SHA-pinned target and instruction capsule.
**Instruction capsule SHA-256:** `59a56d9ebbca47bca2ec9fae5b36d8f85915ba378b8553709c315fa94002b142`
**Target:** `llp/0150-agent-token-acquisition.rfc.md` (v0.1, 389 lines, Draft)
**Target SHA-256:** `e83032382335b7901c52210e8b574c7efdf714ac977a3d8c4a9ed69c637fcaa8`
**Repo revision at review start:** `main` `67628399` (target file untracked)
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

# Review — LLP 0150, round 1

## Overall assessment

LLP 0150 has a strong product thesis: machine-computed least authority, human veto, host sovereignty, and key-bound credentials are the right direction. It also usefully treats phishing as structural rather than cosmetic and distinguishes the core host flow from an optional Expo overlay.

The RFC is not yet at the READY bar. Several load-bearing mechanisms are either inconsistent with LLP 0055, attributed to components that do not implement them, or left implicit despite changing authorization semantics. In particular, an unknown key has no LLP 0055 principal to receive a grant; a request that names no user cannot also appear in a personal approvals inbox; the proposed token optimization would remove proof-of-possession; and the supersede transaction lacks the expiry, race, and no-resurrection rules it needs.

I read the complete untracked target and checked the cited LLPs and implementation. I deliberately excluded every `llp/reviews/` artifact concerning LLP 0150 and every LLP 0150 super-refine journal. I did not edit any file.

## Findings

### BLOCKING — Unknown-key approval has no LLP 0055 principal and can bypass existing registration policy

The approval-link route accepts a wholly unknown public key and, by default, allows it to request a grant ([LLP 0150:163](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:163), [LLP 0150:172](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:172)). Approval then supposedly binds a grant directly to its thumbprint.

LLP 0055 grants cannot target a bare thumbprint: `_auth_grants.actor_user_id` names an agent principal, and that principal has immutable kind, ownership, registration provenance, identity rows, deactivation state, and a credential family ([LLP 0055:268](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:268), [LLP 0055:623](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:623), [LLP 0055:930](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:930)). LLP 0055 also defaults `auth.agents.mode` to `disabled`; its `invited` and `open` modes control principal creation ([LLP 0055:591](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:591)).

As written, the new default-`open` request knob either bypasses that policy or creates a second kind of principal-less grant, contradicting the claim that no new grant/token model is introduced.

Resolution requires pinning one of these shapes:

- Approval of an unknown key atomically creates an owned LLP 0055 agent principal, identity row, key-bound credential, and grant, while composing explicitly with `auth.agents.mode`.
- Unknown keys may request only after a user invitation or another existing principal-creation authority.
- A genuinely key-only principal model is introduced as an explicit LLP 0055 amendment, including ownership, deactivation, recovery, audit, and caps.

The RFC must also say which authenticated human becomes the owner and how owner-assumption disclosure applies.

### BLOCKING — The proof-of-possession reuse is incomplete, and the stated token optimization is insecure

The RFC says a short-lived key-bound access token lets hot paths “verify a token rather than a signature,” while remaining useless without the key ([LLP 0150:114](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:114)). Those properties do not coexist. A token presented without a per-request proof is a bearer token, regardless of a `cnf` or thumbprint field inside it.

LLP 0077 requires a signed proof on every protected request, bound to the token through `ath`, the exact method/URI, a nonce, time, and a replay id ([LLP 0077:517](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:517), [LLP 0077:575](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:575)). It explicitly excludes agent credentials, scoped automation tokens, and pairing secrets from its current protocol ([LLP 0077:1177](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:1177)). Its one-live-family rule is a browser session-family rule, not already an agent-credential implementation.

The first-contact request and poll are also underdefined. A request carrying a public key must prove possession of its private half before creating state. Polling with only a request id ([LLP 0150:196](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:196)) leaves unclear whether the id is a bearer status capability or whether polling is proof-bound.

Resolution requires an exact agent-specific extension:

- Supported algorithms and canonical public-key encoding.
- Initial nonce challenge and proof-of-possession before request creation.
- Exact proof claims, URI rules, `ath` or equivalent credential binding, replay namespace, retention, and caps.
- A proof on every token use; the token may reduce lookup cost, not signature verification.
- Proof-bound polling or a distinct high-entropy device secret.
- Cross-process nonce serialization or bounded overlap for CLI/daemon clients.
- Key loss, self-rotation, lost-response recovery, and replay-epoch behavior.
- Explicit acceptance coverage extending LLP 0077 beyond browser session families.

OQ3 is therefore not mechanical; carrier and identifier classification are security decisions.

### BLOCKING — A userless request cannot simultaneously live in a personal approvals inbox

The request intentionally names no user ([LLP 0150:168](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:168)), yet every pending request is said to appear in a session-authenticated approvals inbox ([LLP 0150:210](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:210)).

The RFC never explains whose inbox. If every authenticated user sees every pending request, this is a global disclosure, phishing, and consent-fatigue queue. If only one user sees it, there is no fact binding that user before they follow the capability. LLP 0055 avoids this problem because the authenticated user mints the pairing record first; storage records `minted_by_user_id`, and the later request remains bound to that user ([LLP 0055:978](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:978), [auth_grants.rs:190](/Users/ccheever/projects/snapback/src/storage/auth_grants.rs:190)).

The phishing mitigations are also insufficient for unknown keys. A code comparison confirms only that the browser and terminal refer to the same request. It does not authenticate the agent. LLP 0055 explicitly says display names are self-declared and provenance is not attestation ([LLP 0055:1833](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:1833)). A malicious requester can therefore create a genuine host page labeled “Codex” unless unknown identity metadata is clearly treated as unverified.

Resolution must define inbox routing. Plausible choices are:

- Capability links remain outside the personal inbox until the user explicitly imports the code/request.
- The inbox itself mints a user-bound request seed—which is pairing semantics.
- A separate operator/global quarantine inbox exists, clearly not a user consent inbox.

If `open` remains the default, the design also needs deployment-wide count/byte caps, per-key proof, effective-source limits, fair allocation, expiry/GC, denial suppression, and explicit “unverified first contact” rendering. The oracle claim should narrow to “no user-handle enumeration”; broader non-enumeration needs an acceptance matrix.

### BLOCKING — Escalation promises operation-specific consent that the grant grammar cannot express

The consent text says the user approves the concrete failed operation, illustrated as `deleteTable('events')` ([LLP 0150:226](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:226)). But LLP 0055’s narrowest current grant unit is `{fn, kind}`; resource- or argument-specific scopes do not exist ([LLP 0055:1019](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:1019)). Granting `deleteTable` may authorize other table arguments too.

LLP 0149 explicitly says resource selectors are available only where a future grant vocabulary can express them, and that call-count, concurrency, spend, and effect ceilings are new surface ([LLP 0149:287](/Users/ccheever/projects/snapback/llp/0149-agent-application-consumption.research.md:287)). The RFC’s “exactly that” wording therefore overstates the authority actually granted.

Resolution requires either:

- Rendering both the triggering operation and the honest broader function-level authority being granted, including unexpressible residuals; or
- Introducing an enforced resource-scope or one-shot plan-capability model in an owning amendment.

If arguments appear in the descriptor or inbox, their disclosure/redaction policy must also be defined. A concrete argument value is not a “static manifest fact,” so the example currently contradicts the no-data-dependent-descriptor invariant.

### BLOCKING — Superseding requires a stronger transaction and expiry model than the RFC specifies

The existing approval CAS guarantees that one request creates at most one grant ([auth_grants.rs:392](/Users/ccheever/projects/snapback/src/storage/auth_grants.rs:392)). It does not provide a predecessor-grant CAS.

The proposed transaction must handle at least:

- Two sibling escalation requests against the same predecessor.
- User revocation racing approval, without approval resurrecting authority.
- Predecessor expiry, agent deactivation, credential rotation, recovery generation, or terminal scope invalidation before approval.
- Manifest or `authorityCreating` changes between descriptor creation and approval.
- Net grant-cap accounting when one live grant is revoked and another minted.
- Commit-uncertain retry returning the same successor.
- Existing tokens, connections, and queued work remaining fenced to the predecessor and dying with it.

Expiry is especially load-bearing. LLP 0055 gives a delegated grant one expiry ([LLP 0055:1012](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:1012)). If escalation resets that expiry, a tier-1 increment can silently extend older tier-2 authority. If it preserves the predecessor expiry, the new scope may receive less lifetime than requested. The RFC must choose a rule—such as successor expiry no later than the predecessor unless the entire union is re-consented at the maximum ceremony tier.

“one legible record per agent-user pair” is also too strong: LLP 0055 permits many live grants for an actor/effective user. Superseding one lineage prevents escalation stacking; it does not establish global one-grant-per-pair semantics.

### BLOCKING — Several implementation and corpus claims are factually wrong

The capsule says factual errors are at least MATERIAL; these are load-bearing enough to be BLOCKING collectively:

- The refusal code is `SNAPBACK_AUTH_GRANT_SCOPE_DENIED`, not `SNAPBACK_AUTH_SCOPE_INSUFFICIENT` ([LLP 0055:1139](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:1139), [invocation.rs:1549](/Users/ccheever/projects/snapback/src/auth/invocation.rs:1549)).
- LLP 0149 F6 says Snapback does **not yet** have a task compiler; it recommends building one later ([LLP 0149:287](/Users/ccheever/projects/snapback/llp/0149-agent-application-consumption.research.md:287), [LLP 0149:505](/Users/ccheever/projects/snapback/llp/0149-agent-application-consumption.research.md:505)). LLP 0150 places its output under “What already exists.”
- LLP 0149 F2 is “function schemas are insufficient,” not an implemented preflight surface ([LLP 0149:174](/Users/ccheever/projects/snapback/llp/0149-agent-application-consumption.research.md:174)).
- LLP 0146 classifies least-authority planning as deferred, after D7 ([LLP 0146:970](/Users/ccheever/projects/snapback/llp/0146-agentic-authoring-affordances.rfc.md:970)).
- LLP 0053’s 24-hour `AuthorizedLease` is not inherited by service principals: LLP 0055 keeps them online-only, and pure grant revocation is an authority transition using LLP 0055’s grant-scoped delete ([LLP 0053:679](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:679), [LLP 0055:255](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:255)).
- “Ceilings” are not existing LLP 0055 grant facts; LLP 0149 says only expiry is configurable today ([LLP 0149:304](/Users/ccheever/projects/snapback/llp/0149-agent-application-consumption.research.md:304)).

The RFC should distinguish implemented substrate, accepted specification, proposed dependency, and new amendment. Escalation should attach only to the actual pre-handler missing-scope outcome, not to arbitrary data-dependent permission denials.

### MATERIAL — The existing consent digest does not cover the new display contract

The RFC says the new consent page is “exactly” what LLP 0055’s `consent_digest` already captures ([LLP 0150:187](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:187)). LLP 0055’s digest covers agent identity/provenance, scopes, expiry, and owner-assumption disclosure ([LLP 0055:930](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:930), [LLP 0055:986](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:986)).

LLP 0150 adds authorization-relevant facts not covered there: public-key thumbprint, requesting machine/host, compiler unknowns, proposed ceilings, predecessor and delta, standing delegation, ceremony tier/app override, and possibly concrete operation data.

Resolution is a versioned canonical request/consent digest that binds all authority-relevant displayed facts, the effective user, app/deployment and manifest generation, predecessor state, and exact approved key. Approval must revalidate that digest in the mint transaction.

### BLOCKING — Standing delegation lacks a trustworthy subject and contradicts the ceremony ladder

A standing delegation covers “keys enrolled from this machine/installation,” but the RFC defines no trustworthy enrollment authority for that statement ([LLP 0150:274](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:274)). First-contact metadata is requester supplied. If machine or installation identity is accepted from that metadata, an attacker can claim membership in a delegated installation and obtain a silent tier-0 grant.

There is also an internal contradiction:

- Invariant 3 says ordinary writes are one click ([LLP 0150:46](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:46)).
- Tier 0 applies to every request covered by a standing delegation ([LLP 0150:256](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:256)).
- Delegations exclude only tier-2 classes, so they may cover ordinary writes ([LLP 0150:274](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:274)).

Thus ordinary writes can in fact become silent.

Resolution must define whether the delegation subject is an exact credential thumbprint, an owner-approved broker, an attested installation, or an attenuation chain from a parent key. It must prohibit self-asserted enrollment and authority laundering into child keys. It also needs exact scope/TTL/cap bounds, current-tier re-evaluation, parent-child grant records, and revocation cascade semantics. If the intended invariant is “only reads may become silent,” say so and enforce it.

### MATERIAL — Key rotation conflates self-rotation with owner recovery

The RFC says an agent may roll and rebind a key without consent, calling this re-credentialing in LLP 0055’s sense ([LLP 0150:130](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:130)).

LLP 0055 distinguishes:

- Self-rotation under the current credential, preserving credential identity while advancing its generation ([LLP 0055:836](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:836)).
- Owner re-credentialing after loss/recovery, which revokes all grants and requires delegators to re-consent ([LLP 0055:651](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:651)).

The key-bound design needs the same split. A new key may preserve grants without ceremony only when the old live key authorizes a CAS rotation. Lost-key recovery or an owner-driven credential-kind switch must follow the stronger re-credentialing rules. Lost-response recovery and concurrent signers also need a defined outcome.

### MATERIAL — `sbat_` alone is not sufficient authority for local autoapproval

The local-dev flow allows tier-0/1 autoapproval under the local admin `sbat_` holder ([LLP 0150:307](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:307)). LLP 0055 deliberately requires `AdminWrite` plus `ImpersonationCapability` for operator-created agent authority, including `auth.mintAgentGrant` ([LLP 0055:952](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:952), [LLP 0055:1175](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:1175)). Possessing an admin bearer does not prove that operator and effective user are the same person.

Autoapproval should either be removed or require the existing non-production impersonation capability, an explicit synthetic/dev principal, and an audit record. `sbat_` alone must not become a new act-as-user authority.

### MATERIAL — Notification and Expo-overlay composition require new authority protocols

LLP 0045 is Draft, its provider delivery remains unbuilt, and it defines app-enqueued notification intents rather than a host security-event producer or approvals inbox ([LLP 0045:14](/Users/ccheever/projects/snapback/llp/0045-notifications-outbox.rfc.md:14), [LLP 0045:129](/Users/ccheever/projects/snapback/llp/0045-notifications-outbox.rfc.md:129), [LLP 0045:187](/Users/ccheever/projects/snapback/llp/0045-notifications-outbox.rfc.md:187)). LLP 0057 likewise says production delivery is outside its implemented base ([LLP 0057:111](/Users/ccheever/projects/snapback/llp/0057-auth-provider-protocol.spec.md:111)).

Tier-2 first-use notification therefore needs a named producer, recipient policy, idempotency key, first-use transaction boundary, retry behavior, and failure posture. The journal/inbox needs storage, access, retention, and resource caps.

Likewise, an account-level system approving requests or mirroring policy across instances is an authorization input even if the host performs the final mint. LLP 0072 and LLP 0098 provide deployment admission and control-plane fencing, not a federated human-consent assertion protocol ([LLP 0072:155](/Users/ccheever/projects/snapback/llp/0072-trusted-single-tenant-control-plane.rfc.md:155), [LLP 0098:197](/Users/ccheever/projects/snapback/llp/0098-hosted-edge-adapter.spec.md:197)). The overlay needs signed decisions, identity mapping, anti-replay, expiry, issuer rotation/revocation, partition behavior, and host-side policy validation—or should be moved to a separate future RFC.

### MATERIAL — The RFC has no adversarial acceptance matrix

The document has no acceptance or validation section. For a new authorization-acquisition surface, the design should already name the tests that will distinguish a correct implementation from a plausible one.

At minimum, include matrices for:

- Unknown, expired, denied, foreign, and cross-user request ids.
- First-contact proof, arbitrary-public-key substitution, request replay, and poll replay.
- Approval/deny/expiry/supersede/revocation races and commit uncertainty.
- Concurrent sibling escalations and no resurrection.
- Grant caps and distributed request-flood exhaustion.
- Unverified agent-name phishing and inbox routing.
- Delegation child-key laundering and delegation revocation.
- Manifest/tier/`authorityCreating` changes during pending approval.
- Consent-digest field substitution.
- Key rotation, key loss, and multi-process nonce races.
- Notification duplication, delay, and unavailable channels.

### DETAIL — Internal wording and metadata should be reconciled

- “Secrets never transit at all” conflicts with the acknowledged bearer approval URI/code. Narrow the invariant to durable app-authority credentials; ephemeral ceremony capabilities are still secrets that transit the human ([LLP 0150:37](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:37), [LLP 0150:182](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:182)).
- The motivation says pairing codes “stay,” while OQ7 deliberately leaves retirement open ([LLP 0150:79](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:79), [LLP 0150:380](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:380)). Say “are retained in this draft.”
- `Related` should include LLP 0045, 0057, 0072, 0098, and likely 0146 because the normative body depends on them.

## Commissioned debates

### OQ2 — Recommend exclusive credentials in v1, with separate agents for separate custody domains

The coexistence use case is real—one logical automation may run on a key-capable workstation and a constrained CI runner—but “one credential per kind” is the wrong abstraction. It permits exactly one key and one bearer while still failing the next obvious case: two key-capable machines, two CI runners, or a rotated broker. It is an accidental topology rather than a security model.

Workstation and CI execution also usually deserve distinct actors:

- Different compromise and revocation domains.
- Different scopes and lifetimes.
- Distinct audit attribution.
- Independent recovery and rotation.
- No need to share third-party grants merely because humans think of them as one product.

For v1, preserve LLP 0055’s one-live-credential invariant. A constrained runner should enroll as a separate agent principal. Fragmented consent history is a cost, but it truthfully represents separate holders of authority.

If empirical use later demands one logical agent across installations, design an explicit agent-installation/credential-family hierarchy with per-installation ids, caps, grants, audit, and revocation. That is a principled multi-credential model; coexist-per-kind is not.

Credential-kind switching should also distinguish self-proved rotation from recovery: a live credential may authorize its replacement without re-consent, while a switch after loss must revoke grants and follow owner recovery.

### OQ7 — Keep both initiation modes; unify their machinery, not their guarantees

The pairing flow earns its keep.

Its structural guarantee is not reproduced by an approvals inbox: the authenticated user creates the consent seed before the agent can create a pending request. That eliminates unsolicited consent records, binds the effective user from the start, and works without an agent-originated served link. An inbox showing unsolicited requests does not provide that property. An inbox action that mints a request does—but that is pairing semantics under another UI.

The approval-link flow is still worth keeping as the ergonomic default for mid-task escalation. Its weaker posture is acceptable only when explicitly named and defended against phishing, spam, and userless routing.

The acceptance-matrix cost can be bounded by sharing one request record, consent digest, terminal state machine, approval transaction, polling contract, and revocation behavior, with a closed initiation discriminator such as:

- `userSeeded`
- `agentRequested`

Tests common to both run once; only initiation, routing, and anti-abuse differences need separate rows. Retiring pairing would save less than it appears, while discarding a genuinely stronger and useful security posture.

## Strengths worth preserving

- Host sovereignty and the explicit rejection of Expo as a core dependency.
- Key-bound credentials as the preferred path, with bearer credentials retained as an honest compatibility fallback.
- Machine-computed scope selection and a human approve/deny surface without checkbox-driven policy design.
- The explicit acknowledgement that printed approval links create a phishing shape.
- Raise-only ceremony overrides and the refusal to let standing delegations cover authority-creating effects.
- Escalation at the concrete failure point, provided the consent surface honestly describes the authority actually granted.
- The intention to keep an escalation lineage legible through supersession rather than accumulating unrelated grants.
- Leaving OQ2 and OQ7 visibly open for review rather than presenting them as settled.

## Verdict

**NOT READY.** The commissioned OQ2 and OQ7 debates may remain open without blocking READY. What blocks the document is that several core authorization facts are presently undefined or false: unknown keys have no LLP 0055 principal, the userless inbox cannot be routed safely, the PoP optimization removes possession proof, operation-specific consent exceeds the grant grammar, supersession lacks no-resurrection and expiry rules, and multiple implementation-status/error-code claims are incorrect. These issues can be resolved at RFC altitude without writing code, so the document has not yet reached the stated bar of having thought the design through as far as possible before empirical implementation work.

## Round 2 — 2026-08-02

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Method:** delta-scoped round — the reviewer read its own family's round-1
artifact only; excluded the Fable artifact and the super-refine journal,
verified against its 6,059-line transcript (the only occurrences of the
Fable artifact path are the capsule's family-conditioned clause and the
reviewer's own exclusion statement). SHA-pinned target and capsule.
**Instruction capsule SHA-256:** `ee86cdd86e452012e464f4349039029e1c597ff67df5f23352027370a8c2fb7b`
**Target:** `llp/0150-agent-token-acquisition.rfc.md` (v0.2, 618 lines, Draft)
**Target SHA-256:** `daf4a58509e6a45788a2985bee74eb8944f8b3f3dacd58c35134419864ac2343`
**Status:** completed
**Verdict:** NOT READY (round-1 findings resolved or partially resolved; 2
BLOCKING + 8 MATERIAL new, mostly in v0.2-introduced surface)

## Verbatim review (round 2)

# Review — LLP 0150, round 2

Scope: I read the complete v0.2 target and the permitted Codex-family round-1 artifact. I excluded `llp/reviews/0150-agent-token-acquisition.fable.md` and every 0150 super-refine journal. I made no file changes.

## Round-1 resolution table

| Round-1 finding | Status | Evidence |
|---|---|---|
| Unknown-key approval lacked a 0055 principal | **Resolved** | Approval now atomically creates an owned principal, identity, credential, and grant, governed by `auth.agents.mode` ([0150:240](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:240), [0150:261](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:261)). The new mode-composition defect is separate below. |
| Proof-of-possession reuse was incomplete/insecure | **Partially resolved** | Proof is now required on every authenticated use and terminal poll release ([0150:139](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:139), [0150:159](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:159)); however, the exact agent profile remains commissioned rather than selected, its custody floor conflicts with 0077, and rotation can strand terminal delivery. |
| Userless request had no safe inbox routing | **Partially resolved** | Host-local routing correctly hides unbound requests until capability import ([0150:286](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:286)); the broad Expo projection and admission-starvation posture reopen parts of the finding. |
| Consent overstated operation-specific grant precision | **Resolved** | The page now discloses function-wide `{fn, kind}` authority and excludes arguments ([0150:315](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:315), [0150:326](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:326)). |
| Supersede transaction lacked expiry/race/no-resurrection rules | **Partially resolved** | The seven transaction rules and destruction cost are substantial ([0150:344](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:344), [0150:374](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:374)); request-key rotation still creates a reachable terminal-delivery failure. |
| Implementation/corpus claims were false | **Resolved for the six round-1 claims** | The error code, compiler status, preflight status, 0146 sequencing, online-only posture, and non-existent ceilings are corrected. New factual overclaims appear below. |
| Existing consent digest did not cover the new display | **Partially resolved** | Digest v2 is named and revalidated ([0150:273](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:273)), but its stated fields still omit authority-relevant context required by the round-1 disposition. |
| Standing delegation lacked a trustworthy subject | **Partially resolved** | Exact owner-accreted keys and query-only v1 delegations fix the self-asserted-machine flaw ([0150:413](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:413), [0150:437](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:437)); ownership, rotation, effective-tier, and admission-ceremony semantics remain inconsistent. |
| Rotation conflated self-rotation with owner recovery | **Partially resolved** | The conceptual split is now correct ([0150:172](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:172)); stable credential identity, thumbprint identity, lost response, and pending-request rotation do not yet compose. |
| `sbat_` alone authorized dev autoapproval | **Resolved** | Autoapproval now requires `AdminWrite` plus `ImpersonationCapability`, pins the dev principal, audits, and refuses production ([0150:468](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:468)). |
| Notification and Expo composition lacked authority protocols | **Partially resolved** | Expo approval is removed and push is honestly conditional, but unbound projection and first-use journal transaction semantics remain undefined. |
| No adversarial acceptance matrix | **Partially resolved** | §8 covers most requested adversarial cases ([0150:524](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:524)); it omits mode/invitation races, request-key rotation, capability redemption, and journal failure/idempotency. |
| Internal wording and metadata | **Resolved for the round-1 items** | The summary narrows “secrets,” pairing is retained “in this draft,” and the Related list now includes the dependencies. A new absolute secret-transit sentence remains inconsistent with the token discussion. |

## New findings

### BLOCKING — `approvalLink` does not actually preserve `auth.agents.mode` semantics  
*v0.2-introduced*

In `invited` mode, v0.2 allows either an invitation or a pairing code to authorize an unknown-key request ([0150:248](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:248)). But 0055 defines `invited` principal creation as requiring a single-use `sbagi_` creation invitation and separately controls whether users or operators may mint it ([0055:605](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:605), [0055:608](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:608)). A pairing code is grant consent for an already credentialed agent, not principal-creation authority ([0055:978](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:978), [0055:1162](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:1162)).

This bypasses `auth.agents.invitedBy`; notably, a user-minted pairing code could create a principal where the app selected operator-only invitations. The transaction also does not explicitly pin same-commit revalidation of the current mode and invitation state, so an `open → disabled` change while a request is pending is ambiguous.

Resolution shape: replace the mode bullets and first-contact transaction paragraphs at lines 240–271. Require current-mode and `invitedBy` revalidation in the creation transaction; in `invited`, consume only a matching creation invitation, or explicitly define a new user-approved creation class with its step-up/cascade rules. Do not elevate an ordinary pairing code implicitly.

### BLOCKING — Self-rotation can strand an approved successor after destroying its predecessor  
*v0.2-introduced*

Terminal results release only under proof from the requesting key ([0150:159](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:159)). Self-rotation invalidates that key while preserving the credential family ([0150:174](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:174)). The supersede CAS checks that the credential family is unchanged, so a request created before self-rotation may still be approved ([0150:344](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:344)). Under 0055, old generations fail ordinary authentication and retain only destroy-only attribution ([0055:839](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:839), [0055:844](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:844)).

Sequence: request under key A → rotate to B → human approves → predecessor is revoked → A cannot poll → B is not the requesting key. Authority exists, but the agent cannot retrieve its `grantId`.

Resolution shape: replace “credential family unchanged” with an exact request-bound credential generation/thumbprint CAS. The safest v1 rule is that rotation terminally invalidates pending requests and the agent re-derives under the new key. Replace the generic rotation acceptance row with this explicit race.

### MATERIAL — Standing-delegation admission contradicts the ceremony floor and lacks a precise authority owner  
*v0.2-introduced*

The tier table makes creating or widening a delegation tier 2 ([0150:399](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:399)), but subsequent additions to its key subject are tier 1 ([0150:421](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:421)). Adding a new key widens the set that can receive future silent grants, so these rules conflict unless “widening” is explicitly restricted to template widening.

“Owner” is also overloaded: 0055 uses owner for the agent’s `owner_user_id`, while the standing delegation must belong to the human whose effective authority is being delegated. The RFC does not pin whether self-rotation carries subject admission to the new thumbprint, nor state that a currently app-elevated query can no longer mint silently.

Resolution shape: replace the standing-delegation record/consequences prose at lines 413–446 with a compact record contract: granting/effective user, creator, subject identity form, exact template, delegation expiry, maximum grant TTL, current-effective-tier check, subject-removal/revocation, and rotation behavior. Either make every subject addition tier 2 or explicitly revise and justify the ceremony-floor terminology.

### MATERIAL — The commissioned agent profile conflicts with 0077’s custody condition  
*v0.2-introduced*

The RFC correctly quotes 0077’s requirement that a non-browser client needs equivalent non-exportable custody before claiming its profile ([0150:148](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:148)), then permits an ordinary extractable `0600` private-key file ([0150:163](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:163)). 0077 explicitly excludes agents and requires equivalent non-exportable native custody ([0077:1177](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:1177)).

The authority table also calls 0077 “implemented and drilled” without qualification, while 0077 says its client custody/profile is not fully closed and a second client is not yet buildable ([0077:530](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:530), [0077:536](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:536)).

Resolution shape: replace the 0077 authority-table row and custody paragraphs. Either require a non-exportable signing facility, or call this a deliberately weaker extractable-key agent profile that reuses 0077’s wire/replay design without claiming its custody profile. Narrow the implementation-status claim to the portions actually landed.

### MATERIAL — Digest v2 still omits facts its acceptance claim depends on  
*v0.2-introduced incomplete fix*

The digest list covers key, scopes, expiry, tier, unknowns, and predecessor union ([0150:273](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:273)), but not the effective user, app/deployment identity, manifest or tier-policy generation, a delegation admission/use decision, or the exact request-bound credential generation. Yet §8 claims manifest and tier changes are detected by digest revalidation ([0150:539](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:539)).

Resolution shape: replace the current display/digest paragraph with the canonical v2 field set and revalidation predicate. This should displace the prose list, not add another list elsewhere.

### MATERIAL — The read-only Expo overlay reopens userless routing  
*v0.2-introduced*

The host inbox correctly says unbound first-contact requests are visible to nobody ([0150:286](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:286)). §6 then allows unspecified “pending requests” to appear at account level ([0150:487](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:487)). An unbound request has no user/account mapping; projecting it either broadcasts the queue or introduces precisely the identity-routing input §6 says the overlay does not provide. Read-only projection is still a confidentiality and access-authorization decision.

Resolution shape: replace §6’s opening sentences so only already host-user-bound/imported requests may project through an authenticated account↔host-user mapping—or remove the v1 projection. Narrow “never an authorization input” to “never a grant-mint or consent input.”

### MATERIAL — First-use journaling is promised but not transactionally specified  
*Round-1 defect remains*

“Every tier-2 first-use is durably journaled unconditionally” does not define the first-use race, recipient, idempotency key, transaction boundary, or failure posture ([0150:448](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:448)). LLP 0045 defines app-enqueued intents and their retry contract, not a host security-event producer or approvals inbox ([0045:16](/Users/ccheever/projects/snapback/llp/0045-notifications-outbox.rfc.md:16), [0045:115](/Users/ccheever/projects/snapback/llp/0045-notifications-outbox.rfc.md:115)).

Resolution shape: replace the notification paragraph with a compact rule defining the unique journal key, recipient, same-transaction tier-0 mint, compare-and-insert first-use gate, journal-write failure posture, inbox retention/caps, and outbox idempotency mapping.

### MATERIAL — New factual claims about existing behavior are still false

The RFC says `SNAPBACK_AUTH_GRANT_SCOPE_DENIED` already carries the missing scope and a reason kind ([0150:315](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:315)). The implementation carries only `{"reason":"missing_scope"}`; it does not carry the exact missing `{fn, kind}` record ([invocation.rs:1547](/Users/ccheever/projects/snapback/src/auth/invocation.rs:1547)).

The no-browser paragraph also says pairing “needs only a code carried out of band” ([0150:476](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:476)). Existing pairing additionally requires a human session to mint the code and later approve the request ([0055:978](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:978), [0055:986](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:986)). Without a browser, an authenticated human CLI/TUI consent surface would still be needed.

Resolution shape: replace the scope-gate clause to say this RFC adds the exact descriptor; replace the headless-human bullet with the actual remaining authenticated-consent requirement.

### MATERIAL — The “exhaustive” named-amendment list is not exhaustive  
*v0.2-introduced*

§7 claims to consolidate every delta ([0150:499](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:499)), but omits at least:

- The invocation diagnostic/escalation-descriptor amendment.
- The LLP 0146 app-tier marker.
- The host journal/inbox storage and LLP 0045 producer.
- Approval-code import/routing and its storage contract.
- The read-only account projection’s access/mapping contract.

The Non-goal “no new … revocation semantics” ([0150:548](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:548)) also contradicts the new supersede and delegation-lineage revocation semantics listed immediately above.

Resolution shape: replace §7 with a compact owner→delta table covering 0055, 0077, 0146, 0045, and 0031, while removing duplicated amendment-status sentences from §§1–6. Replace the Non-goal with “no parallel token/grant model; these named amendments extend 0055.”

### MATERIAL — `open` admission is storage-bounded but trivially starvable  
*v0.2-introduced incomplete fix*

A global pending ceiling bounds storage, but key generation plus one signature is negligible Sybil cost ([0150:303](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:303)). An attacker can keep the global pool full by replacing requests as they expire. 0055 explicitly warns that `open` is not Sybil resistance ([0055:619](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:619)). The new text neither guarantees legitimate admission nor names starvation as an accepted residual; request metadata/unknown byte caps are also absent.

Resolution shape: replace the abuse paragraph with exact count/byte/per-key/source bounds and either a fair/reserved admission policy or an explicit accepted starvation failure posture. Remove the misleading “prices request minting” language.

## Commissioned debates

- **OQ2 — Confirm.** Preserve one live credential in v1; separate custody domains should be separate agent principals. The new stable-credential-id/thumbprint ambiguity and rotation interactions make coexist-per-kind even less attractive.

- **OQ7 — Confirm, with one qualification.** Keep both initiation modes and share machinery, because user-seeded pairing retains its structurally stronger unsolicited-request guarantee. “One approval transaction” may be one implementation with initiation-specific branches, but pairing codes must not silently become creation invitations.

- **OQ3 — Re-scoping is directionally correct.** Terminal release is now proof-bound, while request-id-only pending status is explicitly a bearer status capability. Replace OQ3’s residual “whether” wording with classification of that already-selected hybrid contract; the remaining open decisions are registry spelling, response sensitivity, entropy, and carrier handling.

## Verdict

**NOT READY.**

v0.2 resolves several major round-1 defects and is materially stronger. It nevertheless introduces two reachable authorization failures that can be settled entirely at RFC altitude: `approvalLink` bypasses the existing `invitedBy`/creation-invitation policy, and self-rotation can leave an approved supersede successor inaccessible after destroying its predecessor. The standing-delegation ceremony conflict, custody-profile mismatch, incomplete digest, overlay routing, and notification transaction also remain design questions rather than matters requiring empirical code evidence.

The document therefore has not yet met the stated READY bar of thinking the design through as far as possible before implementation.

## Round 3 — 2026-08-02

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Method:** delta-scoped round — read its own family's rounds 1–2 artifact
only; did not open the Fable artifact. **Blindness caveat, disclosed by the
reviewer and recorded here:** a repository-wide search for
invocation-receipt text surfaced three lines from the excluded 0150
super-refine journal; the reviewer states they only restated v0.3's journal
correction (a fact already in its own artifact) and that it did not open or
further use that file. Assessed as low-impact; noted for the record.
SHA-pinned target and capsule.
**Instruction capsule SHA-256:** `888597e6e9ea93d9699df72247a68aa060f7f046c1fcac88d5b9de6e04cf9fbb`
**Target:** `llp/0150-agent-token-acquisition.rfc.md` (v0.3, 745 lines, Draft)
**Target SHA-256:** `9226e013f50372b6376f422795481d79ea5d08e9dd00ebd174dc38fde36b6d83`
**Status:** completed
**Verdict:** NOT READY (1 BLOCKING + 4 MATERIAL + 2 DETAIL new; author
recommendation: five-item minimal READY set, keep Draft)

## Verbatim review (round 3)

Scope: I read v0.3 and the permitted Codex-family artifact. I did not open the Fable artifact. A repository-wide search for invocation-receipt text accidentally surfaced three lines from an excluded 0150 super-refine file; they only restated v0.3’s journal correction, and I did not open or use that artifact further. No files were edited.

## Round-2 resolution table

| Codex round-2 finding | Status | Evidence |
|---|---|---|
| `approvalLink` bypassed `invited` creation policy | **Partial** | Pairing codes are now excluded and mode/invitation state is revalidated ([0150:277](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:277), [0150:286](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:286)), but request-time versus approval-time invitation consumption and 0055 ownership semantics now conflict. |
| Rotation could strand an approved successor | **Resolved** | Rotation terminally invalidates bound pending requests, while approval CAS checks the exact credential generation/thumbprint ([0150:202](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:202), [0150:402](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:402)). |
| Standing-delegation owner/admission contract | **Partial** | Granting user, creator, credential-id subjects, rotation, and tier re-evaluation are pinned ([0150:486](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:486)); expiry application and subject-removal semantics remain undefined. |
| Agent profile conflicted with 0077 custody | **Resolved** | The RFC now explicitly defines a weaker extractable-key profile and disclaims 0077 custody ([0150:130](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:130), [0150:179](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:179)). |
| Digest v2 omitted authority-relevant facts | **Partial** | Most requested fields are now canonicalized ([0150:321](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:321)), but “delegation admission decision” does not identify or version the delegation being modified. |
| Expo overlay reopened userless routing | **Partial** | Projection is correctly limited to the mapped host user’s inbox and excludes unbound requests ([0150:578](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:578)); the identity mapping itself remains unowned and unspecified. |
| First-use journaling lacked a transaction contract | **Partial** | Key, recipient, mint failure, retry, and outbox rules are now present ([0150:528](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:528)); the chosen post-success transaction cannot compose atomically with actions and external effects. |
| False existing-behavior claims | **Resolved** | The RFC now accurately says the current denial carries only `reason: missing_scope` ([0150:372](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:372), [invocation.rs:1547](/Users/ccheever/projects/snapback/src/auth/invocation.rs:1547)) and preserves authenticated human consent for headless pairing ([0150:563](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:563)). |
| Named-amendment list/non-goal | **Partial** | §7 is substantially complete and the non-goal now admits new revocation semantics ([0150:594](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:594), [0150:670](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:670)); the account mapping is assigned only a route-registry row, not an identity owner. |
| `open` admission starvation | **Partial** | Starvation is now explicitly accepted and isolated to a separate unauthenticated budget ([0150:351](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:351)); several security parameters remain neither fixed nor named as open. |
| Absolute secret-transit wording noted in round 2 | **Unresolved** | “Nothing secret” is still incompatible with the server-issued key-bound token and OQ3’s pending sensitivity classification ([0150:152](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:152), [0150:724](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:724)). |

## New findings

### BLOCKING — Creation-invitation consumption and ownership are internally inconsistent  
*v0.3-introduced*

Evidence: `invited` says the request must consume a live invitation ([0150:277](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:277)), but the later transaction says approval consumes the still-live invitation ([0150:286](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:286)). Consuming at request time makes approval’s live check fail; consuming only at approval permits one invitation to create multiple pending requests unless a unique reservation rule exists.

The same correction reaches an ownership contradiction. v0.3 always makes the approver owner ([0150:301](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:301)), whereas 0055 makes the user who minted a user invitation the owner and leaves operator-created agents unowned ([0055:276](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:276)). Thus Alice can mint the creation invitation while Bob follows the capability and becomes owner, or an operator invitation can unexpectedly create an owned principal. §7 does not identify this as displacement of 0055.

Resolution shape: replace the `invited` bullet and creation-transaction/ownership paragraphs with one reservation state machine: uniquely bind one live invitation to one pending request, consume it on successful approval, and define denial/expiry release-or-burn behavior. For user invitations, bind approver and owner to the invitation creator; for operator invitations, retain unowned semantics—or explicitly replace 0055’s ownership rule and justify that authority transfer. Bind invitation class, creator, and resulting owner to digest v2.

### MATERIAL — Digest v2 does not bind the delegation being modified  
*v0.3-introduced incomplete correction*

Evidence: the canonical set contains only “the delegation admission decision” ([0150:321](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:321)), while delegations carry distinct templates, expiries, and TTL limits ([0150:486](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:486)). Two delegations owned by the same effective user could differ in future silent authority while producing the same apparent yes/no admission field.

Resolution shape: replace that digest field with the exact delegation id plus an immutable/versioned policy digest covering template, expiry, maximum grant TTL, and granting user. Revalidate that exact version in the approval commit. This compresses the vague “decision” field rather than adding a parallel digest.

### MATERIAL — Delegation lifetime and subject-removal semantics remain inert

Evidence: the record names `delegationExpiry` and `maxGrantTTL` but supplies no tier-0 expiry formula ([0150:489](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:489)). Whole-delegation revocation cascades through successors ([0150:436](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:436)), but removing one credential from the subject set is not defined: it may revoke that credential’s existing delegation lineage or merely prevent future silent mints. The “one click per new key” summary also includes the first key even though creating the delegation is tier 2 ([0150:497](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:497), [0150:510](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:510)).

Resolution shape: replace the record/consequences prose with the tier-0 expiry equation—at least the minimum of requested TTL, maximum grant TTL, delegation expiry, and 0055’s hard bound—and choose subject-removal behavior explicitly. Correct the ceremony summary to “tier 2 once to create the delegation; tier 1 for each later credential; zero thereafter.”

### MATERIAL — “First successful use” cannot share a transaction with arbitrary action effects  
*v0.3-introduced correction defect*

Evidence: v0.3 places first-use journal insertion in the same transaction as the invocation receipt ([0150:528](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:528)). Snapback actions deliberately run outside the transactional snapshot path and commit effects through separate mutations ([0028:430](/Users/ccheever/projects/snapback/llp/0028-cron-scheduled-execution.rfc.md:430)); earlier effects remain committed even if the action later times out ([0028:473](/Users/ccheever/projects/snapback/llp/0028-cron-scheduled-execution.rfc.md:473), [server.rs:2258](/Users/ccheever/projects/snapback/src/server.rs:2258)). An external effect can therefore occur before a crash prevents the receipt/journal transaction.

Resolution shape: replace the post-success rule with either a fail-closed pre-handler “first attempted use” journal gate, or explicitly split transaction-contained invocations from actions and journal actions before their first external effect. Update the §8 journal row to match the selected semantic.

### MATERIAL — The account↔host-user mapping remains an unowned authorization protocol  
*v0.3-introduced correction defect*

Evidence: §6 requires an “authenticated account↔host-user mapping” ([0150:578](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:578)), but §7 assigns only the account-mapping view’s route and sensitivity registration to LLP 0031 ([0150:634](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:634)). LLP 0031 owns route-policy classification, not cross-plane identity lifecycle ([0031:171](/Users/ccheever/projects/snapback/llp/0031-server-route-taxonomy.spec.md:171)); LLP 0106 explicitly says Expo accounts and application users are separate identity planes ([0106:118](/Users/ccheever/projects/snapback/llp/0106-agent-native-expo-account-bootstrap.rfc.md:118)). Read-only projection still exposes identity-derived approval data.

Resolution shape: replace §6 with either no v1 overlay or an explicit dependency on an identity-owning amendment that pins mapping creation, proof, audience/deployment binding, revocation, and stale-link behavior. Keep §7’s 0031 row only for route classification.

### DETAIL — Security parameters are implied rather than named as open

Evidence: per-source throttling, metadata byte caps, the global ceiling, inbox retention, and per-user journal caps lack values or an explicit deferred-parameter designation ([0150:351](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:351), [0150:536](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:536)).

Resolution shape: compress those prose clauses into a small parameter table with defaults/hard maxima, or mark the exact values as open empirical parameters that must be pinned before implementation.

### DETAIL — Two absolute statements contradict the custody recast

Evidence: “nothing secret is transmitted” conflicts with the server-issued key-bound token ([0150:152](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:152), [0150:158](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:158)). The Related header still calls 0077 “the custody model this RFC extends” despite §1 explicitly disclaiming that custody profile ([0150:45](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:45), [0150:179](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:179)).

Resolution shape: replace “nothing secret” with “no durable bearer authority secret,” and replace “custody model” in Related with “wire/replay model.”

## Commissioned debates

- **OQ2 — Confirm.** Preserve one live credential in v1; separate custody domains should remain separate agent principals. Credential-id delegation subjects reinforce rather than weaken that position.

- **OQ7 — Confirm.** Keep both initiation modes over shared machinery: user-seeded pairing retains the structurally stronger unsolicited-request guarantee, and v0.3 further confirms that pairing must remain non-creation authority.

## Verdict

**NOT READY.**

v0.3 resolves the rotation blocker, custody mismatch, factual corrections, supersede CAS/expiry rules, and host-local routing. However, the `invited` correction introduces a new blocking state-machine and ownership contradiction. The delegation digest/lifecycle, action-safe journaling boundary, and cross-plane mapping are also decisions that can—and should—be settled before implementation.

Author recommendation: keep the RFC Draft. The minimal READY set is:

1. Replace the invitation consumption/ownership rules with one coherent reservation and owner-binding transaction.
2. Bind the exact delegation and complete its expiry/removal lifecycle.
3. Choose a journal boundary that works for non-transactional actions.
4. Remove the v1 overlay or assign and specify its identity mapping.
5. Name the remaining numeric parameters as open and correct the two absolute wording claims.

OQ2 and OQ7 need not gate acceptance while they remain explicitly open.

## Round 4 — 2026-08-02 (final round)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Method:** delta-scoped final round — read its own family's rounds 1–3
artifact only; searches restricted per the tightened capsule scoping;
transcript audit below confirms no excluded-file access this round.
**Instruction capsule SHA-256:** `d08f7d7944c05074e8672a745f7dd2a7680f77f397271c7bcbbb6682ba0476a2`
**Target:** `llp/0150-agent-token-acquisition.rfc.md` (v0.4, 853 lines, Draft)
**Target SHA-256:** `3ddde9576a2715e80e93c17886545db24e7e312a98ccdca5554f3c8d70f384b3`
**Status:** completed
**Verdict:** NOT READY (round-3 findings resolved or partial; 1 BLOCKING +
3 MATERIAL new; author recommendation: apply the named fixes, no further
review round needed, acceptance is the author's decision)

## Verbatim review (round 4)

Scope/exclusions: I read the complete v0.4 target and the Codex-family rounds 1–3 artifact. I did not read the Fable artifact or any 0150 super-refine journal; searches were restricted to the target, specifically relevant `llp/NNNN-*.md` files, and `src/`. No files were edited.

## Round-3 resolution table

| Codex round-3 finding | Status | Evidence |
|---|---|---|
| Creation-invitation reservation and ownership | **Resolved** | Mint reserves one invitation, approval consumes it, denial/expiry release it, and approval revalidates state ([0150:301](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:301)); ownership now follows explicit per-mode displacement rules ([0150:333](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:333)). |
| Digest did not bind the exact delegation | **Resolved** | Digest v2 now includes delegation id and a versioned policy digest covering template, expiry, `maxGrantTTL`, and granting user, revalidated in the approval commit ([0150:358](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:358)). |
| Delegation expiry, subject removal, and ceremony count | **Resolved** | The tier-0 expiry minimum and subject-removal cascade are explicit ([0150:545](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:545)); the count now distinguishes creation from later admissions ([0150:578](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:578)). |
| Post-success journaling did not compose with actions | **Resolved** | First use is now per-scope, pre-handler, first-attempted-use, with journal failure refusing dispatch ([0150:601](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:601)); this matches actions’ non-transactional execution model ([0028:420](/Users/ccheever/projects/snapback/llp/0028-cron-scheduled-execution.rfc.md:420)). A new retention defect remains below. |
| Account↔host-user mapping was unowned | **Resolved** | The overlay does not exist until a 0106-lineage identity amendment lands, with mutual proof, audience/deployment binding, revocation, and stale-link failure ([0150:656](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:656), [0150:723](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:723)). |
| Numeric parameters were not named as open | **Partial** | OQ8 now names the round-3 list ([0150:835](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:835)), but the body still requires an undefined “short mandatory TTL” for tier 2 ([0150:522](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:522)) and does not name delegation-lifetime bounds as decided or open. |
| Absolute secret/custody wording | **Partial** | Related correctly says “wire/replay model” ([0150:64](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:64)), but invariant 1 still says durable authority secrets “never exist at all” while the agent necessarily holds a durable private signing key ([0150:90](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:90), [0150:165](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:165)). |

## New findings

### BLOCKING — Full-template coalescing can silently mint an elevated scope and cannot compose with immutable grants  
*v0.4-introduced defect*

Evidence: tier-0 minting promises to re-evaluate current effective tiers and exclude functions raised above silent eligibility ([0150:573](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:573)), but the new coalescing rule mints the delegation’s **full template** ([0150:592](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:592)). If template `{q1,q2}` exists and the app raises `q2` to tier 2, a tier-0 request for `q1` mints a grant that also contains `q2`, bypassing the new tier.

Filtering `q2` does not close the design: template widening is supported ([0150:526](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:526)), grants are immutable ([0150:454](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:454)), and “every later request returns that grant” leaves no legal transition when the current template gains a scope.

Resolution shape: replace the effective-tier sentence and upward-coalescing bullet with one versioned current-grant state machine. Mint only the currently tier-0-eligible projection; define atomic revoke-and-replace behavior for approved template versions and narrowing, or make templates immutable and replace a delegation wholesale. Preserve one current delegation grant per credential rather than adding parallel grants.

### MATERIAL — Sweeping journal rows breaks first-use exactly-once semantics  
*v0.4 correction defect*

Evidence: first attempted use is deduplicated solely by the journal key ([0150:601](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:601)), but those rows are count-capped and “oldest swept” ([0150:614](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:614)). Once an active grant’s marker is swept, its next use inserts the key again and generates another “first-use” event. LLP 0055 grants may remain live for up to 90 days ([0055:1012](/Users/ccheever/projects/snapback/llp/0055-agent-principals-and-scoped-grants.rfc.md:1012)); count-based eviction can happen sooner regardless of retention duration.

Resolution shape: replace the single sweepable journal-row contract with a retained dedupe marker through grant terminality plus retry/outbox slack, and a separately sweepable inbox projection. Alternatively, forbid eviction of markers for live grants and pin retention accordingly.

### MATERIAL — The claimed first-round-trip delegation creation has no protocol surface

Evidence: grant requests do not carry a delegation proposal ([0150:264](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:264)); the digest covers admission to an already identified delegation ([0150:375](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:375)); and the admission prose likewise assumes an existing `D` ([0150:563](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:563)). Nevertheless, the ceremony count says the first agent’s browser round-trip creates the delegation and admits that key ([0150:580](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:580)). The supposedly exhaustive route amendment omits create/version/revoke/admit/remove operations ([0150:731](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:731)).

The `createdBy` exception is also unreachable as specified: it differs only through §5 impersonation ([0150:548](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:548)), but §5 auto-approves only tiers 0/1 ([0150:635](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:635)) while delegation creation is tier 2.

Resolution shape: replace the creation/admission summary with explicit create+admit and later-admit transactions, including request/display/digest fields and route-policy amendments. Either remove the distinct `createdBy` producer in v1 or define its non-production tier-2 ceremony.

### MATERIAL — Autonomous-only mint refusal still permits foreign-predecessor request injection  
*v0.4-introduced incomplete correction*

Evidence: mint-time validation checks only that the predecessor is not autonomous ([0150:439](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:439)); exact requesting-credential binding is deferred until approval ([0150:461](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:461)). Because inbox routing follows the predecessor’s effective user ([0150:384](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:384)), a requester that learns another agent’s delegated `grantId` can create a doomed but victim-visible escalation request. Approval fails safely, but request injection, disclosure, and consent spam have already occurred.

Resolution shape: replace the mint parenthetical with a mint-time check that the predecessor is live, delegated, and bound to the exact requesting credential generation/thumbprint; retain the approval CAS for subsequent races. Replace the autonomous-only acceptance row with autonomous/foreign/stale predecessor negatives.

## Commissioned debates

- **OQ2:** Preserve exclusive credentials in v1; separate custody domains should remain separate agent principals.
- **OQ7:** Keep pairing and approval-link initiation over shared machinery because pairing retains a structurally stronger unsolicited-request guarantee.

## Verdict

**NOT READY.**

v0.4 substantively resolves the round-3 requested corrections, but its new upward-coalescing rule creates a reachable silent-authority violation and an impossible transition against immutable grants. That is a genuine pre-code blocker, not residual polish. Journal retention, delegation creation, and predecessor validation also remain material protocol gaps.

Author recommendation: keep the RFC Draft. The minimal READY set is the four resolution shapes above, plus two small correctness closures: name tier-2/delegation lifetime parameters in OQ8 and narrow invariant 1 to “durable bearer authority secrets.” OQ2 and OQ7 should not gate acceptance. No additional review round is necessary under the commissioned final-round rule; after those fixes, acceptance is the author’s decision.
