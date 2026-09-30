# BN round 0 — prove the envelope

`snapback4 witness acquire` now proves a chosen account with the published SDK over the native process device. It measures fresh acquisition and the first complete local query, inspects residency and persisted coverage, then closes/reopens offline and verifies the same coverage before reconnecting with zero downloaded rows. Nothing was pushed or published.

Base: `9d03e946232b4017564f3e7c6aa87bd424ce8d58`, branch `sb4-intent/bn-envelope-proof`. Design: LLP 3000.030 §13; scoped orientation: [CONTEXT.md](CONTEXT.md).

## Measured result

All **12/12** runs pass: three per account and host condition. The heaviest account retains **1,000 conversation groups and 105,034 rows**; the smaller account retains **100 conversation groups and 11,612 rows**. Every reconnect downloads **zero rows**, and every offline/reconnected coverage digest matches its acquired digest.

| CPU condition | Memberships | Acquisition median (range), s | First local inbox median, s | Cold restart median (range), s | Server sync total median, s |
| --- | ---: | ---: | ---: | ---: | ---: |
| 96 CPUs, shared host | 100 | 1.293 (1.268–1.316) | 1.300 | 0.045 (0.043–0.046) | 0.391 |
| 96 CPUs, shared host | 1,000 | 42.081 (40.892–60.976) | 42.096 | 0.270 (0.245–0.443) | 2.563 |
| 10 CPUs + 8 CPU burners | 100 | 3.805 (2.854–4.392) | 3.853 | 0.141 (0.122–0.155) | 0.927 |
| 10 CPUs + 8 CPU burners | 1,000 | 49.048 (43.742–62.762) | 49.059 | 0.394 (0.292–0.403) | 3.188 |

The native heavy acquisition median is **42.081 s** unconfined and **49.048 s**
on ten CPUs with eight burners. The proof holds under that load; identical latency
is not claimed. The shared host's one-minute load ranges were **6.32–71.48**
unconfined and **38.77–102.01** restricted. These are three-run observations,
not a p95 estimate or host-normalized throughput claim. Our builds/tests did
not overlap measurements; unrelated lanes used the host.

Host: eb1000 / expose-builder-pixel, AMD EPYC 9454, Linux x86_64
6.8.0-138-generic, Rust 1.97.0, Node 24.13.1, Bun 1.3.14. The server and
native device use the production build with
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. Both server and witness
inherit the `taskset -c 0-9` affinity in the loaded series; eight owned Node
busy-loop processes supply deliberate CPU contention and are reaped afterward.
The witness records effective CPU count and per-second load in `host.json`.

The small account occupies **21,479,424 B** of SQLite pages; the heavy account **375,209,984 B**. This is allocated
SQLite pages including free pages, excluding WAL/SHM, and is neither RSS nor
row-payload bytes. Physical residency includes staging/free-space costs; it
must not be compared directly to web logical residency. Receipts separately
retain all per-table payload bytes and row counts.

The heavy receipt's **4,014** table/group pairs include 1,000 each for
conversations, members, messages and unread, plus public/principal/other groups.
The small receipt has **413** pairs. Summed groups are not conversation counts;
`groupsByTable.conversations` and `.messages` prove the 1,000/100 dimensions.
Neither run claims to prove a particular follow count or the calibration app's UI.

HV's historical web figures are cited in the bounds guide as guidance: five-run
medians of **18.609 s default / 19.522 s Worker** to acquire the same heavy
105,034-row account, with about 307.6 MB allocated wasm memory. Its first-inbox
figures (0.441 / 0.520 s) precede whole-partition acquisition; BN deliberately
issues the timed query **after** acquisition. Native acquisition is slower here,
and these distinct first-answer definitions must not be treated as the same
latency comparison. Cold restart means new native process and SDK client with
all HTTP blocked; Node's module environment and OS file cache remain warm.
It is not iOS UI, physical-phone, media-cache or power-loss evidence.

## Receipts and reproduction

- [96 CPUs, 100 memberships](unconfined/u0500/acquire.json)
- [96 CPUs, 1,000 memberships](unconfined/u0001/acquire.json)
- [10 CPUs under load, 100 memberships](ten-cpu-loaded/u0500/acquire.json)
- [10 CPUs under load, 1,000 memberships](ten-cpu-loaded/u0001/acquire.json)
- [All samples and medians](measurements.json), [fixture identities/counts](fixture.json),
  [fixture hashes](fixture-hashes.json), [artifact hashes](artifacts.json)

The input is a private SQLite read-only backup of HV's ignored
`~/sb4-intent/lane-hv/target/hv/store-after`, served from this lane's
`target/bn-envelope/store`; HV's source was never made writable. The source
Quarry and pre-run database hashes are recorded. `dev --replay --no-watch`
holds schedules and suppresses new effects. The checked-in harness reuses HV's
synthetic fixture login; tokens are held in memory and never included in logs
or receipts. u0001 has 1,000 memberships and u0500 has 100, independently counted
from the copied membership rows before running the witness.

From repository root, after building the production CLI and SDK:

```sh
node snapback4/reports/20260930-bn-envelope-proof/measure.mjs
taskset -c 0-9 node snapback4/reports/20260930-bn-envelope-proof/measure.mjs --loaded
```

The harness runs the product command with the actual principal and a live token:

```sh
snapback4 witness acquire --as "$PRINCIPAL" --token "$TOKEN" --url "$URL" \
  --query chat.inbox --args '{"c":null}' --restart --runs 3 --timeout 300 \
  --artifacts "$NEW_DIRECTORY"
```

These paths reserve receipts exclusively; use fresh artifact directories to
repeat. The production binary's executable logic was built before only later
comment/guide wording edits; `artifacts.json` binds the exact measured binary.
The dynamically loaded helper is the final tested implementation. The complete
suite binds the final source in `source-before-suite.json`.

## Implementation and proof boundary

The Rust witness dispatch launches the helper shipped under the client's `bin/`
using its own binary as the process-device executable. The npm shim supplies
its matching helper path; direct checkout and sibling platform-package paths
also resolve. The helper uses the existing SDK acquired barrier and residency
API; it blocks server query fallback and drives explicit sync rounds, with
background change polling suppressed. Request samples preserve raw Server-Timing,
parsed per-phase fields, HTTP status, snapshot flag and put/event counts.
`serverSyncMs` sums dev's total header duration for acquisition sync requests;
serve records null. Identity preflight is included in acquisition wall time.

A native-only diagnostic scans actual per-group row counts and reads persisted
history and horizon boundaries **after** the timed answer. Its digest must match
offline and after reconnect, along with store identity, generation, watermark,
acquired state and per-table row/payload-byte counts. The new diagnostic is
excluded from wasm. Empty unbounded target groups without rows or persisted
coverage facts are not counted; the guide states what its group count means.
An empty snapshot at watermark zero is allowed only with zero events and equal
coverage, and is counted separately in the receipt. Nonempty snapshots/redownloads
cannot pass the zero-event check. Concurrent writes, expiry or generation changes
invalidate this stable-fixture proof.

Declared dev personas come from the existing fenced status endpoint. The existing
authenticated probe returns its caller's viewer, allowing mismatched/unknown
principal refusals without minting, rotating or revoking the caller's token.
Temporary stores are removed after close. Receipts exclude tokens and row bodies.
Argument failures, unavailable servers and invalid identities exit nonzero.

## Validation

Affected CLI/SDK tests: **9/9**, including actual guide-shell execution and its
receipt excerpt, fresh multi-run acquisition, offline/reconnect coverage, serve
bearer success/mismatch, input and unavailable-server refusals. Revert controls
wipe the whole store, delete a held SQLite row, alter history groups and alter
horizon boundaries **before** reopening; each rejects. Whole guide: **106/106**.
Reference validation: **525 LLPs, 9,992 refs, zero errors or unchecked refs**.
All development failures and their classifications are in [FAILURES.md](FAILURES.md).

Ran `scripts/test.sh` **exactly once**, with `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8`. Exact summary:

```text
== 1 failure(s) in 1341 s
```

Exit 1; 12 of 13 script stages passed. Rust passed **4,364** tests (including
17 doctests), with 33 existing ignores; fixture wrappers passed **9/9**;
client models passed **79/79**. The client stage counted **5,315 pass, 2 fail,
10 existing skips**: one failed assertion and its enclosing parent test.
There were zero cancelled tests. The only failing case was
`http-bounds.test.mjs`, “the liveness probe requires credentials and has an
explicit success body”: its exact JSON expectation omitted the newly returned
`viewer: "dev:alice"`. Classification: **ours**, not baseline or environmental.
The enclosing “HTTP admission, encoding, slow readers and idle changes polls”
test also counted as failed because of that child. Baseline failures: **0**;
environmental failures: **0**. Captured logs normalize trailing whitespace only. The full log and exit status are preserved in
[full-suite.log](full-suite.log) and [full-suite.exit](full-suite.exit).

After that run, updated the existing assertion to check the caller identity
alongside every previously checked field. The complete affected HTTP file then
passed **10/10**, recorded in [http-bounds-final.log](http-bounds-final.log).
All nine new witness tests also passed within the full run. The full script was
not repeated. No implementation source changed after it began; the only later
test change is that assertion, recorded with before/after hashes in
[source-final.json](source-final.json). This is a failed full run followed by
a passing affected correction, not a claim that the full run was green.
The inherited nominal 60-second suite budget remains exceeded.

Final full-suite wasm build: **1,978,828 B raw / 593,233 B gzip** against the
unchanged **593,719 B** ratchet, leaving **486 B** headroom. No budget increase.
The native-only coverage diagnostic does not enter the wasm build.

One dated journal entry records the result. The local commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Nothing pushed or published.
