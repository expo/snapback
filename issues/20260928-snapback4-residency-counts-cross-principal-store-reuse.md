# Snapback 4: residency reports prior-principal counts when an opener reuses a store

Status: Open
Date: 2026-09-28
Scope: Snapback 4 native/web device residency and custom opener store identity
Related: LLP 3000.019 §3.4, LLP 3000.028 §3.4, LLP 3000.011.003.000 §2

Lane OK round 1 confirms that native `client.residency()` can list Alice's
`$ownKeys:likes` row count when Bob opens the same physical store offline.
The ordinary private `notes` table behaves identically. Both report one row,
and two public `likes` rows remain. Native `sqlite_residency.rs::read` takes a
schema and store, but no viewer; it reads table counters for all stored rows.
The web counter cache likewise describes the whole store. Owner-key tables
are not worse than ordinary tables on this measurement surface.

Reproduction uses an intentionally aliasing custom `DeviceOpener`: acquire
Alice, sign out offline, and map Bob's requested store name to Alice's physical
store. Normal `createLocalClient` names stores with both URL and principal
(`local.ts`, `storeName`); native/web openers honoring those names keep them
separate. No normal account-switch disclosure is claimed by this reproduction.

The same-store control also returns Alice's ordinary `notes[id]` row to Bob:
ordinary device reads rely on the per-principal replica boundary. In contrast,
owner-key `exists likes[post, viewer]` remains raw `unknown: true` for Bob,
including an absent key and his old key below the public horizon. It never
borrows Alice's complete marker. Alice's offline reopen retains complete
absence, as the sign-out design requires. This broader raw-store boundary
should be considered when deciding the residency fix, rather than implying
viewer-filtered counters alone would isolate an incorrectly shared replica.

Evidence and executable reproduction:

- [Public client test](../snapback4/packages/snapback4/test/own-keys.test.mjs),
  native and wasm, with real sessions, a server snapshot, offline sign-out and
  same-store reopen. Diagnostic output records counts, bytes and the ordinary
  private-row control.
- [Round 1 report](../snapback4/reports/20260928-ok-owner-key-coverage/ROUND1.md)
  and its `round1/owner-lifecycle.log`.
- `snapback4/crates/snapback4-device/src/sqlite_residency.rs::read`,
  `snapback4/packages/snapback4/src/web-residency.ts::snapshot` and
  `snapback4/packages/snapback4/src/local.ts` store naming.

Run `node --test packages/snapback4/test/own-keys.test.mjs` from `snapback4/`
after the normal native/wasm/package builds. The test creates only temporary
stores; it does not open the calibration evidence store.

Follow-up: decide whether custom-opened devices should bind/refuse mismatched
principals, or residency should explicitly document its store-wide semantics.
Keep local sign-out's existing replica/outbox preservation. Any principal
fence must preserve same-principal offline reopening and pending writes, and
must cover native and web consistently.
