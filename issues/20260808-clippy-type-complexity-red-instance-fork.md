# `cargo clippy --all-targets -- -D warnings` is red on main (instance_fork test hook)

**Opened:** 2026-08-08
**Area:** `src/instance_fork.rs` test-only thread-local hooks; the
`cargo-clippy` rung of `scripts/verify-local-proof`
**Severity:** P3 — gate red, no product behaviour affected

## Observed

The local proof's clippy rung runs `cargo clippy --all-targets -- -D warnings`.
On main it fails while compiling the lib test target:

```
error: very complex type used. Consider factoring parts into `type` definitions
   --> src/instance_fork.rs:124:37
    |
124 |       static JSON_BEFORE_RENAME_HOOK: std::cell::RefCell<
125 | |         Option<Box<dyn FnOnce(&Path, &Path)>>,
126 | |     > = const { std::cell::RefCell::new(None) };
    |
    = note: `-D clippy::type-complexity` implied by `-D warnings`
error: could not compile `snapback` (lib test) due to 2 previous errors
```

The `#[cfg(test)] thread_local!` block was last touched by `622d61b9f`
(fix(forks): round-1 blocker 3 — first-writer-wins app-root identity). It is
unrelated to any current change; found incidentally while running the clippy
gate for the SIGTERM/WAL shutdown fix
(`issues/closed/20260807-server-sigterm-strands-large-sqlite-wal.md`).

## Ask

Introduce a `type` alias for the boxed hook (e.g.
`type JsonBeforeRenameHook = Box<dyn FnOnce(&Path, &Path)>;`) so the
thread-local reads plainly, and re-green the `cargo-clippy` rung. Prefer the
alias over an `#[allow(clippy::type_complexity)]`.
