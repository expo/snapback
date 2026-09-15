```json
{
  "scorer": {
    "family": "astra",
    "model": "gpt-6-astra",
    "basis": "own Snapback 4 lane narrative files"
  },
  "backends": {
    "snapback4": {
      "overall": {
        "score": 88,
        "note": "M1–M6/M8 and full replay passed (final-report.md). Shared authorization, replicas, media lifecycle, and jobs removed substantial work (essay.md). Auth-policy and sparse-feed limitations prevent an ideal score; attributed agent/environment/ambiguous costs are excluded."
      },
      "setup_and_docs": {
        "score": 90,
        "note": "M1 diary describes straightforward built-in identity and an unusually comprehensive, lengthy README; M8 essay credits concrete guide cards. Run-log attributes harness packaging and runtime discrepancies to environment, so those costs are excluded."
      },
      "data_modeling": {
        "score": 88,
        "note": "M2/M3 diary reports direct maintained aggregates, shaped queries, and bounded recipient loops; M8 reporting stayed server-owned. Essay identifies learning costs in projection completeness and bounded programming, including separately modeled identity ledgers."
      },
      "authorization": {
        "score": 91,
        "note": "M3 membership unified query access, replica delivery, and retained history; final report records cross-user and logout denials. Run-log's snapback4-defect identifies the remaining gap: eight-byte passwords satisfy built-in auth without the required character-count override."
      },
      "queries_and_live": {
        "score": 84,
        "note": "M1–M3 live choreography and M5 shared online/offline indexed search passed. Essay and final report retain N_SPARSE_FILTER: broad, sparse follow sets can yield incomplete pages despite successful dense-envelope tuning."
      },
      "writes_and_transactions": {
        "score": 92,
        "note": "M3 bounded recipient writes and M6 transactional effects fit directly. Final report records successful stale-retry and stable-message-ID proofs. Application-authored intent ledgers supply additional idempotency semantics; logged implementation mistakes incur no backend penalty."
      },
      "offline_sync": {
        "score": 90,
        "note": "M5/M8 diary and final report describe cache purge, shared search, durable queue restart, and multi-device convergence. Essay identifies explicit projection-completeness modeling as the learning cost. The horizon-guard regression is agent-attributed; simulator behavior remains unproven."
      },
      "media_assets": {
        "score": 97,
        "note": "M4/M5 diary describes typed assets, row-owned revocation, expiry, and per-principal view-once delivery without separate URL signing. Final report records server refusal and replica purge. M2 required uploading fixture bytes separately for each owning row."
      },
      "background_work": {
        "score": 95,
        "note": "M6 presence and transactional effects supplied the push seam; M8 scheduled jobs produced digests. Final report records closed-client emission, authorization filtering, inactive-period suppression, and restart deduplication. Only a small logging worker was required."
      },
      "client_integration": {
        "score": 89,
        "note": "M1 persistent auth and live replica hooks, M4 asset hooks, and M8 account convergence worked (diary.md). All Hermes exports passed; native interaction remains unobserved (final-report.md). Agent-attributed navigation errors and ambiguous receipt retries incur no backend penalty."
      },
      "diagnostics_dev_loop": {
        "score": 93,
        "note": "M1 E_INPUT immediately identified extra mutation fields; M8 why located horizon coverage, while N_WIDE_MERGE/N_SPARSE_FILTER exposed query costs (diary.md, run-log.md). Essay cautions that 'Predicts: eligible' alone omits essential per-read conditions."
      },
      "scale_and_limits": {
        "score": 85,
        "note": "Final report records 167,243 settled actions, 1,002 conversations, a 1.257 following ratio, and approximately 640 ms cold sync for 100 conversations. Measured envelope checks passed; sparse-filter incompleteness remains. Initial tuning failure is agent-attributed."
      },
      "operations": {
        "score": 88,
        "note": "M3 seeds were idempotent; M4 optional columns/defaults adopted into existing data without scripts (diary.md). Final report records fresh-store replay, preserved-store cloning, and digest recovery. Evidence covers local development; M7 migration/backfill was deliberately untested."
      },
      "verdict": "Snapback 4 strongly served Clique's demanding offline and media lifecycle requirements, with meaningful limits in sparse-feed queries and configurable authentication policy.",
      "would_use_again_for": "I would use it again for offline-first messaging with membership-scoped data and revocable media, where workloads are bounded and the team can learn the projection model."
    }
  },
  "comparison_notes": [
    "Essay.md credits Snapback's shared model with reducing the separate offline queue, restart-state, and media-reconciliation work the author would expect with Convex.",
    "The diary and essay contrast Snapback's combined authorization, delivery, retention, and asset lifecycle with separately coordinating Postgres policies, storage, and device replication in Supabase.",
    "Essay.md acknowledges that feed tuning still requires architectural choices comparable to inspecting Postgres query plans or choosing Convex author-range reads versus feed projections.",
    "These are the lane author's architectural comparisons from existing knowledge, not measured competitor results or evidence about earlier Snapback releases."
  ]
}
```