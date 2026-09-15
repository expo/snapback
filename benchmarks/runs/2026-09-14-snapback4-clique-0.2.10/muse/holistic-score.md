```json
{
  "scorer": {"family": "muse", "model": "muse-spark-1.3", "basis": "own Snapback 4 lane narrative files"},
  "backends": {
    "snapback4": {
      "overall": {"score": 82, "note": "All seven suites and choreographies green, no cap exceeded; backend owned correctness while timeliness and device durability fell on the builder."},
      "setup_and_docs": {"score": 90, "note": "M1 green in ~28 min after README sections 1-8 plus guide cards; generated-op annotations doubled as diagnosis docs."},
      "data_modeling": {"score": 90, "note": "988-line .q schema held shape, rules, expiry, effects, jobs, pagination; app stayed ~9.6k mostly-UI lines."},
      "authorization": {"score": 95, "note": "Schema-attached read/insert/update rules with typed NOT_MEMBER, NOT_ADMIN, E_IMMUTABLE denials; zero auth regressions, verdict probes passed by construction."},
      "queries_and_live": {"score": 78, "note": "Live-tail follow, threadSig updates, pagination-window and typing-v2 fixes cost M3-M4 ~154 min; convergence needed settlement-aware waits, all green."},
      "writes_and_transactions": {"score": 72, "note": "Locally admitted settings writes evaporated on fast navigation with no error; required hand-rolled keepalive settingsMutate write-through."},
      "offline_sync": {"score": 70, "note": "Outbox died with the page; offline search covered only synced windows (520-row spam hid seed row); indexedDbPersistence switch clean; M6/M8 green."},
      "media_assets": {"score": 85, "note": "View-once fetch-then-record, fresh-asset seeding, fixture avatars rendering; M4 suite and choreography green."},
      "background_work": {"score": 88, "note": "Declared expire at purged the TTL probe row with no worker code; effect notify/digest plus push.log worker made the push seam an afternoon."},
      "client_integration": {"score": 80, "note": "snapback4-expo is a real client with useLink and asset viewed-state; mid-load offline toggle wedged session adopt until a ClientGate retry."},
      "diagnostics_dev_loop": {"score": 70, "note": "check plus generated codes and server data/sql/why CLI were good, but the device is a wasm black box needing a bespoke debug export."},
      "scale_and_limits": {"score": 55, "note": "Only the 50-action sample replay (m6-a13) ran green; no scale harness, tiny store footprints, envelope never exercised."},
      "operations": {"score": 75, "note": "Segmented idempotent seed with wipe-plus-reseed recovery was easy and push.log observable; M7 migration never run, simulator legs not recorded."},
      "verdict": "Snapback 4 carried auth, expiry, and ordering correctness while charging the builder for convergence timing and outbox durability.",
      "would_use_again_for": "I would choose it again for an offline-capable social app, demanding a device inspector and a navigation-surviving durable-mutation primitive."
    }
  },
  "comparison_notes": ["Against Supabase, schema-attached rules replaced a second RLS program kept in sync by discipline.", "Against Convex, per-function auth checks and online-only reads compared poorly to structural refusal plus synced offline reads.", "Declared expire at beat pg_cron sweepers and scheduled functions, verified by an actually purged TTL probe row.", "The effects push seam cost an afternoon versus a week of certificates, tokens, and dispatch on other stacks.", "This generation gained a real Expo client, effects, jobs, and cursor pagination over older Snapbacks' demo clients and patterns."]
}
```