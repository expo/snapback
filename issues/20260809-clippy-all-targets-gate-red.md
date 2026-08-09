# main red: `cargo clippy --all-targets -- -D warnings` fails (101 errors at 46b26b91a)

**Opened:** 2026-08-09 · **Severity:** P2 gate hygiene (main red, fix-forward
per LLP 0189) · **Found by:** LLP 0200 Lane C landing verification

At origin/main HEAD 46b26b91a the restored clippy gate (64843e075) is red
again: 101 errors, verified on a pristine detached checkout. Breakdown
(lane-c measurement, af0fbd5bf was materially identical at 95):

- ~83 uses of deprecated `admin::AppState` constructors
  (`detached`, `from_snapback`, `with_auth_provider`,
  `from_snapback_with_secret_read_operator`, `new`) — the LLP 0199
  owner-2 refactor deprecated them in favor of `try_*` but the test
  corpus still calls the old names.
- A handful of ordinary lints (`too_many_arguments`, `cmp_owned`,
  `derivable_impls`, dead code) in assets/live-scheduler test modules.

Ask: migrate the test-corpus callers to the `try_*` constructors (or
scope an explicit `#[allow(deprecated)]` with a ticket pointer if the
migration is staged), fix the stray lints, and keep the
`--all-targets -D warnings` gate green. The Lane C landing removed 3 of
the errors (stray `src/local/tests.rs.orig` and adjacent dead code); the
remainder is untouched.
