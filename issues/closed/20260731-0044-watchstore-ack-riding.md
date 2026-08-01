# watchStore applies witnessed snapshots without discharging the obligation

**Status:** Resolved — 2026-07-31

Sessions-mode asset live subscriptions receive witnessed
`authorization_invalidation` envelopes (never plain `live_replace`).
`SnapbackAssetClient.watchStore`'s former raw-lane consumer applied the
witnessed snapshot rows but did not run the LLP 0053 obligation machinery, so
the post-commit ACK token was never sent. LLP 0053's lease kept this safe for
unreachable clients, but reachable watchers incurred lease-driven redelivery
and quarantine instead of clean discharge.

## Resolution

Production watchers now route through `SnapbackClient.liveQuery` with a
synchronous `onAuthorizationBoundary`. The deep client therefore owns the
never-reused query namespace, authorization fence, exact resolution identity,
duplicate/redelivery ledger, and remote ACK. The asset external-store boundary
applies witnessed rows synchronously before the ACK request can begin;
ordinary non-authorization replacements use the normal update callback.

The raw `subscribeLive`/durable-consumer path remains only for shallow adapters
that do not expose `liveQuery`, preserving the existing compatibility tests
without treating that path as sessions-capable.

Focused evidence in
`packages/snapback-client/assets-watch-authorization.test.mjs` proves:

- the establishment snapshot is externally visible before its ACK;
- same-turn exact duplicates share one application and ACK task;
- delayed exact redelivery re-ACKs the same token without reapplying rows;
- a thrown synchronous store publication fails closed and emits no ACK; and
- a successor watcher receives a strictly newer LLP 0053 query-instance id.

Verification passed: `node packages/snapback-client/assets.test.mjs`,
`node packages/snapback-client/assets-watch-authorization.test.mjs`, the full
`@expo/snapback-client` package test, and `./ref-check --verbose` (138 LLP docs,
2,621 refs, zero errors). `node scripts/check-guide.mjs` was also run; its
repository baseline is red on pre-existing missing generated demo snippets and
a stale generated manifest, none of which this client-only change touches.
The package-test inventory registers this new suite, then exposes the separate
pre-existing omission of `packages/snapback-react/assets.test.mjs` from that
canonical inventory.
