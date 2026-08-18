# Main is not rustfmt-idempotent under rustfmt 1.9.0 — `cargo fmt --all` rewrites ~400 unrelated lines

**Opened:** 2026-08-10 · **Severity:** P2 (silently inflates every diff whose
author runs `cargo fmt`) · **Area:** lint hygiene / toolchain pinning

## What

On clean `origin/main` at `3d1553975`, with

```
rustfmt 1.9.0-stable (2d8144b788 2026-07-07)
rustc   1.97.0 (2d8144b78 2026-07-07)
```

`cargo fmt --all` is not a no-op. It rewrites code in at least these modules,
none of which are unformatted in any way a reviewer would call broken:

```
crates/snapback/src/admin.rs                     crates/snapback/src/server/api_error.rs
crates/snapback/src/agent_safe_publication.rs    crates/snapback/src/storage/auth_rehearsal.rs
crates/snapback/src/auth/rehearsal.rs            crates/snapback/src/storage/auth_stream.rs
crates/snapback/src/auth/throttle.rs             crates/snapback/src/storage/capability_links.rs
crates/snapback/src/authoring_suggestion.rs      crates/snapback/src/storage/webhooks.rs
crates/snapback/src/remediation.rs               crates/snapback/src/watches.rs
crates/snapback/src/runtime.rs                   crates/snapback/src/webhooks.rs
crates/snapback/src/auth/provider.rs             crates/snapback/tests/auth_artifacts_v1.rs
crates/snapback/src/server.rs                    crates/snapback/src/server/effects.rs
crates/snapback/src/local.rs                     crates/snapback/src/storage/pending_effects.rs
```

`crates/snapback/src/server/effects.rs` alone accounts for ~266 rewritten lines. The changes
are ordinary rustfmt output — collapsing wrapped call chains, re-wrapping
`use` groups, moving `else` onto its own line after a multi-line `let ... =
... else` — i.e. the file was last formatted by a *different* rustfmt.

## Why it matters

Any landing whose author runs `cargo fmt --all` (the obvious thing to do
before pushing) silently acquires several hundred lines of unrelated churn.
That is how a 140-line semantic slice becomes a 550-line diff nobody can
review. It was caught during the LLP 0225 item-3 first cut
(`issues/20260810-owner2-kernel-auth-authority-shapes-slice.md`), where the
churn had to be reverted hunk-by-hunk before landing; the slice's real diff
was 142 insertions / 175 deletions.

## Failure scenario

Two agents land in the same hour. One ran `cargo fmt --all`, one did not. The
formatter's output is now committed for half the tree, so the next agent who
runs it gets a *different* unrelated set — and every rebase between them
conflicts in files neither author edited.

## Fix

One of, in preference order:

1. **Pin the formatter.** Add a `rust-toolchain.toml` (or pin rustfmt in the
   proof) so every agent and CI run formats identically, then land one
   whole-tree reformat under that pin as a single mechanical commit.
2. Land the whole-tree reformat under 1.9.0 now and accept that anyone on an
   older toolchain re-drifts it — strictly worse than (1), but better than the
   status quo.

Until then, the working rule this ticket records: **do not run `cargo fmt
--all` as part of an unrelated landing.** Format only what you wrote.

## Confidence

High — reproduced on a clean worktree at `3d1553975`, and independently
confirmed by `rustfmt --edition 2024 --check` reporting drift on HEAD's own
copy of `crates/snapback/src/server/effects.rs` before any local edit.
