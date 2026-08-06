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
