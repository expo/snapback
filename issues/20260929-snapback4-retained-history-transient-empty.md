# Snapback 4: R5 retained history can publish a transient empty answer

Status: Open
Date: 2026-09-29
Scope: `packages/snapback4/test/retained-history.test.mjs` (`R5 history wasm`), LLP 3000.028 §2.1 (former member: the server loses authority, the device keeps history)

The 0.4.9 publication dry run on the black M5 (attempt 3, release commit d84ab45599, full suite at client
concurrency 6 under load near 40) failed `R5 history wasm: retained history and independent held coverage` at
`assert.ok(!deliveries.includes(0))`. After the viewer left room `left`, the watch published an empty answer at
least once before it published the device's retained 25 rows.

The same test passed 12 of 12 isolated runs on the M5 afterwards (wasm and process, load about 38), in the
first 0.4.9 dry run (7fdaaf6119), and in every eb1000 landing suite. It is therefore a rare interleaving, but the
invariant is a user-visible one: a former member's retained history must never flash empty.

Find the interleaving (a server answer from after the revocation published before the retained substitution),
reproduce it deterministically with a held read or response, and fix the ordering, not the assertion.
