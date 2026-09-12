# Metro FallbackWatcher ENOENT on `.snapback/build` successor transients (Snapback 2)

**Status:** Closed
**Priority:** P1
**Date:** 2026-09-11
**Systems:** Snapback 2 Expo scaffold, compiler journey staging, Clique web
**Related:** [20260827-snapback-expo-metro-generations-watcher-crash.md](./20260827-snapback-expo-metro-generations-watcher-crash.md) (Snapback 1, closed); LLP 1002 “Metro and the build cache” (specified 2026-09-11, **not in published 0.0.24/0.0.25**)

## Symptom

Both Astra Clique lanes lost Expo web at the first schema successor. Metro’s `FallbackWatcher` threw `ENOENT` on a journey transient under `.snapback/build/`:

- 0.0.24: `tests.replaced-<pid>-<ts>`
- 0.0.25: `.tests-NMmoHO`

The bundler exited; builders excluded generated paths in `metro.config.js`, capped workers, and restarted. This is Snapback 1’s closed Metro-generations crash, back on Snapback 2’s published Expo scaffold, which does not ship a `.snapback/` block-list.

LLP 1002 (2026-09-11) already specifies: ship `metro.config.cjs` block-listing `.snapback/`, and stage candidate `tests` / `.api-*.d.ts` in a same-device sibling so only the finished directory enters `.snapback/build`. This ticket is to **land and publish** that, then confirm a Clique-like successor no longer kills Metro.

## Evidence

- 0.0.24 run-log epoch `1789163220`.
- 0.0.25 run-log epoch `1789163984` (“Metro FallbackWatcher ENOENT on transient .snapback/build/.tests-NMmoHO”).
- LLP 1002 lines on Metro and the build cache.

Do not close on the spec text alone. 0.0.24 and 0.0.25 are what Clique actually ran.

## Requested outcome and acceptance

- Published Expo template / `snapback2 init --client expo` includes a Metro config that ignores `.snapback/` (`.cjs` so `"type": "module"` does not matter).
- Successor compile does not rename/remove a file Metro is watching inside `.snapback/build` on the happy path.
- Acceptance: `snapback2 check` that replaces generated tests while `expo start --web` is up does not ENOENT-crash Metro. A Clique M1→M2 successor on a published package is the real bar; a focused staging-directory test can land first.

## Resolution (2026-09-12)

The source fix landed in `a07a851b0b195ede1572fccb1bdae57566e0a038` before
this ticket-closing run. It ships `metro.config.cjs` from the Expo template and
stages compiled journeys beside the project before publishing the completed
directory into `.snapback/build`. The focused compiler and scaffold regressions
landed with that change.

This closure also exercised the real consumer boundary from
`c6d7843ce68aa33fab244794caa6d45047bd5c16`: the existing
`packDevelopmentConsumer` path installed a freshly packed host/shim pair and
passed installation, `doctor`, both template initializations, both checks, the
React live-query round trip, and both receipts. Its unrelated Vite build steps
hit their fixed 30-second timeout on the loaded host, so the ticket-specific
Expo witness packed and installed a fresh candidate pair independently. These
development artifacts retain the source manifest's `0.0.25` version and are
distinct from the already-published 0.0.25:

- `snapback2-darwin-arm64@0.0.25`, SHA-256
  `d9c33ace1ab429049b057944d2b8d138f7b9e8e6e1a3882cbe429f04970dd492`
- `snapback2@0.0.25`, SHA-256
  `92704b38eb8a6393870a5735ea76c0ea0eb1c4dae27689c3e1cb77f8adf6bf17`

The installed `snapback2 init --template chat --client expo` produced
`metro.config.cjs`; loading that config proved its `blockList` matches
`.snapback/build/tests`. Headless Expo 54 web then bundled the installed app
and returned HTTP 200 in Chrome before and after an additive schema successor
and two installed `snapback2 check` journey-output replacements. All three
checks passed (generations `da408df9…`, `1ed30ecc…`, `1ed30ecc…`). Metro PID
26508 remained alive after readiness, the schema successor, and the second
journey replacement; its captured output contained neither `FallbackWatcher`
nor `.snapback` `ENOENT`. The witness stopped that exact process group and
confirmed the PID was gone.

Registry publication is intentionally deferred to the coordinated Snapback 2
release; this evidence qualifies the source and installed-tarball consumer
shape without publishing a duplicate version.
