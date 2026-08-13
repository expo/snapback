# LLP 0249 rollout 3: local worker custody behind isolated_node_action_v1

**Status:** Open — blocked
**Severity:** P1
**Systems:** Runtime, worker custody, manifest capability, operational readiness
**Date:** 2026-08-12
**Related:** LLP 0249 rollout 3; `src/manifest.rs:10197-10500`; `spike-isolated-node-action/RESULTS-20260812.md`

## Scope

Implement local isolated-worker custody behind the experimental
`isolated_node_action_v1` capability and extend `OperationalReadinessV1` only
after the four prerequisite authorities are accepted and qualified:

1. `issues/20260812-0249-egress-admission-v1-design.md`
2. `issues/20260812-0249-isolation-attestation-launcher-channel.md`
3. `issues/20260812-0249-os-isolation-qualification-battery.md`
4. `issues/20260812-0249-action-effects-vocabulary.md`

The spike measured a 5,499-byte admitted bundle, 1.778875 ms preload-to-entry
cold start, 227.287750 ms total worker process time, and 75,661,312-byte RSS,
but explicitly did not qualify OS isolation or production custody.

## Capability-mint checklist

Use the capability-mint discipline at `src/manifest.rs:10197-10500`. The
experimental row must bind at least:

- the closed authoring/source profile and dependency-closure identity;
- the worker/runtime executable identities and supported target;
- a live, unexpired launcher attestation and channel/session binding;
- OS-policy, broker, classifier, deny-fact, and adversarial-probe digests;
- per-attempt budgets, cancellation/timeout, worker-loss, and result
  validation receipts;
- OperationalReadinessV1 degradation/refusal semantics; and
- scoped LLP 0189 qualification evidence, with no claim derived from this
  spike directory.

## Completion

All four blockers are closed, the manifest capability is experimental and
fail-closed, local custody survives the required lifecycle tests, readiness
cannot be self-asserted or replayed, and the exact integrated capability row
has its claim-relevant qualification digest.
