# Seal Function.prototype.call against rejection-ledger bypass

**Status:** Closed
**Severity:** P1
**Systems:** Handler runtime, Security, Storage, Acceptance testing
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0009 §Harness control-plane boundary; ENG-23361
**Marker:** hermes, promise, rejection, intrinsic-poisoning, atomicity

The Hermes rejection ledger captured Ibex's pre-application `then` wrapper,
but that wrapper internally invoked the underlying native method through the
live `Function.prototype.call`. Application code could replace `call` with a
selective function that returned normally without attaching the rejection
observer. Ibex's wrapper and Snapback's mediator then both treated the promise
as handled even though no reaction existed.

An end-to-end mutation exploit buffered a row, installed that selective
poison, created a detached `Promise.reject`, and returned success. Before the
repair the invocation returned `Ok` at version 1 with `changed_count: 1`; the
row committed despite the detached rejection. This violated the invocation
atomicity floor, not merely diagnostic fidelity.

**Done when:**

- The Hermes bootstrap pins the captured native `Function.prototype.call`
  before application evaluation and verifies the exact non-writable,
  non-configurable descriptor.
- The selective-poison exploit reports
  `SNAPBACK_HANDLER_UNHANDLED_REJECTION` and commits no row.
- Direct `_B` calls remain inert, `_C` cannot forge a reason, and ordinary
  handled/awaited rejections retain their existing behavior.
- The membership, settlement, harness-security, and engine-twin proofs pass.

## Resolution

Snapback now seals only `Function.prototype.call` on the Hermes rejection-ledger
path. This is the only mutable dispatch that could make Ibex's captured
`wrappedThen` return normally without reaching the hidden native `then`;
poisonable collection bookkeeping either runs before that dispatch or can only
throw/fail closed. Snapback's own `Reflect.apply`, Map, and WeakSet operations
were already captured native references. Harness initialization fails closed
if the descriptor cannot be installed or does not match the captured function.

The regression reproduces the complete attack, including the buffered write,
and verifies both the typed detached-rejection diagnostic and an empty table
after failure.

Verification after the repair:

- the exploit regression passed after first proving the vulnerable build
  returned `Ok`, advanced to version 1, and committed one row;
- all 14 `unhandled_rejection_v0` cases passed;
- all six `runtime::membership_bridge_tests`, all seven
  `handler_settlement_v0` cases, and the harness-security proof passed;
- all 25 `workerd_twin_v0` conformance cases passed; and
- `cargo fmt --all -- --check`, `git diff --check`, and
  `./ref-check --verbose` passed.
