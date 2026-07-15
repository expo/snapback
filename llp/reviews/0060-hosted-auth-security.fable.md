**Reviewer family:** Claude (Fable)
**Provider / runtime:** fresh Claude Code workflow subagent — model claude-fable-5, reasoning effort max (explicit per-agent override); orchestrated by /llp-super-refine
**Date:** 2026-07-14
**Redacted:** no — repo-local review; no secrets in the reviewed material; reviewer instructed not to read credential files or llp/reviews/
**Method:** sub-agent

# LLP 0060 reviews — Claude family

## Round 1 — 2026-07-14

**Revision under review:** `llp/0060-hosted-auth-security.rfc.md`, sha256 `a9b4a6b8f8dedd11a15ebf856b95f89702cc59bbd0d391b30040b3ab1bbc50f5` (committed at repo HEAD `b11a6fa`)
**Runtime detail:** workflow run wf_f4bfeeab-1c8, agent a0091ce3df31d71a9, model claude-fable-5, reasoning effort max (explicit per-agent override); fresh context — no access to the orchestrating session, to archived reviews, or to the concurrent GPT-family round
**Verdict:** NOT READY

### Review body (verbatim)

# LLP 0060 Review — Hosted auth deployment and client-page security (RFC, Draft)

Independent blind review under LLP 0005. I read the full document including its revision history, the governing/adjacent LLPs (0011, 0039, 0053, 0059 headers/relevant sections), and verified the load-bearing implemented-boundary claims directly against the code. I did not read anything under `llp/reviews/`.

## 1. Overall assessment

This is a strong, unusually honest security contract, and the right document to exist: LLP 0039 explicitly deferred hosted deployment security and the client-page XSS posture to a companion contract (LLP 0039 lines ~234–240), and LLP 0011's revision history already points at LLP 0060 as the owner of the "not hosted-auth ready" claim. The three core decisions — a no-override plaintext fence for sessions, conjunctive fail-closed hosted readiness with target-authored facts, and bearer-v1 honesty with sender-constrained v2 as direction — are all sound, and the document is disciplined about the difference between what is implemented and what is future contract.

Crucially, the implemented-boundary claims check out against reality. Every decisive claim I verified matched code: the pre-bind fence and its exact matrix (`src/admin.rs:121–146`, `src/cli.rs:305–320`, invoked at `src/cli.rs:1581` before the bind at `src/cli.rs:1681`), the must-understand hosted refusal before database creation (`src/cli.rs:1297–1304`), the five-axis descriptor, 32-case matrix, and generated schema (`src/auth/deployment.rs`, `schemas/auth.hosted-capabilities.schema.json`, `schemas/capability.manifest.local-dev-sqlite-ibex.json`), the middleware repeat with `/health` exemption (`src/server.rs:4534–4586`), the bearer-free `settledView()` and narrow `credentialFor` accessor (`packages/snapback-contract/auth-coordinator.mjs:514–538`), exact exchange/refresh/logout projections with numeric and property-name secret exclusion (`demos/_kit/client.mjs:712–762, 1591–1716`), the console-mint master rejection including `expiresAtMs` and prefix collisions (`packages/snapback-admin-client/index.mjs:259–286`), no-floor secret collection with collision-safe markers (both clients), the hash-pinned CSP with middleware preservation and a served-bytes router test (`src/server.rs:4111–4164, 15984–16087`), the real-Chromium Trusted Types proof (`admin-ui/tests/acceptance/csp-browser.mjs`, repeatable via `test:browser-security`), and the sentinel suites naming the intentional v1 carriers (`demos/_kit/tests/auth-coordinator-client.mjs:585–607`). `./ref-check --verbose` passes with 0 errors.

Two things keep it from ready: an internal terminology/gate incoherence in D5 that the implementation resolves silently in one direction, and the document's own recorded state of nine untriaged material findings from its cross-family review.

## 2. Strengths

- **Honest threat claims throughout.** The Summary and C1/C2 refuse the two standard overstatements ("tokens are safe in IndexedDB", "CSP solves XSS") and C3 correctly scopes DPoP to off-device replay resistance, not live-origin compromise. The reserved v2 diagnostic codes come with an explicit "v1 code must not emit them" rule (Diagnostics section) — a nice anti-theater guard.
- **D1's limit paragraph.** Stating plainly that a loopback bind behind a public proxy proves nothing about the proxy is exactly the claim-honesty this program needs, and the capability descriptor backs it (`effectiveSource: unavailable` regardless of topology).
- **Fence-before-bearer-resolution is proven, not asserted** (D1, Acceptance): the test injects a bearer sentinel and asserts it is neither consumed nor reflected (`src/server.rs:15861–15939`).
- **Target-authored facts with fail-closed defaults** (D5): operator flags are requests, never assertions (`src/auth/deployment.rs:1–5`, `src/cli.rs:1298–1300`), the descriptor schema is closed (`deny_unknown_fields`), and an absent descriptor deserializes to the all-unavailable local posture (`src/manifest.rs:2809`, `deployment.rs:103–107`) — conservative in the right direction.
- **C1's redaction contract is unusually deep and real**: no length floor for known carriers, canonical-string comparison for numeric positions on all three surfaces (kit `client.mjs:277–281`, admin client `index.mjs:374–378`, setup page `src/admin/setup.html:191–193`), generic rejection of secret-bearing success property names, and the mint-time rejection of a derived record embedding its own minting authority.
- **C2 records real executable evidence**, including a genuine discovered defect (the inline-SVG brand mark crossing `template.innerHTML`) and its fix — evidence the acceptance actually runs, with an intentional rejected sink proving enforcement rather than header receipt.
- **Scope and non-goals are crisp**: consuming 0009/0030/0031/0039/0053/0059 without re-owning them, and refusing to design the control plane while pinning the claims. The frozen-0039 boundary is respected (0039 remains Draft/FROZEN and cross-references are consistent).

## 3. Concerns

**1. MATERIAL (coherence/decision-quality): D5 defines "hosted-auth readiness" two conflicting ways, and the document never states which conjunction `--auth-deployment hosted` requires — the implementation silently answers "all five."**
Evidence: D5's opening sentence — "A target's hosted-auth readiness is the conjunction of" the **four** deployment facts — versus the descriptor paragraph in the same section: "`deploymentReady` is derived from the first four exact positive values. `hostedAuthReady` additionally requires `clientCredentialPosture = senderConstrainedV2`." Same term, two fact sets in one section. The Summary (decision 2) and the Hosted-target acceptance bullet use the four/five split correctly, so the D5 opening sentence is the outlier. Meanwhile the implemented must-understand gate checks the five-fact `hosted_auth_ready()` (`src/auth/deployment.rs:133–139, 187–195`), so a future target holding all four deployment facts but a bearer-v1 client posture — the exact "explicit, named compatibility posture" C3 contemplates for hosted products — can never pass `--auth-deployment hosted`. That may well be intended (compat posture as a separate named request), but the RFC that exists to make claims exact never says so; D5's "reject… while any fact is absent" is ambiguous between four and five, and D1 describes the flag as bare `local|hosted`.
Resolution criterion: D5's prose renames the four-fact conjunction (e.g., "deployment readiness") to match the Summary and Acceptance; the document states explicitly which derived fact the `hosted` request requires (per the implementation: `hostedAuthReady`, all five) and how the future bearer-v1 hosted compatibility posture is requested/declared so C3 and D5 compose without contradiction.

**2. MATERIAL (document state / decision-quality): the RFC's own Status records nine untriaged material findings from the ENG-24996 cross-family review.**
Evidence: Revised header ("material findings remain for author triage") and §Status ("verdict: NOT READY — nine material implemented-boundary and hosted/future-contract findings… its material findings await author triage"). I have not read that review and adopt none of its findings; but a document that itself records an unresolved material-finding backlog cannot be called settled, by its own program's rules (the review advises, the author triages — but triage has to happen and be recorded).
Resolution criterion: each archived material finding has a recorded disposition (fixed, rejected-with-rationale, or explicitly deferred with scope), reflected in the document or its review ledger.

**3. MINOR (contract completeness): D2 omits strict-transport (HSTS) and does not distinguish redirect from refusal for credential-bearing requests.**
Evidence: D2 requires "HTTP is redirected or refused before credentials are accepted." A 301/308 answer to a plaintext request that already carries a bearer or login code means the secret already crossed the wire; and without HSTS the first-visit/SSL-stripping window is unowned by any named fact of `externalTls = enforced`. This is future contract text (nothing implements D2 yet), so it is cheap to strengthen now, before a hosted target attests it.
Resolution criterion: D2 names strict-transport (HSTS or a target-native equivalent) as part of the `externalTls = enforced` attestation or records a justified exclusion, and requires refusal (not redirect) for credential-bearing plaintext requests.

**4. MINOR (claim semantics): `multiReplicaConvergent` lacks a conformance-grade definition of the convergence bound.**
Evidence: D4 — "A replica may not accept a credential or drain a live payload **while it knows** its projection is behind the required position." "While it knows" is load-bearing: a partitioned replica that has heard nothing knows nothing and would accept. The acceptance bullet ("Logout, rotation, expiry… each fence a stale replica **before** it accepts or delivers session work") implies stronger, publisher-side fencing (revocation completion waits on replica fences), which is coherent with LLP 0059's two-phase revocation — but the axis a target must attest never pins which semantics count. A future target could self-certify a weak wakeup-based interpretation against the letter of D4.
Resolution criterion: D4 states the bound that the `multiReplicaConvergent` claim attests — e.g., invalidation operations do not report complete until all live replicas are fenced or refused, and a replica that cannot prove currency refuses with `SNAPBACK_AUTH_INVALIDATION_LAGGING` — or names an explicit staleness bound as part of the fact.

**5. MINOR (documentation gap): the absent-descriptor default is fail-closed but unstated.**
Evidence: `hostedAuth` is optional in the manifest schema (`schemas/capability.manifest.schema.json`: not in `required`), and an absent field deserializes to the all-unavailable local descriptor (`src/manifest.rs:2809` `#[serde(default)]`; `src/auth/deployment.rs:103–107`). The acceptance says "unknown values and unknown fields are rejected" but never states the absence rule, which is the more likely path for a future target manifest.
Resolution criterion: D5 or the Hosted-target acceptance states that an absent `hostedAuth` descriptor is the all-unavailable/bearer-v1 descriptor and whether hosted-candidate targets MUST publish it explicitly.

**6. EDITORIAL: the setup-script hash fallback is corpus-wide, not per-document.**
Evidence: C2 says "an exact SHA-256 admission for the one embedded setup script," but the middleware installs that hash on **any** StaticPublic response lacking its own CSP (`src/server.rs:4116–4122`), not just the setup page. The admitted bytes are benign same-origin code so the risk delta is negligible, but the doc's per-response phrasing is slightly more precise than the mechanism.
Resolution criterion: one clause noting the setup hash is the fallback policy for Snapback-owned static documents that do not install a response-specific policy.

## 4. Suggestions

- **Pin the mint-refusal diagnosability.** A short master colliding with the `sbcc_` prefix or the `expiresAtMs` digits makes console-credential minting permanently impossible with only a generic response-shape error (`packages/snapback-admin-client/index.mjs:259–286`). The fail-closed direction is right; consider a distinct, credential-free client diagnostic ("derived credential would embed the submitted master") so operators do not chase a phantom server bug.
- **Name the deferred stronger-isolation option in C3.** The doc correctly says worker isolation does not stop same-origin code from asking the live key to sign. Worth recording explicitly that a separately-origined signing broker (postMessage-brokered iframe/origin) is the only same-device boundary that changes the active-XSS story short of user presence, and why it is deferred — this prevents v2 from re-litigating it. Also worth noting that non-extractable `CryptoKey` handles survive structured clone into IndexedDB, so "origin IndexedDB custody" and "non-extractable key" are compatible, which sharpens the second open question.
- **Consider scoping the dev override.** `--allow-insecure-dev-auth` is boolean; the common legitimate use is LAN-device testing. An interface/CIDR-scoped override would bound the blast radius without changing the sessions rule. Non-blocking.
- **CSP violation reporting.** C2 asks for "tests that make these controls observable"; the production analog is a `report-to` endpoint Snapback could own for its operator pages, turning header regressions into observable events on real deployments.
- **Style hardening roadmap.** `style-src 'unsafe-inline'` is disclosed; a one-line direction (hashed styles once the setup page and React style props permit) would close the loop.

## 5. Open questions

Beyond the document's own good list:

- Which derived fact does `--auth-deployment hosted` request — `deploymentReady` or `hostedAuthReady` — and what is the request shape for the C3 compatibility posture (a distinct must-understand value? an operator-acceptance artifact)? (Concern 1.)
- What is the attestable convergence bound for `multiReplicaConvergent` (all-replica fencing at revocation completion vs. a stated staleness bound)? (Concern 4.)
- Is strict-transport part of `externalTls = enforced`, and does the first hosted profile (Cloudflare) attest it via platform facts or measurement? (Concern 3.)
- Must a hosted-candidate target publish `hostedAuth` explicitly, or is silent defaulting acceptable forever? (Concern 5.)
- When the Cloudflare profile pursues the four deployment facts, which axis is expected to be hardest — shared throttling with bounded failure policy, or invalidation convergence — and does that ordering change whether the first slice should be single-region reverse-proxy instead?

## 6. Readiness verdict

The decisions are right, the honesty posture is exemplary, and the implemented local boundary is real — code and tests substantiate essentially every implemented claim I checked. But "ready" requires no unresolved MATERIAL coherence or decision-quality concern, and two remain: the D5 "hosted-auth readiness" terminology collision plus the unpinned fact-set of the must-understand `hosted` request (Concern 1, verified against `src/auth/deployment.rs`), and the document's own recorded backlog of nine untriaged material review findings (Concern 2). Both are cheaply resolvable — one renaming-plus-one-sentence fix and a triage pass — after which, absent new findings from that triage, this RFC would be ready as a Draft→Review candidate.

READINESS VERDICT: NOT READY

### Orchestrator disposition (round 1, outside the verbatim body)

Spot-checks: the D5 four/five-fact terminology collision and the shipped
`hosted_auth_ready()` five-fact gate confirmed; the absent-descriptor
`#[serde(default)]` fail-closed default confirmed (src/manifest.rs).

Disposition: concern 1 → D5 renames the four-fact conjunction "deployment
readiness", pins `hosted` = all five, and defines the distinct named
compatibility request; concern 2 → the round-2 revision is the recorded
author-side triage of both review rounds (see §Status), with every material
finding resolved in text or named as a defect obligation; concern 3 → D2 now
requires refusal (never redirect) for credential-bearing plaintext and makes
strict transport part of `externalTls = enforced`; concern 4 → D4's
conformance-grade bound (completion waits for fences or lease expiry;
currency unproven ⇒ `SNAPBACK_AUTH_INVALIDATION_LAGGING`); concern 5 → the
absent-descriptor default is stated and hosted candidates must publish
explicitly; concern 6 → the setup-hash fallback scope clause. Suggestions
adopted where cheap (signing-broker note, CryptoKey structured-clone note);
the mint-refusal diagnosability and CIDR-scoped dev override remain
non-blocking suggestions for the implementation.

## Round 2 — 2026-07-14

**Revision under review:** `llp/0060-hosted-auth-security.rfc.md`, sha256 `7ef6dbcf4ce33a80c0026bf27e6defcf39201eaa5900629e5cfcbc0a556f9731` (round-2 working-tree revision; repo HEAD `b11a6fa`)
**Runtime detail:** fresh Claude Code workflow subagent (run wf_4204ef03-76c), model claude-fable-5, reasoning effort max (explicit per-agent override); fresh context, blind to all archived reviews and to the concurrent GPT-family round; orchestrated by /llp-super-refine
**Verdict:** NOT READY

### Review body (verbatim)

The `sbcc_` TTL claim verifies (src/admin.rs:291, exactly ten minutes). I have now verified all the decisive claims I targeted. Here is the review.

# LLP 0060 Review — Hosted auth deployment and client-page security (RFC, Draft)

Reviewer: Claude (Fable 5), fresh blind review under LLP 0005. Prior reviews under `llp/reviews/` were not read. Verification was code-first: every load-bearing implemented-boundary claim I checked was traced to the shipped source.

## 1. Overall assessment

This is a strong, unusually honest security contract, and its central design move is correct: separate what a *target* can attest from what an *operator* asserts, make hosted readiness an exact fail-closed conjunction, and permanently forbid the two marketing lies this space invites ("CSP makes bearer tokens safe" and "DPoP is XSS-resistant"). What most distinguishes the document is that it names its own shipped defects with precision instead of hiding them — and my code inspection confirms those self-incriminating claims are exactly right, down to file and mechanism. The implemented local boundary (D1 fence, D5 descriptor and gate, C1 projections and sentinels, C2 headers) matches the code claim-for-claim. The future contract (D2, D3, D4, D6, C3) is requirements-grade rather than design-grade, which is the correct altitude for an RFC that explicitly declines to design a control plane.

Two things keep it from ready, both cheap to fix: a prose escape hatch in D2 that lets the machine-readable `externalTls = enforced` fact silently cover an SSL-stripping window, contradicting D5's own "no truthy aliases" rule; and an acceptance section that enforces only two of the document's four named defect obligations and none of D5's round-2 layer-2/3 or C2's operator-origin requirements. For a contract whose thesis is that claims must be enforced, its own enforcement surface must be complete.

## 2. Strengths

- **The claim-honesty architecture is real, not aspirational (D5).** The five-axis descriptor, the 32-case executable matrix failing closed on all 31 non-conjunctive combinations, blocker-names-only diagnostics, and the `hosted`-requires-all-five gate all exist exactly as stated (src/auth/deployment.rs:95-238). The stated fail-closed default for an absent `hostedAuth` field is shipped (`#[serde(default)]` → `local_target()`, src/manifest.rs:2809-2810), and the generated schema exists (schemas/auth.hosted-capabilities.schema.json).
- **Self-incriminating accuracy (D1).** The forgeable-posture gap is precisely as described: `ServerContext::new` takes a caller-supplied `loopback` boolean (src/admin.rs:438-443), `detached()` hardcodes `loopback: true` (src/admin.rs:457-462), and the request middleware trusts that field (src/server.rs:4574-4580). The document's scoping is also accurate in the other direction — the CLI path derives posture from the resolved bind IP and asserts it post-bind (src/cli.rs:1499, 1698), so the bypass is embedded-composition-only, "exactly the composition path [the defense] exists for."
- **Pre-bind ordering claims verify (D1/D5).** `--auth-deployment hosted` is refused immediately after bind-name resolution and before database-path creation (src/cli.rs:1297-1304); the embedded repetition exempts only `/` and `/health` (src/server.rs:4544-4550); the fence matrix matches `validate_plaintext_auth_transport` including the desired-or-active sessions rule and the dev-override carve-out (src/admin.rs:121-146).
- **The custody matrix matches reality including its awkward rows (C1).** The `sbcc_` `localStorage` record is real, with the claimed ten-minute lifetime (packages/snapback-admin-client/index.mjs:163-234; src/admin.rs:291) and the master-anywhere rejection including canonical-string `expiresAtMs` (index.mjs:277-284, matching the ENG-24986 revision note). `settledView()` is bearer-free next to the narrow `credentialFor` accessor (packages/snapback-contract/auth-coordinator.mjs:514-538). The direct-bearer seam exists and refuses coordinator bypass (demos/_kit/client.mjs:811-824).
- **The named shipped gaps are where the document says they are (C1).** The 2xx parse-failure body snippet exists in both clients (demos/_kit/client.mjs:1550; packages/snapback-admin-client/index.mjs:117, 129), and `authRequestCode()` returns success JSON unprojected (client.mjs:1571-1586). Naming these as defect obligations rather than papering over them is exactly the right posture, and the issuing-path reasoning (a newly issued credential is outside every redaction set until parsed) is a genuinely sharp observation.
- **Projection and barrier claims verify (C1).** Closed exchange/refresh projections scan string, numeric, and property-name positions against request proofs and the issued token (client.mjs:712-762); logout accepts only exact empty 204, compare-clears captured custody *before* the fixed error (client.mjs:1693-1715); a post-2xx body-read failure carries only status/emptyBody/readFailed across the boundary (client.mjs:1503-1518). The client-secret sentinel with the two named intentional carriers exists (demos/_kit/tests/auth-coordinator-client.mjs:585-608), as do the one-byte/prefix-collision console-mint poison cases (admin-ui/tests/admin-client-credentials.mjs:212-226).
- **C2's baseline is shipped and correctly bounded.** `default-src 'none'`, hash-pinned setup script, Trusted Types, and the crucial rule that shared middleware must not overwrite a response-specific policy (src/server.rs:4111-4164); the real-Chromium acceptance includes the intentional `innerHTML` TypeError probe proving enforcement rather than header receipt (admin-ui/tests/acceptance/csp-browser.mjs:211-248). The section explicitly refuses to let these headers upgrade readiness.
- **D6 is grounded, not invented.** LLP 0058 explicitly delegates hosted coordinator security to this document (0058 §"…does not implement or specify hosted coordinator security"), LLP 0039's companion item 8 matches D6's acceptance rows, and the `_snapback_meta`-before-validation carve-out describes the actual Cloudflare constructor (cloudflare/src/coordinator.js:164-179).
- **C3's naming discipline is correct on the merits.** RFC 9449 itself documents pre-generated-proof exfiltration and nonce as the mitigation; permanently forbidding "XSS-resistant" for DPoP alone, and requiring nonce for the off-device claim, is the honest reading. The non-extractable `CryptoKey` structured-clone note is factually right.
- **D4's two-topology framing is a good decision.** Recognizing the single serialized authority (LLP 0040's Durable Object, 0040 line 89) as trivially conformant avoids punishing the safer design, and the pre-commit-fence-before-provider-transaction ordering requirement correctly generalizes the local implementation. The level-triggered restatement of LLP 0053's obligations matches 0053 (lines 88, 792-883).

## 3. Concerns

**1. MATERIAL (decision quality / safety) — D2's strict-transport escape hatch breaks the closed-fact design it feeds.**
Evidence: D2 states "HSTS — or a target-native equivalent … — is part of the `externalTls = enforced` attestation, **or its exclusion is recorded with a justification on the attesting target**." The machine-readable axis is a two-value enum (`unavailable | enforced`; src/auth/deployment.rs:39-43, schemas/auth.hosted-capabilities.schema.json), and D5 derives `deploymentReady` from the enum alone. So two targets can both attest `enforced` while differing on the first-visit/SSL-stripping window, with the difference living in prose the derivation cannot see — directly against D5's own rule that "Unknown, advisory, operator-asserted, or target-inapplicable values are not truthy aliases." Neither of D5's two derived facts describes a browser-free deployment where the exclusion would be harmless: hosted-auth readiness is browser-facing by definition, and the bearer-v1 compatibility request is *also* browser-facing.
Resolution criterion: delete the escape hatch, or make the exclusion machine-visible (a distinct enum value or separate strict-transport axis, with matrix coverage) and state explicitly whether it blocks `deploymentReady` or forces D5's named compatibility request.

**2. MATERIAL (coherence / enforcement completeness) — the Acceptance section does not enforce all of the document's own named obligations and round-2 normative additions.**
Evidence: (a) Of the four named defect obligations, only the detached-loopback bypass and the issuing-path opaque-failure rule have acceptance rows; the descriptor not-applicable extension (D5) and the structural browser/headless custody split (C1) have none — while the descriptor gap is live in committed artifacts today (cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json publishes `processLocal`/`singleProcess`/`bearerV1XssExposed` alongside `authProtocols: null`, `supportedAuthModes: ["dev"]`). (b) D5's layer 2 and layer 3 are new normative requirements ("Serving admission consumes this, not the static profile"; "Loss of a required health fact withdraws serving") with no hosted acceptance rows. (c) C2's hosted operator-origin separation is a MUST with no acceptance row. (d) No defect obligation carries a tracked-owner reference in the document; completed work cites ENG-24607/24986/24996, but the four open security obligations cite nothing (the Status section points to a review ledger this blind review cannot consult — if owners exist there, the contract should surface them). In a repository with a concurrent agent fleet, untracked security obligations have concrete drift risk.
Resolution criterion: add acceptance rows for the two uncovered defect obligations, D5 layers 2–3, and C2's origin-separation MUST; reference a tracked issue (or the ledger's IDs) for each named defect obligation.

**3. MINOR (feasibility / conformance sharpness) — D4's completion bound leaves lease duration unbounded.**
Evidence: "Revocation-class operations do not report complete until every live replica is fenced **or its lease has expired**" (D4). Nothing requires the maximum lease duration to be bounded or disclosed, so a target with pathological leases (hours) conforms while logout takes hours to report complete — a bound in name only, and in tension with LLP 0059's two-phase revocation ergonomics that this document consumes.
Resolution criterion: require the serving-lease maximum to be a bounded, disclosed deployment fact (or bound revocation-report latency directly) in D4 and its acceptance row.

**4. MINOR (safety residual, unnamed) — the mandated per-subject bucket creates a targeted-lockout vector the contract does not acknowledge.**
Evidence: D3 requires the per-subject/destination bucket, and the hosted acceptance row requires the set to "hold under … identity spray (many sources, one subject)." Refusing many-source convergence on one subject necessarily means an attacker can exhaust a chosen victim's subject bucket from anywhere and block that victim's own challenge issuance for the window — the classic throttle-vs-account-lockout-DoS tension. The document, which is otherwise scrupulous about naming residuals (C1's `sbcc_` paragraph, C3's active-XSS residual), is silent here.
Resolution criterion: name the targeted-subject-exhaustion residual in D3 and require the attesting target to document its recovery posture (window bounds, clean-source allowance, or operator path).

**5. MINOR (feasibility) — D3's atomicity requirement reads stronger than the safety need.**
Evidence: "acquired atomically (no partial charge that a concurrent attempt can slip past)" over a set that always includes the app-global backstop implies a cross-bucket serialization point or distributed transaction per attempt. The actual safety property is one-directional: admission requires all-admit at charge time; a partial charge left behind by a *refused* attempt only over-counts, which is fail-closed and should be explicitly acceptable.
Resolution criterion: restate the requirement directionally (all-admit-or-deny, conservative leakage permitted) so a conforming shared limiter does not need multi-key transactions.

**6. MINOR (cross-reference) — D6 omits the marker's wire-schema owner.**
Evidence: LLP 0039 states the marker's wire schema is registered by LLP 0051 D4 ("LLP 0051 D4 registers the marker's wire schema; the hosted contract owns deployment ordering and proof", 0039 companion item 8). LLP 0060 D6 cites LLP 0039 and 0058 but not 0051, and 0051 is absent from the Related header — a reader implementing D6 cannot find the wire schema from this document.
Resolution criterion: cite LLP 0051 D4 in D6 and add LLP 0051 to Related (or correct LLP 0039 if the registration moved).

**7. EDITORIAL — the Revised header is a ~500-word single field duplicating the changelog.**
Evidence: the header's round-2 entry restates D1–D6/C1–C3 dispositions that the changelog and Status section already carry. It is nearly unscannable and will only grow.
Resolution criterion: compress each Revised entry to date + one-line summary; let the changelog own detail.

**8. EDITORIAL — C2 names the inline-style admission but not its residual.**
Evidence: `style-src 'self' 'unsafe-inline'` is shipped (src/server.rs:4161) and the document notes the admission, but unlike every other admitted weakness it does not name the residual (CSS-based exfiltration channels on the operator surface).
Resolution criterion: one clause naming the residual, in the document's established style.

## 4. Suggestions

- **Encode the unforgeable posture as a typestate, not a validated value.** For the D1 obligation, make the sessions-capable router constructible only from a `BoundListenerPosture` (or similar) token minted by the code that bound the socket, with `detached()` returning a type that cannot reach sessions routes at all. That turns the pinned rule into something the compiler enforces and makes the bypass test almost redundant. Also add a migration note for current `detached()` consumers (e.g., src/admin.rs:1225) whose sessions behavior will change from loopback-open to fail-closed.
- **Bind D5's layer-2 attestation into issuance.** Stamp issued session families (or the serving lease) with the deployment-bound attestation hash so a configuration rollback that loses a fact doesn't merely block *new* admission but visibly invalidates serving state minted under the stronger attestation. This connects layers 2 and 3 with one mechanism and gives the freshness epoch teeth.
- **Answer the operator-acceptance-artifact open question with the same machinery:** make the bearer-v1 compatibility acceptance a signed deployment-config fact inside the layer-2 attestation (deployment identity + config hash + residual acknowledgment), surfaced in deployment facts and UI — rather than inventing a separate console-acknowledgment channel.
- **Consider a `notApplicable` TLS story while extending the axes.** When adding the not-applicable values for the three non-TLS axes (the named D5 companion obligation), decide whether `externalTls` needs one too for targets with no serving surface, so the schema change happens once.
- **State D3's bucket-set as data, not prose,** in the eventual capability/attestation output (which buckets, normalization, failure policy), so acceptance can assert the set instead of re-deriving it from text.

## 5. Open questions

Beyond the document's own (which are good), the review surfaces these:

1. Is there any legitimate use of the strict-transport exclusion inside D5's two derived facts? If not, why keep the escape hatch at all? (Concern 1.)
2. What is the maximum serving-lease duration a conforming D4 topology may use, and is it a disclosed deployment fact? What revocation-completion latency does logout promise the user? (Concern 3.)
3. What is the recovery posture when an attacker deliberately exhausts a victim's subject bucket — bounded window only, clean-source allowance, or operator intervention? Who decides per target? (Concern 4.)
4. Who owns each of the four named defect obligations, and where are they tracked? (Concern 2.)
5. When detached/unknown posture becomes fail-closed for sessions, what happens to existing detached-construction consumers and embedded test harnesses that currently rely on loopback-open defaults?
6. For D6, does the marker version negotiation ever need to be per-deployment rather than per-build (a platform reviving a stale handler *build* is refused by incarnation — but what refuses a stale *configuration* of a current build)? D5 layer 2's configuration hash suggests an answer worth stating.

## 6. Readiness verdict

The implemented-boundary half of this document is in excellent shape — every decisive claim I verified against src/, packages/, demos/_kit/, admin-ui/, and cloudflare/ held, including the deliberately unflattering ones, and the future contract is pitched at the right altitude with genuinely good decisions (conjunctive readiness, two-topology D4, permanent claim-naming rules). Two MATERIAL concerns block readiness: the strict-transport escape hatch that lets a prose annotation weaken the flagship machine-readable conjunction (Concern 1), and the incomplete enforcement surface for the document's own named obligations and round-2 additions (Concern 2). Both have cheap, well-defined resolutions; with them addressed, the remaining MINOR/EDITORIAL items are non-blocking polish.

READINESS VERDICT: NOT READY
### Orchestrator disposition (round 2, outside the verbatim body)

Spot-checks: the review confirmed every round-2 implemented-boundary claim
against shipped code (D1 forgeable-posture gap, D5 descriptor/gate, C1 custody
matrix incl. sbcc_ localStorage + 10-min TTL, the named issuing-path gaps).

Disposition: Concern 1 (D2 strict-transport escape hatch) → removed; HSTS is a
required component of `externalTls = enforced`, no prose-exclusion alias.
Concern 2 (acceptance incomplete) → added rows for both preflight domains, the
capability+attestation+health+D6/operator-origin readiness conjunction, health-
withdrawal, the strict-transport requirement, the bounded lease state machine,
and operator-surface isolation. The strengths the review verified are preserved.

## Round 3 — 2026-07-14

**Revision under review:** `llp/0060-hosted-auth-security.rfc.md`, round-3 revision (working tree)
**Runtime detail:** fresh Claude Code workflow subagent (run wf_efece8b6-455), model claude-fable-5, reasoning effort max (explicit per-agent override); fresh context, blind to all archived reviews and to the concurrent GPT-family round; orchestrated by /llp-super-refine
**Verdict:** READY (no MATERIAL concerns; verified every implemented-boundary claim against code; remaining concerns MINOR — D5 terminology, the LLP 0051 marker-schema pointer, wording hygiene)

### Review body (verbatim)

All verification is complete. Here is my review.

---

# LLP 0005 Review — LLP 0060: Hosted auth deployment and client-page security (RFC, Draft)

**Reviewer:** Claude (Fable 5), independent blind review — no prior reviews of this document were read; `llp/reviews/` was not opened (file names only confirmed to exist).
**Reviewed revision:** the working-tree text of `llp/0060-hosted-auth-security.rfc.md` at repo HEAD `d5d8095` (the file carries ~493 uncommitted inserted lines over its last committed state — the round‑2/round‑3 revisions are in the working tree, not yet landed).
**Verification method:** every decisive as-shipped claim was checked against `src/`, `packages/`, `demos/_kit/`, `admin-ui/`, `schemas/`, `cloudflare/generated/`, and the governing LLPs (0039, 0040, 0051, 0053, 0057, 0058, 0059, 0047, 0012).

## 1. Overall assessment

This is a strong, unusually honest security RFC. Its central move — separating what the local target *enforces today* (plaintext fence, capability descriptor, must-understand hosted refusal, CSP baseline, credential sentinels) from the hosted edge facts and browser v2 posture that *do not exist yet*, and refusing to let any current target advertise the latter — is correct, clearly argued, and, critically, **accurate to the code**. I verified every load-bearing implemented-boundary claim and found no case where the document asserts a protection the code does not deliver; where the code falls short of the contract, the document already names the shortfall as a defect obligation, and each named shortfall is real:

- D1's forgeable middleware posture input: `ServerContext::new(host, port, loopback)` takes an independent caller-supplied boolean and `detached()` hardcodes `loopback: true` (src/admin.rs:438–443, 457–462); the request-level fence trusts it (src/server.rs:4575). Exactly as the document says, the defense-in-depth defends nothing on the embedded path it exists for.
- C1's issuing-path gaps: both the kit and the shared admin client embed a redacted body snippet in 2xx parse-failure diagnostics (demos/_kit/client.mjs:1547–1555; packages/snapback-admin-client/index.mjs:128–129), and `authRequestCode()` returns server JSON unprojected on both its paths (demos/_kit/client.mjs:1571–1585; `markAuthorityCapture` only tags, never projects).
- D5's descriptor honesty gap: the dev-only Cloudflare manifest (supportedAuthModes: `["dev"]`) publishes `processLocal`/`singleProcess`/`bearerV1XssExposed` despite having no auth surface (cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json:8–26).

The implemented positives also check out: the pre-bind fence and its exact matrix (src/admin.rs:121–146, src/cli.rs:305–320, 1581), the hosted-flag validation ordered before database-path creation (src/cli.rs:1297–1304), the five-axis closed descriptor with `deny_unknown_fields`, fail-closed `#[serde(default)]` on an absent `hostedAuth`, the 32-case matrix, and the five-fact `hosted` gate (src/auth/deployment.rs; src/manifest.rs:2809–2810; tests/artifact_schemas_v0.rs:841–875), the bearer-free `settledView()` and narrow `credentialFor` accessor (packages/snapback-contract/auth-coordinator.mjs:514–538), exact-204 logout with captured-authority clear and opaque body-read-failure facts (demos/_kit/client.mjs:1503–1518, 1686–1716), the `sbcc_` master-anywhere rejection including canonical-string `expiresAtMs` across kit/admin/setup (packages/snapback-admin-client/index.mjs:259–286; src/admin/setup.html:106–116), and the CSP baseline with response-specific hash preservation and the real-Chromium Trusted Types sink proof (src/server.rs:4111–4164, 16019–16096; admin-ui/tests/acceptance/csp-browser.mjs:223–249).

Corpus consistency is likewise sound after round 3: D6 now matches frozen LLP 0039's preflight-before-all-DDL requirement byte-for-byte in substance (llp/0039:205–214), LLP 0058 explicitly delegates exactly what D6 owns (llp/0058:99–103), D4 reproduces LLP 0053's durability matrix faithfully (llp/0053:902–916), and the D4 single-authority topology matches LLP 0040's shape. The hosted-contract sections (D2–D6) are future-facing and internally coherent, with the deliberately deferred constants and authorities named rather than hidden.

The remaining concerns are minor: one internal terminology split D5 half-acknowledges, one cross-corpus pointer omission (LLP 0051 D4 owns the marker wire schema per 0039, which 0060 leaves "unowned"), and history/wording hygiene. Nothing rises to MATERIAL.

## 2. Strengths

- **Claim honesty as a design principle, enforced structurally.** The two derived facts (deployment readiness vs. hosted-auth readiness, §D5) with the pinned rule that CSP cannot upgrade bearer v1 (§Summary, §C2), and the permanent prohibition on "XSS-resistant" for DPoP alone (§C3) — the strongest part of the document, and reflected in code comments (src/auth/deployment.rs:75–78).
- **The carrier-by-carrier custody matrix (§C1).** Replacing universal "never anywhere" claims with named permitted locations per credential class, including the deliberately embarrassing rows — the `sbcc_` `localStorage` record with its own honesty paragraph, and the headless direct-bearer seam. This is exactly how to make sentinels testable; the acceptance section's sentinel rows mirror the matrix rather than pretending the exceptions away.
- **Named defect obligations verified real (§D1, §C1).** The document's willingness to say "the shipped gap is X, here is the file, here is the acceptance row that closes it" — and each one checks out in code — makes it a trustworthy contract rather than an aspiration.
- **The opaque-failure rule for credential-issuing endpoints (§C1).** The insight that redaction can only replace secrets the client already knows, so a newly issued credential in a malformed 2xx defeats any redaction set, is the sharpest security observation in the document and correctly generalizes across exchange, refresh, console mint, and challenge request.
- **D4's two conforming topologies with the bounded lease machine.** Naming "while it knows it is behind" as non-conforming, admitting the single serialized authority as trivially conforming (so the safer design is not punished), and bounding the lease state machine (max lifetime, skew, durable epoch, no-renewal-after-fence, admission, rollback) turns a vague "convergent invalidation" axis into a checkable guarantee. Flagging `multiReplicaConvergent` as a semantic misnomer with a companion rename is the right altitude.
- **D6's two preflight domains.** The startup-vs-per-invocation split resolves the real question ("a per-invocation marker cannot guard constructor effects") without weakening frozen 0039 — and 0039:205–214 confirms the round-3 correction was necessary and is now faithful.
- **Layered readiness (§D5).** Capability / deployment-bound attestation / live health, with D6 and C2 as closed admission inputs and health loss withdrawing serving, anticipates the classic failure of static capability manifests attesting runtime facts.

## 3. Concerns

**1. MINOR — D5 uses "deployment readiness" for two different predicates and claims it doesn't.**
Evidence: §D5 opens "Two derived facts, named consistently everywhere in this document: **deployment readiness** is the conjunction of the four deployment facts" and later says "`deploymentReady` is derived from the first four exact positive values"; but §Summary decision 2 requires the four facts "**plus** the mixed-version coordinator-to-handler boundary (D6)" for deployment readiness, §D6 calls itself "a positive prerequisite of deployment readiness," and D5's own `*Capable` paragraph redefines `deploymentReady`/`hostedAuthReady` as "the admission-time conjunctions of capability **and** attestation **and** health **and** the D6/operator-origin gates." The shipped `deployment_ready()` (src/auth/deployment.rs:120–131) implements only the static four-enum layer, which the document flags as a rename obligation — but the document's *own text* still uses the one term at both layers while asserting consistent naming.
Resolution criterion: D5 gives the static four-enum derivation and the admission-time predicate distinct names in its own text (e.g., `deploymentCapable` vs. deployment readiness), rewrites the two sentences that bind "deployment readiness"/"deploymentReady" to the static derivation, and drops or qualifies "named consistently everywhere."

**2. MINOR — The marker wire-schema owner is already assigned by frozen LLP 0039, but 0060 treats it as open and never cites LLP 0051.**
Evidence: LLP 0039 landing item 8 (llp/0039-auth-vertical-slice.rfc.md:1638): "LLP 0051 D4 registers the marker's wire schema; the hosted contract owns deployment ordering and proof." LLP 0060 §Status lists "the marker schema owner/wire form" among remaining implementation-altitude obligations, §D6 never mentions LLP 0051, and LLP 0051 is absent from the Related header. A D6 implementer following only 0060 could invent a second schema-registration mechanism parallel to LLP 0051 D4's drift-gated machinery.
Resolution criterion: D6 (or §Status) cites LLP 0051 D4 as the registration mechanism for the marker's wire form and LLP 0051 is added to Related — or the author records why 0039's assignment no longer holds.

**3. MINOR — The Revised header and the Changelog have diverged; the 2026-07-14 rounds exist only as a ~40-line header paragraph.**
Evidence: the Revised header (document lines 8–41) carries the full substance of round 2, round 3, ENG-24996, and ENG-24986; the §Changelog stops at the five 2026-07-13 entries. The header is now the least readable part of the document and the only record of its most consequential revisions, contrary to the corpus convention of dated Changelog entries with a compact header.
Resolution criterion: the 2026-07-14 revisions get dated Changelog entries and the Revised header shrinks to dates plus one-line summaries.

**4. EDITORIAL — Diagnostics section omits the "reserved" qualifier on two unimplemented codes.**
Evidence: §Diagnostics marks the three `SNAPBACK_AUTH_SENDER_PROOF_*` codes "reserved for the v2 protocol," but lists `SNAPBACK_AUTH_SOURCE_UNTRUSTED` and `SNAPBACK_AUTH_INVALIDATION_LAGGING` unqualified. Neither appears anywhere in `src/`, and LLP 0012:704 explicitly classes both as "reserved hosted/v2 … the local bearer-v1 target must not emit these as implemented capability."
Resolution criterion: both codes carry the same reserved-for-hosted qualifier as the sender-proof family, matching LLP 0012.

**5. EDITORIAL — "currently failing" misdescribes the issuing-path acceptance rows.**
Evidence: §Acceptance/Browser custody says the issuing-path opaque-failure cases are "(currently failing; the named defect obligation in C1)." No such tests exist to fail (no opaque-failure poison tests under demos/_kit/tests/); the shipped suites pass. The intended meaning is that the *behavior* does not yet satisfy the rows and the tests land with the fix.
Resolution criterion: reword to "currently unmet (tests land with the C1 defect-obligation fix)" or equivalent, so no reader expects red tests in the repo.

## 4. Suggestions

- In §D1, consider stating what the unforgeable listener-construction token looks like at one sentence of detail (e.g., a type only the binding code can construct, carried by `ServerContext`) so the defect-obligation fix has a pinned shape rather than two admissible designs ("actual bound socket address" vs. "token") with different embedded-composition implications.
- §D5's not-applicable-axis obligation could name the schema-versioning consequence explicitly (adding `unavailable` to three enums changes `auth.hosted-capabilities.schema.json` and every committed manifest) so the companion change is costed.
- §C3's protocol inventory is excellent; consider adding the operator `sbcc_` credential's interaction with v2 (does the console surface get sender constraint, or is it permanently excluded and covered only by C2 origin isolation?) to the "every protected credential class" list — it is currently implied by "console credentials" but the `localStorage` carrier makes it the interesting case.
- The Status section's claim that dispositions "live in the review ledger alongside the verbatim reviews" would benefit from naming the ledger file explicitly, as the reviews directory otherwise contains only per-model artifacts.

## 5. Open questions

- The reviewed text is uncommitted working-tree state (~493 inserted lines over the last committed revision, at HEAD `d5d8095`). Given the concurrent-session fleet pushing to main, does the author intend to land the round-3 revision promptly so reviews and text reference the same committed bytes?
- D4's normative lease maximum is "on the order of seconds" with exact constants deferred. Is the intent that the first hosted target's spec (not this RFC) pins the numbers, and if so should the acceptance row say "the target's pinned constants" rather than implying this document supplies them?
- The document's four listed open questions are well-chosen; of them, the operator-acceptance artifact shape (D5's bearer-v1 compatibility request) is the one a first hosted product hits immediately — does the author want it resolved before Accepted, or explicitly deferred to that product's LLP?

## 6. Readiness verdict

All decisive as-shipped claims verified against the code are accurate; the future-facing contract is internally coherent and consistent with LLP 0039 (frozen), 0053, 0058, 0059, and 0040 after the round-3 corrections. The five concerns above are MINOR or EDITORIAL — clearly-labeled polish, none blocking. No unresolved MATERIAL concern remains. The document is ready to leave the refine loop; Draft status pending author ratification remains the correct label, and nothing in this review ratifies it on the author's behalf.

READINESS VERDICT: READY

## Final implementation review — 2026-07-15

### Provenance

- Reviewer family: Anthropic Claude
- Provider/runtime: Claude CLI, model `claude-fable-5`
- Method: read-only Plan mode; high effort; no session persistence; blind to `llp/reviews/`
- Reviewed commit: `62a11cedfb1ff7ad0258dc3e6ce667989b88b819`
- Human authorization: ENG-24996 completion request
- Secrets or redactions: none

### Verbatim review

# LLP 0005 final review — LLP 0060 (hosted-auth deployment and client-page security), committed HEAD 62a11ce

Reviewed blind against the full document, the governing/related LLPs (0039, 0040, 0053, 0058, 0059, 0000), and the current code and tests for every decisive implemented-boundary claim. Nothing under `llp/reviews/` was read.

## Overall assessment

This is a strong, near-ratifiable revision. The post-ENG-25001 text is disciplined about the distinction that sank earlier drafts — what is implemented versus what is future contract — and nearly every decisive implemented-boundary claim I checked is true in code, with real regression tests behind it. The cross-document reproductions are faithful. One implemented-boundary sentence in D5 is factually wrong about the code and internally contradicts the paragraph that follows it; that alone blocks readiness.

## Strengths

- **D1 posture claims verified end-to-end.** The pre-bind sessions refusal with no override, the private `ListenerTransportPosture::Unknown` on detached/caller-described contexts, fail-closed unknown posture with `/health` preserved, the listener-consuming `app(state).bind(listener)` API with private inseparable listener/router, and the real `0.0.0.0` detached-router bypass regression all exist as described.
- **D5's honest naming is real.** `deployment_capable()`/`hosted_auth_capable()`, closed enums with `Unavailable`, the drift-gated generated schema, the 32-case conjunction matrix, and `--auth-deployment hosted` refusal ordered before any database/provider/listener effect all match.
- **C1's implemented custody claims verified on all three client surfaces.** Issuing-path opaque failures, the exact `{challengeId, expiresAt}` projection, exchange/refresh secret-position exclusion, exact-empty-204 logout with body-read-failure barrier and peer-successor preservation, console-mint master-substring rejection including the one-byte `sbcc_` prefix collision and canonical numeric `expiresAtMs`, and floor-free numeric-position redaction all have code plus poison tests.
- **The custody matrix's candor is a feature.** Naming the `sbcc_` `localStorage` record and the headless direct-bearer seam as intentional carriers, instead of asserting universal non-exposure, matches what the code actually does and is verified by sentinels.
- **C2's CSP/Trusted-Types evidence is executable and byte-exact:** response-specific inline hashing, fallback-policy preservation, and the headless-Chromium intentional-`innerHTML`-TypeError probe.
- **Cross-document fidelity.** D6's restatement of frozen 0039, 0053's matrix, 0059's temporal protocol, 0058's delegation, and 0040's per-app Durable Object shape are faithful. The document consistently refuses to self-ratify.

## Concerns

**MATERIAL-1 — D5's absent-descriptor honesty rule misstates the implemented default and contradicts its own next paragraph.** The doc says "an absent `hostedAuth` field deserializes to the **all-unavailable**, bearer-v1 local posture." The implemented default is `local_target()` — `externalTls`/`effectiveSource` unavailable but `authenticationThrottle: processLocal`, `sessionInvalidation: singleProcess`, `clientCredentialPosture: bearerV1XssExposed`. All-unavailable is the distinct explicit constructor `no_auth_target()`, which the Cloudflare manifest sets by hand. The next paragraph explains why the difference matters. Additionally, an absent individual field is a deserialization error, not a fail-closed `unavailable`. The fail-closed conclusion survives, but a decisive "already implemented" claim is false as written. **Resolution:** restate the rule accurately — absent whole `hostedAuth` defaults to the bearer-v1 local posture; all-unavailable is the separate explicit `no_auth_target` posture required of no-auth targets; absent individual fields are rejected by the closed schema; both defaults remain hosted-non-capable.

**MINOR-1 — Acceptance overstates `ref-check`'s coverage.** "Diagnostic inventory and `ref-check` include the transport code and both enforcement references" reads as if `ref-check` validates diagnostic codes; it validates `@ref` annotations only, and the served-diagnostic inventory lives in LLP 0012. **Resolution:** reword the bullet to attribute the inventory to LLP 0012 and scope `ref-check` to the enforcement `@ref`s, or add the cross-check.

**MINOR-2 — "Poison tests cover malformed text" is uneven on issuing paths.** All three clients handle a non-JSON 2xx on issuing paths in code, but the dedicated issuing-path poison suites emphasize reader failures and shape/position poisons. **Resolution:** add one malformed-text 2xx issuing-path case per surface, or narrow the sentence to what the suites prove.

**MINOR-3 — Related-header reciprocity gap.** LLP 0059 does not list LLP 0060 in its `Related` header, though 0060 reproduces 0059's temporal protocol and lists it. **Resolution:** add LLP 0060 to 0059's `Related`.

**EDITORIAL-1 —** C1's "Error object property names are sanitized too" implicitly covers "kit, shared admin, and embedded setup alike," but the setup page's sanitizer redacts only message and code strings — vacuously adequate for its flat error shape, yet the sentence's scope should be limited or the shape constraint stated.

**EDITORIAL-2 —** The `Revised:` header has grown into a ~50-line narrative that duplicates the Changelog; consider compressing it to dates plus one-clause summaries and letting the Changelog carry detail.

## Readiness verdict

**NOT READY.** MATERIAL-1 is a single false implemented-boundary sentence in D5's fail-closed honesty rules; once that sentence is corrected to match `src/auth/deployment.rs`, and ideally MINOR-1's `ref-check` attribution alongside it, nothing else I verified stands between this document and author ratification. This review is advisory only; Status remains the author's to change.

## Blind final cross-family review — 2026-07-15

### Provenance

- Reviewer family: Claude Fable
- Provider/runtime: Claude Code 2.1.210
- Model: `claude-fable-5`
- Method: read-only plan-permission CLI; blind to `llp/reviews/`
- Session: `a2864db9-0e4e-46be-9e7a-ce98af729ec4`
- Reviewed commit: `8f03e42`
- Human authorization: ENG-24996 completion request
- Secrets or redactions: none

### Verbatim review artifact

# Blind final implementation review — llp/0060-hosted-auth-security.rfc.md @ 8f03e42

## Context
Read-only blind final review requested (no llp/reviews reads, no file changes). Deliverable is the ≤700-word review. Work performed: full read of LLP 0060; three parallel verification sweeps (server D1–D6/descriptor; client C1–C2; cross-document ownership across 0011/0012/0039/0051/0053/0057/0058/0059); direct inspection of the 8f03e42 reentrant-resume fix and its composed Contract regression; executable acceptance (6 contract/kit JS suites, 2 admin sentinel suites, 3 Rust descriptor tests, ref-check — all pass).

## Final review (delivered in chat)

VERDICT: READY. MATERIAL: none. MINOR: (1) non-exact reentrant reload asymmetry in auth-coordinator.mjs (transition-initiated resume can nest a peer-adoption barrier, clobbering `#activeBarrier` and leaking the owner barrier's completion — narrow pre-existing race, fail-closed at credential use); (2) fast-path null durable read miscodes absent custody as "corrupt" (auth-coordinator.mjs:700); (3) LLP 0059:1997-1999 composed-Contract sentence overstates determinism (reload is setTimeout(0)-scheduled, index.mjs:2212-2216; deterministic proof is auth-coordinator.test.mjs:412-491); (4) 0060 acceptance "both enforcement @ref annotations" undercounts (14 exist, all pass ref-check); (5) browser-security Chrome acceptance verified present but not rerun here (RFC frames it as rerunnable, consistent).

No further action unless the user asks me to file the minors or apply fixes.

## Final blind review — 2026-07-15 (`3ac0473`)

### Provenance

- Reviewer family: Anthropic Claude Fable
- Provider/runtime: Claude Code 2.1.210, model `claude-fable-5`, read-only plan permission
- Method: independent blind final review; no access to `llp/reviews/`
- Session: `60006000-0000-4000-9000-000000000160`
- Reviewed commit: `3ac047322d055fad03e8308fdc0905d758eb9f61`
- Source artifact: `/private/tmp/eng25001-final2-fable-0060.md`, sha256 `1e0286df82d836b9f437ac1974fc50b99e2c6790434c7a1f177314951d22069b`
- Human authorization: ENG-25001 completion request
- Secrets or redactions: none

### Verbatim review

All verification is complete. I've read LLP 0060 end-to-end, traced both delayed synchronize-result cuts through the four fix commits and their regression tests, verified the ENG-25001 claims in 0060/0059/0058/0057 against the Rust and client implementations, and confirmed one defect introduced by 3ac0473 itself.

VERDICT: NOT READY

MATERIAL:
- Severity: high (fail-closed liveness regression + spec-contradicting diagnostic, introduced by the commit under review). 3ac0473's new `localAtRead` bookkeeping in `synchronize()` (`packages/snapback-contract/auth-coordinator.mjs:733-740`) unconditionally computes `canonicalAuthorityKey(this.#appId, this.#record.authority)` when local and durable state diverge, but a local record in `clearing` phase has `authority: null` (enforced by `validateAuthCustody`, auth-coordinator.mjs:356), so `normalizeClientAuthority(null)` throws `SNAPBACK_AUTH_CUSTODY_CORRUPT` (auth-coordinator.mjs:141-143). Exact failure scenario: a transition barrier fails mid-phase (`#finishClearingOwned` catch leaves `#record` as the clearing record, auth-coordinator.mjs:1166, 1206-1215 — the state the committed crash test at `packages/snapback-contract/auth-coordinator.test.mjs:736-774` deliberately creates), a peer context then recovers durable custody to `settled` first, and the failed context's next `synchronize()` (wakeup, `pageshow`, or online boundary per LLP 0059:1374-1380) reads valid settled durable custody, enters the adopt branch (revision mismatch), and throws CORRUPT from the `localAtRead` computation — permanently, on every retry, so the context can never adopt the recovered successor (`waitForNewerRevision` rethrows CORRUPT as fatal, auth-coordinator.mjs:973-976). Before 3ac0473 this exact path recovered cleanly via `#adoptPeerSettled`. This contradicts LLP 0059's closed CORRUPT enumeration ("Malformed shapes … or a revision/epoch regression", 0059:1281-1284) and diagnostics table (0059:1844: CORRUPT means durable custody invalid, prescribing "explicit recovery" — i.e., clearing a store that is actually valid and holding a live peer session; 0059:1843 pins `SNAPBACK_CLIENT_AUTHORITY_STALE` for stale local completions), and it breaks acceptance item 8's "idempotent recovery continues from durable state" (0059:2004-2007). No committed test covers the peer-recovers-first ordering (the IndexedDB owner-loss suite closes the failed owner before recovery, `packages/snapback-contract/auth-custody-indexeddb.test.mjs:340-420`), and the adoptPeer-path post-barrier fence generally has no regression test (the 3ac0473 test exercises only the plain-capture path). Resolves it: guard the `localAtRead` authority-key computation on `this.#record.phase === 'settled'` (null otherwise, with the mismatch then failing as STALE or proceeding to peer adoption), plus a regression test for failed-barrier → peer-recovery → same-context `synchronize()`, and a test for the adoptPeer-path post-barrier fence.

MINOR:
- `#finishClearingOwned`'s catch sets `this.#activeBarrier = null` before building the `SNAPBACK_AUTH_TRANSITION_FAILED` details from `this.#activeBarrier?.phase` (`packages/snapback-contract/auth-coordinator.mjs:1206-1215`), so the reported phase is always `'unknown'`. Pre-existing diagnostic-quality bug; read the phase into a local before clearing the barrier.
- Evidence-inventory drift: baaf890 and 3ac0473 landed the two delayed-delivery fences and their regression tests with no LLP 0059 update — the normative rule covers the behavior (0059:1390-1402), but neither the revision header (0059:8-12, last touched in 5c23b44) nor the acceptance evidence (0059:2024-2031) names the delayed-completion cuts or their tests (`auth-coordinator.test.mjs:602`, `:662`), unlike every other fix in this series. Suggested: one acceptance/changelog sentence naming both delayed-delivery cuts and their fixtures.
- The same-authority early-return in `transition()` (auth-coordinator.mjs:1030-1033, `#adoptSettled` with default `expose: true`) and in `establishAnonymous()` (auth-coordinator.mjs:679) can reopen publication while another local barrier is mid-flight if app code calls them during a barrier targeting the barrier's own successor; contrived (requires deliberate reentrant use LLP 0059 pins only for `synchronize()`), pre-existing. Suggested: pass `expose: !this.#publicationPaused` or assert no active barrier on those early returns.

EVIDENCE:
- Target document: the task's exact filename `llp/0060-hosted-auth-deployment-contract.spec.md` does not exist at 3ac0473 or anywhere in history; the only LLP 0060 is `llp/0060-hosted-auth-security.rfc.md` ("Hosted auth deployment and client-page security", renamed from 0058 per `git log --diff-filter=R`), read completely (all 1143 lines): Summary, Scope, Threat model, D1–D6, C1–C3, Diagnostics, Acceptance (local/hosted/browser-custody), Non-goals, Status/ENG-25001 closure, Changelog.
- Governing context read: LLP 0059 §Cross-context ownership (1353-1439), §Durable custody record (1216-1299), §Transition barrier (1457+), §Diagnostics (1826-1857), §Executable acceptance/Coordinator races (1977-2031), §Review triage/ENG-25001 (2139-2172), header (1-40); LLP 0058 and 0057 diffs in 5c23b44/baaf890; LLP 0024:8, 0051:603 (D4 anchor), 0012:640/735 (both diagnostic codes registered), root LLP 0000:9 ("LLP 0060 keeps hosted auth honestly disabled").
- Cut 1 (synchronize completing during resume): reentrant exact-or-stale path `auth-coordinator.mjs:688-713` (8f03e42, broadened in 5c23b44); during-barrier adoptPeer confirmation-only fence `:1227-1238` (5c23b44); during-barrier plain-capture fence (baaf890) now unconditional at `:1260-1277`. Tests: `auth-coordinator.test.mjs:412` (owner resume reload), `:450` (peer-adoption resume reload), `:492`/`:547` (changed-durable owner/peer resume → `SNAPBACK_AUTH_TRANSITION_FAILED`/`SNAPBACK_CLIENT_AUTHORITY_STALE`, resume runs once, later clean synchronize adopts), `:602` (delayed pre-barrier read delivered during held resume → STALE, capture stays CLEARING).
- Cut 2 (result completing after the resume barrier): 3ac0473 diff adds `localAtRead`/`publicationPausedAtRead` capture (`auth-coordinator.mjs:733-746`), `exact && !publicationPaused` confirmation fast-path (`:1239-1243`), `localUnchanged` stale fence (`:1244-1256`), and makes capture-result exactness unconditional post-barrier (`:1260-1277`). Test: `auth-coordinator.test.mjs:662-703` (delayed read delivered after the full successor barrier → STALE; settled capture intact; fresh synchronize returns settled). Spec rule: LLP 0059:1390-1402 ("exact record is confirmation only … mismatch fails stale"), landed in 5c23b44 before the code caught up in baaf890/3ac0473.
- Interaction verified: during-barrier deliveries are confirmation-or-stale before any participant effect; post-barrier deliveries are exact-or-stale; stale rejection precedes `#adoptPeerSettled` so no spurious blank/clearMemory; `#adoptSettled` monotonic guard (`:1485-1495`) remains the backstop; Contract/multi-live resume participants call `coordinator.synchronize()` inside the closed barrier (`packages/snapback-contract/index.mjs:2392-2402, 3906-3912`; composed once-only-resume proof in `auth-coordinator-contract.test.mjs:395-425`).
- LLP 0060 ENG-25001 claims verified in code: `deployment_capable()`/`hosted_auth_capable()` and 32-mask always-refuse-hosted test (`src/auth/deployment.rs:138-157, 212-223, 229-263`); `no_auth_target()` all-`unavailable` tuple and exact local default tuple (`:106-133, 265-277`) matching D5; closed blocker names incl. attestation/health/handler/operatorSurface (`:191-208`); CLI hosted validation after bind-name resolve, before database-path creation (`src/cli.rs:1479-1492`); issuing-path opaque failures in kit (`demos/_kit/client.mjs:808-816, 1589-1691`, exact `{challengeId, expiresAt}` projection), shared admin client (`packages/snapback-admin-client/index.mjs:100, 130, 229`), embedded setup; poison tests with freshly-issued credentials the client could not know (`demos/_kit/tests/auth-coordinator-client.mjs:185-330`; `admin-ui/tests/admin-client-credentials.mjs:207-291`; `admin-ui/tests/setup-credential-errors.mjs`); exact shipped admin headers `x-snapback-admin-token`/`x-snapback-console-credential`/`x-snapback-secret-read-lease` (`src/admin.rs`, `src/server.rs`, `src/admin_secret_read.rs`, `src/admin/setup.html`); D1/ENG-25000 posture (`src/admin.rs:379-528` `ListenerTransportPosture::Unknown`, `src/server.rs:8296-8331` `app(state).bind(listener)`/`BoundSnapbackApp`, `0.0.0.0` regressions `src/server.rs:17315-17554`).
- 0057/0058 follow-up claims verified: `Cache-Control: no-store, private` (`src/server.rs:4601, 15951`); auth-session wire schema pins UUIDv7 + `descriptorVersion: 1` (`src/auth/wire.rs:142, 380`); generic `AuthorityDescriptor` honestly broader `u32` (`src/manifest.rs:2423-2434`); commit-witness types present (`src/storage/auth.rs`, `src/storage/auth_mode.rs`).
- Both LLP 0059 and 0060 remain Draft with explicit no-self-ratification language (0060:1029-1031; 0059:2129-2131, 2170-2172); no status transition proposed here. Constraint compliance: `llp/reviews/**` never read/listed (all git commands used `':(exclude)llp/reviews'` pathspecs or explicit file lists); no secrets accessed; no repository mutation; review conducted blind from the working tree at `3ac047322d055fad03e8308fdc0905d758eb9f61` (clean status) and commit diffs c095370→3ac0473.

## FINAL3 blind review — 2026-07-15 (`bd7d1da`)

### Provenance

- Reviewer family: Anthropic Claude Fable
- Provider/runtime: Claude Code 2.1.210, model `claude-fable-5`, max reasoning effort, read-only plan permission
- Method: independent blind final review; no access to `llp/reviews/`
- Session: `70006000-0000-4000-9000-000000000160`
- Reviewed commit: `bd7d1da6d458439081a60c6fe06fe700edc678cf`
- Source artifact: `/private/tmp/eng25001-final3-fable-0060.md`, sha256 `c4fa7818014629c6174fff8e70e3a89e15957fd3e46c42b99446b0a3fb39ce48`
- Human authorization: ENG-25001 completion request
- Secrets or redactions: none

### Verbatim review

VERDICT: READY

MATERIAL:
- None.

MINOR:
- The kit's refresh superseded-recovery branch is now dead for HTTP-borne codes: `demos/_kit/client.mjs:1790-1797` recovers only on `SUPERSEDED_AUTH_CODES` (`client.mjs:382-385`), but every non-2xx `/auth/refresh` response is first collapsed to opaque `SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID` (`client.mjs:1642`), and nothing else throws those codes (none in `packages/snapback-contract/auth-coordinator.mjs`). Peer-tab rotation is still handled via `outcome.rotated === false` (`client.mjs:1783-1786`), and LLP 0060 mandates the opacity causing this, so it is not a 0060 mismatch — but server-signaled supersession no longer returns `{superseded:true}` or runs the family-alarm/compare-clear residual; worth author awareness re LLP 0059 interplay.
- Front-matter wording ("collapse to the same local opaque error") slightly overstates uniformity: kit read/non-2xx/parse/shape yield one identical error, but admin/setup shape failures yield a different fixed local error (`SNAPBACK_RESPONSE_INVALID`, `packages/snapback-admin-client/index.mjs:51-53,270-274`; fixed message, `src/admin/setup.html:260-262`). Normative C1 requires only "a fixed, opaque error", which all surfaces satisfy.

EVIDENCE:
- HEAD verified at `bd7d1da6d458439081a60c6fe06fe700edc678cf`, tree clean; read `llp/0060-hosted-auth-security.rfc.md` in full (1163 lines).
- Kit opacity: `demos/_kit/client.mjs:1609-1614` (body-read), `1641-1642` (non-2xx), `1657-1658` (parse) throw fixed `opaqueCredentialResponseError` (`816-826`, no response bytes/status); shape via `#validateCredentialResponse` (`1268-1280`); challenge success is exactly `{challengeId, expiresAt}` (`806-814`, `1685-1692`); exchange/refresh exclude request proofs, predecessor, and fresh successor from every string/numeric/property-name position (`754-797`, `1714-1720`, `1747-1753`).
- Kit poison tests: `demos/_kit/tests/auth-coordinator-client.mjs:149-155` (non-2xx body with fresh `UNKNOWN_ISSUED` in message, value, and property name), `324-352` (request-code/exchange read+extra+non-2xx; exact fixed diagnostic; serialized error free of both sentinels), `520-550` (refresh predecessor/successor poison, read, non-2xx; custody unchanged), `560-624` (logout exact-204/reflected/read-failure barrier).
- Shared admin mint: `packages/snapback-admin-client/index.mjs:99-101` (read failure on any status — FINAL3 changed `res?.ok` to `res`), `117` (non-2xx, FINAL3), `131` (parse) → fixed error (`230-240`); exact two-field projection plus master-anywhere rejection (`276-303`); tests `admin-ui/tests/admin-client-credentials.mjs:212-251` (2xx reader `UNKNOWN_SUCCESSOR`; non-2xx `UNKNOWN_ISSUED` with exact fixed message/diagnostic; persisted custody unchanged).
- Embedded setup: `src/admin/setup.html:266-270,280-294` (non-2xx/parse/read → fixed `credentialResponseError`), `104-119` (shape plus master exclusion incl. numeric `expiresAtMs`); tests run the real inline program in a VM: `admin-ui/tests/setup-credential-errors.mjs:180-239` (exact fixed DOM message; `UNKNOWN_ISSUED`/master absent; no storage write), plus collision/numeric-master/config cases.
- Executed on this commit: `node demos/_kit/tests/auth-coordinator-client.mjs`, `node admin-ui/tests/admin-client-credentials.mjs`, `node admin-ui/tests/setup-credential-errors.mjs` — all pass; all wired into runners (`scripts/verify-local-proof:129`, `admin-ui/package.json` test script, `scripts/check-package-test-inventory.mjs:79,85`).
- HostedAdmission: closed `deny_unknown_fields` struct with `operatorSurface`, `browserDirectBearerSeam`, five-fact `hostedAuth`, version pinned 1, sha256-hex, epochs ≥1, ≤5-minute lifetime (`src/auth/deployment.rs:213-277`); conjunction test with seam-available/operator-enabled/handler-v2/bearer-v1/lifetime negatives plus missing-field and unknown-field serde rejections (`deployment.rs:394-429`).
- Schema governance: registered in `artifact_schemas()` (`src/schema_export.rs:98-101`); committed `schemas/auth.hosted-admission.schema.json` closed (`additionalProperties:false`, all 14 fields required, closed enums incl. `excluded`); byte drift gate `tests/artifact_schemas_v0.rs:221-230`, round-trip `:1023-1026`, seam-specific schema test `:1073-1096` (Rust tests verified by inspection; cargo not run — build writes disallowed in this read-only session).
- Seam fact in conjunction/acceptance: D5 snapshot (`llp/0060:515-527`), three mandatory admission gates incl. C1 seam (`:486-501`), acceptance bullets (`:939-945`); refusal blockers include `browserDirectBearerSeam` (`deployment.rs:279-297`).
- Hosted serving disabled: `validate_auth_deployment` unconditionally refuses `hosted` (`deployment.rs:305-310`), asserted for all 32 capability masks (`:375`); CLI validates before database-path creation (`src/cli.rs:1480-1487`); embedded router returns 503 `SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED` with the exact ten-blocker list (`src/server.rs:17575-17619`).
- D5 defaults honest: absent `hostedAuth` deserializes to the exact local tuple (`src/manifest.rs:2987`, `deployment.rs:128-155`); `*Capable` helpers shipped (`deployment.rs:160,173`); no-auth `unavailable` tuple test (`deployment.rs:380-391`).
- Setup CSP hash: recomputed SHA-256 of the committed inline script equals updated `SETUP_SCRIPT_SHA256` (`src/server.rs:4607`); router test hashes the actually served bytes (`server.rs:17661-17674`).
