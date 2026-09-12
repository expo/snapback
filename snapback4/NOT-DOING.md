# What Snapback 4 Does Not Do

Longer than the doing-list on purpose. Moving something off it means writing one
line naming what it unblocks and taking something off the doing-list in the same
change. Nothing comes off during slice one (LLP 3000 §3: the clock is four weeks).

## The bars

The bakeoff gates in [LLP 3000 §3](../llp/3000-snapback4.explainer.md) are the
bars: the loop bar, hub acquisition within 2× the measured floor, client bytes
under the competitor-anchored budgets, the six scenarios green in the simulator
on the hub fixture. Everything not required to pass them does not exist yet.

## Not building

- **A second authoring language.** Quarry, one spelling, copied from Snapback 2 (LLP 1004, LLP 1007 §4b). TypeScript is for seeds, journeys, effect bodies and the client.
- **Byte- and step-priced certification.** No closure, heap, output or step ceilings at `check`; the certificate certifies shape, uniformity, completeness class and prediction eligibility. Resources are metered at runtime (LLP 2000.000 §6).
- **A per-query result cache.** No range receipts, validators, halos, absence evidence, coverage spans, extent facts, held directories, fact integrity or swap journals. The client replicates declared partitions with one watermark each (LLP 2000.000 §7).
- **Engine-minted ids for client inserts, grants, ID slices.** Ids are client-minted, time-ordered, 128-bit; the engine mints for its own writes.
- **The `drain` protocol, follower-tab inbox rows, `defineItems`, `withHistory`, `mutationTarget`, `receipt.source`, `local.caughtUp`, `partial` reason codes.** The card (`packages/snapback4/src/contract.ts`) is the whole client vocabulary; `why` carries the rest.
- **`retain` as a receipt rule.** `until-revoked` and `delivered-history` survive as the client's leave policy on a scope tombstone.
- **JavaScript in the data plane.** Queries and mutations run in the Rust interpreter inside the SQLite transaction, and in the same interpreter on the client (host decided at week 3 by measurement, LLP 2000.000 §9).
- **An embedded JS engine for effects, until measured.** The four reference effects are measured on the builder's Node, an embedded engine and a hosted isolate first (LLP 2000.000 §10).
- **Committed generated code; an auth mode; a supervised bundler.** As Snapback 2 (`rules/NOT-DOING.md`): types by inference, personas not modes, `SNAPBACK_URL` is the client contract.
- **A TypeScript twin over the receipt design.** If a TypeScript interpreter ships on web it is rebuilt over the replica and held under the competitor-anchored budget.
- **More than one hosted target, an admin console, media beyond one photo path, push, cron syntax, vector or ranked search, federation, multi-region, device-to-device sync, at-rest encryption claims.** After the clock, on evidence.
- **Observability beyond `why`, `trace`, `logs`, `data`.**
- **A guide corpus.** The compiler's facts, a one-screen grammar and keyword cards, as Snapback 2; no freshness dates.

- **Union audiences.** One `sync` line per table. A read rule with a second disjunct is refused with the rewrite, never partially delivered; `retain delivered-history` covers the author who keeps their own rows. Several `sync` lines per table wait for an app that needs them.
- **Exact horizon maintenance.** The horizon bounds acquisition (a snapshot, a bootstrap); the log never evicts or back-fills to hold a device's group at exactly N rows. A local read past the horizon says `complete: false`.

- **Time in rules.** A read rule compares with `=` and `!=` only; `.expiresAt > now` is not a rule, because a rule that varies with time is not an audience a partition can hold. Ephemeral rows are filtered in queries today; the shape that closes the Clique lane's M5 gap is an `expires .col` clause on `sync` that the stream, the snapshot and the device's reads all honour. After the clock.

## Process not doing

- **No drift registries, inventories, line-pinned diagnostics registries, claim digests or frozen-record gates.** Generated projections are built, not committed.
- **No gate bound to an exact commit; no push gated on a battery.** Five blocking checks in sixty seconds, run before push; everything slower on a schedule with bounded tickets.
- **No ceiling raised in slice one.** Budgets are anchored to a competitor's measured number and recorded once in the journal.
- **No panel** except the two blind reviews LLP 3000 decision 4 names (partition inversion; the meter's cut on non-uniform scans).
- **No new LLP number** without first extending LLP 3000 or LLP 2000.000; no spec without running code (`rules/RULES.md`: only implemented specs bind).
- **No second session on the core** during slice one; lanes take the periphery.
- **No test matrix as the primary harness.** The simulator is; real-browser and device witnesses cover only what it cannot reach.
- **No files over 1,500 lines**, including ones copied from Snapback 2. Split on the way in.

## Deliberately worse

- No compatibility with Snapback 1 or Snapback 2 apps, packages or on-disk formats.
- No API stability before the clock; every publish is `0.0.x`.
- Sparse prose documentation; the diagnostics and the recipes carry the load.
- One hosted target, one storage engine (SQLite), one platform binary at a time.

## Moves

(none yet)
