# LLP 0151 super-refine journal

## Authorization

Charlie Cheever directed the loop on 2026-08-02: "do an /llp-super-refine on
it for a couple of rounds, but make sure to get codex's input not just as a
review but as a first class input to the discussion on how things should
work and what we should support." The target is LLP 0151, the
first-party-identity-integrations RFC this same session drafted earlier the
same day from a scoping discussion with Charlie; it is untracked in the
working tree throughout the loop.

Two consequences of that direction distinguish this loop from the 0116–0150
journals:

1. **Dual-role capsules.** Both families' capsules carried a Part 1
   ("first-class design input — this is not a formality") ahead of the
   Part 2 review, with explicit license to challenge Charlie's pinned
   author decisions (labeled "author-decision challenge" so they route to
   Charlie rather than being silently applied).
2. **Chartered growth.** Design-input incorporation is additive by design,
   so the usual ~20% growth guideline was applied to review-fix mass, not
   to the incorporation of Part-1 content. v0.1→v0.3 grew 357→856 lines;
   the journal notes this is dominated by two families' adopted design
   content (per-provider credential matrix, lifecycle section, completion
   protocol, per-row annotations), not fix sprawl.

The READY bar is the program's standing bar: "We've really thought this
issue and concept through as much as we can without writing code and
running it to gather empirical evidence." The loop was scoped by Charlie to
**two rounds**; it cannot advance the target beyond Draft; adjudication is
the author's.

**Authorship note.** The orchestrating session drafted the target and does
not count itself as an independent reviewer; its checks appear as the
author-verification passes below. Charlie's pinned decisions at loop start:
scope (identity providers + mechanisms), tier-1 provider set
(Expo/Apple/Google/GitHub), SMS promoted to tier 1, credential-ownership
question deliberately unsettled with the no-fundamental-Expo-tether
constraint.

Loop mechanics otherwise as in the 0116–0150 journals: dual-family rounds
(fresh non-author Fable subagent contexts; Codex via codex-cli
`codex exec`, model `gpt-5.6-sol`, read-only sandbox,
`model_reasoning_effort=xhigh`), mutually blind on 0151 artifacts (own-family
artifact allowed from round 2), SHA-pinned targets and instruction capsules,
verify-then-fix passes between rounds, delta-scoped round 2.

## Round 1 — 2026-08-02

Instruction capsule SHA-256 (shared by both families):
`727b73e0d50304fb8f6f99b179b3345a8a271f517291aea5d7e81ca2b477d970`

Target SHA-256 (v0.1, 357 lines):
`cea4ee0a339eb59cf504d76ab1c662e6ab1cd5c929aec39d936a70ac985eb71f`

Repo revision at review start: `main` `67628399`; the target untracked.

### Author self-verification (concurrent with round 1)

Run before either family reported; all four findings were independently
found by at least one family and applied with the round:

- The Summary's 0011 quotation elides "Magic-link, password," (source:
  `llp/0011:392-393`).
- **LLP 0057 owns the implemented `email-code` provider** and was neither
  cited nor in Related.
- The account-link paraphrase understated 0011's rule (cross-provider
  email auto-linking is opt-in only — the account-takeover vector).
- External-fact pinning: Guideline 4.8's actual text (equivalent-option
  requirement with exceptions; SIWA satisfies but is not mandated by
  name; own-account-system apps exempt), Apple team-scoped `sub` plus the
  `transfer_sub`/TN3159 sanctioned migration path the draft had missed,
  and Google's `sub` stability quote were fetched from primary sources
  during the round.

### Round 1 results

**Both families NOT READY** — Fable moderate margin (0 BLOCKING, 5
MATERIAL, 6 DETAIL), Codex (1 BLOCKING, 7 MATERIAL, 5 DETAIL). Blindness
held for both (Fable: no 0151 artifacts existed; Codex transcript audited —
filename-listing and capsule-prohibition occurrences only). Codex's
markdown links used several wrong corpus *filenames*; every sampled line
anchor and substantive claim nevertheless held against the real files
(recorded in the artifact's orchestrator note).

**Convergent, blind:** both families found the guest section's divergence
from LLP 0011's dated guest-claiming amendment (`llp/0011:467-515` — the
draft re-derived what the amendment specifies, with a definitional
divergence: zero-identity-links vs guest *marking*); both found LLP 0036
absent from a document whose config/secrets open question it answers; both
required an external-prerequisite treatment for SMS's tier-1 placement
(both filed author-decision challenges against the pin — Codex recommending
tier 2 with a promotion checklist, Fable offering annotation-or-tier-2 as
an explicit pick-one); both demanded the delivery boundary correction
(challenges ride an ephemeral seam, never LLP 0045's durable outbox — the
draft's "rides the outbox" contradicted 0045's own pin at `llp/0045:24-29`).

**Codex-only, confirmed:** the BLOCKING absence of an
OAuth-callback→Snapback-session completion protocol; the
identity/authenticator storage conflation (passkey keys, password hashes,
and OIDC subjects in one relation; `(issuer, subject)` canonicality and
immutable provider-installation binding); the LLP 0031 route-taxonomy
conflict (auth routes are not `/_snapback/*` system operations); the
arms/surfaces category error (LLP 0093 arms = hosted/local; surfaces =
LLP 0064); Guideline 4.8 overstatement; Discord-is-not-OIDC; conditional
`form_post`; the capture-mailbox mischaracterization ("prints to a
console"); the payments miscitation (LLP 0069, not 0106).

**Fable-only, confirmed:** the credential-ownership option space omitted
decisive provider facts (Google/Apple have no registration API; GitHub's
App Manifest flow enables one-click per-app registration; Apple
private-relay addresses are team-scoped, so brokered-Apple graduation
strands relay users entirely); the native-arm OAuth mechanics gap
(per-platform client ids, signing-cert binding, system-browser-vs-one-tap);
plus the elided quote, 0057 Related absence, email-vendor asymmetry,
ROR qualification, and the untagged phone-first market claim.

**Design input adopted as first-class content (the loop's charter):**

- *Codex:* the providers/authenticators/lifecycle three-way cut; **Option
  D** (registration automation without authentication brokering, RFC 7591
  where supported); the registration-only-broker trust position; the
  identity/credential split; Microsoft Entra as a named tier-2 preset;
  Apple as an executable adapter profile; the 11-step sequencing; the
  guest state machine (typed post-proof collision capability,
  switch/merge continuations, quarantine TTL, last-authenticator rule);
  NIST password baseline; recovery codes as tier-1 infrastructure;
  substrate verification obligations (RFC 9700/OIDC Core); the
  completion-protocol component list.
- *Fable:* the **per-provider credential-ownership matrix**
  (Apple-never-brokered as dominant strategy; GitHub assisted-BYO via
  manifest flow; Expo native; Google as the one genuine broker case); the
  `auth.expo.io` deprecated-proxy prior art; the token-path-broker
  mandates (app-side JWKS+nonce verification, stateless, no session
  issuance, spec-ships-first); the ROR passkey continuity strategy; the
  freeze-then-chunked-migrate merge shape with the survivor rule; the
  synthetic conformance IdP; guest-before-providers sequencing; the
  password zero-external-dependency rationale; WhatsApp OTP; the
  recovery-anchor paragraph; the MFA-composition open question.

The two families' broker positions were left in explicit, attributed
tension in v0.2 for round-2 cross-examination.

### Round-1 dispositions

All findings from both families applied in **v0.2** (696 lines), SHA-256
`83f5e744b9319090420a5932316b8974fd2819b03d6b283c85cd13a72876a5ab`.
No finding was refuted; none deferred. Charlie's SMS tier-1 pin was kept,
implemented as the new "tier 1 with external prerequisite" annotation
class, with both families' challenges recorded in the document for his
adjudication. Codex's Expo author-decision challenge was adopted as
"tier-1 target, GAP pending provider contract" (consistent with the pin's
intent). Growth 357→696: chartered design-input incorporation dominates
(new §Lifecycle, §Completion protocol, matrix-restructured §Credential
ownership, per-provider fact blocks).

## Round 2 — 2026-08-02

Instruction capsule SHA-256 (shared; family-conditioned blindness — own
round-1 artifact allowed, other family's and this journal prohibited;
19-item v0.2 change enumeration; explicit fidelity-check and
cross-family-engagement asks):
`4a1f6d7bafcf822dd34fb90d61410fb373c8de0d637c819654a264208dc8e64c`

Target SHA-256 (v0.2, 696 lines):
`83f5e744b9319090420a5932316b8974fd2819b03d6b283c85cd13a72876a5ab`

### Round 2 results

**Fable NOT READY (narrow: 3 MATERIAL, 2 DETAIL — all charged to the
round-1 fix text, the recurring cross-loop dynamic). Codex NOT READY
(substantial: 1 BLOCKING — the round-1 blocker judged displaced, not
closed — 7 MATERIAL, 3 DETAIL).** Both audited their own round-1 findings
as genuinely resolved (Fable: all 11; Codex: most, minus the displaced
blocker). Both fidelity checks found the orchestrator's synthesis faithful
with specific exceptions (Fable: one attribution nuance on the SMS
pick-one; Codex: the passkey synthesis had *weakened* its
durable-domain-required position, and "all 13 findings applied" overclaimed
the blocker).

**The design outcome Charlie asked this loop to produce — the families
converged:**

- **Fable moved to Codex's position** on the Google residual, with checkable
  reasons (the round-1 conformance IdP removed the broker's CI job; the
  annotation class made a Google walkthrough internally honest; the
  hard-constrained single-provider broker has a poor cost ratio) —
  recommending **Option D now**, with narrowed C demoted to a pre-pinned
  conditional and Codex's broker-issuer federated-IdP fallback shape
  **rejected as graduation-lossy** (broker-namespace subjects re-key every
  identity on graduation — manufacturing for Google the hazard that
  excluded Apple brokering).
- **Codex held D-now** and independently identified that v0.2's brokered-
  Google text asserted three mutually incompatible identity rules
  (Google-issuer continuity, broker issuer namespace, app-verifies-Google-
  token) demanding one answer.
- The two resolutions compose: the transparent Google-issuer relay is one
  of Codex's two consistent shapes and the only one Fable accepts. **Joint
  recommendation to Charlie: Option D now; conditional C = transparent
  relay only, preview-first, spec-ships-first; broker-issuer variant
  rejected.** Written into v0.3's §Credential ownership.

**Round-2 findings, all verified against tree/primary sources, all
applied:** Codex's BLOCKING (completion protocol: "LLP 0039 lease
machinery" misattributed session issuance — 0039's `/auth/exchange` issues
bearer sessions, `llp/0039:1406`; missing sender-constrained redemption,
native-SDK-handoff and local-arm profiles, and 0031 route classification);
Fable's Apple 5.1.1(v) token-revocation conflict with the token-discard
rule (pinned to developer.apple.com/news/?id=12m75xbj); the
external-prerequisite annotation left unpropagated (both families); the
LLP 0064 surface-axis misenumeration (Exact Native omitted, Swift
double-counted); the brokered-Google contradiction (above); guest
switch/merge lacking checkpoint/abort/cleanup-contract semantics; the
password zero-vendor floor contradicted by its own email-reset package
(fixed with preissued recovery codes) and the over-claimed "NIST baseline";
GitHub manifest flow creates GitHub Apps, not OAuth Apps (product pinned,
secret footprint minimized); lifecycle transition obligations
(recent-auth, notification, session consequences) stated and the full
state machine commissioned as a lifecycle implementing spec; 0104
shadow-meter wording; WebAuthn "at least five labels" floor correction;
SMS attribution clause; provider-installation binding in the transaction;
URL-pinned evidence anchors.

### Round-2 dispositions and loop closure

All 5 Fable + 11 Codex round-2 findings applied in **v0.3** (856 lines),
SHA-256
`8fecd14db3e7de19a1bbaaad532a64710599fc0b68ab26283b872b1c61955ce3`.
`ref-check --verbose` clean (153 docs, 0 errors). No finding was refuted in
either round; across the loop: 16 Fable + 24 Codex findings, all applied.

**The loop closed at Charlie's two-round scope with both round-2 verdicts
NOT READY and the v0.3 fixes applied but not re-reviewed.** Fable's round-2
margin was narrow with an explicit expectation of READY next round if the
five fixes land clean; Codex's was substantial, centered on the completion
protocol, whose round-2 requirements v0.3 now pins (three flow profiles,
sender-constrained redemption, local-arm strategy, 0039 session issuance,
0031 classification). A third round, if Charlie wants one, should be
delta-scoped to the v0.3 changes.

**Items awaiting Charlie (also in the target's §Open questions):**

1. **Credential ownership** — adopt the loop's convergent recommendation
   (Option D now; transparent-relay conditional C pre-pinned;
   broker-issuer variant rejected), or keep the option space open.
2. **SMS tier placement** — the tier-1 pin stands with the
   external-prerequisite annotation; both families' challenges are
   recorded (Codex: tier 2 + promotion checklist; Fable: annotation or
   tier 2, pick-one).
3. **Generated-domain passkeys** — production tier-1 with disclosure vs
   preview-only exception (the tethered-continuity dependency is exactly
   what the no-tether constraint scrutinizes; family positions differ and
   are recorded in §Passkeys).
4. Whether to run a round 3 to convergence, and eventual
   Draft→Review/Accepted status.

**Proposed next step (the author decides; this loop cannot accept):** LLP
0151 remains **Draft**. The commissioned implementing specs (completion
protocol; lifecycle state machine) and the Expo-side OIDC provider
contract are the naturally-next design work; the sequencing proposal's
step 1 (provider-independent core) is the first implementation-facing
decision. Landing note: the working tree is shared with concurrent
sessions; whoever lands these files should re-run `ref-check` at landing
time.
