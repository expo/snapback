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
`mechanism: exclusive-lock-rename-file-cas-test-double`. Unlike the earlier
stand-in, that mechanism now serializes the revision comparison and rename
under an exclusive cross-process file lock. A separate contention arm launched
PIDs `94853` and `94854` against expected revision 1: the first committed
revision 2, the second reported `cas-stale` after observing revision 2, and the
settled file remained at revision 2. The lifecycle PIDs were `94863` and
`94877`, and both observed supervisor generation
`supervisor-e28eab05-0d33-45c2-b0ae-9d96cadef8c8`.

The settled record visible to the second process before boot was anonymous at
revision 5 and contained neither a current nor pending bearer. The second
process then made a fresh adoption request, reached authenticated state, and
observed no `SNAPBACK_AUTH_SESSION_EXPIRED`. This is a negative result with a
mandatory positive arm, not evidence that the real iOS Keychain or Android
Keystore carrier has been exercised: an actual device kill/relaunch through
that native implementation remains untested.

### Successor reload and the one-shot supervisor stash

An ordinary `supervisor.verbs.reload` was interposed before sign-out. At this
revision it did not mint. Direct supervisor inspection observed
`pendingAuthority` absent before and after reload, present immediately after
`replaceAuthority`, and absent after successor boot. The harness populated that
exact private one-shot slot without a database reset, using the predecessor's
same email. Mint count remained 4 across the successor boot, independently
confirming that the observed stash was consumed rather than a fresh record
minted. Database inspection proved that the two same-email mints had different
session IDs: sign-out revoked the predecessor row while the stashed successor
row remained live. The successor authenticated and emitted no
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

The original browser symptom remains unresolved. Across all Lane C rounds the
harnesses covered serial OS-process persistence through a file carrier, an
actual two-process CAS conflict, current-source retained/reload/stash behavior,
and HTTP-level browser-shaped supervised exchanges. They did **not** cover the
real iOS Keychain or Android Keystore carrier across device process death and
relaunch, or a real browser running the actual Expo/Metro web integration and
DOM provider-button/popup path. The historical package/bundle revision that
booted supervised web already authenticated also remains untested. Ordinary
reload cannot reach `pendingAuthority` in the current implementation, while
the production path that can reach it first replaces the database. Keep this
issue open until the author can identify the environmental difference or one
of those remaining sequences reproduces the record-lifecycle gap.

The harness emitted this structured result verbatim:

```json
{"schemaVersion":"snapback.retained-development-session-lifecycle.v1","processTableSource":"libproc-native-helper","variants":[{"variant":"process-restart-retained-native-custody","surface":"client process-persistent custody","reached":true,"reproduced":false,"proof":{"processIds":[94863,94877],"supervisorGeneration":"supervisor-e28eab05-0d33-45c2-b0ae-9d96cadef8c8","supervisorRestarted":false,"storageArm":{"providerFactoryCalls":1,"grade":"single-runtime","carrier":"expo-native-injected","nativeGradeCarrier":"process-persistent-file-native-module-stand-in","mechanism":"exclusive-lock-rename-file-cas-test-double","processPersistent":true,"nativeOperations":["platformGrade","read","read","read","read","read","read","read","read","read","compareAndReplace","read","read","compareAndReplace","read","read","read","read","read","read","read","read","read","read","read"]},"custodyCasContention":{"mechanism":"exclusive-lock-rename-file-cas-test-double","processIds":[94853,94854],"competingExpectedRevision":1,"winnerProposedRevision":2,"loserProposedRevision":3,"loserStatus":"cas-stale","loserObservedRevision":2,"finalRevision":2},"recordBeforeRestartBoot":{"storageKey":"snapback.auth-custody.d835e21d0fae444fcc4b1a763ac5e0860043be04ed9c7a2ad52858f4a998875f","formatVersion":2,"phase":"settled","revision":5,"authorityEpoch":2,"authorityKind":"anonymous","bearerPresent":false,"pendingBearerPresent":false}},"result":{"afterSignOut":{"principalStatus":"anonymous","custody":{"storageKey":"snapback.auth-custody.d835e21d0fae444fcc4b1a763ac5e0860043be04ed9c7a2ad52858f4a998875f","formatVersion":2,"phase":"settled","revision":5,"authorityEpoch":2,"authorityKind":"anonymous","bearerPresent":false,"pendingBearerPresent":false},"diagnosticCodes":[]},"afterRestartFreshSignIn":{"principalStatus":"authenticated","custody":{"storageKey":"snapback.auth-custody.d835e21d0fae444fcc4b1a763ac5e0860043be04ed9c7a2ad52858f4a998875f","formatVersion":2,"phase":"settled","revision":7,"authorityEpoch":3,"authorityKind":"session","bearerPresent":true,"pendingBearerPresent":false},"diagnosticCodes":[],"exactExpiredDiagnosticObserved":false}}},{"variant":"successor-reload-plus-stashed-replacement-before-sign-out","surface":"one-shot supervisor pendingAuthority","reached":true,"reproduced":false,"proof":{"supervisorGeneration":"supervisor-e28eab05-0d33-45c2-b0ae-9d96cadef8c8","supervisorRestarted":false,"mintCountAfterStash":4,"mintCountAfterSuccessorBoot":4,"pendingAuthorityConsumedWithoutMint":true,"ordinaryReloadPopulatedPendingAuthority":false,"pendingAuthorityEvidence":"behavioral-supervisor-inspection","pendingAuthorityPopulatedBy":"replaceAuthority-same-email","sameEmailUser":true,"distinctSessionFamilies":true,"productionStashArm":{"verb":"dev-fresh","supervisorGeneration":"supervisor-e28eab05-0d33-45c2-b0ae-9d96cadef8c8","supervisorRestarted":false,"predecessorSignOutDiagnosticCode":"SNAPBACK_AUTH_REQUIRED","logoutInvalidationTested":false,"mintCountAfterStash":6,"mintCountAfterSuccessorBoot":6,"pendingAuthorityConsumedWithoutMint":true}},"result":{"predecessor":{"sessionId":"ses_01m1132ytqea0rftbp97rk3hgt","revoked":true},"stashedSuccessor":{"sessionId":"ses_01m11330q0ez794c9ng5e41gdq","revoked":false,"principalStatus":"authenticated"},"diagnosticCodes":[],"exactExpiredDiagnosticObserved":false,"productionStashArm":{"predecessorSignOut":{"status":"failed","diagnosticCode":"SNAPBACK_AUTH_REQUIRED"},"successorBoot":{"principalStatus":"authenticated","diagnosticCodes":[],"exactExpiredDiagnosticObserved":false}}}}]}
```

On this sandbox `/bin/ps` was unavailable. The corrected harness therefore
used a compiled macOS `libproc` helper and recorded
`processTableSource: libproc-native-helper`; PID, PPID, PGID, and start time
came from `proc_bsdinfo`. It no longer substitutes `lsof` fields or invented
identity values.

## Lane C supervised-web follow-up (2026-08-27)

This round targeted the platform named by the original report. The opt-in
harness is
`packages/snapback-cli/expo-dev-loop.test.mjs --supervised-web-signout-reload-only`.
Lane C round 5 reran it from requested base `84a1854c4` with the corrected
harness and the qualified
`target/debug/snapback` binary and exited 0. The available browser-control
inventory was empty, so this is explicitly an HTTP-level stand-in for a real
browser reload, not a DOM/button claim. It used a live `runExpoDev` supervisor
with `platform: web`, browser `Origin` headers, the current freshly scaffolded
`expo-chat` backend and provider declarations, and a fresh IndexedDB factory
for every reload-shaped boot. The Metro child was the existing supervised-loop
stand-in.

### Current `expo-chat` provider-button posture

The current template does not pass `adoptSupervisedSession`; supervised web is
anonymous by default. The initial page-shaped bootstrap GET returned authority
`unavailable` and no session id. The headless external-user-agent stand-in then
drove the same shared-development broker protocol as the Apple provider button,
and the ordinary coordinator established session
`ses_01m1133mxcejd9s2rg3z9svct2`. Sign-out revoked that exact server row.

The reload-shaped bootstrap GET, against the same supervisor generation
`supervisor-e38f31f6-1cf3-4697-8f20-aa8b15611cd6`, again returned authority
`unavailable` and no session id. The replacement page booted anonymous
`ready`; the ended provider session was never present in any bootstrap
exchange. The mandatory positive then drove the Google provider flow against
that same never-restarted supervisor. It authenticated as live session
`ses_01m1133n0qf32b7ggcr7m7ew53`.

### Former boot-authenticated posture

A second diagnostic arm opted web into supervised adoption to represent the
former boot-authenticated posture. Its bootstrap POST returned live session
`ses_01m1133n37f07v6ze2szjwtsfk`; sign-out revoked that exact server row. The
next explicit-adoption reload sent a new POST and received distinct live
session `ses_01m1133n77ekdtsthzr7zawm0w`. The supervisor did not replay the
ended session.

Every diagnostic-code list was exactly empty, and
`SNAPBACK_AUTH_SESSION_EXPIRED` was not observed. The harness closed the
bootstrap, backend, and Metro process surfaces and verified the bootstrap and
backend listeners were gone.

This is another evidenced non-reproduction, not a fix. The author's environment
differs in a way not yet identified. This round covered the current source
template, its Apple/Google rehearsal-provider protocol, browser-origin
bootstrap GET/POST behavior, fully fresh browser-storage stand-ins, both the
current anonymous-default and explicit adopted-session postures, and a single
never-restarted supervisor. It did not cover a real Expo/Metro-rendered page,
the DOM button/popup integration, or the historical package/bundle revision
that still booted supervised web already authenticated. Those are now the
specific differences for the author to identify or reproduce.

The harness emitted this structured result verbatim:

```json
{"schemaVersion":"snapback.supervised-web-signout-reload.v1","surface":"HTTP-level stand-in for a browser reload (browser control unavailable)","processTableSource":"libproc-native-helper","reproduced":false,"supervisorGeneration":"supervisor-e38f31f6-1cf3-4697-8f20-aa8b15611cd6","supervisorRestarted":false,"exchanges":[{"phase":"initial-page-bootstrap","method":"GET","authorityStatus":"unavailable","sessionId":null,"serverRevoked":null},{"phase":"reload-after-provider-sign-out","method":"GET","authorityStatus":"unavailable","sessionId":null,"serverRevoked":null},{"phase":"explicit-adoption-before-sign-out","method":"GET","authorityStatus":"unavailable","sessionId":null,"serverRevoked":null},{"phase":"explicit-adoption-before-sign-out","method":"POST","authorityStatus":"ready","sessionId":"ses_01m1133n37f07v6ze2szjwtsfk","serverRevoked":false},{"phase":"explicit-adoption-reload","method":"GET","authorityStatus":"unavailable","sessionId":null,"serverRevoked":null},{"phase":"explicit-adoption-reload","method":"POST","authorityStatus":"ready","sessionId":"ses_01m1133n77ekdtsthzr7zawm0w","serverRevoked":false}],"providerButtonPath":{"endedSession":{"sessionId":"ses_01m1133mxcejd9s2rg3z9svct2","serverRevoked":true},"reload":{"principalStatus":"anonymous","exchangeAuthorityStatus":"unavailable","exchangeSessionId":null},"positiveAfterReload":{"provider":"google","principalStatus":"authenticated","sessionId":"ses_01m1133n0qf32b7ggcr7m7ew53","serverRevoked":false}},"explicitAdoptionDiagnostic":{"endedSession":{"sessionId":"ses_01m1133n37f07v6ze2szjwtsfk","serverRevoked":true},"reloadSession":{"sessionId":"ses_01m1133n77ekdtsthzr7zawm0w","sameAsEnded":false,"serverRevoked":false}},"diagnosticCodes":[],"exactExpiredDiagnosticObserved":false}
```
