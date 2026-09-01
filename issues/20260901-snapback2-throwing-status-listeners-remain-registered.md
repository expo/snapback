# snapback2: throwing status listeners remain registered and break later operations

**Status:** Open
**Systems:** snapback2, client, lifecycle
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/snapback2/src/client.ts:447-450

Failure scenario: subscribeStatus registers a callback that throws during the immediate snapshot delivery. The caller catches the exception but never receives an unsubscribe function; the callback remains registered. A later successful manifest or auth call reaches patchSnapshot, invokes that stale listener, and rejects/corrupts the otherwise successful client operation while later listeners are skipped.

Why it happens: registration precedes the unguarded initial callback, and patchSnapshot at lines 613-620 invokes every listener without isolation. The SSE callback path already isolates application callbacks, but status does not.

Suggested fix: remove the listener if initial delivery throws and isolate each subsequent listener invocation so one application exception cannot escape a client operation or suppress peers. Add both initial-throw and later-throw tests.
