# PUSH-01b: make the optional push registry additive

**Status:** Closed
**Systems:** JS client, Packaging, Bundle metrology
**Related:** LLP 0143 D6, LLP 0145 Phase A,
`issues/closed/20260802-push-01-0143-implementation.md`

## Defect

The PUSH-01a landing put installation-id generation, token validation, registry
methods, and `client.push` construction in the root `@expo/snapback-client`
module. Applications that never selected notifications therefore retained the
push runtime, contradicting LLP 0143 D6 and the additive-capability posture
measured by LLP 0145.

## Resolution — 2026-08-02

Commit `91a0a718f7c0bf39a5c14fb28704434d3d477649` moves the runtime and
declarations to `@expo/snapback-client/push-registry` and requires explicit
`attachPushRegistry`. The root client has no push property, option, type, or
export. The addon receives the existing package-private request funnel, so
registration remains behind external-bearer replacement without publishing a
generic request API. Ordinary `health`, `auth`, and `roomPermission` behavior
and arity remain exact.

The repair leaves `baseline.v1.json` byte-identical and keeps all 24 primary
profiles within their first-run ceilings. A new versioned prospective receipt,
`baseline.push-registry.v1.json`, is source-bound to the implementation commit
and freezes the explicit public subpath, positive attachment, and root-negative
profiles. Its positive metafiles retain `push-registry.mjs`; the primary and
root-negative metafiles exclude it.

## Proof

- Node 24.18.0 `node scripts/client-bundle-metrology.mjs --check-primary`:
  all 24 primary profiles green; exactly three declared push additions awaited
  their prospective ledger.
- Node 24.18.0 `node scripts/client-bundle-metrology.mjs --check`: primary and
  push supplemental ledgers green.
- Full `npm test` in `packages/snapback-client`, `packages/snapback-react`, and
  `packages/snapback-codegen`: pass after the standard generated-artifact graph
  was materialized.
- `scripts/check-generated-artifacts`, `node scripts/check-guide.mjs`, and
  `./ref-check --verbose`: pass (guide freshness warnings remain informational).
- Registry negatives cover malformed custody and ids, token response leaks,
  missing custody, absent-root runtime/type surface, unchanged public method
  signatures, native-token reacquisition, and held external-bearer replacement.

This is a D6 client-boundary correction only. The send lane, audience
authorization, provider handoff ledger, tickets/receipts, hosted path, and
`notifications` capability remain open in PUSH-01.
