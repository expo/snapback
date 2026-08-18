# Contract/Exact Integration

> This page is a compatibility pointer. The Snapback Guide is the
> authoritative authoring and operating documentation for Contract/Exact
> integration.

Use these guide pages:

- [Contract adapter](../../guide/clients/contract-adapter.md) — generated
  bindings, surface boot, optimistic overlays, provider conformance, and
  Exact project checks.
- [Headless client](../../guide/clients/headless.md) — the framework-neutral
  `SnapbackClient` surface used beneath Contract and acceptance tests.
- [Offline replay and retention](../../guide/sync/offline-and-retention.md) —
  retained-query eligibility, replay ordering, and Online versus Parity
  capability claims.
- [Admin console](../../guide/operating/admin-console.md) — static/native builds,
  the browser development loop, launch shapes, and privileged system-app
  boundaries.
- [Diagnostics](../../guide/operating/diagnostics.md) — assertion failures,
  stable diagnostic codes, bootstrap failures, and read-only diagnosis.

The Todo v2 demo is the reference application for ordinary Contract authoring.
Historical implementation rationale remains in
[LLP 0021](../../llp/0021-contract-exact-integration-hardening.plan.md) and
[LLP 0034](../../llp/0034-contract-source-seam-provider-side.rfc.md); prior notes
remain available in Git history.
