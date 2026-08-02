# LLP 0151 first-party identity integrations review — Fable family

## Round 1 — 2026-08-02

**Reviewer family:** Anthropic Claude (Fable)
**Provider / runtime:** fresh non-author `general-purpose` subagent under
Claude Code, model `claude-fable-5`
**Date:** 2026-08-02
**Method:** fresh non-author context over the working tree; dual-role
engagement per the round-1 capsule — Part 1 first-class design input (Charlie's
explicit direction for this loop) plus Part 2 review at the standing READY bar;
mutually blind — instructed not to read any `llp/reviews/` artifact nor any
0151 super-refine journal, and no such artifact for 0151 existed at review
time. SHA-pinned target and instruction capsule. Read-only; edited nothing.
**Instruction capsule SHA-256:** `727b73e0d50304fb8f6f99b179b3345a8a271f517291aea5d7e81ca2b477d970`
**Target:** `llp/0151-first-party-identity-integrations.rfc.md` (v0.1, 357 lines, Draft)
**Target SHA-256:** `cea4ee0a339eb59cf504d76ab1c662e6ab1cd5c929aec39d936a70ac985eb71f`
**Repo revision at review start:** `main` `67628399` (target file untracked)
**Status:** completed
**Verdict:** NOT READY (moderate margin; 0 BLOCKING, 5 MATERIAL, 6 DETAIL,
plus Part 1 design positions incl. one author-decision challenge on SMS
tier placement)

**Orchestrator verification note.** Every tree-anchored claim checked by the
orchestrator held: the LLP 0011 guest-claiming amendment at
`llp/0011:467-515` (guest marking, typed collision refusal, session rotation,
`permissionBacking`, claim atomicity), LLP 0036 as the app-secrets owner with
LLP 0045's D8 `uses`-grant precedent at `llp/0045:82-87`, LLP 0057 as "Auth
catalog and provider protocol," the completed hosted-root migration
(`issues/closed/20260725-hosted-root-system-routes-migration.md`), and the
LLP 0150 exclusion at `llp/0150:555-557`. External-world positions (GitHub
App Manifest flow, A2P 10DLC registration, `auth.expo.io` deprecation,
WebAuthn Related Origin Requests and its label cap, Apple relay/team
scoping) are consistent with the orchestrator's own knowledge and with the
primary sources pinned during the author pass; the transfer_sub boundary
matches Apple's TN3159 as fetched by the orchestrator.

## Verbatim review

# LLP 0151 — round 1 (design input + review)

Preliminaries: target hash verified (`cea4ee0a…5eb71f` matches, 357 lines, v0.1 Draft) at repo `main` @ `67628399`. I read the complete target plus LLP 0011, 0039 (relevant sections), 0045, 0061, 0093, 0103, 0104, 0106, 0143, 0150, 0007, 0057 (spot checks), `src/auth/provider.rs`, `guide/capabilities.md`, and the issues tree. No `llp/reviews/` files or super-refine journals were opened.

## Part 1 — Design input

### 1. What to support

**The mechanism set is right in membership; one placement is wrong in obligations.** Email OTP as the default, passkeys as additional-next-to-recoverable, and guest-with-upgrade as the time-to-first-use lever are all correct calls, and the guest reasoning is the strongest part of the document. Two positions:

- **SMS OTP cannot meet tier 1's own testable definition as written** *(author-decision challenge)*. Tier 1 is defined as "zero or near-zero configuration… An agent gets a tier-1 mechanism working from the guide alone, without leaving the repo" (target:89–92). Production SMS in the US requires A2P 10DLC campaign registration or toll-free verification — a days-to-weeks vetting process tied to a business identity — plus per-country sender-ID registration elsewhere, and it carries a live fraud economy (SMS pumping / artificially inflated traffic) that can burn real money in hours. An agent cannot complete carrier vetting from the guide alone; no seam design changes that. I am not arguing phone-first sign-in doesn't matter — it does, especially for the Expo/RN arm. I am arguing the *tier obligations* and the *mechanism* don't fit each other. Concrete proposal, pick one: (a) keep SMS in tier 1 but introduce an explicit annotation class — "tier 1 with external prerequisite" — whose guide page's CI-verified path runs against a capture/fake driver and whose real-vendor leg is an honestly-labeled manual walkthrough; or (b) hold SMS at tier 2 until the vendor seam plus a compliance walkthrough exists, with promotion pre-committed in this document. Either way the design must add: destination-country allowlist **default-on**, per-destination and per-app send throttles, and cost-rate alarms — SMS pumping is not a "SIM-swap guidance" footnote, it is an attack on the app owner's wallet that the paved path must fail closed against.
- **Username + password is correctly tier 1 but for a reason the draft doesn't give**: it is the only production mechanism with *no* external dependency at all (email OTP needs a mail vendor in production — see finding D-4). That is worth stating, because it makes password the honest "works anywhere, forever, free" floor, which matters for the no-tether constraint.

**Provider set: agree with all four** — no challenge. Two additions:

- **Split "preset" from "tier 1."** The expensive part of tier 1 is the guide page + acceptance coverage + per-arm affordances, not the preset config blob. Once the OIDC substrate exists, a preset is ~30 lines of pinned issuer/claim-mapping data. Ship a *preset catalog* broader than tier 1 — Discord, Microsoft/Entra, Slack, LinkedIn as named tier-2 presets ("configured by name, no bespoke code, no paved-path promise"). This gets the "named list of providers" shelf-presence the Motivation correctly wants, at near-zero cost, without inflating tier-1 obligations.
- **Landscape looks right.** Facebook/Meta demotion is correct (declining relevance for new consumer apps, app-scoped IDs, heavy review process). I'd add WhatsApp OTP to the landscape list — in several major markets it is cheaper and higher-deliverability than SMS, and the 0045 seam should not be shaped in a way that assumes "phone OTP ⇒ SMS."

### 2. Credential ownership / broker

This is the section where I have the most to add. The draft frames one global A/B/C choice. **My position: the right answer is a per-provider ownership matrix, not a single policy — and once you look at each provider's actual registration affordances, the broker shrinks to roughly one provider.**

- **Apple: never brokered — excluded from the shared instance entirely.** The draft already observes (target:204–214) that Apple `sub`s are team-scoped and that App Store shipping is what forces Apple sign-in in. Combine those two facts: Apple sign-in only becomes *required* at the moment an app ships to the App Store — and shipping requires the developer's own Apple team *anyway*. So the paved path should be: Apple is BYO-only from day one, enabled at App-Store time, on the app's own team. The re-keying trap then never occurs, by construction. Brokering Apple buys almost nothing (the pre-App-Store phase doesn't need it) and costs the worst migration hazard in the whole document. Supporting fact the draft understates: Apple private-relay addresses are themselves **team-scoped** — under a team change, relay users get a *different relay address as well as a different sub*, so the draft's "pin an email-based re-link story for Apple up front" (target:279–282) is not "complicated" for relay users, it is **impossible** — there is no matching identifier at all. (Apple's official user-migration API, `transfer_sub`, exists but is designed for app transfers between developer accounts; it is not obviously available for broker-graduation, and the draft should cite it as the boundary of what's possible.) This makes Option B/C-with-Apple not just costly but broken for a user class, and makes Apple-never-brokered the dominant strategy.
- **GitHub: assisted BYO via the App Manifest flow — a fourth option the draft missed.** GitHub supports *programmatic app creation* via the manifest flow: the agent constructs a manifest, the human clicks once, and the app receives its own client id + secret via a code exchange. That is per-app owned credentials with near-zero ceremony — better than a broker on every axis the draft's constraint list names (branding, blast radius, migration), achieved without a broker at all. The tier-1 GitHub story should be "the agent registers your own GitHub App with one click," not a shared client.
- **Expo: no broker needed by definition.** Expo owns the IdP; the Snapback deploy pipeline can register per-app redirect URIs against Expo's own OIDC surface natively. The wildcard-redirect constraint that pushes other providers toward a fixed callback host simply doesn't bind when we control the provider.
- **Google: the one true broker case.** Google has no public API for OAuth client registration and no wildcard redirects, so zero-console Google sign-in genuinely requires a shared client + fixed callback host. Fortunately it is also the *safe* case: Google `sub` is account-global and stable across clients, so broker→BYO graduation preserves every identity. Branding leakage on the consent screen is real but is exactly the prototype-phase cost users graduate away from.

So: **Option C, narrowed to Google-class providers** (Google plus any tier-2 OIDC provider without a registration API), with GitHub on assisted-BYO, Apple on BYO-only, Expo native. The draft's suspicion that "B-as-pure-hosted appears dominated by C" (target:311) is right; I'd go further — A vs C is a false global choice.

**Trust model position:** the draft's dichotomy (token-path broker vs registration-only broker, target:311–314) is partially moot: registration-only is *infeasible* for Google and Apple (no registration APIs exist), and where registration APIs do exist (GitHub manifests) you don't want a broker at all — you want assisted BYO. So the broker that remains is necessarily **in the token path**, and the protocol spec must say so honestly: when the shared instance is used, the broker is inside the authentication TCB. It sees authorization codes and id tokens; it cannot *forge* Google-signed id tokens (the app verifies signature + its own nonce against Google JWKS directly — the protocol must mandate app-side verification and nonce round-tripping, never broker-asserted identity), but a malicious broker can observe and can substitute across concurrent flows. Mitigations to pin in the protocol: stateless per-exchange operation, no durable identity storage, no session issuance ever, published self-hostable implementation from day one (this is what makes the no-tether constraint true *by construction* rather than by promise), and app-side nonce + PKCE with the app-generated verifier passing through. One pre-commitment worth writing down now: **the broker protocol spec ships before or with the Google preset, not after** — a retrofitted "you could self-host it" is exactly the fundamental-tether smell the pinned constraint forbids.

**Prior art the draft must engage:** Expo has run this movie before — `expo-auth-session`'s `auth.expo.io` proxy was a shared fixed-callback broker for exactly this problem, and it was deprecated (open-redirect/phishing surface, ownership-spoofing concerns). Its lessons (bind callback→app mapping to verified app ownership; no open forwarding) should be cited as first-party evidence in §Credential ownership.

### 3. Architecture and sequencing

**The shape is right.** Generic OIDC substrate + named presets + one bespoke GitHub adapter is the converged industry design (Auth.js, Supabase Auth's provider table, Firebase). Presets-as-data (declarative issuer/quirk/claim-mapping records, not code) is worth pinning explicitly because it makes the tier-2 catalog cheap and community-extensible.

**Sequencing: mostly agree, two amendments.**

1. **Guest + upgrade should be sequenced *before* any external provider**, and stated in §Sequencing (which currently orders only providers, target:227–238). It is pure-local (zero external dependencies), it is the biggest time-to-first-use lever by the draft's own argument, LLP 0011 already carries a docketable proposed-in-amendment design for it, and the acceptance-sketch demo (target:330–333) depends on it. The RFC answers 0039's provider ordering but leaves mechanism ordering implicit; make it explicit.
2. **The substrate needs a local conformance-fixture IdP as part of item 1.** The acceptance sketch requires auth-matrix coverage "served and local" (target:327–328), but CI cannot hit real Google. The substrate should ship with a local OIDC IdP fixture (discovery + JWKS + code/PKCE + configurable quirks: form_post mode, missing-userinfo mode) so acceptance runs are hermetic and the Apple-quirk paths are testable before Apple lands. This is the difference between "Google proves the substrate" and "the substrate is provable."

Otherwise the order (substrate+Google → GitHub → Apple-at-first-App-Store-demo → Expo-when-IdP-exists) is right, and Apple's event-driven rather than calendar-driven placement is exactly correct — strengthened by the Apple-never-brokered position above, since the app's own team exists at that moment.

### 4. Hard sub-designs

**Guest→account merge.** The default — "continue as existing account, abandon guest data" — is right; automatic merge is dishonest given app-defined row ownership, and LLP 0011's amendment already refuses collision with a typed error. My input on the merge-handler contract:

- The handler is a *claim-collision continuation*, invoked only after a fresh server-verified challenge, receiving explicit `{survivorId, absorbedId}`; the survivor is always the pre-existing account (guest absorbs into it, never the reverse — otherwise the guest device inherits an account it only proved email control over once).
- "Both principal ids inside one transaction" (target:163–164) needs a caveat the draft's own corpus supplies: arbitrary app JS doing bulk row migration *inside the single-writer lock* is the exact hazard 0011's Argon2-outside-the-lock rule exists for. Propose two-phase: **freeze** the absorbed guest first (sessions revoked, writes refused — cheap, atomic), then let the merge handler run as ordinary chunked mutations against a frozen source, then retire the guest principal. Freezing makes chunking safe without one giant transaction.
- Merge commit is a `permissionBacking` event under LLP 0053 (0011's amendment already pins this for claims), and the whole transition should reuse 0011's claim atomicity/session-rotation/audit spec rather than restating it (see finding M-2).

**Passkey RP-id.** Recommendation: RP id = the app's generated subdomain, treated as **permanent even after a custom-domain move**, with WebAuthn **Related Origin Requests** (`/.well-known/webauthn` on the generated origin listing the custom domain) as the continuity mechanism. This works precisely because Expo retains control of generated domains forever — the usual reason ROR fails (you lost the old domain) doesn't apply. Constraints to pin: ROR's ~5-label cap on distinct eTLD+1 entries (fine for one app + one custom domain; fatal for any shared-RP-id scheme), and **never a shared cross-app RP id** — that would make one app's passkeys assertable by another. Until ROR support is verified across the Expo module surface and target browsers, the draft's "passkeys are additional, next to a recoverable mechanism" guidance stands. This also softens "RP-id migration is effectively impossible" (target:143–144): migration of the RP id is impossible, but *continuity across a domain move* is achievable when you keep the old origin — the open question should be reframed accordingly.

**SMS vendor seam.** Recommend a **raw-SMS driver** behind the 0045 outbox, not Twilio Verify: Verify outsources code issuance/verification state, which both breaks vendor neutrality and bypasses 0057's proven challenge state machine (attempt caps, digest storage, single-use). Snapback owns codes; vendors own transport. Twilio first (widest coverage), with the driver interface taking `(destination E.164, template id, variables)` and returning classified errors matching 0045's taxonomy. Plus the abuse surface from §1: country allowlist default-on, per-destination throttles, spend alarms; per-message cost surfaced via 0104's meter language on hosted and via a required config acknowledgment locally.

**Configuration and secrets.** This one has an owner the draft never names: **LLP 0036**. 0045 already pins provider credentials to 0036's D8 `uses`-grant model for delivery actions; identity-provider client secrets are the same class. Proposal: provider *enablement + non-secret config* (which presets are on, claim mappings, RP id) lives in the declared app manifest/schema surface — exported, diffable, agent-visible; *secrets* (client secrets, Apple signing keys, SMS credentials) are 0036 secrets referenced by name, accessed by adapters under `uses` grants, excluded from export per 0007's existing exclusion list. The open question at target:355–357 mostly dissolves into citing 0036.

### 5. What the draft missed

1. **Native-arm OAuth mechanics** (materially affects the broker design): Google on iOS/Android canonically uses *per-platform client ids* — Android registration binds the app's **signing-cert SHA-1 fingerprint**, iOS uses reversed-scheme redirects — none of which a shared broker can own generically; the broker path therefore implies system-browser flows (ASWebAuthenticationSession / Custom Tabs, https universal-link return), forgoing native one-tap affordances. Apple native sign-in (`ASAuthorizationController`) binds to the app's bundle id and team — further evidence for Apple-as-BYO. Tier 1 promises "client affordances on each client arm" (target:91); the OAuth sections are silent on what that affordance *is* on the primary arm.
2. **MFA / step-up composition has no owner.** The draft's own SMS guidance ("steer high-value apps toward adding a second factor," target:130–131) and the TOTP landscape row both presuppose a factor-composition model that neither 0011 nor this draft defines. One open-question line naming it suffices.
3. **Account recovery as a first-class design area.** Reset flows are mentioned as a password cost, but recovery is the cross-cutting weak point of every mechanism here (passkey-only lockout, SMS number churn, Apple relay opacity). Naming email OTP as the universal recovery anchor — and what that implies for apps that skip email — deserves a paragraph.
4. **Expo's own broker history** (`auth.expo.io`, deprecated) — first-party prior art for §Credential ownership; see Part 1 §2.
5. **A hermetic conformance IdP fixture** for the acceptance matrix — see Part 1 §3.
6. **Production email is also vendor-dependent**, which both weakens the stated SMS asymmetry and suggests the credential-ownership question generalizes: Expo-hosted *delivery* (shared email sending for generated domains, metered via 0104) is the email counterpart of the OAuth broker and arguably belongs in the same ownership discussion.

## Part 2 — Review

## Overall assessment

The document does its central jobs well: it genuinely answers 0011's deferred ordering and 0039's open question; the tier model gives "first-party" a testable meaning wired to 0061; the guest design direction is sound; and every corpus-boundary claim I checked is true against the tree (`email-code` as the only implemented provider — verified in `src/auth/provider.rs` and `guide/capabilities.md:62`; 0150's third-party-OAuth exclusion at `llp/0150-agent-token-acquisition.rfc.md:555-557`; 0045's plaintext-code prohibition at `llp/0045-notifications-outbox.rfc.md:26-29`; 0039's non-goal at `llp/0039-auth-vertical-slice.rfc.md:1667` and open question at :1925-1927; the `/_snapback/*` hosted-root migration pinned in `llp/0093-client-protocol-and-native-clients.rfc.md:742-744` and completed per `issues/closed/20260725-hosted-root-system-routes-migration.md`). External-world spot checks: Apple team-scoped `sub`, `form_post`, no-userinfo, first-auth-only name, Google account-global `sub`, GitHub plain-OAuth2 + REST, exact-match redirect registration, and the Guideline 4.8 "in practice, Sign in with Apple" summary are all correct to my knowledge (high confidence on all; the tags honestly mark them unpinned). The deliberately-unsettled credential section is the loop working as intended, not a defect. What keeps this NOT READY at round 1 is a cluster of corpus-engagement gaps — most seriously, re-deriving guest design that LLP 0011 already specifies in a dated amendment, with one definitional divergence — plus missing facts that change the credential-ownership option space, and an internal tension between SMS and tier 1's own definition.

## Findings

### MATERIAL — Guest section re-derives, and partially diverges from, LLP 0011's dated guest-claiming amendment
`llp/0151-first-party-identity-integrations.rfc.md:148-167` presents the guest design as freshly derived ("The clean design falls out of LLP 0011's model") without citing 0011's dated 2026-07-23 amendment (`llp/0011-auth-and-permissions.rfc.md:467-515`), which already specifies claim mechanics to docketable depth: guest **marking** (not link-count), server-verified challenge from within the guest session, typed collision refusal, session-family rotation at claim, first-claim-wins concurrency, audit events, `permissionBacking` advance, and claim atomicity. One divergence is definitional: the draft defines a guest as "an ordinary principal with **zero identity links**" (:151-152) where 0011 pins "a real Snapback-issued `userId` **with a guest marking**, not a provisional id" (0011:474-476). A Summary that says "Nothing here changes LLP 0011's… model" (:44) should adopt the marking, cite the amendment, and present the merge-handler proposal as a refinement of the amendment's recorded escape hatch ("explicit app-level migration hook," 0011:489-490) rather than as new ground.

### MATERIAL — LLP 0036 (app secrets and config) is absent from a document whose open question it answers
The open question "Where configuration lives… and how secrets stay out of the exported bundle" (`llp/0151-…rfc.md:355-357`) and the credential-ownership section generally never mention LLP 0036, the corpus owner of app secrets/config — even though LLP 0045, which this draft leans on for delivery, already pins provider credentials to 0036's D8 `uses`-grant model (`llp/0045-notifications-outbox.rfc.md:82-87`). OAuth client secrets, Apple signing keys, and SMS credentials are the same class. 0036 belongs in Related (:12-20), in §Credential ownership, and in the configuration open question, where it converts most of an open question into a citation.

### MATERIAL — Credential-ownership option space omits decisive provider facts
Three verifiable facts change the A/B/C analysis (`llp/0151-…rfc.md:259-314`): (a) Google and Apple expose **no client-registration API**, so the "broker that only vends registration" pole of the trust-model dichotomy (:311-314) is infeasible for two of the three brokered providers — the surviving broker is necessarily in the token path; (b) GitHub's **App Manifest flow** permits one-click programmatic per-app registration, an "assisted BYO" shape strictly better than a broker for GitHub and absent from the options; (c) Apple **private-relay addresses are team-scoped**, so under broker→own-team migration relay users lose the email match itself — the required "email-based re-link story for Apple" (:279-282) is impossible for that user class, not merely complicated (and Apple's official `transfer_sub` migration API, the one sanctioned path, targets app transfers between teams, not broker graduation). Confidence: high on (a) for Apple and (c); high on (b); very high that Google offers no supported public OAuth-client-creation API. These are exactly the facts the review loop was asked to bring; the section cannot be settled without them.

### MATERIAL — SMS OTP cannot satisfy tier 1's own testable definition as written
Tier 1 requires "zero or near-zero configuration… working from the guide alone, without leaving the repo" (`llp/0151-…rfc.md:89-92`). SMS OTP requires carrier-side sender registration (US A2P 10DLC campaign vetting or toll-free verification; per-country sender-ID registration elsewhere) that takes days-to-weeks and cannot be completed from the repo, plus an SMS-pumping fraud surface with direct financial cost that the section (:122-131) does not mention. This is an internal-consistency defect independent of the pinned promotion: either the tier obligations gain an explicit "external prerequisite" class or the mechanism's placement is re-argued (author-decision challenge routed in Part 1 §1). The abuse controls (country allowlist, throttles, spend alarms) are design content this section owes regardless of tier.

### MATERIAL — Tier-1 provider promises per-arm client affordances the OAuth sections never shape for the native arm
Tier 1 promises "client affordances on each client arm (LLP 0093)" (`llp/0151-…rfc.md:91`) and the passkey section names native APIs (:139-141), but the provider sections and §Credential ownership are silent on native OAuth mechanics — per-platform Google client ids, Android signing-cert fingerprints, system-browser flows vs native SDK one-tap, https return links — which are not implementation trivia: they constrain whether a shared broker can serve the native arm at all and what "affordance" means on Snapback's primary arm. At minimum an open question naming the native-arm flow shape is owed; Part 1 §5.1 has the substance.

### DETAIL — Elided quotation of LLP 0011's deferral
`llp/0151-…rfc.md:24-25` quotes 0011 as "OAuth, passkey, and external-provider ordering remain later product choices"; the source reads "Magic-link, password, OAuth, passkey, and external-provider ordering…" (`llp/0011-auth-and-permissions.rfc.md:392-393`). The elision is benign but the quotation marks claim exactness; use ellipsis or the full sentence.

### DETAIL — "LLP 0106 §payments" section does not exist under that name
`llp/0151-…rfc.md:323` cites "LLP 0106 §payments"; 0106's sections are "Payment ecosystem" (`llp/0106-agent-native-expo-account-bootstrap.rfc.md:284`) and Flows E/F. Cite the actual section title.

### DETAIL — LLP 0057 missing from the Related header
The spec of the very provider this RFC "ratifies… as the tier-1 default sign-in" (`llp/0151-…rfc.md:105-106`) — LLP 0057, the auth provider protocol — is cited inline via the 0045 handoff (:81-82) but absent from Related (:12-20). Also: "ratifies" is the wrong verb for a Draft; "adopts/proposes to ratify" until acceptance.

### DETAIL — SMS-vs-email vendor asymmetry overstated
"the one tier-1 mechanism with an unavoidable paid vendor dependency" (`llp/0151-…rfc.md:126-127`): production email OTP also requires a delivery vendor (0045's SMTP/provider adapter is unbuilt; the console mailbox is dev-only, `llp/0045-notifications-outbox.rfc.md:93-97,174-176`). Self-hosted SMTP is technically possible, so "unavoidable" is defensible, but the practical gap is smaller than the sentence implies; qualify it.

### DETAIL — "RP-id migration is effectively impossible" needs the Related-Origin-Requests qualification
`llp/0151-…rfc.md:143-144` states migration is effectively impossible; WebAuthn Related Origin Requests provides a continuity path when the original origin remains controlled — which, for Expo-generated domains, it permanently is. The open question (:342-344) already names "a related-origin story"; the body claim should be qualified to match (see Part 1 §4 for the recommended strategy and the ~5-label cap).

### DETAIL — Untagged external claim: "phone-first sign-in is the norm for consumer mobile apps"
`llp/0151-…rfc.md:124-125` asserts a market observation without the `[observed — unpinned]` tag the document applies elsewhere; it is region-dependent (strongly true in several major markets, weaker in others). Tag it or soften it.

## Verdict

**NOT READY** — margin: moderate, one focused revision away. No BLOCKING findings: every corpus claim checked is true against the tree, the external-world tags are honest and (per my checks) accurate, and the deliberately-unsettled credential section is functioning as designed. What blocks READY at the standing bar is that "thought through as much as we can without writing code" is not yet true in four places the tree and public provider facts already reach: the 0011 guest-amendment engagement, the 0036 ownership tie-in, the credential-ownership facts that reshape the A/B/C space, and the SMS/tier-1 internal tension. All are addressable by editing, not by empirical work; with those folded (and the Part 1 positions dispositioned however the author chooses), I would expect to land READY next round.

## Round 2 — 2026-08-02

**Reviewer family:** Anthropic Claude (Fable)
**Provider / runtime:** fresh non-author `general-purpose` subagent under
Claude Code, model `claude-fable-5`
**Date:** 2026-08-02
**Method:** delta-scoped round over the 19 enumerated v0.2 change sites;
family-conditioned blindness — own round-1 artifact allowed (and used, to
audit resolution), Codex artifact and journal prohibited; v0.2's
in-document attribution of Codex positions was the only cross-family
surface used. Read-only.
**Instruction capsule SHA-256:** `4a1f6d7bafcf822dd34fb90d61410fb373c8de0d637c819654a264208dc8e64c`
**Target:** `llp/0151-first-party-identity-integrations.rfc.md` (v0.2, 696 lines, Draft)
**Target SHA-256:** `83f5e744b9319090420a5932316b8974fd2819b03d6b283c85cd13a72876a5ab`
**Repo revision at review start:** `main` `67628399` (target file untracked)
**Status:** completed
**Verdict:** NOT READY (narrow margin; 3 MATERIAL, 2 DETAIL — all
fix-introduced; all 11 round-1 findings verified genuinely resolved.
Part 1: synthesis of Fable round-1 positions verified faithful with one
attribution nuance; **position movement on the Google residual — now
recommends Option D as launch path**, with narrowed C demoted to a
pre-pinned transparent-relay-only conditional and the broker-issuer
federated-IdP shape rejected as graduation-lossy)

**Orchestrator verification note.** The three MATERIALs verified against
tree and primary sources before application: LLP 0064's surface axis is
React Native/Expo, Exact Native, protocol-native (Swift the proving
client — `llp/0064:20-28,94-103`), confirming the misenumeration; the
Apple account-deletion token-revocation obligation (Guideline 5.1.1(v),
effective 2022-06-30, `POST appleid.apple.com/auth/revoke`, refresh/access
token required, documented no-token fallback) pinned to
developer.apple.com/news/?id=12m75xbj; the annotation-propagation and
attribution findings verified directly against the v0.2 text.

## Verbatim review

# LLP 0151 — round 2 (design input + delta review)

Preliminaries: target hash verified (`83f5e744…876a5ab` matches, 696 lines, v0.2 Draft) at repo `main` @ `67628399`, target untracked. I re-read my own round-1 artifact (`llp/reviews/0151-first-party-identity-integrations.fable.md`), the full v0.2 target, and spot-checked new anchors against LLP 0011, 0031, 0036, 0039, 0045, 0053, 0057, 0064, 0069, 0093, 0106, and `src/auth/provider.rs`. No Codex artifact and no super-refine journal were opened; v0.2's in-document attribution of the Codex positions is the only cross-family surface I used, per the capsule.

## Part 1 — Design input (continued)

### 1(a). Fidelity check — is the synthesis of my round-1 positions faithful?

**Yes, with one attribution nuance and no misstatements.** I checked every position v0.2 attributes to Fable against my round-1 text:

- **Password zero-external-dependency rationale** (§Password) — faithful, correctly credited.
- **Per-provider ownership matrix, Apple-never-brokered, GitHub App Manifest assisted BYO, Expo-native, Google-as-the-one-true-broker-case** — all faithfully carried into §Credential ownership; the matrix rows match my round-1 §2 exactly, including the relay-address graduation-lossiness argument and the `transfer_sub`/TN3159 boundary.
- **The Fable position on the Google residual** — the six mandates I pinned (stateless per-exchange, no durable identity storage, no session issuance ever, app-side JWKS + nonce verification with broker-asserted identity forbidden, app-generated PKCE verifier, broker spec ships with or before the Google preset) are all present and none is weakened. "Zero-console requires a shared client, full stop" is a fair compression of what I wrote.
- **ROR passkey continuity, freeze-then-chunked-migrate with the survivor rule, conformance IdP, WhatsApp OTP, `auth.expo.io` prior art, recovery-anchor paragraph, MFA open question, 0036 ownership, native-arm OAuth mechanics, email-vendor asymmetry, delivery-vendor-ownership open question** — all adopted, correctly attributed (solo or "both families" where convergent; no overclaiming on my behalf).

The one nuance (also filed as D-2 below): §SMS records "Codex proposed tier 2 with a pre-committed promotion checklist; Fable proposed exactly the external-prerequisite annotation adopted here." I authored the annotation, but my round 1 offered it as an explicit author's pick-one — "(a) annotation **or** (b) tier 2 with promotion pre-committed" — i.e. I did not oppose tier 2. As written, the section presents a sharper family split than existed, in a passage whose stated purpose is Charlie's adjudication. One clause fixes it. The Revised header's "all 12 Fable findings" count is explicable (11 findings + the SMS author-decision challenge) and I do not contest it.

### 1(b). Cross-family engagement — the Google residual

Codex's argument moved me. **I now recommend A + D as the launch path for Google, with narrowed C demoted to a pre-pinned conditional.** Reasons for the movement, stated so the concession is checkable:

1. **Round 1 already removed the broker's tier-1 job.** With the synthetic conformance IdP adopted (§Architecture), all four tier-1 witnesses — guide page, hermetic fixture, demo, capability row — run without real Google. The broker never carried CI; after round 1 it carries nothing on the paved path either.
2. **The tier model no longer semantically requires zero-console.** The "tier 1 with external prerequisite" annotation class (whose definition already names "OAuth console registration") makes "Google tier 1 with a deterministic guided walkthrough" internally honest. The doc built the escape valve; Google should use it.
3. **Codex's TCB points are ones I had already half-conceded** by mandating constraints: a broker you must constrain that hard, serving exactly one provider, is a standing spec + ops + security commitment with a bad cost ratio at this stage. Option D's walkthrough is a one-time, minutes-scale, agent-generatable ceremony.

**The sharpened residual disagreement, which I ask the author to record:** Codex's fallback shape — a token-path broker existing "at most as an explicitly-labeled separate federated identity provider with a broker-specific issuer namespace" — is the **wrong** conditional shape, and worse than the thing it replaces. A broker-issuer federated IdP mints broker-namespace subjects; graduation to BYO Google credentials then re-keys every identity, destroying exactly the Google-`sub` continuity (`[confirmed]` in v0.2) that makes Google the *safe* broker case at all. It is honest at the trust layer and lossy at the identity layer — it manufactures, for Google, the same graduation-stranding hazard the matrix excluded Apple brokering for. If zero-console Google ever becomes a product requirement (and §Motivation's agent-cannot-walk-consoles thesis says it might), the only graduation-preserving instrument is narrowed C's *transport* broker: Google remains the issuer, identity rows stay `(accounts.google.com, sub)`, the app verifies Google JWKS + its own nonce, and my six mandates apply. **Proposed single recommendation to Charlie: adopt A + D now; pre-commit in this document that any future zero-console Google is narrowed C under the pinned trust model, and that the broker-issuer federated-IdP variant is rejected for graduation-lossiness.** Codex's safeguards (one-use audience/nonce-bound assertion, token discard, explicit labeling) compose into that conditional, as v0.2 already observes; a D-style preview-only dev broker must carry the same no-session/no-durable-identity constraints.

### 1(c). Positions on the new §Lifecycle and §Completion-protocol content

- **§Lifecycle**: the identity/credential relation split, immutable provider-installation binding, last-authenticator rule (correctly scoped to unlink/disable, not deletion), and recovery-codes-as-infrastructure are all right. Two additions: recovery codes should live in the credentials relation under 0057's digest discipline (digest-only at rest, single-use, versioned keyed digest — the machinery exists; cite it). And the token-discard rule needs an Apple carve-out — see M-1, the one place the new section conflicts with a provider obligation.
- **§Completion protocol**: right shape; endorse all of it, especially no-tokens-across-redirects and the RFC 8252 posture. One design input: the authorization transaction should bind the **provider installation id**, not only "issuer binding" — §Lifecycle's own rule is that reconfiguring a preset must never reinterpret identity; a transaction started under installation N must not complete under installation N+1 even when the issuer string is unchanged (e.g. a swapped client registration). One line in the transaction field list closes it.
- **Sequencing** placing the lifecycle core and completion protocol at steps 1–2 is correct; guest-before-providers (step 4 vs 5+) satisfies my round-1 amendment.

## Part 2 — Delta review

### Round-1 resolution audit

All 11 of my round-1 findings are genuinely resolved, not displaced — verified against the tree, not just the diff:

- **M-1 (guest re-derivation/divergence)**: §Guest now adopts 0011's dated amendment by reference with the *guest marking* definition (matches `llp/0011:474-490` verbatim concepts: marking, typed refusal, migration-hook escape hatch), and the merge design is framed as the escape hatch's continuation. Resolved.
- **M-2 (0036 absent)**: in Related, §Relationship (correctly summarizing 0036's Accepted fail-closed/secret-reference model), and the open question is properly narrowed to the system-service consumption capability. Resolved.
- **M-3 (credential-ownership facts)**: no-registration-API, manifest flow, team-scoped relay addresses, and the TN3159 boundary (now correctly including relay-address migration for app transfers and its non-applicability to broker graduation) are all in §Credential ownership. Resolved.
- **M-4 (SMS vs tier 1)**: annotation class added to §Tier model; abuse controls are launch-gating with the exact fail-closed set I asked for; both challenges recorded for adjudication. Resolved (modulo D-2's attribution nuance).
- **M-5 (native-arm OAuth mechanics)**: per-platform client ids, signing-cert binding, system-browser-not-one-tap consequence, `ASAuthorizationController` bundle/team binding, RFC 8252 — all present. Resolved.
- **D-1–D-6**: quote restored exactly (matches `llp/0011:392-393`), 0106-§payments miscitation replaced by LLP 0069 (file and title verified) with the correction acknowledged, 0057 in Related and "proposes ratifying," email-vendor asymmetry qualified, ROR qualification adopted wholesale, phone-first claim tagged region-dependent. All resolved.

### Anchor spot-checks (new v0.2 anchors)

Verified against the tree: `llp/0045:24-29` (ephemeral/capture-class handle, plaintext-into-outbox forbidden — exact), `src/auth/provider.rs:2326` ("production refuses until LLP 0045 supplies a…"), 0036 Status Accepted with fail-closed language, 0031's auth-program lane (`/auth/request-code`, `/auth/exchange`, `/auth/family-alarm` as registered non-`/_snapback` rows at `llp/0031:299-300,367`; the capture mailbox correctly the privileged exception at `llp/0031:338`, AdminWrite + ImpersonationCapability — v0.2's "privileged tooling, not printed to a console" is accurate), 0039's open-question quote (`llp/0039:1925-1927`, exact), `_auth_accounts` non-return and `(provider, subject)` pressure (`llp/0039:603,620,1683`), 0053 `permissionBacking` (`llp/0053:411`), 0011 account-link safety rule (`llp/0011:240-241`, faithful), 0106's RFC 8628 lean (`llp/0106:231-239`). External pins (Google `sub` quote, Apple form_post-when-scopes, Guideline 4.8 with exemptions, ROR ~5-label support floor, RFC 9700/8252/7591/8628, NIST restricted-PSTN, GitHub host/port/path matching) are all consistent with my knowledge; the tags are honest.

### Findings

#### MATERIAL — M-1: §Lifecycle's token-discard rule conflicts with Apple's account-deletion revocation obligation
`llp/0151:343-345` ("Access/refresh tokens from sign-in flows are never stored") collides with an Apple requirement the Apple section (`llp/0151:436-461`) doesn't mention: since 2022, apps offering Sign in with Apple must revoke user tokens via Apple's REST revoke endpoint when the user deletes their account (App Review Guideline 5.1.1(v) account-deletion guidance; `POST appleid.apple.com/auth/revoke` takes a refresh or access token). An adapter that discards tokens at sign-in cannot revoke at deletion time. The fix is editorial: scope the discard rule ("except where a provider imposes a revocation obligation — Apple — where the refresh token is retained encrypted, revocation-use-only, in the credentials relation") and add the revoke step to the Apple bullet list and §Lifecycle's deletion behavior. Confidence: high; pin to developer.apple.com in the fix, matching the document's own pinning standard. This is a fix-introduced defect in the round-1 lifecycle addition.

#### MATERIAL — M-2: the external-prerequisite annotation is not propagated to the tier-1 providers
The annotation class's own definition names "OAuth console registration" (`llp/0151:157-164`), yet §Provider integrations claims tier 1 for Google, GitHub, and Apple with no annotation status stated (`llp/0151:357-481`). Under every non-broker outcome, all three carry an external prerequisite (Google console walkthrough, GitHub's one human click plus account, Apple's team/Services ID); Expo's is the GAP row. The substance is disclosed in each section, but the formal class the round-1 fix created exists precisely so tier-1 claims state it. Bonus clarity for free: whether *Google* carries the annotation is exactly the credential-ownership residual (narrowed C would shed it; A + D keeps it) — stating that makes the open question sharper. One paragraph or one matrix column fixes this.

#### MATERIAL — M-3: the client-surface enumeration contradicts the LLP it cites as the axis owner
`llp/0151:134-135` and `llp/0151:653-654` enumerate surfaces as "React web, Expo/RN, Swift, protocol-native," citing LLP 0064 as owner. LLP 0064's Summary defines three explicit, non-equivalent native surfaces: React Native/Expo, **Exact Native** (generated Rust plans), and protocol-native — with Swift as the protocol-native *proving client*, not a fourth surface. The v0.2 list double-counts one surface (Swift = protocol-native) and omits Exact Native, whose auth story (authorization fencing in the OS carrier) is exactly the kind of row the affordance matrix exists to cover. Since the Revised header claims "arms/surfaces terminology fixed per LLP 0093/0064," this is a half-landed fix: the arms half is correct (verified against 0093's hosted/local usage), the surfaces half is not. Fix: use 0064's axis verbatim, or state a deliberate subset with a reason.

#### DETAIL — D-1: authorization transaction binds issuer but not provider installation
`llp/0151:406-408` lists "issuer binding" among the transaction's bound fields; §Lifecycle (`llp/0151:326-330`) makes the *installation* the immutable identity-interpretation unit. Bind the installation id so reconfiguration cannot complete an in-flight transaction. (Also routed as design input, Part 1(c).)

#### DETAIL — D-2: §SMS overstates the family split on tier placement
`llp/0151:214-216`: my round 1 offered annotation **or** tier-2-with-pre-committed-promotion as an explicit pick-one; recording "Fable proposed exactly the annotation" against "Codex proposed tier 2" presents a cleaner disagreement than existed, in a passage written for the author's adjudication. Add one clause ("Fable offered either the annotation or Codex's shape, listing the annotation first").

### Verdict

**NOT READY — narrow margin.** Every round-1 finding is genuinely resolved; every new anchor I checked is true against the tree; the synthesis of my design input is faithful; and the credential-ownership section has done its job well enough that the families can now converge (Part 1(b) offers a single recommendation plus one pre-pinned conditional). What blocks READY is three MATERIAL defects that are all artifacts of the round-1 fix text itself — the Apple revocation conflict in the new §Lifecycle, the annotation class left unapplied to the providers it names, and the 0064 surface-axis misenumeration — plus two one-clause DETAILs. All five are edit-fixable in a single focused pass with no new empirical work; I expect READY next round if they land clean.
