# LLP 0152 sign-in integration landscape review — Fable family

## Round 1 — 2026-08-02

**Reviewer family:** Anthropic Claude (Fable)
**Provider / runtime:** fresh Claude Fable 5 subagent (general-purpose, no
author context), orchestrated from a Claude Code session
**Date:** 2026-08-02
**Redacted:** no (repository access; no secrets in scope)
**Method:** mutually blind — capsule prohibited reading any `llp/reviews/`
artifact concerning LLP 0152 or 0153 and any super-refine journal; reviewer
confirmed compliance. SHA-pinned target and instruction capsule; corpus
reads limited to the target, LLP 0151, LLP 0011 (grep), LLP 0153
header/summary. Three external URLs spot-checked via WebFetch (WorkOS
magic-link deprecation, Supabase passkeys, Clerk account linking — all
confirmed). ~11 tool uses (self-reported).
**Instruction capsule:** `capsule-0152-r1.md` (author-directed
conclusions-first priority)
**Target:** `llp/0152-sign-in-integration-landscape.research.md` (v0.1, 967
lines, Draft Research, untracked)
**Target SHA-256:** `b2c6547021095d3f4172722aa88bc2ca05e4b098d4513d20ea430ad20d4aa74e`
**Repo revision at review start:** `main` `67628399`
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

# Review — LLP 0152 "Sign-in integration landscape and lessons" (v0.1, round 1)

Reviewed file: `/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md` (SHA-256 verified `b2c6547021…d4aa74e`, 967 lines, matches capsule).

## 1. Overall assessment

**NOT READY — by a narrow margin.**

The market survey itself is excellent: the matrix and per-product prose are mutually consistent, the observed/anecdotal discipline is followed in substance, three load-bearing external claims I spot-checked (WorkOS magic-link deprecation, Supabase passkey surface, Clerk account-linking state machine) all verified precisely, and the design synthesis (§Best ideas, §Proposed evaluation gates) is coherent and genuinely useful. But the capsule's own priority is the conclusions, and the document's *headline* conclusion — the "clearest research challenge to Draft LLP 0151 is MFA scope… deferring TOTP and recovery codes" — is factually wrong against LLP 0151 as it exists today: recovery codes are tier-1 infrastructure in 0151, and TOTP is already Tier 2 ("supported"), not "landscape" as §Implications item 4 asserts. Three of the eight Implications (items 1, 3, 4) charge 0151 with gaps its current v0.3 text already fills, apparently because the research was baselined against 0151's initial draft while 0151's concurrent super-refine rounds moved. A reviewer of 0151 who followed this document literally would file findings that are already resolved. The fixes are localized (re-baseline §Summary's challenge paragraph and §Implications against 0151 v0.3), not structural — hence a narrow margin — but a Research document whose stated purpose is "evidence for [0151's] review" cannot go out misdescribing the document under review.

## 2. Strengths

- **§Vocabulary** (llp/0152:92-114) is the best short statement in the corpus of the identifier/mechanism/provider/factor distinction, correctly anchored to NIST SP 800-63-4's same-factor rule, and it pays off later (Stytch/Descope distinct-evidence findings, gate 7).
- **§Market matrix** (llp/0152:116-137) is internally consistent with the per-product prose to an unusual degree; hedges ("No first-class Firebase passkey lifecycle *found in current docs*", Supabase "experimental SDK flag") are honest and, where I could check, accurate.
- **Vendor-fact hygiene is real, not performed.** All three spot-checks confirmed: WorkOS's modeling-your-app page states verbatim that IT scanners "programmatically click any links… invalidating the Magic Links" and that Magic Links are deprecated in favor of Magic Auth; Supabase's passkey page matches the document's one-call/two-step, `experimental: { passkey: true }`, list/rename/delete, and admin-revocation claims in detail; Clerk's account-linking page matches the verified-OAuth-links / unverified-password-triggers-verification-and-password-change description (llp/0152:238-242).
- **§What is troublesome** — the account-linking (llp/0152:670-684), passkey-lifecycle (llp/0152:652-667), and webhook-consistency (llp/0152:699-711) subsections are correct, well-evidenced, and the LLP 0011 anchor checks out: "cross-provider email auto-linking must be **opt-in only**" is 0011's actual rule (llp/0011-auth-and-permissions.rfc.md:239-241).
- **§Proposed evaluation gates** (llp/0152:895-923) convert the survey into ten concrete, mostly machine-checkable acceptance criteria; gates 4, 5, and 6 in particular are directly buildable and consistent with 0151's conformance-IdP direction.
- **§Confidence** (llp/0152:953-967) is an honest rubric and the body actually obeys it — no conclusion I found rests on a single anecdote.

## 3. Findings

**F1 — BLOCKING — false characterization of LLP 0151's TOTP/recovery-code placement (the document's headline conclusion).**
- llp/0152:56-61: "The clearest research challenge to Draft LLP 0151 is MFA scope. **Deferring TOTP and recovery codes** while promoting SMS OTP and passkeys leaves Snapback without the ordinary, vendor-independent recovery and second-factor package…"
- llp/0152:874-876 (§Implications item 4): "**TOTP and recovery codes should move up.** Leaving them in 'landscape'… At minimum they should be Tier 2 in the first production auth profile…"
- What 0151 actually says today: recovery codes are **not deferred and not landscape** — "Recovery codes are tier-1 *infrastructure* (not a mechanism): preissued, stored digest-only under LLP 0057's discipline… **mandatory for accounts lacking an independently recoverable authenticator** — passkey-only, password-without-email, SMS-only" (llp/0151-first-party-identity-integrations.rfc.md:423-430), and "password accounts without a verified email are issued preissued recovery codes at creation" (llp/0151:241-243). TOTP is **already Tier 2**: "**TOTP** as a second factor, on the same credential/recovery lifecycle" (llp/0151:667). 0151's Landscape section (llp/0151:672-680) contains neither. So "leaving them in landscape" is false, "deferring recovery codes" is false, and "at minimum Tier 2" recommends the status quo as if it were a change.
- What survives, and what the fix is: the *real* residual challenge is that 0151 explicitly leaves the factor-composition/assurance model unowned ("Step-up/MFA composition (TOTP, SMS-as-second-factor) is deliberately an open question — the factor-composition model has no owner yet", llp/0151:455-456, restated llp/0151:847-848), and 0151 has no `amr`/`aal`/factor-age session projection — which is exactly what this document's §Best ideas 7 supplies. Rewrite the Summary challenge and item 4 around that true gap: "0151 already makes recovery codes tier-1 infrastructure and TOTP Tier 2; what it lacks is an owned assurance model, and the market evidence says the composition model should ship with the first production profile."

**F2 — MATERIAL — Implication 1's Microsoft recommendation is already satisfied by 0151 and is framed as a gap.**
- llp/0152:858-863: "Microsoft **deserves explicit treatment**… It should be Tier 1 or the first named OIDC Tier 2 preset."
- llp/0151:471-475: "Named tier-2 presets ship in the same catalog — **Microsoft Entra ID** first (too important to leave as 'generic OIDC'; its tenant-selection behavior needs explicit handling)", repeated at llp/0151:663-664. 0151 already does precisely the second branch of the recommendation, including the rationale. The implication should be recast as market confirmation of 0151's existing placement (or as an argument for the Tier-1 branch specifically, if that is intended), not as a missing consideration.

**F3 — MATERIAL — Implication 3 charges 0151's SMS Tier 1 with lacking content it already contains.**
- llp/0152:868-873: "SMS Tier 1 needs a larger definition. **The adapter alone is insufficient.** Tier 1 must cover vendor-neutral delivery, region policy, spend/attempt budgets, pumping defense, number change, SIM-swap guidance, and a non-PSTN recovery alternative."
- 0151 never proposed "the adapter alone," and every listed item is present in its current SMS row: pumping defense, default-on destination-country allowlist, per-destination/source/prefix/IP throttles, spend caps and acknowledgment, idempotent sends (llp/0151:273-281); vendor-neutral seam with E.164 normalization, locale templates, delivery-status normalization, failover (llp/0151:283-293); SIM-swap/recycled-number rules (llp/0151:293-295); change-phone as a first-class verified flow (llp/0151:431-433); non-PSTN recovery via mandatory recovery codes for SMS-only accounts (llp/0151:425-427). Recast as verification that 0151's definition matches what the market evidence demands — that is itself a useful review result — rather than as a deficiency.

**F4 — DETAIL — Implication 2's condition is already met by 0151, unacknowledged.**
- llp/0152:864-867: "LLP 0151's decision to ship both code and link is reasonable **only if code is recommended** and link-scanner/cross-device semantics are explicit."
- 0151 already recommends codes: "Guidance prefers *codes* because a code survives the reader-opens-mail-on-another-device case that breaks link flows" (llp/0151:226-228). The genuinely new evidence here is the scanner rationale (WorkOS deprecation, Stytch handling — both verified); say that 0151's preference is confirmed and should additionally cite scanner semantics, rather than implying the code-default is an open condition.

**F5 — DETAIL — Related-header hygiene: 10 of 11 Related entries have no body mention.**
- llp/0152:9 lists LLP 0001, 0011, 0039, 0045, 0057, 0060, 0064, 0077, 0096, 0153 — none of which is named anywhere in the body (grep confirms only LLP 0151 appears). Conversely the body invokes LLP 0011's rule anonymously ("Snapback's existing rule — cross-provider email auto-linking is opt-in", llp/0152:682) and "Snapback's existing BYOP direction" (llp/0152:552-553, which is 0011's boundary per llp/0151:665-666) without citing 0011; §Best ideas 7's "authority generation so reset/link/recovery invalidates stale clients" (llp/0152:810-811) is LLP 0053's invalidation model, and 0053 is not even in Related. Either earn the entries with body mentions (a one-line scope-delineation paragraph naming 0153 would earn the most important one — see F6) or prune.

**F6 — DETAIL — no scope delineation against LLP 0153, which owns the seam this document repeatedly touches.**
- §4 "Provider/verifier seam" (llp/0152:550-557), the Convex section, and the webhook-consistency section all tread on LLP 0153's territory (external CIAM as a paved provider class, external token exchange, JIT linking — llp/0153:11-57). 0153's Summary even reaches the same "exchange, don't pass through" conclusion. One sentence in §Research question and method saying "the external-CIAM consumption seam is LLP 0153's subject; this document covers the first-party landscape" would prevent the two Drafts from appearing to compete for the same conclusions.

**F7 — DETAIL — matrix/prose inconsistency in the Convex row.**
- Matrix (llp/0152:128): "documented one-time **email/SMS** codes" for Convex Auth; prose (llp/0152:306-308): "It supports password/reset/optional verification, email links and codes, and OAuth providers" — SMS/phone codes appear only in the matrix. Align (Convex Auth does document phone OTP, so the prose is the likelier omission).

**F8 — DETAIL — §Best ideas 9's "abandon guest data" wording diverges from 0151's actual switch semantics.**
- llp/0152:832-834: "Offer 'continue as existing account and **abandon guest data**'…" — 0151's `switch_existing` explicitly does *not* abandon-as-destroy: "Guest data is not destroyed at switch: the guest principal is frozen… and retained in quarantine under an explicit TTL" (llp/0151:360-362), with an app-declared cleanup contract at expiry (llp/0151:377-383). Since this document elsewhere holds itself to lifecycle precision, align the wording (freeze/quarantine, not abandon).

## 4. Suggestions (non-blocking)

- **State the 0151 baseline explicitly.** Add one line to the Revised header or §Implications preamble: "checked against LLP 0151 v0.3 (2026-08-02)". 0151 moved twice on the same day this document was written; F1–F4 are the predictable result, and pinning the baseline makes the next drift visible instead of silent.
- The method section (llp/0152:76-79) promises literal `[observed]`/`[anecdotal]` tags, but the body carries the discipline in prose ("weak anecdotal evidence," "These are anecdotes") and inline links rather than tags. Either soften the method's promise to match, or tag the handful of anecdote citations literally.
- Open question 2 (Expo neutral broker, llp/0152:929-931) should cross-reference 0151's already-recorded resolution of the adjacent space: the broker-issuer variant was *rejected* as graduation-lossy and the transparent Google-issuer relay pre-pinned (llp/0151:744-771), and "Expo as OIDC provider" is already an 0151 open question (llp/0151:834-836). As phrased, OQ2 quietly reopens a shape the 0151 loop closed.
- §Implications 8 (identity-scopes-only) and 6 (per-provider migration matrix) are both already embodied in 0151 (token-discard rule llp/0151:434-444, per-provider ownership matrix llp/0151:724-731); framing them as "confirmed by the market, keep them" would make the eight-item list read as the mixed verification-plus-challenge it actually is.
- Gate 10 (llp/0152:922-923) presupposes 0151's tier vocabulary and LLP 0061's guide machinery; a citation of 0061 would earn it (and partially address F5).

## 5. Open questions the document should carry but doesn't

- **How should this Research stay synchronized with 0151 while both are in concurrent review?** Given F1–F4, the document needs a stated re-baselining trigger (e.g., re-verify §Implications whenever 0151's Revised header changes) before either is accepted.
- **Which of the ten evaluation gates are measurable today with existing Snapback machinery** (conformance IdP, capture mailbox, acceptance personas) versus which require new infrastructure? The gates are presented flat; sequencing them against 0151's §Sequencing would make them adoptable.
- **Where does WhatsApp OTP sit in the recommendation?** The survey records it (Stytch, Descope, 0151's landscape note that the seam "should not assume phone-OTP ⇒ SMS") but the composite design and gates are silent on non-SMS phone challenge.

## 6. Recommended next step

Re-baseline §Summary's challenge paragraph and §Implications items 1–4 against LLP 0151 v0.3 (fixing F1 outright and converting F2–F4 into verification results), add the 0153 scope sentence and the 0011/0053 citations (F5–F6), and correct F7–F8. These are hours of focused editing, not a re-survey; the vendor material needs no rework. After that revision this document is READY-shaped, and a second round can confirm the reframed MFA/assurance challenge — which is the document's real and valuable contribution — lands as evidence in 0151's loop.

## Round 2 — 2026-08-02

**Reviewer family:** Anthropic Claude (Fable)
**Provider / runtime:** fresh Claude Fable 5 subagent (general-purpose, no
author context), orchestrated from the same Claude Code session
**Date:** 2026-08-02
**Redacted:** no
**Method:** family-conditioned blindness — own round-1 artifact allowed;
other family's artifact, all 0153 review artifacts, and all super-refine
journals prohibited; reviewer confirmed compliance (0153 material touched
only at the target's own header/title in `llp/`, which the capsule
permits). Delta-scoped over the 16 enumerated v0.2 change sites; baseline
cross-checked (LLP 0151 still v0.3 at review time; repo head advanced
`67628399` → `4f7890eb` with none of the cited tracked LLPs changed). ~15
tool uses (self-reported); no external URLs this round (the delta is
corpus-facing).
**Instruction capsule:** `capsule-0152-r2.md` (final round per the author's
two-round cap)
**Target:** `llp/0152-sign-in-integration-landscape.research.md` (v0.2,
1085 lines, Draft Research, untracked)
**Target SHA-256:** `a54aa24d8d537498d79da30c5fabacadb6fe904d7fcf685f20ab411e57ce5214`
**Status:** completed
**Verdict:** READY

## Verbatim review (round 2)

# Review — LLP 0152 "Sign-in integration landscape and lessons" (v0.2, round 2, final round)

Reviewed file: `/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md` (SHA-256 verified `a54aa24d…e5214`, 1085 lines, matches capsule). Baseline cross-check: LLP 0151 remains at v0.3 (2026-08-02) in the tree — it has **not** moved since the capsule was written. The repo head has advanced (`67628399` → `4f7890eb`), but `git log` confirms none of the cited tracked LLPs (0011, 0053, 0057, 0060) changed in that range, and 0151/0152/0153 are untracked; the v0.2 baseline therefore still holds at review time.

## 1. Overall assessment

**READY — with comfortable margin.**

Every one of my round-1 findings is genuinely resolved, not cosmetically (verification below). More importantly, the revision text itself survives the cross-loop failure mode the capsule warns about: I checked every new corpus claim the fixes introduced against the actual documents, and all of them are accurate — several are verbatim-faithful paraphrases (gate 11's "neither provider nor Snapback bearer tokens crossing redirect URLs" against 0151:525-526's "No provider token and no Snapback bearer token ever crosses a redirect URL"; Best ideas 3's five broker constraints against 0151:753-760; Best ideas 9's freeze/quarantine/checkpointed-resumable merge against 0151:357-383). The displaced-text sweep found no v0.1 residue contradicting the v0.2 conclusions: no "defer"/"move up" phrasing survives, the remaining AAL1/AAL2 mentions (llp/0152:155, 293) are correct Supabase product descriptions rather than Snapback design vocabulary, and OQ15's "twelve evaluation gates" matches the expanded gate list. The five-of-thirteen TOTP+recovery count is internally exact: matrix rows yield 5 both (Clerk, Auth0, Descope, Better Auth, Keycloak) + 5 TOTP-only (WorkOS, Supabase, Firebase, Cognito, Appwrite) + Stytch (B2B-scoped recovery, explicitly excluded) + Convex and PocketBase (neither) = 13. Growth is +12.2%, inside the ~20% budget, and every added block traces to a specific finding — no padding. What remains is DETAIL-grade and can ride the landing commit.

## 2. Round-1 finding verification (own family)

- **F1 (BLOCKING, TOTP/recovery mischaracterization) — resolved substantively.** The Summary headline (llp/0152:63-75) and §Implications item 4 (llp/0152:940-948) now state exactly what 0151 v0.3 says: recovery codes tier-1 infrastructure, mandatory for accounts lacking an independently recoverable authenticator (0151:423-430); TOTP Tier 2 (0151:667); the residual challenge correctly narrowed to the unowned factor-composition model (0151:455-456, 847) plus the missing assurance projection — and I confirmed 0151 v0.3 contains no `amr`/assurance projection anywhere, so "the piece 0151 still lacks" is true.
- **F2 (Microsoft) — resolved.** Item 1 (llp/0152:915-924) now confirms 0151's placement (Entra ID first named tier-2 preset with tenant handling, 0151:471-474, 663) and keeps only the genuinely open Tier-1-promotion question.
- **F3 (SMS Tier 1) — resolved.** Item 3 (llp/0152:931-939) is now a pure confirmation, and each listed element is present in 0151's SMS row; the added "riding LLP 0045's adapter" attribution is correct (0151:138-151 assigns transport adapters to 0045).
- **F4 (email code vs link) — resolved.** Item 2 confirms 0151's code preference (0151:225-226) and correctly narrows the request to scanner semantics; the new "email-code provider LLP 0057 defines" attribution checks out (0057 is the auth catalog/provider protocol Spec containing `snapback.auth.email-code.v1`, llp/0057:85, 296).
- **F5 (Related hygiene) — resolved.** 0001 dropped; 0053 and 0061 added; I verified all twelve Related entries now have body mentions (0011:718, 0039:705, 0045:935, 0053:858, 0057:927, 0060:1011, 0061:1003, 0064:990, 0077:1008, 0096:991, 0151 throughout, 0153:59/104-107/585/1059).
- **F6 (0153 scope) — resolved** via the method-section boundary sentence (llp/0152:104-107) plus OQ14's honest note that the boundary awaits author ratification.
- **F7 (Convex matrix/prose) — resolved** (llp/0152:335 now includes one-time email/SMS codes).
- **F8 (guest "abandon") — resolved substantively.** Best ideas 9 (llp/0152:879-884) now matches 0151:357-383 in detail: freeze + quarantine TTL, opt-in app-declared merge, checkpointed/resumable, cleanup contract at quarantine expiry.
- All five round-1 suggestions and all three proposed open questions were absorbed (baseline pin + re-verify trigger llp/0152:100-107; method wording llp/0152:90-94; OQ2 reframed against the pre-pinned relay — verified against 0151:753-771 and the "Expo as OIDC provider" open question at 0151:834; items 6/8 relabeled confirms; gate 10 cites 0061; OQ15/OQ16 added).

## 3. Findings

**F9 — DETAIL — edited lines break the file's wrap convention.** The v0.2 edit sites left a handful of overlong lines in an otherwise ~80-column file: llp/0152:28 (Summary, "polished conventional login. Descope is…"), llp/0152:336, llp/0152:719, llp/0152:927 ("…LLP 0057 defines. The market adds a second, independent rationale the RFC should"). Cosmetic re-wrap; no content change.

**F10 — DETAIL — gates 11–12's "(inherited, mandatory)" label doesn't note its sources' maturity.** Gate 11 inherits from Draft LLP 0151 (in review) and Draft Spec LLP 0077; gate 12 from Accepted LLP 0060. The characterizations of all three documents are accurate (0060's edge confidentiality / effective-source derivation / charge-malformed-and-unresolved multi-bucket throttling / globally fenced invalidation verified at llp/0060:128-129, 312, 339-355, 425; 0077's custody plane confirmed as the corpus's browser-class custody axis via llp/0096:83), and "mandatory" within a proposed-gates section of a Draft Research doc is a recommendation, not a smuggled decision — but one clause ("per 0151's authorization transaction, currently Draft") would keep the gate's force visibly tracking ratification. Optional.

No BLOCKING or MATERIAL findings.

## 4. Strengths of the revision specifically

- The confirms-vs-requests labeling of §Implications (llp/0152:906-970) converts what was a misfiring gap report into exactly the review-evidence artifact the document claims to be; every label I checked is correctly assigned, including the subtle ones (item 6 confirms the matrix *and* Option D, 0151:682, 744; item 8 confirms token-discard with the Apple-revocation carve-out, 0151:434-444).
- The re-baselining trigger (llp/0152:100-107) plus the repeated "if 0151 moves again, re-verify" (llp/0152:913-914) institutionalizes the fix for round 1's root cause rather than just patching its instances.
- The recovery-count calibration footnote (llp/0152:146-149) is the right way to make a headline quantitative claim auditable — and it audits clean.
- Best ideas 3's hardened refusal (llp/0152:812-819) is now *stronger* than a mere fix: it forward-references its own §Implications item 6 and 0151's pre-pinned conditional coherently, and OQ12 mirrors it without contradiction.

## 5. Suggestions (non-blocking)

- Re-wrap the F9 lines when landing.
- Consider the F10 clause on gates 11–12.

## 6. Open questions

None beyond the document's own OQ1–OQ16, which now correctly carry everything I flagged in round 1. The remaining substance (bakeoff, composition-model owner, boundary ratification, broker conditional) genuinely requires new evidence or an author decision — not another review round.

## 7. Recommended next step — and the final-round statement

**No further round is required.** Both remaining findings are DETAIL, purely cosmetic/hygienic, and can ride the landing commit; neither would change a conclusion, a label, or a corpus claim. Nothing remains that a no-new-evidence review round would fix — the residue is empirical (OQ10's bakeoff) or author-gated (OQ11–14). Land v0.2 (optionally with the F9 re-wrap folded in), and let it serve as review evidence in 0151's loop, subject to the document's own re-verify trigger if 0151's Revised header moves.

**Verdict: READY** (comfortable margin).
