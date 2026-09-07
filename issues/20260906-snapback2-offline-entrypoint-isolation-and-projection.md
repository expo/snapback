# Snapback2 offline entrypoint isolation and public projection

Status: Open
Date: 2026-09-06
Scope: Snapback2 full R8 candidate 47a7f491a7d7f3b3abd976f2767bf2856a5baf68; unlanded branch.

Fresh independent full-delta reviews require three repairs. Astra reproduced shallow-frozen external rows bypassing recursive isolation through put, construction and rehydrate, causing body/posting disagreement. It also reproduced malformed direct setReceipt range endpoints throwing after old absence authority is removed and partial range metadata installed. Both are inherited on e1c6 and occur in standalone APIs with synthetic private inputs; no public/native exploit is established.

Grok identified a separate inherited held offlineView projection that includes denied data and denied/partial next. R8 repairs the online projection but misses forced-offline, hydration and transport-fallback use of the held result. This finding is source-only until a bounded public-path regression runs.

Repair must isolate arbitrary external nested values, preserve prior receipt authority and dependencies on refusal, and omit the forbidden public fields while retaining complete/capped cursors. Preserve incoming-only validation, indexed lookup, established budgets and original test deadlines. Keep before/final controls and run fresh independent reviews on the final combined source. Size, movement and realistic resident qualification remain separate unfinished work.

[Complete review evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/offline-full-r8-review/README.md). Root authorized serialized repair after the resident preparation writer actually releases. Do not close from intent or a narrow regression alone.


## 2026-09-06 — Full R8 round 2 retains two further P2s

The prior three entrypoint repairs are frozen as unlanded cb578e197535290d9c3c7394246584e12459e77a. Its affected public 24/24 and Twin 4/4 controls pass at their original 10s limits; direct Bun indexed assertions have no original per-file deadline. These are scoped implementation results, not closure of full R8 or resource qualification.

Fresh mutually blind full e1c6→cb578 review finds two remaining P2s. Astra reproduces a persistent-admission gap: an empty synthetic checked receipt with incomplete after suffix width can commit before stricter Twin hydration rejects it. Its second reproduction consumes a native Limit page's member or halo through an actual prediction and synthetic queued overlay, then incorrectly reports complete warm/cold without authoritative exhaustion. The second issue is inherited at e1c6; the first combines an inherited acceptance gap with newly throwing post-commit behavior. Grok returns correctness READY by source review, with a separate cold moved-key uncertainty that remains unproven.

Root authorized shared complete-bound prevalidation before any persistent publication, exact refusal/outbox/reopen controls, and distinct page-value versus exhaustion evidence with deletion/movement, warm/cold and later actual Exhausted controls. Preserve the original native-initial-fixture versus synthetic malformed/queued-overlay boundaries. No native emission or public authorization bypass is claimed by those diagnostics. Repair, final full-delta reviews and integration remain pending; keep this ticket Open.

[Full round 2 reports and evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/offline-full-r8-review-r2/README.md). Complete runtime remains 72,709 gzip, 6,709 over 66,000. Original movement failures and current resident qualification remain separate unfinished work.


## 2026-09-06 — Cold moved-key uncertainty reproduced

The separate Grok uncertainty now has a bounded exact-cb578 diagnostic. Two later synthetic matching-plan row images move members outside the retained native Limit page. Warm evaluation remains partial, but cold reopen reports capped and selects a moved row ahead of a compatible unheld tail. No/one-move controls remain correct. The initial native program/frame is unchanged; later images are synthetic checked-admission controls, not native-emitted movement. The initial wrong-planHash fixture correctly refused and remains separately preserved.

[Complete diagnostic and source custody](../benchmarks/runs/2026-09-06-clique-improvement/evidence/offline-cold-movement/README.md). Root authorized a narrow repair using existing immutable issuing key/extent proof with retention/GC/replacement/refusal controls. All three demonstrated findings need final repaired-source review; this ticket stays Open. No wire/privateformat/full-row-cache or resource-budget change is implied.
