# Snapback 2 Insights / maintained counts first render as twin zero

**Status:** Closed
**Priority:** P1
**Date:** 2026-09-11
**Systems:** Snapback 2 client twin, maintained aggregates, live queries (LLP 1012)
**Related:** [closed/20260910-snapback2-clique-0021-findings.md](./20260910-snapback2-clique-0021-findings.md) items 2/6; Clique Linux lanes on `snapback2@0.0.24` and `0.0.25`

## Symptom

A Clique builder’s Insights screen first paints maintained totals as `0` from the partial twin, then the real counts appear only after an authenticated one-shot / online refresh. The 0.0.25 Astra run recorded this explicitly:

> M8 Insights first UI totals came from partial twin (0), corrected load/refresh to authenticated online client.

Same class as the 0.0.21 finding: live/durable maintained aggregates read as zero until `createClient().query` (or a headless online client) returns the server value. LLP 1012 says a maintained value the client never held is `partial`, never a complete zero.

The 2026-09-11 triage of the 0.0.21 umbrella reproduced an honestly stale twin (`source:"twin"`, `live:false`, `reason.code:"stale"`) rather than a false live/server zero. Tonight’s builder still had to route around the first paint. That is enough for a product defect: Clique Insights is a complete-looking zero.

## Evidence

- Remote 0.0.25 run-log `/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/run-log.md` epoch `1789170312` (expo-build-1000).
- Local copies of the 0.0.21 wave: `benchmarks/runs/2026-09-10-clique-ri-0.0.21/` (astra Insights before=0 after=52; grok `useQuery` 0 vs `createClient().query` 3).
- Contract: LLP 1012 typed-zero completeness.

Do not treat the builder workaround (headless authenticated client on load/refresh) as a platform fix.

## Requested outcome and acceptance

- Reproduce with a maintained count (Insights-shaped: several `maintain` totals, possibly `now`/day buckets) on a durable client: first live paint must not present a complete `0` when the server value is nonzero and the client has never held that row.
- Either the twin reports `partial` / not-ready until the server receipt, or the React/Expo hook does not yield `data: 0` in that window.
- A Clique-like Insights page can bind the hook without a second headless client. Close when a focused test (and, if cheap, a published-package consumer) fails the old complete-zero first paint and passes the new behavior.

## Resolution — 2026-09-11

Reproduced with a real owner, durable file carrier and the shipped React hook:
a never-held count produced `data: 0`, `status: "ready"`, and a partial receipt.

The twin now withholds a result whose uncovered maintained point supplied the
typed-zero fallback, including arithmetic and composite totals. Hooks expose
`unavailable` / `partial` until an authoritative answer arrives. Previously held
scalar zeros remain readable. Untimed literal totals retain their complete
checked owner answer under matching owner selection, no returned pooled rows,
no missing fact proofs, no retention rewrite and no newer prediction. Timed or
mixed-row results, eviction and missing rule authority need an exact rerun.

The permanent `real-owner-successor.test.ts` regression fails on the old first
paint and passes with warm and cold clients. The same hooks recover on reconnect
to `{sent:1, received:0, sum:7, zeroSum:0, hidden:0, doubled:2}` and a subsequent
cold reopen retains that value. The previous stale-zero regression still passes.
`offline-owner-custody.test.ts` pins the fallback's exclusions.

The implementation removes the witness-only global last-decline diagnostic and
its Expo witness field, and shares the existing owner-selection guards. This
funds the fix after concurrent acquisition work consumed the runtime headroom.
The twin's certified result and partial-site diagnostics remain unchanged.
No new physical-absence inference is introduced.

Final validation after integration: 350 affected package tests, 266 evaluator
corpus cases, React/Expo template typechecks and ref-check (450 LLP documents,
8,108 references, zero errors) passed. The full script's Expo timeouts passed in isolation;
its native startup failure passed after installing the lane's missing Vite
dependency. Root caps/inventory failures are inherited Snapback 1 state. All
measured loop latencies and installed-tarball consumer smoke passed; the older
package byte baseline was already exceeded on unchanged main. Raw measurement
failures remain in the append-only records. After rebasing over acquisition
work, the trimmed runtime measures **89,999 gzip bytes** with the pinned toolchain,
inside the unchanged 90,000-byte ceiling.

No npm version was published in this session. This fixes one ticket; the other
builder-run tickets remain separate work.
