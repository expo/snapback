**Artifact:** the brief given to the Codex delta review of LLP 0331 §"Coverage" (round 1)
**Author:** Claude Fable 5 (orchestrator), 2026-08-30, on the author's ruling 6
**sha256 of the brief body below:** `fe938fd7104fa5f9fbe3744176275e07c1a412594d1c6b1974b7c1ab28c05fa1`

---

You are an independent reviewer from the GPT/Codex family, running read-only inside the repository /Users/ccheever/projects/snapback. Do not edit any file. Cite everything as `file:line`.

# Target

`llp/0331-scoped-roles-diary-feedback.research.md` (Research, Draft, uncommitted), **§"Coverage — the model against the thirty-seven paper applications"** (from the heading `## Coverage` through the subsection `### Author rulings (2026-08-30)`), plus the sentences it changed in the Summary, the model table (rows "Hierarchy", "Non-human actors", "Guests and links"), the non-human-principal paragraph under "The account model", and the "Sequence and acceptance bar" rows 4b, 6, 7.

This is a DELTA review of that section only. Findings 1–10 and the Snapback 1 sections were reviewed by your family earlier today (`llp/reviews/0331-scoped-roles-diary-feedback.codex.md`) and are out of scope.

# What the section claims

It tests the document's proposed Snapback 2 authorization model (per-table rules; one opaque scalar `viewer`; one-hop `exists` with a `where`; `{scope, principal, role}` relation rows; `(old,next)`; transaction-local creation provenance; trace-as-revocation) against every authorization requirement of the 37 paper applications written for the Snapback 2 data language (LLP 0329.014.001/.002/.003/.005; verbatim artifacts under `llp/reviews/0329.014.00{1,2,3,5}-*`), and concludes with a tiered admission rule: Tier 0 core, Tier 1 = a system actor (one reserved principal, `callable:'system'`, `phase:'system'` continuation, declared per-program reads/writes view), Tier 2 = hierarchy / principal sets / two-hop `any` / `getHidden` / `bearerOf` / engine-maintained relations / program-scoped write grants, plus refusals and an admission rule. The founder has ruled on six questions (the "Author rulings" table).

The per-application evidence was produced by nine same-family (Claude) audit slices, `llp/reviews/0331-coverage-audit.*.md`. Because all nine share one model family, this review exists to catch a shared blind spot.

# Your job, in order

## Part A — re-derive eight verdicts from PRIMARY artifacts (do this BEFORE reading any `0331-coverage-audit.*` file)

For each item, open the named primary artifacts, find the requirement, and state AGREE or DISAGREE with the section's call, with a one-line reason and a `file:line` citation. Where you disagree, say what the honest alternative product would be.

1. **Workspace hierarchy is load-bearing** (nearest-ancestor grants with denials; 20 of 29 operations). Primary: `llp/reviews/0329.014.001-paper-archetypes.fable-workspace.md`.
2. **Notion hierarchy AND groups-as-subjects are both load-bearing and independent.** Primary: `llp/reviews/0329.014.003-wave-3.codex-notion.design.md`, `llp/reviews/0329.014.003-wave-3.fable-notion.v0.md`.
3. **The bearer reduction: of ~17 applications mentioning a link/token capability, only six are load-bearing (workspace, editor, calendar, events, E2EE attachments, PIR), and the identity-layer form — mint a guest/contact principal at redemption — covers every case except session-less possession.** Spot-check at least four: `0329.014.002-wave-2.fable-editor.design.md`, `0329.014.003-wave-3.grok-events.v0.md` (§6 #3, §7), `0329.014.003-wave-3.codex-uber.v0.md` (share link), `0329.014.003-wave-3.grok-photos.v0.md` (§6 #7, §7), `0329.014.005-wave-4.fable-pir.v0.md`.
4. **`getHidden` (a viewer-invoked program reading a row the viewer may not read) is load-bearing in about five applications — payments, tournaments, calendar, booking, brokerage — and the same-commit system continuation is an honest interim for each.** Primary: `0329.014.002-wave-2.codex-payments.design.md` + `grok-payments.v0.md`; `0329.014.003-wave-3.fable-tournaments.v0.md` (§6 #1); `0329.014.003-wave-3.fable-calendar.v0.md` (address resolution); `0329.014.001-paper-archetypes.grok-booking.md` (promotion on cancel); `0329.014.003-wave-3.codex-brokerage.v0.md` (risk mark).
5. **Twitch is the only application whose stated bar demands a time term in a rule (interval containment against `commitTime`), and the v0's "approximate expiry is explicitly promised" is an honest reduced product.** Primary: `0329.014.003-wave-3.grok-twitch.design.md` (D:47, D:55–58), `0329.014.003-wave-3.codex-twitch.v0.md` (V:541, V:557, V:582).
6. **The system actor is needed in 35 of 37 applications (all but ledger and Coterie) and its smallest form is one reserved principal + `callable:'system'` + a declared per-program read/write view — never a `principal.kind` term in rules.** Spot-check five v0s of your choice for the `|| principal.kind === 'system'` pattern and whether a declared view would remove it.
7. **No application needed a role lattice; every `>=` over roles reduces to an explicit set.** Spot-check: workspace (integer ranks), BI v0 (`>=` ranks), zero-trust (nine roles), calendar (three detail levels).
8. **Events' set-valued principal (a user acting through several bound contact principals) reduces to a program-maintained closure table written at bind/claim — which the events v0 itself chose — so it is core, with `existsAny` as later sugar.** Primary: `0329.014.003-wave-3.grok-events.v0.md` (§6 #1, §7 "Closure table", §8 #1), `0329.014.003-wave-3.fable-events.design.md` (§4 principalBindings, effectivePrincipals).

## Part B — review the section itself

Now read §Coverage in full (and you may read the slice reports for comparison). Review it as LLP 0005 prescribes: overall assessment · strengths (cite subsections) · concerns (each with severity MATERIAL/MINOR, what is wrong, evidence, what would resolve it) · suggestions · open questions · recommended next step. Specific things to test:

- Are the headline counts (31 outright / 3 closure / 2 hierarchy / 1 out; 35/37 system actor; 17→6 bearer) supported, and is any count doing rhetorical work it cannot bear?
- Is Tier 1 as stated actually the smallest form, or is there a smaller one (e.g. a kind term only) or a hidden second one (does the "declared reads/writes view" quietly become a second authorization locus that competes with table rules)?
- Is anything in Tier 2 or "refused" actually needed for Clique M1–M3 (the bar in `rules/NOT-DOING.md`) — i.e. did the tiering under-admit?
- Does the admission rule (four conditions + budget) actually constrain, or can any extension be argued through it?
- Do the six author rulings introduce any contradiction with the RFC `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md` §3–§5 that the document should call out (the RFC admits `any`, `nearest`, `principal.bearerOf`, `getHidden`; the rulings defer them)?
- Any place the section states as fact something a slice report only inferred.

# Output

Write the whole review as your final message, in this order: a `## Part A` table (item · AGREE/DISAGREE · reason · citation), then `## Part B` with the LLP 0005 structure, then a final line exactly `READY` or `NOT READY` meaning: is §Coverage, with the author's rulings, ready to serve as the design input for the Snapback 2 authorization spec (LLP 1001+)? Do not edit files. Do not fabricate line numbers — if you did not open a file, say so.
