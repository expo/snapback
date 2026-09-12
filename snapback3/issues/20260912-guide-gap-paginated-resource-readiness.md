# guide-gap: explain paginated resource readiness and complete acquisition

Status: Open
Date: 2026-09-12
Scope: Snapback3 resource documentation and paginated acquisition authoring
Related: [builder guide](../guide.md), [LLP 2000](../../llp/2000-snapback3.rfc.md), [focused Clique run](../../benchmarks/runs/2026-09-12-snapback3-clique-focused-astra-medium/README.md)

The fixed guide says `complete` describes the query result, including its
requested page, and does not mean the whole table has downloaded. The outside
Clique builder nevertheless observed fresh paginated inbox data with a `next`
cursor and `complete: false`. Its initial acquisition helper waited for
`complete` and failed before traversing the pages. It then used fresh returned
array data for the page walk, retained each SDK flag and verified exact IDs
independently.

This is preserved in the
[builder log](../../benchmarks/runs/2026-09-12-snapback3-clique-focused-astra-medium/builder/run-log.md),
the authored [acquisition helper](../../benchmarks/runs/2026-09-12-snapback3-clique-focused-astra-medium/builder/src/acquire.ts),
and the independent
[raw acquisition record](../../benchmarks/runs/2026-09-12-snapback3-clique-focused-astra-medium/grader/grading/evidence/gacq-1789230357769/u0500-1.json).
Its first inbox page contains 50 rows and a cursor with `sdkComplete: false`;
the second contains 50 rows, no cursor, and `sdkComplete: true`.

Reconcile the public semantics, implementation and guide. Explain how a builder
can tell that a requested page is usable, follow its cursor, wait for a refresh
already in flight, and establish the complete declared offline dataset. Do not
recommend ignoring incomplete evidence for derived counts or other reads.
Include a tested, ordinary-client acquisition example with more than one page
and an explicit durable boundary. Fetched-ID accumulation alone cannot certify
retention, as the separate
[offline-history issue](20260912-acquired-history-lost-across-sequence-advance.md)
shows.

This ticket records observed authoring friction and a documentation mismatch;
it does not assign every `complete: false` result to an SDK bug. No guide or
platform change was supplied to either benchmark builder.
