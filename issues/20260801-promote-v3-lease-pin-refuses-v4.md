# snapback-promote pins the v3 lease generation; the authority only issues v4

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Ease:** 4
**Confidence:** 5
**Severity:** P0
**Systems:** Packaging
**Author:** Claude (Fable 5), promotion/5-rebuild lane (SD-6)
**Date:** 2026-08-01
**Related:** LLP 0041, LLP 0115, LLP 0130,
issues/20260731-sd6-scope-migration-and-rebuild.md,
issues/20260801-first-latest-promotion-no-distinct-prior-root.md
**Marker:** parity-moves, sd-6, promotion

`scripts/snapback-promote.mjs` (line 205 at `2586a2f4`) hard-refuses any
lease that is not the v3 generation:

```js
if (lease.schemaVersion !== 'snapback.authorized-publication-lease.v3') {
  fail('promotion requires a v3 lease bound to prior default closure evidence');
}
```

The decision-9 terminal-scope migration (`add06902`, recorded in LLP 0041
§Decision-9 terminal-scope migration) moved the current lease generation to
v4: `packages/snapback-publication-authority/authority.mjs` refuses non-v4
issue requests ("standing authority only issues v4 publication leases") and
signs only `snapback.authorized-publication-lease.v4`; `request.mjs`
constructs only v4 issue requests; `scripts/snapback-promotion-core.test.mjs`
exercises v4 leases. The pin above was added in `ffdf8acf` when v3 was the
current generation and was not bumped by the migration.

Consequence: the promote CLI refuses every lease the current authority can
issue. The verbatim refusal is:

```
snapback-promote: promotion requires a v3 lease bound to prior default closure evidence
```

No workaround exists through inputs: a v3 lease validates only against the
legacy `@ccheever/snapback-*` name table (`protocol.mjs`
`validateLeasePackages`, `LEGACY_PROMOTION_PACKAGE_NAMES`), so a v3 lease for
the terminal `@expo/snapback-*` candidate ledger is impossible by
construction. The refusal fires in promote's preflight, before authority
acquisition and before any registry mutation.

Discovered 2026-08-01 by the SD-6 promotion/5-rebuild lane while standing up
the first leased promotion (0.1.7, candidate ledger `d64d6bce…`). Per that
lane's fail-closed rule, the pin was reported, not edited.

Fix shape for the owner: bump the pin to the v4 generation (it carries the
same prior-default-closure binding the message names — v4 leases bind
`priorDefaultClosureReceiptSha256` exactly as v3 did), and add a regression
test asserting the promote CLI accepts the lease generation the in-repo
authority currently issues, so the next generation bump cannot strand the
promotion path again.
