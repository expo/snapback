# Require canonical Promise reaction paths before trusting handling

**Status:** Resolved (2026-07-26)
**Severity:** P0
**Systems:** Runtime, Security, Storage, Auth/RBAC, Workerd
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0009 §Harness control-plane boundary
**Marker:** hermes, v8, promise, rejection-ledger, transaction-integrity

A detached rejected Promise could redirect native `then` through an own or
inherited hostile constructor. Two independently reproduced forms turned a
failed mutation into reported success and committed a buffered write:

- A constructor returned normally without invoking the executor, so no
  reaction attached even though the old mediator treated `then` return as
  proof of handling.
- A constructor invoked the executor with no-op resolve/reject capabilities.
  The source reaction genuinely ran, but rejection propagation into the child
  disappeared, so clearing the source entry still forged handling.

Returning a genuine fulfilled Promise as the first decoy defeats child-brand
checks. The second form proves that callback execution alone is also
insufficient. The constructor dispatch path itself must be canonical before
Snapback invokes or credits a reaction.

**Done when:**

- Hermes `_C` records rejection provisionally before captured observation and
  leaves that entry intact when the constructor path is unsafe.
- A getter-free gate requires the receiver's direct prototype to be the native
  Promise prototype and any own constructor to be absent or the exact native
  constructor data value.
- Both Hermes and V8 reject own, inherited, accessor, subclass, and proxy
  constructor paths before native `then` can accept untrusted child
  capabilities.
- Canonical Hermes reactions preserve fulfillment identity and rejection
  propagation, and clear the source only when a sealed reaction runs.
- Decoy and no-op-capability constructors cannot commit buffered writes, while
  genuinely caught, native-awaited, and pre-handled rejections still succeed.
- The canonical Linux proof and cross-engine conformance proof pass.

## Implemented; remote verification pending

The shared bootstrap now installs the canonical constructor-path gate on both
engines. Hermes additionally inserts `_C` provisionally, refines the reason
only through a canonical observer, and clears a source only from a running
sealed reaction. The adversarial corpus covers a genuine decoy Promise, no-op
child capabilities, and both own and inherited hostile constructors on Hermes
and V8, with exact rejection reasons and zero committed rows.

## Resolution

Canonical `main` local-proof run
[30191116596](https://github.com/ccheever/snapback/actions/runs/30191116596)
passed at commit `d5944bc96abb54d323f48395c7d78bac2d8c0dbe`. The
37-test unhandled-rejection suite passed the no-op child-capability,
constructor-poisoning, missing-reaction, source-binding, and normal
catch/await cases. The cross-engine workerd twin also passed the hostile
Promise-constructor and harness-control-plane regressions, with the enclosing
Rust proof reporting zero failures.
