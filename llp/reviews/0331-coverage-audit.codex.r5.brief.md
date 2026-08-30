**Artifact:** the brief given to the Codex delta review of LLP 0331 §"Coverage" → "A real application: Expo/EAS" (round 5)
**Author:** Claude Fable 5 (orchestrator), 2026-08-30, on the author's "approve"
**sha256 of the brief body below:** `3743753662683491fea294975e652932191824ed587b3692da24c811e11f4eac`

---

You are an independent reviewer from the GPT/Codex family, running read-only inside /Users/ccheever/projects/snapback. You may ALSO read /Users/ccheever/projects/universe/server/www/src (the Expo/EAS backend, a private repository) read-only, to verify citations. Do not edit any file. Cite everything as `file:line`. Your family has reviewed this document four times today (`llp/reviews/0331-coverage-audit.codex.md`); this is ROUND 5, scoped to NEW material.

# Target

`llp/0331-scoped-roles-diary-feedback.research.md`, §"Coverage" → subsection "A real application: Expo/EAS (2026-08-30)" (from that heading to the end of §"Coverage"), plus the edits it caused: the Summary's last sentences on EAS; the model table rows "Hierarchy" and "Non-human actors"; the account-model paragraph's E-d carve-out ("e-mail is never a link key … with one carve-out"); the recipe bullet on deletion provenance (E-c); the "Tiers and the admission rule" text for Tier 0 (deletion provenance) and Tier 1 (the E-b sentence and the new "Tier 1, second entry — single-column `inherits`" paragraph); sequence rows 4b/4c; ledger rows X1, X2, X11, X19; the delta-table row for `any` / `nearest` / `inherits`; and rulings E-a to E-d in the "Author rulings" table.

The evidence is in five same-family artifacts: `llp/reviews/0331-coverage-audit.eas.brief.md` and `llp/reviews/0331-coverage-audit.eas-{actors,rules,resources,nonhuman}.md`.

# Your job

## Part A — verify the three load-bearing claims against Universe primaries (do this BEFORE reading the eas-* artifacts)

1. **E1 — the mutable parent.** Confirm or refute: (a) `apps.accountId` is rewritten by a shipped program (project transfer) — open `server/www/src/data/entities/projects/AppUtils.ts` around lines 120–175 and `AppEntity.ts` around 215–226; (b) no app-scoped child table (builds `turtlebuild/TurtleBuildEntity.ts`, branches/channels/updates under `updates/`, submissions, webhooks, workflows) carries an `accountId` column; (c) the dominant rule class walks `row → app → account` — `rules/AllowIfAccountActorHasPermissionOnAssociatedAccountPrivacyPolicyRule.ts`. Spot-check the claimed depth distribution (32/46/16/6% of 435 membership-probing uses; 256 of 294 paths through `AppEntity`) by counting instantiations of the two `…OnAssociatedAccount…` rule classes across `src/data/entities/**/*PrivacyPolicy.ts` and sampling ten of them for path length. State AGREE / DISAGREE on "ruling 4's immutable-scope premise fails for EAS's central pattern".
2. **E2 — jobs as the dispatching principal.** Confirm or refute that background jobs serialize and re-derive the dispatching viewer context (`src/background-jobs/BackgroundJobDispatching.ts`, `BackgroundJobRouter.ts`, `src/data/entities/viewercontext/ExpoViewerContextSerialization.ts`) and that most jobs run that way rather than omnipotent; spot-check five jobs under `src/background-jobs/jobs/`. State AGREE / DISAGREE on "31 of 35 jobs run as the dispatching principal".
3. **E3 — deletion cascades.** Confirm or refute the `AllowIfIn*DeletionCascade…` rule family (`src/data/entities/rules/`), the `cascadingDeleteCause` mechanism, and the order of magnitude of cascade edges (`CASCADE` / `SET_NULL` in entity configurations). State AGREE / DISAGREE on "deletion cascades are the mirror of creation provenance and no tier named them".

## Part B — review the section and the four rulings

LLP 0005 structure (overall · strengths · concerns with severity and resolution · suggestions · open questions · next step). Test specifically:
- Is single-column `inherits` over a `ref` (E-a) actually an instance of the admission rule's third class as written (an engine-maintained relation declared in the schema, readable through its own rules, written only by the engine, amplification reported)? Does putting it in **Tier 1** — which was "exactly one entry" — contradict anything, and is the "not needed for Clique M1–M3, implemented with the first app that transfers a parent scope" framing honest?
- Does E-b (a job runs as the re-minted enqueuing viewer) create any hole the document should name — e.g. a job outliving the requester's revocation, or a re-minted principal escaping the trace?
- Is E-c (a declared cascade edge as an engine write authorized by the parent's delete rule) consistent with the one-locus model and the structural-write ruling (RFC §8 `E_STRUCTURAL_WRITE`), and does it need a certificate line the document does not mention?
- Is E-d's carve-out narrow enough that "e-mail is never a link key" still means something?
- Does the EAS table (E1–E11) overstate or understate anything you can check; are the counts (171/168 policies; 164/148 omnipotent/omniscient; 218 escalation sites; 43 cascade rule sites; ~80 scoped-token policies; ~123 staff-mode policies) reproducible?
- Anything the EAS audit should have found and did not (you may know EAS better than the auditors).

# Output

`## Part A` (three items, AGREE/DISAGREE with citations), `## Part B` (LLP 0005 structure), then a final line exactly `READY` or `NOT READY`: is the EAS section, with rulings E-a to E-d applied, ready as part of the design input for the Snapback 2 authorization spec? Do not edit files. Do not fabricate line numbers — if you did not open a file, say so.
