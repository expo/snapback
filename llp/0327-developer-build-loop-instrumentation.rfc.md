# LLP 0327: Developer build-loop instrumentation

**Type:** RFC
**Status:** Draft
**Systems:** Build, Testing, Developer experience, Tooling, Rust core,
Proof/gates
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-27
**Related:** LLP 0175 (D4 and Phase 4 — the sequencing this discharges),
LLP 0189, LLP 0232, LLP 0276, LLP 0325,
`issues/20260820-debug-binary-symbol-bloat.md`

## Summary

LLP 0175 D4 is explicit about what has to happen before the build-loop
experiments are evaluated:

> Likewise, consolidating 57 Rust integration targets may reduce link
> count, but it is a large mechanical change with test-selection,
> module-state, `@ref`, and failure-isolation consequences.
> **Instrument link time first.** Pursue consolidation only if D1–D3
> leave it among the dominant costs.

> `cargo-nextest`, `mold`/`lld`, codegen-unit tuning, and remote build
> caching are valid experiments, not assumed conclusions.

That instrumentation has not been produced, so Phase 4 cannot be
evaluated and the integration-target population has grown unobserved:
**57 targets when 0175 was written, 83 today** (79 of them in
`crates/snapback`).

**This RFC supplies the measurement D4 requires and nothing else.** It
does not propose adopting nextest, `mold`, or target consolidation. It
proposes making the developer build loop measurable on a standing basis,
so that the D4 decision has evidence and so a 45% regression like
`issues/20260820` is visible when it happens rather than a month later.

The headline measurement: **linking one integration test binary costs
~5 seconds regardless of the test's size**, with every dependency warm.
A 20-line test binary links in 4.8s. A 42-line test binary links in 5.3s
and occupies **442 MB** on disk.

Confidence is **0.9** on the measurements; **0.75** on the proposed metric
set (OQ2).

## 1. Measurement (2026-08-27, this checkout)

Apple Silicon, Rust 1.97.0, dev profile, `target/` warm unless stated.

### 1a. The edit loop

| Operation | Wall |
|---|---:|
| `cargo check -p snapback-kernel --lib`, no-op | 0.75s |
| touch `kernel/src/storage.rs` → check kernel lib | 17.1s |
| `cargo check --workspace --all-targets`, **no-op** | **50.9s** |
| touch `kernel/src/storage.rs` → check workspace all-targets | 272s |

A no-op workspace check costing 51 seconds is a fixed tax on every
iteration — nothing changed; that is fingerprinting and stat overhead
across 460 Rust files, 15 crates, and 83 test targets.

### 1b. Marginal cost of an integration test binary

Deps warm, linking one additional test target:

| Test target | Source lines | Link wall | Binary |
|---|---:|---:|---:|
| `embeddable_library_v0` | 20 | 4.80s | 17 MB |
| `server_unknown_route` | 42 | 5.27s | 442 MB |

The cost is **per binary, not per test**. A 20-line file that asserts one
import still pays a full link against the `snapback` rlib.

Extrapolated across the current population:

- 79 targets in `crates/snapback` × ~5s ≈ **6.6 minutes of pure link**
- 83 workspace-wide × ~5s ≈ **6.9 minutes**

and it grows by ~5 seconds for every integration test file added. LLP 0175
recorded `cargo test` at 6.2 min total with "roughly 4.9 min build/link"
— consistent with link being the dominant term, and the population has
since grown 46%.

### 1c. Disk

| | |
|---|---:|
| `target/` total | 134 GB |
| `target/debug` | 126 GB |
| `target/debug/deps` | 87 GB |
| `target/debug/incremental` | 35 GB |
| artifacts in `deps` over 100 MB | **137** |
| largest single rlib | 1.3 GB |

`issues/20260820` records the same phenomenon at the binary level:
`__LINKEDIT` is 56.75% of the 490 MB debug binary, and its string table
alone is 33.46% of the whole artifact.

### 1d. Corpus shape

737,030 lines of Rust across 460 files; 3,804 test functions; 83
integration test targets; 175 files with an inline `mod tests`.

## 2. What has already been decided, and what this respects

This RFC deliberately re-proposes nothing that has been ruled on.

**`issues/20260820` already investigated the debug profile and rejected
changing it.** Its recorded finding is that the dev default is *already*
`debuginfo=2` with `split-debuginfo=unpacked`, so "turn on split
debuginfo" is a no-op, and it ruled:

> Retain full split debug information as the default developer posture
> for now, and do not change `Cargo.toml` in this lane.
>
> Reduced debug with an opt-in full-symbol profile is a plausible
> experiment, but this investigation did not establish its size benefit
> or qualify LLDB locals, file/line crash symbolication, and actionable
> failure evidence under that profile.

It left two bounded follow-ups open: a binary-size/`__LINKEDIT` drift
metric, and a separately named reduced-debug experiment with explicit
acceptance. §3 and §4 are those two follow-ups, scoped as the ticket
asked — not a re-proposal of the rejected change.

**LLP 0175 D4 and Phase 4** sequence the experiments after D1–D3 and
require per-experiment measured acceptance. §5 respects that: this
document produces evidence and takes no position on the outcome.

**LLP 0325 §5d** already queues the file-splitting work that would reduce
per-file recompile cost. §1a quantifies why `engine.rs` and `server.rs`
sit at the top of that queue; this RFC does not duplicate its doctrine.

## 3. Proposal — a standing build-loop metric

Emit one machine-readable record per measured build, in the shape LLP 0175
D5 already requires of recurring gates:

- no-op `cargo check --workspace --all-targets` wall;
- single-crate incremental check wall for a named touch-file;
- marginal link wall for one fixed small integration target;
- integration-target count;
- `target/debug` bytes, `deps` bytes, count of artifacts over 100 MB;
- debug binary bytes, `__TEXT`, `__LINKEDIT`, symbol count, string-table
  bytes (the `issues/20260820` follow-up).

Run it on the existing scheduled backstop, not on landings. It is a
**report**, never a gate: an over-budget number is fix-forward under
LLP 0189 D-2 and LLP 0232, and must not refuse an unrelated push.

The 2026-08-27 numbers in §1 are the baseline.

## 4. Proposal — the named reduced-debug experiment

Discharging the second `issues/20260820` follow-up. On an isolated branch,
build a named profile (`devfast`) inheriting `dev` with
`debug = "line-tables-only"`, and record against the §1 baseline:

1. `target/debug` bytes and marginal link wall;
2. debug binary bytes and `__LINKEDIT` share;
3. **the acceptance the ticket demands** — LLDB locals inspection,
   file/line crash symbolication, and actionable panic backtraces, each
   demonstrated, not assumed;
4. `scripts/bootstrap-ibex-runtime` qualification: executable launch and
   restricted no-eval handler-VM creation, with the readiness receipt
   re-verified.

Adopt only if (3) and (4) hold. If they do not, record that and close the
follow-up — a negative result closes the ticket just as well as a positive
one, and the ticket has been open since 2026-08-20 for want of either.

An opt-in named profile is the safe shape: it changes no default, so a
developer who needs full symbols keeps them by omitting the flag.

## 5. What this does not do

- **It does not adopt `cargo-nextest`, `mold`/`lld`, codegen-unit tuning,
  or remote caching.** LLP 0175 D4 calls these "valid experiments, not
  assumed conclusions"; this RFC supplies evidence for that evaluation and
  takes no position.
- **It does not consolidate integration test targets.** §1b measures the
  cost D4 asked to have measured. Consolidation has test-selection,
  module-state, `@ref`, and failure-isolation consequences that D4 names
  and this document does not analyse. A 442 MB binary per 42-line test is
  a finding, not a mandate.
- **It does not change the default debug profile.** §4 is an opt-in
  experiment with the acceptance bar `issues/20260820` set.
- **It does not add a landing gate**, a complete-battery gate, or a
  publication block.
- **It does not reorder LLP 0175's phases.** If D1–D3 leave link time
  subdominant, Phase 4 should still decline consolidation — this document
  makes that judgement possible, not automatic.
- **It does not touch the shipped binary.** That is LLP 0314 / 0314.002.

## 6. Open questions

- **OQ1 — Is 51s of no-op workspace check reducible at all?** It may be
  irreducible fingerprinting for a tree this size, in which case the
  actionable advice is "scope your checks to a crate" and the metric
  exists only to detect regression. Worth one profiling pass before
  treating it as a target.
- **OQ2 — Metric set and home.** Is §3's list right, and does it live in
  the drift backstop, the local-proof backstop, or its own schedule? It
  must not require a clean checkout or a complete battery.
- **OQ3 — Does the 442 MB test binary generalise?** Two targets were
  measured. The distribution across 83 matters for the D4 evaluation:
  if most are 17 MB and a few are 442 MB, consolidation targets the few.
- **OQ4 — Test-target growth.** 57 → 83 happened without observation.
  Should the target count be a reported metric with a soft budget, in the
  ratchet style LLP 0325 §6 proposes for file size?

## 7. Cost

The metric script is a day's work and runs on an existing schedule. The
reduced-debug experiment is an isolated branch, a profile stanza, and the
four acceptance checks in §4 — bounded, and it either closes a five-week-old
ticket or records why it stays open.

Neither changes product behaviour, a default, or a contract.

## 8. Why it matters

The measurable facts are that a no-op workspace check costs 51 seconds, a
20-line test costs 5 seconds of linking, and `target/` is 134 GB. None of
these was observed anywhere, which is why the integration-target
population grew 46% and the debug binary grew 45% before either was
noticed.

LLP 0175 already decided the right posture — measure, then experiment,
with per-change acceptance. The measurement half was never built. This is
that half.

