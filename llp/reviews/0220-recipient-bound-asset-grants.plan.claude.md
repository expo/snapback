# Review artifact: LLP 0220 — Claude family

**Round:** 1
**Date:** 2026-08-10
**Target:** llp/0220-recipient-bound-asset-grants.plan.md @ blob b249e9b1911abc3ec3449681e007e0ed8a97c2f2 (rev b)
**Capsule:** sha256-16 df746f862148df3b (target + Related LLPs + cited guide/issue/benchmark files + asset_grants.rs + line-ranged excerpts of large cited files)
**Reviewer runtime:** Claude family via Agent tool (subagent_type general-purpose), capsule-confined, read-only instructions
**Verdict:** NOT READY

---

## Review: LLP 0220 (round 1)

### MATERIAL concerns

1. **The Plan's docs-state claim is contradicted by the cited guide page itself, and no deliverable absorbs the contradiction.** The Summary's "Docs" bullet asserts `guide/backend/assets.md` §"Grant and revoke per-recipient access" (~627) "already makes the grant-ops spelling primary with the app-owned-rows composition as the portable fallback" — true of that section (capsule `guide/backend/assets.md` lines 627–743) — but the same page's Anti-patterns section still says the opposite: "**Do not call the designed grant operations yet.** LLP 0210 D5(b) is a design reference, not a shipped API; use the row composition above" (lines 1131–1133), and the preceding bullet links to a heading that no longer exists (`#compose-view-once-access-with-per-recipient-grant-rows`, line 1128 — the section is now "Portable fallback: app-owned grant rows", line 685). An implementer executing D1–D3 exactly as scoped (recipe page + capability-index truth + demo witness, with D1 cross-linking to assets.md rather than editing it) would leave the guide contradicting the shipped primitive the whole Plan is about, and the Plan's own evidence recital would mislead them into believing the page is already consistent. Smallest fix: add one sentence to D1 (or D2's truth-keeping scope) — e.g. "D1 also reconciles `guide/backend/assets.md` §Anti-patterns: remove the stale 'Do not call the designed grant operations yet' bullet and repoint the sole-authority-path bullet's dead anchor at §Grant and revoke per-recipient access" — and soften the Summary's "already makes the grant-ops spelling primary" to note the stale anti-pattern tail.

### MINOR concerns

1. **"the eight D5(b) grant refusal codes" misdescribes one of the eight.** The open ticket (`issues/20260809-s5d10-asset-grant-codes-unclassified.md`) lists seven `SNAPBACK_ASSET_GRANT*`/`SNAPBACK_ASSET_GRANTS_UNDECLARED` codes plus `SNAPBACK_CTX_LEDGER_ID_KIND_MISMATCH`, which is a ctx-ledger code, not a grant refusal. D2 should say "the eight unclassified codes from the D5(b) landing" so the executor classifies all eight, not just the grant-named seven.

2. **Recipe step 4 compresses two delivery profiles into one sentence in a way the recipe page must not copy.** "use owner-only policy plus `private-strict` delivery for next-request denial; already-issued signed URLs survive until their bearer TTL" reads as if signed URLs exist under `private-strict`; the signed-URL caveat belongs to the `private-signed` alternative (capsule `guide/backend/assets.md` lines 677–680: strict denies next request; signed stops new issuance but issued bearers live to TTL). Split the clause ("…for next-request denial; under `private-signed`, already-issued URLs survive until their bearer TTL") so D1's author doesn't transcribe the ambiguity.

3. **One of the three cited witnesses is unverifiable at its citation.** `asset_grant_ops_pilot_strict_signed_and_lifecycle` (~2781) and `asset_cut_carries_grants_at_the_same_consistent_cut` (~2151) check out against the tests.rs excerpts, but `asset_grant_commit_wakes_and_revoke_blanks_live_projection` appears only in the capability row's evidence column, with no line reference in the Plan. Add its approximate location (or drop the parenthetical line refs uniformly) so the evidence recital is checkable end to end. (Altitude-adjacent; polish.)

4. **D2's parenthetical ties `maturity: partial` to the hosted claim alone.** The row's `partial` (capsule `guide/capabilities.md` line 52) also reflects the missing demo/acceptance witness that D3 supplies; "maturity stays `partial` until hosted is claimed or explicitly re-scoped" could be read as forbidding any maturity change even after D1–D3 land. A word like "at minimum until hosted is claimed or re-scoped" keeps D2 from over-constraining the index.

### AUTHOR-DECISION ITEMS

None.

VERDICT: NOT READY

---

# Round 2

**Round:** 2
**Date:** 2026-08-10
**Target:** llp/0220-recipient-bound-asset-grants.plan.md @ blob d0aeea530e7dae0d7637fd950a163d6564082ebb (rev c)
**Capsule:** sha256-16 02e80e30fb0f4fe8 (round 1 capsule with rev c swapped in)
**Reviewer runtime:** Claude family via Agent tool (subagent_type general-purpose), capsule-confined, read-only instructions; delta (b→c) enumerated in the round instructions
**Verdict:** NOT READY (single MATERIAL, IN-DELTA; pre-existing text reported CLEAN)

---

I have completed my review of the capsule. Verification notes before the formal output: I checked every line-number citation in the Summary against the capsule excerpts (`src/assets.rs` ~796, `define.mjs` ~3995/~4047, `ctx-bootstrap.js` ~766, `runtime.rs` ~357, `asset_grants.rs` ~80, `tests.rs` ~2151/~2781, assets.md ~627/~1128/~1132 — all exact), the eight-code enumeration against the open ticket, the 1,024-ceiling scope against the quota logic and its boundary test, the Option C/OQ1 TTL framing against LLP 0053 (lines 116, 446–460, 556–558) and LLP 0044 §Asset read authorization, the capability-row description against `guide/capabilities.md` row `backend.assets`, the no-demo-uses-grants claim against the grep-hits file, and the demo names against the directory listing.

## Review: LLP 0220 (round 2)

### MATERIAL concerns

1. **IN-DELTA — Recipe step 3's "delete-for-everyone" is not executable against the recipe's own state model once any recipient has closed.** Step 3 (recast in this delta) says owner delete-for-everyone "must revoke **every** outstanding grant on the message," but the recipe never establishes how "outstanding" is computable: step 1 stores each `grantId` in recipient-visible metadata at mint, and nothing in step 3's *recipient close* verb updates that app state. Grants are system records with no enumeration op in the cited surface, and the corpus is explicit that revoke removes the record so "a later operation on that `grantId` refuses as unknown" (`guide/backend/assets.md` ~663–664; `SNAPBACK_ASSET_GRANT_UNKNOWN` in `src/storage/asset_grants.rs` ~192–198, where the final-lock `apply_in_tx` Revoke branch does a non-optional `query_row`, so a staged revoke of a removed edge aborts the whole mutation — "A refusal aborts app writes," ~247–249). Consequence: the natural implementation (iterate the minted `grantIds`, revoke each) makes owner delete-for-everyone *fail* whenever any recipient closed first — a product-visible defect in the exact verb pair the delta was recast to pin, and D3's two-recipient delete probe (both edges still outstanding) cannot catch it. Smallest fix: one sentence in step 3 — recipient close also clears/marks that grant in the owner-visible app state (mirroring the fallback recipe's "delete that recipient's grant row" bookkeeping, assets.md ~723–728), so delete-for-everyone revokes only still-live edges — plus, optionally, one added D3 probe (recipient closes, then owner delete-for-everyone still succeeds and clears the reference).

### MINOR concerns

1. **IN-DELTA — The D3 parenthetical "(activation alone does not refuse it)" is imprecise against the enforcement code.** A second open that unconditionally re-calls `ctx.assets.activate` *is* refused — `SNAPBACK_ASSET_GRANT_STATE_INVALID`, "only a pending asset grant can be activated" (`asset_grants.rs` ~181–187). What activation genuinely cannot police is (a) byte re-fetching during the active window with no mutation at all, and (b) a same-`clientKey` replay, which returns the original result without a second transition (assets.md ~664–666). As written, an engineer building the D3 acceptance test may assert "refused by the unique consumption row" and get the grant-machine code instead, depending on the open mutation's internal order. Tighten the wording so the probe pins the intended refusal source (consumption-row check ordered ahead of, or independent of, the activate call).
2. **IN-DELTA — D1's anchor repoint leaves the surviving anti-pattern bullet in fallback-only vocabulary.** After removing the stale bullet (~1131–1132) and repointing the dead anchor (~1128), the third §Anti-patterns bullet still reads "Keep the per-recipient grant **row** as the sole authority edge" — accurate for the fallback it will now link to, but silent on the primary grant-*edge* spelling the page makes primary at ~627. D1 should reword the bullet to cover both spellings so the anti-pattern applies to the paved path too.
3. **PRE-EXISTING — Summary "Handler ops" bullet says the ops are "read-only-denied in queries"; they are denied in every non-mutation mode.** `ctx-bootstrap.js` wraps `grant`/`activate`/`revoke` in `readonlyDenied` whenever `mode !== "mutation"` (excerpt lines ~126–131), i.e. actions too. Say "mutation-only" to avoid implying actions may call them.

### AUTHOR-DECISION ITEMS

None.

PRE-EXISTING TEXT: CLEAN

VERDICT: NOT READY

---

# Round 2 — re-delivery addendum

**Provenance:** After delivering the round 2 review above, the same capsule-confined reviewer agent was pinged by the orchestrator with a status-check message (sent before the first delivery had been observed). The agent responded by re-deriving and re-delivering its review. Both deliveries are sealed verbatim; they agree on the single IN-DELTA MATERIAL concern, PRE-EXISTING TEXT: CLEAN, and VERDICT: NOT READY, but the MINOR sets partially differ and the re-delivery adds one AUTHOR-DECISION item. The re-delivery follows verbatim.

---

I have completed the review. Delivering it now as my final message (and it can be relayed to the orchestrator).

## Review: LLP 0220 (round 2)

### MATERIAL concerns

1. **IN-DELTA — Recipe step 3's "owner delete-for-everyone" is not executable as specified once any recipient has closed, and the Plan never establishes the bookkeeping that makes "outstanding" computable.** Step 1 instructs the owner to store each `grantId` in recipient-visible metadata at send; step 3 (recast in this delta) instructs delete-for-everyone to "revoke **every** outstanding grant on the message." But grants are system records with no enumeration surface — the app's stored grantId set is the only candidate "outstanding" list — and revoke is not idempotent: per `guide/backend/assets.md` (~663, "Revoke removes the record, so a later operation on that `grantId` refuses as unknown") and `src/storage/asset_grants.rs` (Revoke on a missing grant → `SNAPBACK_ASSET_GRANT_UNKNOWN`), a delete-for-everyone that replays a grantId already self-revoked by a recipient close refuses and aborts the whole mutation — the delete fails exactly in the common close-then-delete sequence. Nothing in step 3 tells the recipient-close verb to also clear that grant's id from the app metadata (the fallback recipe never has this problem because its grant rows are app rows). The D3 probe list only tests delete-for-everyone with both grants still outstanding, so the trap would survive acceptance. Smallest fix: one sentence in step 3 (carried into D1) requiring recipient close to also remove/mark that grant's id in app state so "outstanding" is derivable — noting explicitly that revoke on an already-removed `grantId` refuses as unknown and aborts the mutation — and optionally one D3 probe for close-then-delete-for-everyone.

### MINOR concerns

1. **IN-DELTA — D3's parenthetical "activation alone does not refuse it" is imprecise about refusal provenance.** A second open that unconditionally re-calls `ctx.assets.activate` *is* refused by the grant machine (`src/storage/asset_grants.rs`: activate requires state `Pending`, else `SNAPBACK_ASSET_GRANT_STATE_INVALID`); what activation does not gate is an idempotent same-`clientKey` replay (guide ~665: replays the original result) or byte fetches during the active window. As written, the D3 probe ("refused by the unique consumption row") only holds if the demo's open establishes the consumption row before (or as the deciding gate ahead of) activation. Smallest fix: a clause pinning the open ordering — consumption-row insert is the deciding refusal; a bare repeated activate refuses with the state-invalid code instead — so the acceptance assertion names the right refusal source.
2. **IN-DELTA — Option C/OQ1's citation of "LLP 0053 §Asset read-authorization inputs" overstates that section.** The capsule's LLP 0053 §Asset read-authorization inputs is the 2026-07-31 amendment and enumerates owner/reverse-edge/sharing-predicate/`ctx.auth` inputs only — it predates and never names grant edges. The grants-are-captured-dependencies fact actually lives in LLP 0044 §Asset read authorization ("plus matching active grant identity/state when that edge supplies authority") and the 2026-08-09 dated addition. Smallest fix: cite LLP 0044 alone, or phrase the 0053 citation as the admission framework the 0044 amendment extends.
3. **IN-DELTA — The ~4541 line citation for `asset_grant_commit_wakes_and_revoke_blanks_live_projection` is the one witness citation the capsule cannot corroborate at line level.** The other two test citations verify exactly (~2151 and ~2781 against the excerpts); the test's existence is corroborated only by the capability row's witness list. Smallest fix: none required if the number was taken from the tree at revision time; otherwise soften to the test name without a line anchor.

### AUTHOR-DECISION ITEMS

1. (Does not affect the verdict; related to MATERIAL 1.) Whether the sanctioned long-term answer to delete-for-everyone robustness is app-side grant-liveness bookkeeping (compatible with binding decision ii — no new primitive) or an eventual owner-side "revoke all grants on asset" ergonomic affordance recorded as a future OQ alongside OQ2. The Plan can execute with the bookkeeping fix either way.

PRE-EXISTING TEXT: CLEAN
VERDICT: NOT READY
