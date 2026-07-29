# Convex Research Room acceptance report

- Result: **stopped** — 14/15 pass, 1/15 fail.
- Timed result: frozen before scenario work at the Stop defect.
- Product evidence: untimed extension on a rotated fresh anonymous local target.
- Hosted evidence: unavailable and unclaimed.
- Cleanup: pass.

## Stop defect

Convex local 1.42.3 supplies its generated control secret through the
`--instance-secret` process-argv flag and binds backend/site ports to wildcard
addresses. The initial proof collector propagated that value by printing full
argv. The exact r1 target was contained and destroyed before scenario work; r2
rotated the credential and reproduced the provider behavior. Only fingerprints
and redacted flag names remain. This makes `RESEARCH-13-SECRETS` fail even
though the application canary stayed server-side.

## Scenario result

- PASS — RESEARCH-01-SEED: Independent Bob Convex query read exact backend counts after Alice mutation.
- PASS — RESEARCH-02-FILES: Bob read metadata and delivered bytes; backend query returned null after owner deletion.
- PASS — RESEARCH-04-KEYWORD: Convex query executed withSearchIndex over source searchText filtered by roomId.
- PASS — RESEARCH-05-SEMANTIC: Native vector-search action returned deterministic nearest source.
- PASS — RESEARCH-06-PROGRESS: Four scheduler-driven mutations were queried independently before terminal complete.
- PASS — RESEARCH-07-CITATIONS: Answer citation IDs were dereferenced through Bob-authorized backend queries.
- PASS — RESEARCH-08-COLLABORATOR: A distinct Bob-authenticated ConvexClient observed Alice's scheduler-authored transitions.
- PASS — RESEARCH-09-CANCEL: Backend state after scheduled late attempts retained zero progress/answer patches.
- PASS — RESEARCH-10-RETRY: Compound roomId+dedupeKey index returned one question and one answer with two attempt rows.
- PASS — RESEARCH-11-OUTCOMES: Independent query returned distinct durable state-machine values.
- PASS — RESEARCH-12-SCHEDULE: Two scheduled effects with one dedupe key produced one durable run.
- FAIL — RESEARCH-13-SECRETS: Application canary stayed server-side, but the Convex local backend places its independent control secret in process argv.
- PASS — RESEARCH-03-OUTSIDER: Mallory-authenticated native clients received FORBIDDEN for every protected surface.
- PASS — RESEARCH-14-PERFORMANCE: Two warmups and seven raw samples retained for read/write/realtime/reconnect; build samples join after Vite runs.
- PASS — RESEARCH-15-CLEANUP: Provider mutation/probe reached zero rows before exact target process, listener, config, secret, and path removal.

## Provider facts

- Full-text search used a room-filtered Convex search index.
- Semantic retrieval used a 32-dimension Convex vector index from an action.
- Files used native upload URLs, storage IDs, authenticated delivery, and deletion.
- Four durable scheduler-authored progress commits reached Bob via native WebSocket push.
- Retry used a room/dedupe index; cancellation suppressed every scheduled and injected late patch.
- Scheduled refresh used the native scheduler, an action HTTP fetch, and an idempotent internal mutation.
- Local development identities directly proved Alice/Bob/Mallory authority. They do not prove production Convex Auth.
- Two warmups plus seven recorded samples are retained for read, write, realtime, reconnect, and Vite build paths.

## Confidence

Dimension total: 14/16. Target identity is local-only (1/2), and reconnect is
direct while offline retention is unclaimed (1/2). The Stop defect is not
averaged into this confidence number and independently disqualifies the tested
version for this app.

## Evidence

See `run-capsule.v1.json`, `evidence/acceptance.final.json`,
`evidence/stop-defect.v1.json`, `evidence/security-scan.precleanup.json`,
`evidence/performance.runtime.json`, `evidence/performance.build.json`, and
`evidence/cleanup-receipt.v1.json`.
