# Privilege scanner residual evasions

**Status:** Open — residuals 1 and 2 closed 2026-08-26; 3 and 4 remain
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


## Residuals 1 and 2 closed — 2026-08-26 (`dec78e0f5`)

**Residual 1, cross-crate symbol graph: closed.** The Node driver now derives local normal-dependency
identity from `cargo metadata`, includes excluded bridge packages under the audited root when their
graph leads back to a workspace package, scans dependencies before dependents, and passes canonical
seed aliases into each dependent syn scan. The ticket's exact shape — an out-of-workspace dependency
exporting the seed only as `Root`, and a workspace crate containing only
`pub use opaque_bridge::Root as Facade;` — is now independently rejected as a `KernelCommitAuthority`
re-export.

**Residual 2, trait and impl forms: closed for the demonstrated shapes.** The Rust scanner resolves
local private trait return contracts and local supertrait inheritance to a fixpoint. All three of the
ticket's literal shapes now produce independent findings: the `Project`/`Wrapper<T>` generic
projection, the boxed private-path `GivesHandle` return, and the public
`PublicHandle: hidden::GivesHandle` supertrait.

**Fail-first was recorded for both**, in the right order: the probe crates were added *first* and the
focused tests exited 1 — for residual 2, with none of the three required items present in the output —
before the scanner changes, then passed after.

**No false positives.** Product-tree comparison held at **103 inherited findings before residual 1,
103 after residual 1, and 103 after residual 2**. No legitimate workspace item was newly rejected.
That result is not luck: the generic substitution rule is deliberately bounded, requiring a normal
`rusqlite` dependency, a public wrapper field exposing the generic parameter, a local public projecting
trait, *and* a local impl mapping the projection back to that parameter. A narrower rule that misses a
shape is preferable to one that rejects legitimate code, because the latter gets switched off.

Scanner suite 28/28 on the rebased tree. The lane's originally-reported inherited reds were artefacts
of a stale base predating the `agent_random_source` repair and cleared on rebase.

**Landing note, stated honestly:** this landed on the lane's recorded fail-first and false-positive
evidence plus an independent 28/28 suite run by the orchestrator. It did **not** receive a separate
adversarial review, on the grounds that it is instrument code rather than product code and the
false-positive risk — the thing that would matter — was measured workspace-wide.

## What remains

**Residual 3 (macro expansion synthesis)** and **residual 4 (authority-discriminator indirection and
body-flow taint)** are unchanged and were deliberately out of scope. Both are genuinely beyond a
syntactic scanner on the pinned `rustc 1.97.0`, where rustdoc JSON is unavailable. The honest-limits
statement in LLP 0284 §3.7 remains the authority for what this gate does and does not prove.
