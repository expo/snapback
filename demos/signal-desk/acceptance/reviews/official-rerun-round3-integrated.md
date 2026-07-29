# Backend bakeoff official rerun, round 3 — integrated review

**Reviewer:** Codex integrated security/evidence reviewer
**Date:** 2026-07-28
**Reviewed revision:** `7f92156bc5e9d751f8d61a63bc925e31b1f17982`
**Reviewed source revision:** `f789a143ef6adc01e8d228e29c936d4493513e01`
**Reviewed receipt:** `backend-bakeoff-run.43d6c570f7f3f752f61ca545a1d81ef1a1a6b3b4d34fbe0066a6becc95d3d989.v2.json`
**Method:** clean read-only exact-commit review with adversarial focused tests
**Verdict:** `READY`

## Retained reviewer response

READY on exact `7f92156bc5e9d751f8d61a63bc925e31b1f17982`.
Reopened and verified retained receipt
`backend-bakeoff-run.43d6...d989.v2.json`: standalone verifier reports passed
with exact content digest; 8/8 runner tests pass; all referenced logs/evidence
hashes reopen. Receipt source is clean `f789a143` (ancestor of retention
commit), unchanged after commands, 8/8 required commands green.

Convex closure: distinct `actor` and `observer` `ConvexClient` instances;
observer subscription initial delivery completes before actor mutation; unique
`randomUUID` witness is scoped to the unique incident and callback matches it;
retained log timestamps prove subscribed `01:19:56.137` < mutation start
`.138` < mutation complete `.141` < delivery `.143` and explicitly records
cross-client nonce-bound pass. Cleanup delete, actor close, and observer close
are each 15s-bounded; both close operations are always launched via
`Promise.allSettled`; primary and cleanup errors aggregate.

Supabase: attempt 1 honestly records subscribed+inserted then 15s delivery
timeout; after 1s, attempt 2 creates a new realtime client/transport and unique
attempt witness, then records delivery. Final retained log contains both
failed and passed attempt rows; cleanup is cascade-bound.

Browser/publication closure unchanged: exact frozen nine host-collection list,
exact receipt order/schema, LLP boundary; 64/64 focused
publication/browser/authority tests pass; ref-check passes 114 docs/2313 refs.
No blockers found.
