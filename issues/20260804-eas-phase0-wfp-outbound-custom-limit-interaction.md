# EAS Phase 0: qualify WfP custom limits when an outbound Worker is attached

**Status:** OPEN — Gate 0 action kill-domain follow-up; P0.1 uses an explicit
split topology and does not claim native outbound-path limits

## Observed

The 2026-08-04 minimal control proved native WfP custom limits on the proof
account without an outbound Worker: three subrequest bombs failed at five and a
calibrated CPU burn was terminated after Cloudflare's documented isolate
flexibility.

In the full topology, a dispatch binding configured with outbound parameters
did not exhibit those native custom-limit results. Twelve outbound-mediated
fetches returned 200, and five calibrated CPU attempts returned 200 when the
same outbound options accompanied the dispatch. Omitting declared outbound
parameters made the invocation fail with `Missing one or more required
arguments to worker.`

## Current containment

P0.1 splits the namespace into two dispatcher bindings:

- handler invocations have no outbound Worker and retain native CPU
  termination; the generated harness denies handler network access;
- action invocations retain the outbound allowlist and fail closed through the
  generated `SNAPBACK_SUBREQUEST_LIMIT` guard. Ambient `globalThis.fetch` is
  frozen-denied before a separate application module is evaluated, so app code
  cannot reach the trusted native-fetch closure and egress is available only
  through the governed per-invocation `ctx.fetch` helper, which is revoked after
  application settlement. The trusted module entry is bound to the real
  `env.HOST` service-binding identity so app-module re-entry cannot mint another
  counter.

The capability profile must report these layers honestly and must not project
the minimal native result onto the outbound action path.

## Next steps

1. Reduce the combined `limits` + `outbound` behavior to a support-ready
   Cloudflare example with timestamps and Ray IDs but no account values.
2. Confirm with Cloudflare whether custom limits are specified to compose with
   outbound Workers or whether the accounting boundary is intentionally reset.
3. Carry the spike's trusted-main/separate-app-module boundary into the
   production generator and adversarially audit dynamic escape paths, or replace
   it with a stronger host/kill boundary.
4. Select and adversarially qualify the action CPU/wall-clock kill domain before
   `eas-cloudflare-wfp-v1` claims hosted untrusted execution.

## Evidence

- `demos/eas-phase0/receipts/p0.1-wfp-minimal-control.json`
- `demos/eas-phase0/receipts/p0.1-wfp-dispatch-namespace.json`
- `issues/closed/20260803-eas-phase0-wfp-custom-limits-not-enforced.md`
