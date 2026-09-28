# Lane FU — fresh replay uploads, 2026-09-28

Snapback has an overload-diagnostics defect. The reproduced upload failure is
connection admission saturation, not a failed temporary asset store or a dead
server. A builder setting also matters: accepting zero-wait `pending` writes as
settled floods the unchanged 128-connection cap. The old server silently resets
excess connections, and the old SDK calls the resulting socket error “the server
is unreachable.” The fix sends/logs a coded admission refusal without increasing
any limit or allocating another request worker.

## Evidence and attribution

First command: `git fetch origin && git merge origin/main` (already up to date).
Base and pin hashes are in [inputs.json](inputs.json). Branch:
`sb4-intent/fu-fresh-replay-uploads`. The source comparative packet was only read;
its lane, installed packages, program, fixtures, and instrument were copied into
this worktree. No hard links. No npm re-resolution. Both SDK and Linux binary
are the builder's installed `0.4.7` bytes. Only supervision/instrumentation of the
copied replay launcher changed: directly spawn the installed binary, preserve
stdout/stderr, sample `/proc/PID/fd`, record the real child's exit, and probe it
before intentional shutdown. This removes `npx`'s unobserved process wrapper.

The packet retains Expo logs but no backend stdout/stderr or backend exit status
for the two original scale attempts. Its recorded killed PIDs are not evidence
of an earlier server crash. The exact original shell environment is not retained.

The script has an important ESM ordering issue: it statically imports
`replay-adapter.mjs` before assigning `SNAPBACK_REPLAY_WAIT=0` and
`SNAPBACK_REPLAY_ADMIT_PENDING=1`. The adapter captures these variables during
import, defaulting to 120 seconds and refusing pending receipts. Consequently,
running the checked-in script with unset variables differs from exporting those
two intended fast-replay settings before starting Node.

| Published binary run | Result |
| --- | --- |
| Script with unset replay variables; `--fresh --replay` | **Pass: all 167,157 scale actions**, zero failed actions, both checkpoint hashes match; 883.114 seconds. Server remained alive until supervised SIGTERM (exit 143). |
| Export `SNAPBACK_REPLAY_WAIT=0 SNAPBACK_REPLAY_ADMIT_PENDING=1`; `--fresh --replay` | Reproduced after the identical 10% checkpoint, settledPrefix field 24,777, SHA `f1f4abf9f2178b039c44db6b3acb17d4e0019faad81f8839339ad6b26467dbba`; 43.222 seconds; upload `media/img-01.png` reported unreachable. |
| Fixed production server + published SDK, exported zero-wait flags | Intentionally still overloaded: fails in 33.046 seconds before the first checkpoint on img-05. Server logs `E_RATE_LIMIT`, one upload receives HTTP 503 with the correct refusal, 13 upload attempts lose the reply with `UND_ERR_SOCKET`. The unchanged published SDK still calls the final reset unreachable. |
| Fixed production server + fixed asset module, exported zero-wait flags | Still overloaded; fails in about 28 seconds before 10% on img-02. The client now says `the asset transfer failed: UND_ERR_SOCKET; check the connection and server logs before retrying`. The server logs the real 128-connection saturation, stays alive, answers HTTP 401, and exits 143 only on requested shutdown. |

The fourth run overlays only the built `assets.js` from this change in a separate
copy of the published SDK; all other package files/pins remain the same. It is
a diagnostic comparison, not a passing scale claim. The copied work is retained
under ignored `snapback4/target/fu-work/`; paths in the raw captures reflect its
original worktree-local `.fu-work/` location.
The fixed server uses `cargo build -p snapback4 --profile production` with
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`, matching packaged SQLite
policy. Its digest and the SDK overlay digest are in
[fixed-artifact-sha256.txt](fixed-artifact-sha256.txt).

The positive control uses the exact lane adapter and its receipt, not a separate
full-state invariant scorer. No claim of independently rechecking all final
application rows is made. Its descriptor peak was 29; it recorded no fetch
errors. The fixed-server stress run also logs `NOT_MEMBER` from writes submitted
before prior actors' pending membership writes settled: another reason the
zero-wait driver's consumed-action count is not a valid settlement claim.

The reproduced file is img-01 rather than the original img-04: socket saturation
depends on scheduling. This is the same failure mechanism/checkpoint region,
not a claim of byte-for-byte reconstruction of the unrecorded original process.
The zero-wait receipt's `settledPrefix` counts consumed actions; the adapter
explicitly accepts `pending`, so the hash proves a fixture prefix, not durable
settlement of that many writes.
For a truthful serial replay, set `SNAPBACK_REPLAY_WAIT=120` and
`SNAPBACK_REPLAY_ADMIT_PENDING=0` **before** starting Node, and collect any
remaining pending receipt with its original write ID instead of advancing a
dependent action. Do not treat a larger `ulimit` as a fix for the 128-connection
admission cap. The original lane was not edited to apply this builder repair.

In the failed run the server was alive before harness shutdown and answered
`GET /schema` with its expected unauthenticated HTTP 401. The child exited **143
only after the harness sent SIGTERM**, with its signal and thread shutdown
records. There was no panic, spontaneous exit, disk/spool error, or accept-loop
failure. Raw client failures included `UND_ERR_SOCKET: other side closed`.
Later ECONNREFUSED entries include still-pending client work after intentional
shutdown; they are not evidence the server died during the upload.

Peak sampled server descriptors: **563**, sockets **541**. The ordinary shell's
soft/hard limits are 1024/1048576, but Node raises its own soft limit to 1048576
before spawning the server; the captured server limits confirm 1048576. A low
`ulimit` is therefore not this replay's cause. Multiple descriptor handles per
connection explain why the socket-descriptor count exceeds 128. Disk had about
579 GiB free at the first check; uploads of the same fixtures succeeded before
and after the first checkpoint on the control.
`img-04.png` is only 2,081 bytes (640 × 480), below the 64 MiB request ceiling
and the program's image bounds. The fresh store used its private WAL directory
and asset directory normally; no spool or asset-size refusal was observed.

The copied instrument's `metering/r2-cell-driver.mjs` commissions the adapter and
validates its receipt through `scale-replay-evidence.mjs`; it does not implement
Snapback uploads. The adapter and original action log were retained. This work
does not rerun scoring or alter the comparative packet.

## Fix and minimal regression

- Bounded `tiny_http` admission attempts one fixed-size, nonblocking HTTP 503
  `E_RATE_LIMIT` reply, with `Retry-After: 1`, before closing an excess connection.
  No parser, worker, deferred socket queue or larger cap. The code logs the actual
  cap and remedy at most once per second. An unwritable peer can still lose this
  response; TLS without a handshake still closes without cleartext HTTP.
- The upload SDK preserves structured server refusals, including store causes.
  Invalid or missing response envelopes now return `E_HTTP_RESPONSE` naming the
  received status and unknown upload outcome. The existing retry budget remains
  restricted to explicit retryable `E_RATE_LIMIT` admission refusals. Transport
  errors retain their exception/cause rather than asserting the server died.
- Asset-store failures log their code and cause. `dev`/`serve` and `doctor`
  print connection/upload caps and local process descriptor limits. Below 1024,
  `E_HTTP_LIMIT` gives `ulimit -n 1024` and the hard-limit prerequisite. Limits are
  never raised automatically. Accept errors use `E_HTTP_LISTENER` and preserve
  the OS cause, with descriptor-exhaustion recovery advice.
- The smallest regression holds **two sockets**, with a cap of two, and checks
  the third connection gets the refusal while admission remains bounded and
  idle leases expire. It fails on the original code and passes with the fix.
  The real SDK/host test holds 128 slow-header sockets on `dev --fresh --replay`,
  receives the proper upload refusal, releases them, and successfully uploads.
  No scale rows, mutations, or fixture size are needed.

TCP reset, unread response, proxy/CORS failure, and local host errors cannot be
retrospectively identified as a particular server refusal by the client. When no
usable response reaches it, the transport cause and coded server log are the
evidence. The server's existing TLS-proxy and CORS boundaries are unchanged.

## Validation and failures

Affected client tests: **111 pass**, including upload retry/lifetime, native Blob
lifecycle and Node transport. Affected HTTP unit tests: **133 pass**, three
pre-existing ignored. Low-limit dev/doctor subprocess test: **pass**. Whole
guide: **98 pass**. Client build/typecheck, Rust dev and production builds,
`ref-check --verbose` (522 LLPs, 9,844 refs, zero errors/unchecked), and whitespace
checks pass. `scripts/test.sh` was invoked **once** after the product changes,
with command-local `ulimit -n 4096`: **0 failures in 1,336 seconds**, exit 0.
Its Rust executions pass 4,274 cases with 33 existing ignores; the main client
batch passes 4,369 with 10 existing skips, its separate acquisition/server shards
also pass, and all 79 final client model cases pass. The whole guide passes
again inside this run. The suite exceeds its nominal 60-second budget; the
existing device row-view test alone takes 459.7 seconds and existing client/model
phases take 471/283 seconds. No tests were removed or shortened. No shared shell
configuration changed. See [test-sh.log.gz](test-sh.log.gz) and
[test-sh.exit](test-sh.exit).

Failure ledger (all failures, including setup):

| Classification | Failure | Disposition |
| --- | --- | --- |
| Baseline product + builder load | Published zero-wait replay upload fails after 10%. | Reproduced; server admission diagnostics fixed. Use settled writes/bounded clients for a truthful replay. |
| Baseline SDK + builder load | Fixed server with the old SDK still fails zero-wait flooding before 10%; several `NOT_MEMBER` outcomes arise from pending cross-actor dependencies. | Server logs connection admission explicitly. A received 503 is truthful; a reset remains ambiguous. The SDK change is required to stop asserting that such transport failures mean the server is unreachable. |
| Builder load; expected overload | Fixed server and SDK still refuse/reset excess work under unbounded zero-wait submission. | Client names `UND_ERR_SOCKET`, server names `E_RATE_LIMIT`; the API capacity and retry budgets stay unchanged. No promise of accepting an unbounded pending replay. |
| Baseline product; expected negative control | Two-connection refusal regression fails on old server (closed socket, no HTTP status). | Passes with fix. |
| Baseline product; expected negative controls | Five invalid upload-envelope cases fail against copied published `assets.js`. | New client returns status-bearing `E_HTTP_RESPONSE`; no automatic resend. |
| Ours | Initial whole guide: 97 pass, one definition-registry test fails because the three new codes lacked definition/action pins. | Added pins; all 98 pass. |
| Environmental | Broad in-process HTTP tests at shell soft NOFILE=1024: 132 pass, three ignored, one adoption-concurrency test fails after OS error 24, then reset/refused secondary errors. | Same affected scope passes 133/133, three existing ignored, with a command-local soft limit of 4096. Production reproduction is a separate Node-launched process with a much higher limit. |
| Ours; artifact formatting | The first staged whitespace check rejected the kernel-padded raw `/proc` limit text. | Preserved those captures losslessly as gzip; final staged whitespace check passes. No product code changed. |
| Ours; setup only | Exploratory reads guessed nonexistent paths (`bin/`, individual assets/doctor/query-reader/transport files, and an admission-test directory); missing target/artifact files were queried before creation. | Located actual files with `rg`; no product conclusion relied on missing output. Some broad read outputs were truncated and replaced with focused reads. |

Wasm: **2,040,545 B raw / 593,008 B GNU file-input gzip-9**, budget 593,719 B,
**711 B headroom**. SHA-256
`17084d758fe1f2e5f9f86ea1f3c10e572ac46b441b7e2d1d3bd1dee9af200ac0`.
Rust 1.97.0, wasm-bindgen 0.2.127, no wasm-opt. No device/core wasm input changed;
the measured pre-fix artifact and suite artifact have the same bytes. The cap
was not changed.

## Scoped LLP orientation

Applied the repository's `llp-orient` skill read-only after initializing only
`vendor/llp` inside this worktree. Snapback 4's fence applies. Governing context:
LLP 3000 (foundation/current), LLP 2000.000 §§6/11/12, and LLP 3000.019 §3.6
(current: fresh WAL readers). Read the assets/refusals guide cards for the paved
surface. Active constraints: LLP 3000 §7's bounded/private asset I/O and bounded
HTTP admission; no extra runtime ceilings or new worker queues; preserve the
temporary WAL/read semantics of LLP 3000.019 §3.6. The uncertainty was whether
the process failed or the client conflated transport and refusal. The focused
reproduction resolves that mechanism; missing original logs limit exact historic
attribution. Updated LLP 3000's HTTP overload section and guide definitions in
the same change. Hand-off: none.

## Repeating the experiment

Copy the lane and instrument into an ignored directory within this worktree.
Place [captured-scale-replay.mjs](captured-scale-replay.mjs) at the copied lane's
`scripts/scale-replay.mjs`; keep its original adapter/program/package pins.
Create the output directory, then run from this worktree:

```sh
FU_EVIDENCE=/absolute/path/to/output SCALE_PORT=56512 \
  node --import /absolute/path/to/fetch-probe.mjs /copied/lane/scripts/scale-replay.mjs

FU_EVIDENCE=/absolute/path/to/other-output SCALE_PORT=56513 \
  SNAPBACK_REPLAY_WAIT=0 SNAPBACK_REPLAY_ADMIT_PENDING=1 \
  node --import /absolute/path/to/fetch-probe.mjs /copied/lane/scripts/scale-replay.mjs
```

For the fixed-server comparison add `FU_BIN=/absolute/path/to/snapback4`.
The output includes raw server streams, sampled descriptors, upload responses,
fetch errors if any, and the supervised child exit. The copied lane writes its
own receipt under `artifacts/`. The probe logs no request headers or tokens.
Do not count zero-wait `pending` outcomes as settled mutations.

Retained `.log`, `.stdout`, `.stderr`, `.jsonl`, and raw `/proc` limit files are losslessly compressed
as `.gz`. [reproduction-summary.json](reproduction-summary.json) indexes all four
supervised runs; each run directory retains its receipt, exit, and captures.
