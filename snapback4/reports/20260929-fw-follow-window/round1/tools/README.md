# FW round 1 causal regressions

Run from `snapback4/` after the documented workspace build, wasm build and SDK
build. Node 24 and Chromium are required. The existing package inventory imports
these tests alongside round 0's eight frozen-clock cases:

```sh
node --test packages/snapback4/test/follow-window.test.mjs
node --test reports/20260929-fw-follow-window/round1/tools/recovery.test.mjs
node --test reports/20260929-fw-follow-window/round1/tools/adoption.test.mjs
node --test reports/20260929-fw-follow-window/round1/tools/refusal.test.mjs
```

`helpers.mjs` reuses round 0's fixture, adding the missing ordinary like operation
and a third persona. It uses real wasm/memory persistence and process/SQLite
adapters. The account-switch test deliberately supplies the same backing store
for two principals, reads its real retained outbox after sign-out/reopen, and
checks the publication gate for each viewer. The replica's separate principal
fence is preserved; the test does not bypass it to expose another viewer's data.

`adoption.test.mjs` serves `adoption-page.mjs` through Vite and runs two tabs in
one Chromium context, with real wasm, IndexedDB and Web Locks. The mounted keeper
owns the base store and the donor owns an alternate store. A sync discovers the
live donor; after the keeper reaches a complete answer, its positive-delay timers
are held. The donor queues offline and closes. The keeper adopts through the real
host and waits before mutation transport reaches the server, then before sync
applies the receipt. The test captures the mounted snapshot synchronously after
the outbox custody callback, before querying or pending-write lookups can mask a
missing invalidation. Follow and unfollow are separate tests in both browser
adapters, so each independently detects round 0. Every publication from custody
through the final complete, fresh page is checked. Timeouts only bound deadlock;
no correctness assertion compares elapsed milliseconds.

Recovery tests hold mutation and sync boundaries. They cover non-edge writes,
empty authors, overlapping follow/unfollow, offline admission, process restart,
viewer scoping and restoration after a persistence commit loses its reply.
The ordinary prediction/apply invalidation of a post/remove can revalidate its
shaped feed; the scope test requires no edge-intent mark at the call and a complete,
unmarked mounted and direct answer while transport is held. The disjoint
`postState` check remains in both rounds.

The round 0 control was compiled from `a3a0c76744` with the same wasm and current
server/process binary (the engine delta is outside this lane). For browser tests,
temporarily redirect the SDK `dist/` to the extracted package, then restore it;
`FW_EXPECT_ROUND0=1` checks that the served function is actually round 0. The first
browser draft allowed background polling to mask the missing callback. Its passing
control is retained in `round0-control.log.gz`; use the final independent, timer-held
cases in `round0-adoption-control.log` as the detecting evidence.

For Node controls, `FW_LOCAL_MODULE=/absolute/path/to/sdk/dist/local.js` selects
an isolated SDK copy. The broad-gate control changes `FollowingIntents.feeds()`
to select every timeline for every mutation; the scope cases must fail. The
stuck-gate control omits `this.calls.delete(key)` on release; the empty-author
cases must fail their deadlock guard. These copies live under ignored `target/`;
no product source or normal build output is mutated by those controls.

The added liveness/scope cases already pass round 0: the reviews identified
missing coverage there, not reproduced product failures. The new adoption,
restored-image and viewer tests detect real round 0 defects. No expected-correct
round 0 behavior is made to fail by inventing a new contract.

`refusal.test.mjs` is an additional audit probe run separately while the full
suite was in progress. It pins an incomplete recovered-edge answer before a
terminal refusal, with sync still held, and verifies that settlement alone
restores the mounted complete empty page. No product change resulted.
