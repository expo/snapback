# cargo clippy --all-targets -D warnings: 124 promoted lints on main

**Opened:** 2026-08-09
**Context:** split out of the P0 compile ticket (now closed) — clippy's exit
101 there was the E0624 compile break; with compilation fixed, the clippy leg
fails on promoted lints that predate the fix.

Breakdown at the fix commit:
- 83 = deprecated AppState constructor uses (`detached` 39, `from_snapback`
  25, `with_auth_provider` 12, `from_snapback_with_secret_read_operator` 6,
  `new` 1) — the deprecating change landed without migrating callers to the
  try_* forms; the deprecating session owns the sweep (mostly src/admin.rs,
  src/server/tests.rs, src/instance_fork.rs, src/cli/tests.rs).
- ~41 assorted (needless borrow ×18, too-many-arguments ×~9, useless vec ×2,
  etc.) in long-standing files.
- 4 lints in the 0199 slice-created kernel modules were fixed in the same
  change that closed the P0 (allow-annotations on verbatim-moved signatures).

Local-proof's cargo-clippy gate stays red until the sweep lands; reds are
fix-forward per LLP 0189, not retroactive invalidation.
