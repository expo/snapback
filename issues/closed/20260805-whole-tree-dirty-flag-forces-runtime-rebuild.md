# Whole-tree dirty flag invalidates the prepared runtime binary and forces rebuilds

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Build identity, Local proof, Developer experience, Testing
**Date:** 2026-08-05
**Governing:** LLP 0010
**Related:** LLP 0186 (W4); Diary 0059 ("a dirty checkout bypasses a prepared
binary and makes acceptance pay Cargo startup cost");
`issues/20260805-doc-comment-artifact-mismatch-no-successor-migration.md`
(sibling edit-loop tax); `issues/20260803-first-npm-latest-promotion.md`
(the external escape hatch)

## Problem

The build-identity dirtiness fact is derived from the **entire checkout** and
**baked into the binary at compile time**, so unrelated edits anywhere in the
repository disqualify the prepared, qualified `snapback` binary and put Cargo
back on the inner loop:

- `scripts/verify-local-proof` (`stamp_snapback_build_identity`) sets
  `SNAPBACK_BUILD_GIT_DIRTY=false` only when `git status --porcelain` over the
  whole repository is empty; a single modified file anywhere — a demo app's
  JavaScript, a diary, an issue ticket — makes the tree "dirty".
- `build.rs:241` declares `cargo:rerun-if-env-changed=SNAPBACK_BUILD_GIT_DIRTY`
  and `build.rs:302` bakes the value in via `cargo:rustc-env`, consumed by
  `option_env!` in `src/identity.rs:74` and the agent-safe binaries. So a
  clean→dirty flip (first unrelated edit) or dirty→clean flip (any commit)
  changes a compile-time input and triggers a real recompile of the
  identity-consuming crates, not just Cargo's no-op startup check.
- The digest-bound readiness receipt inherits the same whole-tree fact
  (`gitDirty` in the packed identity, `scripts/pack-hosted-release.mjs:769`),
  so harness rungs that re-verify the receipt before trusting a served binary
  stop trusting the prepared one for the same non-reason.

The integrity rule itself is correct — a binary must not claim a clean
identity its sources contradict. The defect is granularity: edits that cannot
affect the Rust binary's bytes still invalidate it. During the 2026-08-05
bakeoffs this charged Cargo cost to **every acceptance run**, because an agent
mid-iteration always has a dirty tree (the app under construction *is* the
dirt). This is a per-iteration tax — the class LLP 0186 W4 argues compounds
worse for agents than any single blocker — and it also pollutes any in-repo
benchmark lane's wall-clock numbers with build-system noise.

## Fix shape

Scope the dirtiness fact to the runtime binary's actual input set instead of
the whole tree:

- Define the input set explicitly (the Rust workspace sources, `Cargo.toml`/
  `Cargo.lock`, `build.rs`, and the vendored runtime inputs under
  `vendor/ibex` that participate in the build), and derive the flag from
  `git status --porcelain -- <input set>` in
  `stamp_snapback_build_identity` and anywhere else that stamps it.
- Keep the semantics of the baked fact unchanged: `dirty=true` still means
  "this binary's *inputs* were uncommitted", which is the only claim the
  identity ever needed to make. Demo, guide, LLP, and issue edits no longer
  flip it.
- Audit the receipt/pack path (`pack-hosted-release.mjs`, harness rungs,
  `verify-local-proof`) so all consumers agree on the scoped definition —
  a mixed regime where the binary says clean and a checker recomputes
  whole-tree dirty would reintroduce the mismatch as a refusal.
- Optional hardening: have the harness log which paths made the input set
  dirty when it does fall back to a rebuild, so a genuine runtime edit is
  distinguishable from a scoping bug.

Out of scope here but tracked by the related ticket: promoting the published
runtime carriers so external app-builders are never on the Cargo path at all.

## Acceptance

- With a clean runtime input set and arbitrary uncommitted edits under
  `demos/`, `guide/`, `llp/`, or `issues/`, acceptance runs reuse the
  prepared, receipt-qualified binary with no `cargo` invocation and the
  binary's identity still reports `dirty=false`.
- Editing any file inside the defined input set flips the flag, invalidates
  the receipt, and forces the rebuild exactly as today.
- Committing unrelated non-input files does not trigger a recompile of the
  identity-consuming crates.
- `scripts/verify-local-proof` and the packed-release identity checks agree
  on the scoped definition (no clean-vs-dirty mismatch refusals).

## Resolution

**Resolved:** 2026-08-05, branch `fix/dirty-flag-scoped-inputs`.

The dirtiness fact is now scoped to an explicit runtime input set with a
single shared definition:

- **`scripts/runtime-build-inputs.txt`** (new) is the one place the input set
  is defined: one git pathspec per line (`#` comments). It contains the Cargo
  build inputs (`build.rs`, `Cargo.toml`, `Cargo.lock`,
  `rust-toolchain.toml`), the crate sources (`src`), the vendored runtime
  crate (`vendor/ibex`), and — because the binary embeds them — `guide/`,
  `brand/`, `packages/snapback-harness`, `packages/snapback-admin-client`,
  and the `tests/conformance` / `tests/acceptance` fixture receipts that
  `include_bytes!` pulls into `src/manifest.rs` and the telemetry bench. The
  list file itself is a member (editing it changes what the stamp means).
- The canonical probe everywhere is
  `git status --porcelain --ignore-submodules=untracked -- <pathspecs>`;
  empty output ⇒ clean. A consumer that cannot read the definition file falls
  back to whole-tree status, which can only over-report dirtiness.
- Consumers audited and converted to the shared definition:
  - `build.rs` (compile-time fallback probe; also
    `rerun-if-changed=scripts/runtime-build-inputs.txt`),
  - `scripts/verify-local-proof` (`stamp_snapback_build_identity`),
  - `scripts/bootstrap-ibex-runtime` (`reuse_authoritative_runtime_receipt`
    — previously three whole-tree checks: diff, cached diff, ls-files),
  - `demos/_kit/provenance.mjs` (`readCheckoutBinaryIdentity`, feeding the
    kit's prebuilt rung and `verifyBinaryProvenance`),
  - `packages/snapback-cli/runtime-recovery.mjs`
    (`readCheckoutRuntimeIdentity`, feeding doctor/link-smoke expected
    stamps), and
  - `tests/conformance/run-versioned-seed-v1.mjs` (the exact-binary binding
    in the closed LLP 0109 dispatcher).
- Hardening: when the input set IS dirty, `verify-local-proof` and the
  bootstrap reuse gate log exactly which paths made it dirty, so a genuine
  runtime edit is distinguishable from a scoping bug.
- Whole-tree probes deliberately **left unscoped** because they state a
  different fact: `scripts/snapback-publish.mjs` `sourceDirty()` and
  `scripts/snapback-package-cold-install-lib.mjs`
  `measureGitCheckoutIdentity` (publication-lane "was the package built from
  a fully clean checkout" release gates), and the snapback-cli
  `releaseSourceFacts` app-deploy dirty gate (about the *app project's*
  source, not this repo). `scripts/pack-hosted-release.mjs` still compares
  its caller-declared `--source-dirty` against the binary's baked flag; a
  release pipeline must now declare the scoped fact (compute it over
  `scripts/runtime-build-inputs.txt` pathspecs) for that equality to hold on
  a tree with non-input dirt — from a fully clean release tree, nothing
  changes.

Two deliberate deviations from the ticket text, both for the semantics the
ticket itself demands ("dirty=true still means this binary's inputs were
uncommitted"):

1. `guide/` **stays inside** the input set: `build.rs` declares
   `rerun-if-changed=guide` and embeds the guide corpus into the binary, so a
   guide edit genuinely changes the binary's bytes; stamping it clean would
   be a false identity. Demo, LLP, issue, and diary edits are excluded as the
   ticket asks.
2. The acceptance bullet "committing unrelated non-input files does not
   trigger a recompile" is only partially achieved: the dirty→clean *flip*
   on commit is gone (the scoped flag was already false), but a commit still
   rotates HEAD and therefore the baked `SNAPBACK_BUILD_GIT_COMMIT`, which
   recompiles the identity crates once. Scoping the commit fact (e.g.
   `git log -1 -- <input set>`) would change the meaning of
   `gitCommit`/`source-revision` for every receipt and provenance consumer
   and is left as a possible follow-on (noted in LLP 0186 W4).

Verified: with an uncommitted file under `demos/` (and `issues/`) the scoped
probe reports clean, `verify-local-proof` stamps
`SNAPBACK_BUILD_GIT_DIRTY=false`, and a rebuilt-then-touched tree performs no
recompile; touching `src/lib.rs` flips the flag and the identity crates
rebuild; the bootstrap reuse gate reuses the receipt with demo dirt present
and logs the dirty paths when `src` is edited. Docs updated in the same
change: LLP 0031 §Server-binary identity, LLP 0186 W4,
`guide/operating/diagnostics.md`.

## Exact-head recurrence — GitHub run 31150398178

The original audit missed the LLP 0109 versioned-seed dispatcher. On the PR
merge checkout, its whole-tree `git status` disagreed with the already
qualified binary's runtime-input-scoped `gitDirty: false`, so all 20 behavioral
cases passed but the dispatcher correctly refused the mismatched revision.
The dispatcher now consumes the shared `readCheckoutRuntimeIdentity` fact.
Its suite also no longer runs an unrelated root `cargo build` when the caller
supplies an explicit staged binary; that build had overwritten the qualified
root target and turned the one binding refusal into six later readiness/link
timeout failures. No identity or readiness check was weakened.
