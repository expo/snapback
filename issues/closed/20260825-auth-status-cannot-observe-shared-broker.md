# `snapback auth status` next action does not clear when satisfied

Closed 2026-08-25. Found while smoke testing the shared-development auth
walkthrough (LLP 0151).

## What happened

`runAuthStatus` took `sharedAvailable` from the `--shared-available` flag and
nothing else. It never probed. So with the supervisor running:

```
$ snapback auth status
apple: app-owned-native (application, blocked)
  Next: Start snapback dev, or run snapback auth configure apple.
```

The next action instructed you to do the thing you had already done. The only
way to see the shared profile resolve was to assert it by hand with
`--shared-available` — which asserted a fact the command could not check.

This was the first command a developer runs after `snapback auth enable`, and
the one that is supposed to explain the zero-configuration path. Reporting
`blocked` plus an already-satisfied instruction reads as a broken setup, and it
pointed at `snapback auth configure` — the app-owned credential path — as the
alternative, which is the opposite of the intended default.

The next action also named the wrong command. Plain `snapback dev` never serves
the broker: it is mounted in `expo-dev.mjs` under `--expo`, on the Metro
bootstrap origin, not by the backend server. Measured against a running plain
`snapback dev`:

```
$ curl -X POST http://127.0.0.1:4287/v1/shared/start -d '{...}'
HTTP 404  SNAPBACK_ROUTE_UNKNOWN
```

## Why the obvious fix did not work

Defaulting `sharedAvailable` to a read of `.snapback/dev.ready.json` was tried
and reverted. That file is written by plain `snapback dev`, which does not serve
the broker, so the probe reported `snapback-shared-browser (rehearsal, ready)`
for a broker answering 404. That is a false positive — strictly worse than the
pessimistic report it replaced.

## Resolution

The supervisor now records what only it can see, and status reads it back.

- `expo-dev.mjs` writes `sharedAuth: sharedAuthProjection` into
  `.snapback/expo-supervisor.json`. The projection already existed and already
  covered the unadmitted case (deployment state refusing the shared profile
  while the supervisor is up); it was computed and thrown away.
- `auth-setup.mjs` gains `observeSharedDevelopmentAuth`, which reads that
  descriptor behind a liveness check — recorded pid *and* recorded process
  start time, so a descriptor left by a crashed supervisor cannot claim a
  broker through a reused pid. Every uncertainty resolves to unavailable:
  unreadable, unrecognized, supervisor not running, projection unrecorded by a
  supervisor predating this change, and not admitted.
- `runAuthStatus` observes by default. `--shared-available` still overrides, and
  now means only what it says — an assertion from a caller who knows about a
  broker this project directory cannot see. The observation is reported next to
  it as `sharedDevelopment`, so an assertion never erases what was seen.
- The resolver's blocked message names `snapback dev --expo`, the command that
  actually serves the broker (`packages/snapback-client/provider-entry.mjs`).
- `snapback auth enable` drops the `--shared-available` workaround from its next
  chain: `snapback generate` -> `snapback dev --expo` -> `snapback auth status`.
- `guide/auth/native-apps.md` describes the observation, its pessimistic
  failure modes, and what the flag now means.

Covered by `packages/snapback-cli/auth-setup.test.mjs` (live supervisor, all
five uncertain observations, assertion override, and a drift test binding the
two format strings to their issuing modules) and by the supervisor descriptor
assertion in `packages/snapback-cli/expo-dev-loop.test.mjs`.

## Verified live, 2026-08-25

Measured against a real supervisor on `demos/knockoff` (providers enabled and
regenerated for the run, then reverted; debug runtime binary):

```
$ snapback auth status                       # no supervisor
apple: app-owned-native (application, blocked)
  Next: Start snapback dev --expo, or run snapback auth configure apple.
Shared broker: none observed (no-supervisor).

$ snapback dev --expo --expo-platform web    # supervisor up
$ snapback auth status                       # no flag
apple: snapback-shared-browser (rehearsal, ready)
google: snapback-shared-browser (rehearsal, ready)
Shared broker: serving at http://127.0.0.1:4386.

$ ^C                                          # supervisor gone
$ snapback auth status
apple: app-owned-native (application, blocked)
Shared broker: none observed (no-supervisor).
```

The observed origin is the one that answers, which is what the reverted
`dev.ready.json` probe got wrong. Measured at the same moment:

```
POST http://127.0.0.1:4386/v1/shared/start -> 400 return-target-invalid   (the broker, refusing a bad body)
POST http://127.0.0.1:4287/v1/shared/start -> 404 SNAPBACK_ROUTE_UNKNOWN  (the backend, which never serves it)
```

A full round trip against that broker also completed outside any app —
`start` -> `authorize` (HTML page) -> `complete` (303 to the allowlisted
`http://127.0.0.1:4387/auth/shared`) -> `redeem`, returning
`{ challengeId, code }` plus
`{ provider: apple, adapter: snapback-shared-browser, identityRealm: rehearsal }`.
No client UI has driven it yet; that gap is the demo vehicle, still open.
