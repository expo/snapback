# snapback2 loop budget: core tests 38 s (budget 30 s) and first `doctor` sample 0.75 s (budget 0.5 s) at ee82e5aae

**Filed:** 2026-09-04 · **Resolved:** 2026-09-04 · **Status:** closed · **Class:** fix-forward (LLP 0189 D-1; RULES.md loop budgets)

`node scripts/measure.mjs --check` on main at `ee82e5aae` (after the LLP 1006 asset lanes and
the LLP 1012 local-first program both landed) fails two budget steps. Machine load was ~5
(a few network-bound reviewer processes from another session); an earlier run at load ~12
on `122896b50` showed the same two steps red (61 s and 0.57 s), so this is not only load.

| step | budget | 2026-09-03 (9c9bf7cb1) | 2026-09-04 (ee82e5aae) |
|---|---|---|---|
| `core_test_s` ("Test what you just changed") | 30 s | 26.7 s (28.5–30.3 s across three runs) | **38.25 s** |
| `boot_s` sample 1 (`snapback2 doctor` boot-to-ready) | 0.5 s | 0.386 s (0.43 s; one 4.78 s outlier) | **0.752 s** |
| `boot_s` sample 2 | 0.5 s | 0.024 s | 0.033 s |

Everything else is green (warm build 15.6 s, incremental 1.57 s, check 0.52 s, init→dev
0.93 s, template tests 0.94 s / 23.8 s).

## Likely causes (unverified)
- The core test step was already at the budget's edge on 2026-09-03 (30.26 s on
  `8c8c5029d`). Since then the workspace gained the LLP 1006 asset tests (core 203 → 207,
  `snapback2` crate 398 → 462) and the LLP 1012 twin/outbox/resume tests.
- The first-sample doctor boot rose ~0.35 s; the second sample did not, so it is a
  first-open cost (binary size, dyld, first store open), not steady-state boot.

## What would close it
- Profile the core test step (`scripts/measure.mjs:178`) and either split the slow tests out
  of the "what you just changed" step per LLP 1002's intent, or re-baseline the budget with
  an author ruling in RULES.md.
- Measure `doctor` first-sample cost on a quiet machine three times; if reproducible, find
  the added first-open work (compare the binary's size and startup between `9c9bf7cb1` and
  `ee82e5aae`).

The measurement line for `ee82e5aae` is appended to `snapback2/metrics/loop.jsonl` in the
same commit as this ticket.

## Lane L implementation, 2026-09-04 — still open

Worktree `snapback-s2-loop`, base `1d3f369ca`; uncommitted for the orchestrator.

The largest core test was the pre-1012
`spike::ten_thousand_messages_stay_below_certificate_and_membership_hoists`.
Every seeded row deleted its old index entries by `(table_name, row_id)`, but the
existing primary key was `(table_name, index_name, row_id)`. SQLite searched only
`table_name`, repeatedly scanning the table's index entries. Added
`index_entries_by_row(table_name, row_id)` for row replacement and deletion.
`row_index_cleanup_seeks_the_row_on_new_and_reopened_stores` fails before the fix
with `SEARCH index_entries USING INDEX sqlite_autoindex_index_entries_1 (table_name=?)`
and passes after it, including an existing store without the new index. The
10,000-message test's median fell from **16.724 s to 2.009 s** across three workspace
profiles each. All assertions and all 10,000 rows remain. Existing stores build the
additional index on their next open; the index also consumes additional disk space.

`measure.mjs` now uses the gate's parallel nextest runner for every core executable
test, followed by all core doctests even after a failure. Compilation remains inside
the measured step. No tests moved or were deleted. The workspace gained one test
(498 → 499). The measurement also builds `snapback2-media`: the previous main-binary-only
build left fresh release trees unable to boot the chat template (`E_ASSET_NOT_READY`).

The gate exposed an O4-web fixture race: its offline video test unmounted as soon as
the request started, aborting prefetch before the bytes committed. It now awaits the
two durable cache writes before unmounting, rather than polling after aborting the
write. The offline rendering and no-network assertions remain intact.

### Measurements — loaded, not quiet

Quiet-machine qualification was unavailable. The host reports 18 available CPUs;
observed one-minute load reached 87.68. Other processes were not stopped. These are
diagnostic measurements, not a quiet-machine pass or evidence for a budget re-baseline.
All nine records were appended by `node scripts/measure.mjs --check`, never hand-written.

| Run | Initial 1-minute load | Core before | Doctor first before | Final initial load | Core final | Doctor first final | Check final | Chat test final |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 20.17 | 45.23 s | 0.651 s | 36.22 | 36.68 s | 1.496 s | 0.951 s | 26.292 s |
| 2 | 21.50 | 33.04 s | 0.511 s | 34.67 | 30.15 s | 0.558 s | 0.917 s | 29.253 s |
| 3 | 14.67 | 30.44 s | 0.370 s | 22.26 | 35.07 s | 1.202 s | 1.348 s | 30.393 s |

The intermediate index-only/serial-runner core samples were 54.65 / 35.93 / 85.67 s
(initial loads 15.61 / 18.96 / 82.18). Final nextest execution alone was
10.387 / 8.784 / 12.778 s, with **226/226 core tests passing** each time; the balance
of each measured core step includes compilation, discovery/launch, and doctests.

The measured core step never included the owner or package suites. Before the fix,
the slowest of the 20 core asset tests was 0.093 s median (LLP 1006 A); the slowest
of 15 offline owner tests was 2.555 s (LLP 1012 O1b), and the slowest asset HTTP test
was 4.036 s (LLP 1006 B). The older chat-template runners now include O2b/O2c journeys.

Doctor's final second samples were 0.077 / 0.056 / 0.052 s, and the maximum reported
in-process work per pair was 69.84 / 50.72 / 52.89 ms. The dominant first-sample delay
is outside that reported work; process launch/loading is a suspect, not a proven
dyld diagnosis. This invocation has no project store to open. Between `9c9bf7cb1`
and `ee82e5aae`, doctor added the cached-project media probe, which is skipped here;
release binary size grew from 9,129,632 to 10,539,616 bytes (historical measurement
records). No doctor work was deferred without evidence that it causes the delay.

### Remaining to close

- Three genuinely quiet measurements. All final core and first-doctor samples remain
  over their budgets; the third also exceeds `check` (1 s) and chat-template test
  (30 s). No budget was changed and no re-baseline is proposed from loaded samples.
- Quiet first-doctor reproduction/investigation; the 0.370 s baseline sample shows
  this is intermittent in the current environment, not a demonstrated fixed boot cost.
- Run `cargo build && scripts/test.sh` outside the sandbox with the real Node 24.18.0
  on PATH. The two `E_OWNER_STOP_TIMEOUT` tests fail before and after the change in
  this sandbox. Full verification details and the before/after slowest-test tables
  are in the lane report; raw logs/JUnit are in `snapback2/target/loop-budget/`.
- Root caps is also inherited red: it counts
  `crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs` at 1,504 lines and
  205 oversize files against the 204 baseline. That file is byte-identical to HEAD
  and outside this lane's authorized `snapback2/` scope.
- An unrelated chat-screen test reported `E_OFFLINE_CARRIER: Node file range store
  is not open` once during the loaded package rerun. Its isolated rerun passed,
  as did the final complete 95-test package step; the intermittent failure's cause
  remains unproven and is not classified as a sandbox artifact.

Final affected verification: package 95/95; evaluator 160/160; compiler typecheck
and 304/304 checks; workspace Rust 497/499 with only the two named sandbox-suspect
owner-stop failures; all workspace doctests pass. The full command before the
asset-fixture correction exited 1 (283.58 s under load); its entire affected
package step was rerun after the correction. `bun src/test.ts` in the touched
package exits 0. `./ref-check --verbose` is clean: 405 LLP docs, 7,497 refs,
15,442 files, 0 errors, 0 unchecked. The compiler F9 check passed here.

## Review notes on the landed index (grok, Muse, astra; 2026-09-04 afternoon)

- `CREATE INDEX IF NOT EXISTS index_entries_by_row` runs on every open inside the store's
  exclusive open transaction, so the first open of an existing populated store pays the index
  build under the lock (a one-time migration cost per store; measure it at Clique scale before
  the offline bar's cold-start number is recorded).
- No test proves the other query plans stayed put after the index; the SQL-plan regression
  test covers the paths it names only. Add plan assertions for the cleanup path and one hot
  read.
- Write amplification on every commit is real and accepted for the 10 k-message win.
- The `measure.mjs` change (the core step through nextest + doctests instead of serial
  `cargo test -p snapback2-core`) changes the ruler; it stays on branch `s2/loop-budget`
  until the author rules, and any re-baseline follows three quiet measurements.

## Author ruling (2026-09-04 afternoon)

The core-test step is measured through nextest (parallel, the gate's own runner) plus the
doctests, with compilation still timed — "yes, this is fine for now". The 30 s budget is
re-baselined only after three quiet measurements once the day's lanes finish; until then the
step's red is known and this ticket stays open for that re-measure. The nine loaded-machine
records the lane produced were not appended to `metrics/loop.jsonl` (they are in the table
above); the first records under the new runner will be the quiet triplicate.

## Resolution, 2026-09-04

The landed `(table_name, row_id)` access path removed the repeated index-entry
scan. The measured core step retains all executable tests through the canonical
nextest runner and then runs all doctests; no test was moved, deleted, or
skipped. The review's plan-stability gap is also closed: the regression test
now proves both the cleanup seek and the existing `index_entries_lookup` point
read on new and reopened stores.

Quiet reproduction isolated the remaining first-`doctor` delay to measurement
artifact identity. On macOS, each no-op Cargo build replaced
`target/release/snapback2` with a new inode even when its SHA-256 was unchanged.
The first execution of that replacement took 0.398–0.659 s while the next took
0.023–0.031 s; `doctor` itself reported 55–58 ms. A generic `version` invocation
paid the same first-execution delay, excluding doctor, store, compiler, and
media work as its cause.

The measurement runner now retains the prior executable inode after warm and
mtime-only incremental builds only when the newly built bytes are identical.
Changed output keeps Cargo's new artifact, so a real changed-binary launch cost
remains measured. The self-test proves both branches and the measured build
times include this handling.

The author-ruled quiet triplicate ran on an otherwise idle 10-core M4 host at
initial one-minute loads 1.57, 4.30, and 3.19. Every scored step passed without
changing either budget, and the executable inode remained stable through every
run:

| run | core tests | `doctor` first / second | project check | chat test |
|---|---:|---:|---:|---:|
| 1 | 15.14 s | 0.122 / 0.027 s | 0.429 s | 24.893 s |
| 2 | 15.18 s | 0.125 / 0.025 s | 0.439 s | 25.054 s |
| 3 | 14.88 s | 0.127 / 0.026 s | 0.422 s | 25.230 s |

The three generated records are the first canonical metrics under the corrected
runner and are appended to `snapback2/metrics/loop.jsonl`.
