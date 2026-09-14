# Snapback 4: the write result type does not represent replay receipts

Status: Open
Priority: P2
Systems: Snapback 4 client contract, mutation retry, package documentation
Reported: 2026-09-14, performance lane
Source: `beed6a51e1592360a746099de585a049df3808d7`

After a successful mutation's response is lost, retrying the same principal/id
returns `{ state: "sent", id, seq, replayed: true }` without a `result`.
This is the accepted security behavior in [LLP 3000.007 §17](../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#17):
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
[cached results after revocation](./closed/20260913-snapback4-ops-replay-returns-cached-content-after-revocation.md).
This follow-up concerns the client representation, not that server fix.
