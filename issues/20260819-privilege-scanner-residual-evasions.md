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

1. **Renamed seeds and cross-crate symbol graph: closed.** The committed
   `renamed privilege imports seed returns and facade re-exports` corpus probe
   imports `privilege_source::KernelCommitAuthority as Root`, returns `Root`,
   and re-exports `Root as RenamedPrivilegeFacade`; both egresses fail the
   gate. The replacement probe adds an excluded local dependency that exports
   the seed only as `Root` and a workspace member whose only item is `pub use
   opaque_bridge::Root as Facade;`. Fail-first, the façade assertion had no
   matching finding. The scanner now orders normal local dependencies through
   cargo metadata and carries canonical seed identity through each named
   public re-export, so `opaque_facade::Facade` is independently rejected as a
   `KernelCommitAuthority` re-export. Named two-workspace-crate chains use the
   same graph. A controlled product scan remained at the same 103 inherited
   F-1 findings with propagation disabled and enabled; no legitimate item was
   newly rejected.
2. **Trait and impl forms: closed for the demonstrated shapes.** Direct
   raw-handle/seed names in either the trait or self position, including `impl
   From<Wrapper> for rusqlite::Connection`, remain covered. The replacement
   crate commits these exact shapes:

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

   Fail-first, none of the three expected items appeared. The scanner now
   recognizes the first only when a public wrapper field exposes the generic
   parameter, a local public trait projects an associated type, its local impl
   maps that projection back to the exposed parameter, and the crate has a
   normal `rusqlite` dependency. It inventories private local trait contracts
   and resolves local supertrait inheritance to a fixpoint for the second and
   third. The after-run independently rejects `Wrapper::Project`, `leak`, and
   `PublicHandle`. The product scan stayed at the same 103 inherited F-1
   findings. This is a bounded syn rule, not a claim of full rustc trait
   selection, specialization, external-impl, or where-clause reasoning.
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
   Reconfirmed 2026-08-26: the gate recursively inventories literal tokens but
   matches complete canonical identifiers; `rusq` + `lite` and `Connec` +
   `tion` therefore do not become sensitive names without expansion. The
   pinned rustc 1.97.0 exposes no usable stable rustdoc-JSON/expansion path, so
   these synthesis cases remain honest limits rather than attempted heuristics.
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
   Reconfirmed 2026-08-26: I-16 intersects caller-constructible names written
   directly in registered sink signatures and records sink observation in a
   crate-wide set. It does not visit bodies or bind an observation to each call
   site, so the helper/wrapper flow and unrelated-spelling control remain exact
   descriptions of the boundary.

## Done when

Close individual rows only when committed negative-corpus probes demonstrate
the replacement coverage and LLP 0284 is updated. A broader finding count or
additional spelling rules do not close these residuals. A stable expansion or
rustdoc/type-analysis interface may replace several rows together, but the
gate must continue to state that it is a ratchet rather than a proof unless a
separately reviewed completeness argument exists.
