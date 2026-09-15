# snapback4: a device store from a replaced backend never re-acquires

- **Status:** open
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

## Next

Reproduce on the Node/wasm device in a test (acquire from store A, replace
the server store with B at the same origin and generation, sync again) and
decide the contract with the author if it needs a wire field.
