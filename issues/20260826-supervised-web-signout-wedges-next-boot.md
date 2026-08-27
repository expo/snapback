# Signing out on supervised Expo web wedges the next boot on `SNAPBACK_AUTH_SESSION_EXPIRED`

- Status: Open
- Date: 2026-08-26
- Systems: `packages/snapback-expo` (supervised boot / adopted authority),
  `packages/snapback-cli` (`snapback dev --expo`)
- Found by: driving the `expo-chat` provider buttons in a real browser against
  `snapback dev --expo --expo-platform web`

## What happens

Under the supervised web loop the app boots already authenticated — it adopts
the session the supervisor minted. Sign out, then reload, and the app does not
come back anonymous; it fails to boot:

```
Chat couldn't start
error
SNAPBACK_AUTH_SESSION_EXPIRED: SNAPBACK_AUTH_SESSION_EXPIRED: authentication
session is expired or revoked
```

The browser console shows a `401 (Unauthorized)` behind it. The app is then
stuck for every subsequent reload until the supervisor is restarted; clearing
`localStorage`, `sessionStorage`, and every IndexedDB database does not help,
because the credential being replayed is the supervisor's published mint rather
than anything the page stored.

Reproduced repeatedly with a single supervisor and a freshly scaffolded
`expo-chat` app (`create-snapback-app` → `bun run dev:supervised`).

## Why it matters

Sign-out is an ordinary thing to do while developing auth — it is the first
thing you do to get back to the provider buttons. Doing it once makes the app
unbootable until you restart `snapback dev --expo`, and the diagnostic points at
an expired session rather than at the supervised mint that produced it, so the
recovery ("restart the dev loop") is not discoverable from the message.

It also makes the provider flow awkward to exercise: each attempt needs a
supervisor restart if a reload happened after a sign-out.

## Suggested direction

Two candidate layers, and the choice needs an owner:

- The supervised boot could treat a revoked adopted authority as *absent*
  rather than fatal — fall back to anonymous `ready`, which is what the app
  shows before any session exists, instead of refusing to start.
- Or sign-out could drop the adoption itself, so the next boot does not replay
  a session the user explicitly ended.

Either way the refusal should name the supervised mint and the restart, not
just the expired session.

## Lane C retained-record follow-up (2026-08-26)

This follow-up treats the report as a development-record lifecycle and cache
invalidation question. It does not reproduce the expiry wedge on either newly
targeted retention surface. The opt-in live harness is
`packages/snapback-cli/expo-dev-loop.test.mjs --retained-session-lifecycle-only`.
It ran with the qualified `target/debug/snapback` binary and exited 0.

### Process-persistent client custody

The first child process booted through the production Expo provider's native
custody selection, signed out, and exited. A second child PID then read the
same custody file and booted against the same still-running supervisor. The
provider reported `grade: single-runtime`, `carrier: expo-native-injected`, and
`mechanism: atomic-file-cas-test-double`; its injected native-module stand-in
used atomic file CAS so the record genuinely survived the first OS process.
The PIDs were `39610` and `40738`, and both observed supervisor generation
`supervisor-04f94493-c19d-4f5c-a4df-918f0d22bf39`.

The settled record visible to the second process before boot was anonymous at
revision 5 and contained neither a current nor pending bearer. The second
process then made a fresh adoption request, reached authenticated state, and
observed no `SNAPBACK_AUTH_SESSION_EXPIRED`. This is a negative result with a
mandatory positive arm, not evidence that the real iOS Keychain or Android
Keystore carrier has been exercised: an actual device kill/relaunch through
that native implementation remains untested.

### Successor reload and the one-shot supervisor stash

An ordinary `supervisor.verbs.reload` was interposed before sign-out. At this
revision it did not mint or populate `pendingAuthority`; the only production
assignment after startup is the post-reset `dev-fresh` path. The harness then
used `replaceAuthority` to populate that exact private one-shot slot without a
database reset, using the predecessor's same email. Mint count remained 4
across the successor boot, proving the stash was consumed rather than a fresh
record minted. Database inspection proved that the two same-email mints had
different session IDs: sign-out revoked the predecessor row while the stashed
successor row remained live. The successor authenticated and emitted no
`SNAPBACK_AUTH_SESSION_EXPIRED`.

The production `dev-fresh` assignment was also exercised. It reset the
database before minting and stashing the successor. Consequently, the mounted
predecessor's later sign-out failed with the exact code
`SNAPBACK_AUTH_REQUIRED`; this arm does not exercise logout-family
invalidation because reset already removed that family. The next boot consumed
the stashed successor without another mint, authenticated, and emitted no
expiry diagnostic.

### Cache objection and remaining gap

The supervisor binding cache is not supported as the cause by these results.
Its persisted projection contains binding/public facts, not the exchange
bearer, and consuming a cached binding reports authority `unavailable`; the
lack of a non-test `clear` caller therefore does not provide a stale bearer to
replay.

The original browser symptom remains unresolved. Still untested are an actual
iOS/Android custody carrier across device process death and relaunch, and the
historical browser build/sequence that produced the original repeated expiry.
Ordinary reload cannot reach `pendingAuthority` in the current implementation,
while the production path that can reach it first replaces the database. Keep
this issue open until one of those remaining sequences either reproduces the
record-lifecycle gap or explains the historical result.

The harness emitted this structured result verbatim:

```json
{"schemaVersion":"snapback.retained-development-session-lifecycle.v1","variants":[{"variant":"process-restart-retained-native-custody","surface":"client process-persistent custody","reached":true,"reproduced":false,"proof":{"processIds":[39610,40738],"supervisorGeneration":"supervisor-04f94493-c19d-4f5c-a4df-918f0d22bf39","supervisorRestarted":false,"storageArm":{"providerFactoryCalls":1,"grade":"single-runtime","carrier":"expo-native-injected","nativeGradeCarrier":"process-persistent-file-native-module-stand-in","mechanism":"atomic-file-cas-test-double","processPersistent":true,"nativeOperations":["platformGrade","read","read","read","read","read","read","read","read","read","compareAndReplace","read","read","compareAndReplace","read","read","read","read","read","read","read","read","read","read","read"]},"recordBeforeRestartBoot":{"storageKey":"snapback.auth-custody.d835e21d0fae444fcc4b1a763ac5e0860043be04ed9c7a2ad52858f4a998875f","formatVersion":2,"phase":"settled","revision":5,"authorityEpoch":2,"authorityKind":"anonymous","bearerPresent":false,"pendingBearerPresent":false}},"result":{"afterSignOut":{"principalStatus":"anonymous","custody":{"storageKey":"snapback.auth-custody.d835e21d0fae444fcc4b1a763ac5e0860043be04ed9c7a2ad52858f4a998875f","formatVersion":2,"phase":"settled","revision":5,"authorityEpoch":2,"authorityKind":"anonymous","bearerPresent":false,"pendingBearerPresent":false},"diagnosticCodes":[]},"afterRestartFreshSignIn":{"principalStatus":"authenticated","custody":{"storageKey":"snapback.auth-custody.d835e21d0fae444fcc4b1a763ac5e0860043be04ed9c7a2ad52858f4a998875f","formatVersion":2,"phase":"settled","revision":7,"authorityEpoch":3,"authorityKind":"session","bearerPresent":true,"pendingBearerPresent":false},"diagnosticCodes":[],"exactExpiredDiagnosticObserved":false}}},{"variant":"successor-reload-plus-stashed-replacement-before-sign-out","surface":"one-shot supervisor pendingAuthority","reached":true,"reproduced":false,"proof":{"supervisorGeneration":"supervisor-04f94493-c19d-4f5c-a4df-918f0d22bf39","supervisorRestarted":false,"mintCountAfterStash":4,"mintCountAfterSuccessorBoot":4,"pendingAuthorityConsumedWithoutMint":true,"ordinaryReloadPopulatedPendingAuthority":false,"pendingAuthorityPopulatedBy":"replaceAuthority-same-email","sameEmailUser":true,"distinctSessionFamilies":true,"productionStashArm":{"verb":"dev-fresh","supervisorGeneration":"supervisor-04f94493-c19d-4f5c-a4df-918f0d22bf39","supervisorRestarted":false,"predecessorSignOutDiagnosticCode":"SNAPBACK_AUTH_REQUIRED","logoutInvalidationTested":false,"mintCountAfterStash":6,"mintCountAfterSuccessorBoot":6,"pendingAuthorityConsumedWithoutMint":true}},"result":{"predecessor":{"sessionId":"ses_01m10ztwmjec3b93arq5gdwqtc","revoked":true},"stashedSuccessor":{"sessionId":"ses_01m10zv2z3f62bgay7tg542b72","revoked":false,"principalStatus":"authenticated"},"diagnosticCodes":[],"exactExpiredDiagnosticObserved":false,"productionStashArm":{"predecessorSignOut":{"status":"failed","diagnosticCode":"SNAPBACK_AUTH_REQUIRED"},"successorBoot":{"principalStatus":"authenticated","diagnosticCodes":[],"exactExpiredDiagnosticObserved":false}}}}]}
```
