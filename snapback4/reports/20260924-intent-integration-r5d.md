LLP 3000.013 integration, round 5 part d — 2026-09-24

Branch `sb4-intent/integration`, worktree `~/sb4-intent/lane-i`.
Read F's external round-6 report and committed report before its merge.
Fetched `origin sb4-native/n-smoke`; FETCH_HEAD was exactly `c1ed4bdca`.
Read both requested native reports in full before merging: [initial delivery](./20260924-native-smoke/README.md)
and [review round 1](./20260924-native-smoke/round1/README.md), plus the final
round-2 test additions and journal. Their macOS artifacts remain historical
lane evidence, not a new integrated native qualification.

| Source | Merge | Conflicts and resolution |
|---|---|---|
| F `ec04c2b0f` | `905299396` | `--no-ff`; journal only. Preserve every entry. Workspace build passed. |
| N `c1ed4bdca` | `8082c720f` | `--no-ff`; journal, witness card, `app.ts`, `app.test.mjs`. Keep both journals and regression sets. Retain F's card lead and entire deeper-runner example/prose; place N's smoke command and protocol before the deeper runner. Combine native publication deferral with E's captured assets, forwarded local options and app-owned identity. Workspace build passed. |

`local.ts` merged automatically: native host attachment happens on the opened
client and detaches synchronously on close. `createApp` wraps that attachment
until the candidate has survived session persistence and has been published.
The wrapped opener goes through E's existing option-forwarding path; the
captured asset policy and removal of lower-level persona/guest overrides remain.
Production `react.tsx` needed no conflict resolution. The imported React fixture
now supplies `openApp` for the Expo reference app's `AppProvider` lifecycle.
No pending J work was merged by this part.

File map, relative to `snapback4/` (imported behavior unless stated otherwise):

| File | Change |
|---|---|
| `crates/snapback4-lang/src/guide/effects.rs` | F's cancellation paragraph reconciles recorded steps with their stored provider keys; effect-id advice is legacy-scoped. |
| `crates/snapback4-lang/tests/guide/recovery.rs` | Pins that later cancellation paragraph and its in-flight limitation. |
| `crates/snapback4-lang/tests/guide/rules.rs` | Executes named unique collisions against hidden/readable rows for update and upsert, retaining ordinary constraint coverage. |
| `crates/snapback4-lang/src/guide/witness.md` | Integrated smoke-first command and three-segment contract, with F's lead and complete existing application runner preserved verbatim. |
| `crates/snapback4-device/src/call.rs` | Native-only `witness_state` exports held counts, identity, acquisition and watermark. |
| `crates/snapback4-device/src/store.rs` | Store trait supplies the witness count hook. |
| `crates/snapback4-device/src/memory.rs` | Count held table keys without decoding row contents. |
| `crates/snapback4-device/src/sqlite.rs` | Native SQLite implements the count hook. |
| `crates/snapback4-device/tests/native.rs` | Counts-only state survives a real SQLite reopen and excludes row contents. |
| `crates/snapback4/src/dev_worker.rs` | Witness-owned backend logs omit the worker bearer. |
| `crates/snapback4/src/main.rs` | Advertise the smoke command. |
| `crates/snapback4/src/verbs/witness.rs` | Smoke options, cold-launch choreography, exact restart barrier, final receipts and process-liveness validation. |
| `crates/snapback4/src/verbs/witness/protocol.rs` | Preserve and reserve the additional screenshot outputs. |
| `crates/snapback4/src/verbs/witness/smoke.rs` | Three-segment smoke validation and zero-application-write commit marker, with unit tests. |
| `crates/snapback4/tests/witness.rs` | Driver success/failure, exact-barrier and crash-after-success regressions. |
| `crates/snapback4/tests/fixtures/witness-simctl.py` | Fake simulator emits smoke receipts and controlled failures for the driver tests. |
| `packages/snapback4-expo/src/index.ts` | Lazily load smoke instrumentation only on explicit smoke launches and attach the actual native client. |
| `packages/snapback4-expo/src/smoke.ts` | Built-in counts-only runner, optional-argument queries, final-state checks, error chaining and replacement-client lifetimes. |
| `packages/snapback4-expo/src/witness.ts` | Keep the application runner inactive during smoke launches. |
| `packages/snapback4/src/app.ts` | Integration resolution combines E's options/session protections with N's deferred native attachment. |
| `packages/snapback4/src/local.ts` | Host attachment and synchronous detachment hooks. |
| `packages/snapback4/test/app.test.mjs` | Preserve E and integration logout/option tests; add N's own-client and discarded-restoration-candidate witnesses. |
| `packages/snapback4/test/native-smoke.test.mjs` | Smoke launch, query selection, identity/count/barrier failures, final snapshots and replacement-client regressions. |
| `packages/snapback4/test/react.test.mjs` | App-shaped fixture for the Expo app's new ownership path. |
| `apps/chat-expo/App.tsx` | Ordinary launch uses `AppProvider`; preserve persona and application-witness paths. |
| `apps/chat-expo/src/client.ts` | `openApp` owns restoration and ordinary sign-in through `createApp`. |
| `packages/snapback4/README.md` | Three-line smoke discovery link; 299/300 physical lines. |
| `../llp/3000.011.005.000-qualify-the-built-application.rfc.md` | Native runtime smoke rung and exact restart-barrier contract. |
| `reports/20260924-guide-review-r6.md`, `reports/20260924-native-smoke/` | Imported lane reports and native evidence unchanged. |
| `JOURNAL.md`, this report | Preserve every parent entry and append the integration result. |

No new Quarry syntax or integration-specific test was needed. F's executed
examples include `unique amount else AMOUNT_TAKEN` and
`upsert records[id = id] { amount }`: hidden collisions remain ordinary
`E_RULE`, while readable collisions return the declared code. The native
entry point is:

```sh
npx snapback4 witness ios --smoke --bundle-id com.example.chat --udid "$UDID" --artifacts artifacts/native-smoke
```

It requires an installed Release app on macOS. The runner uses the app's own
published session and records prime, cold offline and restarted-online receipts.
It neither creates a guest nor writes application rows. The exact barrier must
be consumed and acquisition, identity and watermark must still hold after the
render pause. Application-specific semantics still use the deeper runner.

Affected verification on Linux passed:

| Command / scope | Result |
|---|---|
| `cargo build --workspace`, after each merge | Both passed |
| Frozen Bun install; SDK build and typecheck | Passed |
| Chat backend `check`; Expo app typecheck | Passed; chat retains its existing `N_NO_CURSOR` inbox note |
| `node --test --test-concurrency=1` for `app`, `app-storage`, `client-seams`, `local-signout`, `native-smoke`, `react`, `witness` | **162 passed, 0 failed, 0 skipped**, 86.634 s |
| `cargo test -p snapback4 --bin snapback4 verbs::witness` | **3 passed** |
| `cargo test -p snapback4 --test witness -- --test-threads=1` | **8 passed** on Linux |
| `cargo test -p snapback4-lang --test guide` | **80 passed** |
| `cargo test -p snapback4 --test check` | **69 passed** |
| `cargo test -p snapback4-device --test native` | **8 passed** |
| `node scripts/docs-budget.mjs` | 299/300 lines; named first-screen test passed |
| Root `./ref-check --verbose` | 505 documents, 9,240 references, 0 errors, 0 unchecked |
| Whitespace, source budgets, journal/snippet preservation | Passed; largest changed source `local.ts`, 1,493 lines |

These are 168 Rust test executions plus 162 JS test executions; the protocol
unit test is intentionally compiled into both Rust witness targets. The docs
gate repeats one already-counted guide test. Cargo used Rust 1.97.0, debug-info
disabled, incremental disabled, 12 build jobs, and four test threads except
the serial witness target. Node is the accepted host version 24.13.

The JS run exercised the previously added token-comparison-read logout test,
the native-only-published-client race, both final-render state regressions and
actual browser React lifetimes. Guide tests exercised both new F witnesses and
Bob's cross-author unrepost. All passed first execution; no intermittent test
failure occurred, so no isolated failure rerun was needed.

Coverage limitation: `tests/witness.rs:77` gates the 16 subprocess simulator
driver cases behind `#[cfg(target_os = "macos")]`. They are absent from the
Linux test binary, not counted as passed or ignored. The command above ran all
eight platform-independent cases. The real driver also explicitly refuses Linux
and uses `/usr/bin/plutil`; its platform contract was not weakened to manufacture
coverage. Run the same target on macOS to execute all 24 cases. No simulator,
signed app build, or integrated native-performance claim was made here.

Verification-command corrections, not product failures: an initial `check`
ran from `apps/chat-expo`, which has no schema; running it from `apps/chat`
generated the shared API and the Expo typecheck passed. An initial `ref-check`
ran from `snapback4/`, found zero LLP documents and reported 531 missing refs;
the root invocation passed without edits. The first docs-budget invocation
was interrupted because it inherited a different Cargo profile and started
an unnecessary rebuild; the final invocation used the qualification profile
and passed. No assertion or production behavior was changed for these repairs.

The complete Clique fixture is unchanged; its end-to-end result remains the
part-c qualification, not a new execution in this part. No design change or
remaining integration defect was found. The macOS-only driver coverage above
is the deviation from the requested Linux checks. All other part-d work is done.

`scripts/test.sh` was **not run**, as explicitly instructed; there is no new
full-suite summary line. WASM rebuilding, remaining round-5 merges and final
qualification remain deferred. No version bump, push or publication.

Logs: `~/sb4-intent/integration-r5d-{build-f,build-native,witness-unit,
witness-driver,guide,cli-check,device-native,js,docs-budget,ref-check}.log`.
