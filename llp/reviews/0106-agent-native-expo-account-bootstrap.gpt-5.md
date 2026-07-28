# LLP 0106 — review (GPT family)

**Reviewer family:** GPT
**Provider / runtime:** OpenAI Codex CLI 0.145.0 / GPT-5 (`gpt-5.6-sol`), `--sandbox read-only`, cwd `/home/tuft/projects` (snapback + universe + eas-hosting readable).
**Target:** LLP 0106 (RFC) — Agent-native Expo account bootstrap.
**Redacted:** No.

## Round 1 — 2026-07-28 (/llp-super-refine)

- **Entry revision hash:** `b142323c` (0106, at Draft→Review).
- **Instruction hash:** `ff0b8d30` (`/tmp/sr0106r1/instruction.md`).
- **Blindness:** launched concurrently with the Fable review; instructed to exclude `llp/reviews/`; sealed until both landed.

---

## Overall assessment

The core product direction is strong: provisional workspaces avoid synthetic human identities, trusted-host federation is explicitly privileged, and durable authority remains human- or organization-owned. However, the claim-capability security model, trusted-host account-linking rule, and bootstrap state machine are not yet sound enough to accept. Each leaves an ownership or authorization ambiguity precisely where this RFC intends to establish the identity spine for LLPs 0103–0105.

## Strengths

- Correctly separates human identity, owning account, agent client, installation, robot principal, grant, token, payment instrument, and provisional workspace.
- Preserves LLP 0103’s owner-independent project/environment identity and explicit billing cutover rather than embedding account identity into durable resource ids.
- Cleanly precedes LLP 0089: bootstrap establishes authority; LLP 0089 consumes that authority for provisioning.
- Rejects automated creation of password-backed “human” users and treats account linking, project transfer, and destructive record merging as distinct operations.
- Makes Stripe-hosted payment authoritative through webhooks/API state and separates payment-method setup, subscription selection, metered authorization, and budget.
- Gives provisional resources a useful but explicitly non-production capability set with expiry, quotas, no paid overage, and abuse controls.
- Treats agents as separately attributable robot principals and requires attenuation, sender constraints, revocation cascades, audit, and secure credential sinks.
- Correctly treats email and phone as hints or delivery channels rather than proof of identity.
- Includes concrete acceptance scenarios for replay, duplication, SSO policy, idempotency, transfer attribution, credential attenuation, and secret leakage.

## Concerns

1. **[MATERIAL] A stolen claim URL can still determine ownership.** In “Flow B: no Expo authority is available,” “Flow D: universal claim, signup, and optional payment,” and “Required defenses,” the claim link is described as trusted and short-lived, but there is no independent proof that the authenticated person opening it is the human for whom the agent created the workspace. Because the destination account is selected during the ceremony, an interceptor can authenticate as themselves and claim the project into their own account while leaving the agent key unchanged. That contradicts acceptance scenario 10’s claim that a stolen URL cannot silently change the destination. Resolve this by explicitly defining the URL/code as either an acknowledged bearer ownership capability—with suitably narrow disclosure, confirmation, notification, hold/reversal, and recovery semantics—or by adding an independent binding to the intended claimant. The receipt must show both claimant and destination, and first claim should not become irreversible merely through possession of `verification_uri_complete`.

2. **[MATERIAL] Trusted-host federation does not define a safe deduplication/linking rule.** “Flow C: trusted agent-host signup” says Expo resolves issuer/subject to an existing Expo identity and that linking follows “verified-identity” policy, but a newly trusted issuer’s `sub` will have no existing mapping. Automatically linking by a host-asserted verified email risks account takeover and can bypass an existing account’s MFA or recovery posture; refusing email linking creates the duplicate accounts the RFC promises to avoid. Resolve this with a normative rule: an existing `(issuer, subject)` mapping may sign in directly, while first-time linking to an existing Expo human requires authentication under that Expo identity or an explicitly approved enterprise federation/account-linking policy with defined assurance requirements. Generic, non-enumerating handling must be preserved. A new durable identity may be created only after the collision check and required terms/recovery ceremony.

3. **[MATERIAL] The single linear state machine conflates ownership, agent authorization, policy, payment, provisioning, and cleanup.** “State machine and idempotency” cannot represent common outcomes such as “workspace claimed but robot approval denied,” “ownership transferred but payment pending,” “active free after paid checkout failure,” “agent enrollment code issued but not exchanged,” or “claim completed while provisional cleanup races.” A retryable payment failure must not roll back ownership, and cancellation of agent enrollment must not imply deletion of a human-owned project. Resolve this by defining orthogonal durable state dimensions—or a product state plus explicit substates—for workspace lifecycle, ownership transfer, human authorization, agent enrollment, billing/entitlement, and cleanup. Pin transaction boundaries, terminality, compensation, and idempotency ownership for claim, transfer, credential issuance, subscription creation, and expiry.

4. **[MATERIAL] Proof-key binding lacks the replay contract needed for the stated security guarantee.** “Decision,” “Paved credential shape,” and “Required defenses” require proof-key-bound bootstrap and enrolled credentials, but do not require unique proof identifiers, replay detection, or server-issued nonces. A copied DPoP proof can otherwise be replayed within its accepted time window, particularly against bootstrap/status/exchange operations. Resolve this by making RFC 9449 proof validation normative—`typ`, asymmetric algorithm policy, `htm`, normalized `htu`, `iat`, unique `jti`, `ath` at protected resources, key-thumbprint continuity, and replay rejection—and require authorization-server nonces where replay risk warrants them. Define equivalent semantics explicitly if the bootstrap credential is not an OAuth access token.

5. **[detail] Flow naming is internally inconsistent.** The Summary defines A as existing delegation, B as trusted host, and C as provisional fallback, while “Product flows” labels B as provisional and C as trusted host. Use one mapping throughout because these labels will otherwise leak into implementation specs and tests.

6. **[detail] Separate standardized OAuth grants from the custom bootstrap protocol.** “Relevant standards” and “Flow B” borrow Device Authorization Grant vocabulary, but `bootstrap.begin`, provisional deployment, and receipt-bound enrollment are not RFC 8628. State whether the claim path actually exposes an RFC 8628 device authorization/token endpoint or merely adopts its UX and polling error semantics. If it is compatible, specify `device_code`, `user_code`, `verification_uri`, `verification_uri_complete`, `authorization_pending`, `slow_down`, expiry, and token-endpoint exchange; otherwise avoid implying wire compatibility.

7. **[detail] The trusted-host display contract needs a canonical signed request object.** “Flow C” says the host renders Expo’s exact request, but does not define how the host proves which bytes and policy version were displayed. The implementation spec should use an Expo-signed, nonce-bound authorization request object or digest, require the assertion/consent receipt to echo that digest, and reject stale or altered requests.

8. **[detail] RAR and token-exchange profiles need Expo-defined semantics.** “Relevant standards” correctly uses RFC 9396 and RFC 8693 as building blocks, but neither standard defines Expo project/environment/budget semantics or automatically proves strict attenuation. A follow-on spec must register Expo authorization-detail types, canonical comparison rules, resource indicators/audiences, and server-side subset checking for every child grant.

## Standards & Universe-grounding notes

- RFC 8628 is an appropriate model for decoupled human completion, but the proposed provisional-workspace protocol is broader than Device Authorization Grant and should not be presented as standard-compliant without the standard endpoint and error semantics.
- RFC 9396 can carry structured authorization details, including Expo-defined budget fields, but it does not itself create or enforce a spending mandate.
- RFC 8693 is only a token-exchange framework; strict credential attenuation and delegation depth remain Expo policy that must be checked independently.
- OIDC authenticates the host’s asserted human subject; it does not standardize the attached Expo authorization request, consent receipt, agent-key enrollment, or account-linking decision. Those require an explicit federation/provisioning profile.
- CIBA is correctly classified as optional future work rather than a launch dependency.
- Universe supports the RFC’s OAuth deduplication and SSO-conflict claims, PostHog agentic-provisioning client shape, first-party Expo Agent/MCP OAuth clients, Stripe return allowlisting, and static access-token limitations.
- Universe’s MCP implementation already contains CIMD controls and DPoP-bound access/refresh-token behavior. Its DPoP validator explicitly notes that it lacks a `jti` replay cache and server-issued nonces, so that implementation cannot yet substantiate the RFC’s stronger stolen-credential guarantee.
- The PostHog integration is valid implementation evidence but remains a provider-specific draft client; it does not establish that Expo currently has the proposed provider-side provisional workspace, human claim, grant, or transfer machinery.
- Method: reviewed the target, relevant sibling/governing LLP material, and permitted Universe/eas-hosting source only; no `llp/reviews/` content was accessed.

**Verdict (round 1):** `0106: NOT READY`. 4 MATERIAL, 4 detail.

---

## Round 2 (delta) — 2026-07-28 (/llp-super-refine)

- **Entry revision hash (revision 2):** `1ddc3b17`.
- **Instruction hash:** `63283838` (`/tmp/sr0106r2/instruction.md`; delta enumerated).
- **Runtime:** OpenAI Codex CLI 0.145.0 / GPT-5 (`gpt-5.6-sol`), `--sandbox read-only`, cwd `/home/tuft/projects`.
- **Blindness:** launched concurrently with the round-2 Fable review; instructed to exclude `llp/reviews/`; sealed until both landed.

## Overall assessment

Revision 2 substantially improves trusted-host linking, DPoP replay requirements, Expo/standards grounding, and separation of ownership, enrollment, and billing. However, the round-1 claim-capability concern is not fully resolved: the RFC promises reversal without defining who may invoke it or what independent evidence establishes entitlement to an initially anonymous workspace. The revised state model also leaves the ownership cutover and reversal transition internally contradictory.

## Concerns

1. **[MATERIAL] {IN-DELTA}** The recovery mechanism does not establish who is authorized to reverse a bearer-capability claim. In §“The claim capability is an acknowledged bearer capability” and §“Notifications, audit, and recovery,” associated/prior contact channels are notified and an independent recovery ceremony is promised, but no normative eligibility or evidence rule distinguishes the intended human from an attacker, an unverified contact-hint owner, or the authenticated claimant. A contact hint is explicitly not proof elsewhere in the RFC. Consequently, either a stolen link still becomes irreversible once the hold expires, or recovery personnel must adjudicate ownership without a defined authority signal; allowing a hinted address to reverse would create a different takeover path. Resolve by defining the independent recovery authority and evidence hierarchy, including who can freeze/reverse during the hold, how conflicting claims are adjudicated, what an unauthenticated contact hint can and cannot authorize, and the safe terminal outcome when no party has superior proof.

2. **[MATERIAL] {IN-DELTA}** The six-dimensional state model does not coherently locate the claim’s ownership cutover. In §“State machine and idempotency,” ownership is `UNCLAIMED → CLAIM_HELD → CLAIMED → {REVERSED}`, although the prose says an in-window `CLAIM_HELD` claim can be reversed. Workspace lifecycle becomes terminal at `CLAIMED` when ownership leaves escrow, while the hold text says ownership does not become durable until the window clears. Transaction boundaries separately say `claim` atomically enters `CLAIM_HELD`, while `transfer` performs the LLP 0103 cutover, without specifying whether that fenced transfer occurs on hold entry or clearance. This leaves owner-of-record, authorization, metering, cleanup cancellation, and reversal compensation undefined during the hold. Resolve by defining explicit transitions such as `CLAIM_HELD → REVERSED | CLAIM_COMMITTING → CLAIMED`, assigning the authoritative owner and permitted principal during every state, and pinning the 0103/0104 ownership-interval cutover to exactly one transition.

3. **[detail] {IN-DELTA}** §“Proof-of-possession and replay contract” should specify that replay identity is scoped at least by confirming key/thumbprint plus `jti`, and define the RFC 9449 nonce challenge/retry behavior for the initially nonce-less `bootstrap.begin` request. “Unique per proof” and “nonce required at bootstrap.begin” are directionally correct but insufficient for interoperable implementation without cache-key and `use_dpop_nonce`/`DPoP-Nonce` semantics.

4. **[detail] {IN-DELTA}** §“Trusted-host account-linking rule” says responses are non-enumerating even though first-time collision and no-collision paths require materially different ceremonies. The follow-on protocol should define an Expo-issued opaque continuation/challenge that lets the host render a generic continuation without learning whether the cause was an existing identity, SSO conflict, or recovery requirement.

## Standards & Universe-grounding notes

The RFC correctly limits RFC 8628 to borrowed UX/polling semantics rather than claiming wire compatibility. Its characterization of RFC 9396 and RFC 8693 as frameworks requiring Expo-specific authorization-detail semantics and subset enforcement is sound. The Universe DPoP grounding is accurate: `server/mcp/src/auth/dpop.ts` validates `typ`, asymmetric algorithm policy, `htm`, normalized `htu`, bounded `iat`, optional `ath`, and derives `jkt`; it explicitly lacks a `jti` replay cache and server-issued nonces — correctly identified as new work. The escrow-source amendments identified for LLP 0103 and LLP 0104 are directionally consistent with their owner-independent durable identity, admission-bound attribution, ownership-interval, and account-budget/lease contracts; the unresolved hold-state cutover prevents that grounding from yet being operationally complete.

**Verdict (round 2):** `0106: NOT READY`. 2 MATERIAL {IN-DELTA} (down from 4), 2 detail.

---

## Round 3 (delta) — 2026-07-28 (/llp-super-refine)

- **Entry revision hash (revision 3):** `eac83dce`.
- **Instruction hash:** `2a3d8af6` (`/tmp/sr0106r3/instruction.md`; delta enumerated).
- **Runtime:** OpenAI Codex CLI 0.145.0 / GPT-5 (`gpt-5.6-sol`), `--sandbox read-only`, cwd `/home/tuft/projects`.
- **Blindness:** launched concurrently with the round-3 Fable review; instructed to exclude `llp/reviews/`; sealed until both landed.

## Overall assessment

The recovery-principal design, contact-hint restriction, DPoP replay keying, and delayed ownership cutover substantially address the round-2 concerns. However, revision 3 leaves material state-machine/lifecycle contradictions and makes the opaque trusted-host continuation incompatible with Flow C’s promised fully in-agent ceremony.

## Concerns

1. **[MATERIAL] {IN-DELTA} — Reversal still requires an unspecified ownership-state transition.** In §“State machine and idempotency,” the ownership machine is declared as `UNCLAIMED → CLAIM_HELD → {REVERSED, CLAIM_COMMITTING → CLAIMED}`, but the RFC then says `REVERSED` returns ownership to `UNCLAIMED`. That transition is absent from the machine and effectively un-terminalizes or replaces the recorded reversal state, undermining idempotency and subsequent-claim semantics. Define `REVERSED → UNCLAIMED` explicitly as a reset with a new claim-attempt generation, or model `REVERSED` as the terminal state of an immutable claim attempt while the workspace has a separate current-claim pointer/state.

2. **[MATERIAL] {IN-DELTA} — Expiry and cleanup can destroy a workspace during the newly prolonged hold.** §“State machine and idempotency” keeps workspace lifecycle `PROVISIONAL` with its TTL throughout `CLAIM_HELD`, while cleanup says only that a claim landing while cleanup is merely scheduled wins. It does not say whether entering `CLAIM_HELD` suspends/extends expiry, nor what happens if TTL expires during the hold, a superior-evidence contest, or `CLAIM_COMMITTING`. Consequently the workspace can transition to `EXPIRED` and begin deletion before the claim or dispute reaches its required safe outcome. Pin a normative lifecycle fence: hold/commit/contested states must inhibit destructive expiry and cleanup, with a bounded TTL extension and explicit behavior after reversal or abandoned adjudication.

3. **[MATERIAL] {IN-DELTA} — The opaque continuation fix contradicts the trusted-host product contract.** §“Trusted-host account-linking rule” says every case returns an opaque token and the host renders a generic “continue in Expo” step, with only Expo resolving the required ceremony. Flow C, the Summary, and Goals instead promise that an approved host can complete linking or creation through its own trusted UI without an Expo-page detour. Moreover, the host cannot render the materially different existing-account authentication, SSO, and new-identity terms/recovery ceremonies while being prohibited from learning which ceremony applies. Choose and specify one coherent contract: either an Expo-hosted continuation is required for unresolved first-use cases, narrowing Flow C’s no-detour claim, or define a privacy-preserving host protocol that supplies Expo-authored opaque UI steps and accepts their signed results without exposing the underlying collision classification.

4. **[detail] {IN-DELTA} — DPoP nonce concurrency behavior remains underspecified.** §“Proof-of-possession and replay contract” says subsequent operations reuse the most recently issued nonce. Implementations need a bounded set or overlap policy for recently issued nonces so concurrent requests and retries do not invalidate one another, while `(jkt, jti)` remains independently single-use. Pin this in the follow-on wire/security specification.

## Standards & Universe-grounding notes

The RFC accurately describes Universe’s current DPoP validator as checking proof structure, algorithm, method, normalized URI, `iat`, `ath`, and returning `jkt`, while lacking a `jti` replay cache and server-issued nonces. Keying replay detection by `(jkt, jti)` and retaining entries for at least the accepted `iat` window is sound. The RFC 9449 `use_dpop_nonce`/`DPoP-Nonce` challenge pattern is appropriate, although the follow-on specification must select the correct HTTP status and error placement for each authorization-server versus protected-resource endpoint. The correction identifying `PreventSSOUserOAuthIdentityValidator` as the hard SSO block and `OAuthLoginPendingSSOConflict` as dismissible is consistent with the cited Universe behavior. The delayed ownership cutover is aligned with LLP 0103/0104’s publication-bound ownership interval and admission-bound metering attribution, but the escrow-source amendment and lifecycle fence identified above remain necessary.

**Verdict (round 3):** `0106: NOT READY`. 3 MATERIAL {IN-DELTA}, 1 detail.

---

## Round 4 (delta) — 2026-07-28 (/llp-super-refine)

- **Entry revision hash (revision 4):** `30f072c9`.
- **Instruction hash:** `22e697b4` (`/tmp/sr0106r4/instruction.md`; delta enumerated).
- **Runtime:** OpenAI Codex CLI 0.145.0 / GPT-5 (`gpt-5.6-sol`), `--sandbox read-only`, cwd `/home/tuft/projects`.
- **Blindness:** launched concurrently with the round-4 Fable review; instructed to exclude `llp/reviews/`; sealed until both landed.

## Overall assessment

The immutable claim-attempt/current-pointer revision is substantially coherent, and the DPoP nonce concurrency, replay-cache bounds, evidence-tier clarification, and narrowed resolved trusted-host path address the round-3 concerns. Two delta defects remain: the lifecycle fence lacks a defined transition at its bounded cutoff, and the host-rendered continuation branch cannot provide its stated non-observability without an isolation mechanism.

## Concerns

1. **[MATERIAL] {IN-DELTA}** In **“State machine and idempotency” → “Workspace lifecycle”**, abandoned adjudication reaches a “held-not-destroyed” safe terminal only “until a bounded safe cutoff,” but the RFC never defines what happens at that cutoff. Cleanup remains forbidden while ownership is unresolved, while destructive expiry would violate the stated fence; conversely, indefinite retention defeats the claimed bound and creates an abuse/resource-exhaustion path. Define a durable adjudication state and an explicit cutoff transition—such as support-controlled tombstoning/export plus non-destructive quarantine—or define what evidence safely resolves the dispute before expiry/cleanup becomes eligible. The transition must atomically clear the in-flight-dispute fence and specify ownership, capability, TTL, and retention consequences.

2. **[MATERIAL] {IN-DELTA}** In **“Trusted-host account-linking rule” → “UNRESOLVED cases”**, the host-rendered alternative says the host renders materially different Expo-authored ceremonies yet “cannot … observe which one it is driving.” Opaque tokens do not conceal UI content, interaction shape, timing, or returned results from the renderer, so an ordinary host-rendered protocol can still classify collision, SSO, creation, and recovery paths. Require an Expo-controlled isolated component/origin with a uniform observable envelope and generic terminal result, restrict the strict non-enumeration guarantee to the Expo-hosted alternative, or explicitly redefine what the approved host may learn. The Summary, Flow C, and Goals are otherwise reconciled correctly.

3. **[detail] {IN-DELTA}** In **“Security and abuse model”**, the statement that an undersized hold window “degrades usefulness, not safety” conflicts with the preceding designation of the floor as a security parameter. A window shorter than notification plus reaction latency can prevent a legitimate observer from contesting before commitment. Replace this with language stating that violating the floor weakens the reversal security guarantee, even though absent acknowledgements and active contests still fail safely.

## Standards & Universe-grounding notes

The RFC’s description of the current Universe DPoP validator is accurate: it checks proof type, asymmetric algorithm, method, normalized URI, `iat`, and optional `ath`, but lacks `jti` replay storage and server-issued nonces. The bounded overlapping nonce set is compatible with RFC 9449 provided each `(jkt, jti)` remains independently single-use. The cited SSO validator and interactive conflict distinction are grounded in Universe. The proposed escrow/null-owner ownership interval remains an explicit amendment to LLP 0103/0104 rather than a claim about existing behavior.

**Verdict (round 4):** `0106: NOT READY`. 2 MATERIAL {IN-DELTA}, 1 detail.