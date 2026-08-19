# Host call responses are decoded with an application-replaceable `JSON.parse`

**Status:** Open
**Filed:** 2026-08-19
**Severity:** Critical — authorization bypass
**Systems:** Runtime, Security/authorization, Ibex/Hermes bridge
**Related:** LLP 0009, LLP 0240, `bccb73724`

## Finding

`decodeHostCallPayload` in `vendor/ibex/src/engine/hermes_runtime.cc` resolves the
parser dynamically at call time, *after* handler source has evaluated:

```cpp
auto jsonGlobal = rt.global().getPropertyAsObject(rt, "JSON");
auto parseFn = jsonGlobal.getPropertyAsFunction(rt, "parse");
out = parseFn.call(rt, facebook::jsi::String::createFromUtf8(rt, json));
```

Capturing `JSON.parse` in `ctx-bootstrap.js` (line 15) does not capture the parser used
here, because this is the native bridge decoding the *host's response*, not the
invocation payload. `bccb73724` closed the payload direction only.

That the assignment sticks in Hermes is already proven by the test that motivated
`bccb73724`: the hostile handler's `JSON.parse` replacement took effect.

## Failure scenario

A generated protected query calls `ctx.permissions[...].allowsRole(resource, "owner")`.
Rust evaluates the predicate and returns the payload `+false`. A handler that installed
`JSON.parse = () => true` causes the native bridge to decode that denial as `true`, so
`if (!(await ...allowsRole(...))) return [];` does not return, and the generated wrapper
executes the protected body. The host decided "deny" and the handler observed "allow".

## Provenance

Found by an independent codex `gpt-5.6-sol` review of `bccb73724`; the orchestrator
verified the cited native code directly. A second independent reviewer (grok-4.6) did not
examine the native bridge and reported the class closed — it is not.

## Acceptance

- Host response decoding uses a parser the application cannot replace, captured before
  application source evaluates (or a decode path that does not call into JS at all).
- A regression proves a hostile `JSON.parse` cannot flip a host-owned `permissions.*`
  denial into an allow.
- The fix covers the workerd path as well, or records why that path differs.
