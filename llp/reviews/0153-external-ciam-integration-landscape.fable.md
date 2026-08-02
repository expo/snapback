# LLP 0153 external CIAM integration landscape review — Fable family

## Round 1 — 2026-08-02

**Reviewer family:** Anthropic Claude (Fable)
**Provider / runtime:** fresh Claude Fable 5 subagent (general-purpose, no
author context), orchestrated from a Claude Code session
**Date:** 2026-08-02
**Redacted:** no (repository access; no secrets in scope)
**Method:** mutually blind — capsule prohibited reading any `llp/reviews/`
artifact concerning LLP 0152 or 0153 and any super-refine journal; reviewer
confirmed compliance. SHA-pinned target and instruction capsule; corpus
checks against LLP 0011, 0077, 0151, 0053, 0059, 0150. Five external URLs
spot-checked via WebFetch (Convex auth overview, Clerk manual JWT
verification, WorkOS data syncing, Supabase third-party overview, Supabase
+ Clerk — all verified, one with a nuance recorded as finding 3). ~20 tool
uses (self-reported).
**Instruction capsule:** `capsule-0153-r1.md` (author-directed
conclusions-first priority)
**Target:** `llp/0153-external-ciam-integration-landscape.research.md`
(v0.1, 959 lines, Draft Research, untracked)
**Target SHA-256:** `88eb933c9dff3d747e018e1e5bbb0fa3689b89fe3c1ac10eef18211c57380488`
**Repo revision at review start:** `main` `67628399`
**Status:** completed
**Verdict:** READY

## Verbatim review

# Review — LLP 0153: External CIAM integration landscape (round 1)

## 1. Overall assessment

**Verdict: READY — by a moderate margin.**

The document's conclusions are sound and follow from the evidence presented. The Model A–D adjudication is the core of the deliverable, and it holds: Model A is dismissed on a verified corpus constraint (LLP 0077's hosted browser sessions really are sender-constrained v2, custody-key-bound at issuance — the bearer-token pass-through pattern genuinely cannot satisfy it), Model B's costs are stated honestly rather than hidden (two session layers, revocation lag, assurance-age propagation), and Models C and D are deferred/fenced for reasons that are correct in kind, not merely convenient. Every corpus claim I checked against LLP 0011, 0077, 0151, 0053, 0059, and 0150 is accurate, including the four load-bearing 0011 claims (stable principals, protected `_auth_*` custody, cross-provider email auto-linking opt-in only, no cascade-delete on provider deletion) and the characterization of LLP 0151's tier-2 "BYOP verified-token hook." All five external vendor claims I spot-checked via web verified cleanly, including the two that carry the most argumentative weight (Convex recommending Clerk/WorkOS/Auth0 for the complete feature set; Supabase's five named third-party providers, the 30-minute key-rotation window, and the deprecated Clerk symmetric-secret integration with exactly the three stated reasons). `[observed]`/`[inference]` labeling is used honestly with a few small lapses noted below. What keeps the margin at "moderate" rather than "wide": one missing consideration that should amend the recommended contract (finding 1), and a cluster of hygiene defects — most prominently a Related header where half the entries are unearned and a body-cited LLP is missing.

## 2. Strengths

- **§Integration architecture choices** is the best section: each model gets real advantages and real costs, the recommended Model B carries its two-session-layer cost forward into §Summary, the capability model, and the open questions rather than burying it — exactly what the capsule's "trade-off explicit in capabilities and doctor output" standard demands, and the document itself articulates that standard (0153:62–63).
- **§Terms** (the four-identity distinction: upstream subject / Snapback principal / organization / session) does genuine conceptual work and prevents the equivocation that sinks most third-party-auth designs.
- **§Recommended Snapback contract → Exchange endpoint** rules 1–6 are precise and each is defensible; rule 1 (never trust a discovery URL from the request) and the no-social-provider-token rule are correctly elevated to contract, not implementation notes.
- **§Principal creation** correctly refuses webhook-dependent provisioning, citing Clerk's own async warning — and this matches LLP 0011's Valet-proven rule verbatim ("success must not depend on a webhook racing in first," `llp/0011:118–119`).
- **§Organizations and roles** — the `ignore`/`identity-only`/`mirror-membership` triad with identity-only default, and treating an org switch as an LLP 0053/0059 auth-context change, is consistent with both governing documents (0053 is Accepted; 0059 is the client authority barrier protocol).
- **§Capability model** is the right mechanism for the document's own honesty requirement ("refuse to promise a feature the profile cannot prove") and the assurance example (no `auth_time` → no fresh-auth policy) is exactly right.
- **§Open questions** are genuinely open — none is answered in the body and smuggled back as a question, and OQ1 (session lifetime vs. external token expiry) honestly reopens the edge that Model B's "maximum policy bound" phrasing could have papered over.

## 3. Findings

1. **MATERIAL** — The recommended exchange contract omits abuse budgets on an unauthenticated verification-plus-JIT-provisioning surface. §Exchange endpoint (0153:414–427), §Security requirements (0153:675–742), and the §Acceptance gates Operations row (0153:908) cover token confusion, JWKS-refresh amplification, replay, and logging — but nothing bounds exchange-attempt rate, per-issuer principal-creation volume, or failed-assertion throughput. Rule 5 creates principals just-in-time, so anyone who can self-register at the app's upstream instance (trivially true for a Clerk development instance or a misconfigured allowlist) can mass-provision Snapback principals; garbage assertions also buy free signature verifications. The corpus treats this class as launch-gating, not hardening: LLP 0151 pins "**Abuse budgets** cover email sends, SMS sends/spend, password guessing, OAuth transaction creation, and account enumeration" (`llp/0151-first-party-identity-integrations.rfc.md:452–454`). *Resolve:* add an abuse-budget rule to the exchange endpoint list (or a seventh contract element), and an evidence row (or extension of the Operations row) in §Acceptance gates covering exchange throttling and JIT-provisioning quotas.

2. **DETAIL** — Related-header hygiene fails in both directions (capsule priority 4). The header (0153:9) lists **LLP 0001, 0039, 0057, 0060, 0064, 0096**, none of which appears anywhere in the body — six unearned entries. Conversely, **LLP 0150** is load-bearing in the body ("LLP 0150 owns the agent lane," 0153:600) but absent from the header. *Resolve:* add LLP 0150 to Related; for each of the six, either earn it with a body mention (0057 as the provider-protocol the external class extends, 0096 per suggestion 3 below, 0060 for hosted-auth security posture) or drop it.

3. **DETAIL** — `sts: pending` is mischaracterized as an "incomplete-registration case." "Manual validation also has an important incomplete-registration case: a valid token may carry `sts: pending`" (0153:348–350; also the Clerk table row, 0153:302). Spot-checked against the cited Clerk page: the token is minted when a user **has completed registration** but has not yet fulfilled a pending session task — currently, joining an organization when personal accounts are disabled. It is a pending-session-status case, not incomplete registration. The downstream recommendation (exchange rule 4 rejects pending states) survives unchanged. *Resolve:* reword to "pending-session case (unfulfilled session task such as organization selection)."

4. **DETAIL** — Evaluative inference inside an `[observed]` tag. "Convex's `ConvexProviderWithClerk` is the clearest precedent: it refetches tokens and keeps backend auth state synchronized rather than asking every app to write a race-prone effect. `[observed]`" (0153:434–438). The refetch/sync behavior is observed; "clearest precedent" and "race-prone effect" are the author's judgment. *Resolve:* split the tag or move the judgment outside it.

5. **DETAIL** — Untagged vendor-fact claims in §Impersonation and §Machine identities. "WorkOS includes an `impersonator` object and an `Impersonation` authentication method in relevant responses" (0153:588–590) carries no `[observed]` tag and no citation (the nearby 0153:358–361 citation covers the authentication-method claim but not the `impersonator` object), and "CIAM products increasingly issue machine-to-machine tokens" (0153:597) is an untagged trend claim. Under this document's own method statement (0153:85–87, everything product-behavioral is `[observed]`), both should be tagged, and the first cited. *Resolve:* tag both; cite the WorkOS `impersonator` object.

6. **DETAIL** — "LLP 0151 owns provider sequencing" (0153:82) states settled ownership of a Draft proposal. LLP 0151 is Status Draft and its sequencing section is titled "Sequencing (proposal)" (`llp/0151:632`), with the credential-ownership and SMS-tier decisions explicitly awaiting Charlie. The deference is directionally right — 0153 correctly routes its refinement through a 0151 amendment (0153:876–877) — but "owns" overstates a Draft's authority in a document otherwise careful about Draft-vs-settled. *Resolve:* "LLP 0151 (Draft) carries provider sequencing" or equivalent.

## 4. Suggestions

1. In the illustrative config (0153:386), `events: { cursorSecret: env("WORKOS_API_KEY") }` misnames the WorkOS API key as a "cursor secret" — the Events API is consumed with the API key; the cursor is state, not a secret. Illustrative or not, the misnomer will be copied.
2. §Provider comparison table cells assert vendor facts (Clerk `fva`, WorkOS rotating refresh token, Cognito `token_use`) without tags; a one-line note that table cells inherit the prose citations would close the gap cheaply.
3. The client-bridge section names "other Snapback client arms" but never engages LLP 0096's auth-profile negotiation for protocol-native clients (Swift) — the natural place external profiles must surface for non-React arms, and the cheapest way to earn 0096's Related entry.
4. `mirror-membership` (0153:487–491) promises "a documented freshness and invalidation bound" — say explicitly whether mirrored-membership writes are LLP 0053 `permissionBacking` writes, as the org-switch paragraph already does for context changes.

## 5. Open questions the document should carry but doesn't

1. **Guest-claiming composition.** LLP 0151 makes anonymous/guest identities tier-1 and LLP 0011's dated amendment lets a claim use "a future provider's equivalent" of the verified challenge. Can an external CIAM identity claim a guest principal — i.e., does the exchange endpoint's rule-5 "create/link" logic own the guest-claim transition (with its session rotation, collision refusal, and `permissionBacking` commit), or is claiming restricted to built-in mechanisms? This is a real composition for exactly the "add Snapback to an existing app" adopter the document targets.
2. **Per-arm upstream-token availability as a tier gate.** The capability model has `client.{web,expo,native}` booleans, but the document doesn't ask whether a tier-1 profile requires all arms or may ship web-first — Clerk's Expo token acquisition differs materially from web, and the proving-demo sequence (step 3) assumes both.

## 6. Recommended next step

Apply findings 1–6 (finding 1 is a contained addition to the exchange contract and acceptance gates; the rest are wording/header edits), add the guest-claiming open question, and proceed — the document is fit to anchor the LLP 0151 amendment its adoption sequence proposes as step 1. No re-review round is needed for these changes unless the author's finding-1 resolution grows beyond an added rule and gate row.

## Round 2 — 2026-08-02

**Reviewer family:** Anthropic Claude (Fable)
**Provider / runtime:** fresh Claude Fable 5 subagent (general-purpose, no
author context), orchestrated from the same Claude Code session
**Date:** 2026-08-02
**Redacted:** no
**Method:** family-conditioned blindness — own round-1 artifact allowed;
other family's artifact, all 0152 review artifacts, and all super-refine
journals prohibited; reviewer confirmed compliance. Delta-scoped over the 18
enumerated v0.2 change sites; new corpus claims checked against LLP
0039/0053/0055/0057/0059/0060/0064/0077/0096/0150/0151 text. One external
URL spot-checked (WorkOS authentication API — the only citation newly added
in v0.2; `impersonator` object verified). ~15 tool uses (self-reported).
**Instruction capsule:** `capsule-0153-r2.md` (final round per the author's
two-round cap)
**Target:** `llp/0153-external-ciam-integration-landscape.research.md`
(v0.2, 1125 lines, Draft Research, untracked)
**Target SHA-256:** `50342abf499c858b5967f2038b88a11c1741c98326bff48edbfa029c3455c9ef`
**Status:** completed
**Verdict:** READY (narrow-to-moderate margin; findings 1–2 must-fix riding
the landing commit)

## Verbatim review (round 2)

# Review — LLP 0153: External CIAM integration landscape (round 2, delta-scoped, final round)

**Reviewer family:** Anthropic Claude (Fable)
**Date:** 2026-08-02
**Target:** `llp/0153-external-ciam-integration-landscape.research.md` (v0.2, 1125 lines, Draft Research, untracked)
**Target SHA-256:** `50342abf499c858b5967f2038b88a11c1741c98326bff48edbfa029c3455c9ef` (verified against the capsule pin)
**Repo revision:** `main` `67628399`
**Method:** delta-scoped verification per capsule `capsule-0153-r2.md`. Own round-1 artifact re-read (permitted); Codex artifact, all LLP 0152 review material, and super-refine journals not read. New v0.2 corpus claims checked against the actual text of LLP 0060 (bucket set §, charge-before-parse, `SNAPBACK_AUTH_THROTTLED`, fail-closed limiter), LLP 0053 (exclusion list at 0053:450–459, `permissionBacking`, `provider_not_after_ms` lease formula at 0053:1385–1393, `Retainable ⇒ userId-only`), LLP 0059 (transition table row 0059:2168, 2174–2180), LLP 0039 (route policy, `AuthCoordinator`), LLP 0055/0150 (title-level ownership), LLP 0057 (closed version policy, no implicit v1→v2 migration, 0057:164–171), LLP 0151 (immutable installation binding 0151:402–405; Tier-1 witnesses 0151:162, 183–184), LLP 0096 (§5 "Not defined yet," 0096:592–598, 630–632), LLP 0064, LLP 0077 (bind-only-at-issuance, one-live-family-per-thumbprint). One external URL spot-checked (the newly added WorkOS authentication API citation).

## 1. Overall assessment

**Verdict: READY — by a narrow-to-moderate margin, with three precision fixes that should ride the landing commit.**

Every one of my round-1 findings is genuinely resolved except one, which is half-resolved: finding 1's contract half landed as exchange rule 7 (0153:452–461, substantively stronger than I asked for), but the acceptance-gates half — an evidence row for exchange throttling and JIT-provisioning quotas — did not land; the gates table (0153:1044–1055) is unchanged from v0.1. The header is now clean in both directions (all thirteen Related entries are body-earned; 0150 added, 0001 dropped), the `sts: pending` characterization matches what I verified against Clerk's page in round 1, the Convex-precedent tag is correctly split `[observed]`/`[inference]` (0153:481–485), the WorkOS `impersonator` object is tagged and cited (verified externally this round), and "LLP 0151 (Draft) carries provider sequencing" (0153:90) fixes the ownership overstatement. All four suggestions and both proposed open questions were taken.

The big v0.2 structural claims verify against the corpus, several verbatim: the LLP 0053 exclusion of session-authority transitions to LLP 0039's `AuthCoordinator` ("They are LLP 0039's, they run through its `AuthCoordinator`," 0053:453–454), the LLP 0059 same-user/different-session row ("no principal-data wipe; blank online/session-dependent results and fresh-snapshot them | strand predecessor | fresh," 0059:2168), LLP 0096's native gap ("a native client **cannot claim `auth/sender`**" and "cannot admit native clients to protected surfaces," 0096:630–632), LLP 0057's closed version policy ("there is no implicit v1→v2 migration," 0057:171), LLP 0151's immutable installation binding (0151:402–405), and the `Retainable ⇒ userId-only` consequence (0053:1640–1643). The bearer-originated four-way separation (§Replay) is the honest statement round 1's summary lacked and is consistent with LLP 0077's bind-only-at-issuance design.

What keeps the margin narrow: the capsule's predicted failure mode did occur, twice, in the two densest v0.2 additions. Exchange rule 7 wraps two requirements into "LLP 0060's shared-throttling rule" that LLP 0060 does not contain, and §Replay/§Capability model cite LLP 0053's `provider_not_after_ms` clamp as clamping the *session* when 0053 defines it as clamping the *offline-authorization lease*. Both are one-clause attribution fixes that change no recommendation.

## 2. Strengths of the revision itself

- **Rule 7** (0153:452–461) is the best kind of round-1 resolution: it imports 0060's actual mechanics (multi-bucket atomic charging, malformed-attempt charging, fail-closed limiter) rather than a hand-wave, and the new pre-verification bucket-derivation open question (0153:1092–1094) honestly flags the one genuinely unsettled piece.
- **The four-way §Replay separation** (0153:802–821) converts v0.1's implicit overclaim into the document's sharpest analytical contribution; the Summary (0153:57–65) and Model B advantages now read consistently against it.
- **The org-switch split** (0153:571–587) is exactly right against the corpus, including the subtle trap 0053 itself warns about (the earlier-draft "calls into event 4" mistake, 0053:455–459) — the document lands on the correct side of it.
- **Three-cardinality state model** (0153:518–538) plus the 0057 catalog-migration consequence turns a v0.1 flat list into something an implementer can't get wrong silently.
- **Policy-valued capabilities** (0153:857–914) close the loop the document opened in its own Summary: the revocation-lag trade-off is now answerable from the profile, not prose.
- **Growth discipline held**: +17.3% against a ~20% budget, and I found no padding — every growth site is load-bearing. The one place growth was *needed* and absent is the gates table (finding 3).

## 3. Findings

1. **MATERIAL** — Exchange rule 7 over-attributes to LLP 0060. The sentence "LLP 0060's shared-throttling rule applies to this route…: every attempt … charges independent … buckets atomically, with bounded JWT parsing before signature work, post-verification charging against the resolved principal, **JIT-provisioning quotas per issuer**, stable throttle refusal codes, and fail-closed behavior…" (0153:453–460) presents the whole colon-list as 0060's rule. Verified in 0060: the bucket set (0060:335–352), malformed/unparseable charging (0060:354–355), charge-before-parse ordering (0060:402), fail-closed limiter (0060:364), and `SNAPBACK_AUTH_THROTTLED` (0060:934) are all real. But **JIT-provisioning quotas appear nowhere in LLP 0060** (no provisioning/creation/enumeration quota exists there; the abuse-budget family that covers enumeration-class abuse is LLP 0151's, 0151:452–454), and "bounded JWT parsing before signature work" is this document's application, not 0060 text. Also "the LLP 0060/route-policy surface" (0153:460–461): *route policy* is LLP 0039 vocabulary (0039:464, 2165), not 0060's. *Resolve (one sentence):* attribute the bucket mechanics to 0060, state JIT-provisioning quotas and the JWT parse bound as this route's additions in 0151's abuse-budget family, and name 0039 for route-policy registration.

2. **MATERIAL** — LLP 0053's clamp is cited one level too broadly. §Replay: "a downstream **session lifetime** clamped by the assertion (LLP 0053's `provider_not_after_ms` clamp is the existing mechanism)" (0153:817–820), and the capability model places `providerNotAfterClamp: true // LLP 0053 clamp is mandatory` under `session` (0153:879–881). In LLP 0053, `provider_not_after_ms` is a term in the `authorized_until_server_ms` formula for the **retained-result authorization lease** (0053:1385–1393) — it bounds revalidation-free offline service, not the Snapback session's lifetime. This slip also creates an internal tension: a *mandatory session-level* clamp would answer OQ1 (0153:1059–1061, may a session survive token expiry?), which the document elsewhere treats as genuinely open. *Resolve:* scope the citation to retained/offline authorization ("the existing corpus mechanism consuming provider expiry is 0053's lease clamp; a session-lifetime clamp is the profile's extension of the same field") — this both fixes the corpus claim and keeps OQ1 honestly open.

3. **MATERIAL** — Round-1 finding 1's gates half is unapplied. The acceptance-gates table (0153:1044–1055) has no evidence row for exchange throttling, malformed-attempt charging, or JIT-provisioning quotas; the Operations row (0153:1053) still reads exactly as v0.1. Rule 7's obligations are therefore contract text with no gate that proves them — against the document's own "not supported until all applicable rows pass" rule. Secondarily, the Session security row's unqualified "LLP 0077 binding" (0153:1048) now sits against v0.2's per-surface honesty (native surfaces *cannot* satisfy it; 0153:487–496); a "(browser-web; per-surface capability row for others)" qualifier aligns it. *Resolve:* extend the Operations row (or add one row) + one qualifier.

4. **DETAIL** — OQ2 is now half-answered by the document's own revision. "Can the LLP 0077 exchange bind an ordinary provider bearer token without a provider-supported token-binding nonce…" (0153:1062–1064) — §Replay now states flatly that it cannot (provider-signed binding "is the only mechanism that makes the exchange itself replay-resistant," 0153:812–816). *Resolve:* narrow the OQ to its live residual (what the stricter bearer-originated lifetime default should be), or fold it into OQ1.

5. **DETAIL** — Leftover "tiers" after the Tier→Level rename: "…then Auth0, Firebase, and Cognito according to **the tiers above**" (§Bottom line, 0153:1121–1122). Directly against the document's own 0151 naming caution (0153:918–923). One word.

6. **DETAIL** — Leftover of the `sts: pending` correction: the fixture list still says "pending/**incomplete registration**" (0153:759), contradicting the corrected characterization (pending session task *after* completed registration, 0153:367–372). Reword to "pending-session state."

## 4. Verification notes

- External spot-check: [WorkOS authentication API reference](https://workos.com/docs/reference/authkit/authentication) — the `impersonator` object claim verifies ("Information about the impersonator if this session was created via impersonation"). The `authentication_method` enum renders truncated ("SSO | Password | Passkey | … | MagicAuth"), so the `Impersonation` method value was not directly visible in this fetch; it was accepted in round 1 under the same citation and is not contradicted. No action needed.
- The `[inference — market pattern]` tag on the machine-token trend claim (0153:691) is an acceptable resolution of round-1 finding 5's second half: the claim is an uncited market generalization, and inference is the honest tag for it.

## 5. Open questions

None new. The seventeen carried open questions are genuinely open after the fixes above (OQ1 only remains so once finding 2 is applied; OQ2 needs the finding-4 narrowing).

## 6. Recommended next step — and the final-round determination

**No further review round is required.** All six findings are mechanical, anchor-precise edits — two attribution clauses, one table row plus one qualifier, and three single-phrase cleanups. None changes a conclusion, the Model A–D adjudication, the provider ordering, or the level structure, and none requires new evidence to resolve. Findings 1 and 2 should be treated as **must-fix-before-landing** (the corpus-truth bar is constitutive for a Research document, and both are false-as-stated corpus claims), but they can ride the landing commit with author self-verification against the anchors given; a re-review of a one-clause rewording would fix nothing a diff read cannot. Findings 3–6 ride the same commit. After those edits the document meets the READY bar: nothing remains that a further no-new-evidence round would fix.
