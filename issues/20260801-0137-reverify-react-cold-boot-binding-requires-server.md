# 0137 re-verify: React cold-offline boot is unreachable — binding prep
# fetches inspection/session

**Opened:** 2026-08-01 (0.1.8 re-verification pass)
**Systems:** Client integration, Sync
**Related:** LLP 0137, LLP 0114, LLP 0129,
issues/closed/20260801-0137-a1-react-arm-no-offline-surface.md (a1-f5),
demos/improvement-sweep/arms/reverify-0.1.8/run-capsule.json (RV-A1-F5)

The a1-f5 fix's projections are real and verified on 0.1.8: query
snapshots carry `freshness`/`retention`, `useSnapbackOutbox`/
`observeSnapbackOutbox` project pending counts, and `replay()` drains
({replayed:1, failed:0} observed live). But the resolution's acceptance
witness — "a React component renders 'Retained' from useSnapbackQuery's
own result during an offline cold boot" — cannot be exercised by an
external consumer: `createExternalSessionClient(...).prepareReactBinding`
awaits `Promise.all([inspection, session])` against the server
(`@expo/snapback-client/react-binding.mjs` line ~210), so a genuinely
cold process with the backend unreachable throws `fetch failed` before a
provider exists. The fix's own cold-boot test
(`packages/snapback-react/offline.test.mjs`) constructs the binding over
a fake client, which is why the gap survived to the packaged closure.

The working shape today is tab-goes-offline: a provider prepared online
keeps rendering retained facts through disconnection (verified). The
missing shape is process-cold offline boot — exactly A1-05's floor and
the Firebase probe's 26ms reference render.

Fix shape: an offline-capable binding preparation — verify the generated
manifest against a persisted binding identity (the digest material is
already digest-bound) and defer inspection/session to reconnect, or a
documented `prepareReactBindingOffline`/cached-binding path — with a
packaged-closure test that cold-boots a React provider offline over a
warmed store.

Witness: a fresh node/jsdom process with the server stopped renders
retained rows with `freshness: 'retained'` from `useSnapbackQuery` on
the public closure, with zero repo access.

## Resolution

Open.
