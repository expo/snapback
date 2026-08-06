# `cargo clippy -D warnings` was red after concurrent Rust landings

**Status:** Resolved
**Opened:** 2026-08-06
**Resolved:** 2026-08-06
**Systems:** Rust, local proof

`cargo clippy --all-targets -- -D warnings` reproduced outside the sweep with
project errors across fork promotion, publication, operation detail/ledger,
migration, storage, CLI, host operations, and fork test helpers. The errors
included unreachable code, dead test-only helpers, complex tuple types,
needless borrows/closures, suspicious open options, and overly broad function
signatures.

## Resolution

The implementation now removes the duplicate CLI arm and unused wrappers,
test-gates test-only helpers, names complex row/hook tuples, uses direct and
derived idioms where semantics are unchanged, and makes the admission-lock
non-truncation policy explicit. The few transaction/publication seams whose
independent axes are intentionally explicit retain scoped
`clippy::too_many_arguments` exceptions with inline reasons; no broad or
unjustified lint suppression was added.

Verification: `cargo clippy --all-targets -- -D warnings` passed. The vendored
Ibex crate still emits six ordinary dependency warnings, but Snapback has no
promoted lint error and the exact local-proof command exits zero.
