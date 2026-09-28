# Search awaits kept inside the delivery fault matrix

No search await is waived or excluded. The original owner allowlist is only
expanded: local-search.ts uses all owners, local-query.ts uses the complete
route owner (including four pre-existing awaits). The original direct-failure
allowlist, absorbs set and every delivery assertion are unchanged.

All new rows are **optional to delivery**. The same real acquired wasm device
has a successful unobserved head and two admitted tails. A public client.query
runs alongside release of those tails, then is requested again on each of the
eight five-second advances. Failures remain scoped to the selected await's async
context, never to healthy outbox calls. Query replies/state/ledger receipts are
scripted only to reach the requested SDK branches, as other RG recipes script
reset/adoption replies; actual search correctness stays with the separately
passing real-host oracle and affected tests. Outbox/receipt calls use the real
wasm device. This is an SDK await-fault proof, not a replacement search engine test.

The stream cancellation case serves invalid JSON to enter the existing cleanup
catch and injects below reader.cancel(). The local fallback case returns an
unknown local answer so routeLocal reaches real server I/O under its await;
no direct-rejection exception is added. The native and missing-program variants
reach the two earlier routing branches. Query errors are collected by their own
caller; all query side work is joined after fault recovery. All original
FIFO/POST/event/caller/lookup/backoff assertions apply. For every added row,
persistent faults leave postedUnderFault = 3 (exactly once per healthy ID).

| Final index | Exact await ID | Reason / existing guard | T/P |
| --- | --- | --- | --- |
| 139 | `local-search.ts:searchReplyIdentity:witness(json.store_id, json.head ?? json.seq, capture)#1` | Query-only identity/restore bookkeeping, caught by sendPost. Never runs for mutation POSTs. | pass / pass |
| 140 | `local-search.ts:decode:reader.read()#1` | Metered query-body stream/cancellation. Stream failures are guarded by sendPost; cancellation rejection is caught in decode. SearchBound is handled by ordinarySearch. | pass / pass |
| 141 | `local-search.ts:decode:reader.cancel().catch(() => {})#1` | Metered query-body stream/cancellation. Stream failures are guarded by sendPost; cancellation rejection is caught in decode. SearchBound is handled by ordinarySearch. | pass / pass |
| 142 | `local-search.ts:ordinarySearch:env.call({ op: "search_state", name })#1` | Page-local state, retained scan, read-publication fence or remote query. Its failure belongs to the independent query caller; delivery never awaits the page. | pass / pass |
| 143 | `local-search.ts:ordinarySearch:env.call({ op: "query", name, args: { ...args, [plan.cursor]: position.after }, viewer: env.principal, now: env.deviceNow(), search: true, spent: ledger.used })#1` | Page-local state, retained scan, read-publication fence or remote query. Its failure belongs to the independent query caller; delivery never awaits the page. | pass / pass |
| 144 | `local-search.ts:ordinarySearch:blocked()#1` | Page-local state, retained scan, read-publication fence or remote query. Its failure belongs to the independent query caller; delivery never awaits the page. | pass / pass |
| 145 | `local-search.ts:ordinarySearch:env.searchPost(`/q/${name}`, { args: { ...args, [plan.cursor]: position.after }, searchRetained: retained }, r => ledger.decode(r))#1` | Page-local state, retained scan, read-publication fence or remote query. Its failure belongs to the independent query caller; delivery never awaits the page. | pass / pass |
| 146 | `local-search.ts:ordinarySearch:blocked()#2` | Page-local state, retained scan, read-publication fence or remote query. Its failure belongs to the independent query caller; delivery never awaits the page. | pass / pass |
| 147 | `local-search.ts:ordinarySearch:env.call({ op: "search_state", name, spent: ledger.used })#1` | Page-local state, retained scan, read-publication fence or remote query. Its failure belongs to the independent query caller; delivery never awaits the page. | pass / pass |
| 148 | `local-query.ts:route:env.installNative(env.signal)#1` | Query selection, native fallback, prediction fence or local/composed/server read. Delivery invalidations schedule void rerun(watch), whose owner catches query failures; one-shot query errors stay with their caller. | pass / pass |
| 149 | `local-query.ts:route:server()#1` | Query selection, native fallback, prediction fence or local/composed/server read. Delivery invalidations schedule void rerun(watch), whose owner catches query failures; one-shot query errors stay with their caller. | pass / pass |
| 150 | `local-query.ts:route:blocked()#1` | Query selection, native fallback, prediction fence or local/composed/server read. Delivery invalidations schedule void rerun(watch), whose owner catches query failures; one-shot query errors stay with their caller. | pass / pass |
| 151 | `local-query.ts:route:ordinarySearch(env, op.name, args, search, checkpoint, blocked)#1` | Query selection, native fallback, prediction fence or local/composed/server read. Delivery invalidations schedule void rerun(watch), whose owner catches query failures; one-shot query errors stay with their caller. | pass / pass |
| 152 | `local-query.ts:route:local()#1` | Query selection, native fallback, prediction fence or local/composed/server read. Delivery invalidations schedule void rerun(watch), whose owner catches query failures; one-shot query errors stay with their caller. | pass / pass |
| 153 | `local-query.ts:route:routeLocal(first)#1` | Query selection, native fallback, prediction fence or local/composed/server read. Delivery invalidations schedule void rerun(watch), whose owner catches query failures; one-shot query errors stay with their caller. | pass / pass |

The new shared request-wait decoder is optional row 116 (queryDecode recipe).
Changed query identity caller 12 stays optional; changed shared transport caller
9 stays required. The shared decoder/identity guard-removal controls both fail.
All 48 original required classifications keep same-ID recovery after faults stop.
