# Ibex single-Script concatenation lets application declarations shadow globals before bootstrap

**Status:** Open
**Filed:** 2026-08-19
**Severity:** Critical — defeats the harness control-plane seal
**Systems:** Runtime, Security/authorization, Ibex/Hermes
**Related:** LLP 0009 (Harness control-plane boundary), `4f38731bc`

## Finding

`invocation_source` (`crates/snapback-engine/src/runtime/host_glue.rs:6125`)
submits ambient + allowlist-install + ctx-bootstrap + application module + tail
as a **single Script**. Before the first statement of that Script executes,
Hermes performs global declaration instantiation for the whole Script — which
includes the application's declarations.

Application source containing

```js
function globalThis() {}
```

therefore replaces the real global object's writable `globalThis` property
*before* ambient or bootstrap evaluates. The bootstrap then receives the
attacker's function as `g`, seals `g.globalThis`, and successfully verifies the
descriptor — on the wrong object.

The application body can then recover the real realm global through top-level
`this`, replace `this.globalThis` with a hostile dispatcher, and use the real
`this.__hostCall`. The action path skips the deterministic Date/Math member
probe, so its ambient checks run against the fake root and pass under the
no-eval Hermes configuration.

**The `value === g` self-check cannot detect this.** It proves only that the
object passed as `g` points at itself, not that `g` is the realm's actual
global object. The `sameRoot:true` probe recorded for `4f38731bc` is therefore
insufficient evidence.

## Reproduction

Reproduced by an independent codex `gpt-5.6-sol` review against the bundled
Hermes engine, running the full action-shaped sequence (ambient denial,
allowlist, current bootstrap, no-eval setting):

```json
{"r":{"__snapbackOk":true,"value":{"bypassedAdmission":true}}}
```

Workerd does not share this defect: the application is a later, separate ESM
module rather than part of the same Script.

## Acceptance

- Application source is not part of the same Script as the harness bootstrap,
  or global declaration instantiation cannot reach the harness's lookup roots.
- The harness verifies it holds the *realm* global, not merely a self-referential
  object — a `value === g` check is not sufficient and must not be relied on.
- A regression plants `function globalThis() {}` in application source and
  proves the harness refuses or is unaffected.
