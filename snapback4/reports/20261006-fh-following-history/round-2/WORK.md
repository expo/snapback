# FH round 2 work ledger

Base: 8adc7879dd. Host eb1000 only. Initial worktree clean. No tests or background
processes from the preceding round are relied on for this delta. CPU sample at
start selected idle CPUs 32–39 for builds; measurements will resample.

Approved discovery ruling: post-B follow churn checkpoints and reports stalled.
No schema, catalog, inbox query or existing inbox certificate bytes are intentionally changed.
The native controller owns card projection and wire custody; the SDK owns the
online history protocol and uses existing local admission/own-edge fences.

Completed; the report and raw logs below define the qualification scope.

Closeout ledger (2026-10-07): implementation, shaped-object accounting, protocol
journeys, React mount and measurements complete. Final full script restarted
with all native test fixture fixes; log full-suite-qualified.log. Script affinity:
5,7,18,21,23,31,45,56,58,63,65,68,72,73,74,79,82,83,84,85,86,87,94,95
(selected from <3% busy sample); Cargo jobs 8 and automatic 8-file client pool.
Native measurements: 76–77, seven samples; HTTP/SDK: 94–95, one first page and
five later pages per corpus. Measurements finished before the larger suite mask.
No program, schema, catalog, table or persisted-format change. Wasm 639879 gzip,
cap 640009 (Linux + 130). The report and JOURNAL include the final suite receipt and affected reruns.
Root inventory output matches committed round 1 byte-for-byte, including its
pre-existing Snapback 1 failures. Independent round-2 review is not claimed.

Reproduction commands (run from snapback4/, with Node 24 on PATH):

```sh
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0
export CARGO_INCREMENTAL=0 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
taskset -c 5,7,18,21,23,31,45,56,58,63,65,68,72,73,74,79,82,83,84,85,86,87,94,95 bash scripts/test.sh
taskset -c 76,77 cargo test -p snapback4-core --lib shaped_fifty_thousand_and_eight_thousand_two_hundred_follows -- --ignored --nocapture
taskset -c 94,95 env SNAPBACK4_FH_MEASURE=1 node --test --test-name-pattern='Following shaped HTTP and SDK measurements' packages/snapback4/test/following-history.test.mjs
```

The last two commands are explicit measurements, excluded from default tests.
CPU choices must be resampled for another run; the numbers above record this run.
Affected reruns after the full suite captured documentation/golden drift:
`cargo test -p snapback4-lang --test guide --test ephemeral_compat --test following_history`,
`node --test packages/snapback4/test/delivery-fault-matrix.test.mjs`,
`node --test packages/snapback4/test/readme-examples.test.mjs`, and
`node scripts/docs-budget.mjs`. The witness case and entire CLI target are
rerun separately; no process-inspection check is suppressed. Superseded debug
logs were removed; final proof logs and the original full-suite failure remain.

Final receipt: full script exit 1 after 2,684 s. All 1,014 native executions
and 324 client files ran, followed by both full-count models (79 passes).
Introduced guide, additive TypeScript golden, await inventory and public-example
failures were corrected and pass affected reruns. The unchanged native witness
proc-inspection failure passes both exact and full-CLI reruns; its original
failure remains in the suite log and existing issue. No full-script zero-failure
claim. The final root inventory output remains byte-identical to round 1.
