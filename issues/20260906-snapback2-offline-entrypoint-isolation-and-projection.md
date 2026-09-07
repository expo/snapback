# Snapback2 offline entrypoint isolation and public projection

Status: Open
Date: 2026-09-06
Scope: Snapback2 full R8 candidate 47a7f491a7d7f3b3abd976f2767bf2856a5baf68; unlanded branch.

Fresh independent full-delta reviews require three repairs. Astra reproduced shallow-frozen external rows bypassing recursive isolation through put, construction and rehydrate, causing body/posting disagreement. It also reproduced malformed direct setReceipt range endpoints throwing after old absence authority is removed and partial range metadata installed. Both are inherited on e1c6 and occur in standalone APIs with synthetic private inputs; no public/native exploit is established.

Grok identified a separate inherited held offlineView projection that includes denied data and denied/partial next. R8 repairs the online projection but misses forced-offline, hydration and transport-fallback use of the held result. This finding is source-only until a bounded public-path regression runs.

Repair must isolate arbitrary external nested values, preserve prior receipt authority and dependencies on refusal, and omit the forbidden public fields while retaining complete/capped cursors. Preserve incoming-only validation, indexed lookup, established budgets and original test deadlines. Keep before/final controls and run fresh independent reviews on the final combined source. Size, movement and realistic resident qualification remain separate unfinished work.

[Complete review evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/offline-full-r8-review/README.md). Root authorized serialized repair after the resident preparation writer actually releases. Do not close from intent or a narrow regression alone.
