# f7 reconnect-loop evidence rerun — 2026-08-03

The simulator-gated remainder of
`issues/20260801-0137-a1expo-f7-rn-connection-cycles.md`: rerun the A1 idle
shape on an iOS simulator with the landed socket-loss forensics
(`closeCode`/`closeReason`/`errorPreceded`/`sinceOpenMs`, commit
`ed8ee8764`) and capture what kills the socket.

Machine: fleet MacBook Air (Apple M5, macOS 26.5.2, Xcode 26.6). Fresh
`iPhone 17 Pro` device on iOS 26.3 (`f7-evidence`), Hermes, native Release
build of the frozen neutral-expo shell. Loopback director/witness pattern
(port 4610) adapted from `demos/rn-durable-store-witness/b1-run-ios.mjs`.
App shape mirrors the A1 arm: `createExternalSessionClient` +
`prepareReactBinding` + provider, `useSnapbackQuery(listSites)` (public
retainable) + `useSnapbackQuery(listRecords)` (protected), sessions-mode
email-code auth on-device — plus one addition, a witness tap forwarding
every live-stream manager state transition WITH its detail payload
(`harness/probe-App.tsx`, `harness/f7-run-ios.mjs`).

## Runs

- **Runs 1–3 (`run1-…`, `run3-…`): repo packages at origin/main
  `a4b3a3f4d` overlaid on the installed 0.1.8 closure, same-sha repo dev
  server.** The carrier never subscribes: every query fails instantly and
  the provider retries with no backoff (run 1: 21,828 provider snapshots,
  `idle↔connecting` at ms cadence). Run 3's headless probe captured the
  stack: `Array.prototype.toSorted` (ES2023, absent from Hermes) in
  `registration-ledger.mjs` `recomputeScope`. That NEW regression is
  ticketed separately
  (`issues/20260803-rn-carrier-bricked-tosorted-registration-ledger.md`)
  and blocks any f7 observation at HEAD.
- **Run 4 (`run4-…`): era-faithful arm — published 0.1.8 closure with ONLY
  commit `ed8ee8764`'s client instrumentation hunks applied verbatim
  (`patch -p3`, applies clean), published 0.1.8 CLI + packaged runtime as
  the dev server, backend schema/functions/seed verbatim from the a1 web
  arm.** The ~2s loop did NOT reproduce: one socket, `connecting → open`
  once, **zero `lost` transitions in a 120-second idle hold**, connection
  `live` end-to-end, sites ready (3) and records ready (3) intact at hold
  end (screenshots). The 0.1.8 server held the idle socket the whole time.

Driver-harness note: `run4-era-faithful.f7-evidence.json` records a
`notebook-presentation` setup "failure" — that is the witness's own 200ms
report rate-limiter dropping the final snapshot post (it drops instead of
deferring); the hold-end screenshot and the stream/tap timelines are the
ground truth.
