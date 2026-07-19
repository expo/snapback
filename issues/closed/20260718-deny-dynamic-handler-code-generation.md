# Deny dynamic handler code generation at the runtime boundary

**Status:** Closed
**Severity:** P1
**Systems:** Runtime, Security, Auth/RBAC, Actions, Codegen, Upstream Ibex, Hermes, Workerd
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-18
**Closed:** 2026-07-18
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

## Resolution

Ibex commit `bfbc6133af739ed2dabc2f44efa693d1412452e5` exposes the fail-closed
`ex_hermes_create_no_eval` bootstrap and carries the Hermes fix that makes the
cached `Function("return this")` path honor disabled eval. Snapback verifies the
linked export, attests the full Function-family denial, and Workerd seals and
attests its equivalent boundary. Codegen now uses Acorn and the pinned
TypeScript AST for precise authored diagnostics. Local/Workerd twin, egress,
constructor-walk, reflection, and fetched-code regressions pass.

Snapback commit `a5ed6ebd05766b10607937a1c010352d79eea4b0` publishes the complete
runtime and scanner changes. GitHub Actions local-proof run `29674515103` and
required-surface-builds run `29674515104` passed on 2026-07-18.
