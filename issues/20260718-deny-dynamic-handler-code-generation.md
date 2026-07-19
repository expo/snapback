# Deny dynamic handler code generation at the runtime boundary

**Status:** In Progress
**Severity:** P1
**Systems:** Runtime, Security, Auth/RBAC, Actions, Codegen, Upstream Ibex, Hermes, Workerd
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-18
**Related:** LLP 0009 §Capability Model; LLP 0009 §Supply Chain and Generated Bundles; LLP 0013 §Embedding dynamic-code policy; LLP 0048 §Handler-visible API surface
**Marker:** dynamic-code, eval, function-constructor, egress, bundle-identity, authority

An egress-enabled action can fetch mutable text while holding its declared
`ctx.secrets`, outbound-fetch, and `ctx.runMutation` authorities. Snapback's
codegen documentation claimed that dynamic code paths were banned, but the
token scanner did not diagnose `eval`, Function-family constructors, `with`,
constructor walks, or reflective aliases. More importantly, the local Hermes
runtime still enabled string compilation. Code such as
`Function("ctx", fetchedSource)(ctx)` could therefore execute bytes outside the
authenticated handler bundle under the action's existing authority. Host-side
RBAC still bounded that authority, but auditability and bundle identity did not.

Hermes's ordinary disabled-eval mode also contained a policy bypass: the
cached `Function("return this")` fast path returned before checking
`RuntimeConfig::enableEval`, exposing the real global through direct calls,
constructor walks, and `Reflect` even to a no-eval embedder.

**Done when:**

- Snapback creates Hermes through an explicit no-eval embedder entry point,
  while ordinary Ibex creation remains eval-capable for compatibility.
- A patched-header/unpatched-library SDK mismatch cannot create an unresolved
  latch reference; the linked framework export is verified and the restricted
  constructor fails closed when it is absent.
- The carried Hermes patch makes the cached `return this` path honor the same
  disabled-eval policy as every other Function-family body.
- Direct and indirect eval, normal/async/generator Function constructors,
  whitespace variants, constructor walks, and reflective invocation fail on
  both Ibex and Workerd before application code receives authority.
- The Workerd strip seals the global Function constructor and all reachable
  Function-family prototype constructors to the exact Snapback denier before
  handler evaluation; startup attests that diagnostic instead of assuming the
  local Workerd build disables V8 string compilation by default.
- Egress retains fetch and its documented compute APIs, but fetched bytes
  cannot become code and WebAssembly remains denied.
- Codegen uses an AST walk for precise defense-in-depth diagnostics, including
  `with`, dynamic import, and Function-family syntax without string/comment
  false positives, while preserving the declared `.ts`/`.mts` handler surface
  and authored spans.
- Fresh patch application, native tests, the two-engine twin, the full local
  proof, and canonical remote Linux proof all pass.

## Implemented; remote verification pending

Ibex now exposes `ex_hermes_create_no_eval`; Snapback uses it and probes the
complete constructor family during trusted setup. The variant completes trusted
Ibex bootstrap and then applies a one-way native latch before returning; a stale
engine without that latch fails closed. The build verifies both the header
declaration and the actual linked target framework/shared/static-library export
on macOS, iOS, Linux, Android, and Windows, avoiding header/library-skew link
failures. Hermes patch 0010 also closes the cached
`return this` exception. Workerd seals and attests its own equivalent
pre-handler denial rather than inheriting the local runtime's V8 default.
Egress and twin regressions cover direct aliases and an action constructor
that would otherwise receive `ctx.runMutation`. The codegen scanner now uses
Acorn for JavaScript and the pinned TypeScript compiler AST for `.ts`/`.mts`,
with stable authored spans and no type-syntax false rejection; it keeps only
the documented fetch/timer relaxation for egress actions.

Keep this ticket open until the updated submodule and canonical workflows are
green on `origin/main`.
