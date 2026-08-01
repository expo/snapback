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

RESOLVED (2026-08-01, backlog Lane C) — offline-capable binding preparation
via a persisted, digest-bound **binding receipt**, exactly the ticket's
first fix shape:

- A successful ONLINE `prepareReactBinding` persists a receipt into the
  client's persisted RQS store (new optional, feature-detected store methods
  `loadReactBindingReceipt`/`commitReactBindingReceipt` on all three arms —
  memory field, file-blob optional top-level field through the atomic
  temp-write+rename path, IndexedDB reserved record outside entry
  enumeration/budget; writer-gated, 64 KiB bound, cleared by the LLP 0053
  user-switch `wipe()`). The receipt records the digest of the exact
  normalized generated manifest the admission proved equal to the
  deployment, plus the deployment identity, routeManifestHash, authMode,
  capabilityDigest, and registered-bundle availability.
- When a later preparation's inspect/session fetch fails with a
  TRANSPORT-PROVENANCE connectivity error (the shared classifier moved to
  outbox-shared.mjs so react-binding.mjs applies the identical rule; a
  server-ANSWERED failure is never masked), the complete admission re-runs
  against the persisted identity: digest equality proves the presented
  generated manifest is byte-identical to the one online admission proved
  equal to the deployed manifest, so every per-item check re-runs against it
  unchanged. A drifted manifest falls through to the original connectivity
  error. `binding.source` names the provenance
  (`'deployment' | 'persisted-receipt'`).

Regression (real client over a scripted wire — deliberately NOT the
fake-client shortcut that let this gap survive):
`packages/snapback-react/cold-boot-binding.test.mjs` — session 1 prepares
online + warms the store; session 2 is a cold client with every fetch
refusing at the transport, reaches `source: 'persisted-receipt'`, and the
provider renders the retained rows with `freshness: 'retained'` /
`status: 'refreshing'` from `useSnapbackQuery`'s own snapshot path; guards
pin that server-answered failures and drifted manifests never adopt the
receipt. Proven-to-fail pre-fix (cold prepare threw `TypeError: fetch
failed`). Docs: LLP 0114 dated amendment (offline binding receipt),
guide/clients/react.md preparation section. Store-arm implementation
executed via codex exec per the lane tooling directive and verified
locally (all three store suites + full client/react chains green).

The witness's jsdom/packaged-closure flavor remains available to the next
0137 re-verify arm; the node projection of the same witness is CI-pinned by
the regression above.
