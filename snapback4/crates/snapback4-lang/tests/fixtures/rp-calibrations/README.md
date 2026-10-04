# RP real-app headroom fixtures

The Quarry files are byte-for-byte copies of the final calibration sources,
including their imports. No source is simplified for this test.

- `0411`: `benchmarks/runs/2026-10-02-snapback4-clique-astra-0.4.11/astra/source/snapback` in this repository.
- `0412`: `benchmarks/runs/2026-10-03-snapback4-clique-astra-0.4.12/astra/source/snapback`, copied read-only from the eb1000 `lane-lu` worktree because this run is absent from RP's base commit.

SHA-256:

| File | Hash |
| --- | --- |
| 0411/schema.q | d1bdf39f91474fa8afa9d0ba6374aec0951f6a6957c75e7fcaea93d883972813 |
| 0411/windows.q | a68031ece85ea2e730ddbb11551249129e20db7579ffb0a1978c66f22cabb3fb |
| 0412/schema.q | aac0c238369601fb24e5d23ce84369d29e3d699e8424d60bc623a876e5234a37 |
| 0412/config.q | b9b7add541e5ffba1da6aef91ccc3903bf758764928c6586aacbb11604175c17 |
| 0412/schedule.q | dd95a57021524fa6b48805f85b0e574ab3dbd296e1afb2168f6a00771aa51d32 |

`base-meters.json` is measured on round 3, commit `7fc57283b3`, using this
same test's seed, timestamp, profiles, 50 members and three message bodies on
eb1000. It is a regression ceiling for **each of all seven meter fields**,
not an allowance generated from the candidate. Do not regenerate it when
updating the current backend fixtures.

`reservation_app_headroom.rs` recompiles both apps, seeds profiles and members,
acquires actual server pages, predicts on both device stores and executes the
server mutation. Every case must commit, predict a pending history row, and
spend no more of any meter than base. It also revalidates the schema, program,
page and outcome JSON consumed by `reservation-app-headroom.test.mjs` in wasm.
The backend is split into schema and programs so no file exceeds 256 KB.
Regenerate current fixtures with `UPDATE_RP_APP_CASES=1`; that does not disable
headroom, commit or prediction assertions.
