# Rust's inherent-impl rule blocks module-owner-based crate carving

**Status:** Open
**Filed:** 2026-08-18
**Systems:** Project, Build, Architecture
**Related:** LLP 0276, LLP 0225
**Found by:** dual blind review of the Phase 2 integrated splits (codex
gpt-5.6-sol, grok-4.6) — findings 3, 4 and 5 share this single root cause.

## The constraint

Rust requires an inherent `impl Type { … }` block to live in the crate that
defines `Type`. LLP 0225's ownership map, the LLP 0276 crate matrix, and the
Phase 2 carve map all assign ownership **per module**, on the assumption that a
module can be relocated to the crate matching its owner. That assumption fails
wherever the module is an inherent `impl` on a type owned by a *different*
crate — the code cannot follow its owner, because the language forbids it.

This was invisible during the in-place split phase: splitting `impl Foo` across
several modules inside one crate is legal and compiles. It only becomes a wall
at the crate boundary.

## Three measured instances

1. **`SchemaManifest::validate_artifact`** (`crates/snapback/src/manifest/push_assets.rs:41`)
   validates core/API/auth, then vector (lines 271–300), push (302–311), and
   assets (313+). It is an inherent `impl SchemaManifest`. `SchemaManifest`
   belongs to `snapback-types` (rank 0), so this body cannot live in
   `snapback-services` (rank 3). The same applies to
   `manifest/capabilities.rs:2414`, which jointly assembles publication, auth,
   push, asset and vector facts in one constructor.
2. **`crates/snapback/src/local/activation.rs`** is one large inherent
   `impl LocalSnapback` touching database, warm VMs, telemetry, cron, config,
   routes and ephemeral state. It cannot move to `snapback-activation` because
   `LocalSnapback` defines the engine; moving it would drag engine state upward
   into a lower-ranked crate.
3. **`DerivedForkRuntime::deny`** (`crates/snapback/src/instance_fork/service.rs:2207`)
   is an inherent impl whose type is declared in `contract.rs`, while
   kernel-owned `storage.rs` stores the type (`:1294`), calls `inspect_boot`
   (`:1875`) and invokes `deny` (`:4557`). After a services carve, rank-1 kernel
   would need an illegal upward edge or would stop compiling.

## Why this matters beyond these three

The carve map assigns 242 files by module owner. Every assignment where the
module is an inherent `impl` on a type owned elsewhere is subject to the same
failure, and the failure surfaces only at the carve — i.e. late, in the window.
The count of affected modules has not been measured yet; it should be, before
the kernel, services and engine carves.

## Resolution patterns (in preference order)

1. **Trait, not inherent impl.** Declare a trait in the crate that should own
   the *behavior*, and implement it for the type in the crate that owns the
   *type*. Rust permits this when the trait is local to the implementing crate's
   dependency set, so behavior ownership can then differ from data ownership.
2. **Free functions.** Convert `impl Type { fn f(&self) }` to
   `fn f(t: &Type)` in the owning-behavior crate. Cheapest mechanically, but
   changes call syntax at every site.
3. **Keep the impl with its type.** Accept that the leaf crate carries some
   behavior that is nominally another owner's concern, and record it as a named
   exception in `crates/allowed-dependencies.v1.json`. Honest, and appropriate
   where the behavior is genuinely about the data shape.
4. **Split the type.** Sometimes the right answer is that the type itself is
   mixed-owner and should become two types.

## Recommended action

- Measure the full set: enumerate every module assigned to a crate other than
  the one defining the type its inherent impls target.
- Choose a pattern per instance before the kernel/services/engine carves rather
  than discovering them one compile error at a time.
- Amend LLP 0276 (and the carve map) to state the constraint explicitly, so
  future ownership assignments account for it. The RFC's ownership model is
  module-based and silently assumes module relocation is always possible.
