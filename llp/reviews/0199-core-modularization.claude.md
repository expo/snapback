# LLP 0199 — Claude-family review artifact

Provenance and per-round verbatim reviews for the Claude model family (reviewer:
Claude Fable 5, fresh independent agent — not the reviser/author session).

---

## Round 1 — 2026-08-08

- **Target:** `llp/0199-core-modularization.decision.md`
- **Revision (git blob):** `a517a7508b8afdc1db96712667dc2e74ecf5af8b`
- **Capsule sha256:** `f5dbf6a185f9bb2e16db4231db3822af8e97fea94ddbf00a943531500cabce86`
- **Topology:** single target, independent loop (no cluster)
- **Reviewer:** Claude Fable 5 (fresh general-purpose agent; blind to the GPT review and to orchestrator/author notes)
- **Blindness basis:** structural — no review artifacts existed at launch (round 1); reviewer received only the target + repo read access.
- **Verdict:** READY

### Verbatim review

# Independent Review — LLP 0199 "Incremental core modularization" (Decision, Draft)

## Verification of stated metrics (Correctness)

**God-file line counts — accurate (within fast-`main` drift).** `wc -l`: local.rs 59,575 (doc 59,297), server.rs 50,633 (doc 50,573), storage.rs 36,398 (doc 36,359), manifest.rs 16,633 (doc exact). All within the drift expected on a `main` that moves continuously; the doc uses "~" appropriately.

**Production-lines-before-test-module — accurate.** The trailing `mod tests {` sits at local.rs:31432 (doc ~31,345) and server.rs:26599 (doc ~26,565). storage.rs and manifest.rs have no single trailing test module (69 and 11 `#[cfg(test)]` blocks respectively, interspersed), matching the doc's "tests interspersed."

**Commit-coupling counts — accurate, with a benign methodology mix.** With `--no-merges` (git log --since=2026-07-01): local+server 193, local+storage 122, server+storage 105 — essentially the doc's 192/122/104. But the doc's *per-file* totals (366/459/244/226) match my *with-merges* counts (368/462/245/225), not the `--no-merges` per-file counts (326/409/211). So the doc mixes with-merges (per-file) and no-merges (pairwise) methods. Each number is individually true under a reasonable method, the figures are inherited verbatim from the commissioning ticket `issues/20260808-core-modularization-decision.md`, and the coupling thesis is robust either way. Not material.

**P0/P1 structural claims — independently corroborated by code and by the tickets.**
- P0 (`issues/closed/20260808-P0-migration-rollback-after-reopen-republishes-successor.md`): rollback republishes `self.schema` (loaded as the *successor* at published-held) and persists only `predecessor_schema_hash`, never predecessor bytes — `src/storage/migration_executor.rs`. The doc's owner #2 fix ("rollback artifacts persisted at admission, not reconstructed from live `self.schema`") is the ticket's own fix.
- P1 (`issues/closed/20260808-P1-projection-digest-survives-failed-activation.md`): I confirmed the activation rebuild loop at `src/local.rs:5011-5027` (carrying `@ref LLP 0080#5`) rebuilds projections and commits per-plan digests inside `rebuild_projection_if_stale` (`src/storage.rs:8870`) **before** the manifest installs. The ticket's prescribed fix — "an explicit activation transaction that owns rebuild digests, sequence installs, and the manifest swap as one commit/abort unit" — is verbatim the doc's owner #1. The P1 ticket even states "this is the seam the P0 rollback bug also lives on," independently validating the doc's "single structurally-owned prepare/commit boundary" thesis.

Both defects genuinely live at the generation-activation boundary the doc names. Both are already fixed forward (Lane A, 2026-08-08), consistent with the doc's "land first as fix-forward, then be absorbed by this owner."

**Supporting seams verified.** Asset-under-global-lock finding is real (`issues/shelved/20260808-assets-finalize-memory-and-cpu-under-global-lock.md`, P2, "media CPU inside the single global writer lock") → owner #4. Precedents `src/local/` and `src/push/` exist. Receipt/gate constraints are real: `scripts/runtime-build-inputs.txt`, `cargo clean -p snapback` in `scripts/verify-local-proof`, and 1,882 `@ref` annotations in `src/`. Embed façade confirmed: `src/lib.rs:21 pub mod embed;` + `src/embed.rs`, with lib.rs documenting the `snapback::embed` source-compat policy (LLP 0141) → owner #6. LLP 0038 and 0141 exist as cited.

## Coherence
The six-owner map is internally consistent and the dependency direction (transport → domain services → kernel) is unambiguous: owners 1/3/4 are domain services, 2 is the kernel, 5/6 are transport/adapters. The one seam a careful reader will notice — who literally holds `BEGIN/COMMIT` for the activation transaction, coordinator (#1) or kernel (#2) — is resolved by the stated dependency direction (the coordinator composes the kernel's transaction primitive) and is implementation-phase detail, not a decision defect. The doc is notably *honest* here: it does not overclaim that owner #1 alone fixes the P0 (whose persisted-artifact half is owner #2's), and it surfaces exactly that tension as OQ2.

## Feasibility / Safety / Decision quality
Feasibility is realistically framed: cosmetic (path-preserving module directories, no `@ref`/gate/proof churn) is cleanly separated from semantic (behind characterization tests), and the non-goal against big-bang N-crate decomposition is grounded in the very machinery I verified. No under- or over-claiming of cost. Safety: all load-bearing invariants are named (server authority; SQLite single-writer per LLP 0059; bounded handler execution; language-neutral wire held by the conformance corpus; per-target capability honesty), and owner #4's "prepare outside the global writer, enter through narrow commit ops" is the pattern that removes the asset-under-lock defect *without* violating single-writer. "No total rewrite" is well-argued (accumulated stack value; rewrite recreates the cross-target drift; long-lived branch starves against `main` — the exact CLAUDE.md hazard). Generation-activation-first is well-reasoned and appropriately hedged (Confidence: "Medium on the exact first slice") with the storage/migration kernel offered as the OQ2 alternative precisely because it owns the persisted rollback artifact the P0 needs. Non-goals are correct and complete; OQ1–OQ4 are the right load-bearing author decisions (ratify, first slice, cosmetic-now-or-hold, enforcement mechanism). No load-bearing decision is missing.

## Dispositionable (non-blocking) observations
1. **Metric methodology mix** (per-file with-merges vs pairwise no-merges) and slight staleness vs HEAD — cosmetic; the thesis holds under any method. A one-line "counts as of commissioning date" note would tidy it.
2. **`manifest.rs` (16,633 lines, 226 commits) is listed as a god-file in Context but not explicitly assigned an owner** in the map (the commissioning ticket named owner #1 "Manifest / generation activation coordinator"; the doc dropped "Manifest"). It most plausibly remains a shared domain-types module rather than being "owned" by one service — worth a one-line clarification, but this is per-slice implementation, not a decision defect.

None of these identify a defective decision, an incoherent/ambiguous ownership choice, an infeasible claim, a safety gap, or a missing load-bearing decision. Every load-bearing number and structural claim I checked held up against the code and the independently-authored P0/P1 tickets.

VERDICT: READY

---

## Round 2 (VOID — split-revision) — 2026-08-08

- **Void reason:** orchestrator directory error — this Claude reviewer was pointed at the **primary checkout** `/Users/ccheever/projects/snapback`, whose `llp/0199` is the **original committed Draft**, while the GPT reviewer correctly reviewed the **revised** doc in the refine worktree. The reviewer's own threshold finding (it checked `git status`/`git log` first) caught the mismatch. Reviews not on a common capsule → round void, per LLP 0010 §2. Recorded for provenance; not counted toward convergence.
- **Signal preserved:** reviewing the ORIGINAL, this family independently re-raised exactly the pre-existing concerns the round-1 revision targets (cosmetic-split "no churn" is false → C1; P0/P1 owner conflation → C2), corroborating that the revision is on-target. Its verdict binds to the original Draft, not the revised revision.
- **Verdict (on the original Draft):** NOT READY.

### Verbatim review (Claude, on the ORIGINAL Draft — wrong revision)

# Delta review — LLP 0199 (Incremental core modularization)

## Threshold finding: the described round‑1 revision is not present in the file

I was asked to review the *revised* document and tag each concern IN‑DELTA vs PRE‑EXISTING. Before doing so I checked the file against the repo, and the current committed document does **not** contain the six round‑1 changes my instructions describe:

- `git log -- llp/0199-core-modularization.decision.md` shows a **single** commit (`22674b840 … Decision (Draft)`); `git status`/`git diff HEAD` are empty. Working tree == HEAD == the original Draft.
- Change #4 was to replace the "no gate churn" claim, yet line 130 still reads **"(no `@ref`/proof-gate/test churn)"**.
- Change #5 was OQ1–OQ5, yet the doc has only **OQ1–OQ4** (lines 155–163).
- Change #6 (structural check "now blocking"), the change‑#3 atomicity/crash‑recovery contract language, the change‑#2 "owner #1 composes owner #2's transaction / `manifest.rs` shared‑leaf / Cloudflare‑JS‑vs‑neutral‑contract" clauses, and the change‑#1 metric‑methodology/commit‑pin note are all **absent**.

So there is effectively no delta to review: every concern below is in text that predates (i.e., equals) the original, and is therefore tagged **PRE‑EXISTING**. Nothing can be IN‑DELTA because no text was changed. The substantive concerns below are, notably, the very ones the six changes were meant to resolve — they remain live.

## Concerns

**C1 — MATERIAL — PRE‑EXISTING.** The Sequencing guidance (line 127–132) claims the cosmetic split of the three god‑objects into module *directories* incurs **"no `@ref`/proof-gate/test churn."** This is factually wrong, and I verified it against the exact gate files:
- `scripts/local-proof-selection-policy.v1.json` keys selector/witness lists on **bare file paths** — `"src/local.rs"`, `"src/storage.rs"`, `"src/manifest.rs"` (lines 251, 254, 358, 365–367, 420). Moving code out of those files into `src/local/*.rs` siblings requires co‑migrating these selectors.
- `scripts/guide-lib.mjs` runs **source‑reading generators keyed to specific `.rs` paths** — `['src/server.rs', ['core_route_registrations', …]]` and `readFileSync(join(root,'src/server.rs'))` (lines 521, 548). If a hoisted symbol leaves `src/server.rs`, the generator silently fails to find it unless co‑migrated.
- Dozens of LLP docs cite bare `src/local.rs` / `src/server.rs` / `src/storage.rs` paths that such a split would move.

The document even **contradicts itself**: Non‑goals (line 116) correctly states "drift gates keyed to files" and "the LLP corpus cites `src/` paths in hundreds of `@ref`s," which is the argument against big‑bang crate work — but that same file‑path sensitivity applies to the "cosmetic" module‑directory split, which also relocates code across file paths. The false "no churn" premise directly mis‑costs **OQ3** (approve the split as *low‑risk non‑gated background work*): the correct posture, per LLP 0189 D‑4, is same‑change co‑migration of the file‑path‑keyed selectors, source‑reading generators, and `@ref`s. This is a decision‑quality defect, not an implementation nit.

**C2 — MATERIAL — PRE‑EXISTING.** Internal inconsistency about which owner owns the **P0**. Owner #1 (line 72–73) asserts it is "the fix-shaped home for **the P0** and the projection-digest P1," and the First slice (line 105–107) says **both** the migration/rollback P0 and the projection P1 are "absorbed by this owner" (generation activation). But owner #2 (line 74–78) houses "rollback **artifacts persisted at admission** (not reconstructed from live `self.schema`)" — the P0's actual structural fix — and **OQ2** treats the storage/migration kernel as the alternative first slice "since it owns the persisted rollback artifact the P0 needs." I confirmed against the code that the P0 (the `generationRepublish` fast‑rollback that republishes the predecessor) lives in `src/storage/migration_executor.rs` — owner #2's domain ("republished predecessor generation," "journaled predecessor manifest," `republished_version`), while the P1 projection‑digest/generation‑install path (`install_app_generation`, `clear_projection_plan_digests`) lives in `src/local.rs` — owner #1's domain. So the correct attribution is P0 → owner #2, P1 → owner #1; the flat claim that owner #1 is "the fix‑shaped home for the P0" over‑reaches and re‑conflates the two defects the doc is trying to separate. This muddies the central ownership content and undercuts OQ2's own rationale.

**C3 — MINOR — PRE‑EXISTING.** The Context (line 42–48) collapses P0 and P1 into "the absence of **a single** structurally-owned prepare/commit boundary … no one owner of **the activation transaction**." P0 is the migration‑rollback commit boundary (owner #2's SQLite transaction) and P1 is the projection‑digest composition (owner #1); framing them as one boundary/one owner is the same conflation as C2 at the Context altitude. Dispositionable if C2 is fixed.

**C4 — MINOR — PRE‑EXISTING.** `manifest.rs` is listed prominently in the Context god‑object table (16,633 lines / 226 commits) but is not assigned to any of the six owners; the map neither claims it as a domain nor characterizes it (e.g., as a shared leaf domain‑types module). Small completeness gap; an author can disposition it, but as written the doc raises `manifest.rs` as a problem and then leaves it unaddressed.

**C5 — TRIVIAL — PRE‑EXISTING (non‑blocking).** The line‑count table is already stale against HEAD (e.g. `local.rs` doc says 59,297, actual 59,575; `server.rs` 50,573 vs 50,633). Illustrative, not load‑bearing; the missing methodology/commit‑pin note would make this a clean snapshot but its absence does not affect the decision.

## Altitude note (what I am not blocking on)

The core decision — incremental boundary extraction, no rewrite, no flag‑day cutover, six‑owner downward dependency direction, generation activation as first slice — is sound, well‑argued, and two‑review‑backed; I raise no concern there. The dependency‑direction lint vs ownership‑gate mechanism and advisory‑vs‑blocking choice are appropriately left to the author (OQ4) and are implementation‑detail decisions, not defects. Those do not block.

## Disposition

C1 is a repo‑verified false claim that mis‑costs a recommended action (OQ3), and C2 is a self‑contradiction in the load‑bearing ownership content — both MATERIAL, both in PRE‑EXISTING (original) text. The loop has not converged. Separately, the round‑1 revision described in my instructions is not present in the committed file, so the orchestrator should confirm the revision actually landed before the next round.

VERDICT: NOT READY

---

## Round 3 (real; both families on the worktree revision) — 2026-08-08

- **Target revision (git blob):** `0530bc263092b5ae54064c37ec9e4663774aa0b7`
- **Capsule sha256:** `aaff94c26986b4fa11ee225ee62195fe637869378e63d2d065db65780ea8170c`
- **Topology:** single target, independent loop; reviewer correctly pointed at the worktree revision this round.
- **Blindness basis:** structural — review artifacts removed from the worktree during the round.
- **Reviewer:** Claude Fable 5 (fresh general-purpose agent).
- **Verdict:** READY. 3 non-material dispositionable notes (2 IN-DELTA trivial/minor, 1 PRE-EXISTING trivial).

### Verbatim review (Claude, round 3)

**Review of LLP 0199 (round-1 super-refine revision) — reviewer 2**

I read the working-tree revision in full and independently corroborated the claims the revision rests on against the shared repo at HEAD.

**Verification performed (all confirmed):**
- **P0 home / P1 home distinct.** `src/storage/migration_executor.rs` exists (338 KB) and contains the migration kernel's rollback / predecessor-at-admission / persisted-fence machinery; `src/local.rs` contains `install_app_generation`, `clear_projection_plan_digests`, and `install_sequence_declarations` — the generation-activation/projection-digest surface. The two highest-severity defects genuinely sit at two different boundaries in two different files, so the IN-DELTA reframing ("same discipline gap at two owners, not one defect with two candidate owners") is factually grounded, not rhetorical.
- **manifest.rs is not a leaf.** Confirmed direct coupling to higher-level subsystems: `crate::identity` (37), `crate::vector` (27), `crate::push` (7), `crate::assets` (6), `crate::auth` (5), plus rqs/search/completeness/etc. The revised owner-#1 text and the "shared contract/types leaf" sequencing item accurately describe this.
- **File-path-keyed machinery exists.** `scripts/local-proof-selection-policy.v1.json` names `src/local.rs`, `src/storage.rs`, `src/manifest.rs` explicitly (it does not name `src/server.rs`, and the doc does not claim it does); `scripts/guide-lib.mjs` reads `src/server.rs`; `scripts/capability-maturity.mjs` reads `src/manifest.rs`. `src/local/` and `src/push/` exist as split precedents. The corrected cosmetic-split guidance (same-change co-migration) is well-founded.
- **LLP 0189 D-4** genuinely embodies the "coverage moves in the same change; it never vanishes" principle the doc invokes.

**Assessment against the altitude rule.** As a Decision doc this is judged on decision quality, and it is high: it records the ownership map, downward dependency direction, the atomic-transition invariant vs deferred commit *mechanism* split (owner #1 → OQ3), transaction boundaries (owner #2 owns the commit primitive owner #1 composes), semantic-vs-cosmetic separation, and a coherent OQ1–OQ5 set that correctly routes the genuinely-author's calls to the author. Internal consistency holds across Context, Decision, First slice, and OQ2 — the P0/P1 distinction is stated identically in all four places. The revision history's claimed changes are all present and each is corroborated above.

**Remaining concerns (none material):**

1. **IN-DELTA, TRIVIAL.** The Sequencing bullet cites `check-capability-maturity.mjs` as the generator that "reads `src/manifest.rs`." Strictly, the `readFileSync('src/manifest.rs')` lives in the imported library `scripts/capability-maturity.mjs`; `check-capability-maturity.mjs` is a thin CLI wrapper that calls into it, so it reads the file only transitively. The substantive point (a source-reading generator keys on `src/manifest.rs`) is correct. Dispositionable.

2. **IN-DELTA, MINOR (dispositionable).** The D-4 gloss "a gate must stay attached to its governed code" slightly broadens D-4 — which is literally about qualification-digest coverage / frozen-record drift gates — to also govern selectors, source-reading generators, and `@ref`s. The generalization is in the correct spirit, and the same-change co-migration requirement is independently correct for each of those (e.g. `@ref`s are additionally governed by `./ref-check`), so the guidance is sound even where the exact D-item is a loose fit. Identifies no defective decision.

3. **PRE-EXISTING, TRIVIAL.** The line/commit-count table is pinned to commissioning commit `22674b8` and `main` has drifted slightly past it (e.g. `local.rs` now 59,575 vs 59,297 lines). The doc explicitly hedges this and the coupling thesis holds regardless. Properly handled.

No family-material concern in PRE-EXISTING text, and the revisions introduced no material concern — they are internally consistent and factually accurate. Convergence condition met from my side.

VERDICT: READY
