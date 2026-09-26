# Snapback 4 0.4.3 publication — attempt 4 passed

All three packages are published: `snapback4@0.4.3`,
`snapback4-darwin-arm64@0.4.3` and `snapback4-expo@0.4.3`. Each
registry tarball was downloaded back and matches the qualified local bytes.
0.4.3 carries:

- LLP 3000.017, ephemeral tables, through fix round 3;
- the sb4-intent program's 0.4.3 integration already on main: receipts in
  one query, live presence (LLP 3000.018) and the scale certificate rounds;
- two fixes for defects on main found during this publication (below).

Qualified source: `bb5248cfe7`, which is main `e9cca2d066` plus the
version commit that sets six files to 0.4.3. Its code is identical to main
`8442e53ede`, whose extra commit is documentation only. It was published
from the black M5 Max on 2026-09-26 (Pacific).

## Registry bytes

| Package | Tarball bytes | Integrity |
|---|---:|---|
| `snapback4-darwin-arm64@0.4.3` | 6,252,973 | `sha512-nih2ZocJ6/v79meRgcYNEBuGI/cPgQyxVMPrysCFjNifSgDZDkXurhirFFGOCHnVW6qICAyC/KeprUBqi7OaWg==` |
| `snapback4@0.4.3` | 831,751 | `sha512-TL8Rdvy+0MdX1gfC9uwcHslurA24LByojGZzTcKpaDg/j9WtcebblKi882p2ntt6UqdktavXxjOh4YL3MXjP8A==` |
| `snapback4-expo@0.4.3` | 5,249,454 | `sha512-750mT12iPlfM+0LZCIrHnm2lnEeea9zVpK+ZBLjjdbk4hlwHSU921u1x5BM2kEA5MDNBtc4NmoMO0cqkqVNcZg==` |

Evidence:
- [CLI and platform registry verification](./registry-cli-verified.json)
- [Expo registry verification](./registry-expo-verified.json)
- [Expo pack and file proof](./expo-staged.json)
- [native qualification](../20260926-expo-0.4.3/qualified.json)

## Qualification

**`publish.mjs --dry-run` (attempt 4, dry run 2) passed in 1,311 s.**
- It ran the full suite with
  `SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33`,
  which runs every published-0.2.33 capability fence. Result: 0 failures in
  1,039 s. Rust: 3,589 passed, 0 failed, 19 ignored. Node tests, clients
  and models: 2,284 tests, 2,279 passed, 0 failed, 5 skips inherited
  unchanged.
- It then ran the production build, signing, packing and the
  installed-consumer proof: `consumer ok: query complete+fresh, online write
  sent, offline write pending`.

**`--resume` passed in 346 s.** It revalidated the stage, repeated the
consumer proof, and published the platform package, then the client.

**Production binary.** 12,700,064 bytes, SHA-256
`dd1de9626f4c2537f37bea518361e235806f4c0379b521bee61da49552fbe686`,
`snapback4 0.4.3`. It was built with
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` and signed "Developer ID
Application: Charles Cheever (UD2ZVW5WU5)" by the unchanged launchd relay.
It is not notarized, matching 0.4.0–0.4.2.

**Native Release witness.** It ran on the dedicated simulator
`81961F7D-DF85-4A7A-B376-20D9073AC101`, port 44441:
- offline `--prime`: 10.4 s;
- restart `--prime --relaunch`: 14.4 s;
- every artifact hash verified.

Source trees: core `feb16123b7`, device `ae0210c253`.

**Expo.** Packed once, then verified file by file against the natively
qualified package. It was published once. The registry could read it after
139 s.

## Every earlier stop

1. **Attempt 1 stopped at the xcframework build.** Main could not compile
   the iOS device: `E0599: no method named native_input`. The native engine
   module is gated on `wasm-host`, but `Value::native_input` was gated on the
   server-only `native` feature. The Snapback 5 authorization landing
   (`243063b4b2`) introduced this, so no one had been able to build the Expo
   framework from main since. It was fixed on main as `a371edf776` and
   checked for the iOS simulator, the CLI and the web wasm profile.
2. **Attempt 2 passed its native half** on the source of that time. It was
   superseded when fix rounds 2 and 3 landed. Its native evidence is kept in
   [`../20260926-expo-0.4.3-attempt-2/`](../20260926-expo-0.4.3-attempt-2/),
   with the screen videos removed.
3. **Attempt 3 was stopped by the lead** during its xcframework build. The
   version commit had swept in attempt 2's two witness metric lines. See
   [`attempt-3-STOPPED.md`](./attempt-3-STOPPED.md).
4. **Attempt 4.** Two things failed along the way, both from other sessions'
   load on this host, then passed:
   - **The witness failed twice at teardown.** Both times the scenario
     reached `done`, then the screen recorder (`simctl io recordVideo`)
     failed to finalize within the witness's 10 s stop bound, at host loads
     of 118–578. Those runs are kept under
     [`../20260926-expo-0.4.3/failed-witness-1`](../20260926-expo-0.4.3/failed-witness-1)
     and `failed-witness-2`, without videos. The third run passed at load 27.
   - **The first dry run failed one target.** All 12 witness-driver tests
     timed out on `xcrun simctl list devices booted --json` at host load
     ~500, with about 800 simulator processes from other sessions. That
     target then passed 24/24 in isolation at load 27
     ([`attempt-4-witness-isolation.log`](./attempt-4-witness-isolation.log)),
     and the second dry run passed with no source change.

## A main defect fixed on the way

Main's published-0.2.33 capability fences had been red since the Snapback 5
`sequence by` landing. Opening an old store with the current device added an
empty `_sequences` table. LLP 3000.017's integration lane made that table
lazy (commit `d735389d6`, recorded in the LLP). The fences pass in both
dry-run suites.

## Environment

- Apple M5 Max, macOS 26.6.2, Xcode 27.0, Node 24.18.0, Bun 1.4.2, Rust
  1.97.0. npm identity: `ccheever`.
- The step records are the `attempt-<n>-<step>.{json,log}` files in this
  directory. The helper scripts, parameterized from 0.4.2's, are in
  [`attempt-4-helpers/`](./attempt-4-helpers/).
- The suite rewrote `native-fixtures/following/Cargo.lock`. That change is
  captured as [`suite-generated-following-lock.patch`](./suite-generated-following-lock.patch)
  and not committed, as for 0.4.2.
