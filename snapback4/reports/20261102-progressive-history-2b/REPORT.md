# 2026-11-02 — Progressive history, chunk 2b: the cold pin and sync() to exhaustion

**Written by the supervisor (Claude Fable 5.1).** Codex gpt-6-astra (xhigh) implemented this chunk and
ran the suites whose logs sit beside this file, then died on an upstream "Selected model is at
capacity" error before writing its report. The implementation is complete; the verification below was
run by the supervisor outside the sandbox on the final tree.

## What changed (paths relative to `snapback4/`)

- `crates/snapback4-core/src/partition/acquire.rs`, `engine/acquisition.rs`, `crates/snapback4/src/serve_acquire.rs`:
  a request that starts a walk (`acquire.cursor: null`) with `from == 0` **pins** the cold stream: the reply's
  `watermark` is the unit's `images_at` (the server head) and `acquire.pinned` is true; every later unit keeps
  `watermark = from`. Receipt evidence (`committed_above`) is still split against the request's cut, so the
  pinning unit covers `(0, head]`. Exactly the snapshot's first-page rule (`snapshot_page` pins
  `watermark = next_seq() - 1`), so historical membership joins before the pin are never replayed by the
  ordinary stream and the walk's order holds (RFC §6.1, revision 1a).
- `crates/snapback4-device/src/device/acquisition.rs`, `device.rs`, `device/deferred.rs`: a pinned unit is
  accepted only on a cold, empty partition (no applied watermark, no `ACQUIRED`, no cursor, no completion
  head, no deferred slot, no table facts, no boundaries, no rows, no bases); otherwise it is refused with
  the existing generation error so the client restarts cold. The pin commits with the unit's rows, cursor
  and coverage in the one publication transaction. Repair B's `should_defer`/`validate` use the receipt
  cut `0` for a pinned page and the page watermark otherwise.
- `packages/snapback4/src/local-acquisition.ts`, `local.ts`: after a pinned first unit, ordinary drains start
  at the device's published watermark; a cold progressive device never requests `from: 0, stream: true`.
  An explicit `client.sync()` on a device whose walk is unfinished drives the walk to exhaustion (units
  interleaved with ordinary drains, hints honored, the network owner released between units) and resolves
  only when `acquired` is true or a refusal/offline result ends the round — `sync()` keeps its documented
  meaning; hooks and background rounds still publish one unit at a time (RFC §6.2).
- Tests updated in core (`tests/progressive_acquisition.rs`), HTTP (`tests/serve_sync/progressive.rs`),
  device (`src/device/progressive_tests.rs`, `tests/progressive_history.rs`), simulator
  (`tests/progressive_history.rs`) and client (`test/progressive-acquisition.test.mjs`, its helper): pinned
  first unit vs unpinned later units; pin refused on a started store; the natural-log witness now sees no
  join expansion before the walk's first tier-2 unit; a join after the pin is still expanded on the stream;
  explicit `sync()` on a cold device resolves acquired with every tier-1 table whole and every group floored.

## Supervisor verification on the final tree (outside the sandbox, volta node 24.18.0)

Client, after `bun run --cwd packages/snapback4 build` (exit 0), `node --test` per file:

| Suite | Result |
| --- | --- |
| `ordinary-history.test.mjs` (red at chunk 2's commit) | 14 passed, 0 failed |
| `progressive-acquisition.test.mjs` | 26 passed, 0 failed, 1 skipped (browser witness) |
| `acquisition.test.mjs` (legacy staged path) | 47 passed, 0 failed |
| `retained-history.test.mjs` | 79 passed, 0 failed |
| `progressive-start.test.mjs` | 48 passed, 0 failed |

Rust: see `CARGO-VERIFY.md` beside this file (appended by the supervisor from
`logs/verify-chunk2b-cargo.log`).

Astra's own logs in this directory (its sandbox): `core.log`, `http.log`, `device.log` (one intermediate
`progressive_history` failure, fixed), `device-final.log`, `device-progressive.log`, `sim.log`,
`typecheck.log` (`tsc -p tsconfig.json --noEmit`, clean), `ref-check.log` (0 errors), `guide-api.log`;
`ordinary-history.log` failed in its sandbox on `ps` EPERM (harness import), which is why the supervisor
ran it.

Not run here: `react.test.mjs` and `witness/idb.mjs` (run by the supervisor for the landing), the wasm
rebuild (supervisor owns the artifact and the budget), the broad affected run (landing).
