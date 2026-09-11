# Snapback2 cached Insights query refuses unpinned readTime

Status: Closed — qualified in `c6f577bce` (2026-09-11)
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

[Report and exact input hashes](../../benchmarks/runs/2026-09-06-clique-improvement/evidence/readtime-reproduction/report.md)
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
reproduction. Closure needs the original pinned-clock repair qualified through
a natively certified timed query and a real durable client, including reopen
and the clock-authority/coverage controls already requested above.

The later multi-key, multi-maintain Insights disagreement (profile read plus
`now`-bucketed totals) is tracked by
[the 0.0.21 findings](../20260910-snapback2-clique-0021-findings.md). Requiring that
entire app shape here would add acceptance scope to the narrower clock-input fix.

## Resolution — 2026-09-11

The current Twin samples `sources.now()` once for a timed query invocation and
uses that same value for `now` and `ReadTime`. Commit `c6f577bce` qualifies the
repair with the actual native R8 `clock.fixed` program and certificate through
a public client backed by the durable file carrier. Two cold client
incarnations reopen the same partition and each observe their new invocation
sample while returning the retained certified rows.

The full `twin.test.ts` run passed 193/193 cases and, together with the existing
clock-authority, immutable-fact, coverage-reset, warm/cold, and three-carrier
controls in `store-review.test.ts`, satisfies the narrower clock-input closure
gate. The multi-key Insights finding remains solely in its linked ticket.
