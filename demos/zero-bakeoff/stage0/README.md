# LLP 0155 Stage 0 evidence baseline

`baseline.v1.json` pins the source identity of the current Full JS client,
the IndexedDB/Web-Locks store, the local Ibex/SQLite target, all six LLP 0138
application manifests, and every retained LLP 0138 evidence receipt.

The application roles matter. Triage and Fleet are LLP 0155 read-lane
successor fixtures, and Incident Room is LLP 0155's authority safety control.
Kanban, Calendar, and Notebook are pinned here only as source fixtures for the
implementation wave. This artifact does not approve, schedule, or replace the
separately governed LLP 0129 decision-lab manifests.

Verify the freeze without running a server or browser:

```sh
node demos/zero-bakeoff/stage0/verify-stage0.mjs
```

The verifier checks the manifests' and receipts' current bytes, original
immutable-evidence bytes, and Git blob ids. It reproduces the published client
package closure, store closure, target capability manifest, Cargo lockfile,
and Ibex gitlink from the pinned freeze-source tree. A later successor run must
create a new versioned baseline instead of editing this file.

## Standards-real browser lane

Install the demo's pinned dependencies and run the separate browser lane:

```sh
cd demos/zero-bakeoff
bun install --frozen-lockfile
bun run stage0:browser
```

The runner discovers system Chrome/Chromium on macOS and Linux. Set
`SNAPBACK_BROWSER_EXECUTABLE=/absolute/path/to/chromium` (or pass
`--browser`) elsewhere. It uses `playwright-core` only as the CDP controller;
it does not download or substitute a browser implementation.

One run creates an owned temporary browser profile, drives the shipped RQS
store through real IndexedDB and Web Locks, commits a verified entry, sends
`SIGKILL` to the whole owned browser process group, relaunches the same profile,
and proves the entry survived. It then opens two tabs against the same origin:
one owns the writer lock, the other adopts the entry and refuses writes, and
tab death transfers ownership to the survivor. The final receipt records the
browser executable/version/digest, profile/store identity, source hashes,
storage estimates, process exits, and scoped cleanup under ignored
`.runtime/stage0-browser/`.

This is deliberately store-substrate evidence. It runs no Snapback server or
React surface and does not close the broader browser product-proof GAP tracked
in `issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md`.

<!-- @ref LLP 0155#stage-0--authority-reconciliation-and-baseline-freeze —
  freeze evidence identities without turning them into capability claims. -->
