# 0137 A2: React managed presence room never becomes ready when the provider has live queries

- **Date:** 2026-08-01
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
