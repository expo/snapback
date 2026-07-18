# Observe propagated harness rejection promises on Hermes

**Status:** In Progress
**Severity:** P1
**Systems:** Runtime, Security, Auth/RBAC, CI
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0009 §Harness control-plane boundary; LLP 0048 §Architecture; GitHub Actions run 29634324789; `issues/20260717-require-canonical-promise-reaction-paths.md`; `issues/20260717-harden-harness-diagnostic-inspection.md`
**Marker:** hermes, promise, rejection-ledger, rbac, linux

The canonical Linux proof returned
`SNAPBACK_HANDLER_UNHANDLED_REJECTION` for two awaited RBAC host failures that
must preserve their host-owned diagnostics. The affected membership-bridge
tests expected `SNAPBACK_HANDLER_HOST_CALL_INVALID` and
`SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED`; the same tree passed locally on
macOS.

The first Hermes portability repair attached a sealed mediated reaction to the
handler or settlement source Promise. That reaction propagated a rejection by
throwing into its own child Promise, then returned that child to native
`await`. Linux Hermes can notify its rejection hook for the propagated child
before native `await` records its internal reaction, so the rejection ledger
mistook the harness's own Promise for detached application work and masked the
typed failure.

**Done when:**

- Every Promise created by the harness observation step is explicitly handled
  through sealed captured intrinsics before native `await`.
- The propagated Promise still delivers the original value or rejection to
  settlement unchanged.
- The observer creates no ignored rejecting Promise and does not suppress
  application-created detached rejections.
- Immediate handler and typed host rejections keep their intended diagnostics
  on Linux while the detached-rejection and intrinsic-poisoning corpus remains
  fail-closed.
- The canonical Linux proof passes.

## Implemented; remote verification pending

`observeHarnessPromise` now attaches a second sealed reaction to the
propagating child before returning it. Both guard callbacks return `undefined`,
so the ignored guard child always fulfills; the original child remains the
value native `await` consumes. A focused malformed-host-call regression pins
the exact `return await` shape alongside the existing immediate-rejection,
detached-chain, and `Function.prototype.call` poisoning cases.
