# Clique full run: builder-model scores (0–100)

Scorers: astra = gpt-6-astra, grok = grok-4.6, muse = muse-spark-1.3. Each model scored from its own three lanes' narrative files only; read-only sessions at xhigh.

## Overall (holistic)

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 64 | 57 | 78 | 66 |
| convex | 84 | 78 | 82 | 81 |
| supabase | 77 | 47 | 62 | 62 |

## By category (mean across scorers, then each scorer)

### setup_and_docs

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 63 | 65 | 38 | 55 |
| convex | 83 | 68 | 85 | 79 |
| supabase | 85 | 66 | 70 | 74 |

### data_modeling

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 68 | 73 | 85 | 75 |
| convex | 88 | 76 | 80 | 81 |
| supabase | 94 | 86 | 85 | 88 |

### authorization

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 84 | 82 | 80 | 82 |
| convex | 83 | 70 | 85 | 79 |
| supabase | 78 | 56 | 86 | 73 |

### queries_and_live

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 67 | 58 | 55 | 60 |
| convex | 87 | 84 | 85 | 85 |
| supabase | 72 | 38 | 72 | 61 |

### writes_and_transactions

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 76 | 86 | 85 | 82 |
| convex | 94 | 88 | 88 | 90 |
| supabase | 93 | 84 | 75 | 84 |

### offline_sync

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 74 | 76 | 92 | 81 |
| convex | 50 | 46 | 35 | 44 |
| supabase | 50 | 38 | 40 | 43 |

### media_assets

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 43 | 58 | 80 | 60 |
| convex | 80 | 78 | 88 | 82 |
| supabase | 79 | 52 | 75 | 69 |

### background_work

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 70 | 80 | 45 | 65 |
| convex | 89 | 72 | 75 | 79 |
| supabase | 73 | 30 | 85 | 63 |

### client_integration

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 69 | 44 | 65 | 59 |
| convex | 85 | 82 | 70 | 79 |
| supabase | 70 | 40 | 62 | 57 |

### diagnostics_dev_loop

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 68 | 80 | 50 | 66 |
| convex | 86 | 74 | 72 | 77 |
| supabase | 82 | 60 | 68 | 70 |

### scale_and_limits

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 68 | 40 | 78 | 62 |
| convex | 82 | 72 | 85 | 80 |
| supabase | 78 | 34 | 30 | 47 |

### operations

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 43 | 55 | 60 | 53 |
| convex | 86 | 70 | 72 | 76 |
| supabase | 80 | 58 | 70 | 69 |

## Verdicts

- **astra on snapback2:** Strong integrated primitives were undermined by published-surface constraints and recovery gaps that materially compromised this brief. Would use again for: I would use it again for bounded reactive applications benefiting from integrated offline queues and timers, after validating their asset-lifecycle requirements against the published limits.
- **astra on convex:** Convex provided the most coherent connected application backend in these lanes, with durable offline behavior its largest remaining application responsibility. Would use again for: I would use it again for reactive messaging and collaboration applications with a separately planned durable offline layer.
- **astra on supabase:** Supabase was an excellent relational foundation for Clique, while this deployment left much of the live, offline and worker integration to application code. Would use again for: I would use it again for relational social products where SQL reporting and explicit control justify owning synchronization and worker services.
  - (astra) These judgments exclude agent-error, environment and ambiguous incident costs; elapsed time and correction counts are not treated as backend rankings.
  - (astra) Convex required the least assembly for connected transactions, live queries and scheduling, while Supabase's SQL model was especially direct for relationships and reporting; Supabase Realtime was not exercised.
  - (astra) Snapback supplied the strongest integrated offline machinery, but query ceilings, missing server one-use assets and effect-header defects forced workarounds; its staging penalty concerns missing recovery tooling rather than the ambiguous accumulation cause.
  - (astra) Supabase's eventual native proofs validate its custom persistence implementation; missing equivalent proofs in Snapback and Convex are evidence gaps rather than demonstrated backend failures.
  - (astra) All three reached verified full-corpus state with differing replay qualifications, none establishes complete O5 or comparable latency, and M7 was unrun everywhere.
- **grok on snapback2:** A messenger-shaped backend whose 0.0.4 certified bounds, asset ceiling, and Expo web client kept the product from going live-green after M2. Would use again for: A chat app on the package React DOM template with modest media and follow-graph size, not this Expo-web choreography brief at the 500-follow envelope.
- **grok on convex:** The only Grok lane that went M1–M8 web-green and finished the scale envelope, paying with hand-rolled auth, time, and offline. Would use again for: A live multi-client messenger or social app where password auth and true offline-first are acceptable to build, and the 16 MiB read budget is designed around.
- **grok on supabase:** Hosted Postgres and Auth were a fast M1; the messenger brief after that is an application you write, and this lane's two-browser live bar never recovered. Would use again for: A refresh-based CRUD social app on Postgres where GoTrue is the win, not a 2-second typing/live-DM messenger or a durable offline queue.
  - (grok) Convex was the only Grok lane to green M1–M8 choreography and finish the 167157-action scale replay; Snapback and Supabase both passed scripted suites through M8 but lost the two-browser live bar at M3 (Snapback) or M2 (Supabase).
  - (grok) Snapback uniquely expressed membership, typing TTL, row expiry, and offline retain as schema, then the 4MiB certified merge (~360 follows), 40-object asset ceiling, and Expo snapback2/react export fought the brief's envelope and web client.
  - (grok) Supabase uniquely bought password auth and SQL constraints in hour one, then reimplemented live (poll), offline (localStorage), digest (Node setInterval), and media refusal (byte proxy) because hosted-without-CLI Realtime, Edge, and Storage policy were not operable as product features.
  - (grok) All three paid RN-web/Playwright observability (agent-error); only Snapback's Metro export and 256-subscription cap and Convex's non-ticking queries were charged as backend live-query defects.
  - (grok) Writes and idempotency were easy everywhere (Quarry mutation IDs, Convex mutations, SQL ON CONFLICT); what separated scores was whether live, time, offline, and media revocation were platform primitives or an application.
- **muse on snapback2:** The powerful local-first choice, priced in probes: unmatched offline sync and replay verification, discounted by undocumented seams. Would use again for: I would use it again for an offline-first messenger with queued writes, durable restart, and replay-scale verification.
- **muse on convex:** The fastest correct realtime single-device backend here, with the best docs and local loop, until disconnection enters the picture. Would use again for: I would use it again for an online-first social app with a custom client API, live feeds, and in-band scheduled work.
- **muse on supabase:** The fastest relational stack with auth, media, and scheduled jobs, charging calendar time for bulk identity and hand-built sync instead. Would use again for: I would use it again for a relational app with auth, media, and cron-driven digests where bulk signup throughput is not the bottleneck.
  - (muse) Offline sync separated the three most: Snapback shipped a durable FIFO idempotent outbox with restart recovery while Convex and Supabase hand-built queues, the latter's own diary conceding the B4-30 shape.
  - (muse) Scheduled work inverted that ranking: Supabase pg_cron digest and expiry ticks were transactional and exercised exactly, Convex kept a scheduler chain in-band but never ran the shortened digest, and Snapback evidenced no digest at all.
  - (muse) Scale drew the hardest line: Snapback and Convex both settled the full 167,157-action replay with exact checkpoints while Supabase never completed it, throttled by hosted-auth signup limits to sample-50 only.
  - (muse) Auth economics differed symmetrically: Supabase Auth and Snapback identity were nearly free while Convex paid a hand-rolled bcrypt B2 tax inside isolate constraints.
  - (muse) Documentation maturity ordered Convex first with answers findable, Supabase second with answers spread across products but written, and Snapback last with grant, drain, echo, and lease contracts derived from probes.

## Notes per category

### astra

**snapback2**

- overall 64: M1–M8 narratives show valuable integrated authorization, offline storage and scheduling. M5 lacks single-fetch media delivery, M6 effects drop headers, and the final report documents no published staging-recovery operation despite successful full-corpus replay.
- setup_and_docs 63: M1's built-in auth and chat scaffold helped. The README contradicted the shipped offline guide; M5/M8 lookups encountered E_GUIDE_UNKNOWN and E_GUIDE_STALE, including missing guidance for the unrecovered staging limit.
- data_modeling 68: M1/M3 principal types, unique keys and membership declarations were concise; M8 maintained counters worked. Restricted collection operations, nullable aggregate keys and certified bounds required model reshaping beyond ordinary schema authoring.
- authorization 84: M1/M3 ownership and membership rules composed directly with authenticated principals; M4 tombstoning revoked asset access. M3/M5 uniform-scan certification constrained otherwise natural membership rules and forced separate authorized reads.
- queries_and_live 67: M2/M3 live queries and ephemeral typing worked. E_BOUND split Following pages; M5 E_STRUCTURAL_COUNT forced client-merged per-chat search with client-derived index terms. Ambiguous live-update misses are not counted as backend defects.
- writes_and_transactions 76: M2–M4 set-state intents, deduplication and maintained counts worked. M5 asset custody forced non-atomic recipient uploads; the M8 cap correction required batched group invitations. The initial incorrect membership cap itself was agent-error.
- offline_sync 74: M6/M8 supplied durable carriers, prediction and ordered replay; browser restart durability passed. The essay records conflict semantics requiring adaptation to arrival-order LWW, while documented one-writer locking required separate tab stores with incomplete secondary-tab recovery.
- media_assets 43: M4 authenticated assets and tombstone refusal were direct. M5's E_ASSET_IN_USE required recipient-specific copies; published types acknowledged missing server one-use delivery, and repeated fetches succeeded while a grant remained open.
- background_work 70: M5 row timers and M8 backfills/digests worked, including closed-client restart verification. M6 logged backend defects for unsupported string operations and dropped HTTP headers; push presence additionally required a heartbeat with delayed disconnect detection.
- client_integration 69: M1/M6 hooks and web/Expo carriers provided useful integration. The final report documents separate grant, identity and carrier lifecycles plus a one-writing-tab restriction requiring custom coordination; ambiguous reconnect incidents are excluded as defects.
- diagnostics_dev_loop 68: M2 E_BOUND reported concrete costs, and M8 emitted an actionable migration plan. Missing/stale guide targets weakened recovery; M6's silently omitted headers required captured provider requests to establish the defect.
- scale_and_limits 68: The final report verifies 167,244 starter/scale commits and 1,000 memberships. Fixed ceilings still required split 500-follow reads and batched invitations; global search remained client fan-in. Full interactive scale behavior was not established.
- operations 43: M8 backfills and emitted migrations worked. Final validation encountered staging exhaustion persisting across restart, with no published discard/sweep API. The penalty concerns that recovery gap, not the ambiguous cause of accumulated uploads.

**convex**

- overall 84: M1–M8 retained green web results and verified full replay, with consistently direct transactions, subscriptions and scheduling. The principal missing subsystem was durable offline storage; the final report also retains media-policy work and scale-proof limitations.
- setup_and_docs 83: M1's anonymous CLI development worked. Auth/session details and hidden local-port flags required package-source inspection. Concurrent installation corruption, Node selection and routing mistakes are excluded from backend penalties.
- data_modeling 88: M2/M3 typed functions expressed social edges, deduplicated DMs and membership watermarks naturally. M8 transactional counters fit well, although joins, aggregation policies and paginated counter backfills remained explicit application code.
- authorization 83: M3 reused server membership helpers across reads and mutations; M5 enforced consuming media claims. M1 required explicit live-session checks for immediate revocation, and the essay emphasizes that generated types do not supply authorization.
- queries_and_live 87: M2/M3 subscriptions propagated feeds, messages and watermarks without invalidation plumbing. M5 supplied indexed prefix search. Typing required persisted rows plus scheduled cleanup, and offline search required a separate local implementation.
- writes_and_transactions 94: M2/M3 transactions directly supported set-state deduplication, counters, DM uniqueness and recipient capture. M8 updated Insights with source writes and persisted digest completion atomically. No transactional backend defect was demonstrated.
- offline_sync 50: M6/M8 web convergence passed, but the lane authored its durable outbox, account-scoped caches, media persistence and purge policies. The published surface supplied no complete offline database or durable queue; native behavior remained unverified.
- media_assets 80: M4 uploads and deletion were small and predictable; M5 consuming claims enabled per-recipient one-view bytes. Public URLs required an application-controlled delivery path for stricter policy, and ordinary offline media persistence remained application work.
- background_work 89: M3/M5 scheduled cleanup and M8 cron-driven digests needed no separate worker service. Persistent deduplication and isolated scheduled emission worked; connectivity tracking remained custom, and the complete digest-restart proof was not performed.
- client_integration 85: M1–M3 typed queries and subscriptions integrated cleanly with React; M8 account watermarks naturally synchronized devices. Auth-provider composition and native persistence required additional wiring. The native browser-event crash was explicitly agent-error.
- diagnostics_dev_loop 86: M8 BadAdminKey and missing-function diagnostics correctly refused wrong-instance or premature operations; watcher readiness enabled recovery. Final typechecking passed, and the run log attributes no demonstrated defect to Convex.
- scale_and_limits 82: The final report verifies full replay and passing deep-page, 500-follow, search, Insights and celebrity probes. Trending missed its midpoint rule and retains an aging-index scan risk; complete cold-sync and group-rendering proofs remain absent.
- operations 86: The essay and M8 report document isolated local instances, exports/imports, paginated idempotent backfills and successful snapshot restoration with invariant rechecks. Wrong-instance credentials were refused. M7's separate evolution exercise was not run.

**supabase**

- overall 77: M1–M8 delivered green web results, eventual native offline proofs and verified corpus state. SQL, managed Auth and Storage were effective; the essay documents substantial custom synchronization, authorization routing and worker/process responsibilities.
- setup_and_docs 85: M1 diary/essay describe straightforward published Auth and Storage APIs, composing immediate signup from admin creation and ordinary sign-in. Session and rate-limit documentation explained obligations; no misleading Supabase documentation was established.
- data_modeling 94: M2/M3 relational keys, constraints, joins and recipient ledgers directly expressed the product. M5 GIN search and M8 server aggregates extended the same model; the essay repeatedly identifies SQL familiarity and composability as strengths.
- authorization 78: M1 managed identities and SQL membership checks worked; M5's view ledger and M8 digest authorization passed. Immediate logout needed a deny list, while the chosen API architecture required explicit authorization across mutation, query and media routes.
- queries_and_live 72: M2 SQL feeds and M5 indexed search were expressive. The lane explicitly chose polling and custom typing instead of exercising Realtime, leaving projection refresh work. Its polling starvation was agent-error, not evidence of defective Supabase realtime.
- writes_and_transactions 93: M2/M3 unique keys and canonical SQL transactions supported idempotent intents, recipient capture and ordered messages. M5 atomically consumed views; M8 persisted digest periods with emissions. Replay expiry correctly refused unauthorized execution.
- offline_sync 50: M6/M8 eventually proved native cached media/search and durable sends across process death. Those guarantees came from the lane's custom queue, caches, replay and purge code; the used SDK supplied no integrated offline subsystem.
- media_assets 79: M4 Storage uploads/downloads were straightforward. Immediate revocation required an authenticated proxy; M5 added a transactional view ledger and transient bytes. M6 native media caching passed, through application-owned persistence.
- background_work 73: M8's custom persistent worker passed two real digest periods and an API restart with clients closed. SQL made deduplication and authorization direct, but scheduling, push presence and process ownership remained application services in this deployment.
- client_integration 70: M1 managed auth and Storage calls were straightforward; final M6/M8 native proofs passed. The diary records manually integrated HTTP refresh, subscriptions for presence, token lifecycle, cache reconciliation and reconnect behavior; polling bugs are excluded as backend defects.
- diagnostics_dev_loop 82: The run log records actionable rate-limit documentation, correct expired-principal refusal and useful SQL EXPLAIN inspection. The final report establishes no Supabase defect; native observability and unhandled pool errors were application corrections.
- scale_and_limits 78: The final report verifies the complete corpus and 7/9 read comparisons; search/Insights midpoint failures remain ambiguous. Documented Auth pacing constrained replay, while unpaced requests and recovery mistakes were agent-error. Staged/resumed replay qualification remains unresolved.
- operations 80: M8/final-report evidence shows separate schemas, exact SQL audits, resumable receipts and managed Auth/Storage deletion enabling verified cleanup. The custom API/worker increased operational responsibility; the unhandled pool-error crash was agent-error.

### grok

**snapback2**

- overall 57: Quarry identity, live tables, and retain-delivered-history mapped Clique, but 0.0.4 certified merge, asset ceiling, and Expo-web export defects left M3+ choreography ungreen and scale unverified.
- setup_and_docs 65: Chat template plus snapback2 check (run-log generation 0a54b67e) started M1; no Expo web token-store recipe, and Metro resolved snapback2/react to the RN export (snapback2-defect).
- data_modeling 73: Tables, unique handles, caps, and maintain counts expressed the model; Quarry refused divmod(now) so M8 7-day bars are today plus zeros, and named inbox scan was E_STRUCTURAL_COUNT.
- authorization 82: Table read/insert rules plus membership exists mapped DMs and groups; view-once is a mutation. Agent widened conversationStates delete (E_RULE), which is rule authoring not a missing primitive.
- queries_and_live 58: Live feeds greened M1–M2 and channel typing ttl 5s matched M3. Per-bubble useQuery hit the 256-subscription cap; last M3 choreo missed dm-live-messages (mixed snapback2-defect).
- writes_and_transactions 86: Set-state follows, likes, and reactions with client mutation IDs are the default; M4 edit/delete windows are require now <= msg.at + N against owner time.
- offline_sync 76: OutboxStatus, retain delivered-history, and chatOffline recipe; M6 suite passed. A new messagesAll query while Playwright-offline had no program; delivered receipts after setOffline stalled.
- media_assets 58: image/video columns with size bounds and view-once photo typing; owner staging 40 objects/512MiB (E_ASSET_TOO_LARGE) blocked reseeds and sample-50 media (snapback2-defect).
- background_work 80: schedule expireMessage on messages at .expiresAt and schedule dailyDigest every 2m are first-class; push is effect notify with a dummy https://api.example.com grant.
- client_integration 44: Metro alias to dist/react.mjs (snapback2-defect) and the 256-sub crash; essay calls the React web story unfinished versus the package DOM template. RN-web fill is mixed attribution.
- diagnostics_dev_loop 80: snapback2 check named rewrites (E_CONSTRAINT, E_RULE, E_STRUCTURAL_COUNT, E_ASSET_TOO_LARGE); first hours were certifying indexes and the reserved read column (essay).
- scale_and_limits 40: Following-feed first 500 failed 4MiB certification (feeds.q first 360), so the 500-follow probe cannot be one merge. Scale replay aborted in progress (receipt pass=false).
- operations 55: Seed via the write path and owner restart worked; reset wipes the store; the asset ceiling blocked reseeds; the :49402 scale owner never finished invariant verification.

**convex**

- overall 78: Anonymous Convex 1.45.0 made live multi-client cheap and carried M1–M8 web green plus a passing 167157-action scale replay; password auth, wall-clock queries, and offline were hand-rolled.
- setup_and_docs 68: CONVEX_AGENT_MODE=anonymous plus hidden --local-cloud-port from package source, not getting-started docs; dashboard bound :6790 with no published relocate flag (final-report).
- data_modeling 76: TypeScript defineTable plus indexes expressed users, follows, and messages; uniqueness is mutation-checked indexes. Feed is scan-and-filter feedEvents, not fan-out-on-write (essay).
- authorization 70: Trust boundary is sessionUser plus ConvexError in each mutation; view-once and delete use media.accessCheck. No policy language, but M1–M8 greened including membership cutoff.
- queries_and_live 84: useQuery subscriptions greened two-browser live through M8, including unread sync. Queries do not re-run on wall clock (typing TTL, expiry) — convex-defect; client-filtered until.
- writes_and_transactions 88: Mutations are the idempotent set-state home (clientId/mutationId lookup-or-insert); sample-50 and starter logs settled on mutation ack, not replica lag (essay).
- offline_sync 46: No platform outbox; durable localStorage queue plus 400ms flusher. M6/M8 web choreo greened including dual-offline; that is agent cache, not Convex sync (diary M6/M8).
- media_assets 78: generateUploadUrl and storage.getUrl covered avatars, posts, and backgrounds; view-once refusal is an HTTP accessCheck query, not a storage ACL (convex/media.ts).
- background_work 72: cronJobs interval every 2 minutes runs digest; replay-mode is appConfig. No row-at-expiresAt timer — disappearing and typing are query-time plus client filter (essay).
- client_integration 82: convex/react useQuery plus ConvexHttpClient/HTTP actions for API.md. Auth lifecycle is a hand-rolled token table. RN-web aria gaps attributed agent-error, not Convex.
- diagnostics_dev_loop 74: convex dev push is save-and-run; the 16 MiB function read limit appeared only at named-O5 take(4000) (convex-defect). No EXPLAIN in the inner loop (essay).
- scale_and_limits 72: Scale instance settled 167157 actions with 0 fails and named O5 pass in 2222s. Busy-chat count needed paginated messagePage after 16 MiB collect(); celebrity feed remains scan-capped.
- operations 70: A fresh scale instance required a second project directory (.convex/local/default); seed is the mutation path. Dashboard :6790 sat outside assigned ports. No SQL dump for exact counts.

**supabase**

- overall 47: GoTrue plus Postgres expressed accounts and the relational model in M1; hosted-without-CLI Realtime, offline, storage revocation, and cron became a Node sidecar, and choreography died after M1.
- setup_and_docs 66: Email/password and admin JS paths were documented and greened M1. Hosted buckets/Realtime without the CLI is thin (diary M1); this lane never ran supabase start or Edge deploys.
- data_modeling 86: Unique DM pairs, membership-at-send receipts, GIN tsvector prefix search, and denormalized insight counters in schema.sql — ordinary Postgres, no document-store fight (essay).
- authorization 56: GoTrue bcrypt/JWT/admin.signOut global covered identity. Who-can-read-what lived in Express CliqueService, not RLS — hosted RLS plus Realtime was not operated without the CLI (essay).
- queries_and_live 38: Subscribed to postgres_changes, then polled (setInterval 400–1500ms) after EventSource exhausted HTTP/1.1. M1 live profile greened; M2/M3 choreo missed live media, tabs, and DM bubbles.
- writes_and_transactions 84: INSERT ON CONFLICT mutation ids and UPDATE last-write-wins in the Node service; suite writes through M8 passed. Idempotency is SQL, not a supabase-js primitive.
- offline_sync 38: No outbox; src/offline.ts localStorage queue/cache and a second client prefix-search. Essay: Snapback prices this as config, Convex as not-offline-first, Supabase as bring-your-own.
- media_assets 52: Admin JS created clqfg_media; signed URLs documented. View-once and delete-for-everyone fetch refusal required an API byte proxy (essay). Hosted fetch failed on re-upload was environment.
- background_work 30: No CLI means no Edge Function cron. Digest and disappearing sweepers are setInterval in server/index.mjs. Push seam is a table log, presence a heartbeat (final-report gaps).
- client_integration 40: Product client is fetch plus poll against Express, not supabase-js hooks. JWT session had to be mirrored into localStorage across Expo remounts (agent-error); no paved Expo realtime path used.
- diagnostics_dev_loop 60: Postgres errors and PATCH 400s were inspectable. Hosted Realtime and storage were opaque without CLI; M3 suite needed a storage fetch failed retry (environment).
- scale_and_limits 34: Scale replay on tenant scale started then was killed for hosted-project contention with choreography; invariant verification never ran (final-report, run-log 1788652740).
- operations 58: Prefix clqfg_ DDL over DIRECT_URL and drop-prefix cleanup worked (20 tables). Shared hosted project plus non-namespaced auth.users made a second instance a bad neighbor.

### muse

**snapback2**

- overall 78: All milestones green plus full 167k replay PASS; the outbox repaid the probing tax, but a third of build time derived undocumented contracts from behavior.
- setup_and_docs 38: Template plus fast check started quickly, but dev/reset have no --help, reset kept seed rows, and grants/outbox/drain/lease semantics came only from probes.
- data_modeling 85: schema.q joins express thread, feed, and counts as one declaration; check catches shape errors; windows, TTLs, and tokens stay declarative in server time.
- authorization 80: Identity plus handle index came free; membership-gated URLs and the VIEW_ONCE_CONSUMED gate split cleanly, though grant minting stays an uncited ritual.
- queries_and_live 55: Join-heavy live thread is one declaration, but capped streams carry no backfill cursor, display thread caps at newest-30, and the navigator lock starves second pages.
- writes_and_transactions 85: Server-time deadline windows, idempotent set-state toggles, sid resend dedupe, and FIFO outbox carried a 167,157-action replay with zero failures.
- offline_sync 92: Durable FIFO idempotent outbox with restart recovery arrived as platform capability; M6 asserted peer-visible order, blindness, and receipts without writing queue code.
- media_assets 80: Credentialed membership-gated URLs render real bytes and tombstone plus asset refusal works, but the viewed-guard lives only in .d.ts prose without refusal codes.
- background_work 45: Disappearing TTLs are declarative, but push is a recordNotified stub and the M8 suite shows insights only, with no digest or trending implementation evidenced.
- client_integration 65: Template plus browser-free protocol suites excel, but resume-cap stalls need surgical recovery, the second page boots memory-only, and aggregates must gate quiescence manually.
- diagnostics_dev_loop 50: check is fast and precise, yet truncated 120-char miss lines caused four misdiagnosed loops while byte, echo, and grant seams surfaced without codes or docs.
- scale_and_limits 78: Full replay PASS near 160/s with 10/50/final checkpoints green; capped by newest-30 display history and a member-list read path recorded as a gap.
- operations 60: Isolated backends spin up cheaply and replay ran pristine, but reset left seed rows, lifecycle flags are undiscovered, and fresh instances mean separate project dirs.

**convex**

- overall 82: Every milestone green with a fully verified 167k replay; fastest online-first downhill run, charging only at hand-rolled auth and hand-built offline.
- setup_and_docs 85: Anonymous local binary on two ports behaved like an appliance; docs answered needs except the undocumented dynamic-import ban and isolate-swallowed error codes.
- data_modeling 80: Schema as code with indexes beside queries and set-state intents mapping 1:1; loops replace GROUP BY and materialized views, which the envelope must judge.
- authorization 85: Membership lookup inside each query unifies reads and live updates; per-fetch mediaServe checks re-run expiry and membership, refusing with 410 after delete.
- queries_and_live 85: Subscriptions carry DMs, receipts, member changes, and feeds with the feed query as contract; only typing needs a table-plus-expiry workaround and one settling flake.
- writes_and_transactions 88: Idempotent set-state intents with client mutation IDs, DM keys, send idempotency keys, server-time windows, and tombstones; replay settled 167,157 of 167,157.
- offline_sync 35: No durable cache, queue, presence, or conflict story exists; snapshot store, ordered outbox, blob cache, and LWW are hand-built client code, the B4-30 shape.
- media_assets 88: Upload-URL pattern composed with send with almost no ceremony; per-fetch authorization made tombstone and view-once refusal fall out of one function, green first-attempt.
- background_work 75: ctx.scheduler kept expiry, purge, and digest in-band with idempotent per-period rows and a replay flag; digest was built but never run on shortened config.
- client_integration 70: Web hooks, snapshots, and flush are strong, but RNW twice dropped legacy a11y props blinding choreography, and simulator proofs stay ABSENT after a boot TypeError.
- diagnostics_dev_loop 72: Errors are accurate though codes need the [CODE] convention; the isolate ban burned twenty minutes, and per-query operation budgets guided verification rework honestly.
- scale_and_limits 85: Full replay settled with 67/67 verification including every named O5 fixture exact; only full-table collects exceed per-query budgets, forcing driver-stepped counting.
- operations 72: Local appliance with idempotent seed and lane-untouched scale copy; dashboard port is unmanaged and one unlogged mid-run reset wiped posts, costing residue diagnosis.

**supabase**

- overall 62: All web milestones green with the strongest scheduled-work story, but the full replay never completed, native failed on version skew, and one like-count flake stays open.
- setup_and_docs 70: Auth signup with instant sessions and RLS was fastest to M1 green, but shared-project residue forced a prefix move and shortened-config wiring was lane-built, not documented.
- data_modeling 85: Tables, policies, functions, triggers, and cron carry the app; window-function pagination, partial indexes, and on-conflict upserts made replay idempotent almost by accident.
- authorization 86: RLS turns row visibility into declarative SQL enforced on every path; member-add, edit-window, and revoked-Bearer [REDACTED] each took a few testable lines.
- queries_and_live 72: Feed RPC cursor pagination and broadcast typing fit well, but convergence is hand-built sync with commit gates, reconnect retries, DELETE routing fixes, and history paging.
- writes_and_transactions 75: Set-state intents, arrival-time created_at with send cap, and transactional functions are solid, but a second-send queue drop and the open m8-a02 like flake weigh down.
- offline_sync 40: Queue, pending states, flush order, and durable web restart are entirely hand-built client code on AsyncStorage, with simulator proofs not-recorded and backfill ghosts removed.
- media_assets 75: Authed upload endpoint into a prefixed bucket with unique paths fixed a silent identical-bytes dedupe; view-once revocation works, but the seam caused the nastiest bug.
- background_work 85: digest_tick and expire_tick in plpgsql on pg_cron are transactional with zero-activity skip and idempotent re-tick, exercised firsthand with exact counts and no double-emit.
- client_integration 62: Thin lane server over a 1671-line hand sync store with coalescing and slim-restore; most effort went to client contracts, and native is blocked by RN versus Expo skew.
- diagnostics_dev_loop 68: Postgres and RLS errors are testable, but the hardest bugs sat at seams far from cause, and the repeat-run likes-received stall remains an open flake.
- scale_and_limits 30: Full 167,157-action replay never completed with no checkpoint receipt; hosted-auth throttling near 30 signups per 5 minutes paced registers, leaving sample-50 as the only green.
- operations 70: Versioned idempotent seed verified 18/18 exact and the closing prefix drop verified zero remaining objects, but fresh instances must be constructed and auth.users stays shared.

