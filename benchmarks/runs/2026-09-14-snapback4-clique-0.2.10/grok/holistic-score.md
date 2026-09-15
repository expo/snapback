I'll score Snapback 4 from this lane's retained narrative only. First I'm reading the brief and the grok-snapback4 diary, essay, run log, final report, and run record.Next I’ll read the lane narrative files in full so scores rest on that session’s evidence, not on other lanes.The diary and report already sketch the friction; I’ll read `run-log.md` next so attributions and milestone outcomes drive the scores.I’ll spot-check the schema, client, worker, and acceptance receipts so category scores track concrete claims, not just the essay.```json
{
  "scorer": {"family": "grok", "model": "grok-4.6", "basis": "own Snapback 4 lane narrative files"},
  "backends": {
    "snapback4": {
      "overall": {"score": 63, "note": "Quarry encoded Clique so every M1–M8 Node suite and the scale replay passed, but the published web client is createClient without an outbox, so M3–M8 choreography and offline proofs stayed aborted."},
      "setup_and_docs": {"score": 71, "note": "Published npm README and npx snapback4 guide cards started M1; default wasm URL served HTML; README omitted that unsynced tables will not live-update on createClient. Gatekeeper _dyld_start was environment."},
      "data_modeling": {"score": 85, "note": "One Quarry file held tables, rules, sync, expire, assets, merge feeds, matching, and jobs (~826 lines); check rewrites compiled it in a handful of M1 passes, including a legal N_WIDE_MERGE following query."},
      "authorization": {"score": 63, "note": "Chat membership (exists memberships, created conversations, cap 50) mapped cleanly; dailyActivity and intents had to be public so another principal could increment or insert-if-absent without E_RULE."},
      "queries_and_live": {"score": 57, "note": "M2 live likes greened only after sync public last 2000 (run-log snapback-defect: likesOf horizon none); global timeline ticked; followingFeed stayed server-side; M3–M4 live choreo remained partial."},
      "writes_and_transactions": {"score": 77, "note": "Mutations encoded edit/delete windows, set-state intents, and the 167k-action scale replay; unread intents made insert if absent return E_RULE until the table was readable (final-report loop 6)."},
      "offline_sync": {"score": 37, "note": "createClient has no outbox: M6 queue-flush, M5 warm-offline search, and M8 dual-offline failed. The wasm replica was abandoned after the URL served HTML and Playwright/IndexedDB lagged."},
      "media_assets": {"score": 79, "note": "client.upload plus image/video/once columns and require duration <= 60000 matched the brief; M1 avatars and M4 photo live passed; M4 video viewer and M5 view-once choreo did not."},
      "background_work": {"score": 81, "note": "expire at, schedule digestEveryTwoMinutes, job fanOut, and emit notify with a JSONL worker were schema-native; M6 push suite passed; typing expiry and disappearing choreo did not green."},
      "client_integration": {"score": 48, "note": "SnapbackProvider, keepSession, and iOS Hermes export shipped; web stayed on createClient after wasm HTML; 29× receiptsOf polls starved mutate (run-log loop 13); M3–M8 choreography never fully greened."},
      "diagnostics_dev_loop": {"score": 79, "note": "snapback4 check named N_WIDE_MERGE, N_NO_HORIZON, E_STRUCTURAL_FANOUT, and E_RULE with rewrites; generated api.ts, not check, revealed unsynced likesOf would not live-update on createClient."},
      "scale_and_limits": {"score": 83, "note": "Port 49342 --fresh replayed 167157 actions in 453s; named O5 u0500/u0900/u0901 matched. check left the 501-lane merge legal. Full invariant-manifest SQL was not enumerated."},
      "operations": {"score": 69, "note": "--fresh plus mutation-path seed and m3-a15 idempotency worked; appSettings needed a privileged seed despite insert <- deny; observability was push-log.jsonl; no migration path was used."},
      "verdict": "Snapback 4 made Clique’s server program cheap and the Expo-web choreography bar expensive, because liveness and offline only show up on the replica arm this lane could not keep.",
      "would_use_again_for": "A product whose hard part is authorization and sync and whose clients can stay on the local replica, not a Playwright two-browser online web proof."
    }
  },
  "comparison_notes": [
    "The essay says Convex would have reached a live like tick on web faster, because subscriptions are the default rather than schema-derived horizons that stay silent on unsynced tables.",
    "It also says Supabase would have been slower to a correct Following feed, splitting the same work across Auth, RLS, SQL, Storage, and Realtime instead of one Quarry file.",
    "Identity was cheaper here than Supabase Auth plus a profiles copy; Convex would have felt similar as one functions file, with a looser schema and no sync-audience language.",
    "Offline is a replica product on this pin; createClient has no outbox, which the essay treats as the same class of gap Convex and Supabase have unless you add your own queue — except Snapback already has a replica this web path did not keep.",
    "Relative to an earlier Snapback generation, 0.2.10’s check notes (N_WIDE_MERGE, N_NO_HORIZON, E_STRUCTURAL_FANOUT) changed the work from guessing an empty replica to rewriting a named site, but still did not name createClient live-update failure."
  ]
}
```
