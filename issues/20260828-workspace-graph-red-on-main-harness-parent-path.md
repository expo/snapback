# `workspace-graph` proof gate is red on `main`: test harness `#[path]` escapes its member directory

- **Status:** Open
- **Filed:** 2026-08-28
- **Area:** `scripts/check-workspace-graph.mjs` (LLP 0193 proof gate `workspace-graph`),
  `crates/snapback/tests/_harness/`
- **Found by:** integration sweep of the 2026-08-28 ticket batch (surfaced by a lane
  that ran the gate incidentally, not by the gate's own scheduled run)

## Symptom

On a clean checkout of `origin/main`:

```
$ node scripts/check-workspace-graph.mjs; echo $?
SNAPBACK_WORKSPACE_GRAPH_VIOLATION: workspace #[path] is not a canonical in-member
Rust path: crates/snapback/tests/_harness/capability_v0.rs -> ../admin_v0.rs
1
```

Reproduced on `febc76ac1` and on `8037a535a`. This gate runs in the local proof at
`scripts/verify-local-proof:372`.

## Why it was not noticed

Two reasons, both worth fixing independently of the violation itself.

1. **Exit code masking.** The obvious way to run this gate —
   `node scripts/check-workspace-graph.mjs 2>&1 | tail -6` — reports `exit=0` in both
   `zsh` and `bash`, because the pipeline's status is `tail`'s. The violation line
   scrolls past and the gate reads as green. Under `set -e` this is silent.
   (`${pipestatus[1]}` in zsh / `${PIPESTATUS[0]}` in bash is the real status.)
2. The `../` traversal is *correctly* rejected — this is the checker working, not a
   checker bug. It is distinct from
   `issues/closed/20260825-workspace-graph-nested-path-resolves-from-wrong-directory.md`,
   which fixed nested `#[path]` resolution for non-root files and does **not** change
   this case (verified: the violation is identical with and without that fix merged).

## What needs deciding

`capability_v0.rs` reaching `../admin_v0.rs` is a shared test-harness module wanting to
live above its own directory. Either:

- **relocate** the harness modules so no `#[path]` crosses a member boundary (preferred —
  keeps the gate's invariant absolute), or
- **admit** an explicit, narrowly-scoped harness exemption in the checker, with the
  exemption enumerated rather than pattern-matched, so a future `../` cannot ride in on it.

Do not relax the general `../` rejection. `issues/closed/20260825-...` notes the existence
assertion is what keeps this fail-closed today; a blanket relaxation would turn a
correctness gap into a remount bypass.

## Acceptance

- `node scripts/check-workspace-graph.mjs` exits 0 on a clean `main`.
- A regression pins whichever disposition is chosen.
- Consider having the gate's own runner check `PIPESTATUS`, so a piped invocation cannot
  report green while returning non-zero.
