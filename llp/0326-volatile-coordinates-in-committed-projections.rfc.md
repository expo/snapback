# LLP 0326: Volatile coordinates in committed projections

**Type:** RFC
**Status:** Review
**Systems:** Diagnostics, Guide, Code generation, Repository hygiene,
Developer experience, Agent experience, Proof/gates
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-27
**Revised:** 2026-08-28 (d — round-1 fold. The headline churn claim is
**retracted and re-based**: `buildIdentity.sourceDigest` means Option A does not
reduce restamp frequency; the measured benefit is diff volume (median 734 → 8
lines). The §2c contributor-only finding is **retracted** — the raw registry is
a published surface. Two coordinate-rendering formatters added to the audit.
Option A's record shape corrected to `(file, kind, synthetic)` across both
blocks. See Round-1 corrections.)
**Revised:** 2026-08-28 (c — Draft → Review at llp-super-refine loop start, the one authorized transition)
**Revised:** 2026-08-28 (b — OQ1 ruled by the author: Option A, with Option C
as a separate independent landing. Implementation sequence moves to the child
plan LLP 0326.000. §2c strengthened with the distribution finding: the public
package already strips `sites`, so the affordance in question is
contributor-only. Status stays Draft pending review.)
**Related:** LLP 0326.000 (implementation plan), LLP 0193, LLP 0061, LLP 0010, LLP 0189, LLP 0232, LLP 0225,
LLP 0276, LLP 0314.002, LLP 0322 (withdrawn — different mechanism),
LLP 0325, `issues/20260821-diagnostics-registry-tracks-line-numbers.md`

## Summary

`guide/reference/diagnostics-registry.json` records a `file`/`line`/`column`
triple for every call site in **both** of its blocks: **10,204 `diagnostics`
sites and 367 `environment` sites — 10,571 records, every one carrying all
three fields** — in a **2,526,048-byte committed artifact**.

Line and column are the least stable facts about a source tree. Any edit
that shifts lines in a file containing a diagnostic invalidates the
registry, so the artifact restamps on landings that have nothing to do with
diagnostics.

Measured on this checkout over the last 30 days:

| | count |
|---|---:|
| commits touching `diagnostics-registry.json` | 624 |
| commits touching `guide/reference/diagnostics.md` | 537 |
| total commits | 4,780 |

**13.1% of all commits touch the registry.** Of the 40 most recent registry
commits, **30 changed no `"code":` line at all**.

**What that does and does not license (round-1 correction).** It does *not*
mean Option A removes those commits. `buildIdentity.sourceDigest`
(`generate-diagnostics-registry.mjs:608–613`, `:730–747`) is a hash over the
raw bytes of every input path — all production sources plus guide Markdown —
and it is published in the committed file. It changed in **59 of 60** sampled
registry commits. Under Option A the artifact still restamps at roughly
today's frequency.

The benefit is **diff volume**. Estimated over the 40 most recent registry
diffs at `--unified=0`, counting changed lines that are not
`line`/`column`/`sourceDigest` — a v1-filter proxy, not a v2 replay; see §8
Method limit:

| | Today | Option A |
|---|---:|---:|
| **Median changed lines per diff** | **734** | **8** |
| Mean changed lines per diff | 1,451 | 521 |
| Total over the sample | 58,028 | 20,824 (−64.1%) |

A typical registry commit stops being a 734-line content-free restamp and
becomes roughly **8 content lines plus the `sourceDigest` line**, which still
changes on every regeneration. Recovering the *frequency* benefit additionally
requires making the committed identity a digest over the semantic projection —
the same defect class as LLP 0194's 2026-08-28 amendment — which is
deliberately **out of scope here** and sequenced as a follow-on.

`issues/20260821` asked the load-bearing question and left it open:

> Option 1 is worth checking first: find who actually consumes
> `line`/`column`. If nothing does, this is pure churn with a recurring
> gate cost.

**This RFC's contribution is that audit.** Section 2 reports it. The
answer is that no consumer *branches* on line or column — they are sorted
on, rendered, and passed through opaquely. That does not by itself make
them free to delete, because one of those pass-throughs is a served agent
affordance; §3 lays out the options honestly rather than assuming the
conclusion.

Confidence is **0.9** on the audit; **0.75** on the re-based diff-volume
estimate (§8 records its method limits). OQ1 is ruled, so no confidence
is carried on the choice.

## 1. Why an RFC and not just the ticket

`issues/20260821-diagnostics-registry-tracks-line-numbers.md` is a good
ticket. It has recurred four times in one day, was widened once from
"diagnostics registry" to "generated projections", and lists three options
without deciding among them. It has been open since 2026-08-21.

The reason it has not closed is that option 1 needs a consumer audit
nobody had run, and options 2 and 3 change gate behaviour that LLP 0189
and LLP 0232 govern. That is a design question with a wire-visible
consequence, which is what an LLP is for.

LLP 0325 §5c(6) already treats this as a standing tax on unrelated work:

> File splits that shift `SNAPBACK_*` sites will restamp
> `guide/reference/diagnostics-registry.json` until that registry stops
> pinning line/column.

So the file-splitting programme in LLP 0325 is partly gated on this
document. That is the second reason to decide it rather than carry it.

**This is not LLP 0322.** LLP 0322 proposed tiering the 3,575 codes into
a smaller public vocabulary and was withdrawn because its wire-reachability
claims were false. This RFC does not touch which codes exist, their
subsystems, their HTTP classification, or their guide anchors. It touches
only the positional fields on site records.

## 2. The consumer audit

Every reader of `guide/reference/diagnostics-registry.json` in this
checkout, and what it does with `sites[].line` / `sites[].column`.

### 2a. Generator-internal: sort key

`scripts/generate-diagnostics-registry.mjs:321–325` sorts a code's sites to
pick a deterministic first one:

```
const first = [...sites].sort((left, right) => (
  left.file.localeCompare(right.file)
    || left.line - right.line
    || left.column - right.column
```

The same comparator appears at `:704` and `:726`. This is a **tiebreak for
determinism**, not a semantic use. Any stable total order over sites
satisfies it.

### 2b. Rendered into a committed Markdown table — a paved guide surface

`scripts/generate-diagnostics-registry.mjs:664` and `:679` emit a
`` `{first.file}:{first.line}` `` cell into `guide/reference/diagnostics.md`,
under a column the page names **"First registered site"**:

```
| Code | Vocabulary | Subsystem | HTTP | Guide | First registered site | Sites |
```

This is the churn amplifier — a 740 KB committed Markdown file re-renders
whenever a first-site line moves, which is why `diagnostics.md` shows 537
commits in 30 days alongside the registry's 624.

It is also a **published guide surface**, so §3's Option A is not invisible:
that column would render `file` without `:line`. The page's prose promise that the registry "carries every emitting site,
received-vocabulary site, and explicit reservation" **also needs revising**:
aggregation means the artifact carries every site's *file and classification*,
not every site as a distinct record. LLP 0326.000 Stage 3 is authoritative.
But the column is a real, reader-facing change and must be landed as a guide
edit, reviewed as one, not slipped in as a regeneration artifact.

### 2c. Served runtime: pass-through, and a published surface

`crates/snapback-server/src/guide_reference.rs:133–149` paginates `sites` as
opaque JSON `Value`s under a byte budget and never reads `.line` or `.column`.
That much stands.

**Round-1 correction — the earlier claim that this is contributor-only is
retracted.** `diagnostic_for_distribution` strips `sites` only from the *exact
diagnostic lookup* path. The raw artifact itself is published:

- `scripts/guide-lib.mjs:1229–1240` declares it with
  `projections: { http: true, mcp: true, llms: true }` and
  `servedPath: '/_snapback/guide/reference/diagnostics-registry.json'`;
- `crates/snapback/tests/served_guide_v1.rs:368–379` asserts the server returns
  the exact committed bytes (`include_bytes!`);
- `scripts/generate-docs-site.mjs:961` copies those bytes into the published
  docs site.

So HTTP, MCP, and docs-site consumers **do** receive coordinates today.
**Option A is a public schema change**, not an internal cleanup, and must be
qualified as one.

### 2c-bis. Two formatters do render coordinates

The claim "no consumer reads them" was too strong. Two formatters dereference
all three fields:

- `crates/snapback-server/src/guide_reference.rs:606–616` builds
  `"- {file}:{line}:{column}"` inside a `filter_map` with `?`. A record without
  `line` is **silently dropped**, so the naive change yields an
  "Emitting sites:" heading with no rows.
- `packages/snapback-cli/reference-lookup.mjs:449–472` does the same for
  diagnostic and environment sites and would render `:undefined:undefined`.

Neither *computes* on coordinates — no control flow branches on them — but both
must be updated, and their absence from the first audit was an error.

### 2d. Everything else

`scripts/check-guide.mjs`, `scripts/generate-guide-manifest.mjs`,
`scripts/generate-docs-site.mjs`, `scripts/check-retrieval-eval.mjs`,
`scripts/guide-freshness.test.mjs`, `tests/local_proof_selection_v0.mjs`,
and the remaining Rust readers (`guide.rs`, `guide_artifact.rs`,
`api_error.rs`, `manifest/mod.rs`) reference the registry as a whole
artifact — for digests, freshness, packing, or code lookup — and none read
positional fields.

### 2e. Audit result

| Use | Consumer | Needs exact line? |
|---|---|---|
| Deterministic sort key | generator `:321` (behind a `sitePriority` primary key that feeds subsystem classification), `:704`, `:726` | No — any stable order, but `sitePriority` must be preserved |
| `file:line` table cell | `diagnostics.md` via generator `:664`, `:679` | No — `file` alone renders |
| **Rendered site list** | `guide_reference.rs:606–616`; `reference-lookup.mjs:449–472` | **Renders all three; must be updated** |
| Served lookup payload | `guide_reference.rs:133–149` (opaque) | Display only |
| **Raw published artifact** | HTTP / MCP / llms / docs-site (§2c) | **Display only, but publicly reachable** |
| Generator locator tests | `generate-diagnostics-registry.test.mjs` (§ LLP 0326.000 §2a) | **Yes — they index source by `line`; must be relocated** |
| Digest / freshness / packing | 10+ scripts and Rust readers | No |

**Corrected conclusion:** no consumer *branches* on `line` or `column`. But two
formatters render them, the generator's locator tests compute on them through
the published artifact, and the artifact is publicly served. The original
"nothing consumes them" framing was wrong and is retracted.

## 3. Options

### Option A — drop `line`/`column`; keep classified file records

Published site records become `{file, kind?, synthetic?, count}`, deduplicated
per code on **`(file, kind, synthetic)`** — not on `file` alone. Both blocks
change. `diagnostics` sites carry `kind` ∈ {`received`, `declaration`,
`reserved`} or `synthetic`; `environment` sites carry a different seven-value
`kind` vocabulary. **169 code/file pairs carry more than one classification**,
so collapsing on `file` alone would silently merge distinct classifications the
served surface exposes.

The sort key keeps `sitePriority` as its primary term and falls back to `file`
plus a stable index.

Measured on this checkout with the correct key:

| | Today | Option A |
|---|---:|---:|
| `diagnostics` records | 10,204 | 5,385 |
| `environment` records | 367 | 281 |
| Artifact bytes | 2,526,048 | 1,735,036 (−31.3%) |

Removes the **coordinate-driven bulk diff hunks**. It does not remove the
restamps themselves: `sourceDigest` restamps the file regardless, and file
splits or renames still change a file-level projection (Summary). Costs the rendered line numbers in §2c-bis.

### Option B — keep coordinates, stop committing them

Split the artifact. A committed **semantic** registry carries `code`,
`subsystem`, `httpStatus`, `httpStatusClass`, `guideAnchor`,
`guideAnchors`, and per-code site *files*. An uncommitted **positional**
sidecar carries the coordinates and is regenerated at build/publish time,
gitignored, and packed into the binary.

Preserves the served affordance exactly. Costs a second artifact in the
custody model and a build-time ordering constraint, and the packed guide
artifact then contains bytes that no committed file pins — which
interacts with LLP 0314.002's compression work and with the
`contentHash`/packing contract. **This interaction must be checked before
adopting B**; LLP 0314.001 was withdrawn for getting an adjacent packing
claim wrong.

### Option C — keep everything, regenerate in the pre-push hook

The ticket's option 1. Cheapest to implement, closes the
"invisible in the worktree where the work happened" gap, and changes no
contract. Does **not** reduce churn — 624 commits/30d and the enormous
content-free diffs remain.

**It also cannot prevent staleness landing.** A pre-push hook runs after the
pushed commit exists, so regenerating into the worktree cannot correct the
commit being pushed. In its recommended advisory form it exits 0 and makes the
drift *visible*; a refusing form would be a landing veto needing authorization
against LLP 0189 D-2 and LLP 0232. See LLP 0326.000 Stage 0.

### Recommendation

**A, unless the served line numbers have a demonstrated consumer.**
The affordance in §2c is real but thin: an agent that has the file can
grep for the code, and the code string is unique by construction. C is
worth landing regardless because it is small and independent — but it makes
staleness *visible*, not impossible, and leaves the diff-noise and
review-legibility costs untouched, which are the larger harms.

B is the answer only if someone wants the coordinates served and is
willing to pay the packing-contract complexity.

### Author ruling (2026-08-28, re-based after round 1)

**OQ1 is ruled: Option A, with Option C landed separately.** B is declined — it
buys only the display affordance and pays for it in the packing contract that
withdrew LLP 0314.001.

The ruling stands, but **its stated basis has been corrected**. It was first
recorded against a projected 624 → ~156 restamp reduction. Round-1 review
falsified that number: the replay measured a content projection, not the
artifact that would actually be committed, and `sourceDigest` restamps the file
regardless. The honest basis is:

- **Diff volume**, not commit count: the median registry diff is estimated to
  fall from **734 changed lines to ~8**; 58,028 → 20,824 over a 40-diff sample (−64.1%).
- **Artifact size**: 2,526,048 → 1,735,036 bytes (−31.3%).
- **Review legibility**: a landing that genuinely adds a diagnostic stops being
  indistinguishable from one that moved some lines.

Two findings that were recorded as supporting the ruling are **retracted**:
the 75% restamp projection (§Summary) and the contributor-only reachability
claim (§2c). Neither reversal changes which option is right — coordinates are
still the volatile field and B still walks into the packing contract — but the
record should not carry the numbers that were wrong.

Restoring the frequency benefit requires a semantic `buildIdentity`, which is
**out of scope here** and sequenced as a follow-on after LLP 0194's amendment
establishes the pattern.

Implementation sequence: LLP 0326.000.

### What the coordinates are for, and what dropping them costs (2026-08-28)

The ruling was reaffirmed after examining what the coordinates actually serve.
This subsection records that, because the original RFC asserted the affordance
was thin without establishing what it was.

**Purpose.** `snapback guide <CODE>` returns the semantic answer first
(subsystem, HTTP status, guide anchor) and then an `Emitting sites:` list. The
list is provenance: *here is where this is thrown, go look.* LLP 0193 needs
sites for a second reason — a code with fan-out may need per-site remediation
and anchor routing — but that is a need to distinguish **contexts**, not to
pin lines.

**It carries more weight than "thin" suggests:**

| | of 3,575 codes |
|---|---:|
| Have a guide anchor | 452 (12.6%) |
| Have an HTTP status | 1,702 (47.6%) |
| **Have neither** | **1,651 (46.2%)** |

For 46.2% of codes the site list is the **only actionable content** the lookup
returns. 50.3% of codes are emitted in exactly one place.

**Who can act on it.** Site paths split almost evenly — **5,114 into `crates/`
and similar, 5,090 into `packages/`**. A published user hitting a `packages/`
path can genuinely open the file; it is in their `node_modules`. The same user
hitting a `crates/` path cannot — they have no Rust source. So roughly half the
coordinates point somewhere the published audience can actually follow.

**Why dropping the line is still acceptable.** Diagnostic codes are unique
literal strings, so `file` plus the code recovers the line with one grep. The
exception is the **11 `synthetic` sites**, where the code is constructed rather
than written at that location and grep cannot find it — and Option A
**preserves `synthetic` on the record**, so the artifact still flags exactly
the cases where a coordinate would have been irreplaceable.

**Cost, stated plainly:** a published JS user loses a direct pointer into a
file they can open and must grep instead; a contributor loses the same. Nobody
loses the ability to locate a code. Against that: the median registry diff
falls from ~734 lines to ~8 and the artifact shrinks 31.3%.

**A fourth option was considered and declined.** Keeping coordinates only for
`packages/` sites — where a published user can act on them — and dropping them
for `crates/` would respond precisely to the audience split above. It was
declined because it roughly halves the churn benefit instead of taking it,
while adding a path-conditional rule to a published schema, and because the
grep argument applies equally to both halves. Recorded so the option is
visibly rejected rather than unconsidered.

## 4. Scope

In scope: positional fields on `diagnostics-registry.json` site records in
**both** the `diagnostics` and `environment` blocks; the `file:line` rendering
in `diagnostics.md`; the two coordinate-rendering formatters (§2c-bis); and the
generator's coordinate-coupled test assertions.

Out of scope, explicitly:

- Which diagnostic codes exist, their names, subsystems, HTTP status
  classification, or guide anchors. That is LLP 0193 and the withdrawn
  LLP 0322; this RFC does not reopen it.
- The symbol registry and the other `guide/reference/*` projections the
  2026-08-21 widening note names. They churn for a different reason
  (input-set changes, not coordinate drift). §6 records them as related
  but does not propose a mechanism for them.
- Compression or packing of the guide artifact — LLP 0314.002, in Review.
- Whether generated projections should be committed at all. Note that
  `guide/getting-started/generated-artifacts.md` governs *application*
  codegen custody (`snapback/codegen.policy.json`,
  `committedProjections`) — it does not govern this repository's own
  `guide/reference/` artifacts, and this RFC does not extend it to them.
  The question of a custody model for the repo's own projections is left
  open; §3 Option B would need one.

## 5. What a landing owes

If A is adopted:

1. Change the site record shape in the **generator's projection step only**
   (`scripts/generate-diagnostics-registry.mjs`).
   `scripts/diagnostics-registry-source.mjs` returns matches and offsets and
   **does not change** — see LLP 0326.000 §2. Update the three comparators,
   preserving the `sitePriority` primary key at `:321`, which feeds subsystem
   classification and is not equivalent to `:704`/`:726`.
2. Bump `schemaVersion` from `snapback-diagnostics-registry.v1`.
3. Update `crates/snapback-server/src/guide_reference.rs` pagination — it
   is shape-agnostic today, so this is likely a test-fixture update only,
   but the `DIAGNOSTIC_PAGE_SIZE` budget maths changes when records shrink.
4. Re-render `guide/reference/diagnostics.md`, and land the
   "First registered site" column change as a reviewed guide edit
   (§2b) — per AGENTS.md the guide records the paved form, so this
   is a documentation change, not a regeneration side effect.
5. Regenerate the chain: registry → guide manifest → flats. Per AGENTS.md,
   confirm with `node scripts/check-inventories.mjs`, not by grepping the
   diff.
6. Update `scripts/generate-diagnostics-registry.test.mjs` fixtures.
7. Close `issues/20260821-...`, recording which option was taken and why.
8. Update **both coordinate-rendering formatters** —
   `guide_reference.rs:606–616` (drop the `filter_map`/`?` silent-drop shape)
   and `packages/snapback-cli/reference-lookup.mjs:449–472` — and add coverage
   that a known-site code renders a non-empty list (§2c-bis).
9. Relocate the generator's locator assertions onto the internal scan API; see
   LLP 0326.000 §2a, which is authoritative for the test inventory.
10. Drop the LLP 0325 §5c(6) caveat, which exists only to describe this tax.

## 6. What this does not do

- It does not make generated projections uncommitted.
- It does not change the diagnostic vocabulary or any wire contract for
  emitted errors. `SNAPBACK_*` codes and their HTTP mapping are untouched.
- It does not add a landing veto. Registry staleness stays fix-forward
  under LLP 0189 D-2 and LLP 0232.
- It does not claim to fix the symbol-registry churn class.
- It does not compress or repack the shipped binary — that is LLP 0314.002 —
  although the registry is embedded there, so its input shrinks by ~31%.

## 7. Open questions

- **OQ1 — Which option.** ~~A, B, or A+C.~~ **Ruled 2026-08-28: A, with
  C separate.** See Author ruling above; sequence in LLP 0326.000.
- **OQ2 — ~~Deduplicate by file?~~ CLOSED 2026-08-28.** The key is
  `(file, kind, synthetic)` and `count` is kept — see §3 Option A and
  LLP 0326.000 OQ2. A same-file multiplicity change still restamps a record,
  which a countless projection would not; that residual is recorded rather
  than left open.
- **OQ3 — Measured reduction.** ~~Deliberately unquantified.~~ **Closed
  2026-08-28:** 2,526,048 → 1,735,036 bytes (−31.3%, simulated); median diff
  734 → ~8 lines (**estimate**, §8 Method limit); restamp *frequency*
  unchanged (Summary). LLP 0326.000 Stage 4 produces the real figure.
- **OQ4 — Does anything outside this repo read the served `sites`?**
  **ANSWERED 2026-08-28, adversely.** §2c establishes the artifact is served
  over HTTP/MCP/llms and republished to the docs site. Beyond that,
  `packages/snapback-cli/reference-lookup.mjs` — one of the two coordinate
  *rendering* formatters (§2c-bis) — is listed in `@expo/snapback-cli`'s
  published `files` array. **A published package renders `file:line:column` to
  users today.**

  So this is unambiguously a user-visible change in a shipped package, not an
  internal cleanup. It does not change the ruling — no consumer *branches* on
  coordinates, and B still buys only the display affordance at packing-contract
  cost — but the landing owes a published-surface note and the Stage 1.5
  formatter work is on the critical path, not a tidy-up. Whether any *third
  party* parses the served JSON for coordinates remains unknowable from this
  repository; the schema bump to v2 is the honest signal.
- **OQ5 — Is the "First registered site" column worth keeping as `file`?**
  If Option A lands, the column could render `file`, the site count only,
  or be dropped. A file path with no line is still a useful pointer for an
  agent; an empty-looking column is not.

## 8. Cost

Option A is a generator change, a schema bump, a fixture update, and one
regeneration — an ordinary landing under LLP 0232, plus one large
mechanical diff to the registry and `diagnostics.md` as they re-render.

The recurring saving is **diff volume, not commit count** (Summary). The
registry still restamps roughly 624 times per 30 days because `sourceDigest`
changes regardless; what changes is that a restamp stops carrying ~734
content-free lines and carries ~8 plus the digest line.

That is primarily a review-legibility saving: today a landing that genuinely
adds a diagnostic is indistinguishable from one that moved some lines. It is
secondarily a repository-size saving, since git stores the delta.

**Method limit.** The 734 → 8 figures filter `line`/`column`/`sourceDigest`
out of *v1* diffs; they do not replay a real v2 artifact, which also
deduplicates, adds `count`, and reorders. A trustworthy number requires
generating historical v2 artifacts, which requires the generator to exist.
Treat these as a **bounded estimate**, not a measurement, until Stage 4
produces the real before/after (LLP 0326.000 acceptance 9).

## 9. Why it matters

LLP 0325 wants to split 45,000-line files and names this registry as the
tax that makes each split noisier than it should be. LLP 0189 wants gates
that fail for reasons the author can see. `issues/20260821` records a gate
that fails four times a day for reasons invisible in the worktree where
the work happened.

All three point at the same property: **a committed artifact should not
pin facts that unrelated edits change.** Line and column are exactly such
facts.
