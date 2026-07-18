# Bind ephemeral self to the granted connection id

**Status:** Closed
**Severity:** P1
**Systems:** Client kit, Ephemeral state, Contract adapter, React cursor demo, Provider conformance, Guide
**Author:** Codex (GPT-5)
**Date:** 2026-07-17
**Related:** LLP 0013; LLP 0031 §Connection capability grants; LLP 0034 §4/§6
**Marker:** ephemeral, connection-grant, identity, contract, react, conformance

The app-facing `connectionId` passed to `SnapbackClient` is a readable label
for client-side grant/socket registries. It is not necessarily the granted wire
id. An initial unclaimed suggestion may be adopted verbatim in local dev, but a
live collision or permanent mint-only containment returns an opaque `conn_*`
id. Connection-owned ephemeral entries use that granted id as their lease key.

The Contract adapter and cursors-web React hook compared entry keys with the
readable label, so `self` became false for the publisher whenever the values
diverged. Raw conformance frames and several assertions encoded the same
dev-adoption assumption, masking the defect.

**Done when:**

- The overlay exposes the exact granted id used by its successful subscribe,
  including the one token-refresh retry.
- Contract and React derive connection-keyed `self` from that overlay fact and
  fail closed when a non-kit injected overlay does not provide it.
- Provider conformance forces a readable-label collision and proves distinct
  per-tab self/source keys.
- Raw frames and key assertions use granted ids or confirmed publish outcomes.
- LLP and guide wording distinguish readable labels from granted wire ids.
- The cursor demo diary records the implementation experience.

## Resolution

`subscribeEphemeral` now binds `overlay.grantedConnectionId` inside the exact
grant-scoped request closure, so a token-rejection retry replaces the candidate
id before the overlay can escape. Contract and React compare connection-owned
entry keys with that field. Contract requires a string self key before
comparing, so absent metadata cannot match even a malformed null entry.
Adjacent provider/regression assertions use confirmed publish keys rather than
guessing from labels.

The provider identity proof first occupies tab A's readable suggestion through
another client, then verifies that the tested tab receives an opaque `conn_*`
grant and still identifies exactly one self entry.

Verification on 2026-07-17:

- `node demos/_kit/tests/client-errors.mjs` — passed 73/73, including opaque
  token-refresh identity.
- `npm test` in `packages/snapback-contract` — passed.
- `npm run typecheck` and `npm run build` in the cursors React surface — passed.
- `node demos/_kit/tests/provider-live-conformance.mjs` — passed 14/14,
  including forced opaque-grant multi-connection identity.
- `node demos/_kit/tests/regression-overlay-crossroom.mjs` — passed 1/1.
- `node scripts/check-guide.mjs` — passed (unrelated freshness warnings only).
- `./ref-check --verbose` — passed: 63 LLP docs, 1,366 refs, 0 errors.
