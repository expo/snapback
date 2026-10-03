```json
{
  "scorer": {"family": "grok", "model": "grok-4.6", "basis": "own Snapback 4 lane narrative files"},
  "backends": {
    "snapback4": {
      "overall": {"score": 81, "note": "snapback4@0.4.10 expressed Clique in one Quarry file and went M1–M8 green with a 167157-action replay; replica horizons still forced follow-overlay, offline-search, and leave-history workarounds."},
      "setup_and_docs": {"score": 75, "note": "M1 started from `npx snapback4 new --template social` plus published receipts/once-media guides; `guide feeds` plus template `online only` follows misled M2 (`setFollow predicts: never`). Worker JSONL logging is thin."},
      "data_modeling": {"score": 86, "note": "`schema.q` (597 lines) declared identity, unique handles, ordinals, `expire at`, `image once`, `reports delivery`, digest `schedule`, and `effect notify`; insights still used a server loop because `.postId.authorId` is not a likes group key."},
      "authorization": {"score": 84, "note": "Table rules `read <- exists members`, `sync to members`, admin insert/delete, and `image once` mapped membership and view-once; M3 `removeMember` emptied `history` despite `retain delivered-history`, so the screen held the last page."},
      "queries_and_live": {"score": 72, "note": "Own-key likes and `ephemeral 4s` typing went live on two clients; M2 Following needed own-key follows and planned `home` after `view following` failed, and `messageReceipts` is messages-only so `receipt()` walks `membersOf`."},
      "writes_and_transactions": {"score": 80, "note": "Idempotent `setFollow`/`setLike`/`setRepost` with `insert if absent` and `require now - m.at` windows compiled; `insert if absent queues without a row` and `setReaction predicts: never` delayed local overlay until settlement."},
      "offline_sync": {"score": 72, "note": "`usePendingWrites` and the replica outbox made M6 queued-send choreography green on the first try; M5 warm-offline search used `inboxSnippets` after `N_SYNC_ORDER` on `search`, and uploads have no queued-bytes outbox."},
      "media_assets": {"score": 77, "note": "Typed `image`/`video` columns, `placeAvatar`, `image once` with `useAsset`, and tombstone-null media all worked; M4 photo send required awaiting in-flight `client.upload` because uploads are online-only."},
      "background_work": {"score": 88, "note": "`effect notify` gated on `connected[p]`, plus `schedule dailyDigest every 2m` and `emit ... once [principal, periodEnd]`, implemented M6 push and M8 digest in-schema; published worker docs omit the JSONL log shape."},
      "client_integration": {"score": 78, "note": "`useQuery`/`useMutation`/`useAsset`/`usePendingWrites`/`useViewer` and generated `api.ts` shipped web plus iOS Hermes exports; `useQuery` throws on principal `\"none\"` and aborted ConversationView in M4."},
      "diagnostics_dev_loop": {"score": 83, "note": "`npx snapback4 why setFollow` and `why home` plus generated `predicts`/`runs` comments diagnosed M2’s overlay; compiler notes `N_SYNC_ORDER` and `N_SPARSE_FILTER` were the rest of the loop, with a throw-on-bad-principal crash in M4."},
      "scale_and_limits": {"score": 84, "note": "Scale replay on `--port 49362 --fresh` settled 167157/167157 actions in 1188.567s, failedActions 0, checkpoints 24777/88057 matching the manifest; `N_SPARSE_FILTER` on planned `home` and insights-as-server-loop stayed non-fatal."},
      "operations": {"score": 76, "note": "`snapback4 dev --fresh` plus idempotent seed recovered after the M2 own-key/home rewrite; a second backend on 49362 isolated scale replay. M7 was environment-out, so migration/rollback was untested this session."},
      "verdict": "Published snapback4@0.4.10 is a production-shaped Clique backend whose schema, receipts, expiry, and outbox carry the brief, with prediction and sync-order seams still extracting workarounds.",
      "would_use_again_for": "A messenger or local-first social client whose product is receipts, expiry, view-once media, and offline writes on a replica."
    }
  },
  "comparison_notes": [
    "Convex is the closest analogue on identity-plus-hooks; uniqueness, receipt ordinals, sync windows, and `expire at` stayed in `schema.q` here.",
    "Supabase would have split Clique across SQL, RLS, Storage policies, and a cron or Edge Function; those facts were one Quarry file in this lane.",
    "M3 receipts (`reports delivery`, join floors, retain-delivered-history) were the strongest Snapback 4 showing versus Convex receipt tables or Supabase channels.",
    "The replica outbox and dual-device offline flush are a local-first story Convex (online by default) and Supabase (hand-built queue) do not give you; `client.upload` remains online-only, matching Convex file storage.",
    "Search and insights remain the Postgres-shaped holes: `N_SYNC_ORDER` forced `inboxSnippets` plus a client word-prefix, and insights-as-a-server-loop was more drama than `count(*)`."
  ]
}
```
