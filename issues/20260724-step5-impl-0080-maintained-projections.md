# 0080: transactionally maintained projections + global fan-out proof

**Status:** Deferred (phase B)
**Severity:** P2
**Systems:** Storage, Query planning, Authorization
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0080 §5
**Marker:** step5-impl

Same-transaction maintenance: affected keys closed over pre/post-image union,
one evaluation per output row against the final snapshot, changed-bytes
counted unit; the global fan-out/write proof with reverse-index ranges and
the active-plan set as commit dependencies (reverse-index-entry counting);
flat projections only; output-table write refusal and read enforcement
(closed HostPlans compose the output predicate; opaque handlers refused);
deterministic mapper constraints; stored projection identity + the output
_id rule as approved activation inputs; plan activation proof under the 0081
barrier with the per-source non-key-moving bound. L-sized.
