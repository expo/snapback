# Clique full run: builder-model scores (0–100)

Scorers: grok = grok-4.6. Each model scored from its own three lanes' narrative files only; read-only sessions at xhigh.

## Overall (holistic)

| Backend | grok | mean |
|---|---|---|
| snapback4 | 78 | 78 |
| convex | 80 | 80 |
| supabase | 55 | 55 |

## By category (mean across scorers, then each scorer)

### setup_and_docs

| Backend | grok | mean |
|---|---|---|
| snapback4 | 84 | 84 |
| convex | 72 | 72 |
| supabase | 64 | 64 |

### data_modeling

| Backend | grok | mean |
|---|---|---|
| snapback4 | 90 | 90 |
| convex | 78 | 78 |
| supabase | 86 | 86 |

### authorization

| Backend | grok | mean |
|---|---|---|
| snapback4 | 91 | 91 |
| convex | 60 | 60 |
| supabase | 56 | 56 |

### queries_and_live

| Backend | grok | mean |
|---|---|---|
| snapback4 | 78 | 78 |
| convex | 86 | 86 |
| supabase | 52 | 52 |

### writes_and_transactions

| Backend | grok | mean |
|---|---|---|
| snapback4 | 84 | 84 |
| convex | 70 | 70 |
| supabase | 76 | 76 |

### offline_sync

| Backend | grok | mean |
|---|---|---|
| snapback4 | 80 | 80 |
| convex | 54 | 54 |
| supabase | 44 | 44 |

### media_assets

| Backend | grok | mean |
|---|---|---|
| snapback4 | 82 | 82 |
| convex | 78 | 78 |
| supabase | 66 | 66 |

### background_work

| Backend | grok | mean |
|---|---|---|
| snapback4 | 90 | 90 |
| convex | 88 | 88 |
| supabase | 56 | 56 |

### client_integration

| Backend | grok | mean |
|---|---|---|
| snapback4 | 64 | 64 |
| convex | 74 | 74 |
| supabase | 48 | 48 |

### diagnostics_dev_loop

| Backend | grok | mean |
|---|---|---|
| snapback4 | 84 | 84 |
| convex | 66 | 66 |
| supabase | 62 | 62 |

### scale_and_limits

| Backend | grok | mean |
|---|---|---|
| snapback4 | 46 | 46 |
| convex | 40 | 40 |
| supabase | 30 | 30 |

### operations

| Backend | grok | mean |
|---|---|---|
| snapback4 | 78 | 78 |
| convex | 70 | 70 |
| supabase | 46 | 46 |

## Verdicts

- **grok on snapback4:** Snapback 4 is the brief’s closest server language, undercut by generated-hook loading traps and a --fresh media hole at envelope scale. Would use again for: A membership-and-receipts messenger whose schema should be the spec, if the Expo tree stays mounted across useQuery refetches.
- **grok on convex:** Best live two-client runtime on this brief, with missing auth/offline/clock primitives and a hard 32k read limit at envelope scale. Would use again for: A two-browser messenger that must stay live, if you accept bcrypt sessions, a client outbox, and write-time counters.
- **grok on supabase:** Strong SQL source of truth that still forced a custom API, polling, and a client outbox instead of acting as Clique’s runtime. Would use again for: Unique DMs, follow-graph constraints, and digest keys in Postgres — not typing, live delivery, or offline replay.
  - (grok) Live two-client behavior split the lanes: Convex useQuery greened M1–M8 choreography, Snapback live views greened only through M2 before AuthGate/ChatRail loading, and Supabase substituted 200–700ms polls for unused Realtime and missed the 2s typing window.
  - (grok) Snapback’s 642-line Quarry file was the server (identity, view following, reports delivery, expire, image once, job digest); Convex and Supabase reimplemented receipts, unread, and expiry as TypeScript or store.mjs.
  - (grok) Auth was a product on Snapback (use identity password) and Supabase (email/password), and a bcrypt sessions table with a token argument on every Convex function.
  - (grok) Offline was Snapback’s engine (held search, pending, custody) versus the same localStorage outbox on Convex and Supabase — only Convex’s web M6/M8 offline segments greened.
  - (grok) None finished the 167k scale envelope: Snapback matched the 10% prefix then --fresh upload died, Convex collect() hit the 32k-document read limit, and Supabase stopped before 10% on the hosted pooler.

## Notes per category

### grok

**snapback4**

- overall 78: Quarry expressed receipts, expiry, membership, feeds, and digest as one schema; M1–M8 suites passed. Choreography greened only through M2 (AuthGate/ChatRail loading). Scale matched 10% then --fresh upload died.
- setup_and_docs 84: Published README walked password+profile+avatar; snapback4 init --expo and dumped guide cards. view public vs read <- allow misled (run-log README/guide). Expo 57 router pin is not in the Snapback README.
- data_modeling 90: 642-line schema.q compiled identity, view following/activity, receipts, expire, image once, jobs, and effects. Learning cost: view spelling and N_NEVER_COMPLETE on groupNamed (final-report gaps).
- authorization 91: insert/update <- viewer, read <- exists members, and sync to members mapped Clique membership. reports delivery plus retain delivered-history made Erin block aggregate ticks — engine exactness, not a missing rule.
- queries_and_live 78: view following and generated useQuery greened M1–M2 live. Compiler notes N_EPHEMERAL_SERVER (typing), N_SYNC_ORDER (search), N_NEVER_COMPLETE (groupNamed). ChatRail per-row useQuery overload later failed M3 choreo.
- writes_and_transactions 84: Mutations use if absent, unique keys, server-now windows, and emit notify inside send. check marks likes/follows/reactions/typing online only, so those toggles cannot predict and need a local intent journal.
- offline_sync 80: Engine sync, held search, waitSeconds: 0 custody, and pending rows are first-class (M6 suite). Online-only likes/follows/typing still forced pending glyphs plus src/intent-store rather than predicted mutations.
- media_assets 82: Typed image/video, viewOncePhoto image once, and client.upload — no bucket. Suite denied the second view-once fetch. Scale --fresh then failed upload media/img-04.png: the server is unreachable.
- background_work 90: effect notify plus server.mts JSONL is the M6 push seam; job digest and schedule dailyDigest every 2m is M8. Payload shape lives in the mutation, not a vendor worker.
- client_integration 64: snapback4-expo generated api.ts, useQuery, and useAuth. Refetch {loading:true} unmounted EnsureProfile and Expo Slot (diary M3). Guide says keep the signed-in tree; the hooks still make returning null easy.
- diagnostics_dev_loop 84: snapback4 check emitted typed API; HANDLE_TAKEN, N_NEVER_COMPLETE, E_QUERY_HELD, N_EPHEMERAL_SERVER made schema mistakes loud. M1 seed 16 actions in 290ms. Client-tree bugs stayed slow.
- scale_and_limits 46: --fresh --replay matched the 10% prefix (settledPrefix=24777, fixture sha) then media upload was unreachable (run-log environment / snapback4 --fresh). Full 1008-user envelope unverified; ChatRail showed query occupancy.
- operations 78: One binary snapback4 dev --port, no Docker; --fresh --replay isolates scale. Seed via the app mutate path. --fresh asset upload failed on 56402 and 56403. Accidental pkill was agent-error.

**convex**

- overall 80: M1–M8 suite and web choreography all greened via reactive useQuery. bcrypt sessions, no outbox, queries that do not tick, and the 32k-document read limit were real workarounds; scale verification stayed PENDING.
- setup_and_docs 72: CONVEX_AGENT_MODE=anonymous plus --local-cloud-port/--local-site-port bound 55501/55502 with no account. Those flags are hideHelp(), found in package source not the README. Password auth is not a Convex product.
- data_modeling 78: TypeScript schema.ts (~260 lines) and indexes live in-repo; word-prefix search is a range on messageWords. Receipts, unread, and presence were aggregations in messages.ts (~925 lines), not primitives.
- authorization 60: No session in the query layer: every verb threads token and requireSession (convex/auth.ts, search.ts). Membership and admin checks live in mutation bodies. bcrypt sessions table is brief-legal, not a product.
- queries_and_live 86: Default reactive useQuery greened two-client profile, feeds, DMs, and M8 multi-device without channels. Queries do not re-run on wall-clock; typing/disappearing used client timers and a 190s TTL wait (diary M5).
- writes_and_transactions 70: Mutations plus clientId/mutationId idempotency. Optional validators reject null (accept undefined) so messages.send never ran and the UI idled (run-log agent-error / convex-defect). Scale is a single-threaded mutation firehose.
- offline_sync 54: No outbox: src/offline.ts is localStorage. Essay: Convex HTTP mutations have no outbox. Web M6 flush-in-order and M8 dual-offline still greened after polling navigator.onLine.
- media_assets 78: generateUploadUrl → POST → storage.getUrl is three calls and no bucket. View-once uses mediaMeta and metaForStorage refusing bytes. getUrl can return null; storage is not a CDN (essay).
- background_work 88: crons.interval digest-emit plus isReplayMode skip is first-class scheduled work with no connected client (essay vs pg_cron). Push seam is a pushLogs table plus a query.
- client_integration 74: convex/react subscriptions moved Bob’s screen without a protocol. Two processes/ports; Metro served dual sm-chatsettings-background-preview until expo start --clear (environment). Auth lifecycle and token args are hand-rolled.
- diagnostics_dev_loop 66: Function hot-reload ~300ms. Null-optional mismatch left the UI idle with no mutation error. Copying config.json produced BadAdminKey. Scale collect() Many documents read named the 32k limit explicitly.
- scale_and_limits 40: A second sqlite anonymous instance on 55503/55504 was cheap. runtime.counts collect() hit the 32k-document read limit at checkpoints (run-log convex-defect). Invariant verification remained PENDING.
- operations 70: Fresh scale = directory + sqlite + generated admin key. Default anonymous-agent name blocks clone-by-copy. Seed uses mutation clientIds. No bulk import — honest for the brief, slow for 167k verbs.

**supabase**

- overall 55: Postgres constraints and hosted Auth/Storage were direct; live, offline, and scheduling were a BFF with polls. M3 choreography aborted (suite still passed); M4–M8 blocked-by-M3; scale stopped before 10%.
- setup_and_docs 64: Hosted Auth/Storage docs match the pitch. No local stack or CLI: DDL via pooled DATABASE_URL, Realtime publication ALTERed by SQL. email_confirm: true was required because the brief forbids outbound email.
- data_modeling 86: UNIQUE handle, dm_pair, CHECKs, and now() in server/schema.mjs (~223 lines) expressed Clique invariants as SQL. Application identity still split from auth.users into clq916g_profiles (essay split brain).
- authorization 56: Lane skipped RLS for a service-role BFF because edit windows, digest, and push-on-no-device were more ceremony than store functions. createUser-before-handle-check surfaced as Database error creating new user.
- queries_and_live 52: No live query used: 1s feeds, 700ms messages, 200ms typing table. Essay calls this the 60 shape. Choreography’s 2s typing window missed on poll-plus-token race; postgres_changes/broadcast stayed unused.
- writes_and_transactions 76: Store mutations, unique mutation_id, and window checks against now() are ordinary SQL. Register is two-phase (Auth user then profile) with leftover-user risk. Replay fits the same Node module the HTTP server imports.
- offline_sync 44: No official cache or outbox in supabase-js 2.112.4; docs treat offline as Auth persistSession. Hand-rolled localStorage queue in src/lib/offline.ts. M6 web choreography never greened.
- media_assets 66: Private clq916g_media bucket plus path on a row. View-once, tombstone, and expiry required authorizeMedia through the API with the service role — public URLs would keep serving deleted bytes (essay).
- background_work 56: Digest is an API-process interval, not pg_cron (no CLI on this host). Idempotent (user_id, period_start) is solid SQL. clq916g_push_log fires when no fresh device. Server-side, not a platform scheduler.
- client_integration 48: supabase-js plus a homegrown HTTP API; no paved Expo template. Auth restore raced the first chat load (401). Typing and messages are polls, not subscriptions. Dual-React/kit failures were agent-error.
- diagnostics_dev_loop 62: Unused $1 could not determine data type was a fast SQL fix (diary M2). Auth wrapped handle collision opaquely. Hosted EMAXCONNSESSION hit M8 insights under parallel suite+choreo (environment plus oversized pools).
- scale_and_limits 30: Fresh prefix clq916g_s_ starter settled 16+52+19; scale.log stopped before the 10% checkpoint (final-report). Session-mode pooler made connections a lock. Celebrity fan-out was never performance-probed.
- operations 46: Prefix cleanup dropped 48 clq916g_ objects; Auth users are not prefix-namespaced and remained in the shared hosted project. No CLI, leftover Dave membership from retries, scarce pooler clients.

