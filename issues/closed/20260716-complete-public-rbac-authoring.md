# Complete public RBAC authoring and nominal resource typing

**Status:** Closed
**Severity:** P2
**Systems:** RBAC, Codegen, Type generation, Schema manifests, Guide
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0056 §Declaring a membership table, §Rule helpers, and §Status
**Marker:** feature-completeness, developer-experience

The Rust runtime contains membership manifests, transition execution, helper
lowering, and a dynamic harness bridge, but the supported source-authoring path
cannot declare or consume the feature.

`packages/snapback-codegen/define.mjs` exposes neither `v.principal()` nor
`v.id(table)`, and `TableBuilder` has no `.membership(...)`. The emitter in
`packages/snapback-codegen/index.mjs` emits legacy permission-backing metadata
but never `TableManifest.membership`. `define.d.ts` has the same omissions,
along with no declaration-bound `memberOf`/`hasRole` helpers or typed
`ctx.permissions`/mutation-only `ctx.membership` methods. It also omits the
runtime-supported `authorityCreating` function option.

On the Rust side, `FieldType` has `Principal` but no nominal `Id<table>`
reference. Membership resource axes currently accept a plain string or
principal, and helper validation can prove only that a row field exists—not
that it refers to the declaration's resource table. Query arguments have no
load-time nominal check either.

Normal Snapback applications therefore cannot use the new RBAC model through
the documented codegen workflow, while hand-built manifests bypass the
authoring checks that should make it safe.

**Done when:**

- Add `v.principal()` and a manifest-preserving `v.id(table)` nominal type
  across authoring, Rust schema, generated types, SQLite coercion, and schema
  compatibility checks.
- Add a closed `TableBuilder.membership()` that emits the declaration and its
  generated indexes.
- Generate declaration-bound query helpers and typed `ctx.permissions` plus
  mutation-only `ctx.membership` operations.
- Type and emit `authorityCreating` consistently.
- Reject row-field and argument bindings whose nominal resource type differs
  from the declaration's `resourceTable`.
- Add codegen, artifact-schema, and end-to-end app tests, plus a demo and diary
  entry, after the P1 activation/visibility/write-enforcement tickets are
  closed.

## Resolution

Closed 2026-07-16. Commit `7576856` shipped nominal ids, membership declarations,
generated permission/mutation APIs, activation parity, the `demos/rbac` acceptance app,
guide material, and diary coverage.
