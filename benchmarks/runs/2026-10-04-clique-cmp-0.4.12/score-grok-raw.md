I'll read the brief and the three lanes' narrative files, then score each backend from that evidence only.Reading each lane’s diaries, essays, run logs, and final reports next.Continuing with the remaining lane narratives and run logs.I’ll check run records and a few source files to verify scale, auth, and defect claims.Checking a few source claims on scale, auth, receipts, and realtime.```json
{
  "scorer": {"family": "grok", "model": "grok-4.6", "basis": "own three lanes' narrative files"},
  "backends": {
    "snapback4": {
      "overall": {"score": 88, "note": "Quarry expressed receipts, expire, once, views, digest emit-once, and the Expo replica in one schema.q; M1–M6/M8 greened and 167k replay verified. Tax was compile rules plus the M6 worker-copy docs gap."},
      "setup_and_docs": {"score": 80, "note": "`npx snapback4 new --template social` plus `guide social/language/receipts` got M1 running. README’s private-profile example mismatched Clique. Worker isolation was undocumented (M6 snapback-defect knowledge-gap)."},
      "data_modeling": {"score": 90, "note": "`schema.q` (502 lines) is the backend: unique handle, views, `count likes`, receipts clause. Compile tax (`optional image` bounds, `!` needs `else CODE`, receipts after-insert) was first-pass, not a correction loop."},
      "authorization": {"score": 92, "note": "Table `insert`/`read`/`sync to members` rules mapped membership; digest ran `as p.principal`. Unique handle `else HANDLE_TAKEN`. Compiler enforced member-row-before-receipts. No parallel RLS file."},
      "queries_and_live": {"score": 88, "note": "`view following: activity where .actor = viewer or exists follows[viewer, .actor]` plus replica observation. Typing is `ephemeral 4s`. Search could not pair `matching` with `byConversationOrdinal` (M5 split query)."},
      "writes_and_transactions": {"score": 90, "note": "Mutations with `require now - m.at <= 60000 else EDIT_WINDOW` (server time). Reaction upsert; `idFrom` treated `E_ID_REUSED` as idempotent success on the 167k replay."},
      "offline_sync": {"score": 88, "note": "`createApp({ device, assets: { keep: \"viewed\" } })` is the replica; M6/M8 web choreo greened. `sync last 500` is a replica window, not server history (busy chat 10k needed `sql`)."},
      "media_assets": {"score": 90, "note": "Photo/video/`oncePhoto` live on the message row in the same mutation. `image once` plus `expire at .expiresAt` is view-once and disappearing without a storage-policy second system."},
      "background_work": {"score": 84, "note": "`schedule digestEvery every 2m` plus `emit notify … once [principal, periodEnd]`; `connected[]` gates push. Worker private copy made `import.meta.url` miss `data/push-log.jsonl` (M6 snapback-defect)."},
      "client_integration": {"score": 86, "note": "`snapback4-expo` template, `createApp`, `localStorageSessionStore`/`SecureStore` wrapper. Live queries plus replica made the Expo arm a product. Remaining wall was Expo Router/kit (agent-error, uncharged)."},
      "diagnostics_dev_loop": {"score": 82, "note": "`npx snapback4 check` and `why CODE` named HANDLE_TAKEN/EDIT_WINDOW. Search pairing and receipts-after-insert failed at compile. Worker path only found via process cmdline after the suite missed the log."},
      "scale_and_limits": {"score": 90, "note": "`--replay` instance: 167157 actions in 263s, 1008 users; `sql` matched every per-entity count and named O5 fixtures (u0500/u0900/g0001). Replica `last 500` would have under-counted the 10k chat."},
      "operations": {"score": 84, "note": "Idempotent seed via app mutations; isolated `scale-run/` plus `--replay` holding schedules. `npx snapback4 sql` refuses `sqlite_master` (`E_SQL_INTERNAL`); application tables sufficed. Symlink worker copy was environment."},
      "verdict": "Snapback 4.12 is the only pin here where Clique’s distinctive model (receipts, expiry, once, replica, digest-once) was language, not library code.",
      "would_use_again_for": "A production Clique that needs WhatsApp receipts, server-enforced disappearing and view-once, and offline replica sync without a second datastore."
    },
    "convex": {
      "overall": {"score": 71, "note": "Reactive `useQuery`, storage, and `crons.interval` carried live Clique; auth, receipts, clocks, and offline were hand-rolled. Web M1–M8 greened. Scale `collect()` hit the 32k-document limit (convex-defect); verification PENDING."},
      "setup_and_docs": {"score": 68, "note": "`CONVEX_AGENT_MODE=anonymous` bound ports without an account. `--local-cloud-port`/`--local-site-port` are `hideHelp()` in 1.45.0, found in package source. Anonymous dashboard URL printed `null`."},
      "data_modeling": {"score": 76, "note": "TypeScript `defineSchema` plus indexes in-repo; no SQL round-trip. Handle uniqueness is query-then-insert, not a declared unique. Clique’s WhatsApp model lived in `messages.ts` (~925 lines) as functions."},
      "authorization": {"score": 70, "note": "Every verb threads a `token`; `requireSession` is application code. Membership checks live in mutation handlers. No first-class session in the query layer. Worked for M1–M8 suites; not declarative."},
      "queries_and_live": {"score": 82, "note": "`useQuery` made profile edits, likes, and DMs live without channels (M1–M3). Queries do not re-run on wall-clock, so typing/expiry used client timers and read-time filters. Pagination cursors invented on `createdAt`."},
      "writes_and_transactions": {"score": 74, "note": "Mutations are atomic with `mutationId` indexes. Optional validators reject `null` (accept `undefined`); `mediaStorageId: null` silently failed send (M3 convex-defect knowledge-gap). Scale is a single-threaded HTTP mutation queue."},
      "offline_sync": {"score": 38, "note": "Diary: Convex HTTP mutations have no outbox. M6 queue is `localStorage` in `src/offline.ts`. Web flush choreography passed after `navigator.onLine` poll. Cold-start durable replica is not a platform feature."},
      "media_assets": {"score": 74, "note": "`generateUploadUrl` → POST → `storage.getUrl` is three documented calls, no bucket policy. View-once/tombstone needed `mediaMeta` plus `/api/file` httpAction because `getUrl` is not policy-integrated denial."},
      "background_work": {"score": 80, "note": "M8 digest is `crons.interval(\"digest-emit\", { minutes: 1 }, internal.digest.emitDue)` with a `digests` unique period row. `isReplayMode` is a hand flag, not `--replay`. Push seam is a `pushLogs` table."},
      "client_integration": {"score": 74, "note": "`ConvexReactClient` plus `useQuery` is the paved live client. Custom API is `ConvexHttpClient`/`anyApi`, no generated REST. Expo and Convex are two watchers; Metro stale bundles were environment, uncharged."},
      "diagnostics_dev_loop": {"score": 64, "note": "Wrong programs throw `Error` at run, not compile. Null-versus-undefined validator failed silently until send looked idle (M3). Hidden CLI flags and BadAdminKey on copied `anonymous-agent` config came from package source."},
      "scale_and_limits": {"score": 44, "note": "Fresh anonymous instance was cheap. `runtime.counts` `collect()` hit 32k-document reads at checkpoints (run-log convex-defect). Replay is an HTTP firehose; final-report scale verification stayed PENDING."},
      "operations": {"score": 68, "note": "Second scale instance needed its own directory and generated admin key; copying `config.json` 401’d `BadAdminKey`. Local sqlite plus `setReplayMode` mutation. No bulk import, matching the brief’s write-path rule."},
      "verdict": "Convex 1.45 is a strong live-query runtime for Clique’s two-client UI and a weak product for password auth, receipts, clocks, offline, and envelope-scale reads.",
      "would_use_again_for": "An online two-client messenger that can own auth and an outbox in application code and does not need 100k-row collect() checkpoints."
    },
    "supabase": {
      "overall": {"score": 54, "note": "Hosted Auth and SQL constraints paid rent on M1–M2. Live, offline, and jobs were a BFF plus polls; M3 choreography aborted (partly harness, partly no presence). Scale stopped before 10%; pooler `EMAXCONNSESSION`."},
      "setup_and_docs": {"score": 58, "note": "Auth/Storage/Realtime docs match the marketing split. No local stack or CLI; DDL via pooled `DATABASE_URL`. Realtime channel auth and replica identity were not trusted from public docs at M3 point of need."},
      "data_modeling": {"score": 84, "note": "`UNIQUE` handle, `dm_pair`, FKs, and CHECKs in `schema.mjs` are the brief’s invariants. The server program is `store.mjs` (~1643 lines), a second language beside SQL, because RLS and edit windows felt like too much ceremony."},
      "authorization": {"score": 55, "note": "Auth lives in `auth.users`, identity in `clq916g_profiles`; handle collision after `createUser` became “Database error creating new user” (M1). Lane used a service-role BFF instead of RLS for windows, digest, and media."},
      "queries_and_live": {"score": 50, "note": "Feeds are SQL unions (M2 easy). No live query: 1s chrome poll, 700ms message poll, 200ms typing poll (`ConversationScreen.tsx`). Realtime was `ALTER PUBLICATION` then under-used; M3 typing missed the 2s window."},
      "writes_and_transactions": {"score": 80, "note": "SQL `now()` windows, `ON CONFLICT` mutation ids, set-state likes/reactions. Transactions are ordinary Postgres. The write path is a Node `store.mjs` both HTTP and seed import, which made replay-adapter authoring easy."},
      "offline_sync": {"score": 32, "note": "supabase-js 2.112.4 has no mutation outbox matching this brief; docs treat offline as Auth `persistSession`. M6 queue is `localStorage` (`src/lib/offline.ts`). Web offline choreography never greened (blocked-by-M3)."},
      "media_assets": {"score": 68, "note": "Private `clq916g_media` bucket plus `authorizeMedia` gate for view-once/tombstone/expiry, because a public URL would outlive revocation. Happy-path upload is direct; policy-integrated denial is application code."},
      "background_work": {"score": 50, "note": "Digest is `setInterval` in `server/index.mjs`, not pg_cron (no CLI). Idempotency is PK `(user_id, period_start)`. Push-on-no-device uses presence heartbeats plus `clq916g_push_log`. No first-class connectedness."},
      "client_integration": {"score": 48, "note": "Client is supabase-js Auth plus a homegrown HTTP API (`CliqueProvider`). No Expo template. Session restore raced first conversation load (401). Dual React/Playwright M3 failures are agent-error; the split client is the platform shape."},
      "diagnostics_dev_loop": {"score": 56, "note": "SQL `$1` type error on Global feed was clear (M2 agent-error). Auth wrapped unique-handle failure. Hosted `EMAXCONNSESSION` appeared under parallel suite+choreo (environment/tenancy). No `why CODE` loop."},
      "scale_and_limits": {"score": 32, "note": "Scale replay on prefix `clq916g_s_` settled starter then stopped before the 10% checkpoint (`artifacts/scale-replay.json` pass=false). Session-mode pooler `EMAXCONNSESSION` already bit M8 insights. Envelope unverified."},
      "operations": {"score": 38, "note": "Prefix tables/buckets dropped (48 objects); Auth users are not prefix-namespaced on the shared hosted project and were left behind. No CLI; digest lives in the API process. Connections became a scarce lock."},
      "verdict": "Hosted Supabase was an excellent Postgres-plus-password-hasher and a poor Clique runtime: live, offline, jobs, and tenancy isolation were assembled, not provided.",
      "would_use_again_for": "A SQL-first Clique if Realtime broadcast is wired on day one, one process holds the pool, and a hand-rolled outbox is acceptable."
    }
  },
  "cross_backend_notes": [
    "Snapback was the only published surface that already contained receipts, expiry, view-once, replica offline, and `--replay`; Convex and Supabase implemented those as TypeScript or SQL plus client queues.",
    "Convex uniquely made two-browser liveness free (`useQuery`); Supabase paid for it with 200–700ms polls after distrusting hosted Realtime docs, and M3 choreography never greened.",
    "Password auth was first-class on Snapback (`use identity password`) and Supabase (hosted Auth), and a bcrypt mutation plus sessions table on Convex.",
    "Scale separated them hardest: Snapback verified 167157 actions in 263s; Convex hit a 32k-document `collect()` ceiling with verification PENDING; Supabase stopped before 10% on a shared hosted project.",
    "Supabase’s M3 abort is only partly a backend finding: suites for M3–M8 passed on the BFF, and much choreography pain was Expo/RN-web (agent-error); the backend finding is the missing application runtime around Postgres."
  ]
}
```
