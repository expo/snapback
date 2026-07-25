# 0080: acceptance corpus (0080 half of the coupled suite)

**Status:** Deferred (phase B)
**Severity:** P2
**Systems:** Testing, Query planning, Authorization
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0080 §Acceptance, LLP 0063 WS6
**Marker:** step5-impl

Build the §Acceptance suite: cross-evaluator byte-identical corpus per the
pinned target manifest; comparator adversarial cases; instrumented sparse
examined-entry fixture; duplicate-order-key + uniqueness fixture; paired-
database noninterference (results, cursors, codes, transport, inspection);
public-read and owner-derivation negatives incl. the left-join refusal;
pagination fixtures incl. all-omitted windows and the six cursor refusals;
obligation-fault live tests; fan-out fixtures at 0/1/1023/1024 with
disclosure behavior; two-writer and activation races; key-move union
counting; filtered-out-root scan bound; chain/diamond refusal; opaque-read
refusal; projection >1024-root materializeAll equality; rebuild crash
fixtures; Exact/Contract typing; the Step 5 fixture rerunning cumulative
gates. Gates 0080 Implemented via the coupled suite. L-sized.
