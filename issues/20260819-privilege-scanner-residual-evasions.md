# Privilege scanner residual evasions

**Status:** Open
**Systems:** Security/authorization, Build, Verification, Rust core
**Date:** 2026-08-19
**Related:** LLP 0284 §3.7, LLP 0283 F-2

## Boundary

The `kernel-raw-sql-api` privilege-surface scanner is a syntactic ratchet, not
a proof of the public privilege closure. LLP 0284 §3.7 is the authoritative
honest-limits statement. This ticket keeps the demonstrated residual evasions
as follow-up work without blocking the bounded final F-2 hardening round.

## Demonstrated residuals

1. **Renamed seeds and cross-crate aliases.** A `bridge` crate can import
   `KernelCommitAuthority as Root` and re-export it through a façade without a
   scanner finding. Renamed SQL imports are seeded, renamed privilege seeds are
   not, and crates are scanned independently rather than through the cross-
   crate symbol graph originally required by LLP 0284 §4.1.
2. **Trait and impl forms.** `impl From<Wrapper> for
   rusqlite::Connection` is missed even though callers can write
   `Connection::from(Wrapper)`, making it a concrete I-5 egress. Separate
   probes also miss blanket/generic impl methods, trait objects named only
   through private paths, and sensitive contracts inherited through private
   supertraits.
3. **Macros across module/expansion boundaries.** A `macro_rules!` definition
   in one module and invocation in another is missed because macro recognition
   is module-local. In the concrete
   `make!(name, rusqlite::Connection)` probe, `pub` exists only in the
   definition and `Connection` only in the invocation, yet neither side fires.
   `paste!`-style invocations can also carry literal `pub`, `rusqlite`, and
   `Connection` tokens without a finding when the invoked macro name is not in
   that module's registry.
4. **Authority-discriminator indirection and sink names.** I-16 performs no
   body-flow taint analysis. A probe carrying `UserWriter::Admin` through a
   helper, a `match`, a local, and a private `Wrapped { writer }` field into
   `sanctioned(&Wrapped)` is missed; renaming `sanctioned` also evades the
   fixed sink registry.

## Done when

Close individual rows only when committed negative-corpus probes demonstrate
the replacement coverage and LLP 0284 is updated. A broader finding count or
additional spelling rules do not close these residuals. A stable expansion or
rustdoc/type-analysis interface may replace several rows together, but the
gate must continue to state that it is a ratchet rather than a proof unless a
separately reviewed completeness argument exists.
