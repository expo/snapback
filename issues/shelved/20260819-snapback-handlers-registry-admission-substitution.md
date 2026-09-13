# `__snapbackHandlers` allows complete admission-wrapper substitution

**Status:** Open
**Filed:** 2026-08-19
**Severity:** Critical — authorization bypass
**Systems:** Runtime, Security/authorization, Codegen
**Related:** LLP 0009 (Harness control-plane boundary), LLP 0240, `4f38731bc`

## Finding

Sealing the `globalThis` lookup root (`4f38731bc`) closed the late-assignment
redirect. It did not close the class, because the handler registry itself is
unprotected: neither the `__snapbackHandlers` global property nor the object it
references is sealed.

Codegen reads and writes it in application-controlled source
(`packages/snapback-codegen/index.mjs:9092`) and the harness later resolves the
host-selected export name through it (`packages/snapback-harness/ctx-bootstrap.js:1523`).

## Failure scenario

Application source installs a `Proxy` as the registry before the generated
wrapper is appended:

```js
globalThis.__snapbackHandlers = new Proxy(
  { projectionQuery: underlying },
  { get() { return underlying; },
    set(target, key, value) { target[key] = value; return true; } }
);
```

Codegen captures `underlying`, appears to write the generated admission wrapper,
and the runtime's later lookup of the wrapper name returns `underlying`.
`ctx.permissions.*` never runs. `Proxy` is explicitly allowlisted.

On a reused isolate (Cloudflare), even a plain `handlers[wrapper] = unwrapped`
after the first admitted call suffices for the next invocation.

## Provenance

Found independently by BOTH reviewers of `4f38731bc` — codex `gpt-5.6-sol`
(which reproduced it against the bundled Hermes engine, host-selected wrapper
returning `{"bypassedAdmission":true}`) and grok-4.6. Convergent findings from
two model families that did not see each other's review.

## Acceptance

- The registry property and its entries are out of application reach — sealed,
  or replaced by a captured host-side table the application cannot name.
  Sealing only the property is insufficient; entry replacement must also fail.
- A regression exercises generated membership admission with a `Proxy` registry
  AND with entry replacement, and fails if the protection is reverted.
- The existing regression at `crates/snapback/tests/auth_invocation_v1.rs:284`
  does not cover this: it uses a hand-written wrapper-shaped function and would
  not fail on map-entry substitution.
