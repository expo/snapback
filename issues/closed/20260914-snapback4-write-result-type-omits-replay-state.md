# Snapback 4: the write result type does not represent replay receipts

Status: Closed
Resolved: 2026-09-14
Priority: P2
Systems: Snapback 4 client contract, mutation retry, package documentation
Reported: 2026-09-14, performance lane
Source: `beed6a51e1592360a746099de585a049df3808d7`

After a successful mutation's response is lost, retrying the same principal/id
returns `{ state: "sent", id, seq, replayed: true }` without a `result`.
This is the accepted security behavior in [LLP 3000.007 §17](../../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#17):
an execution identity does not retain historical read authority. The language
guide and the package README's security paragraph correctly describe it.

However, `snapback4/packages/snapback4/src/contract.ts` still requires
`result: R` on every `Write<R>` with state `sent`. In `client.ts`, `send()`
constructs `result: json.result` and drops `replayed`, so the retry can resolve
with `undefined` where a caller was promised `R`. The README's card and HTTP
summary also overstate result availability. The direct HTTP performance
instrument exposed the same old assumption on a changed-payload replay;
its versioned adapter now distinguishes fresh results from replay receipts.

The client owner should represent result availability/replay explicitly in
the existing contract, preserve that information through the client and hooks,
and reconcile the README/card. Verify a lost first response followed by a
same-id retry and an ordinary fresh success, including a value-bearing
mutation; callers must not receive `undefined` under a required result type.
Keep the existing revocation and historical-result withholding regressions.
Do not restore cached historical values to the server's replay response.

The earlier server disclosure issue is already resolved:
[cached results after revocation](./20260913-snapback4-ops-replay-returns-cached-content-after-revocation.md).
This follow-up concerns the client representation, not that server fix.

## Resolution

`Write<R>` now distinguishes fresh `sent` (`replayed?: false`, required
`result: R`) from replayed `sent` (`replayed: true`, no result). Both the
online and local clients preserve the wire's replay flag and omit the
result property on replay. Fresh null stays a result. `onWrite`,
`useMutation.run()` and `useMutation.last` preserve those outcomes; the
README card and HTTP summary describe the distinction. The labelled mock
only produces fresh outcomes and already conforms. No server behavior changed.

Baseline `5ec0a75a2` reproduced four failing real-HTTP cases: online and
process-device clients, each immediate and initially queued. The first
value-bearing insert committed, its reply was dropped after receipt, and
the identical request retried. The server returned `replayed: true` without
`result`; the clients dropped `replayed` and added `result: undefined`.
Each case verified one stored row, identical request identity and arguments,
fresh value/null results, and the wire's historical-value withholding.

After the fix, all four cases preserve the replay receipt and emit one
terminal notification. Type assertions require replay narrowing through
`mutate`, `onWrite` and the hook; the Chromium React test covers fresh null,
direct replay, queued replay and a notification arriving before pending.

EPYC validation (Node 24.13.1, TypeScript 5.9.3): package build passed;
`node --test packages/snapback4/test/client-seams.test.mjs
packages/snapback4/test/react.test.mjs
packages/snapback4/test/write-authority.test.mjs` passed 25 tests, zero
failures or skips, in 11.1 seconds. Existing server revocation tests remain
unchanged and passed. Raw red/green logs are retained on the test host at
`/tmp/sb4-excellence-replay-red.log` and
`/tmp/sb4-excellence-replay-green.log`.
