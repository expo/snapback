# Snapback2 cached Insights query refuses unpinned readTime

Status: Open
Date: 2026-09-06
Scope: Snapback2 client query execution

Fresh published0.0.8 Clique builder reported `readTime was not pinned` from
its cached Insights query. Direct authenticated reads work. The builder uses
explicit server reads for load and refresh, adding client plumbing for a
server-time read model. An independent minimal current-client reproduction now confirms the missing
query input; see the evidence below.

The source observation is the builder agent message in M5
`/Users/ccheever/clique-full-008-20260906/logs/astra-snapback2.ndjson` at its
M8 checkpoint. Retained M8 suite evidence is under
`benchmarks/runs/2026-09-06-clique-improvement/evidence/fresh-008-progress/`;
that passing API receipt is not a reproduction of the cached-query refusal.

Independent reproduction: a synthetic certified-shape no-row query returns
`172800007` through a directly pinned ClientStore context, while public Twin
throws `E_INPUT: readTime was not pinned`. This is not native certificate
qualification. The guide supports query `now`, compiler declares its read-time
granularity, and the owner pins it; inherited and current Twin context supplies
null instead. No benchmark implementation was inspected for this reproduction.

[Report and exact input hashes](../benchmarks/runs/2026-09-06-clique-improvement/evidence/readtime-reproduction/report.md)
retain the boundary. Root authorized a scoped Astra repair using one local clock
sample per query invocation, with coverage/state and clock-authority controls.
Mutation prediction remains separately governed. Repair and native/durable
qualification are pending; keep this ticket open until verified and landed.
Do not modify the frozen benchmark app or steer its builder.

## Disposition — 2026-09-11

**Priority:** P2. **State:** keep open, likely repaired but not qualified against
the original shape. Current source samples `sources.now()` for a timed query,
and all 192 `twin.test.ts` cases passed on `15c134d056`:

```sh
cd snapback2
node --test packages/snapback2/tests/twin.test.ts
```

That is package/corpus evidence, not native certification or the published
reproduction. Original Insights also reads the viewer profile and computes a
day bucket from `now`, then returns six maintained totals plus day0…day6
count/like keys. Closure needs that multi-key, multi-maintain, profile-read,
timed-query shape on a real owner and durable client, with pinned read time and
cold reopen.
