# Round 9 reproduction and failure ledger

Merge parents: NX round 8 `156bdee7c6` and fetched GitHub main
`5e12646aeefa896e698b6ea1b5f34203d2919cdb`. The merge is deliberately
not a rebase. Main includes the landed X27R scene plugin and diagnostics.
No other session's X27R checkout or simulator is used.

## Orientation

Scope: witness driver/preparation/recovery/publication, installed CLI shim,
Expo starters, guide cards, and the merged wasm budget.
LLP 3000#4 defines the independent Snapback 4 fence; LLP 2000.000#12
explains the measured loop. LLP 3000.030#13 governs explicit simulator
ownership and the scene lifecycle; #15 governs exact exported bytes,
conservative reuse, native custody, verified publication and recovery.
LLP 3000.007#20.10 governs the existing app witness; LLP
3000.011.005.000#2 limits the claim to the application actually exercised.
These are in the current working set, not the Snapback 1 foundation.
The merged client/witness cards are the current authoring surface.
The round-8 recovery residuals and unresolved social timing target remain;
this merge adds no unconditional orphan-free or quiet-host timing claim.
Doc updates: this report, the append-only journal and combined LLP revision
history. Hand-off: none; references are validated by ref-check.

## Conflict resolutions

- `llp/3000.030-native-proof-in-minutes.rfc.md`: combine NX's revision history
  with both X27R revision entries; preserve both bodies.
- `snapback4/JOURNAL.md`: concatenate both append-only tails without changing
  either parent's entries; append the round-9 entry separately.
- `guide/witness.md`: retain NX's boot-complete lease ownership, bounded Node
  resolution and export-cache wording alongside main's scene-lifecycle advice.
  Condense prose to the unchanged 399-line ceiling.
- `verbs/witness.rs`: keep cancellation and environment classification; name
  the failing simctl subcommand. Combine exported/native-cache evidence with
  X27R product toolchain metadata, app-start tracking and scene detection.
  Keep both simulator leases and the interrupted-spawn regression.
- `tests/witness.rs`: retain rollback/lease/export controls and exact cleanup
  observations, add main's named boot failure assertion, and retain all scene
  regressions. No test is removed or weakened.

Automatic meeting points were inspected: `init.rs` obtains the lifecycle
plugin exactly once from main's reference config and keeps NX's export bin;
both starters retain their merged source. The shim retains handler removal,
signal re-raise/fallback and export-lease descriptor forwarding. Main's
618,040-byte wasm ceiling is unchanged. The client card preserves main's
read presentation, revocation and `useSeen` guidance and NX's export path.

## Reproduce

Mini uses actual Volta on PATH (Node 24.18.0), Rust 1.97.0 and
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`.

```sh
bun install --frozen-lockfile
cargo build -p snapback4
cargo test -p snapback4 --bin snapback4 verbs::witness -- --nocapture
cargo test -p snapback4 --test witness -- --nocapture
bun run --cwd packages/snapback4 build
node --test packages/snapback4/test/export-native.test.mjs packages/snapback4/test/export-native-round2.test.mjs packages/snapback4/test/export-publication.test.mjs packages/snapback4/test/export-failure.test.mjs
cargo test -p snapback4-lang --test guide
```

`run-suite.py` invokes the unmodified `scripts/test.sh` once, with no guard,
concurrency, sample-count or budget override. `suite-start-source.json` binds
that invocation. The suite's `build-wasm.sh` supplies the wasm measurement;
its filename-bearing `gzip -9 -c` result is used, not Python's headerless gzip.
`prepare-native.py` generates both merged starters, reuses downloaded external
dependencies, installs freshly packed local client/Expo packages, and checks
each schema. The production CLI and xcframework were rebuilt beforehand with
`cargo build -p snapback4 --profile production` and
`bash scripts/build-xcframework.sh`.
`run-native.py` primes then runs a warm export per starter with an isolated
`sb4-nx-r9-` prefix and state directory, requiring all three smoke segments,
matching installed/exported HBC, publication evidence and a warm cache hit.
This is functional evidence under disclosed host load, not a timing cohort.

Linux uses only `/tmp/sb4-nx-r9.O0cNyk` on eb1000, Node 24.13.1 and
Rust 1.97.0, eight Cargo jobs and the same SQLite flag. The merged source and
an independent main-only source tree share disposable compilation output.
`source-transfer.json` binds both transports. Baseline commands in the
main-only tree are `cargo test -p snapback4-lang --test prefix_reads --
--nocapture` and `cargo test -p snapback4-sim --test membership_search --
--nocapture`. No UB source or assertion is changed.

## Intermediate failures

1. Merge regression: the client card automatically merged to 1,207 words,
   exceeding its unchanged 1,200-word guard. Both overlapping guide invocations
   reported that one failure (110 passed each). Removing the abbreviated
   timing parenthesis leaves exactly 1,200 words; detailed timings remain on
   the witness card. The final guide run passes 111/111.
2. Ours — local harness setup: a first edit command ran with `snapback4/` as cwd
   while its paths already included `snapback4/`, raising FileNotFoundError.
   It made no edits; rerunning from the repository root applied the intended
   guide and ticket changes. No product behavior or assertion changed.
3. Ours — Linux scratch provisioning: the initial JS run could not find the hardcoded
   `snapback4/target/debug/snapback4`; the runner used an external
   `CARGO_TARGET_DIR` without a workspace alias. Its missing target directory
   also broke two mkdtemp fixtures. The publication file waited for data from
   the failed launch. Its exact owned subprocess was identified by cwd,
   parent and argv and stopped; the runner retained exit 1 and continued to
   main-only baseline tests. The final run supplies the alias and an outer
   120-second test timeout, without changing test source or assertions.
4. Native prime under extreme concurrent load: plain's first export failed
   during Node resolver group cleanup. Runtime resolution returned the correct
   Node path/status 0, but watchdog cleanup exceeded its four/five-second
   limits. Load rose from 65.51 to 272.42 over the 51.77-second command and
   later exceeded 385. The recorded guardian/anchor had exited at inspection.
   Raw logs and the failed manifest are retained. This was no passing proof;
   the retry waits for host load to settle, without changing any timeout.

The main-only UB control reproduced exactly the ticketed four failures (8/2
pass/fail in prefix_reads and 22/2 in membership_search). The main-only
focused replay-banner check passed; its existing ticket records intermittent
startup-log observation, not a deterministic assertion failure. The merged
canonical run reproduced that same line-330 prefix snapshot.

`linux-run.sh` preserves the initial runner, including its provisioning mistake.
The corrective command created `merged/snapback4/target/debug` as a symlink to
the scratch Cargo `target/debug`, then reran the same four JS files with
`--test-timeout=120000`. Result: 18 passed, zero failed, one Darwin-only skip.
Initial result: 9 passed, 7 failed, one skipped; its prematurely ended file
left only 17 reported tests. All 13 Linux logs/records were copied and
SHA-256 verified. All 2,435 transported merged files and 2,418 main files
were rehashed unchanged before deletion. Linux used the pre-trimming client
card; the only later source change was its seven-word prose reduction, tested
by the mini guide suite. No witness or executable behavior changed.

5. Baseline client failures: the three published-0.2.33 capability-fence
   comparisons reject SJ's additive `decorationExpiry: null` query key. The
   isolated file reproduces all three. Its test, complete core/device trees
   and reply producer match fetched main; no NX delta enters that path. This
   source-bound attribution is distinct from the main-only Linux UB run.
   Tracked in `issues/20261002-snapback4-decoration-expiry-breaks-published-capability-fence.md`;
   neither the query reply nor the compatibility assertion is changed here.

The initial production binary embedded the pre-trimming 1,207-word client
card (all executable witness code was final). After the canonical Rust
witness target completed, a production rebuild incorporated the final
1,200-word card. `built-cli.json` and `built-cli-final.json` retain both
binary hashes and direct `guide client` comparisons. Native retries use the
final binary. The later exact cache-pin integration correction is recorded below; it is the
only product input changed after the canonical start snapshot.

The full staged whitespace check includes historical logs/patches imported
from main; checking the lane against main also reports historical NX logs.
Those bytes are unchanged from their respective parents. Round-9 source and
new text are checked separately; original raw log bytes are archived before
formatting the small committed views.

Native quiet retry: `plain-prime-retry` refused local `file:` root dependencies
created by this round’s tarball installation. This is our setup error, not a
product regression. Restore generated 0.4.11 root declarations in package.json
and package-lock.json; keep each installed package’s local tarball resolved
and integrity fields. `native-manifest-correction.json` binds that correction.
Installed package bytes, audit pins and adapter guards are unchanged. The
next attempt is labeled `prepared`; both failed primes remain archived.

The `prepared` plain prime and nominal warm exports both pass every native
segment and publication check, but their cache keys conservatively retain
per-run environment because the merged dependency trees are unaudited. The
nominal warm run (103.911 s) therefore rebuilds and fails the harness’s cache-hit
assertion. This is a merge integration defect, fixed by the exact-hash audit in
`dependency-audit.md`, not a waived assertion. The two complete old dependency
snapshots matched existing pins; all external package bytes are unchanged.
The final effective-config control verifies 40/43 observed registered mods,
no unknown/conservative plugin, and stable keys across generated environments.

A first write of the audit helper repeated the earlier cwd-prefix mistake;
no file was created. The corrected helper and its complete delta are retained.
The full suite completes with `== 2 failure(s) in 2585 s`, eight baseline test
failures across the Rust/client groups, and 79/79 serial model passes.

Final pin-bound checks pass: mini 41 units, 76 integration, 19 JS; Linux
42 units, 31 integration, 18 JS and one Darwin-only skip. Both native warm
exports pass all segments and publication checks with cache hits. Plain is
23.161 s (load1 6.349 → 5.729); social is 29.560 s (12.768 → 9.534).
The successful quiet-window resolver retry supports classifying the original
extreme-load watchdog failure as environmental; no cleanup limit was widened.
The other noncanonical failures are our setup mistakes or the two corrected
merge issues (guide word count and exact dependency pins). All attempts remain.
The final guide output differs from source only by the CLI’s extra terminal
newline; `built-cli-pins.json` records both raw and normalized comparisons.

The first final size-audit attempt treated an unchanged Git submodule commit
as a blob and stopped. The audit now excludes gitlinks; staged source and
evidence bytes are unchanged.
