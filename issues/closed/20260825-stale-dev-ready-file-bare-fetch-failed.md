# A stale `dev.ready.json` makes every `snapback dev` fail with a bare "fetch failed"

- Status: Resolved
- Date: 2026-08-25
- Systems: `packages/snapback-cli` (dev attach path)
- Found by: smoke testing the shared-development auth walkthrough on
  `demos/knockoff`

## What happens

`demos/knockoff/.snapback/dev.ready.json` was left behind by a dev loop from
2026-08-21 whose pid (43756) is long gone. Every subsequent `snapback dev` in
that directory — plain and `--expo` alike — failed within a second:

```
{"ok":false,"diagnostics":[{"code":"SNAPBACK_CLIENT_REFUSED","severity":"error",
 "subsystem":"client","message":"fetch failed","details":{}}]}
```

Under `--expo` the same failure arrives as `startup-failed` right after
`device-selected`, so it reads as an Expo supervision problem rather than a
stale-state problem.

## Why it matters

The message names nothing actionable: not the file, not the dead pid, not the
origin it tried, not a recovery step. Nothing in the output suggests deleting a
ready file, and the obvious readings — Metro is broken, the port is taken, the
runtime binary is wrong — all send you somewhere else. Moving
`dev.ready.json` and its two sidecars aside fixed it instantly.

The adjacent code already knows how to do this well: the `snapback reset
--dev-fresh` path refuses a stale supervisor descriptor with
`SNAPBACK_RESET_SUPERVISOR_STALE` and a `recovery` object naming both the
standalone and supervised paths.

## Suggested fix

When the dev attach path finds a ready descriptor whose owner is not alive,
refuse with a coded diagnostic that names the descriptor path, the dead pid,
the origin it probed, and the two recovery options (remove the file, or attach
to a live loop) — the same shape `SNAPBACK_RESET_SUPERVISOR_STALE` already
uses. A liveness check on the recorded pid is enough to tell "stale file" from
"server refused"; `observeSharedDevelopmentAuth` in `auth-setup.mjs` does
exactly that check against the supervisor descriptor and can serve as the
pattern.

## Resolution

Resolved 2026-08-28. The package dev attach path now checks the ready
descriptor's recorded PID with the same process-start probe used by
`observeSharedDevelopmentAuth` and refuses a dead owner before runtime setup,
code generation, or a network health fetch can obscure the stale state. The
new `SNAPBACK_DEV_READY_FILE_STALE` diagnostic names the descriptor file, dead
PID, recorded origin, and standalone/supervised recovery paths. Because the
check lives in shared `runDev`, plain and `--expo` development surface the same
code; regression coverage verifies both the terminal envelope and the Expo
`startup-failed` event and excludes the former bare `SNAPBACK_CLIENT_REFUSED`.
