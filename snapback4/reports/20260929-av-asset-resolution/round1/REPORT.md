# Lane AV — asset resolution, round 1

2026-09-29; branch `sb4-intent/av-asset-resolution`. First fetched and merged
origin/main, retaining both journal entries in its only conflict. Merge commit
`b0e693b3153143320edd2189a738399f7fb7fec9`, incoming main
`b7d05baff661db08bb99250d80b1090a8ed99346`. Nothing pushed or published.

## d-02 outcome

**Reproduced by the transient-failure mechanism. Original grader attribution
remains unproven.** Published 0.4.8 leaves a failed avatar hook permanently
non-ready for that selection, while a later hook for the same readable asset
can resolve. A settled reset/503 produces `denied`, not literal `loading`;
a hung fetch stays `loading`. The builder displays initials for every non-ready
state, hiding the denial. This accounts for the reported DOM symptom without a
new authorization grant or a special message-bubble asset scope. No failed HTTP
trace from the original grader session is available, so this does not establish
that connection pressure actually occurred in that session. The attribution
[ticket](../../../../issues/20260929-snapback4-cal26-sender-avatar-failure-unreproduced.md)
remains open.

Round 0's valid author-avatar pattern and successful fresh-store results stand.
Round 1 adds failures to that same real-browser/public-client fixture, backed by
the builder's unchanged seven Quarry files. Retention is disabled in the fault
probes so a cached avatar cannot mask a failed download. Initial avatars settle
before each probe; the local clients explicitly sync before the next scenario.

| Fault | Published 0.4.8, all three tiers | Merged main before this patch, all three tiers | Fixed client, all three tiers |
| --- | --- | --- | --- |
| One injected reset | Denied E_OFFLINE, one attempt | Denied E_OFFLINE, one attempt | Ready, two attempts |
| One 503 E_RATE_LIMIT | Denied, one attempt | Ready, two attempts | Ready, two attempts |
| Fetch never settles | Loading after 31 seconds, one attempt | Loading after 31 seconds, one attempt | Ready after 5 s timeout/backoff, two attempts |
| Forty calls, injected six-transfer cap | 6 ready, 34 denied | Online/process 36 ready; wasm 33 ready; rest exhausted | 40 ready, peak six, zero refusals |
| Four consecutive resets | No recovery for unchanged selection | No recovery for unchanged selection | Error E_OFFLINE after four attempts; reconnect/refocus restores ready |

Baseline reset/503 hook snapshots are taken after three seconds; the hung-fetch
window is 31 seconds. The absence of a later retry is also explicit in the old
hook code. Assertions in final regressions require readiness, exact attempt
counts, bounded burst concurrency, explained exhaustion and actual recovery.
Every tier additionally paints 20 DM, 20 group, 20 feed and two inbox avatars,
then passes replacement, independent handles, released-id refusal, once-view
consumption, private membership revocation and sign-out.

Evidence: `faults-048-v2.log`, `faults-main-v3.log`, `recovery-all-tiers.log`.
Main's control client was built independently from the merged HEAD sources into
`target/av-baseline-package`; the earlier partially emitted-dist control is
explicitly excluded in FAILURES.md. Published package provenance remains in the
round-0 report/manifests, using its unpacked 0.4.8 client and Linux CLI.

### Actual socket pressure

A second test opens 122 incomplete-header sockets against the unmodified host's
128-connection cap, leaving at most six slots before existing client connections,
and starts forty simultaneous `client.asset` calls. Only this test's sockets are
closed; a 500-ms timer releases pressure. No server cap or production flag changes.

| Client/server | Online | Process | Wasm |
| --- | --- | --- | --- |
| Published 0.4.8 | 4 ready, 36 resets | 3 ready, 37 resets | 3 ready, 37 resets |
| Merged main | 40 ready; 36 initial 503s | 40 ready; 37 initial 503s | 40 ready; 37 initial 503s |
| Fixed client/current host | 40 ready; 22 503s | 40 ready; 24 503s | 40 ready; 24 503s |

The short real overload clears before FU's retries expire, so main already
recovers in this witness. The sustained injected six-transfer cap above exposes
its unbounded concurrent callers exhausting those retries. Counts are observed
run results, not assumed deterministic admission order. The fixed client also
passes both avatar/fault and real-pressure suites against the **published 0.4.8
server**, including once consumption and revocation; no new server support is
required (`fixed-client-048-server.log`).

## Change and authorization boundary

`client.asset` now starts with `Range: bytes=0-`. Ordinary media can retry resets,
timeouts and transient HTTP failures; every attempt is authorized against the
current home row. The server refuses Range on a once asset before consumption.
Only that explicit E_ASSET_RANGE switches to the single non-range download;
only explicit admission refusals can retry that non-range request. An ambiguous
once failure, including body loss or local Blob construction failure, never
replays automatically. Missing, revoked, viewed and auth refusals stop.

The bounds are four attempts, exponential backoff from 250 ms with up to 25%
positive jitter, ten seconds total backoff, five seconds for each network/body
attempt and thirty seconds including admission wait. Retry-After is a minimum;
a long minimum ends the bounded call and prevents early hook recovery. Six
transfers run per client through body completion. Queued and active calls abort
on close and check credential/store lifetime before subsequent attempts. A
custom host fetch ignoring abort may physically outlive a deadline, but its late
response cannot publish a URL or retain bytes. Stream responses are canceled;
buffered native responses are closed without creating a URL, with exactly one
owner if Blob consumption already began. There is no URL/grant coalescing.

`useAsset` adds `status: "error"` with `why.code` and `why.message` for transport
and construction failures. Authorization, revocation and consumed views remain
`denied`. Safely retryable errors restart on reconnect, online, refocus or return
to a visible document. A ready handle or terminal refusal never restarts.
Raw `client.asset` keeps its existing `{ denied: why }` contract; callers can
invoke it again after connectivity returns. `assetSource` remains host-managed.

Full-file 206 bodies enter the existing cache only with an exact full-length
Content-Range and all existing current-home/store/receipt checks. Partial 206
bodies never retain. Local media expiry is reconciled before network backoff.
That last change fixes a discovered regression where delaying the first local
expiry observation allowed a late clock sample to precede it.

The media card and client manual show error separately from denial. Decisions
are recorded in LLP 3000.008.002.000 §6 and LLP 3000.019 §3.5. No contract.ts,
server authorization, device interpreter or wasm code changed.

## Round-0 reviews

Both final reviews were read. Astra: NOT READY; Grok: READY WITH CHANGES.
Their shared transport findings are addressed above. Additionally:

- Activity hide/reveal invalidates an effect-lifetime token before a revoked
  handle can be returned as ready; replacement response is held in the test.
- Initial non-null StrictMode setup defers dispatch one microtask and checks
  liveness, so the discarded setup does not consume a one-view download.
- The current request resolves before an obsolete response in the race test;
  the late response revokes its handle without overwriting current readiness.
- Unmounting one hook leaves another hook for the same id ready with a usable,
  independently owned URL.
- The guide names the actual owner tuple: client identity, signed-out bit and
  id. Account changes replace the facade; discovering a viewer does not refetch.
  Null remains empty even signed out, and offline does not refetch ready bytes.

Grok's suggestion to retry an ambiguous once download is deliberately not used:
the user's explicit once/revocation requirement and governing contract prohibit
that replay. Range provides the required safe boundary instead.

Final review inputs and hashes are retained under `input-*-review.txt.gz` and
`review-checks.json`.

## Verification

Final focused groups (overlap is intentional; counts must not be added):

- Avatar/retry/pressure/asset-list lifecycle: **66 passed**, zero failures
  (`affected-final.log`); this preceded the additional exhausted-hook probe.
- Complete avatar fixture with exhausted-hook recovery on all three tiers:
  **4 passed** (`recovery-all-tiers.log`).
- Final React review regressions and existing hook/app lifetimes: **55 passed**
  (`reviews-final.log`).
- Full/partial ranged retention: **6 passed** (`partial-retention.log`).
- Real current pressure: **4 passed**; fixed client against published server:
  **8 passed**, including all avatar lifecycle and fault cases.
- Complete guide: **98 passed** (`guide-final.log`).
- Final disposal/session/terminal/Blob checks: **83 passed**
  (`cleanup-ownership-final.log`), after the full run exposed buffered-native
  cleanup. The media-seam and await-classification reruns each pass **1/1**.
- Package build/typecheck, whitespace and reference checks pass.

The single complete `scripts/test.sh` run exited **1** with the exact summary:

```text
== 1 failure(s) in 1334 s
   client tests
```

Rust (including doctests): **4,311 passed, 0 failed, 33 ignored**. Client stage:
**4,591 passed, 5 failed, 10 skipped, 0 cancelled**. Final models: **79/79**;
fixture wrapper: **9/9**. Every other stage passed. The five client failures,
all **ours**, were:

1. `ordinary media survives a process-device offline reopen; once never persists; home changes purge bytes`
2. `every delivery await is explicitly classified`
3. `online assets revoke late credential-bound URLs across rotation, sign-out and close`
4. `in-flight assets and action are fenced without aborting effects on replacement`
5. `in-flight assets and action are fenced without aborting effects on regression`

The first two required the explained request-count and await-registry updates.
The last three exposed missing disposal of late buffered native responses and
outdated expectations of a URL being allocated before disposal. The cleanup fix
and strengthened assertions pass all 83 affected checks. No failure is classified
baseline or environmental. All failures and corrections are detailed in
FAILURES.md. This is **not** a green full-suite claim after corrections: the
complete suite ran once; affected scopes were rerun afterward. Final guide prose
also passed the entire 98-test guide separately.

Final `ref-check --verbose`: **523 LLP docs, 9,859 refs in 29,011 files,
0 errors, 0 unchecked**. Both final review inputs were rechecked before commit.

Every unsuccessful diagnostic execution, including ours, is listed in
[FAILURES.md](./FAILURES.md); no environmental exemption hides a product failure.
The full suite's inherited 60-second target remains exceeded.

Canonical rebuilt wasm: **2,040,529 B raw / 592,975 B gzip-9**, **744 B under**
the unchanged **593,719 B** cap. SHA-256:
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
See `wasm.log` and `wasm.json`; filename-bearing gzip matches build-wasm.sh.

Commands from `snapback4/` (Node v24.13.1):

```sh
bun run --cwd packages/snapback4 build
node --test packages/snapback4/test/asset-retry.test.mjs packages/snapback4/test/asset-avatars.test.mjs packages/snapback4/test/asset-pressure.test.mjs packages/snapback4/test/asset-lists.test.mjs
node --test packages/snapback4/test/react.test.mjs
AV_FAULT_CONTROL=1 AV_CLIENT_DIR="$PWD/target/av-published/package/dist" SNAPBACK4_BIN="$PWD/target/av-published/linux/package/snapback4" node --test packages/snapback4/test/asset-avatars.test.mjs packages/snapback4/test/asset-pressure.test.mjs
AV_FAULT_CONTROL=1 AV_CLIENT_DIR="$PWD/target/av-baseline-package/dist" node --test packages/snapback4/test/asset-avatars.test.mjs packages/snapback4/test/asset-pressure.test.mjs
SNAPBACK4_BIN="$PWD/target/av-published/linux/package/snapback4" node --test packages/snapback4/test/asset-avatars.test.mjs packages/snapback4/test/asset-pressure.test.mjs
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4-lang --test guide
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh
bash scripts/build-wasm.sh
```

Logs are retained as deterministic gzip after completion; read with `gzip -dc`.
Source/input hashes and the exact suite exit status accompany this report.
The local commit uses `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
