# 0137 A2: React managed presence room never becomes ready when the provider has live queries

- **Status:** Resolved
- **Date:** 2026-08-01
- **Resolved:** 2026-08-01 (between-arms fix lane; ticket text imported from
  the A2 arm's worktree — if the arm's landing also carries the open copy
  under `issues/`, this closed copy is the resolution of record)
- **Source:** LLP 0137 Phase 1, A2 snapback-web arm (external consumer, @expo/snapback-* 0.1.7)
- **Finding:** `demos/improvement-sweep/arms/a2-snapback-web/findings/0137-a2-f1-react-presence-room-wedged-by-live-queries.json`
- **Severity:** defect — the documented single-provider pattern (live queries + `useSnapbackPresence` on one prepared provider) cannot render presence at all

## Repro (packaged 0.1.7, sessions mode)

1. `createExternalSessionClient` → `prepareReactBinding` → `createSnapbackReactProvider`.
2. Attach any `observeSnapbackQueries`/`useSnapbackQuery` live observer.
3. Attach `observeSnapbackPresence`/`useSnapbackPresence` with a managed value on `binding.ephemeral.<name>`.
4. Presence state stays `{status:'stale', connection:'connecting', publisher:'publishing'}` forever; remote deltas still arrive into the wedged room. Without step 2 the same presence call reaches `ready`/`published` immediately. Explicit provider `connectionId` changes nothing.

Matrix and contrast evidence: `demos/improvement-sweep/arms/a2-snapback-web/evidence/probes.json` (presenceWedge). The headless `subscribeEphemeral` overlay path multiplexes fine with concurrent live queries (acceptance A2-05/A2-11), so this is provider room readiness, not the ephemeral lane.

## Workaround used by the arm

A dedicated presence-only provider per persona over the same session bearer (`evidence/app/ui-smoke.mjs`).

## Expected fix shape

Provider presence room readiness must observe an already-open managed socket rather than waiting for a fresh readiness transition; regression test = one provider, one live query, one managed presence value → `ready` within the dispatch budget on the packaged closure.

## Resolution (2026-08-01)

Root cause: `SnapbackClient.startEphemeralRoom`
(packages/snapback-client/index.mjs) initializes its `currentConnection`
tracker to `'connecting'` and updates it only through
`LiveStreamManager.onState` — which delivers **transitions**, never the
current level. When the provider's live queries have already opened the
managed socket for the same `connectionId`, no fresh `'open'` edge ever
fires after the room registers its listener, so `adoptOverlay` computes
`status: currentConnection === 'live' ? 'ready' : 'stale'` as `'stale'`
forever while deltas keep arriving into the wedged room — exactly the
retained matrix. A presence-only provider works because its own room demand
opens the socket after registration, producing the edge.

Fix: after `manager.waitUntilReady()` resolves inside `startGeneration`, the
room adopts the proven readiness level (`currentConnection = 'live'` +
snapshot patch) when `manager.isOpen()` — the LLP 0107 lifecycle section
already calls connection events level-triggered. Loss/reconnect resync
behavior is unchanged.

Regression: `packages/snapback-client/ephemeral-room.test.mjs` — the test
fake previously replayed `'open'` synchronously at `onState` registration
(which the real manager never does, masking the defect); it now mirrors the
transition-only contract and adds an `alreadyOpen` pre-opened-socket
scenario asserting `connection: 'live'` / `status: 'ready'` after
`started()`, plus loss/reconnect resync on the shared socket. Verified to
FAIL on the pre-fix code (`'connecting'` instead of `'live'`).

The arm's acceptance witness (single provider + live query + managed value
on the packaged public closure) lands with the arm's next rerun on a release
cut that includes this fix; 0.1.7 stays the pinned baseline. Doc: LLP 0107
implementation journal (2026-08-01 entry).
