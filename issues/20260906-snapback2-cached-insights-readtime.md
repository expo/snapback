# Snapback2 cached Insights query refuses unpinned readTime

Status: Open
Date: 2026-09-06
Scope: Snapback2 client query execution

Fresh published0.0.8 Clique builder reported `readTime was not pinned` from
its cached Insights query. Direct authenticated reads work. The builder uses
explicit server reads for load and refresh, adding client plumbing for a
server-time read model. This is an observed authoring friction; root cause and
current-candidate behavior have not yet been independently reproduced.

The source observation is the builder agent message in M5
`/Users/ccheever/clique-full-008-20260906/logs/astra-snapback2.ndjson` at its
M8 checkpoint. Retained M8 suite evidence is under
`benchmarks/runs/2026-09-06-clique-improvement/evidence/fresh-008-progress/`;
that passing API receipt is not a reproduction of the cached-query refusal.

Next: inspect current readTime/receipt contract, reproduce in an owned private
case, then fix the defect or clarify the authoring contract as evidence requires.
Do not modify the frozen benchmark app or steer its builder.
