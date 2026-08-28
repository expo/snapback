# LLP 0326 cluster — codex review

Cluster review covering **LLP 0326** (RFC) and **LLP 0326.000** (Plan),
reviewed lockstep. Preserved verbatim; per-target verdicts are in the body.

## Round 1 — 2026-08-28

- Reviewer: codex `gpt-5.6-sol` @ xhigh, read-only sandbox on the repository
- Run: launch 2 (launch 1 voided: wedged on stdin, produced no model output)
- Runtime: 954s
- Instruction sha256: `557d124f00c72070…`
- Revision hashes reviewed:
  - A `24d77757b35bddc38f7c0933936a069317e1031f45cab5522489621f2f204a3d`
  - B `e7667087dbaceb9765b076bb6e67ee411e08f29f6715badfdea509459558e735`
- Blindness: no `llp/reviews/0326*` artifact existed at launch; both
  reviews were received before either was written. Grok additionally had
  no repository access at all.

### Verbatim review

## Summary

The cluster is not ready. Several baseline facts are confirmed: the artifact is 2,526,048 bytes; `diagnostics` has 10,204 sites; `environment` has 188 variables and 367 sites; all stated shape and `kind` counts are correct; the 624/537 commit counts and 30-of-40 `"code"` observation reproduce; the removal-history code ignores site shape; and landing LLP 0314.002 first is reasonable.

However, the central churn-reduction estimate overlooks `buildIdentity.sourceDigest`, the public-surface audit is incomplete, the implementation plan misses real coordinate consumers, and its projected counts use the wrong deduplication key. Option A remains plausible for reducing diff volume, but the documents do not currently establish their claimed outcome.

## Concerns

1. [MATERIAL] [both] — Option A does not produce the claimed reduction in registry restamps. `scripts/generate-diagnostics-registry.mjs:608–613` hashes the raw bytes of every `inputPaths` entry, while `:730–747` includes all production sources and guide Markdown and publishes that hash as `buildIdentity.sourceDigest`. Removing `line`/`column` leaves this mechanism unchanged, so an unrelated line shift still changes the committed registry and makes `--check` report it stale. In the latest 60 registry commits, 57 changed `sourceDigest`. Therefore “kills the recurrence class,” “only 15 changed anything,” and 624→~156 restamps do not describe the proposed v2 artifact. The confirmed 30-of-40 no-`"code"` metric proves only that code rows did not change, not that coordinates were the only semantic change. Fix by either redesigning the committed identity to hash a semantic projection while preserving necessary build binding elsewhere, or reframing the benefit as smaller diffs/less Markdown churn while acknowledging that registry staleness frequency remains. Then replay the exact proposed v2 bytes.

2. [MATERIAL] [both] — the claim that coordinate loss is contributor-only is false. `diagnostic_for_distribution` removes `sites` only from exact diagnostic lookup. The raw registry remains a published surface: `scripts/guide-lib.mjs:1229–1238` declares HTTP, MCP, and llms projections; `crates/snapback/tests/served_guide_v1.rs:368–379` proves the server returns the exact registry bytes; and `scripts/generate-docs-site.mjs:961` copies those bytes into the published docs site. Thus published HTTP/MCP/docs-site consumers currently can receive coordinates, and LLP 0326.000 §1.5/§7’s “published consumers never receive sites” and “does not change published-package output” are wrong. Fix the consumer audit, describe v2 as a public registry-schema change, add the relevant HTTP/MCP/docs-site qualification, and reconsider the A-versus-B rationale using that corrected reachability.

3. [MATERIAL] [both] — two actual coordinate consumers are omitted and would regress. Native `format_lookup` at `crates/snapback-server/src/guide_reference.rs:606–615` dereferences `file`, `line`, and `column`; the package formatter at `packages/snapback-cli/reference-lookup.mjs:449–472` does the same for diagnostic and environment sites. With the planned records, native output would print an “Emitting sites” heading with no rows, while JavaScript output would contain `:undefined:undefined`. This contradicts A’s “only consumer inside the shipped binary” audit, and B has no formatter stage. Fix both formatters and their native/package tests to render file, classification, and multiplicity under the chosen v2 semantics.

4. [MATERIAL] [B] — the generator-test survey is substantially incomplete and internally contradictory. The four named assertions at lines 1809, 1867, 2031, and 2219 do read the published artifact, as claimed. But additional published-artifact coordinate assertions occur at lines 1615/1622, 1631, 1695, 1725, 1822, and 1939, among others; several also assert raw occurrence cardinality that deduplication changes. The Summary says the locator tests “keep working untouched,” §2a says they must move, and Acceptance 3 incorrectly requires that no other generator test be edited. Fix by inventorying every assertion coupled to coordinates or raw-site cardinality, relocating locator assertions to an internal located-site seam, and adding separate v2 projection/deduplication tests.

5. [MATERIAL] [both] — the projected measurements contradict the declared deduplication key. Applying `(file, kind, synthetic)` to the current artifact produces 5,385 diagnostic records and 281 environment records, totaling 5,666. The documented 5,215 diagnostic figure is exactly the result of deduplicating diagnostics by `file` alone, which merges emission/declaration/received classifications; 169 current code/file pairs contain multiple classifications. Projecting the current JSON to the declared `{file, kind?, synthetic?, count}` shape produces approximately 1,735,037 bytes before adding new count metadata, not 1,698,742. A also rules `{file}` while B rules `(file, kind, synthetic)`, and B simultaneously declares `count` in §2 while leaving it open in OQ2. Fix both documents to settle one exact record schema, remeasure it, and define how global counts, per-code Markdown “Sites,” guide prose claiming “every site,” pagination, and formatter output derive from grouped `count` values.

6. [MATERIAL] [B] — the pagination and schema-pin survey contains false claims. `tests/fixtures/guide-symbol-lookup-v1.json`, consumed by `reference-lookup.test.mjs:39`, contains no diagnostic cases. No current diagnostic record approaches the 16,384-byte budget—the largest is roughly 6.7 KB—so no real code “that truncates today” has a fixture that will stop truncating. The relevant package coverage is instead the synthetic combined diagnostic/environment fixture at lines 169–279. Also, `reference-lookup.test.mjs:186` merely constructs a v1 synthetic object; `reference-lookup.mjs` never asserts the diagnostics-registry schema. Finally, rewording elision to “files” is incorrect because `(file, kind, synthetic)` can produce multiple records per file. Fix the inventory, update the synthetic fixture intentionally, test diagnostic/environment/combined grouping and paging, call the paginated units “records” or “site groups,” and include the docs-site schema check in acceptance.

7. [MATERIAL] [both] — Option C’s pre-push behavior is infeasible as described. A Git pre-push hook runs after the pushed ref’s commit exists. Calling the manifest generator can modify the worktree, but those bytes are not part of the commit already being pushed. Therefore a non-fail-closed hook can expose staleness but cannot “stop it reaching main stale,” while B explicitly requires that ordinary `origin/main` pushes remain non-fail-closed. Fix by choosing and documenting one honest behavior: advisory regeneration for visibility only, or a check-and-refuse/retry workflow authorized against LLP 0189/0232. Do not claim both prevention and non-blocking operation.

8. [MATERIAL] [A] — the parent’s current normative state is internally stale. Its header says `Status: Review`, but the Author ruling says it “remains Draft and unreviewed.” Its landing checklist says to change the site-record shape in `diagnostics-registry-source.mjs`, while the child correctly observes that this module returns matches/offsets and that only the generator projection should change. It also calls the `:321` comparator the same as `:704`/`:726`, although `:321` has an additional `sitePriority` ordering that protects subsystem classification. Fix A to reflect its actual status, the child’s exact ruled schema and scope, the unchanged scanner API, and the requirement to preserve and test `sitePriority`.

## Verdict — LLP 0326: NOT READY
## Verdict — LLP 0326.000: NOT READY
## Verdict — cluster: NOT READY

## Round 2 — delta round — 2026-08-28

- Reviewer: codex (same model/effort as round 1)
- Runtime: 1213s
- Mode: delta round. Every concern classified IN-DELTA vs PRE-EXISTING;
  the family's own round-1 punch list supplied for disposition checking.
  Cross-family blindness preserved: each family received only its own
  punch list, and codex was barred from `llp/reviews/`.
- Revision hashes reviewed:
  - A `204bd4ec23596199df9553d19df112375b04b7e5908d97604881d755dd9d9935`
  - B `dcbcfcfa08ed3aff77f735d802ac40bf34eab744164af68df3f3b30e1ebe46f7`

### Verbatim review

## Punch-list verification

1. FOLDED-INCORRECTLY — The `sourceDigest` retraction is real, but the replacement 734→8 claim filters v1 diffs instead of replaying the proposed v2 projection.
2. CONFIRMED-FOLDED — A §2c and B §1.5 correctly establish HTTP, MCP, llms-index, and docs-site reachability and treat v2 as public.
3. NOT-FOLDED — The consumers appear in the audit and B, but A §5 still omits both formatter changes and describes the Rust path as effectively shape-agnostic.
4. NOT-FOLDED — B §2a and acceptance 3 add the inventory, but B Summary still says the locator tests “keep working untouched.”
5. NOT-FOLDED — The key and record counts reproduce, but OQ2 remains open in A and ends “Author to confirm” in B, so the schema is not settled.
6. NOT-FOLDED — B §1.4 retracts the third pin, while B §1.3 and Stage 1 still require “all three pins,” including the non-pin fixture.
7. NOT-FOLDED — B Stage 0 is corrected, but A Option C still says regeneration alone stops stale bytes reaching `main`.
8. NOT-FOLDED — The named Draft/source-script/sitePriority edits landed, but A remains internally stale in its landing checklist and its 0.6 confidence on already-ruled OQ1.

## Concerns

[MATERIAL] [IN-DELTA] [both] — The new diff-volume result is not an Option-A replay. It filters `line`/`column`/`sourceDigest` from v1 diffs, despite v2 deduplication, `count`, stable reordering, and retained `sourceDigest`. A direct current-sample replay of the stated projection gives median 7 and total 17,797 changed lines, not 8 and 20,824. Settle ordering/count, generate both historical v2 artifacts, and diff the actual committed representation.

[MATERIAL] [IN-DELTA] [both] — The record schema remains contradictory: both documents mandate `count`, but A OQ2 remains open and B OQ2 says “Author to confirm.” Rule it closed in both documents before relying on its size, formatting, or multiplicity claims.

[MATERIAL] [IN-DELTA] [B] — The schema-pin correction is internally contradicted. §1.3 and Stage 1 still identify three pins, while §1.4 correctly establishes that `reference-lookup.test.mjs:186` is only fixture construction. State two validating consumers and handle the fixture separately in Stage 2.

[MATERIAL] [IN-DELTA] [B] — Summary says coordinate-dependent tests remain untouched, directly contradicting §2a and acceptance 3. Replace that statement with the required relocation/inventory.

[MATERIAL] [IN-DELTA] [A] — §5 still omits the two formatter migrations and locator-test relocation, despite the new audit proving they are required. Add them explicitly or make LLP 0326.000 the authoritative replacement for the checklist.

[MATERIAL] [IN-DELTA] [both] — Option C remains contradictory: A promises stale commits will not reach `main`, while B recommends exit 0 and explicitly says stale artifacts can land. Align A with the advisory behavior or authorize the refusing behavior.

[MATERIAL] [IN-DELTA] [B] — Stage 0 selects inputs from pushed OIDs but regenerates from the ambient worktree. That output may reflect dirty or later state rather than the pushed commit. Run against an isolated pushed-tip checkout, or require a clean HEAD equal to the pushed tip and skip otherwise.

[DETAIL] [IN-DELTA] [B] — §1.1 still says the environment block is “half the problem”; it is 367 of 10,571 records, about 3.5%. Replace this with the coherence rationale promised by the delta.

[DETAIL] [IN-DELTA] [both] — The projected 1,735,036-byte size omits the generator’s final newline; the reproduced output is 1,735,037 bytes before adding Stage 1’s required top-level record-count fields. Recompute after fixing the schema.

[DETAIL] [IN-DELTA] [B] — The stated 6,781-byte largest record does not reproduce: the raw record is 6,255 bytes and the full CLI lookup is 6,734 bytes. The no-truncation conclusion remains correct.

[DETAIL] [IN-DELTA] [B] — §1.5 points public-surface qualification to §4.8; the relevant criterion is §4.6.

[DETAIL] [PRE-EXISTING] [A] — Summary still assigns 0.6 confidence to choosing OQ1 after the author has ruled it. Remove or redirect that confidence statement.

[DETAIL] [PRE-EXISTING] [B] — The sequencing note retains the superseded 32.8% reduction; the corrected figure is 31.3%.

## Verdict — LLP 0326: NOT READY
## Verdict — LLP 0326.000: NOT READY
## Verdict — cluster: NOT READY

## Round 3 — delta round (final budgeted round) — 2026-08-28

- Reviewer: codex (same model/effort)
- Runtime: 702s
- Revision hashes reviewed:
  - A `027f600f5fb171b6dd66b0a1206abe2fa5b15dc645f40132e5ee2818e6915863`
  - B `467388b614adb0708d2ba7fee4cf00d636632627311fd8a47d1bbc77ff9f0fba`

### Verbatim review

## Punch-list verification

CONFIRMED-FOLDED — B Summary removes “keep working untouched” and points to §2a’s inventory.

CONFIRMED-FOLDED — B §1.1 removes “half the problem” and gives the correct 3.5% coherence rationale.

FOLDED-INCORRECTLY — B §1.3 and Stage 1.3 identify two validators, but §1.3’s heading and opening list still say three pins.

CONFIRMED-FOLDED — B Stage 1.2 preserves `sitePriority` and replaces only coordinate fallback terms.

CONFIRMED-FOLDED — B Stage 0 requires generation against the pushed tip.

CONFIRMED-FOLDED — B §1.5 correctly points to acceptance 6.

FOLDED-INCORRECTLY — B §2a adds the inventory, but lines 17, 200, and 229 retain false “four tests/assertions” claims.

CONFIRMED-FOLDED — B’s sequencing reduction is 31.3%.

FOLDED-INCORRECTLY — B OQ2 says `count` is ruled kept but still ends “Author to confirm.”

FOLDED-INCORRECTLY — B §6 adds the estimate and error bound, but acceptance 9 does not obtain the diff-volume result at Stage 4; it instead requires post-landing history after about two weeks.

CONFIRMED-FOLDED — A Summary says consumers do not branch, identifies eight content lines plus `sourceDigest`, and removes confidence from the ruled choice.

CONFIRMED-FOLDED — A Option C and Recommendation distinguish advisory visibility from refusing enforcement.

CONFIRMED-FOLDED — A §4 covers both blocks, the formatters, and test assertions.

CONFIRMED-FOLDED — A §5 adds formatter migration and locator relocation, with B authoritative for inventory.

CONFIRMED-FOLDED — A §8 rebases cost on diff volume and adds a method limit.

CONFIRMED-FOLDED — A OQ2 is closed.

CONFIRMED-FOLDED — B §6 now qualifies 1,735,036 as an estimate; independently, that is the projected JSON size before the generator’s trailing newline and new count fields.

NOT-FOLDED — B §1.4 still states 6,781 bytes despite the promised removal; the largest raw diagnostic record is 6,255 bytes.

CONFIRMED-FOLDED — B acceptance 8 requires a clean checkout.

## Concerns

[MATERIAL] [IN-DELTA] [B] — The two-pin disposition remains internally contradictory. Change §1.3’s heading/list to distinguish three appearances from two validating pins.

[MATERIAL] [IN-DELTA] [B] — The inventory disposition is incomplete: several passages still reduce the affected set to four. Replace them with “four initially identified assertions” and make the full inventory authoritative throughout.

[MATERIAL] [IN-DELTA] [B] — OQ2 is simultaneously ruled and awaiting confirmation. Remove “Author to confirm.”

[MATERIAL] [IN-DELTA] [B] — The supposedly removed 6,781-byte claim remains and is wrong for the raw record. Delete it as promised or use 6,255 with an explicit measurement definition.

[MATERIAL] [IN-DELTA] [B] — §6 promises a trustworthy Stage-4 diff-volume result, but Stage 4 contains no replay/measurement step and acceptance 9 schedules measurement after two weeks. Add a Stage-4 historical-v2 replay or separate the Stage-4 artifact measurement from later validation.

[DETAIL] [IN-DELTA] [A] — §8 calls 734→8 a bounded estimate, while the Summary, confidence statement, ruling, and OQ3 still call it measured. Relabel the simulated-v2 figures consistently.

[DETAIL] [PRE-EXISTING] [A] — Option A says it “kills line-drift restamps,” although `sourceDigest` preserves those restamps. Say it removes coordinate-driven bulk diff hunks.

[DETAIL] [PRE-EXISTING] [both] — A says the “carries every emitting site” prose survives, while B correctly requires revising it after aggregation. Align A with B.

[DETAIL] [PRE-EXISTING] [both] — A says the change does not reduce the shipped binary, but B and the packing code show the registry is embedded/compressed. State that compression is out of scope while its input will shrink.

[DETAIL] [PRE-EXISTING] [B] — Formatter acceptance requires only a non-empty list; the existing CLI test can remain non-empty while rendering `undefined`. Assert exact v2 file/classification/count output.

## Verdict — LLP 0326: READY
## Verdict — LLP 0326.000: NOT READY
## Verdict — cluster: NOT READY
