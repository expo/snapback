# Preserve handled host-rejection diagnostics on Linux Hermes

**Status:** Closed
**Severity:** P1
**Systems:** Handler runtime, Auth, RBAC, Acceptance testing, CI
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0009 §Harness control-plane boundary; LLP 0055 §Authority-creating operations; LLP 0056 §Rule helpers
**Marker:** hermes, promise, rejection, linux, auth, rbac

GitHub Actions run 29631948936 reported two Linux-only failures in the
membership bridge proofs. An invalid `ctx.permissions.requireRole` argument and
an unconsented dynamic `ctx.membership` call both reached their intended Rust
host gates, but the invocation surfaced `SNAPBACK_HANDLER_UNHANDLED_REJECTION`
instead of the typed `SNAPBACK_HANDLER_HOST_CALL_INVALID` and
`SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED` diagnostics.

The host helpers throw synchronously inside async handlers. Their handler
promises are therefore already rejected when returned to the harness. On the
Linux Hermes build, the native rejection hook can run before the harness's
native `await` records its internal reaction. Because the security ledger
intentionally ignores the handler-reachable `_B` hook and recognizes only its
sealed `then` mediator, that real harness observation was absent from the
ledger and the detached-rejection sweep masked the handler's typed failure.

**Done when:**

- Harness-owned handler and settlement promises attach a real sealed reaction
  before native `await` on Hermes.
- Direct `_B` calls remain inert and detached rejections still fail closed.
- Both membership bridge proofs preserve their typed diagnostics.
- The Ibex rejection/security/settlement suites and workerd twin remain green.

## Resolution

The bootstrap now normalizes promises through captured pre-application
intrinsics and explicitly observes both the handler result and settlement
promise. On Hermes that observation uses the already-sealed `then` mediator,
which marks the source promise handled only after native reaction attachment
succeeds; workerd retains the captured native `then`. A regression covers an
async handler that is already rejected when it returns control. The hostile
hook probes and detached-rejection cases continue to exercise the fail-closed
ledger rather than trusting caller assertions.

A follow-up adversarial review found that Ibex's captured `then` wrapper still
dispatched through the live `Function.prototype.call`. That separate atomicity
issue and its durable-write exploit are closed in
`20260717-seal-function-call-against-rejection-ledger-bypass.md`; the mediator
is now safe to use after application evaluation because its remaining dynamic
dispatch is pinned before the module runs.

Focused verification after the repair:

- all six `runtime::membership_bridge_tests` passed;
- all 14 `unhandled_rejection_v0` cases passed;
- all seven `handler_settlement_v0` cases and the harness security proof passed;
- all 25 `workerd_twin_v0` conformance cases passed;
- the complete 1,106-test library suite passed with 64 test threads; and
- `cargo clippy --lib --tests -- -D warnings`,
  `cargo fmt --all -- --check`, `git diff --check`, and
  `./ref-check --verbose` passed.
