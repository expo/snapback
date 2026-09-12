# Snapback 2 session expiry drops `restoringViewer` and flickers the React viewer

**Status:** Closed
**Priority:** P2
**Date:** 2026-09-11
**Systems:** `snapback2/packages/snapback2/src/client.ts` (`expireSession`), `react-core.tsx` (`useViewer`)
**Source:** Snapback 2 codebase review 2026-09-11; Clique reconnect flicker
**Related:** LLP 1018.003 A2; closed `20260906-snapback2-react-auth-hook-loses-the-viewer-during-revalidation.md` (fixed `me()` revalidation; **this path is expiry**)

## Symptom

`useViewer` is `session.viewer ?? session.restoringViewer`. Cold restore already keeps `restoringViewer` (`client.ts:770`). `expireSession` (live terminal `E_AUTH_SESSION`, including a multiplex frame for an already-removed child) calls `this.authState.reset({ state: "hydrating" })` **without** `restoringViewer` unless `fromAuth`.

Until `clearTokenNow` finishes, `useViewer()` is `undefined` and `useQuery` remounts because `operationFence` / later `authGeneration` change. LLP 1018.003 A2 required preserving a known `restoringViewer` through same-bearer confirmation; expiry currently drops it for the whole seal window.

Closed L7 work fixed the `me()` revalidation path. Expiry is a different `reset({ state: "hydrating" })` call.

## Evidence

```1287:1296:snapback2/packages/snapback2/src/client.ts
  private async expireSession(...) {
    ...
      if (!options.fromAuth) this.authState.reset({ state: "hydrating" });
```

Contrast the restore path at `client.ts:770`:

```ts
    this.authState.reset({ state: "hydrating", restoringViewer: this.currentPrincipal });
```

## Proposed patch

```ts
      if (!options.fromAuth) {
        this.authState.reset({
          state: "hydrating",
          restoringViewer: this.currentPrincipal,
        });
      }
```

Do not treat a terminal frame for a **removed** multiplex child as session-wide expiry unless the physical session is still this connection’s (`live.ts` already has a comment about capacity 257 isolation; check whether a stale child `E_AUTH_SESSION` still reaches `expireSession`).

## Acceptance

- React test: authenticated viewer, inject `E_AUTH_SESSION` on the live stream, assert `useViewer()` never reads `undefined` between two authenticated states of the same bearer (or until logout actually completes).
- Cold restore and `me()` revalidation tests stay green.
- A real logout / expired token still reaches `anonymous` and wipes.

## Resolution (2026-09-11)

Carry currentPrincipal as restoringViewer while terminal expiry awaits durable token clearing. The deferred token-store regression now checks both auth snapshot and rendered useViewer: principal-a remains during hydration and becomes undefined after clearing; old bearer reconnect remains stopped. The parent lane owns stale removed live-child fencing.

Validation: affected offline public-state, auth ownership and client sessions suite passed 101/101; the added rendered expiry probe also passed. Package build and affected reference check pass.
