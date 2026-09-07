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

## Independent verification of the candidate repair (2026-09-06, unlanded)

The coherent candidate is three committed lane tips together: owner from
`s2/clique-search-engine` (26c9fd5e0), the compiler bundle from
`s2/clique-search-compiler` (0aba7948f, which the engine owner requires:
"unknown variant `Field`, expected `Scalar` or `WordPrefix`" with the
engine tree's own bundle), and the client from `s2/clique-search-twin`
(e1c6e2b79). Built in private detached worktrees, nothing in the lanes touched.

- `d2-clock-conflict.mjs` (the public-Quarry `serverNow` reproduction that
  fails 3/5 on 0.0.10 and on main): 5/5. The re-query after a 10 s clock
  advance installs at the same durable seq with the moved `now`; a cold
  reopen of the same partition reads it; consecutive re-reads stay complete.
- Disagreement control `h2-owner-reset-same-seq.mjs`: a non-timed query
  whose reset owner database reaches the same seq with different rows is
  still refused, typed `E_OFFLINE_DELIVERY` (8/8) — the repair does not
  weaken durable-data equivocation refusals.
- Regression pass on the same pair: durable sends 12/12, account transitions
  9/9, revocation while offline 10/10, reconnect/reload 7/7. The denied
  re-ask (`f-denied-next.mjs`) still throws at this twin tip; the fix for it
  landed on main separately (`8b6c25b39`) and is also present, uncommitted,
  in the twin working tree.

Logs under `~/verify-snapback2-liveoffline-20260906/evidence-candidate-pair/`.
Still open until the candidate lands and the native case is re-run on it.

## Native verification of the candidate (2026-09-07 01:00Z, unlanded)

The same candidate triple, exercised as an actual Release Hermes iOS
simulator app on the Expo SQLite carrier (apartment M1, Xcode 26.6, iOS 26.5
simulator): a standalone app generated from the published `snapback2@0.0.10`
template with `query serverNow(): return { now: now }` and a generic `query`
witness verb, its client bundle swapped for the `s2/clique-search-twin`
e1c6e2b79 dist, talking to the `s2/clique-search-engine` 26c9fd5e0 owner
(search-compiler 0aba7948f bundle) over an SSH tunnel.

- Published 0.0.10 control on the same device (run
  `native-clock-published-0010b`): the second read 100 ms later refuses
  `E_OFFLINE_DELIVERY: conflicting deliveries for clock.serverNow at seq 1`;
  after `SIGKILL` and relaunch the cold read refuses the same way; a
  non-timed read stays complete.
- Candidate (run `native-clock-candidate-triple`, bundle sha256 `6cac7550…`,
  Hermes bytecode): the second read installs `complete` at the same seq with
  the moved `now`; after `SIGKILL` and relaunch the cold read is `complete`
  with a fresh `now`; the non-timed read stays complete.

Runs, screenshots, and recordings under
`~/verify-snapback2-liveoffline-20260906/evidence-native-clock/`. With the
Node disagreement control above, the candidate meets this ticket's closing
bar except that it has not landed; close on landing.
