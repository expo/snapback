# FDL round 0 — descriptor limits, 2026-10-02

Branch `sb4-intent/fdl-fd-limit`; base `1687b58af2`, including CT merge
`67191e220d`. Linux host `expose-builder-pixel` (eb1000), 96 available CPUs;
inherited soft/hard NOFILE 1,024 / 1,048,576. Nothing pushed or published.

## Finding and change

The baseline needs more than 1,024 descriptors because libtest runs many
servers concurrently. In a measured whole-process run at soft 4,096, all 234
active tests passed (four existing ignores), and `/proc/<pid>/fd` peaked at
1,197 entries with 96 tests active. The peak snapshot includes 987 socket
handles. The same suite at soft 1,024 failed five tests, including an unchecked
socket clone panic with EMFILE. Its sampled peak of 956 is a lower bound: a
10 ms sampler misses shorter exhaustion bursts. Serial execution passed with
a peak of 249; late quiet intervals returned to three descriptors. No lasting
socket, pooled-request, or SQLite descriptor leak was found in these observed
workloads; this was not an hours-long soak. Idle pooled jobs
are consumed (`FnOnce`), request guards release permits, and the ephemeral
publisher holds a weak owner reference. The new repeated lifecycle regression
also checks weak engine/admission owners and a return to its initial fd count.

Each bounded tiny_http connection owns a deadline socket, read/write halves
and an abort socket. Previously every request cloned another abort socket.
The baseline peak snapshot has 987 socket descriptors across 382 socket inodes; 149 inodes each have five descriptors. A patched snapshot has 144 inodes with four descriptors each. These are legitimate overlapping owners, not leaked handles. Requests now
share the connection's abort handle, avoiding one OS descriptor per active
request and making keep-alive request parsing independent of `dup` success.
The remaining connection clones propagate I/O errors; intake closes that
connection, releases the admission lease and continues accepting.

`dev` and `serve` now attempt once to raise soft RLIMIT_NOFILE to
`min(hard, 65536, platform ceiling)`, preserving an already higher soft limit.
The hard limit and all HTTP admission caps stay unchanged. Darwin's ceiling
is the smaller of OPEN_MAX (10,240) and `kern.maxfilesperproc`; if the sysctl
cannot be read, OPEN_MAX is the fallback. The current soft limit returned by
`sysconf(_SC_OPEN_MAX)` is deliberately not used as the ceiling. References:
[Apple's OPEN_MAX declaration](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/syslimits.h)
and [XNU's resource-limit implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_resource.c).

A failed raise is nonfatal and appears once in the startup line with its OS
cause. Live dev `doctor` reports the server's startup attempt separately from
its own process limits; offline doctor only observes. The shared unit-test
helpers call the same initialization through a Once before creating listeners.

## Orientation and constraints

Used `llp-orient` from the existing sibling checkout because this worktree's
`skills/llp-orient` symlink targets an uninitialized submodule. Read the Snapback
4 fence, NOT-DOING, journal tail, LLP 3000, LLP 2000.000, the adopted rules,
and the assets guide's admission text. Scope: host limits, tiny_http connection
construction, server test helpers, doctor, and the covering documentation.
The binding policy is [LLP 3000 §7](../../../llp/3000-snapback4.explainer.md#http-overload-diagnostics)
and its [request-pool policy](../../../llp/3000-snapback4.explainer.md#contended-read-serving).
Admission stays at 128 connections, two uploads, and the existing per-class
request limits. Startup cannot become contingent on raising an OS limit.
No core/device semantics or wasm budget change. LLP 3000 and the guide are
updated with the code. No new LLP or process gate is introduced.

## Measurement method

`profile.py BINARY PREFIX SOFT [libtest arguments...]` preserves the hard
limit, sets only the child's soft limit, and samples `/proc/<pid>/fd` and task
counts every 10 ms. It captures libtest JSON events using
`RUSTC_BOOTSTRAP=1 -Z unstable-options --format=json`; test scheduling and counts
are unchanged. JSON files retain command arguments, executable hash, per-test
process peaks, peak fd targets and suite result. CSV files retain the complete
sample series. Descriptors in subprocesses are not included in the parent count.
Snapshots race descriptor close/open and are descriptive, not atomic censuses.

`baseline-per-test.csv` gives each test's process peak in the serial suite;
there is no overlap between active tests, but detached cleanup can overlap the
next test briefly. Representative peaks: atomic feed adoption 249, saturated
legacy waits 208, saturated mutation admission 207, full poll admission 106,
route wait capacity 100. The repeated many-server regression runs alone in a
child starting at soft 256, holds more than 1,024 descriptors, drains every
connection, drops engines/admission, and returns to its initial descriptor
count for three cycles. It also verifies that the hard limit is unchanged.

## Qualification

All affected final checks pass: 2 descriptor-policy unit tests, 2 HTTP streaming tests, the three-stage EMFILE regression, 27 lifecycle tests, the repeated many-server regression, and 110 guide tests. Each affected command and the guide started with soft 1,024. The exact host-limit module type-checks for aarch64-apple-darwin; macOS runtime execution was not available on this Linux host.

The required direct whole-binary matrix, using a stable executable copy after builds drained, is below. Each cell includes all tests in one process and four existing ignores. Hard NOFILE remains 1,048,576. No valid patched run observed EMFILE.

| Run | Soft 1,024 | Soft 256 |
|---|---|---|
| 1 | 237 passed, 0 failed | 237 passed, 0 failed |
| 2 | 236 passed, 1 failed; baseline witness lock | 236 passed, 1 failed; baseline witness lock |
| 3 | 237 passed, 0 failed | 237 passed, 0 failed |
| 4 | 237 passed, 0 failed | 236 passed, 1 failed; baseline witness lock |
| 5 | 237 passed, 0 failed | 237 passed, 0 failed |

These `commit-*` runs use SHA-256 `04d8f011227990c199aa015890135628c55ffebd6619427012d8ec9a32baa3db`, exactly the binary built and passed by the complete suite. Run times are 6.5–7.4 seconds including observation overhead. All three failures are the same baseline witness-lock refusal; none is a descriptor failure.

[RESULTS.md](RESULTS.md) records every exploratory, baseline, serial and final attempt, with exact times, fd peaks and links to raw logs. [FAILURES.md](FAILURES.md) enumerates every failed test and classification. The witness failure reproduces in the unmodified baseline at soft 4,096; it is tracked in [this filesystem issue](../../../issues/20261002-snapback4-unit-witness-owner-race.md). The timing assertions pass in isolated baseline and patched controls; contention remains a limitation of those tests.

The full `scripts/test.sh` invocation started with shell soft 1,024. Node can raise its own inherited limit, so the direct executable matrix independently enforces both requested low entry limits. The suite ran **once**, exited 0, and printed exactly **`== 0 failure(s) in 1506 s`**. Every category passed: all Rust targets and doctests (including binary 237/0 with four ignores, lifecycle 27/0 and guide 110/0), fixture checks, both app typechecks, 5,768 client tests with ten skips, and all 79 final models. There are **no full-suite failures** to classify. See [full-suite.log](full-suite.log) and [full-suite-environment.log](full-suite-environment.log).

Wasm from that suite: **2,032,879 B raw / 610,171 B gzip**, against the unchanged **610,782 B** ratchet, leaving **611 B**. This lane changes no device source or budget; no independently measured byte delta is claimed.

Doctor uses its existing live-dev inspection path. `doctor --release` retains its existing offline behavior; the `serve` process reports its attempt in its startup log. This change does not add a production inspection endpoint.

## Failure ledger

All attempts, including invalid measurement attempts, are retained. Baseline
failures, environmental timing failures and our harness mistakes are not merged
into a green result. Detailed result tables follow.

Final reference audit: 525 LLP documents, 10,084 references, zero errors or unchecked references (`ref-check-final.log`). Source/document whitespace checks pass; raw libtest logs retain their original trailing blank lines, which produce nine `git diff --check` blank-at-EOF warnings when raw logs are included.


## Round 1 — review corrections, 2026-10-02

Base `f3870cd985`, same branch and Linux lane. Both complete round-0 reviews
are retained: [Astra](round1/astra-round0.md) and [Grok](round1/grok-round0.md).
The scope remains host limits, transport construction, tests and their docs.
`llp-orient` used the existing sibling skill at
`/home/ccheever/lanes/landingA/vendor/llp/skills/llp-orient/SKILL.md` because
this lane's submodule link is uninitialized. Governing policy remains
LLP 3000 (in `current/`, not `foundation/`), especially
[HTTP overload diagnostics](../../../llp/3000-snapback4.explainer.md#http-overload-diagnostics)
and [contended read serving](../../../llp/3000-snapback4.explainer.md#contended-read-serving).
The guide's current assets card was read before editing. Admission caps,
nonfatal startup and the Snapback 4 fence bind; no core/device or publication
change. Open risk: low hard limits still constrain available resources.
Doc updates: this report, LLP 3000 §7, assets guide, vendor patch record and
one append-only journal entry. Orientation hand-off: none.

### Changes

- Intake backs off after EMFILE/ENFILE from `accept()` or any of the three
  clone stages. The delay starts at 1 ms, doubles to 100 ms and resets after
  full connection construction. Failed connections and their leases drop
  before sleeping. Retrying accept exhaustion also covers zero free slots.
  Other listener errors retain `E_HTTP_LISTENER`.
- A process-wide saturating `descriptor_exhaustions` counter appears in live
  doctor's server description and as `fileDescriptors.descriptorExhaustions`
  in `/dev/status`. It counts failed attempts, including accept calls that
  could not obtain a socket. Clone failures close transports; they do not send
  an admission refusal or increment the admission counters.
- Startup and doctor show effective soft/hard limits. Below 2,048 they warn
  with the operator remedy, including soft=hard=1,024 without a setter call.
  The threshold leaves headroom above measured parallel test demand of 1,197;
  it is not a claim that every single dev server requires 1,197 or 2,048.
- Direct test listeners now initialize independently: HTTP and EMFILE
  integration binaries, constrained latency sockets, overload helpers, and
  replay/token/witness mocks. Process tests use child dev/serve initialization.
  Every relevant helper initializes before its own listener; no test ordering
  is required. Intentional EMFILE tests lower limits afterward in isolated
  children. Hard limits and HTTP admission limits are unchanged.

### Scope and operator evidence

Descriptor stability was measured over observed workloads, not hours.
Astra's round-0 probe served **38,400 keep-alive requests in 30 cycles**;
descriptors rose from **12 to 268 and returned to 12**, including idle expiry.
The original three-cycle multi-server test and parallel-suite measurements
remain additional scoped evidence. The pre-existing witness failure remains
tracked by the original issue; this round does not repair or reinterpret it.

The operator supplied native macOS evidence on **f3870cd985**: on the office
M1, `ulimit -Hn` was **unlimited**, launchd's soft limit was **256**, and
`kern.maxfilesperproc` was **245,760**. The binary's whole unit suite started
at soft **256** and passed **238/238 in three of three runs**. These are the
operator's round-0 runtime results, not new Mac runs performed from this Linux
lane or evidence for round 1's Linux-only CPU regression.

Child processes inherit the server's raised soft limit and unchanged hard
limit. Astra measured the server/watchdog at **65,536** and Node at
**1,048,576** after Node's own raise. Node may raise its own soft limit up to
the hard limit; the server's 65,536 target does not cap the process tree.

### Qualification

The Linux backlog regression uses an independent parent to keep replenishing
the child's TCP backlog. The child fills its descriptor table to EMFILE and
frees 0/1/2/3 slots (accept, deadline clone, read/write split, abort clone),
then measures the accept thread's POSIX CPU clock for one wall second. It
checks separate exhaustion/admission counters and serves a real HTTP request
after restoring descriptors. A 100 ms CPU bound and at most 32 attempts refuse
a spin even if host contention slows the producer. The positive run and
sleep-removal control show:

| Free slots / failure site | Backoff: accept CPU in 1 s | Backoff: attempts | No sleep: accept CPU in 1 s | No sleep: attempts |
| --- | ---: | ---: | ---: | ---: |
| 0 / accept | 0.354 ms | 16 | 1,000.093 ms | 1,979,922 |
| 1 / deadline clone | 1.162 ms | 16 | 543.976 ms | 24,216 |
| 2 / read/write split | 1.760 ms | 16 | 598.837 ms | 24,800 |
| 3 / abort clone | 1.900 ms | 16 | 703.394 ms | 25,296 |

Positive evidence: [final affected run](round1/affected-final.log). Negative evidence:
[sleep-removal control](round1/backoff-negative.log), exit 101 with all four
child cases detected. The earlier [development run](round1/emfile-development.log)
also passes. These are short exhaustion/recovery regressions, not long-duration
stability measurements.

The direct affected command is `cargo test --no-fail-fast -p snapback4
--bin snapback4 --test http --test http_emfile --test lifecycle --test replay
--test token_live --test witness --test latency -- --nocapture`. The guide
command is `cargo test -p snapback4-lang --test guide`. Both start from a shell
at soft 1,024; the final guide passes 110/110. [Environment](round1/environment.log).
The [final direct affected run](round1/affected-final.log), after the guide
paragraph correction and complete suite, exited 0: **342 passed, zero failed**
and four existing ignores across eight targets. Counts: binary 238, HTTP 5,
EMFILE 5, latency 12, lifecycle 27, replay 18, token-live 16 and witness 21.
The shared host-limit module contributes three policy tests to each included
integration binary. The [earlier affected run](round1/affected.log) also passed
before the guide paragraph placement was corrected; it remains separate.

Final reference audit: **525 LLP documents, 10,085 references, zero errors
or unchecked references**. Source/document whitespace checks pass. Raw test
logs preserve libtest's trailing blank lines.

Every failed attempt is classified in [the round-1 ledger](round1/FAILURES.md),
including the detected sleep mutation, corrected guide regression and early
interrupted suite. The one **complete final-source** `bash scripts/test.sh`
invocation started from shell soft **1,024**, hard **1,048,576**, exited **0**,
and printed exactly **`== 0 failure(s) in 1634 s`**. All Rust targets/doctests
(including binary **238 passed, 0 failed, four ignored**), fixture checks,
both app typechecks, **5,768 client tests** (ten skipped), and **79 final models**
passed. **No final full-suite failures**, whether ours, baseline or environmental.
See [full log](round1/full-suite.log), [entry limits](round1/full-suite-environment.log)
and [exit status](round1/full-suite.exit). The earlier interrupted attempt is
explicitly separate, not hidden or counted as a completed run.

Wasm remains **2,032,879 B raw / 610,171 B gzip**, against the unchanged
**610,782 B** budget (611 B headroom). No device source changed. The
[final source hashes](round1/final-source-hashes.json) were verified unchanged
through the complete suite; [artifact hashes](round1/artifact-hashes.txt)
identify the CLI and affected test binaries. Nothing pushed or published.

## Round 2 — doctor remediation and UDP probes, 2026-10-02

Base **00a96f16b7**, branch `sb4-intent/fdl-fd-limit`. Both round-1 reviews
were READY WITH CHANGES. This round closes their unnecessary doctor restart
advice and Astra's two UDP probe initialization gaps. Earlier sections remain
the record of those revisions; the doctor rule below is the current behavior.

### Changes and scope

Doctor uses the live server's reported effective descriptor limits when present,
without adding a warning based on doctor's own process. Without a live report,
it labels its limits as inherited and explains the startup raise using the same
target calculation as the server. Soft **1,024**, hard **1,048,576** gives target
**65,536**, informationally, with no `E_HTTP_LIMIT` or restart instruction.
Soft = hard = **1,024** still warns and names the hard-limit remedy. A platform
ceiling below **2,048** names the host ceiling instead. A live server below the
recommendation reports its effective value; if its hard/platform limits permit
a raise, it directs inspection of the startup adjustment failure. Failed setters
continue to report their OS cause, and startup remains nonfatal.

Unit tests cover the Linux default, the hard cap, live effective limits,
macOS's **10,240 OPEN_MAX** target, a lower host ceiling, and preservation of an
already higher soft limit. The live process regression deliberately caps doctor
itself at soft = hard = **1,024** while inspecting the independently initialized
server. Offline subprocess checks cover inherited soft **1,024** with both the
host's high hard limit and a hard cap of **1,024**. These tests also assert that
offline doctor never performs the startup adjustment. macOS ceilings are tested
as pure policy inputs on Linux; no new native macOS execution is claimed.

Both UDP interface probes (`tests/latency.rs` and `tests/token_live.rs`) now
call the shared initializer before binding. Listener setup and these UDP probes
are independent of test order. No admission, backoff, socket ownership, hard
limit, device behavior or wasm budget changes. LLP 3000 §7 and the tested guide
state the corrected doctor rule; one journal entry records this round.

### Qualification

All commands run from `snapback4/`; each test invocation starts in a shell with
soft **1,024**, hard **1,048,576**. [Environment](round2/environment.log).

```sh
ulimit -Sn 1024
cargo test --no-fail-fast -p snapback4 --bin snapback4 --test http \
  --test http_emfile --test lifecycle --test replay --test token_live \
  --test witness --test latency -- --nocapture
cargo test -p snapback4-lang --test guide
bash scripts/test.sh
```

The [affected run](round2/affected.log) exits **0**: **373 passed, zero failed,
four existing ignores** across eight targets. Counts: binary 242, HTTP 9,
EMFILE 9, latency 19, lifecycle 27, replay 22, token-live 20, witness 25.
The shared module contributes seven policy tests to each included integration
binary. Four EMFILE child invocations are included in their parent regression,
not counted again. The [guide](round2/guide.log) exits **0**, **110/110 passed**.

The single final-source full suite exits **1** and prints exactly
**`== 1 failure(s) in 1803 s`**, followed by **`client tests`**. All Rust
targets/doctests (binary **242 passed, zero failed, four ignored**), build/budget
checks, fixture checks, package/app typechecks and **79 final models** pass.
Client tests report **5,766 passed, two failed, ten skipped**: one failed child
and its parent, from the same baseline fixture defect described below. No test
failure is attributed to this change or to the environment. The suite's wall
time includes diagnosis and cleanup of the leaked fixture, not just test work.
The invocation is retained in [full-suite.log](round2/full-suite.log), with its
[entry limits](round2/full-suite-environment.log) and [exit status](round2/full-suite.exit).
[Source hashes](round2/final-source-hashes.json) identify every changed Rust
source, including the guide and tests; all six hashes match after the suite.
The shell entry limit is the claim;
Node and child processes retain the inherited/raised behavior described above.
Every failure is classified in [the round-2 ledger](round2/FAILURES.md).
The reference audit passes: **525 LLP documents, 10,085 references, zero errors
or unchecked references**. Wasm remains **2,032,879 B raw / 610,171 B gzip**,
611 B below the unchanged **610,782 B** budget. [Artifact hashes](round2/artifact-hashes.txt)
identify the built CLI and wasm. Source and document whitespace checks pass.
Nothing pushed or published.

### Full-suite failure attribution

The client category reports two failed tests from **one baseline fixture race**:
`a hide during the startup probe waits for its observed-replacement decision`,
and its parent `web admission review: recovery and transport respect the session
boundary`. `replacementFor` at `web-admission-review.test.mjs:321` copies identity
rows into a live replacement server's SQLite database. Its direct Node SQLite
write raced the server writer and threw `ERR_SQLITE_ERROR`, errcode **5**,
**database is locked**. The browser review finished in **121.665 s**, but the
failed setup leaked its replacement server, preventing its Node process from
exiting and withholding its failure from the suite reporter.

The [stall record](round2/full-suite-stall.log) shows the browser and page listener
gone, no active server connections, and only the replacement child still alive.
Both Node and the server had soft/hard **1,048,576 / 1,048,576**; this was not
descriptor exhaustion. After verifying suite ancestry, executable and cwd,
only that leftover fixture (PID **1868381**) received SIGTERM. Its parent then
emitted the already-failed child test and the suite continued to its models.
The cleanup intervention and time spent diagnosing the stall are included in
the full suite's wall time. No failed test was rerun, dropped or made to pass.

The entire browser test file is byte-identical to **00a96f16b7**. A separate
[controlled counterexample](round2/baseline-lock-repro.log) executes that exact
baseline helper with a SQLite writer lock held by another connection. It asserts
the same error and confirms that replacement cleanup never runs. It exits **0**;
it is not a second full-suite run or a reproduction of the uncontrolled race's
frequency. Both the lock race and cleanup leak are **baseline test-harness
defects**, ticketed in
[`issues/closed/20261002-snapback4-browser-replacement-fixture-lock-cleanup.md`](../../../issues/closed/20261002-snapback4-browser-replacement-fixture-lock-cleanup.md).
There are no failures attributed to round-2 code. The unrelated unavailable
orientation-file lookup is classified separately as environmental in the ledger.
