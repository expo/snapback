# `cargo clippy --all-targets -- -D warnings` is red on main (instance_fork type_complexity)

**Opened:** 2026-08-08 · **Severity:** P3 (a local-proof gate is red for a pre-existing reason)

`scripts/verify-local-proof` runs `cargo clippy --all-targets -- -D warnings`
(line ~323). On main today that command fails, in code untouched by the
change that noticed it:

```text
error: very complex type used. Consider factoring parts into `type` definitions
   --> src/instance_fork.rs:124:37
    |
124 |       static JSON_BEFORE_RENAME_HOOK: std::cell::RefCell<
125 | |         Option<Box<dyn FnOnce(&Path, &Path)>>,
126 | |     > = const { std::cell::RefCell::new(None) };
error: could not compile `snapback` (lib test) due to 2 previous errors
```

Both reported errors are the same site (once per test cfg). It appears only
under `--all-targets` / `--tests`; `cargo clippy --lib -- -D warnings` is
clean, which is why ordinary landings do not see it. Reproduced 2026-08-08 in
a clean worktree at `3bea79ec0` plus an unrelated route-lowering change that
does not touch `src/instance_fork.rs`.

Fix is one line: a `type JsonBeforeRenameHook = Option<Box<dyn FnOnce(&Path, &Path)>>;`
alias, or a scoped `#[allow(clippy::type_complexity)]` with a reason. Filed
rather than fixed inline so it does not ride an unrelated commit
(`issues/20260808-route-group-argument-lowering.md`).
