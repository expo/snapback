# Diary 0121: Snapback 4 production web starter

**Date:** 2026-09-22
**Subject:** the maintained React/Vite chat reference and its new `init --web` output
**Agent:** Codex orchestration with GPT-6 Astra xhigh implementation
**Related:** [Offline application responsibilities](../llp/3000.011.003-offline-application-responsibilities.research.md), [Starter proposal](../llp/3000.011.003.000-offline-ready-application-starters.rfc.md)

## Build experience

The reference app already used the real local client, so the starter could reuse
it directly. Generating the same source avoids maintaining a second example.
Schema-only initialization remains available; the web option adds one supported
Vite application with its production shell.

The SDK outbox provides durable replay, but the screen still needs to remember
which room to reopen and which write IDs to observe. The application now saves
those references under the backend URL and actual principal before dispatch.
It does not keep a second queue of message bodies. A server-only mark-read
operation makes the pending-without-prediction case visible in ordinary use.

Account switching needed more than a different client object. Late callbacks
from the previous account could otherwise update the next account's screen.
The implementation fences the previous view before closing or signing out and
keeps saved references with their original account. Sign-out does not imply
that pending writes have settled.

## Friction encountered

- Persisted application data does not make a web page load offline. The Vite
  output needed a worker restricted to build-known static assets and the generic
  entry page. API, media and arbitrary navigation responses remain outside that
  cache. A worker-only update can retain the same asset hash; failed installation
  must not delete the active worker's cache.
- A cold offline view cannot interpret a missing local row as authoritative
  absence. The held-room lookup now distinguishes unavailable local information
  from an online result. Navigation never creates a replacement room.
- Immediate mutation results are not enough for a durable receipt screen. It
  must observe saved IDs after reopening, retain terminal refusals and leave an
  absent receipt unknown instead of silently sending a replacement.
- The browser witness first exposed its own setup errors: a response variable
  shadowed the imported path helper, the temporary app could not see hoisted
  Vite dependencies, and a CommonJS resolver selected the wrong package-export
  condition for an ESM entry. These were test setup failures, not evidence of an
  offline product failure. Each failed attempt was retained.

The ordinary React form and lifecycle work remains application work. Snapback's
existing outbox and write-observation API removed the need to invent replay,
deduplication or an application-owned retry queue. The new starter packages the
remaining view and shell responsibilities so the next builder can inspect and
adapt one working example.

## Qualification

The generated schema compiles; the reference app typechecks. Both initializer
tests and all 14 React tests pass, including persistence before SDK dispatch,
account/backend isolation, late callbacks and draft preservation. The rebuilt
web device is 443,474 bytes gzip against the unchanged 452,000-byte budget.

The generated production app then passed the complete Chromium journey at
`/chat/`: the backend was stopped, the page closed and a fresh page recovered
the same three pending IDs (mark-read and two messages). Reconnection produced
authoritative sequences 2, 3 and 4 and exactly two message rows. Account
isolation, guest identity across offline reopening, offline sign-out, failed
receipt recovery and an unknown receipt all passed. The worker cached only its
allowlist, preserved the active cache after a failed worker-only update, kept
old-tab assets usable and activated the new build after old tabs closed.

The final installed-package qualification is still pending. This browser result
uses the generated application with the freshly built workspace package; it is
not an iOS, Android, physical-device or full Clique-scale result.

## 2026-09-22: review correction to sign-out

Independent code review found a lifecycle gap our immediate-offline test did
not exercise: the starter displayed “Signed out” before a stalled logout or
refresh allowed the SDK to delete the persisted session. A subsequent offline
page could therefore restore that account. The fix belongs in the SDK's
session lifetime as well as the screen. Refresh results are fenced before
credential deletion; an already-started store write drains before deletion;
remote logout is best effort. Ordinary close still saves a rotated session.
The app hides the account immediately but shows completion only after durable
clearing succeeds, with a visible retry path for storage failure.

The distinction between stopping network work and completing local storage
work mattered. Aborting fetch alone does not constrain an injected transport
or a delayed response body, and deleting before an in-flight storage write
finishes can resurrect the token. Focused tests now cover both boundaries
using a real file-backed session store reopened through a fresh adapter.

Final M5 verification passed 25 auth tests (seven new cases), 49 guide tests,
15 React cases, package and starter checks/typechecks, and the full generated
production browser witness in 8.429 seconds. Its logout request stays open
while the page completes local sign-out; a fresh offline page then cannot
restore that principal. The first typecheck found an optional-property
annotation incompatible with `exactOptionalPropertyTypes`; the final run
includes its correction and the preserved notification ordering. Logs remain
under `/tmp/sb4-3011-20260922/signout-*-1.log` and `signout-*-2.log`.
Native reference requalification with the rebuilt JavaScript bundle is tracked
separately before publication; these checks do not substitute for it.
