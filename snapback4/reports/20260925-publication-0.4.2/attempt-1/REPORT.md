# Snapback 4 0.4.2 publication — attempt 1 stopped

**Not published.** The first full `scripts/test.sh` exited 1 and ended with
`== 1 failure(s) in 2341 s`: the client-test stage contained three failed
published-0.2.33 capability-fence assertions. No retry, isolated rerun, fix,
changed assertion, timeout, model count, skip, ignore or waiver followed.
The already-running report-all-failures suite completed before this report.

The xcframework rebuild, chat-expo Release build, dedicated simulator witnesses,
`publish.mjs --dry-run`, `--resume`, Expo pack/publication, registry verification
and branch push were **not attempted**. There are no qualified native hashes,
native witness timings, production-binary digest, staged tarball integrities
or registry integrities for this attempt. No keychain setting or credential
changed, and the signing relay was never invoked.

## Exact blockers

All three tests are declared at
`packages/snapback4/test/schema-capabilities.test.mjs:127:25` and fail at
**line 202, column 64**, on:

```js
assert.deepEqual(currentOpen.replies[1], priorAnswer);
```

| Published-0.2.33 fence | Duration | Difference |
|---|---:|---|
| timeline-v2 | 2,297.100 ms | Current `ok` query reply adds `speculative: false`; published expected reply omits it. Table: `profiles`. |
| recorded-attribution | 482.666 ms | Same extra field. Table: `posts`. |
| maintained-column | 842.600 ms | Same extra field. Table: `posts`. |

Each raises `AssertionError [ERR_ASSERTION]`, operator `deepStrictEqual`.
The comparison follows the current native device opening an existing
prior-generation store and querying it. It occurs **before** the subsequent
unsupported-future-capability adoption request. The earlier native/WASM
capability refusals logged the expected unknown `Capabilities` variant.
These observations do not establish that changing the assertion is the right
fix; that disposition belongs to the supervisor. No broader cause or
baseline/environmental exemption is claimed.

The fourth fence, **capability-free bytes and stores stay compatible**, passed,
including its canonical bytes, old native/WASM install/adopt/query/reopen,
doctor and mixed-version serving checks. The published helper verified both
cached 0.2.33 package integrities in each case.

[Complete exact errors and stack traces](./failure-details.log),
[machine-readable failure summary](./failure-summary.json),
[entire suite log](./attempt-1-full-suite.log),
[command, start/finish times and exit](./attempt-1-full-suite.json).

## Qualification results

- Rust: **3,212 passed, 0 failed, 19 existing ignores**, 918 result summaries;
  full Rust stage **726 s**.
- Ordinary clients: **1,978 tests; 1,970 passed; 3 failed; 0 cancelled;
  5 existing skips**, **1,279.411 s**. No skip/ignore was added by this lane.
- Models: **78/78 passed**, no failures, cancellations or skips,
  **169.346 s**. Online session: **5,000** sequences, **40.239 s**;
  local session: **5,000**, **92.419 s**; online client: **3,000**,
  **34.056 s**. The old publication seed-11 regression passed in **0.700 s**.
- Fixture wrapper: **9/9 passed** in **4.977 s**.
- Workspace/WASM builds, documentation budget, release guard, package
  build/typecheck, chat backend check and web/Expo app typechecks passed.
  WASM: **1,850,804 B raw / 521,627 B gzip**, within the unchanged
  **522,000 B** ceiling. README: **300/300 lines**.
- The default scheduler completed Rust before client tests and models.
  It selected serial client files at host load **49.33 across 18 CPUs**.
  No Rust-process, client-concurrency or binary override was supplied.
- Suite wall-clock result: **2,341 s**. The wrapper separately recorded
  **2,265.082 s** with `time.monotonic()`; UTC start/finish span **2,341.424 s**.
  Both raw measurements are preserved; the discrepancy's cause is not known.

[Machine-readable qualification and all stage timings](./qualification-summary.json).
The standalone suite used the requested published fence environment. It was
not the publisher's additional packaged-SQLite-policy suite, which was never
started because this gate failed.

## Source and environment

Requested base: `05382d59f040a3c3ae0f77be9b7e3a7a663f6204`.
Version commit: `f49c22f58625a85b17c6e40146adefe6bcd6b5c2`.
Worktree: `/Users/ccheever/projects/snapback-pub-042`.
Branch: `sb4-intent/publish-042`, local only.

Read the 0.4.1 report in `snapback-pub-041b`, including all three attempts,
and the 0.4.2 integration entries on fetched `origin/main` before starting.
Fetch, worktree creation at the requested base and branch creation succeeded.
Exactly the six paths from 0.4.1 version commit `e1d7a6fb56` were changed and
committed: `Cargo.toml`, `Cargo.lock`, `bun.lock`, and the CLI, platform and Expo
package manifests. All 15 version fields are 0.4.2, including the optional
platform dependency. Undici remains 8.8.0. Both frozen installs passed with
no dependency changes. The private demo application versions retain their
existing identities, matching 0.4.1.

Apple M5 Max; macOS 26.6.2; Xcode 27.0 (27A266a); Node 24.18.0;
Bun 1.4.2; Rust 1.97.0. npm identity: `ccheever`. Toolchain PATH matched the
request. Existing launchd relay SHA-256:
`06fa7db565ac920a7ee7d5d413410c3113757682c9549e3c7c9ddd1da1c46acf`, identical to
0.4.1. [Source trees, toolchain and fresh test CLI digest](./source.json).
The recorded debug CLI is a test artifact, not a production publication digest.

## Every timed attempt

Only one full-suite attempt ran. These records preserve every release command
that ran, including successful preparation. Durations are the wrapper's
monotonic measurements.

| Command | Seconds | Exit | Evidence |
|---|---:|---:|---|
| bun-install | 0.908 | 0 | [record](./attempt-1-bun-install.json), [log](./attempt-1-bun-install.log) |
| version-frozen-install | 0.142 | 0 | [record](./attempt-1-version-frozen-install.json), [log](./attempt-1-version-frozen-install.log) |
| version-commit | 0.086 | 0 | [record](./attempt-1-version-commit.json), [log](./attempt-1-version-commit.log) |
| full-suite | 2265.082 | 1 | [record](./attempt-1-full-suite.json), [log](./attempt-1-full-suite.log) |
| npm-identity | 1.151 | 0 | [record](./attempt-1-npm-identity.json), [log](./attempt-1-npm-identity.log) |

One read-only preparation listing used an unmatched `foundation/3000*` zsh
glob and returned exit 1; this was a path-inventory probe, not a build/test or
release command. It changed no file and is recorded in `source.json`.

## Retained state and handoff

No implementation, test, budget or publisher edit followed the version commit.
The suite itself updated `native-fixtures/following/Cargo.lock`'s path
`snapback4-native` version from 0.4.1 to 0.4.2. That generated change remains
uncommitted and is preserved as [a patch](./suite-generated-fixture-lock.patch).
The report, logs and appended journal entry remain uncommitted in this
worktree. The version commit remains local; no push was made.

Scope was version alignment, native qualification and publication only.
`LLP 3000#4-fence-numbering-routing` governs the independent Snapback 4 fence;
`LLP 3000#7-decisions-during-execution` governs packaged SQLite inputs and the
native iOS minimum. The root LLP is in `llp/current/`; the current witness guide
and release scripts were read. No design decision or LLP change was needed.
No LLP skill handoff is needed; the supervisor owns the failed comparisons
and authorization of any corrected release attempt.
