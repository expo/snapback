# snapback4: a device store from a replaced backend never re-acquires

- **Status:** resolved — 2026-09-14, lane X1
- **Found:** 2026-09-14, lead, while running the published iOS simulator witness (LLP 3000.007 §20.10) natively.
- **Severity:** medium (agent ergonomics: resetting a dev database is common)

## Observation

`snapback4 witness ios --prime` against a fresh `snapback4 dev` store, with
the Release chat-expo app already holding a native device store acquired from
an earlier backend store on the same origin (`http://127.0.0.1:4471`): the
witness seeds 303 rows, opens the client online and the first `thread` query
is not `fresh` with 50 rows — the app reports `prime did not acquire history`,
deterministically (two runs). After `xcrun simctl uninstall` and reinstalling
the same build, the identical run passes (offline cold history 50 rows,
ordered flush, kill-and-relaunch offline). Artifacts:
`~/projects/snapback-next-20260914/w1-native/artifacts-final{,2,3}`.

## Why it matters

An agent resets its backend (`dev --fresh`, deleting `.snapback4/`, a new
temp project) while a simulator, browser or Node device keeps its store. The
device holds a partition and watermark from a store the server no longer has.
It should notice (a store identity or epoch in the sync reply, not only the
schema generation) and re-acquire, or refuse with a coded message naming the
reset — never answer stale or silently incomplete.

## Original next step

Reproduce on the Node/wasm device in a test (acquire from store A, replace
the server store with B at the same origin and generation, sync again) and
decide the contract with the author if it needs a wire field.


## Resolution — 2026-09-14

Reproduced on base `bca8bfe70d320c1d466c6a700493465662b2205e` before
implementation: Rust SQLite and memory tests reported 0 passed, 2 failed; the Node/wasm
client reported 0 passed, 1 failed. A held watermark of 3 was echoed by a fresh server at
head 0 (Rust) or 1 (HTTP), with no events, so the device kept three old
rows and one prediction as complete data.

Implemented the additive store identity contract in LLP 3000.007 §18.2.
The identity persists across server restarts and travels in sync and change
replies. A different identity invalidates old acquisition, rows, predictions,
staged snapshots and held/left groups; the client reloads the backend even
when its generation number repeats, then reacquires. Unsent and unknown-
receipt writes retain their IDs and order; known receipts never replay to
the replacement. The legacy backwards-watermark path also resets acquisition.

The regressions are green on both Rust stores and persisted wasm. Coverage
includes a second reset at an equal watermark, interrupted reacquisition
and offline reopen, retained left-group history, known and unknown receipts,
per-store at-most-once retries, a live client, and same-number changed
backend programs. The pending write crosses the reset in one POST; the
known receipt sends zero POSTs to the replacement. Full qualification
commands, measurements and environment failures are recorded in the
2026-09-14 X1 entry of `snapback4/JOURNAL.md`. The iOS observation itself
was not rerun in this lane; the native SQLite implementation is covered by
the shared Rust device scenarios and the existing process-device suite.
