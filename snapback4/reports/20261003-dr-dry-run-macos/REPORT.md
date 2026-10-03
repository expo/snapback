# DR round 0 — Mac publication dry-run repairs

Base: `ffc125ea2439695d06d066dc6b25e45c2a39a088`, freshly fetched `origin/main`.
The requested clean worktree/branch already existed at that commit:
`~/sb4-np/lane-dr`, `sb4-np/dr-dry-run-macos`, linked to
`~/projects/snapback`. No reset, push or publication. No simulator was used;
X27R and lane NX were left alone.

Host: Apartment Mac mini `MacMini-Apt101-M5-A`, Apple M5 Pro, 18 CPUs,
64 GiB RAM, macOS 27.0.1 (26A434), arm64. Rust/Cargo 1.97.0,
Node 24.18.0, Bun 1.3.12. Native builds/tests use
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` and this worktree's own
target directory. Installed frozen Bun dependencies and warmed the complete
test inventory with `cargo test --workspace --no-run` before the full suite.

## Changes

- Diagnostics retain the 32-slot bounded queue, nonblocking emit and CT's
  background writer policy. A FIFO barrier acknowledges attempted writes and
  stdout/stderr flushes. Its enqueue and acknowledgement share one timeout.
- Both `dev` and `serve` invoke the drain once, after their final startup
  banners and before `serve_requests`, without engine custody. After three
  seconds or writer disconnection, startup proceeds with best-effort output.
  Request/engine paths never drain. LLP 3000 §7 records this next to CT's QoS
  rule; implementation has matching `@ref`s.
- The 0.2.33 fence permits an absent-in-old, added-in-current
  `ok.decorationExpiry` only on query replies and only as null or a finite
  JSON number. Every other field still compares exactly, apart from the
  pre-existing `scopes` and operation-specific `preserved` allowances.
  Existing old native/WASM install, query, adoption, reopen, data/completeness
  and fail-closed assertions remain intact.
- Regression checks cover FIFO output/flush ordering, stalled acknowledgement,
  full queue and disconnected writer; `serve` checks its banner after its
  first response. JS checks reject malformed expiry, data drift, changed
  already-present expiry, expiry on non-query replies and extra search fields.

## Search-field audit

The fence's device comparisons issue ordinary `query` calls (`posts` or
`profiles`) without `search:true`; none calls `search_state`. The plain
generation fixtures have no decorated search plan.

- `crates/snapback4-device/src/call.rs` unconditionally adds
  `decorationExpiry` to ordinary successful queries, hence the new allowance.
  Its `search_state` branch adds `decorations` and `decorationExpiry` only
  when `decorationRows` is requested. That branch is unreachable here.
- `searchRows`, `searchCurrent`, `searchScopes` and `decorationPaths` are
  optional HTTP query metadata in `crates/snapback4/src/serve.rs`, not fields
  emitted by the ordinary device reply builder. The fence's sole HTTP
  capability-free control queries undecorated `posts`, has no retained-search
  request and still checks the old client's actual data.
- `engine/search_decoration.rs::search_source_keys` requires a server search
  plan; decorated paths require `search_decoration`. Ordinary device reads
  deliberately do not build `searchRows` (LLP 3000.028 §3.3). `searchCurrent`
  is the retained-candidate overlap proof, absent from these requests.
- There is no production `decorationFields` spelling in this tree; the
  corresponding HTTP field is `decorationPaths`. No broad search-field
  exemption was added. Unexpected search metadata still fails equality.

## Verification

| Check | Result |
| --- | --- |
| Mac `cargo test -p snapback4 --test replay`, ten consecutive loaded runs | 22/22 each, 220/220 total |
| eb1000 Linux same replay target | 22/22 |
| Mac `cargo test -p snapback4-core --lib diagnostics::tests` | 3/3 |
| Mac `node --test packages/snapback4/test/schema-capabilities.test.mjs` | 6/6, zero skipped; pinned 0.2.33 native and WASM packages verified |
| `./ref-check --verbose` | 527 LLP docs, 10,143 refs; zero errors/unchecked |
| `git diff --check` | Pass |

Load: 18 independent CPU busy loops, one per core. Each used
`pthread_set_qos_class_self_np(QOS_CLASS_DEFAULT, 0)` and verified its readback
before spinning. All remained alive throughout the ten runs; sampled CPU use
was about 70–97% per process. Run times: 8.97, 8.52, 8.37, 8.14, 7.93,
7.91, 8.45, 7.97, 7.76, 7.11 seconds. Only these recorded burner PIDs were
terminated, and all were reaped before the full suite.

Linux: `ssh ccheever@100.65.137.99`, endpoint `expose-builder-pixel`,
x86_64 Linux 6.8.0-138-generic, Rust/Cargo 1.93.1. A tracked base-source snapshot plus the exact
Rust patch ran in `/tmp/sb4-dr-linux.jqNdRJ/candidate`; no Linux repository
was edited. The scratch directory was deleted after retrieving the result.

## Complete Mac suite and baseline classification

Command (one complete qualifying run, with the runtime explicitly pinned):

```sh
PATH=/Users/ccheever/.volta/tools/image/node/24.18.0/bin:$PATH \
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT \
SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 bash scripts/test.sh
```

Exact final summary (exit 1):

```text
== 1 failure(s) in 6188 s
   cargo test
```

The single failing category is `cargo test` (820 seconds), containing exactly
the four independently reproduced UB baseline failures below. No new Rust
failure appeared; replay passed 22/22 again, and diagnostics passed 3/3.
All other categories passed, including native/WASM builds, unchanged WASM
budget, docs budget, release guard, package/app checks and fixture wrappers
(9/9).

Serial clients: 295 files, 5,989 tests; **5,984 passed, zero failed, five
skipped**, in 5,174 seconds. The requested schema-capabilities fence passed
all six cases again with zero skips. Client models passed **79/79**, zero
skipped, in 168 seconds. Default seed/model counts were retained, including
300 seeds per process/WASM mixed-evidence and ordinary search oracle. Expected
refusal diagnostics in the capability and model checks are passing negative
controls, not additional failures.

The five client skips are existing opt-in witnesses with unset prerequisites:
managed organization policy (`SNAPBACK4_B1D_MANAGED_BIN`, its SHA256 and private
scratch parent); managed OIDC (`SNAPBACK4_IDENTITY_PROFILE_SCRATCH_PARENT`);
published 0.2.27 cursor reference (`BOUNDS_BINARY`); the separate F2 0.2.33
fence (`SNAPBACK4_F2_LEGACY_BIN`); and the 0.2.32 server contract witness
(`SNAPBACK4_LEGACY_BIN`). They do not skip the requested 0.2.33 schema fence.

An initial attempt was stopped during clients after discovering that Node's
workspace resolution selected Homebrew 26.9.0 inside `snapback4/`, although
the initial version check at the repository root reported 24.18.0. This was
a verification setup error: that incomplete run is not a publication receipt.
Its Rust stage had finished in 862 seconds with only the four UB failures,
and at least 2,292 top-level client cases had passed without a client failure.
The corrected run prepends the actual Node 24 binary directory, bypassing
workspace-dependent resolution. The standalone fence was also rerun this way.

Independent untouched-base confirmation on this Mac used a `git archive`
snapshot of `ffc125ea24`, its own target directory, and:

```sh
cargo test --no-fail-fast -p snapback4-lang -p snapback4-sim \
  --test prefix_reads --test membership_search
```

The four known UB failures reproduce: `prefix_reads` has 8 passed/2 failed;
`membership_search` has 22 passed/2 failed. All are empty-note expectations
receiving `N_SHAPE_METER`, matching the existing
[mainline ticket](../../../issues/20261003-snapback4-shape-meter-note-breaks-prefix-and-membership-search-tests.md).
DR does not change the compiler, these tests, or their expectations.

| Baseline target | Failing test | Assertion |
| --- | --- | --- |
| `snapback4-lang::prefix_reads` | `explicit_caps_stay_silent_and_predicting_short_pages_stay_refused` | Empty notes, `prefix_reads.rs:98` |
| `snapback4-lang::prefix_reads` | `prefix_reads_compile_without_notes_and_caps_follow_one_schema_number` | Empty notes, `prefix_reads.rs:16` |
| `snapback4-sim::membership_search` | `edges::calendar_repair_executes_the_same_offset_boundary_predicate` | Empty notes, `membership_search/edges.rs:219` |
| `snapback4-sim::membership_search` | `refusal_rewrite_compiles_on_its_schema_and_keeps_filters_in_both_searches` | Empty notes, `membership_search.rs:300` |

Setup-only failures: the first reduced Linux/base archives omitted Rust
`include_str!` inputs; adding the tracked embedded files resolved compilation.
A first oversized transfer was cancelled through its owned command session.
A wrapper used zsh's read-only `status` name after a test command; test logs
were preserved and subsequent wrappers use `dr_exit`. None is a product-test
failure or a waiver.

Raw local logs are outside the commit at `/tmp/sb4-dr-20261003/`; only small
summaries are retained here.
