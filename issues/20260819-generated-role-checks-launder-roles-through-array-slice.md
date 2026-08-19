# Generated role checks launder hard-coded roles through replaceable `Array.prototype.slice`

**Status:** Open
**Filed:** 2026-08-19
**Severity:** High — authorization bypass
**Systems:** Runtime, Security/authorization, Codegen
**Related:** LLP 0009, LLP 0240, `bccb73724`

## Finding

`ctx.permissions[...].allowsRole` and `.requireRole`
(`packages/snapback-harness/ctx-bootstrap.js:1313`, `:1321`) build the role list with the
ambient, replaceable prototype method:

```js
var roles = Array.prototype.slice.call(arguments, 1);
```

The roles in those `arguments` are **not** handler-supplied in the case that matters: the
generated security wrapper hard-codes them. `packages/snapback-codegen/index.mjs:9086`
emits `[resource, ...predicate.roles.map(JSON.stringify)]`, producing
`await ctx.permissions[...].requireRole(args.x, "owner")`.

## Failure scenario

Handler source sets `Array.prototype.slice = () => ["member"]`. An owner-only generated
wrapper calls `requireRole(resource, "owner")`, but the host receives `roles: ["member"]`.
`member` is a valid vocabulary role, so Rust evaluates the substituted role and admits the
call. The generated wrapper's authorization constant has been rewritten by the code it
constrains.

## Provenance

Found by an independent codex `gpt-5.6-sol` review of `bccb73724`, which reported
reproducing the substitution against the actual bootstrap. The orchestrator verified both
cited sites. A second reviewer (grok-4.6) saw the same sites but dismissed them as
"handler-supplied"; that is correct for hand-written calls and wrong for generated
wrappers, which are the security-relevant case.

## Acceptance

- Generated role checks derive their role list through a captured intrinsic, so a
  replaced `Array.prototype.slice` cannot substitute roles.
- A regression proves an owner-only generated wrapper cannot be downgraded to `member`.
- Audit sibling uses of ambient prototype methods on host-owned or codegen-owned data in
  `ctx-bootstrap.js` (e.g. the query-plan copy at `:719`).
