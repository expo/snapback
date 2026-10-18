# Integration 15 evidence

Integration of the seven wave-14 lanes, based on `4ef9f77fb3`, for 0.4.31.
No publication or push is part of this integration. `WORKSTREAM-REPORT.md` at
the repository root records the final result and exact qualification snapshot.

## Independent behavior evidence

- `difftest-native.json`: `snapback4-difftest run --seed 0 --cases 20000 --workers 6`.
- `difftest-devices.json`: `run-devices --seed 0 --cases 1000 --workers 6`,
  covering seeds 0–999 with both device stores.
- `difftest-lean.json`: `run-lean --seed 0 --cases 20000 --workers 6`, using
  the freshly built pinned Lean oracle. Its 130 disagreements exactly match
  the base oracle counts in `../wave14-rules4/lean-summary.json`; no new signature.
- `schema-survey.json`: compiler checks in read-only copies of all 100 final
  wave-14 schemas, with source hashes and per-project diagnostics. A second
  complete-source/metadata survey has the same 358 notes and 100 successes.
- `schema-survey-0.4.30.json`: those same final schemas checked by the
  0.4.30 Linux binary from the requested local registry. All pass, with 371 notes.
  The difference from RULES4's earlier record is confined to apps 063 and 065;
  that record has no source hashes establishing why. These two integration
  surveys have identical source hashes across all 100 projects.
- `upgrade-result.json`: actual registry 0.4.30 store and Expo starter upgraded
  through temporary candidate tarball delivery, without publishing. Preserves
  authored files and stored rows, preserves valid Expo 57.0.30, and then proves
  `npx snapback4 upgrade --to 0.4.31` lifts deliberately older Expo to 57.0.22
  with core 57.0.23. Check, typecheck and export pass.

## Exact

Clean `https://github.com/ccheever/exact2` origin/main clone at
`85cc746b56437e8897720538cd9d8f9dbbb8cfc8`, under
`~/sb4-loop/prewave15/exact2`. Scratch manifest/lock path-bind its Snapback
crates to the merged 0.4.31 tree. `bun scripts/exact.mjs setup` installs the
compiler toolchains. CHROME points to the installed headless test browser.

`exact-commands.json` records every app command, directory and exit. Two fresh
apps use the full README synced and bare-identity online examples. Each runs
`bun exact.mjs snapback`, emits Contract types and runs `bun exact.mjs test web --backend <url>` twice:
eight authored browser tests pass. The synced example uses dev personas;
the online example uses bare `use identity` and awaits `guest()` before reads.
Client acquisition uses the fresh prepared
0.4.31 tarball; binary and Exact's device use the merged Rust tree. The scratch
apps, source, driver and numbered logs remain in `~/sb4-loop/prewave15/`.

## Mac native peer floor

Only `ccheever@macstudio-charlie-apt101-a`, Xcode 27.0, scratch clone
`~/sb4-ws-integ15`. Expo 57.0.22, expo-modules-core 57.0.23, React 19.2.3,
React Native 0.86.3, locally built 0.4.31 XCFramework and prepared client.
`mac-native-results.json` records successful Release build, install and native
witness command. `mac-native-{offline,restart}.json` retain successful receipts.
The private simulator was shut down and deleted afterward. Native witness
source is `0130e0f041`; core/device production code, client source and the Expo
package are unchanged between that commit and qualified `bbf8dfaae4`. Later
changes are CLI proof ownership, guide text, test fixtures and qualification
wiring; the peer-floor witness exercises the same native/client runtime. Initial scratch
reference-app Babel/signing setup failures are retained remotely; success uses
its normal Xcode signing and explicit reference-app Babel preset 57.0.16.

Raw lane reports are preserved verbatim under `lanes/`. They are inputs to
integration, not substitutes for the final integrated checks.

## Fresh packed qualification

`publish.mjs --prepare-client --prepare-directory target/integ15-pack3`, then
`qualify-linux.mjs --consumer-only` with that directory's client and Expo packs,
output `target/integ15-qualification2`: exit 0 at source
`bbf8dfaae407d407432ba5cb2269307572564899`. All H9 slices, starter/frontend
proofs and clean Alpine consumers pass. `packed-consumer.json` and its component
records retain pack integrities and the static Linux binary digest. Full native
and client suites are commissioned separately; this mode deliberately produces
no publication qualification receipt and never invokes `scripts/test.sh`.
The earlier run exercised all consumers but correctly refused success because
the source changed during integration fixes; its log is retained separately.

## Final-pack store and Exact repetitions

Both proofs repeat successfully with `target/integ15-pack3` and the rebuilt
`target/debug/snapback4` at the same code snapshot. `final-app-checks.json`
binds their binary/client digests; `upgrade-final-result.json` asserts exact
row data and store-id equality. Exact's final projects are `synced-final` and
`online-guest-final` under `~/sb4-loop/prewave15/`, with eight passing web tests.
`exact-final-commands.json` records every foreground command; each backend runs
`snapback4 dev --port <its recorded port> --no-watch` from its app's parent.
Driver sources and the scratch Exact manifest/lock delta are retained verbatim.
The Exact driver executes from the prewave15 directory, and the upgrade driver
executes from `target/integ15-upgrade`; source copies here are provenance.

## Complete final suites

Linux's exact five-crate command completes after the final test cleanup fix:
exit 0, 402 targets, 6467 passed, 0 failed, 45 ordinary ignores. Mac's complete
repeat: exit 0, 402 targets, 6502 passed, 0 failed, 45 ordinary ignores. Both
Mac intermittent cases also passed alone; investigation tickets remain open.
`native-results.json` retains per-target results and raw-log digests.

The final Linux client pool passes all 411 files in one pass: 7660 passed,
0 failed, 56 ordinary platform/environment skips. Full-default seeded models
pass 81/81 and the fixture wrapper 9/9; all three stages exit 0. The complete
Mac changed/platform-sensitive scope passes 96 files: 1669 passed, 0 failed,
17 platform skips. Final commands/logs are retained alongside failed/cancelled
attempts; none of those attempts is represented as green qualification.

The final code commit is `19fbc756c0`. After packed snapshot `bbf8dfaae4`, only
worker expectation and wire-fixture teardown test code changed, plus evidence
and research/issue documentation. All runtime, native floor, packed, upgrade,
Exact, differential and wasm semantic inputs remain unchanged.
