# Lane SE — scale evidence a builder can cite

Date: 2026-09-27. Branch: `sb4-intent/se-scale-evidence`.
Round 1 review corrections and qualification are recorded at the end; the
14,400-sample experiment below remains round 0 evidence.

The repeated final-store probes show CPU contention creating an off-CPU tail,
not a reader queue behind writes. Sixty-four settled writes before each probe
run do not reproduce that tail. Per-response development timing now distinguishes
these causes, and the bounds card supplies an executable measurement recipe.
This does **not** retroactively prove the cause of calibration #23's two failed
midpoints: those historical responses have no server or thread-CPU timings.

## Scope, orientation and provenance

First ran `git fetch origin && git merge origin/main`: already up to date at
`51b318c63c622b8e93413de42328d9b41354bc3c`. The tested CLI is current **0.4.5**,
not the calibration's 0.4.4; main already includes the GS search work. Different
hardware, build and source mean the absolute times below are not a before/after
performance claim against the M1 Max.

Applied `llp-orient` from the populated sibling vendor checkout because this
worktree's skill symlink was uninitialized. Context: Snapback 4's AGENTS and
NOT-DOING fence, LLP 3000 §§1–4/7, LLP 2000.000 §§6–7, LLP 3000.019 §§3.6–3.7,
the existing bounds/sync/residency cards, and the recent journal. Constraints:
keep bounded statistics and the independent query reservation, preserve auth,
identity and generation checks, retain the dev loopback/Host/Origin fence, no
new meter or disclosure authority, no device change or increased wasm budget.
The living documentation update is LLP 3000.019 §3.7; no new LLP is needed.

Original inputs are under `~/sb4-intent/se-evidence/` and
`~/sb4-intent/gs-store/scale-1790491840/`. Before any SQLite open, copied the
entire builder program and database **with its WAL and SHM** into a private
`target/lane-se/pristine/`, then copied that directory for each condition.
The original SQLite/WAL were never opened by a database engine, served or
modified. All 12 supplied program/store files match their initial SHA-256
hashes afterward; `original-manifest.json` records sizes and digests. The
store is 2,314,948,608 bytes plus a 13,830,872-byte WAL. Private working stores,
bearer sessions and generated files are not committed.

The production binary uses `--profile production` and packaged SQLite's
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`; its digest is in
`qualification.json`. Node 24.13.1, Bun 1.3.14, Rust 1.97.0,
wasm-bindgen 0.2.127. No tool was installed on a shared path. Worktree-local
Node/Bun symlinks select the existing tools without the optional host wasm-opt.

## Experiment and limits

Host: **expose-builder-pixel, Linux x86_64, AMD EPYC 9454, 96 logical CPUs**.
The server and its children are pinned to logical CPUs **10–19**. This is a
shared host, so (a) is a baseline with spare CPU capacity, **not an otherwise
idle whole machine**. The logs expose that limitation rather than labeling
its load average as zero. These runs cannot recreate the M1 Max scheduler.

| Condition | Setup | Whole-host 1-minute load | Assigned CPUs busy, median / p95 |
| --- | --- | ---: | ---: |
| (a) quiet control | No injected work; no lane build/test running | 13.44–13.74 / 96 CPUs | 28.2% / 46.0% |
| (b) CPU contention | Ten independent busy-loop processes, one per server CPU | 15.45–20.17 / 96 CPUs | 100% / 100% |
| (c) settled write burst | 64 sequential real `messaging.send` writes before each run | 15.30–17.49 / 96 CPUs | 24.0% / 32.6% |

Condition (b) models about ten runnable competitors over ten available CPUs;
its whole-host load is **not** claimed to equal the calibration's 8–10 on ten
cores. Load average is lagged; `/proc/stat` measures the affinity set's actual
utilization, and CPU pressure is also retained. The Node probe driver is not
pinned to this set. Only recorded child PIDs were stopped; no other lane or
process was changed.

Each private copy ran the builder's program under `dev --replay --no-watch`.
The original `scale-probes.mjs` function ran unmodified: three warm-ups, then
k=20 sequential samples for each of its eight probes, including its 49-page
cursor preparation. It used the current online SDK, real password sessions
for the fixture accounts, and the existing 50-member busy conversation.
The adapter records the SDK call's client time, the raw header, parsed server
durations, completion/cut and the contemporaneous host load per query. The
builder's own measured durations are retained separately as `builderClient`.
The copied script's hard-coded macOS deployment label is corrected in the
retained result; its sampling and assertions are unchanged.

There are **30 runs per condition**, **600 measured samples per probe per
condition**: 14,400 measured samples, 20,970 paired HTTP samples including
warm-ups/cursor preparation. Before each run the driver resets latency; after
each it reads `doctor --latency --json`. Doctor includes all 233 queries,
including warm-ups, and in (c) all 64 writes. Its operation-level `home`
histogram pools the three callers; the paired samples keep their probes apart.
No probe refused, timed out, or returned a cut. Global search's assertion
requires a complete page of exactly twenty known matches. The measurements
are observations of these repeated final-corpus probes, not an SLA.

The 1,920 writes in (c) use fresh IDs, the normal authenticated mutation path,
and text without `coffee`. Bursts settle in **0.302–0.626 s**, then the
unchanged probe sequence begins immediately. The first three reads remain
warm-ups, exactly as in the builder. This tests the aftermath of a checkpoint
burst, not sustained overlapping writers or jobs. New effects and schedules
are held by replay; each copied store has zero `_jobs` rows afterward and the
server logs record no jobs. Maintenance still runs normally. Queries still
use separate readers with fresh WAL transactions.

An initial 30-run pilot overlapped this lane's guide compilation. It is
retained in `pilot-with-guide-build/`, excluded from the quiet-control table
for that known setup difference, and followed by the full 30-run quiet repeat.
It was not discarded according to its latency results.

## Paired latency results

Nearest-rank **p95 in ms**, 600 measured samples in each row. `Client` is the
builder's call measurement; server total ends at header construction. These
are marginal percentiles, so columns must not be subtracted as though they
came from the same sample. `summary.json` also includes per-sample differences,
p50/p99/max, every round's p95 and the slowest paired samples, for all eight
probes.

| Condition | Probe | Client | Server total | Acquisition wait | Engine wall | Thread CPU |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| quiet | following500 | 3.521 | 2.429 | 0.001 | 2.218 | 2.300 |
| quiet | globalSearch | 5.086 | 4.000 | 0.001 | 3.775 | 3.839 |
| quiet | trending | 2.142 | 1.314 | 0.001 | 1.181 | 1.225 |
| cpu | following500 | 6.052 | 4.957 | 0.001 | 2.284 | 2.285 |
| cpu | globalSearch | 10.497 | 9.187 | 0.001 | 7.837 | 3.914 |
| cpu | trending | 4.728 | 3.862 | 0.001 | 1.161 | 1.195 |
| writes | following500 | 3.839 | 2.607 | 0.001 | 2.398 | 2.425 |
| writes | globalSearch | 5.266 | 4.093 | 0.001 | 3.816 | 3.871 |
| writes | trending | 2.250 | 1.338 | 0.001 | 1.194 | 1.236 |

Search CPU p95 changes only **3.839 → 3.914 ms** under contention while server
wall p95 changes **4.000 → 9.187 ms**. Its paired `server total − thread CPU`
p95 is **0.160 → 5.808 ms**. Reader wait stays at **0.001 ms**. The controlled
external CPU perturbation, saturated assigned CPUs and stable request CPU
support scheduler contention as the additional tail's cause. They do not
identify the precise kernel wait of every individual request; elapsed minus
CPU also includes I/O, admission and other blocking.

Specific paired examples (round and ordinal are zero-based; ordinals 0–2
are warm-ups):

- CPU, search, round 25 / ordinal 12: client **14.861**, server **13.828**,
  wait **0.001**, engine **11.998**, CPU **4.089** ms. Most engine wall time is
  off-CPU, without waiting to check out the reader.
- CPU, trending, round 19 / ordinal 14: client **10.912**, server **10.175**,
  wait **0.000**, engine **1.019**, CPU **1.065** ms. The extra time is largely
  outside engine ownership, consistent with dispatch/thread scheduling.
- Quiet, trending, round 9 / ordinal 8: client **12.227**, server **0.760**,
  CPU **0.689** ms. This tail is mostly outside the server's timed processing;
  it cannot be attributed to a server read queue from the client time alone.
- Post-write, search, round 11 / ordinal 12: client **9.067**, server **3.475**,
  CPU **3.355** ms. Again, most of this client outlier lies outside the server.
- Quiet's slowest search is real request work: client **6.807**, server
  **5.565**, engine **5.195**, CPU **5.318** ms. The report does not label every
  slow sample scheduler noise.

No foreground-reader blocking mechanism was found in (a) or (c), so no
scheduling or query-engine repair is claimed or added. A regression test
holds the writer lock throughout a completed file-backed HTTP read, and a
controlled pause verifies that engine wall can rise without reader wait or
thread CPU. Other tests burn CPU on the request and on a separate thread to
refuse process-wide CPU attribution.

## What the original midpoint failures establish

`calibration23-probes.json` preserves the original 10%, 50% and full samples;
`calibration23-host-load.jsonl.gz` preserves the host log. They show the
reported clustered client-time outliers. They cannot distinguish scheduler,
client, transport, engine CPU or engine waits retrospectively. Only the final
store was supplied: these new runs do **not** reconstruct historical 10% and
50% stores, modify the frozen scoring rules, or claim a newly passing growth
curve.

As a negative control, grouping consecutive **same-final-corpus** runs into
ten triples and applying the instrument's 50%-point line (weight 4/9 between
10% and 100%) fails search **5/10** and trending **4/10** times in the quiet
condition. Under contention the counts are **8/10** and **6/10**. These are
repeated equal-size controls, **not real corpus checkpoints** or a calibrated
probability estimate. They show how this small-sample rule can reject an
unchanged corpus. Per-round p95s vary even in quiet: search **3.873–6.209 ms**,
trending **1.391–2.614 ms**. The instrument remains unchanged.

## Timing implementation and disclosure

`Server-Timing` uses the [W3C header syntax](https://www.w3.org/TR/server-timing/):
`total;dur=..., wait;dur=..., engine;dur=..., cpu;dur=...`. All values are ms,
rounded to 0.001 ms, with CPU omitted if the platform clock is unavailable.
Only requests passing the existing peer/Host/Origin loopback dev fence on
a loopback-bound listener get this header, independently of CORS authorization.
Wildcard binds omit it even for a loopback peer. Route/token refusals and
pending replies that pass the timing fence carry it too. Permitted dev browser origins can read it through
`Access-Control-Expose-Headers`. `serve` never adds it, including authorized
queries and unauthorized requests. No new origin, credential or read access
is admitted. Aborted worker admission has no response/header and still counts
in the existing refused histogram.

- **Total:** HTTP acceptance after headers, before body prebuffering and
  worker admission, through header construction. JSON serialization precedes
  this stamp. Doctor's total still ends at final response write/flush, before
  unread-body cleanup. A header cannot measure future socket delivery;
  streamed assets/heartbeat polls therefore show only pre-stream work there.
- **Wait:** cumulative reader checkout/connection creation and writer lock
  acquisition, including later and failed acquisitions. This replaces the
  older acceptance-to-first-acquisition meaning, which included unrelated
  pre-handler work and missed later waits.
- **Engine:** wall time owning readers/writer for engine work, authentication
  and head reads. Nested ownership is counted once; reader acquisition suspends enclosing engine
  spans and counts only as wait. Loans end on pool
  return or drop. Held-poll sleeping is outside the spans. It includes I/O and
  descheduling while an engine is owned; it is not pure interpreter CPU.
- **CPU:** `CLOCK_THREAD_CPUTIME_ID` on Linux/macOS if available; request-worker
  CPU from worker start. Listener, maintenance, client and other-thread CPU
  are excluded. CPU overlaps wall components and must not be added to them.

Doctor has bounded total/wait/engine/CPU histograms, `cpu_n` and optional
`cpu` percentiles in JSON, and all four distributions in text. A missing CPU
clock is `null`/unavailable, never a fabricated zero. Four fixed 480-counter
histograms use 15,432 bytes per named operation (plus map/name/lock/Arc), with
no retained sample list. Snapshot/adoption/reset locking and service-only
production inspection keep their existing boundaries. Histogram error remains
at most 5%, maxima exact; raw header samples retain their own pairing.

The header contains **no counts, rows, keys, arguments, principal or result
fields**, but **phase and CPU timings reveal more than a response’s total time**.
Astra’s paired hidden-row test returned identical data and logical meters while
median CPU rose from **0.067 to 0.331 ms** with hidden payload size. Wait also
separates contention from request work. Doctor aggregates requests made by
other principals, rather than isolating the caller’s requests. These are real
additional disclosures, not merely another spelling of total duration.

Per-response phase and CPU timing is acceptable **only on loopback-bound dev**,
where the developer already holds the store and can inspect it directly; it
**never appears on serve**. The listener, peer, Host and Origin all enforce that
header boundary. Production doctor aggregate inspection is a separate existing
administrative surface and retains its live-service-credential check; it is
not exposed to ordinary application callers. No row authorization or meter
rule changes, and no constant-time or zero-additional-information claim is made.

## Builder guidance and acquisition evidence

The bounds card teaches reset → fixed warm-ups/sequential probes → doctor
JSON → paired header/client/CPU comparison → host-load recording, with the
limitations above. Its shell/Node block is extracted verbatim, run against a
real dev process by the CLI guide test, and checked for 23 paired responses
and the corresponding doctor counts. `latency`, `performance`, `p95`,
`benchmark` and `load test` all resolve to bounds. Existing Quarry guide
examples remain compiled/run by the whole guide suite.

The sync card now reports lane SS's **measured** round-2 acquisition instead
of leaving a vague pointer to residency. On SS's reported host `expo-build-1000` (shared Linux x86_64, 96 reported CPUs),
Node memory/fake-IDB cold runs (no concurrent writer) at 100/1,000 conversations
were **1.671/16.324 s** and **2.022/21.036 s**, with 15,588/110,088 rows.
Fresh Chromium 151.0.7922.34, actual IndexedDB and a live writer measured
**4.186/27.327 s**. Browser during-acquisition p95 at 1,000 is **13.158 s**
(19 samples, zero timeouts), still missing the 1 s target; after acquisition,
three warm-ups plus twenty samples gave **0.754 s**. These are cited historical
SS measurements, not new SE runs or promises. See
[SS round 2](../20260927-ss-sync-scale/ROUND2.md) and its measured companion.

## Reproduction and retained artifacts

From `snapback4/`, with the original inputs present, prepare a new private
copy (the first copy must not already exist):

```sh
mkdir -p target/lane-se
test ! -e target/lane-se/pristine
cp -a --reflink=auto ~/sb4-intent/gs-store/scale-1790491840 target/lane-se/pristine
mkdir -p target/lane-se/pristine/scripts
cp reports/20260927-se-scale-evidence/builder-scale-probes.mjs target/lane-se/pristine/scripts/scale-probes.mjs
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
export CARGO_INCREMENTAL=0 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
cargo build -p snapback4 --profile production
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
export SE_CPUS=10,11,12,13,14,15,16,17,18,19
node reports/20260927-se-scale-evidence/measure.mjs quiet 30
node reports/20260927-se-scale-evidence/measure.mjs cpu 30
node reports/20260927-se-scale-evidence/measure.mjs writes 30
python3 reports/20260927-se-scale-evidence/summarize.py
```

The driver refuses an existing condition directory; use a new private target
or move the previous one before rerunning. It expects the unchanged supplied
`scale-probes.mjs` at `pristine/scripts/scale-probes.mjs`. It never reads or
writes the original store. Run measurement conditions serially, without your
own compilation/tests. CPU burners exist only during the contention condition.

`*-samples.json.gz` retains every paired query including warm-ups and burst
metadata; `*-checkpoints.json.gz` holds every builder result and doctor JSON;
`*-host.jsonl.gz` holds one-second load/CPU/pressure samples; server logs bind
the replay mode. `summary.json` is regenerated by `summarize.py`, which reads
plain or compressed samples. The pilot is retained separately. Original input
hashes, historical samples and qualification digests are beside the report.

## Round 0 qualification

Affected checks: CLI/server/doctor unit suite **175 passed, 4 existing ignored**;
real-process latency/guide tests **10/10**; read-latency fixture's **2 existing
measurement tests ignored**. Whole guide **89/89**, repeated after two evidence-description corrections
(live-query observation and the SS host wording); runtime/test source is
unchanged throughout the full run. Exact commands:

```sh
ulimit -n 65536
export RUST_TEST_THREADS=8 SNAPBACK4_RUST_TEST_PROCESSES=8
cargo test -p snapback4 --bin snapback4 --test latency --test read_latency
cargo test -p snapback4-lang --test guide
bash scripts/test.sh
```

Ran `scripts/test.sh` **exactly once**, exit **0**. Exact summary:

```text
== 0 failure(s) in 1524 s
```

Every full-run failure: **none — ours 0, baseline 0, environmental 0**.
Rust: **4,063 passed / 29 existing ignored**, 253 binaries / 966 scheduled
executions, plus successful workspace doctests. Clients: **2,701 passed /
10 existing skips** across the main group and seven acquisition/server shards;
serial models **78/78**; fixture wrappers **9/9**. Builds, package checks,
app checks, docs budget and release guard all passed. The inherited 60-second
suite budget remains exceeded; no budget or timeout was raised.
The full log is retained in `verification/full-suite.log.gz`.

Final affected-scope reference audit: **521 LLP docs, 9,676 references,
27,481 files, 0 errors, 0 unchecked**; the exact final audit line is in
`verification/ref-check-final.log.gz`. Whitespace validation passes. Runtime and test hashes are unchanged
from the full-run inputs; only the separately rechecked sync-card prose changed.
`qualification.json` retains both source manifests.

All observed development test failures, retained in `verification/`:

1. **Ours, fixed:** first test compile required converting the newly timed
   reader back to its raw engine in `serve_sync/concurrent.rs`.
2. **Ours, fixed:** the new production-header test used a fixture with guest
   auth disabled. It now mints the fixture's existing service credential and
   verifies a successful production query has no timing header.
3. **Ours, fixed:** `failed_file_reader_refuses_without_waiting_for_the_writer`
   still asserted that failed checkout had zero old-style wait. It now checks
   that the attempted checkout is timed while engine ownership remains zero.
4. **Environmental, resolved:** the first entire server-unit invocation used
   the shell's low fd limit and default test concurrency. Four tests failed:
   `latency_release_requires_a_live_service_and_never_allows_reset` and
   `atomic_feed_launch_keeps_queries_reading_and_holds_sync_and_writes` hit
   `Too many open files`; `image_list_http_regression_with_scalar_upload_admission`
   and `route_503_is_collectible_only_after_fresh_verification_of_the_same_body`
   subsequently saw missing/blocked connections. The complete affected suite
   passed with fd limit 65,536 and eight threads. No timeouts were raised.

An early measurement setup command had the wrong relative cwd, then refused
an already-existing private directory. It produced no new measurements and
was corrected before the retained quiet repeat. No baseline product failure
is claimed from this setup error.

Wasm is **1,979,732 B raw / 572,616 B gzip**, **byte-identical** before/after,
225 B below the unchanged 572,841 B cap. SHA-256:
`dd7e63215ab75468af0039c2e7a495289d34078d6f23fd59b4ac15138ea5ba94`.
There is no device, meter, fence, authorization, schema/wire-result, dependency,
package-version or budget change. No push or publication.

## Round 1 — review corrections

First fetched and merged `origin/main` at `d9c89a971913ca995a1e5a6d436a85dc8a5d11d6`.
Merge commit `59b217892` preserves both journal appends (812 added lines against
round 0, 61 against main, zero deletions against either) and both LLP revision
histories. Read the original lane prompt, round 0 report/journal, and Astra’s
complete READY WITH CHANGES review, retained in `round1/astra-r0.md`. Grok had
only progress prose and no verdict at the initial check; did not wait for it.

Applied `llp-orient` from the populated sibling vendor skill as in round 0.
Context pack: server dispatch, response framing, reader checkout, latency and
the bounds card; governing LLP 3000 §4 (the Snapback 4 fence), LLP 2000.000 §6
(authorization/meters), and LLP 3000.019 §§3.6–3.7 (independent readers and
bounded latency, in `llp/current`). No new design authority or LLP is needed.
The open risks were inconsistent acquisition/engine intervals and finer timing
disclosure; the living §3.7 and bounds card now explicitly describe both.
Hand-off: none; the supervisor owns review of this local correction.

1. **Listener fence:** dispatch receives the actual bound listener’s loopback
   status. Timing requires it as well as dev and the existing peer/Host/Origin
   fence. A real wildcard listener test sends one loopback and one external
   interface request with the same localhost Host: both omit timing. The
   ordinary loopback request still succeeds, and the external peer is still
   refused. IPv6 unspecified listeners also fail `is_loopback()`.
2. **Acquisition:** detached checkout, direct `/changes` opens (including a
   reopen after a commit), and ephemeral pool `take` use one helper. It counts
   failed acquisitions too, suspends enclosing engine ownership during the
   open/checkout, and resumes afterward. Factory creation/replacement belongs
   to startup/adoption/maintenance, outside request sampling. Separate 150 ms
   delay regressions cover cold and reused query readers, initial changes,
   changes after a commit, and ephemeral mutations. They require the delay in
   wait and disjoint wait/engine totals; doctor’s maxima agree with the header.
3. **CORS independence:** JSON replies attach timing whether or not CORS is
   allowed; CORS controls browser exposure only. Tests cover persona refusal
   on a service route, the route’s `E_ROUTE_PENDING` 503, `/dev/token` refusal,
   ordinary action pending, and a disallowed Origin. No-CORS replies retain
   neither allow-origin nor expose-headers. Assets, heartbeat streams, empty
   replies, API/native replies and completed routes retain their own timing
   attachment. Existing stream tests now assert the timing header as well.
4. **Refresh span:** a controlled 150 ms refresh under a one-second changes
   poll must contribute at least 150 ms to engine time and leave at least
   600 ms outside wait/engine. Header and doctor both enforce it. Removing
   just the refresh span fails; enclosing the poll sleep in an engine span
   also fails. A focused run recorded engine 150.595 ms, total 1000.212 ms,
   wait 0.120 ms; this is a test delay, not workload-performance evidence.
5. **Disclosure:** the section above and one sentence in bounds explicitly
   acknowledge extra phase/CPU information, hidden-payload inference, and
   doctor’s aggregation across principals. The developer already holds the
   store; per-response evidence is restricted to loopback-bound dev and never
   emitted by serve. Production aggregate access remains service-only.

The original 14,400 measurements, paired p95s, overhead measurement and lane
SS acquisition evidence were not rerun or reinterpreted as round 1 results.
No original store was opened or modified. No device or meter code, package
version, dependency, runtime ceiling, authorization rule or budget changed.

### Regression strength and failures during development

`round1/mutations.json` and compressed logs retain all six deliberate regressions:

| Removed behavior | Failing tests |
| --- | --- |
| listener loopback check | wildcard listener: 1 |
| acquisition timing helper | query, changes, ephemeral: 3 |
| suspension of enclosing engine span | changes, ephemeral: 2 |
| timing independent of CORS | route/token/pending coverage: 1 |
| changes refresh engine span | refresh/poll attribution: 1 |
| exclusion of poll sleeping | refresh/poll attribution: 1 |

These are **ours, expected negative-control failures**, all restored before
qualification. One first attempt at the acquisition mutation returned a Rust
closure instead of invoking it, producing E0308: **ours, mutation-harness setup,
fixed**. That compile failure is retained separately and is not counted as a
successful mutation test. The corrected mutation compiles and fails all three
intended assertions. The first staged whitespace audit flagged three Markdown
hard-break spaces in the copied review: **ours, artifact formatting, fixed**
by trimming them in the readable copy. No unintentional product test failure occurred during the
affected checks. Baseline failures: none. Environmental failures: none.

### Round 1 qualification

Affected command (eight build/test threads, fd limit 65,536):
`cargo test -p snapback4 --bin snapback4 --test latency --test read_latency`:
**182 unit tests passed, 4 existing ignored; 10 real-process doctor/latency/recipe
tests passed; 2 existing read-measurement tests ignored**.
`cargo test -p snapback4-lang --test guide`: **89 passed**.
The guide’s complete shell/Node recipe runs verbatim in the latency test.
Final reference audit: **521 LLP docs, 9,709 references, 27,507 files, 0 errors,
0 unchecked**. Whitespace validation passes.

Ran `scripts/test.sh` **exactly once**, exit **0**. Exact summary:

```text
== 0 failure(s) in 1697 s
```

Every full-suite failure: **none — ours 0, baseline 0, environmental 0**.
Rust: **4,070 passed / 29 existing ignored**, 253 binaries / 966 scheduled
executions (974 s), plus **17 successful doctests**. Main client group:
**3,655 passed / 10 existing skips**, plus **56/56** acquisition/server shards
(428 s together). Serial client models: **79/79** (264 s); fixture wrappers:
**9/9**. All build, release-guard, budget and app/package checks pass. The
inherited 60-second total-suite budget remains exceeded; no timeout or budget
was raised. All runtime/test semantic inputs remain unchanged. Of **1,413**
tracked crate, package, script and Cargo inputs, **1,412** retain their pre-run
hashes; the only later edit aligns one test assertion’s indentation by four
spaces. Both hashes and that exact whitespace-only change are recorded.
The full log and input manifest are compressed under `round1/`; its
`qualification.json` records exact counts, toolchain and failures.

Wasm remains **1,979,732 B raw / 572,616 B gzip**, **byte-identical** before and
after the full suite, **225 B below** the unchanged **572,841 B** cap.
SHA-256: `dd7e63215ab75468af0039c2e7a495289d34078d6f23fd59b4ac15138ea5ba94`.
Node 24.13.1, Bun 1.3.14, Rust 1.97.0, wasm-bindgen 0.2.127, no wasm-opt;
eight Cargo build jobs/test processes/test threads, dev/test debug and
incremental off, packaged SQLite flags, fd limit 65,536. Existing worktree-local
tool selection only; **no tool installed**, and nothing installed or modified
on a shared path. Local commits carry the requested co-author trailer.
**No push or publication.**
