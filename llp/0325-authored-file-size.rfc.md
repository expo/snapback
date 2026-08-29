# LLP 0325: Authored file size and splitting

**Type:** RFC
**Status:** Draft
**Systems:** Project, Rust core, Developer experience, Agent experience,
Proof/gates, Documentation
**Author:** Charlie Cheever / Grok / Claude
**Date:** 2026-08-27
**Revised:** 2026-08-27 (b — §2a adds the compile and link cost
measurement the document argued from without numbers; OQ3 gains the
evidence bearing on it; §5c(6) and §9 point at LLP 0326, which is now
the RFC for the registry tax rather than an open ticket)
**Related:** LLP 0000, LLP 0189, LLP 0199, LLP 0225, LLP 0232, LLP 0276,
LLP 0326 (the registry tax in §5c(6)), LLP 0327 (build-loop measurement)

## Summary

Crate extraction (LLP 0225, LLP 0276) put owners in the right packages.
The god **files** mostly moved intact. `engine.rs` is still ~45k lines of
implementation; `server.rs` ~35k; `storage.rs` ~25k; the two largest
JavaScript entry files are ~24k and ~22k. An agent cannot load those
modules. rustc cannot incrementally compile them. A 200-line diff in a
35k-line file has no neighborhood.

This RFC is the missing file-level doctrine. The load-bearing rule is
cohesion, not a line count: **a file should be the X for Y, and a
reader should be able to load it together with one caller and one
test.** Size bands are the brake when that sentence is true but the
file has still grown past what a reader or the compiler can hold.

It amends LLP 0276's undifferentiated "~3,000 lines" review convention,
which was never enforced, and it classifies this work as LLP 0225 §6
**cosmetic splitting inside an existing crate** — not a new ownership
slice and not a rewrite.

Confidence is **0.85** on the thinking and on ratchet-not-rewrite;
**0.7** on the exact band edges (OQ1).

## 1. Why a new LLP

LLP 0276 already says:

> File-size norm: no file over ~3,000 lines as a review convention;
> recorded exceptions are generated tables and the temporary same-owner
> `legacy` modules.

That bullet is the whole current policy. It does not say how to think
about a split, how Rust differs from `.mjs`, how tests differ from
production, what to co-migrate, or what a landing that touches a 45k-line
file owes. LLP 0225 §6 distinguishes semantic extraction (ownership)
from cosmetic splitting (files) and approves the latter as background
work; it does not set size goals.

This document is that policy. It does not reopen crate rank, commit
authority, or the workspace graph.

## 2. Measurement (2026-08-27, this checkout)

Physical lines (`wc -l`), excluding `vendor/`, `target/`,
`node_modules/`. "Generated-ish" here is only
`crates/snapback-kernel/src/search/unicode17_generated.rs`. Test
classification is path-based (`tests.rs`, `tests/`, `*.test.mjs`).

| Population | n | median | p75 | p90 | max |
|---|---:|---:|---:|---:|---:|
| Authored Rust production | 363 | 483 | 1,321 | 3,102 | 44,968 |
| Authored Rust tests | 102 | 431 | 986 | 3,082 | 44,267 |
| Production `.mjs` | 1,419 | 119 | 297 | 741 | 23,989 |
| Test `.mjs` | 713 | 245 | 471 | 880 | 11,430 |

Most files are already small. 170 of 363 production Rust files are
≤400 lines; 1,155 of 1,419 production `.mjs` files are ≤400. The
problem is a fat tail, not a culture of 2k-line modules.

Largest authored production files:

| Lines | File |
|---:|---|
| 44,968 | `crates/snapback-engine/src/local/engine.rs` |
| 35,219 | `crates/snapback-server/src/server.rs` |
| 24,729 | `crates/snapback-kernel/src/storage.rs` |
| 14,944 | `crates/snapback-types/src/manifest/types.rs` |
| 14,466 | `crates/snapback-sync/src/ephemeral.rs` |
| 12,389 | `crates/snapback-engine/src/runtime/host_glue.rs` |
| 12,112 | `crates/snapback-services/src/telemetry.rs` |
| 11,259 | `crates/snapback-cli/src/cli.rs` |
| 23,989 | `packages/snapback-client/index.mjs` |
| 22,334 | `packages/snapback-codegen/index.mjs` |
| 9,783 | `packages/snapback-cli/index.mjs` |
| 8,250 | `packages/snapback-react/implementation.mjs` |

Largest authored test files:

| Lines | File |
|---:|---|
| 44,267 | `crates/snapback-server/src/server/tests.rs` |
| 43,077 | `crates/snapback-engine/src/local/tests/engine.rs` |
| 24,031 | `crates/snapback-kernel/src/storage/tests.rs` |
| 12,335 | `crates/snapback/tests/graph_corpus_v1.rs` |
| 11,430 | `packages/snapback-client/outbox-store.test.mjs` |

`engine.rs` is implementation through ~line 44,954, then `#[cfg(test)]`
`#[path]` mods. `server.rs` is implementation through 35,218, then
`mod tests`. These are not "a short module plus a data table."

### 2a. What the size actually costs (added 2026-08-27)

§3b asserts that rustc and rust-analyzer degrade on these files. Measured
on this checkout (Apple Silicon, Rust 1.97.0, dev profile, `target/` warm):

| Operation | Wall |
|---|---:|
| `cargo check -p snapback-kernel --lib`, no-op | 0.75s |
| touch `kernel/src/storage.rs` (24,729 lines) → check kernel lib | 17.1s |
| `cargo check --workspace --all-targets`, no-op | 50.9s |
| touch `kernel/src/storage.rs` → check workspace all-targets | 272s |

A one-line edit to `storage.rs` costs 17 seconds to re-check its own crate
and 272 seconds to re-check the workspace. The file is a single parse and
codegen unit, so the cost is paid whole regardless of how small the edit
is — which is the compile-side argument for the bands in §4, now with a
number attached.

The tail is also concentrated: **27 files over 5,000 lines hold 398,304 of
737,030 authored Rust lines (54%)**, and 13 exceed 10,000. Splitting the
top of §5d's queue therefore moves a majority of the tree's recompile cost,
not a long tail of it.

Separately, `target/debug` is **126 GB** with **137 artifacts over 100 MB**
and a largest rlib of 1.3 GB — the disk face of the same concentration.
LLP 0327 carries that measurement and the build-loop metric; this document
only needs the per-file half.

## 3. How to think about a file

### 3a. The sentence test

A file is the right size when a reader can finish:

> This file is the **X** for **Y**.

and then load that file, one caller, and one test without dropping the
invariant on the floor.

If the sentence needs "and" more than once, the file is two files,
regardless of line count. If the sentence is clean and the file is
1,400 lines of one `impl` with shared private fields, leave it. Fake
shards — twenty 200-line files that poke the same private state through
`pub(crate)` helpers — are worse than one 1,400-line module.

### 3b. Why the cap exists at all

Past a point the sentence can still be true and the file is still
unusable:

- **Agents cannot hold it.** A change needs the file, a caller, and a
  test. At 45k lines there is no "read the module"; there is only grep.
- **A `.rs` file is one parse unit.** rustc and rust-analyzer re-parse
  the whole file on a one-line edit. Incremental compile and
  goto-definition degrade well before 10k lines.
- **Review has no neighborhood.** A 200-line diff in a 35k-line file
  cannot be read as a change to a module.

Line counts include comments, blanks, and rustfmt padding on purpose.
The reader still has to load them.

### 3c. Rust may be larger than JavaScript

Rust files carry type definitions, `impl` blocks, and match tables that
are real cohesion. `.mjs` has none of that structure: a 2k JavaScript
file is usually several modules that never got a name. This tree
already behaves that way (production Rust p90 is 3,102; production
`.mjs` p90 is 741).

`index.mjs` / `index.rs` should **re-export, not implement.** A 24k-line
package root is the JavaScript form of the god-file bug.

### 3d. Tests may be larger than production

Table-driven cases are data. They still should not be a 40k-line
sibling of the module under test. Split tests **by behavior**, matching
the production split (`admission`, `live_query`, `ensure_app`), not one
`tests.rs`.

Keep crate-private tests crate-private. LLP 0276 already wants unit
tests inline so they keep private access. Splitting `mod tests` into
`#[cfg(test)] #[path = "..."]` siblings (or a module-local `tests/`
directory that is still `#[cfg(test)]`) is a file split. Moving those
tests to `crates/*/tests/` is an integration-test conversion: it loses
private access and can hide the invariant. Do not do that to shorten a
file.

### 3e. Split inside the crate you are in

This RFC does not move code across crate rank. A file split that would
change an LLP 0225 owner or a workspace-graph edge is a semantic
extraction and follows LLP 0225 §4 / LLP 0276, not this document.

## 4. Size bands

Physical lines, authored files only. Soft max means "split at the next
natural seam; do not add a new concern here." Hard max means "do not
grow this file; extract the concern you touched, or record why not."

| Kind | Comfortable | Soft max | Hard max |
|---|---:|---:|---:|
| Rust production | 400–800 | 1,500 | 2,500 |
| Rust tests | 400–1,000 | 2,000 | 4,000 |
| `.mjs` production | 200–400 | 800 | 1,500 |
| `.mjs` tests | 200–600 | 1,200 | 2,500 |

These bands **replace** LLP 0276's "~3,000 lines" review convention.
They do not amend Decisions D1–D7.

### 4a. Exemptions

Exempt, and mark them so a linter can skip them:

- Generated sources (`*_generated.rs`, `*.generated.mjs`, generated
  `diagnostic-codes.d.mts`, unicode tables, schemagen output).
- Frozen conformance corpora and other files whose body is data, not
  control flow, when a header comment says so.
- `vendor/`.

Not exempt: hand-authored protocol types, engine/server/storage,
package `index.mjs` files, giant `tests.rs` siblings.

Application source under `demos/` and `packages/snapback-cli/templates/`
is out of this RFC's ratchet. Those trees follow the Snapback *product*
authoring guide, not this engineering policy.

### 4b. Scope of the ratchet

In:

- `crates/**/*.rs`
- `tools/**/*.rs`
- `packages/**/*.mjs` (except templates)
- `scripts/**/*.mjs`

Out: `vendor/`, `target/`, `node_modules/`, `demos/`, templates,
generated output, `guide/` prose.

## 5. What a landing owes

### 5a. New code

Do not add a new function, type, or export to a file already over the
**soft** max. Put it in a sibling named for the concern. Re-export from
the original file only if that name was already part of the file's
public (or `pub(crate)`) surface.

### 5b. Edits to a file over the hard max

The landing extracts the concern it touched, **or** the commit message
/ PR body names the file and why this edit is not the extraction
(`mechanical one-line fix`, `diagnostic string only`, `comment`). Silent
growth of a grandfathered file is the failure mode.

### 5c. How to split

1. Name the concern in one sentence. That is the new file's job.
2. `git mv` when renaming; add a new file when carving a subset.
3. Keep visibility as it was. Do not sprinkle `pub` / `pub(crate)` to
   make the split compile.
4. Move the tests that pin that concern into a matching test file,
   still `#[cfg(test)]` inside the crate when they need private access.
5. Co-migrate, in the same change:
   - hardcoded generator inputs that name the old path
     (LLP 0225 §6 examples: `scripts/guide-lib.mjs`,
     `scripts/capability-maturity.mjs` — verify current readers, do not
     assume the 0225 list is complete);
   - guide snippet `source=` paths;
   - file-path `@ref`s;
   - proof selectors and drift-gate paths keyed on the old file.
6. Run the affected generators. File splits that shift `SNAPBACK_*`
   sites will restamp `guide/reference/diagnostics-registry.json` until
   that registry stops pinning line/column (LLP 0326, which supersedes
   `issues/20260821-diagnostics-registry-tracks-line-numbers.md` as the
   place that decision is made).
   That is expected; land the regeneration with the split.
7. Do not change crate membership, published JS export paths, or
   symbol identities. This is not a public-API change.

The LLP 0225 §6 requirement to update `ownership.manifest.json` is
**retired** with that file (LLP 0276 Phase 3). Intra-crate splits do
not touch `crates/allowed-dependencies.v1.json`.

### 5d. First extraction queue

Not a schedule. The files a landing should prefer to drain when it
already has to touch them:

1. `crates/snapback-engine/src/local/engine.rs` and
   `crates/snapback-server/src/server.rs` (compile + context).
2. Their test siblings
   (`server/tests.rs`, `local/tests/engine.rs`, `storage/tests.rs`).
3. `crates/snapback-kernel/src/storage.rs` — it already has real
   submodules (`query_reads`, `mutation_writes`, `room_authority`);
   keep going in that direction.
4. `packages/snapback-client/index.mjs` and
   `packages/snapback-codegen/index.mjs` — turn the roots into
   re-export barrels.

Do not mass-split the rest of the tail in a dedicated cleanup wave.
That fights LLP 0189 / LLP 0232 (optimistic landing, affected checks)
and restamps diagnostics for no product change.

## 6. Enforcement

**Not a landing veto.** An over-budget file is fix-forward, same as
other reversible hygiene (LLP 0189 D-2, LLP 0232). A size check may
not refuse an unrelated landing.

When a checker exists, the intended shape is a **ratchet**:

1. Report-only inventory of authored files over each band, with the
   2026-08-27 measurement as the baseline.
2. Warn when a **grandfathered** file grows in the diff under review
   (net lines added to a file already over hard max).
3. Error only for a **new** authored file that is itself over hard max,
   or for removing an exemption marker from a file that still needs it.

Do not fail the existing tree overnight. Do not put this check in the
ordinary pre-push fail-closed set. A scheduled or `--affected` report
is enough until the tail is shorter.

Exact tooling (clippy lint vs `scripts/check-*.mjs`) is OQ2.

## 7. What this does not do

- **It does not rewrite the core or split crates.** LLP 0225's "no
  rewrite, no flag-day" and LLP 0276's crate graph stand.
- **It does not convert unit tests to integration tests** to shorten
  `tests.rs`.
- **It does not change published JS export paths or Rust crate
  public APIs.** Barrels re-export the same names.
- **It does not collapse authoring profiles, query constructors, or
  diagnostic codes.** Those are product-surface questions; this is
  engineering-file shape.
- **It does not require a 300-line cap.** That would create fake seams
  and worse ownership. The comfortable band is a target for new files,
  not a rewrite budget.
- **It does not add a complete-battery gate or a publication block.**

## 8. Open questions

- **OQ1 — Hard-max edges.** 2,500 Rust production vs keeping LLP 0276's
  3,000 as the Rust hard max and using 1,500 only as soft. `.mjs` 1,500
  hard max currently describes on the order of fifty production files;
  is that the right ratchet population or should JS hard max be 2,000
  so the first queue is the four `index.mjs` / `implementation.mjs`
  giants?
- **OQ2 — Checker home.** Report-only script under `scripts/`, a
  clippy/cargo metadata lint, or both? Must be `wc -l` (or equivalent
  physical lines), must skip exemptions, must not hash line numbers
  into a committed inventory that restamps on comment edits.
- **OQ3 — First cut.** Extract a named concern from `engine.rs` first
  (compile cost) or split `server/tests.rs` first (review cost, no
  production behavior change)? The author picks per landing; this is
  which default to write down. §2a supplies the compile side: a
  one-line edit to a 24,729-line file already costs 17s in-crate and
  272s workspace-wide, so the compile argument is real but is paid by
  whoever edits that file, whereas the review cost of a 44,267-line
  `server/tests.rs` is paid by every reviewer of every diff in it.
  That asymmetry argues for the test split as the written-down
  default, with production extraction taken opportunistically per
  §5b. Still the author's call.
- **OQ4 — Growth warning.** Should net-line growth of a grandfathered
  file be a review comment only, or a CI warning on `--affected`? It
  must not be fail-closed on ordinary `origin/main` pushes.

## 9. Cost

The doctrine is free. Each extraction is an ordinary landing: move
code, move tests, regenerate inventories, affected proof. The
expensive part is the diagnostics-registry restamp until line/column
pinning dies — now proposed as **LLP 0326**, which measures that tax at
624 registry commits per 30 days, three quarters of them changing no
diagnostic code at all — and rustc of the still-huge remainder until
`engine.rs` and `server.rs` actually shrink (§2a).

A dedicated "split everything over 1,500" program would be a week of
merge conflict against a 0.1-minute `main` and would violate
optimistic landing. Do not schedule that program.

## 10. Why it matters

LLP 0000 is agent-first. LLP 0276 said the tree should be the
architecture. A 45k-line file is neither. The crate graph is now
legible from `ls crates/`; the modules inside `snapback-engine` and
`snapback-server` are not. This is the cheapest remaining step that
makes a small correct change cheap, which is the actual iteration
problem.
