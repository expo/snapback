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

## Resolution — 2026-08-10

Swept in the clippy-debt landing: all ~83 deprecated AppState constructor
callers migrated to the try_* forms (test code uses .expect; the deprecated
public constructors remain for compatibility; the internal pub(crate)
new_with_secret_read_operator wrapper was removed with its last caller), the
assorted lints fixed, and 21 scoped #[allow]s with one-line reasons where
signature redesign was out of scope. Verified on the landing tree:
`cargo clippy --all-targets -- -D warnings` exit 0; lib suite 2480 passed /
2 failed (both pre-existing, ticketed); four pre-existing non-lib target
failures proven at pristine base 84097094b and ticketed separately
(handler-error-exposure triple; 20260810-effects-routes-route-policy-parity-red.md).
