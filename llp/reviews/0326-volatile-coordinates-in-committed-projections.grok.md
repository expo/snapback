# LLP 0326 cluster — grok review

Cluster review covering **LLP 0326** (RFC) and **LLP 0326.000** (Plan),
reviewed lockstep. Preserved verbatim; per-target verdicts are in the body.

## Round 1 — 2026-08-28

- Reviewer: `grok-4.6` @ xhigh, headless, terminal denied, cwd isolated outside the repository
- Run: launch 2 (launch 1 voided: `--max-turns 1` exhausted before a review was produced)
- Runtime: 319s
- Instruction sha256: `60c453f3d3602084…`
- Revision hashes reviewed:
  - A `24d77757b35bddc38f7c0933936a069317e1031f45cab5522489621f2f204a3d`
  - B `e7667087dbaceb9765b076bb6e67ee411e08f29f6715badfdea509459558e735`
- Blindness: no `llp/reviews/0326*` artifact existed at launch; both
  reviews were received before either was written. Grok additionally had
  no repository access at all.

### Verbatim review

I'll read REVIEW-PACKET.md and follow its instructions exactly.## Summary

Option A is the right ruling. The audit’s production conclusion holds: nothing in the served or packing path computes on `line`/`column`; the public package already strips `sites` entirely, so the lost `snapback guide <CODE>` pinpoint is contributor-only; and the 30-day figures that can be checked from the packet are internally consistent (624/4,780 = 13.1%; 9,586+607+11 = 10,204; kind 378+218+11 = 607; environment kinds sum to 367; 10,204+367 = 10,571; 5,215+281 = 5,496; 1,698,742/2,526,048 = −32.8%). Declining B is sound once that distribution finding is in: B pays packing-contract complexity (the class of claim that withdrew LLP 0314.001) for a display affordance published clients never see. Landing 0314.002 before Stages 1–4 is the correct timing given an in-flight bit-stable encoder. Stage 0 for C as a fail-open independent hook is the right split.

The cluster is still not READY. Parent and child disagree on the published record shape the ruling adopted; the parent’s audit result is false as written; the child’s summary still states the claim revision (b) retracted; and Stage 2.2 rewords pagination elision to “files” even though the child’s own key is `(file, kind, synthetic)`. Those are uncorrected correctness/coherence defects, not missing implementation color. Arithmetic, scope exclusions (vocabulary, symbol registry, packing, custody, 0189/0232 fix-forward), the internal-vs-published split, the three `schemaVersion` pins, truncation-fixture re-derivation, and the removals-script clearance are the parts that hold.

## Concerns

[MATERIAL] [both] — RFC §3 Option A still specifies published sites as `{ "file": "..." }`, deduped per code on `file`, with sort key “`file` plus a stable index.” Plan §1.2 shows that key is wrong: diagnostics sites also carry `kind` (`received`/`declaration`/`reserved`) or `synthetic`, environment sites carry a different seven-value `kind` vocabulary, and the served surface exposes that classification. A naive `file` collapse “silently merges a `read` with a `write`.” The parent never mentions `kind`, `synthetic`, or the `environment` block, yet the author ruling already quotes the child’s both-blocks totals (10,571 → 5,496). The child is the sequence for that ruling, so the cluster currently adopts two different shapes. Fix: amend RFC §3 Option A, §4, §5, and OQ2 to the `(file, kind, synthetic)` projection on both blocks; state that the ruling is “drop `line`/`column`,” not “collapse to file-only.” Until that edit, do not implement from the RFC alone.

[MATERIAL] [A] — RFC summary and §2e claim “10,204 site records, every one carrying all three fields” and “No consumer computes on `line` or `column`.” Both are false as stated. The artifact also has 367 `environment` sites with coordinates (plan §1.1); the 2,526,048-byte figure is the whole file, so the headline pairs a diagnostics-only count with a whole-artifact size. Four tests in `generate-diagnostics-registry.test.mjs` (plan §2a, lines 1809/1867/2031/2219) read `registry.diagnostics[code].sites` and index source with `site.line` — that is computation on `line`, missed by the “every reader” audit. This is the same class of overclaim that withdrew LLP 0322 / 0314.001. The child remediates the landing (do both blocks; relocate the four tests) but the parent still publishes the bad audit result. Fix: add environment and the locator tests to §2; change §2e to “no production consumer computes on coordinates; generator tests currently do, through the published artifact”; use 10,571 (or split the table) in the summary.

[MATERIAL] [B] — Plan summary still says the internal/published split lets locator tests “keep working untouched.” Revision (b) and §2a say the opposite: those four assertions read the published artifact and must move onto `diagnosticSourceSites` in Stage 1, and “do not let ‘the tests still pass’ be the signal.” The load-bearing sentence of the summary is the retracted draft claim. Fix: rewrite the summary to match §2a (projection-only change plus relocating four tests).

[MATERIAL] [B] — Stage 2.2 orders the elision string rewritten “from sites to files.” Acceptance 2 and §1.2 keep `kind`/`synthetic`, so one file can be several published records (`read` vs `write`; unkinded emit vs `received` in the same file). Pagination is `DIAGNOSTIC_PAGE_SIZE = 24` records, not unique files. Shipping “files” misstates the served contract and contradicts Stage 1.4 (`emittingSites` still means sites; published record counts are separate). Fix: count and name published site records (or keep “sites” and document the meaning shift). Do not say “files” unless the key is actually `file`.

[DETAIL] [A] — §7 still lists OQ3 as unmeasured (“estimate in §3 is deliberately unquantified”) after the author ruling and §3’s neighbor paragraph already give 2,526,048 → 1,698,742 and the 60-commit replay. OQ4 is likewise still open after the public-package finding “narrows OQ4 substantially.” Stale open questions. Close OQ3 with the measured table; restate OQ4 as residual (external parsers that require `line`/`column` on contributor `snapback guide` payloads).

[DETAIL] [A] — Header status is Review (revision c) while the author-ruling paragraph still says “The RFC itself remains Draft and unreviewed.” Dead text. Drop it.

[DETAIL] [A] — “Kills the recurrence class outright” overstates a ~75% restamp cut. File splits/renames (LLP 0325, named in §9) still restamp a file-level projection; plan §6 already notes that residual. Soften Option A to “kills line-drift restamps.”

[DETAIL] [B] — “Leaves half the problem” (plan §1.1) is false: environment is 367/10,571 ≈ 3.5% of sites. The real reason to include it is artifact coherence, not magnitude. Strike “half.”

[DETAIL] [B] — §2 emits `{file, kind?, synthetic?, count}` while OQ2 still asks whether to keep `count`. The 624 → ~156 projection is a “file-level” replay; if that replay ignored count-only edits, publishing `count` makes ~156 optimistic. Either close OQ2 (keep or drop `count`) and say whether the 60-commit replay included count changes, or mark the restamp figure as a lower bound on residual churn.

[DETAIL] [B] — Acceptance 3 (“No *other* generator test needed editing; if one did, the internal/published split was not respected”) collides with the necessary fixture/shape updates for a v2 projection. Treat unexpected scanner edits as the smell; expected snapshot/schema updates are in scope. Align with RFC §5.6.

[DETAIL] [B] — Stage 3 only names the diagnostics.md “First registered site” column for OQ5. Any other guide/schema prose that documents site `line`/`column` is a paved-form edit under the same AGENTS.md rule and is not listed. Add a pass over registry-shape documentation, not just the table cell.

[DETAIL] [B] — Stage 0 correctly forbids fail-closed on ordinary `origin/main` pushes but does not say what the hook does with a regeneration diff (write, warn, abort). Spell fail-open behavior so this cannot land as an accidental veto under LLP 0189/0232.

[DETAIL] [both] — Line/path pins in the packet cannot be verified from the packet itself. One such claim was already wrong (locator tests “untouched”). Remaining pins (`generate-diagnostics-registry.mjs:321–325/:664/:679/:704/:726`, `guide_reference.rs:73/:133–149`, test lines 1809/1867/2031/2219, `generate-docs-site.mjs:828`, `reference-lookup.test.mjs:39/:186`, removals `:220`) should be re-checked at implement time; do not treat them as gospel.

Not a concern: the three `schemaVersion` pins including the Rust hard equality; pagination-by-count plus byte budget; re-derive-not-greenwash of truncation fixtures; `diagnostic_for_distribution` left untouched as a leak canary; no migration shim for `diagnostics-registry-removals.mjs`; Stages 1–4 as one commit; Stage 5 bookkeeping; 0194 as optional co-land. Those are the right landing hazards.

## Verdict — LLP 0326: NOT READY
## Verdict — LLP 0326.000: NOT READY
## Verdict — cluster: NOT READY

## Round 2 — delta round — 2026-08-28

- Reviewer: grok (same model/effort as round 1)
- Runtime: 370s
- Mode: delta round. Every concern classified IN-DELTA vs PRE-EXISTING;
  the family's own round-1 punch list supplied for disposition checking.
  Cross-family blindness preserved: each family received only its own
  punch list, and codex was barred from `llp/reviews/`.
- Revision hashes reviewed:
  - A `204bd4ec23596199df9553d19df112375b04b7e5908d97604881d755dd9d9935`
  - B `dcbcfcfa08ed3aff77f735d802ac40bf34eab744164af68df3f3b30e1ebe46f7`

### Verbatim review

I'll read REVIEW-PACKET.md and follow it exactly.## Punch-list verification
- M1. CONFIRMED-FOLDED — A §3 Option A now publishes `{file, kind?, synthetic?, count}` keyed on `(file, kind, synthetic)` for both blocks, matching B §1.2 / §2 / Acceptance 1.
- M2. CONFIRMED-FOLDED — A Summary counts 10,204 + 367 = 10,571; §2e now includes environment reachability, the two formatters, and the locator tests, and the conclusion is restated.
- M3. CONFIRMED-FOLDED — B Summary no longer carries the 624 → ~156 restamp claim; restamp frequency is explicitly unchanged in §1.7 / §6.
- M4. CONFIRMED-FOLDED — B Stage 2.2 now rewords the elision unit to "site records" and gives the multiplicity-under-the-key reason.
- D1. CONFIRMED-FOLDED — A OQ3 is closed with bytes, median diff, and unchanged restamp frequency.
- D2. CONFIRMED-FOLDED — A OQ4 is restated as a public-schema-change question about external parsers.
- D3. CONFIRMED-FOLDED — Live "remains Draft" wording is gone from the author ruling (the Revised (b) line is historical).
- D4. CONFIRMED-FOLDED — A Option A now kills "line-drift restamps" and names file-split and `sourceDigest` residuals.
- D5. FOLDED-INCORRECTLY — B §1.1 still says a diagnostics-only change "leaves half the problem"; 3.5% is not stated; only the coherence clause is present.
- D6. CONFIRMED-FOLDED — B OQ2 recommends keeping `count`, and §6 records the multiplicity-restamp cost.
- D7. CONFIRMED-FOLDED — B Acceptance 3 now treats scanner edits as the smell and projection/fixture/schema edits as in scope.
- D8. CONFIRMED-FOLDED — B Stage 3 now sweeps the whole documented registry shape, not only the column.
- D9. CONFIRMED-FOLDED — B Stage 0 now gives advisory (exit 0) vs check-and-refuse, and recommends advisory.
- D10. CONFIRMED-FOLDED — B OQ6 requires re-verify at implement time and records the 2026-08-28 pin check.

## Concerns
[MATERIAL] [IN-DELTA] [B] — D5 was claimed FOLDED, but B §1.1 still says covering only `diagnostics` "leaves half the problem." Environment is 367 / 10,571 records (3.5%), not half. Strike that phrase, state 3.5%, and keep incoherence as the reason.

[MATERIAL] [IN-DELTA] [both] — A Option C still claims the hook "stops them reaching `main` stale." B Stage 0, rewritten this round, says a pre-push hook cannot rewrite the already-created commit, and the recommended advisory form exits 0 and does not prevent a stale artifact from landing. Restate A Option C (and the "backstop" sentence in Recommendation) to match B Stage 0.

[MATERIAL] [IN-DELTA] [both] — A §5.1 now requires preserving the `sitePriority` primary term at `generate-diagnostics-registry.mjs:321` because it feeds subsystem classification and is not equivalent to `:704`/`:726`. B Stage 1.2 still says replace all three comparators, including `:321`, with an order over the published `(file, kind, synthetic)` key, which has no `sitePriority` term and would violate B Acceptance 7. Rewrite Stage 1.2 to keep `sitePriority` as the `:321` primary term and replace only the line/column fallback.

[MATERIAL] [PRE-EXISTING] [A] — §8 still presents the recurring saving as "624 commits per 30 days currently carry a 2.5 MB restamp, three quarters of them for no diagnostic change." The revised Summary and Author ruling retract the frequency benefit; restamp count stays ~624. Re-base §8 on median 734 → 8 changed lines and unchanged frequency.

[MATERIAL] [PRE-EXISTING] [B] — Summary still says the generator's correctness tests "keep working untouched." §2a says they will not, must be relocated onto `diagnosticSourceSites`, and are not even the whole set. Delete "untouched" and point at the §2a inventory / relocation.

[DETAIL] [IN-DELTA] [A] — Summary still says "no consumer computes on line or column." Revised §2e says locator tests "compute on them through the published artifact" and the corrected conclusion is that no consumer *branches* on them. Use "branches" in the Summary.

[DETAIL] [IN-DELTA] [A] — New §2c-bis makes the two formatters mandatory (silent-drop / `:undefined:undefined`). §4 in-scope and §5 landing checklist still omit them. Add them to both; B Stage 1.5 already has the work.

[DETAIL] [IN-DELTA] [A] — Summary's typical "8-line change" excludes `sourceDigest`, which still changes under Option A, so a typical committed diff is not 8 lines. Say 8 non-identity content lines, plus the digest line.

[DETAIL] [IN-DELTA] [B] — §1.4 retracts `reference-lookup.test.mjs:186` as a schema pin; §1.3 and Stage 1.3 still say update "all three pins." Drop `:186` from the pin list; keep the fixture update in Stage 2.

[DETAIL] [IN-DELTA] [B] — The 0314.002 sequencing note still says "32.8% smaller registry," which is the superseded 1,698,742-byte file-only-dedupe figure. Use §6's 31.3%.

[DETAIL] [IN-DELTA] [B] — §1.5 sends HTTP/MCP/docs-site qualification to "§4.8"; no such section exists. Point at Acceptance 6.

[DETAIL] [IN-DELTA] [B] — §2a says the four named locator tests are not the whole set, then closes with "the four tests that reach through it." Say the inventory, not "four."

[DETAIL] [PRE-EXISTING] [A] — OQ2 is still titled "Deduplicate by file?" and left open, after Option A rules the key is `(file, kind, synthetic)` and already includes `count`. Close or retitle it to match B OQ2 (keep `count`, author to confirm).

## Verdict — LLP 0326: NOT READY
## Verdict — LLP 0326.000: NOT READY
## Verdict — cluster: NOT READY

## Round 3 — delta round (final budgeted round) — 2026-08-28

- Reviewer: grok (same model/effort)
- Runtime: 381s
- Revision hashes reviewed:
  - A `027f600f5fb171b6dd66b0a1206abe2fa5b15dc645f40132e5ee2818e6915863`
  - B `467388b614adb0708d2ba7fee4cf00d636632627311fd8a47d1bbc77ff9f0fba`

### Verbatim review

I'll read REVIEW-PACKET.md and follow its instructions exactly.## Punch-list verification
CONFIRMED-FOLDED — B Summary: “keep working untouched” is gone; blast radius now points at the §2a inventory.
CONFIRMED-FOLDED — B 1.1: “half the problem” is gone; 3.5% and coherence-not-magnitude are stated.
CONFIRMED-FOLDED — B 1.3 + Stage 1.3: two validating pins named; `:186` called not a pin and deferred to Stage 2 (heading leftover noted below).
CONFIRMED-FOLDED — B Stage 1.2: `:321` keeps `sitePriority`; only `line`/`column` fallback terms are replaced.
CONFIRMED-FOLDED — B Stage 0: regenerate against the pushed tip, not the ambient worktree.
CONFIRMED-FOLDED — B 1.5: published-surface qualification cites acceptance 6.
CONFIRMED-FOLDED — B 2a: retitled; work is an inventory, not a four-line fix (closer leftover noted below).
CONFIRMED-FOLDED — B sequencing note: 31.3%, not 32.8%.
FOLDED-INCORRECTLY — B OQ2: “RULED KEPT” is present, but “Author to confirm.” is still there, so the open/confirm contradiction is not closed.
CONFIRMED-FOLDED — B 6: bounded estimate, not a measurement; median 7 vs 8 and ~17,800 vs 20,824; acceptance 9 at Stage 4.
CONFIRMED-FOLDED — A Summary: “branches”; “8 content lines plus the `sourceDigest` line”; OQ1-ruled so no confidence on the choice.
CONFIRMED-FOLDED — A Option C + Recommendation: cannot prevent staleness; advisory vs refusing distinguished.
CONFIRMED-FOLDED — A 4 Scope: both blocks, both formatters, coordinate-coupled tests.
CONFIRMED-FOLDED — A 5: steps 8–9 for formatters and locator relocation; B §2a authoritative for the inventory.
CONFIRMED-FOLDED — A 8 Cost: re-based on diff volume with an explicit method limit.
CONFIRMED-FOLDED — A OQ2: CLOSED; key is `(file, kind, synthetic)` and `count` is kept.

## Concerns
[MATERIAL] [IN-DELTA] [B] — §8 OQ2 is titled RULED KEPT and says the residual is “noted as a §6 caveat rather than left open,” then ends “Author to confirm.” That is the same open/confirm contradiction this delta claimed to close, and it is a false FOLDED disposition. Delete “Author to confirm.” Strike the item CLOSED (same form as A OQ2). Leave the keep-`count` rationale and the multiplicity-restamp residual as closed record, not a pending author action.

[DETAIL] [IN-DELTA] [B] — §1.3 heading still reads “pinned in three places” and the bullet list still presents `reference-lookup.test.mjs:186` as a third assertion site; only the following paragraph demotes it. Rename the heading to two validating pins and drop `:186` from the pin list (keep it in §1.4 as a fixture).

[DETAIL] [IN-DELTA] [B] — §2a’s last sentence still says the change “touches … the four tests that reach through it,” which restores the framing the inventory replaced. End on the inventory plus projection/consumer updates.

[DETAIL] [IN-DELTA] [B] — Acceptance 1 requires the `(file, kind, synthetic)` key and surviving classifications, not the presence of `count`. If `count` is kept, say so there so a countless projection cannot pass.

[DETAIL] [PRE-EXISTING] [A] — §2a still shows `:321–325` as `file` then `line` then `column` and calls that “the same comparator” as `:704` and `:726`. §2e, §5, and B Stage 1.2 say `:321` is not equivalent and that `sitePriority` is primary. Cite the `sitePriority` term at `:321` and stop calling the three comparators the same.

[DETAIL] [PRE-EXISTING] [B] — §2’s “Keep all of that.” wraps the published-artifact `.split('\n')[sites[0].line - 1]` snippet. Restrict “keep” to the scan API and internal coordinates; the published-artifact locators move per §2a.

[DETAIL] [PRE-EXISTING] [B] — Stage 2 says “Keep Stage 1.4’s distinction.” There is no Stage 1.4. Point at Stage 1 step 4 / §1.4.

[DETAIL] [IN-DELTA] [A] — Summary and OQ3 still present 734 → 8 as a closed measurement; §8 now says those figures are a bounded estimate, not a measurement. Point OQ3 (and the Summary table lead-in) at the §8 method limit.

## Verdict — LLP 0326: READY
## Verdict — LLP 0326.000: NOT READY
## Verdict — cluster: NOT READY
