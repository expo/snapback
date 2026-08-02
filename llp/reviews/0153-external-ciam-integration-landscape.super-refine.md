# LLP 0153 super-refine journal

## Authorization

Charlie Cheever directed the loop on 2026-08-02: "do 2 rounds of
/llp-super-refine on 0152 and 0153. These are mostly research so just
refining the conclusions is probably the important thing to do." The round
cap is therefore **two**, set by the author, and both rounds' capsules carry
an author-directed conclusions-first priority. The target is untracked in
the working tree at loop start; the base Research is Codex-drafted
(header: Charlie Cheever / Codex); the orchestrating session (Fable) did not
author it and runs the loop only.

The READY bar is the program's standing bar:

> "We've really thought this issue and concept through as much as we can
> without writing code and running it to gather empirical evidence."

The target is Draft **Research**: it recommends rather than decides and may
leave questions open — but every claim about the LLP corpus must be true
against the corpus as it exists today, and nothing open may be smuggled as
settled. External vendor claims are citation-backed survey material;
reviewers were told to treat them as unverifiable-here except for bounded
web spot-checks, and to spend their effort on the conclusions (the Model A–D
adjudication, the recommended contract, the tiers) and on corpus accuracy.

Loop mechanics as in the 0116–0149 journals: dual-family rounds (fresh
non-author Fable subagent contexts; Codex via codex-cli 0.146.0
`codex exec`, read-only sandbox, `model_reasoning_effort=xhigh`), mutually
blind on 0152/0153 artifacts in round 1 and family-conditioned in round 2
(own artifact allowed), SHA-pinned targets and instruction capsules,
verify-then-fix passes between rounds. The loop cannot advance the target
beyond Draft; adjudication is the author's.

## Round 1 — 2026-08-02

Capsules: `capsule-0153-r1.md` (shared by both families; author-directed
conclusions-first priority; blindness on all 0152/0153 review artifacts and
journals).

Target SHA-256 (v0.1, 959 lines):
`88eb933c9dff3d747e018e1e5bbb0fa3689b89fe3c1ac10eef18211c57380488`

Repo revision at review start: `main` `67628399`; the target untracked.

### Orchestrator pre-verification (concurrent with round 1)

Checked before either family reported: LLP 0151 v0.3's tier-2 "BYOP
verified-token hook" exists as characterized (`llp/0151:665-666`,
"unchanged by this RFC"); LLP 0011's opt-in cross-provider linking
(`llp/0011:240-241`), no-cascade-delete (`llp/0011:249`), and protected
`_auth_*` custody hold; LLP 0077 is the sender-constrained browser spec.

### Round 1 results

**Split verdict — Fable READY "by a moderate margin" (1 MATERIAL, 5
DETAIL); Codex NOT READY "by a wide margin" (6 BLOCKING, 5 MATERIAL, 1
DETAIL).** Blindness audited and held for both (the Codex transcript's only
`llp/reviews/` traces are the capsule prohibition, skill text, stated
intent, and a directory listing). The asymmetry is the loop's most
instructive result: Fable verified the corpus claims the document *makes*
(all held, including five web spot-checks — Convex overview, Clerk manual
JWT verification, WorkOS data syncing, Supabase third-party ×2); Codex
charged the corpus constraints the document *omits or misroutes*. Every
Codex blocker was verified against the tree by the orchestrator before
application:

- **B1 — sender binding credited with protection it does not provide.** LLP
  0077's issuance proof binds only the newly created family
  (`llp/0077:756`+); it cannot prove ownership of a copied upstream bearer
  JWT. The Summary's "preserves LLP 0077's browser-session security" and
  §Replay's nonce claim overstated.
- **B2 — the Expo first-wave proof contradicts LLP 0096**: "a native client
  cannot claim `auth/sender`, and a sender-constrained deployment cannot
  admit native clients" (`llp/0096:630-632`); LLP 0064 classifies
  React Native/Expo as a native surface.
- **B3 — the exchange omitted LLP 0060 D3's mandatory multi-bucket
  admission charging** (`llp/0060:333+`, malformed attempts included,
  limiter failure fails closed). Converges with Fable's sole MATERIAL
  (abuse budgets / JIT-provisioning quotas, anchored to `llp/0151:452-454`)
  — the two families found the same hole from opposite directions.
- **B4 — org switching misrouted through LLP 0053**: 0053 explicitly
  excludes session-authority transitions (they are LLP 0039's
  `AuthCoordinator`; `llp/0053:450-455`), and LLP 0059's
  same-user/different-session rule governs the client side; membership
  mirroring is the `permissionBacking` part. Retained authorization is
  `userId`-only (`llp/0053:1640-1642`).
- **B5 — exchange rule 4's "unless the declaration explicitly permits"
  allowed impersonated assertions to mint ordinary sessions**, contradicting
  the document's own §Impersonation.
- **B6 — one audience rule conflated ID/session/access token classes** the
  document itself recommends per profile.
- **M7–M11, D12** (capability model lacks the policy values the document
  calls load-bearing, incl. LLP 0053's `provider_not_after_ms` clamp at
  `llp/0053:1386-1392`; identity/session/cursor cardinalities + LLP 0057
  exact-versioned catalog; tier naming vs LLP 0151's witness contract;
  provider-table evidence labels; "LLP 0150 owns the agent lane" vs 0150's
  own "acquisition front end onto LLP 0055" at `llp/0150:146`; Related
  hygiene) — all confirmed.

**Fable-only, confirmed:** `sts: pending` is a pending-session task, not
incomplete registration (web-verified against Clerk's page); the
`[observed]` tag wrapping an evaluative judgment on the Convex precedent;
untagged WorkOS-impersonation and machine-token claims; "LLP 0151 owns
provider sequencing" overstating a Draft; the `cursorSecret` misnomer; the
guest-claiming and per-surface open questions.

### Round-1 dispositions

All 18 distinct findings applied in **v0.2** (1125 lines, +17.3%, inside
the ~20% budget), SHA-256
`50342abf499c858b5967f2038b88a11c1741c98326bff48edbfa029c3455c9ef`.
Substantively:

- **Summary rewritten** to the bearer-originated-exchange truth: sender
  constraint protects the resulting session post-issuance and cannot prove
  upstream-assertion ownership; the native sender-constraint GAP (LLP 0096)
  stated up front.
- **§Replay rewritten as a four-way separation**: bearer-originated
  authentication / post-issuance binding / provider-signed key-nonce binding
  as a capability fact / bearer-origination policy (`jti`, max assertion
  age, LLP 0053's `provider_not_after_ms` clamp, admission budgets).
- **Exchange rule 7 added**: LLP 0060 D3 multi-bucket atomic charging
  including malformed assertions, bounded parse, JIT-provisioning quotas,
  fail-closed limiter, explicit route-policy registration. **Rule 4 now
  rejects impersonated assertions unconditionally**; §Impersonation aligned
  (distinct audited authority kind or nothing). **Audience validation pinned
  per profile and token kind** (API access / ID / provider session /
  Cognito-Firebase quirks).
- **Org switch split** into the LLP 0039/0059 authority transition and the
  LLP 0053 `permissionBacking` mirror write; `userId`-only retention noted.
- **State model split into three cardinalities** (identity link /
  derived-session provenance / provider-installation state) with the LLP
  0057 catalog-version migration named as an adoption-sequence step;
  identity key scoped by provider installation per LLP 0151's
  immutable-binding rule.
- **Capability model grew policy-valued fields** (assertion age, single-use,
  per-surface sender constraint, downstream max age, provider-not-after
  clamp, online revalidation, revocation-lag bound, stale-key window,
  fail-closed JWKS outage).
- **"Support tiers" renamed support levels** with the LLP 0151
  tier-contract caution and witness obligations; roadmap-vs-supported
  stated; "client arms" → client surfaces (LLP 0064).
- §Client bridge: per-surface sender honesty (web-first proof; Expo under
  the 0096-permitted non-sender posture); adoption step 3 rescoped
  accordingly; step 1 carries the 0060 requirement; step 2 the 0057
  migration.
- Fable's detail fixes: `sts: pending` reworded; observed/inference split on
  the Convex precedent; impersonation/machine-identity tags and citation;
  "(Draft) carries"; `apiKey`; provider-table provenance note +
  ordering-confidence caveat; mirror-membership's bound named as
  `permissionBacking`; local logout suppresses auto re-exchange (Codex
  suggestion). Related: 0001 dropped, 0055/0150 added, all earned. Seven
  open questions added (exchange-route owner, installation migration,
  pre-verification bucket derivation, native sender evidence, guest
  claiming, retention/export, per Codex's and Fable's lists).

**Residue carried:** Codex's ownership-table and refusal-code suggestions
not applied as new sections (the per-section governing-LLP citations and
existing gate rows carry the substance at Research altitude); no finding
refuted.

## Round 2 — 2026-08-02

Capsule: `capsule-0153-r2.md` (family-conditioned blindness — own round-1
artifact allowed, other family's and all journals prohibited; enumerates all
18 v0.2 change sites; directs scrutiny at the revision text itself; final
round per the author's two-round cap).

Target SHA-256 (v0.2, 1125 lines):
`50342abf499c858b5967f2038b88a11c1741c98326bff48edbfa029c3455c9ef`

(Results recorded below when the round completes.)

### Round 2 results

**Split verdict — Fable READY ("by a narrow-to-moderate margin," 3 MATERIAL
+ 3 DETAIL, findings 1–2 designated must-fix-riding-the-landing-commit),
Codex NOT READY ("narrow margin," 2 BLOCKING + 3 MATERIAL).** Both families
verified the round-1 architectural repairs substantively (Codex: findings
4/5/6/11/12 fully resolved, 1/2/9 resolved with displaced residue, 3/7/8/10
partial; Fable: all resolved except its finding 1's gates half). Blindness
held for both (Codex transcript audit: capsule text, own permitted round-1
artifact, directory listings, and incidental LLP-body mentions only; the
reviewer's read-only sandbox prevented it appending its own artifact, so
the orchestrator archived it as the dated round-2 section it requested).

**The fix-introduces-defect dynamic, confirmed twice — and found blind by
both families in the same two places:**

- **Rule 7 over-attributed to LLP 0060 D3** (Fable finding 1 = Codex
  BLOCKING-1). The round-1 fix presented its whole colon-list as 0060's
  rule; 0060 charges subject buckets only where a subject is parseable,
  JIT-provisioning quotas appear nowhere in 0060 (they extend LLP 0151's
  abuse-budget family), the bounded-parse ordering is this route's
  application, and route-policy vocabulary belongs to LLP 0031's taxonomy
  (Codex) / LLP 0039's usage (Fable) rather than 0060. Codex added the
  charge-on-denial/no-rollback v1 contract and the missing abuse
  acceptance coverage.
- **The `provider_not_after_ms` clamp was cited one level too broadly**
  (Fable finding 2 = Codex BLOCKING-2). The field belongs to LLP 0053's
  `AuthorizedLease` and bounds retained/offline authorization, not the
  session family — and as written it would have silently answered OQ1,
  which the document correctly keeps open. Codex additionally split
  provider-signed key confirmation (proves key control) from nonce/`jti`
  single-use (freshness only; a stolen bearer can win first use) and
  flagged the Summary's "visible until token expiry" as wrong for an
  already-issued session.

**Codex-only, confirmed:** the cardinality fix hadn't reached §Account
linking ("(issuer, subject) is authoritative") or the identity-link row
(active org context is session-scoped, per WorkOS's own refresh-switch
semantics); the per-surface sender qualification hadn't reached Model B's
advantages, Level 0, Level 1's Clerk-Expo claim, the Session-security gate
row, or the bottom line; the table-provenance note claimed anchors that
several rows lack. **Fable-only, confirmed:** the missing exchange-admission
gate row (its round-1 finding's unapplied half); OQ2 half-answered by the
revision's own §Replay; the "tiers above" and "pending/incomplete
registration" leftovers.

### Round-2 dispositions and loop closure

All 11 findings applied in **v0.3** (1165 lines, +21.5% over v0.1 — ~14
lines past the ~20% guideline; the excess is correction text, accepted as
the 0147/0149 loops accepted their overages), SHA-256
`91bf0c95b3a8afbb2de506c9b2b3ad5b429eb6e9955e3962788ded838cbe84ad`
(final, including LLP 0031's Related entry):

- Rule 7 rewritten to 0060 D3's actual mechanics (pre-parse global +
  effective-source always; subject buckets only when parseable;
  family/user on resolution; atomic including on denial; bounded
  privacy-preserving keys; fail-closed), with the JWT parse bound and
  per-issuer JIT quotas explicitly `[inference]` extending 0151's
  abuse-budget family, and LLP 0031 route registration + 0060 abuse
  acceptance coverage named.
- §Replay's fourth bullet rescoped: downstream session expiry is OQ1
  policy; LLP 0053's lease clamp bounds retained/offline authorization;
  derived-session provenance now records the assertion not-after for lease
  issuance. Key confirmation vs nonce/`jti` split adopted verbatim in
  spirit. The Summary's visibility sentence corrected. The capability
  model moved `providerNotAfterClamp` into a `retainedAuthorization` block.
- Cardinalities made consistent end-to-end: §Account linking uses the
  installation-scoped key; tenant/team binding on installation state;
  active organization + upstream `sid` + assertion not-after on
  derived-session provenance.
- Per-surface sender honesty propagated: Model B advantage, Level 0, the
  Level 1 Clerk-Expo claim, the Session-security gate row, and "the
  support levels above" in the bottom line.
- New **Exchange admission** gate row (0060 abuse coverage, JIT quota
  fixtures, duplicate-`jti`/nonce-reuse/copied-bearer cases) — closing the
  unapplied half of Fable's round-1 finding.
- Table provenance narrowed honestly: unanchored token/quirk rows are
  `[inference — to be pinned per profile]`, matching the existing token-kind
  open question. OQ2 replaced with the key-confirmation-per-provider
  question both reviewers converged on; the fixture-list leftover fixed.

**The loop closes here at the author's two-round cap.** Both families
stated no third broad round is required: Codex's NOT READY was conditioned
on exactly these repairs with "a focused check against the cited LLP
lines," which the orchestrator performed before application (0060 D3 text,
0053:1320/1385-1393, 0031's existence and title); Fable's READY carried the
same two must-fix items, applied. Residue is author-gated or empirical.

**Score by origin:** round 1 — 18 distinct findings (Fable 1 MATERIAL + 5
DETAIL; Codex 6 BLOCKING + 5 MATERIAL + 1 DETAIL; the two families' sole
substantive overlap was the admission-budget hole, found from opposite
directions). Round 2 — 11 findings (Codex 2 BLOCKING + 3 MATERIAL; Fable 3
MATERIAL + 3 DETAIL; the two BLOCKING/must-fix pairs found convergently and
blind). Zero findings refuted across the loop; two round-1 Codex
suggestions (ownership table, refusal-code enumeration) deferred at
Research altitude, twice-noted.

**Proposed next step (the author decides; this loop cannot accept):** LLP
0153 remains **Draft** Research at v0.3. Its adoption sequence's step 1 —
amending LLP 0151's BYOP hook into an explicit exchange capability — is the
next concrete artifact; the author decisions it queues are the exchange
route's normative owner, the 0152/0153 boundary ratification (mirrored in
0152's OQ14), and whether assertion expiry caps the downstream session
(OQ1). The instructive loop lesson, for the journals' running record: an
internal-consistency verifier can pass a figure whose source cells are
wrong (0152's count) and a corpus-precision verifier can catch a fix that
imports mechanics one document over (0060/0053 here) — the two families
keep catching different halves, which is the argument for keeping both.
