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

1. **Renamed seeds: closed; cross-crate symbol graph: open.** The committed
   `renamed privilege imports seed returns and facade re-exports` corpus probe
   imports `privilege_source::KernelCommitAuthority as Root`, returns `Root`,
   and re-exports `Root as RenamedPrivilegeFacade`; both egresses now fail the
   gate. Crates are still scanned independently rather than through the cross-
   crate symbol graph LLP 0284 §4.1 originally required. Exact remaining
   shape: an out-of-workspace dependency exports the seed only as `Root`, and a
   workspace crate contains only `pub use opaque_bridge::Root as Facade;`.
   That façade names neither a canonical seed nor an in-crate alias seeded from
   one, so it is missed. For two workspace crates, the origin re-export is
   rejected but a downstream `pub use bridge::Root as Facade;` is not
   independently attributed.
2. **Trait and impl forms: open.** Direct raw-handle/seed names in either the
   trait or self position, including `impl From<Wrapper> for
   rusqlite::Connection`, are covered. These exact shapes remain missed:

   ```rust
   pub trait Project { type Output; fn project(self) -> Self::Output; }
   pub struct Wrapper<T>(pub T);
   impl<T> Project for Wrapper<T> {
       type Output = T;
       fn project(self) -> T { self.0 }
   }
   // A dependent substitutes Wrapper<rusqlite::Connection>.
   ```

   ```rust
   mod hidden {
       pub trait GivesHandle { fn handle(&self) -> rusqlite::Connection; }
   }
   pub fn leak() -> Box<dyn hidden::GivesHandle> { todo!() }
   pub trait PublicHandle: hidden::GivesHandle {}
   ```

   The first requires type substitution; the second and third require resolving
   a private-path trait contract and inherited private supertrait contract.
3. **Cross-module split-token macros: closed; expansion synthesis: open.** The
   committed macro corpus now fails when `pub` exists only in a `make!`
   definition in one module and `rusqlite::Connection` only in its invocation
   in another. It also fails an otherwise unknown
   `paste!(pub fn ... -> rusqlite::Connection)` invocation carrying all three
   literal sensitive tokens. Macro expansion itself remains unavailable. This
   exact identifier-synthesizing form is still missed:

   ```rust
   paste::paste! {
       pub fn leak() -> [<rusq lite>]::[<Connec tion>] { todo!() }
   }
   ```

   So is `external_emit::privilege_api!();` when an external macro emits the
   entire public sensitive item and the invocation carries no sensitive token.
4. **Authority-discriminator indirection and sink names.** I-16 performs no
   body-flow taint analysis. This exact shape is missed (with the registry
   spellings resolving elsewhere in the scanned corpus):

   ```rust
   pub enum UserWriter { User, Admin }
   struct Wrapped { writer: UserWriter }
   fn helper(writer: UserWriter) -> UserWriter { writer }
   fn sanctioned(_wrapped: &Wrapped) {}
   pub fn execute_membership(writer: UserWriter) {
       let writer = match writer {
           UserWriter::Admin => helper(UserWriter::Admin),
           other => helper(other),
       };
       sanctioned(&Wrapped { writer });
   }
   ```

   Renaming the real sink to `renamed_sanctioned` is also missed when an
   unrelated `sanctioned` elsewhere keeps the global registry entry observed.

## Done when

Close individual rows only when committed negative-corpus probes demonstrate
the replacement coverage and LLP 0284 is updated. A broader finding count or
additional spelling rules do not close these residuals. A stable expansion or
rustdoc/type-analysis interface may replace several rows together, but the
gate must continue to state that it is a ratchet rather than a proof unless a
separately reviewed completeness argument exists.
