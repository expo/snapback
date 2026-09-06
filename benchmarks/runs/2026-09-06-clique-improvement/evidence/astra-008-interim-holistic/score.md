```json
{
  "scorer": {
    "family": "astra",
    "model": "gpt-6-astra",
    "basis": "own three lanes' narrative files"
  },
  "backends": {
    "snapback2": {
      "overall": {
        "score": 72,
        "note": "All seven attempted web milestones and full-corpus invariants passed. Integrated authority, media and queues stood out, but M5's search compromise, M8 SDK workarounds and the 8.496× following-feed ratio materially weaken production fit (final-report.md)."
      },
      "setup_and_docs": {
        "score": 68,
        "note": "M1 scaffold and built-in auth helped, but guide app returned E_GUIDE_STALE after successful checks; installed guides rescued setup. M5/M8 diaries identify missing worked examples for paginated history, inbox restoration and multiple tabs."
      },
      "data_modeling": {
        "score": 78,
        "note": "M2/M8 unique indexes and maintained aggregates expressed social counts directly; M3 bounds exposed oversized projections. Quarry's missing NFC/string primitives forced client-authored search postings, changing completeness guarantees rather than merely adding syntax (M5 diary)."
      },
      "authorization": {
        "score": 92,
        "note": "M3 membership and recipient boundaries, plus M4/M5 asset revocation, mapped directly onto row authority and leases. M8's closed-client digest proof preserved membership privacy with little separate policy plumbing (diary/essay)."
      },
      "queries_and_live": {
        "score": 65,
        "note": "M2 indexed merge feeds and M3 typing channels were strong primitives. M5 search remained client-authored; M8 read-time, restored-delivery and resume-selection defects required separate query paths and a permanent ascending anchor (run-log)."
      },
      "writes_and_transactions": {
        "score": 89,
        "note": "M2/M3 intent keys, unique indexes, recipient capture and maintained counters supported retry-safe writes; full replay invariants passed. M1 signup and profile creation remained separate, potentially leaving an incomplete account (diary/final-report.md)."
      },
      "offline_sync": {
        "score": 68,
        "note": "M6 supplied persistent rows, intents, grants and asset custody; M8 demonstrated web restart restoration and ordered settlement. Confirmed restoration/resume defects nevertheless required an app-owned inbox cache and explicit resume anchor (diary/run-log)."
      },
      "media_assets": {
        "score": 94,
        "note": "M4 typed, bounded uploads and reference-based revocation were concise; M5 supplied server-enforced view-once leases. Authenticated byte adapters required client wiring, but deletion and consumption aligned naturally with row permissions (diary/essay)."
      },
      "background_work": {
        "score": 89,
        "note": "M5 row timers, M6 executed effects and M8 durable jobs supported expiry, previews and digests. Real closed-client, restart, privacy and quiet-period proofs passed; chunking and recipient-period accounting remained application logic (diary/final-report.md)."
      },
      "client_integration": {
        "score": 63,
        "note": "M8 required a separate inbox client/cache, fresh time-dependent queries and a root resume anchor around confirmed SDK defects. Final web flows passed; native destination failures and duplicate-bootstrap mistakes are excluded as backend faults (run-log)."
      },
      "diagnostics_dev_loop": {
        "score": 65,
        "note": "M3 bounds identified multiplicative projections, and E_OFFLINE_RESUME named admissible shapes. Conversely, M4's table/query collision produced opaque generated-TypeScript failure, while M8 delivery conflicts required architectural isolation (diary/run-log)."
      },
      "scale_and_limits": {
        "score": 58,
        "note": "Final-report.md verifies the full corpus, but 500/5-follow loading measured 8.496× against 3×; search and Trending midpoint predicates also missed. The unexplained owner stall is excluded from backend-defect penalties."
      },
      "operations": {
        "score": 80,
        "note": "M8 index migration/reconciliation, fresh-owner replays, stopped-owner cloning and digest restart worked; upload cleanup was documented. Seeding and cleanup were verified, but M7 was not run, limiting migration evidence (final-report.md)."
      },
      "verdict": "A capable integrated backend whose published offline-query defects, search limitation and 500-follow scaling miss materially weakened its fit for this messenger.",
      "would_use_again_for": "I would use this version again for bounded social applications centered on typed media, row authorization and durable local writes, budgeting for the documented SDK workarounds."
    },
    "convex": {
      "overall": {
        "score": 83,
        "note": "All seven attempted web milestones passed; transactions, subscriptions and scheduling fit directly, with no established Convex defects. M6/M8 required a bespoke durable offline subsystem, while media-policy work and incomplete performance evidence limit production confidence (diary/final-report.md)."
      },
      "setup_and_docs": {
        "score": 83,
        "note": "M1 anonymous-local CLI supplied the backend stack. Auth/session behavior and local-port flags required package-source inspection. Provider placement, installation corruption and Node mismatch were agent/environment issues, not demonstrated documentation defects (diary/run-log)."
      },
      "data_modeling": {
        "score": 88,
        "note": "M2/M3 typed functions expressed social writes, DM deduplication and recipient rules naturally; M8 transactional counters and daily buckets fit well. Joins, uniqueness checks and aggregate maintenance remained explicit application code (diary/essay)."
      },
      "authorization": {
        "score": 82,
        "note": "M1 required provider integration and explicit live-session revocation checks. M3 membership and recipient rules composed through shared server helpers; enforcement worked, but authors had to apply those helpers consistently (diary/essay)."
      },
      "queries_and_live": {
        "score": 87,
        "note": "M1–M3 subscriptions propagated profiles, messages and receipts without invalidation plumbing; M8 shared watermarks synchronized devices. Typing needed persisted rows and scheduled cleanup. Final-report pagination restrictions describe the implementation, not established platform ceilings."
      },
      "writes_and_transactions": {
        "score": 93,
        "note": "M2/M3 transactions kept intent deduplication, counters, DM uniqueness and recipient capture together. M8 extended the same boundary to aggregate maintenance and digest completion; full replay verified committed relationships (diary/essay/final-report.md)."
      },
      "offline_sync": {
        "score": 48,
        "note": "M6/M8 required an app-owned durable outbox, account caches, media persistence, expiry/purge rules and reconnect handling. Web convergence passed; unfinished native proof is not treated as a backend fault (diary/final-report.md)."
      },
      "media_assets": {
        "score": 76,
        "note": "M4 upload/deletion APIs were concise; M5 recipient-specific view-once required a consuming server action and transient bytes. Final-report ownership and video-duration omissions are implementation limitations, not demonstrated storage defects."
      },
      "background_work": {
        "score": 88,
        "note": "M3/M5 scheduling handled typing cleanup and expiry; M8 cron and transactional per-user jobs supported digests and deduplication. Real scheduled emission/privacy checks passed; connection tracking remained app-authored and complete restart choreography was unproven (diary/final-report.md)."
      },
      "client_integration": {
        "score": 83,
        "note": "M1–M3 typed queries/mutations and React subscriptions made the connected client straightforward; M8 account watermarks reused that integration. Auth lifecycle and durable native storage required adapters; the RN event-method crash was agent-error (diary/run-log)."
      },
      "diagnostics_dev_loop": {
        "score": 87,
        "note": "Typechecking, deployments and query tooling supported short correction loops. M8 BadAdminKey safely rejected the wrong-instance migration, and missing-function errors exposed deployment races. The run-log established no Convex defects."
      },
      "scale_and_limits": {
        "score": 80,
        "note": "Final-report.md verifies the full corpus and passing deep-page, 500-follow, celebrity, search and Insights comparisons. Trending's midpoint predicate missed; complete cold-sync memory and 50-member visual checks remain unproven."
      },
      "operations": {
        "score": 87,
        "note": "M6/M8 isolated instances, exports/imports, paginated idempotent backfills and restored-corpus verification worked. Wrong-instance admin access was safely refused; watcher races were agent-error. M7 evolution was not exercised (diary/final-report.md)."
      },
      "verdict": "The strongest overall fit in these lanes, especially for transactional server logic and live multi-client behavior, with durable offline persistence still requiring an application subsystem.",
      "would_use_again_for": "I would use it again for connected collaborative or messaging products where a separately engineered offline layer is acceptable."
    },
    "supabase": {
      "overall": {
        "score": 74,
        "note": "All seven attempted web milestones demonstrated strong SQL, managed identity and storage, eventually including native offline proofs. The experienced architecture required substantial sync, media-authorization and worker assembly; replay mistakes are excluded from backend penalties (diary/final-report.md)."
      },
      "setup_and_docs": {
        "score": 88,
        "note": "M1 managed Auth/Storage APIs and SQL constraints were straightforward on the supplied hosted project. Published session and rate-limit guidance explained later boundaries; the run-log established no misleading Supabase documentation or platform defect."
      },
      "data_modeling": {
        "score": 92,
        "note": "M2/M3 unique relational keys, joins, recipient ledgers and canonical SQL mutations expressed the social model directly. M5 GIN search and M8 server aggregates extended it naturally; familiar SQL reduced learning cost (diary/essay)."
      },
      "authorization": {
        "score": 78,
        "note": "M1 managed sessions needed a deny list for immediate logout; M3/M4 membership and private-byte checks spanned SQL and API routes. M8 digest privacy passed; authorization assembly remained application-owned (diary/essay)."
      },
      "queries_and_live": {
        "score": 72,
        "note": "M2/M5 SQL joins, cursor pagination and GIN search fit well. M1–M4 used hand-authored polling; Realtime was not exercised. Polling bugs remain agent-error rather than evidence of missing backend capability (diary/run-log)."
      },
      "writes_and_transactions": {
        "score": 93,
        "note": "M2/M3/M8 canonical SQL transactions and unique intent keys kept counters, recipients and retries consistent. Replay verified ordered settlement; managed signup additionally used compensating user cleanup around profile insertion (essay; scripts/server.mjs)."
      },
      "offline_sync": {
        "score": 48,
        "note": "M6/M8 queue, cache, replay, token lifecycle and revocation reconciliation were application-built. Later XCTest proved cold offline media/search and ordered durable restart, demonstrating feasibility rather than SDK-provided synchronization (diary/final-report.md)."
      },
      "media_assets": {
        "score": 78,
        "note": "M4/M5 Storage handled real images/video; private revocation and view-once needed an authenticated proxy plus atomic consumption ledger. Post-green M6 native tests proved cached photo/video use and view-once reopen refusal (diary/final-report.md)."
      },
      "background_work": {
        "score": 68,
        "note": "M8's durable SQL period ledger passed closed-client, restart and privacy probes. Schedule dispatch and M6 presence/push detection ran in custom Node processes; an integrated Supabase scheduling path was not exercised (diary/essay)."
      },
      "client_integration": {
        "score": 67,
        "note": "M6/M8 React/Expo worked across web and proven native flows, but auth refresh, polling, presence and persistence required explicit adapters. Native keyboard, lifecycle and harness corrections were agent/environment issues (diary/run-log)."
      },
      "diagnostics_dev_loop": {
        "score": 83,
        "note": "SQL constraints, expired/revoked-principal refusals and documented Auth limits were actionable during replay. Recovery required application diagnostics; the unhandled pg pool error was an agent defect, not a Supabase defect (run-log/essay)."
      },
      "scale_and_limits": {
        "score": 76,
        "note": "Final-report.md verifies 167,157 actions after resumed replay; deep-page/500-follow checks passed. Hosted Auth required pacing; unpaced retries were agent-error. Search/Insights midpoint failures remained ambiguously attributed, and celebrity-write/cold-sync evidence was incomplete."
      },
      "operations": {
        "score": 81,
        "note": "SQL/API audits verified counts, identities and replay recovery; cleanup verified zero owned hosted objects. API supervision and coordinating Auth, database and Storage remained application work; the pool crash was agent-error and M7 unexercised (final-report.md)."
      },
      "verdict": "A strong relational foundation that handled the brief, but the exercised architecture left substantial synchronization and runtime responsibility with the application.",
      "would_use_again_for": "I would use it again for applications with substantial relational queries and reporting whose team can own API, synchronization and background-worker integration."
    }
  },
  "cross_backend_notes": [
    "Convex's M2/M3/M8 diaries show the cleanest mutation-to-subscription path; Snapback's M3–M6 diaries show the strongest integrated authority/media/offline primitives, while Supabase's M2/M8 diaries show particularly direct relational modeling and reporting.",
    "Snapback's M8 restoration, resume and read-time failures carry explicit backend-defect attributions; the other two run logs establish no backend defects, and agent, environment and ambiguous failures were not charged as defects.",
    "Convex and Supabase both authored durable offline subsystems, so Supabase's later native passes strengthen evidence without turning manual persistence into an SDK capability or making the other lanes' missing native proofs backend faults.",
    "All three final reports retain failed or incomplete scale predicates, and Supabase's corpus verification followed a qualified resumed replay; local and hosted timings are not ranked as backend speed.",
    "M7 was not run in any lane, so operations scores rely on observed seeding, schema changes or backfills, recovery and cleanup rather than assumed day-two migration results."
  ]
}
```