# SQ measurement tools

Run from the repository root. Node 24, Python 3, Rust 1.97 and the built local
SDK are needed. All writable state and binaries are under ignored `target/sq/`.
Never serve or change PF's retained inputs. Copy `10pct`, `50pct`, `full`,
`replay`, and `original-state.private.json` from PF first; point copied SDK,
fixture and binary symlinks into this lane. Private states stay uncommitted.

Build comparisons with `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`
and `cargo build --manifest-path snapback4/Cargo.toml --profile production
--bin snapback4 --example pf_scale_probe`. Preserve the binary before changing
anything. Build the SDK after generating/copying its wasm; final validation
uses the canonical wasm build from this tree.

`run-curves.py TAG BINARY` starts/terminates only its owned server process groups
against the three private copies. `curve.mjs` extends PF's exact SDK `read`
helper to history, both Following sizes, celebrity Following, search, Insights
and trending. It records every duration and response timing, every batch's host
load, p50 at sorted position 4 and p95=max at position 9. Nine rounds rotate
checkpoint order; three warmups precede recording. The warmup is additional to
the original builder, as in PF's protocol. No compiler/tests run during curves.

`diagnostic.py` applies temporary, opt-in instrumentation to the CLI and store;
`diagnostic.py --remove` reverses it before product tests/commit. Preserve the
instrumented production binary as `target/sq/snapback4-diagnostic`. It records
per-query sqlite3_db_status HIT/MISS/USED around actual server queries, OS thread
ID and wall-clock intervals; request arrival-to-handler queue time is logged
separately. It can vary cache_size and mmap_size on connections without changing
FULL, transaction boundaries, single writer or the automatic checkpoint policy.
No diagnostic hook is shipped as a runtime feature. The report tool is its
reproduction source. The diagnostic's stderr overhead belongs to these runs.

`cache-matrix.py` runs all six configurations through nine untraced rounds and
separate one-round `strace -f -C` (summary plus timestamped calls) runs.
`-s 0` suppresses buffer contents, including credentials. `physical.py` pairs
query intervals with their thread's pread/read/fcntl calls. Traced wall times
are diagnostic and cannot establish a latency improvement. Mmap accesses are
not CACHE_HIT/MISS events; zero misses do not mean zero page faults or disk I/O.
No OS cache is flushed. Reads at all checkpoints see warm filesystem pages.

`prepare-live.py` copies PF's replay adapter into a fresh private `live/`,
preserving actual ordered mutations, uploads, IDs, prefix/hash checks and full
`verifyScale`. It inserts same-process probes using the existing replay clients
immediately after each burst, before verification or warmup, then nine warmed
rounds. It also removes PF's deliberate stop at 50%. `live.py` runs the three
starter logs and all of scale.log through a live `dev --replay --no-watch`.
Snapshots use PF's SQLite backup tool after each verified checkpoint. The source
fixture is unchanged. The intentionally superseded first partial attempt used
subprocess immediate probes; it is retained separately and never pooled.

`queues.py` inspects pending Following delivery, unread recounts and jobs after
the warm curves; it does not claim these were the queue sizes at the final
commit. `monitor.py` samples only the recorded server PID, without changing its
state. `SQ_QUEUE` measures request queue time; existing Server-Timing `wait`
measures acquisition, not SQLite checkpoint time. Syscall busy/sleep and
checkpoint overlap evidence must be stated separately, never equated with wait.

`write-probes.mjs` emits token-free PF example inputs from private user state.
The example supports `PF_PROBES_JSON`, `PF_RUNS`, `PF_CACHE_KIB` and
`PF_MMAP_BYTES`; these are diagnostic arguments, not operator settings. It opens
read-only and reports physical work, never changing server or device policy.

`macos-curve.sh BEFORE AFTER STORE_ROOT [OUTPUT_DIR]` is the self-contained,
build-free supervisor script. STORE_ROOT has the private PF layout described
above, including replay/scripts/api-client.mjs and replay/snapback/generated.
Inputs must be quiescent. The script makes independent writable copies for both
binaries, runs the identical protocol and prints every measured read rule with
its margin. It requires the repository's SDK already built; it builds nothing.
All raw samples and loads remain in OUTPUT_DIR. `make-macos.py` regenerates the
single script from these exact tools. Credentials stay only in the private
output tree; do not commit or share that whole tree. Linux also runs this script
as an end-to-end harness check. It uses no Linux-only resource reads on macOS.

`summarize.py` retains median-of-nine batch p50/p95, max of all samples, pooled
p95 as a separate statistic, each round's frozen rule margins and a batch CSV.
The midpoint rule is always small + (full-small)*4/9; ratios always cap at 3.
A failed margin stays failed. Replay write ratios come from the unchanged
verifier's real write receipts, not from read-only curve runs.

`combine-live.py` groups the untouched immediate/warm checkpoint batches for
cross-checkpoint rule evaluation; it does not pretend replay order rotates.
`live-summary.py` checks one captured request per app read and bounds the
matched query by its client interval. `physical.py` reconstructs strace's
unfinished/resumed calls before attributing duration and lock status, and
refuses unresolved calls inside measured query intervals.

`collect-evidence.py` archives an explicit allowlist, compresses raw traces,
receipts and samples with deterministic gzip, filters server logs to numeric
SQ_BEGIN/SQ_END/SQ_QUEUE records, and emits SHA-256/byte counts in the manifest.
It never copies private state, credentials, binaries or database files. Run it
after the final validation/control so the archive includes complete logs.

The recorded live files call the hook timestamp `lastCommitAt`; it is not the
receipt settlement timestamp. `probe-delays.json` retains the actual comparison.
Future adapter output names that field `hookEnteredAt` to prevent the ambiguity.
