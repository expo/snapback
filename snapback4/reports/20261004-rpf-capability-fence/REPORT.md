# RPF — capability-free schemas on published engines

2026-10-04, Apartment mini, darwin-arm64. Base `f2ec498379376421ce7f329c9efee972463cedc3`,
branch `sb4-intent/rpf-capability-fence`. All work ran locally. Qualification used
Rust 1.97.0, Node 24.18.0 and locked Binaryen 132.0.0. No other host, NZ worktree or simulator
was used. Nothing pushed or published.

## Reproduction and repair

The unmodified Darwin fence reproduced **four failures / two passes**, with
the default integrity-checked 0.2.33 package cache. Each feature fixture had
unexpected reservation markers; the ordinary control incorrectly had them too.

Fresh export now omits `source_reservations` when **every** plan is zero.
The zero check includes all eight original phases, owner birth, maintained-read
prices and `server_only`. Any nonzero plan still exports **every** source,
including zero-cost neighbors, with both reservation capabilities. Existing RP
explicit-zero maps remain readable. The device's structural zero proof, legacy
narrowing, reservation calculator and runtime charges are unchanged.

The fence adds the two exact reservation names to recorded-attribution and
maintained-column. The timeline fixture actually has all-zero plans, so its
original `timeline-event-slots` / `timeline-v2` set remains exact. No refusal,
published-key comparison, canonical byte fixture or store-preservation assertion
was relaxed. The control now passes native/wasm install, adoption, query and
reopen, the pinned 2,950-byte backend, and the legacy stored-schema comparison.

Orientation: LLP 3000's fence and one-interpreter contract; LLP 3000.022 §14.3
(current working set), RP report Rounds 3–5 and the receipts guide. Updated the
existing LLP and guide in place; no new design document or mechanism is needed.

## Verification

- Publication fence: **6 pass, zero skipped** on Node 24.
- Focused language/receipt run: **365 pass**, including **211 receipt/RY** tests,
  legacy narrowing, authentic upgrades, guide checks and calibration headroom.
- Extended differential: **320 cases per store**, each **114 predicted commits,
  8 conservative queues and 198 server refusals**. No predicted case was refused.
- Both complete calibration apps: hello, realistic and near-max sends at **50
  members** predict and commit on memory, SQLite and wasm. Existing seven-meter
  headroom bounds and fixtures remain unchanged.
- Focused clients: **77 pass**, including both reservation corpora, SDK Kept,
  authentic receipt/profile upgrades, six calibration sends and the existing
  omitted-effect-payload exception/rollback tests. That documented exception
  remains outside the source-reservation differential's guarantee.
- Core units: **218 pass / one existing ignore**; native capability checks:
  **7 pass**; search legacy-byte fixture: **1 pass**.
- Full Mac suite: **`== 2 failure(s) in 3055 s`**, exit **1**, from
  `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh`
  with Node 24 on PATH. These are two failed stages, four failing tests;
  the single full run is not relabeled green by isolated reruns.
  Rust has one inherited adoption
  log assertion failure: generation 2 is queryable and `doctor` succeeds before
  the asynchronous diagnostic is observed. The same assertion fails on the
  independently built unmodified base; the unchanged isolated RPF rerun passes.
  See the [adoption log ticket](../../../issues/20261004-snapback4-adoption-log-observation-race.md).
  Rust totals: **5,007 pass / 1 fail / 33 existing ignores**, plus **17 doctests**
  pass. All **76 witness tests** pass.
- Client pool: **6,189 pass / 3 fail / 6 existing skips** across 311 files.
  All three failures read partially written JSON in unchanged worker fixtures.
  The same dev-environment failure reproduces on the base binary; subsequent
  base repetitions pass. The two other cases share its premature file-read
  pattern but were not individually reproduced on base. See the
  [worker fixture ticket](../../../issues/20261004-snapback4-worker-fixture-partial-json.md).
- Serial client models: **79 pass**; fixture wrappers: **9 pass**. Every build,
  docs-budget, release-guard and package/app typecheck stage passes. The full
  run also passes the publication fence with no opt-out. References and
  diff-whitespace checks pass.

## Wasm and retained evidence

Rebuilt wasm: **2,116,732 B raw / 639,616 B gzip**, below the unchanged
**639,887 B** cap by **271 B**. The budget's macOS allowance is retained.
SHA-256: `cb78128c283c9d722857b2ab11f846ef41e19be25a7a078a95d8431c24090275`.
The pre-change build has the same sizes; the final artifact hash changes.
All implementation edits are native-only. Inspection of **11,577** symbols
finds the shared device lookup and no native reservation calculator/export;
the server-only/Unicode absence check also passes.

The supplemental serializer-family census rejects the same `i64` owned-JSON
serializer on both this change and an independently built, unmodified base.
No allowlist changed. Recorded in the [Darwin census ticket](../../../issues/20261004-snapback4-darwin-i64-serde-family-census.md);
this check is outside the requested full suite.

Logs remain outside git under `/tmp/rpf-`: `fence-before-node24.log`,
`fence-qualified.log`, `affected-rust.log`, `affected-client.log`,
`capabilities-native.log`, `search-bytes-qualified.log`, `wasm-after.log`,
`price-calculator-absence.log`, `wasm-absence.log`, `wasm-census.log`,
`baseline-census.log`, `adoption-baseline-qualified.log`, `adoption-rerun.log`,
`worker-baseline*.log`, `worker-rerun.log`, `full.log` and `ref-check-final.log`.
Preliminary runs caught stale timeline marker expectations. Updated zero-only
sequence/ephemeral and wasm fixture expectations too; qualified runs use the
exact new sets without removing feature fences or prediction assertions.

Full log SHA-256: `d83b20070199a5b6fb6d55efbdda8c89f855b90a77745781b947324d9bff3309`.
Affected Rust log SHA-256: `20a69520ee09ff546919a7b7fa484e546a577d1198ba8185ddeaf1a2c3fd2c50`.
