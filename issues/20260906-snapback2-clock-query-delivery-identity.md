# Snapback2 clock-sensitive queries conflict on legitimate same-sequence delivery

Status: Open
Date: 2026-09-06
Scope: Snapback2 owner query envelope and persistent client delivery identity

An independent actual-native reproduction keeps one `clock.read` SSE
subscription open, advances the development clock by ten seconds without a
data write, and receives two legitimate complete responses at durable sequence1.
Authority, generation, schema and plan stay equal. Returned `data.now`, the
receipt's time-dependent range bound and validator change. A conditional query
using the old validator also returns a new complete response at the same sequence.

Both warm and cold-reopened actual file carriers reject the second frame with
`TypeError: conflicting deliveries for clock.read at seq 1`. Byte-identical
replay passes. The issuing program is trusted before the first delivery; this
is separate from the candidate's pre-program receipt-filtering defect.

The immutable provisional04 native owner has SHA256
`81b1549a8255faa351b90f8908c69ec6a4784409e74cbe08fd39a086ba6eb498`.
The owner certifies explicit IR supplied by the probe's static compiler; this
is actual owner execution and actual envelopes/validators, not a Quarry
lowering claim. Source hashes, native envelope pair, conditional response and
persistent results are retained in
`benchmarks/runs/2026-09-06-clique-improvement/evidence/native-clock-delivery/`.
Complete private scripts and files are under
`/Users/ccheever/clique-improvement/revisions/inbox-restore/native-clock/`.

A bounded execution-clock identity design is under review by the client and
engine owners. Preserve durable same-sequence row/authority equivocation
refusals, identical replay, non-timed query behavior and conditional coverage
admission. Define unavailable-program custody, cold persistence, stale and
backward clocks, validator binding and malformed/missing identity behavior
before changing the wire. Local arrival time is not an authoritative execution
clock, and arbitrary changed same-sequence data must not be accepted.

Keep this open until the coherent engine/client repair is independently
reviewed and verified with the actual native case and disagreement controls.
This does not attribute the original published0.0.8 `chats.list` error, whose
failing envelope pair remains unavailable.

## Public-SDK reproduction on the published package (independent verification, 2026-09-06)

The refusal is reachable through ordinary public Quarry, not only through the
probe's explicit IR. A two-line query certifies on the published
`snapback2@0.0.10` owner:

```
query serverNow():
  return { now: now }
```

With any offline store (`fileRangeStore` from `snapback2/test`; the client
created with `createClient({ url, as, offline: { store } })`), the second read
of that query refuses:

```
E_OFFLINE_DELIVERY: conflicting deliveries for clock.serverNow at seq 1
site: client.query.commit
```

No `/control/clock` is required. Two reads 50 ms apart trigger it, because
`now` differs on every execution while the durable sequence stays 1. Once
refused, the query stays refused warm, after a cold reopen of the same
partition, and on a byte-identical re-read; the rewrite hint ("retry an
authenticated query") does not recover it.

Impact for app builders: any offline-store app whose query reads the clock
(expiry banners, countdowns, "valid until" checks) breaks on its second read
of that query. Non-timed queries on the same client keep working.

Identity: `snapback2@0.0.10` + `snapback2-darwin-arm64@0.0.10` from npm
(published 2026-09-06T13:15Z), dev owner started with the same install's
`snapback2 dev`. Platform: macOS, Node file carrier. Classification: product
defect (engine/client delivery identity), same mechanism as above.

Retained repro and evidence (outside the repository, per scratch policy):
`~/verify-snapback2-liveoffline-20260906/harness/d2-clock-conflict.mjs` and
`evidence-D/` (`d2-clock-conflict-0.0.10.log`, `control-ordinary-time.txt`).
The script fails on 0.0.10 and is retained unchanged so a published repair can
be confirmed with the same test. The unpublished candidate under
`evidence/clock-v5-persistence/` has not been verified through this path.
