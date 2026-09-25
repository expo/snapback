# Lane U round 2: route from executed reads

2026-09-25. Addresses Astra's High and Medium findings in
`~/sb4-intent/reviews/u-r1.astra.md` and both Medium findings in
`~/sb4-intent/reviews/u-r1.grok.md` against accepted LLP 3000.016 revision 5.
The supervisor's RFC and its review record are unchanged.

Implementation commits: `2bc5f99a0`, `54cf37d57`, and `d5a539b13`.

## Changes, file by file

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `packages/snapback4/src/local-reads.ts` | Remove the static online-only point-read detector; identify Following dependencies from a supplied table set. Keep the shared offline/pending/held/server routing precedence. |
| `packages/snapback4/src/local.ts` | Determine withholding from the actual device outcome (`loading`, `unknown`, and returned `tables`). Native modules' empty Quarry bodies no longer bypass the prediction fence. Untaken card branches no longer withhold answerable held queries. Apply the same precedence to a composed query's second local observation. Preserve original server arguments and local-commit invalidation. |
| `crates/snapback4-core/src/engine/read.rs` | Record an actual horizon point miss before the examined charge can return early with a meter cut. The charge still occurs. |
| `crates/snapback4-core/src/engine/local.rs` | Discard an unavailable result before charging final output bytes, for both Quarry and native modules. All work and heap charges remain; published output keeps the same limit. |
| `native-fixtures/following/Cargo.toml` | Build an independent fixture crate against the real native guest SDK. |
| `native-fixtures/following/Cargo.lock` | Pin the fixture's dependencies. |
| `native-fixtures/following/src/lib.rs` | Export ordinary, held, and oversized native reads that scan the owned inbox and read an original card through real host calls. |
| `crates/snapback4-device/tests/native_following.rs` | Run the real native query module on both memory and SQLite stores, testing full, horizon, and online-only sources, the unavailable wire envelope, and discarded versus published oversized output. |
| `crates/snapback4-device/tests/following_meters.rs` | Prove that a late point miss stays unavailable at an examined cut, execution remains charged, oversized unavailable output is discarded, and identical published output is still refused. Run on both stores. |
| `packages/snapback4/test/bounded-following.test.mjs` | Add seven client regressions: untaken held branches, composed withholding, meter/output interactions on wasm/native devices, and the actual native query-module lifecycle. |
| `packages/snapback4/test/following-routing.test.mjs` | Four controlled client interleavings where a composed query becomes unavailable at its second local observation, including transport failure followed by recovery from an unrelated in-flight request. |
| `reports/20260925-bounded-following-r2/REPORT.md` | This round's findings, reproduction commands, test results, and limits. |
| `reports/20260925-bounded-following-r2/*.log.gz` | Compressed qualification and intentional regression/mutation evidence. |
| `JOURNAL.md` | One dated append-only entry. |

## Forms exercised

No syntax, refusal code, sync policy, or authorization rule was added.

An existing held query with an untaken online-only card branch now answers
`false` with complete coverage, online and offline:

```quarry
query conditional(want: bool, postId: posts) held:
  if want:
    return exists posts[postId]
  return false
```

With `want: true`, the executed online-only read still withholds. The test
also covers an optional `posts[postId]` branch returning null when untaken.

The existing native query form now honors the same fence, using the installed
module's actual table dependencies:

```quarry
query native_cards(postId: posts, c: cursor ?): native
```

The fixture's guest scans `feedFeed.byReaderPage` and calls `ctx.get("posts",
postId)`. A missing old original returns exactly `{ loading: true }` from
the client when offline, when predictable work is unobserved, or when held.
Otherwise the original arguments, including `c`, go to the server. The guest
echoes that cursor as data so the test can verify it was preserved; native
queries themselves continue to return no engine cursor.

Existing composed Quarry queries withhold the whole result:

```quarry
query composed(c: cursor ?):
  rows = feed last 20 by .at after c { *, post: posts[.post] }
  edges = follows first 20
  return { rows, edges }
```

## Regression and mutation evidence

The two Rust tests (`native_following_memory`, `native_following_sqlite`)
install and execute the actual guest module. Both prove:

- Full sources and held horizon cards answer completely.
- An unheld horizon card and an online-only card make the entire native
  outcome unavailable; the wire omits both data and next.
- Returned dependencies include the inbox and posts despite an empty Quarry
  body; the server answers the same original successfully.

Seven added real-device client tests prove:

- Untaken `Get` and `Exists` branches stay answerable for held queries on
  both wasm and native devices; taken branches stay withheld without a
  server request.
- Composed reads publish no fields offline or while prediction is pending
  on either device. After observation the original and predicted post both
  appear; transport failure stays withheld.
- A real native query module obeys every route: offline, predictable and
  unobserved (both before and after acknowledgement), held, server with
  original arguments, and transport failure without remembered recovery.
- A point read after 8,192 examined hits still withholds on an unheld card,
  and a discarded result larger than the output limit is loading rather than
  refused. Online, both retry their original arguments. The server still
  refuses genuinely oversized published data.

Four additional routing interleavings cover a composed query becoming
unavailable during its second local observation: reuse a successful server
answer only if still online with no pending prediction; otherwise withhold.
A failed server attempt must remain withheld even if another already-running
request restores the link before that second observation returns.

The new tests were also run against the old client: both untaken-branch tests
failed, and the native-module test published a server page missing the pending
`own-native` row. This is the review's concrete reproduction.

Temporarily changing only `native_query`'s `unavailable` field in
`crates/snapback4-core/src/engine/local.rs` to `false` fails both new Rust
tests on the old card. The correct code was restored and both tests passed.
The Grok regressions also fail before their respective fixes: the point case
publishes `{card: null}` with a meter cut, and the oversized withheld case
returns `E_BOUND`. Afterward both stores pass. Native oversized output is
below the guest bridge's raw byte limit but above the engine's canonical
tagged output limit, so the native test reaches the reviewed final charge.
Neither the bridge limit nor the engine's output limit was raised.

Reproduce the affected tests from `snapback4/`:

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
cargo test -p snapback4-device --test native_following --test following_meters
bun run --cwd packages/snapback4 build
node --test packages/snapback4/test/bounded-following.test.mjs packages/snapback4/test/following-routing.test.mjs packages/snapback4/test/composed-authority.test.mjs
```

## Scope and existing limits

No design deviation. Static Quarry dependencies still choose whether to try
local execution before a server-run shortcut and fence a partition reset;
they no longer decide that an executed query is unavailable. Actual returned
dependencies decide withholding. Watch invalidation still keeps static and
executed dependencies together.

The web device has no native guest host by existing design. Native query
modules are exercised on the native process device and on the Rust memory
and SQLite stores with the host enabled. Quarry and composed regressions run
on the real web wasm device as well as the native process device.

Acquisition and storage are unchanged this round. The previous real-browser
inventory, its reproduction harness, the unmet 5× target, and the lack of a
packed IndexedDB measurement remain in the
[round-1 report](../20260925-bounded-following-r1/REPORT.md). No new inventory
or latency measurement is claimed. No push or publication.

For continuity, the required subset of the **round-1** inventory is reproduced
below. These are the prior measured values, not a new round-2 measurement.

| Table | Before rows | After rows | Before row bytes | After row bytes |
|---|---:|---:|---:|---:|
| posts | 50,228 | 1,000 | 13,496,683 | 299,000 |
| reposts | 1,004 | 1,000 | 161,640 | 161,000 |
| events (`followingPosts`) | 49,228 | 49,228 | 7,796,444 | 7,796,444 |
| tombstones | 0 | 0 | 0 | 0 |
| follows | 5,921 | 5,921 | 852,624 | 852,624 |
| inbox (`followingFeed`) | 24,555 | 1,000 | 7,938,537 | 327,458 |
| profiles | 1,008 | 1,008 | 357,825 | 357,825 |
| work (`followingWork`) | 63 | 63 | 22,132 | 22,132 |
| **Whole partition, including other tables** | **171,330** | **98,543** | **35,901,571** | **15,092,169** |

Cold Chromium acquisition was **281,263.9 → 117,812.5 ms** (2.387×). Full
owned events dominate afterward. Removing all posts, reposts, and inbox rows
would still leave **95,543 rows / 14,304,711 bytes**, so 5× fewer rows or bytes
cannot be obtained from the three permitted floors. Reproduction and exact
fingerprints remain in the linked round-1 report and its `measure.mjs`.

## Final qualification

The final complete invocation exits 0: **`== 0 failure(s) in 632 s`**.
Command: `SNAPBACK4_RUST_TEST_PROCESSES=8 bash scripts/test.sh`, from
`snapback4/`. Every section passes, including the entire Rust inventory,
all client tests and shards, and all 78 model tests with their original
sequence counts. No test was removed or waived. Evidence:
[test-final.log.gz](test-final.log.gz).

Grok's completed review was read in full after it arrived, and checked again
in full immediately before the final invocation. Both of its Medium findings
are addressed, alongside Astra's High and Medium findings. There are no known
unresolved implementation failures. The supplied baseline failures did not
recur and were not used as waivers. The inherited scale/packed-format limits
are documented above.

The focused checks passed four Rust cases, 29 original/added client and
composition-authority cases, and six additional meter/re-observation cases.
The full client phase of the second suite also passed: **1,501 passes,
10 existing skips, zero failures**, plus its acquisition/server shards.
TypeScript, package/wasm builds, guide/docs checks, and the reference audit pass.
`ref-check`: **509 LLP docs, 9,293 refs, zero errors/unchecked**. The wasm
artifact is **1,776,325 B raw / 495,299 B gzip**, below the unchanged
496,000 B ceiling. Changed source files remain below 1,500 lines (`local.ts`:
1,499; `engine/read.rs`: 1,349).

Development failures, all corrected or deliberate:

- Initial construction of `native_following.rs` had an incorrect SHA helper
  import and `Option` versus `Result` accessors; a subsequent assertion
  compared an untyped native string to an engine `Id`. These were our test
  errors, corrected before the passing native regression run.
- Intentional old-client run: three failures, reproducing Astra's two
  findings on both device tiers and the actual native query module.
- Intentional `native_query.unavailable = false` mutation: both Rust native
  tests fail. The correct field was restored.
- Intentional Grok reproductions: both store tests first failed on the late
  point miss; after that fix they both failed on discarded oversized output.
  Both fixes now pass, with published-output and charged-work controls.
- First full invocation: **`== 1 failure(s) in 537 s`**, solely `client tests`.
  `Following becomes withheld on composed re-observation: transport recovered`
  expected the link to recover from a request it started while already
  offline. That was our new test's setup error. It now starts the independent
  request while online and releases its response after the transport failure,
  exercising the intended reachable ordering; all four routing cases pass.
  This first invocation overlapped development of the newly arrived Grok
  findings and is not the final qualification.
- Second full invocation: **`== 1 failure(s) in 616 s`**, solely `cargo test`.
  It hit the unchanged
  `serve::tests::full_poll_admission_preserves_short_request_progress` test's
  two-second `wait_until` deadline at `serve_tests.rs:165`. This is an
  environmental/flaky timing failure, not a failure listed in the supplied
  baseline: the test passed in the first full run and again in isolation
  (0.06 seconds), without a source change. Its schema/poll path does not use
  the changed Following reads. The final rerun reduces the existing
  `SNAPBACK4_RUST_TEST_PROCESSES` setting from 24 to 8; every test, timeout,
  model count, and engine ceiling remains unchanged.
