# Clique full run: builder-model scores (0–100)

Scorers: astra = gpt-6-astra, grok = grok-4.6, muse = muse-spark-1.3. Each model scored from its own three lanes' narrative files only; read-only sessions at xhigh.

## Overall (holistic)

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 80 | 67 | 48 | 65 |
| convex | 82 | 80 | 82 | 81 |
| supabase | 76 | 49 | 72 | 66 |

## By category (mean across scorers, then each scorer)

### setup_and_docs

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 78 | 78 | 58 | 71 |
| convex | 84 | 68 | 80 | 77 |
| supabase | 87 | 68 | 65 | 73 |

### data_modeling

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 76 | 77 | 82 | 78 |
| convex | 91 | 81 | 80 | 84 |
| supabase | 94 | 88 | 86 | 89 |

### authorization

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 91 | 80 | 90 | 87 |
| convex | 84 | 70 | 68 | 74 |
| supabase | 81 | 56 | 85 | 74 |

### queries_and_live

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 78 | 86 | 38 | 67 |
| convex | 90 | 83 | 88 | 87 |
| supabase | 75 | 40 | 70 | 62 |

### writes_and_transactions

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 92 | 82 | 55 | 76 |
| convex | 96 | 87 | 86 | 90 |
| supabase | 95 | 82 | 80 | 86 |

### offline_sync

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 80 | 70 | 38 | 63 |
| convex | 50 | 48 | 40 | 46 |
| supabase | 50 | 34 | 40 | 41 |

### media_assets

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 94 | 85 | 45 | 75 |
| convex | 78 | 76 | 88 | 81 |
| supabase | 78 | 52 | 76 | 69 |

### background_work

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 94 | 62 | 38 | 65 |
| convex | 90 | 77 | 80 | 82 |
| supabase | 76 | 33 | 85 | 65 |

### client_integration

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 73 | 84 | 42 | 66 |
| convex | 87 | 87 | 70 | 81 |
| supabase | 69 | 41 | 68 | 59 |

### diagnostics_dev_loop

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 80 | 84 | 45 | 70 |
| convex | 88 | 73 | 70 | 77 |
| supabase | 86 | 54 | 68 | 69 |

### scale_and_limits

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 82 | 30 | 20 | 44 |
| convex | 83 | 71 | 85 | 80 |
| supabase | 80 | 44 | 40 | 55 |

### operations

| Backend | astra | grok | muse | mean |
|---|---|---|---|---|
| snapback2 | 85 | 78 | 65 | 76 |
| convex | 88 | 73 | 80 | 80 |
| supabase | 82 | 51 | 62 | 65 |

## Verdicts

- **astra on snapback2:** Snapback supplied the most integrated offline and revocable-media primitives, with meaningful certification constraints and client-state complexity. Would use again for: I would use it again for apps needing offline collaboration, revocable media and scheduled jobs, with early validation on the target devices and corpus.
- **astra on convex:** Convex provided the most straightforward connected application workflow, with durable offline behavior its largest missing subsystem. Would use again for: I would use it again for messaging and collaboration products centered on typed transactions and live queries, with explicit provision for durable offline storage.
- **astra on supabase:** Supabase was a strong relational foundation whose managed services saved work, while this architecture retained extensive synchronization and process responsibilities. Would use again for: I would use it again for relational social products with reporting and custom server workflows where owning the synchronization layer is acceptable.
  - (astra) All three report M1–M6 and M8 web green; Supabase subsequently obtained both native proofs, while the other lanes' incomplete native qualification does not establish backend incapability.
  - (astra) Snapback's integrated carrier, asset authority and resumable jobs removed infrastructure, but its explicitly attributed conditional-envelope defect and canonical-history certification refusal warrant backend deductions.
  - (astra) Convex's transaction/subscription workflow minimized connected-client coordination; Supabase's relational querying was especially direct, while its chosen polling/API/worker design provides no evidence that Supabase Realtime or alternative scheduling surfaces were unavailable.
  - (astra) Convex and Supabase receive equal offline penalties for supplying no integrated durable queue/query store through the exercised surface, with Supabase's native success establishing feasibility through additional application work.
  - (astra) Overall scores are holistic rather than category averages, and scale judgments use verified coverage and documented constraints rather than local-versus-hosted timings, correction counts or agent/environment/ambiguous failures; M7 was untested throughout.
- **grok on snapback2:** The most Clique-shaped language of the three until cap-50 merge/fan-out and 4 MiB closures refuse the brief's envelope and some row shapes. Would use again for: A live, permissioned, media-bearing messenger whose follow graph and query closures fit the cap-50 / 4 MiB grammar, not the celebrity envelope.
- **grok on convex:** The only backend that carried M1–M8 and M7 to web green, including named-O5 scale, with taxes on auth, wall-clock queries, and collect() budgets. Would use again for: A multi-client live Clique including scale replay, accepting hand-rolled password auth, a DIY offline queue, and scan-capped feeds.
- **grok on supabase:** Auth and SQL modeling were easy; live, offline, media revocation, and scheduled digest were a Node sidecar the published JS client did not provide. Would use again for: A refresh-OK CRUD social app on Postgres and GoTrue, not a WhatsApp-shaped green bar of two-browser liveness and an offline queue.
  - (grok) Live two-client updates were the query you already wrote on Snapback and Convex; on Supabase they became short polling after hosted Realtime was abandoned.
  - (grok) Password auth was use identity or GoTrue; Convex 1.45.0 had none, so every scale register paid scrypt.
  - (grok) Only Convex finished the 167k-action envelope (with a 16 MiB collect workaround); Snapback's merge/fan-out cap 50 cannot project 500 follows or 900 celebrity followers; Supabase's replay was killed for hosted contention on a 15-client pooler.
  - (grok) Offline writes were a Snapback client seat that still missed M7 under Playwright setOffline versus client.offline(); Convex and Supabase both authored localStorage queues.
  - (grok) M7 was a reviewed maintain rebuild on Snapback, an optional field plus mutation backfill on Convex, and an ALTER+UPDATE on Supabase whose live observation then fought the session pooler.
- **muse on snapback2:** Secure replay-friendly core whose sync timing failed the realtime tail on a loaded box. Would use again for: M1-M4-style offline-tolerant data cores where a quiet box and documented drain behavior are guaranteed.
- **muse on convex:** Fastest to correct realtime single-device app, charging exactly at identity and disconnection. Would use again for: Online-first social apps with custom client APIs where offline is a hand-built queue, not a platform.
- **muse on supabase:** Fastest relational core with superb Auth/RLS/SQL and cron, paced by hosted rate limits and hand-built sync. Would use again for: Relational apps with auth, media and scheduled jobs where bulk signup and realtime convergence are not the bottleneck.
  - (muse) Only Convex reached the envelope with 167157/167157 settled and 67/67 verification, while Supabase stalled on hosted-auth throttling and Snapback never replayed.
  - (muse) Offline split them most: Snapback promised sync yet blocked M6/M8 on serial-drain timing, while Convex and Supabase hand-built queues and went green.
  - (muse) Authorization inverted the work: Snapback inherited viewer gating, Supabase declared a few RLS lines, and Convex hand-rolled bcrypt per function.
  - (muse) Background work favored SQL and scheduler backends with transactional pg_cron and in-band ctx.scheduler over Snapback effects that gated the drain.
  - (muse) Client mass followed the gap: Snapback paid sync forensics and blob plumbing, Convex paid contract surface and offline store, Supabase paid seam and commit-gate fixes.

## Notes per category

### astra

**snapback2**

- overall 80: M1–M6/M8 web milestones passed with integrated authorization, assets, offline storage and jobs. M5's resume defect and M6's canonical-history certification workaround are substantive backend friction; native and browser-scale failures remain ambiguously attributed.
- setup_and_docs 78: M1 diary credits the generated auth/media template. M5–M6 describe thin partial-envelope guidance, signup requiring subsequent login for replay grants, and an unavailable Expo guide that sent the builder to public declarations.
- data_modeling 76: M2/M8 diary praises maintained counters and colocated rules. M3 records expression-only functions and unavailable list concatenation. Quarry's explicitly bounded program shapes add modeling constraints; logged syntax mistakes are not counted as backend defects.
- authorization 91: M3/M5 diary: schema membership rules, recipient incarnations and asset authority enforced removal, administration and per-recipient access. Receipt certification required the conversation authorization key, making the trust boundary explicit.
- queries_and_live 78: M2/M5 delivered live cursor feeds and shared offline prefix search. M6 run-log explicitly marks the 26,631,248-versus-4,194,304 canonical-history closure refusal a platform gap, forcing separate authoritative receipt queries.
- writes_and_transactions 92: M2/M4/M6 diary records idempotent set-state mutations, server-time enforcement and ordered durable replay. The final report verifies all 167,157 scale actions; duplicate pre-mutation uploads were explicitly an agent error.
- offline_sync 80: M5–M8 supplied durable outbox, retained data and shared local search for passing web convergence. M5 run-log attributes conditional-envelope resume refusal to snapback2-defect; interpreting partial coverage remains application work. Native failures retain their integration attribution.
- media_assets 94: M1/M4/M5 diary: typed uploads, authenticated bytes and schema-owned view allowances handled media and revocation directly; repeated photo fetch was refused. M6 native helper misuse is explicitly agent-error, not a demonstrated storage defect.
- background_work 94: M5/M8 diary and report: row timers, maintained aggregates and resumable digest jobs passed closed-client owner-restart verification with idempotent provider emission. Digest message processing still traverses the corpus in bounded chunks.
- client_integration 73: M5/M6 diary: carrier integration supplied persistence, but queued connected writes, partial results and restoringViewer required explicit UI coordination. Web milestones passed; agent/environment/ambiguous native failures do not warrant a native-defect penalty.
- diagnostics_dev_loop 80: M2/M5/M8 logs show useful type/closure diagnostics and isolated clock testing. The conditional-envelope refusal required application reproduction and recovery; the diary describes insufficient guidance for interpreting these states.
- scale_and_limits 82: Final-report: full replay invariants and all backend degradation ratios passed. Declared 500-follow/100-membership bounds cover the named probe but constrain headroom. Browser sync/send timeouts remain ambiguous integration findings, not established backend failures.
- operations 85: M2/M4/M8 logs record reviewed migrations, resumable backfill and durable owner restart. M6 public upload-list/discard APIs recovered abandoned objects. Independent instances and complete replay auditing worked; M7 and deployment operations were untested.

**convex**

- overall 82: M1–M6/M8 demonstrate a productive connected application core with no established backend defect. Typed transactions, subscriptions and scheduling fit directly; durable offline storage and specialized media delivery remained substantial application responsibilities.
- setup_and_docs 84: M1 diary/run-log: anonymous CLI supplied backend, storage and scheduling; authentication required provider/key/session setup and package-source lookups. Installation corruption, Node selection and routing failures were agent/environment issues.
- data_modeling 91: M2/M3/M8 diary: familiar TypeScript functions kept membership checks, recipient capture and transactional counters together. Relational joins and receipt aggregation remained explicit application code, without a demonstrated expressiveness refusal.
- authorization 84: M1/M3 diary: shared authorization helpers enforced membership, while immediate token revocation required live authSessions checks. Duplicate-account behavior needed customization; incorrect provider configuration was an agent error.
- queries_and_live 90: M1–M3 diary: subscriptions propagated profiles, feeds, messages and watermarks without separate invalidation plumbing. Final-report search pagination and screen-history caps are implementation limitations; M5 required separate offline search semantics.
- writes_and_transactions 96: M2/M3/M8 diary: atomic mutations combined DM deduplication, recipient capture, intent ledgers, counters and scheduling. Full replay independently verified all 167,157 actions; no transaction defect was recorded.
- offline_sync 50: M5/M6 diary and essay: no integrated durable queue or native local database; account caches, ordered outbox, media persistence and expiry enforcement were authored separately. Web convergence passed; unfinished native proofs do not establish a backend defect.
- media_assets 78: M4/M5 diary: ordinary storage upload/delete was compact; recipient-specific view-once delivery required a consuming claim/action and transient bytes. Durable media storage and revocation-aware client caches remained application work.
- background_work 90: M3/M8 diary: scheduling supported typing cleanup, expiry and per-user digest jobs without a separate worker service. Real scheduled emission passed; final-report restart-deduplication verification remained incomplete, without an observed scheduler defect.
- client_integration 87: M1–M3/M8 diary: React query subscriptions made connected multi-device behavior direct. M6 required session-aware persistence and native lifecycle glue; the React Native window crash is explicitly agent-error.
- diagnostics_dev_loop 88: M1/M8 logs describe generated types, watcher deployment and explicit BadAdminKey/function-not-found refusals supporting correction. Final-report attributes all 29 correction episodes to agent/environment causes, with no demonstrated Convex defect.
- scale_and_limits 83: Final-report: full replay, deep paging, 500-follow and celebrity read/write probes passed. Trending's strict midpoint check failed. Cold-sync memory and busy-group visual behavior were unmeasured; no backend capability ceiling was established.
- operations 88: M8 essay/report: isolated local instances, snapshot export/import and paginated idempotent backfills supported restoration and independent verification. BadAdminKey protected against wrong-instance use; deployment races were agent errors. Hosted operations and M7 were untested.

**supabase**

- overall 76: M1–M6/M8 web and eventual native proofs demonstrate feasibility. SQL, managed auth and Storage fit well, while synchronization, authorization composition and worker infrastructure remained application-owned. No Supabase defect was established.
- setup_and_docs 87: M1 diary/essay: documented managed auth, Storage and hosted SQL were straightforward. Immediate signup used admin createUser followed by password sign-in; shared-project namespacing and the unavailable local CLI were deployment-context requirements.
- data_modeling 94: M2/M3/M8 diary: SQL joins, feed UNIONs, unique composite keys, recipient ledgers and aggregate reporting mapped naturally to the product. The canonical mutation function reused these rules across ordinary writes and replay.
- authorization 81: M1/M3–M5 diary: membership predicates and atomic view ledgers worked; immediate logout required a deny list, and private assets needed an authenticated authorization route. Evidence covers API-owned policies across several entry points.
- queries_and_live 75: M2/M5 diary: relational feeds and indexed prefix search were expressive; live projections used authored polling and offline search duplication. Realtime was unexercised. M4 polling starvation was agent-error and receives no backend-defect penalty.
- writes_and_transactions 95: M2/M3/M6 diary: SQL transactions, unique pairs and an intent ledger handled recipient capture and retry safety. Final-report audits all 167,157 ordered settlements; replay uses the canonical app mutation with disclosed staged transport.
- offline_sync 50: M6 diary/native follow-ups: ordered outbox, per-user history, media files, search and revocation policy were authored separately. Both native proofs eventually passed; the exercised SDK supplied no integrated offline queue or local query store.
- media_assets 78: M4/M5 diary: Storage upload/download was straightforward. Membership revocation and expiry required an authenticated proxy; view-once required atomic consumption records and transient client bytes. Ordinary offline media persistence was application-owned.
- background_work 76: M8 diary/essay: SQL aggregates and unique period/emission records supported a closed-client digest restart and authorization proof. Scheduling, connection tracking and push emission used an application-owned Node worker/provider seam.
- client_integration 69: M1–M6 diary: managed auth/Storage integrated with Expo, but API transport, polling, token refresh, reconnect and persistent caches needed explicit wiring. Final-report confirms native proofs passed after application fixes; Realtime was not exercised.
- diagnostics_dev_loop 86: Scale run-log: EXPLAIN, relational audits, explicit expired-principal refusal and accurate rate-limit documentation supported diagnosis. The pool crash resulted from an omitted error handler, not a demonstrated Supabase defect.
- scale_and_limits 80: Final-report: 167,157 actions and 1,002 chats verified after recovery; 7/9 read comparisons passed. Documented Auth limits required pacing. Midpoint misses remain ambiguous; staged replay and absent celebrity-write/cold-sync proofs qualify confidence.
- operations 82: M6/M8 and scale report: SQL migrations, durable settlement receipts and exact catalog/identity audits enabled recovery and verified cleanup. Hosted Auth, buckets, schemas and the local API required separate lifecycle management.

### grok

**snapback2**

- overall 67: Quarry expressed Clique directly (M1–M2 green; M3–M8 suites pass), but merge/fan-out cap 50 refuses the 500-follow envelope and E_BOUND/E_OPERATOR_REQUIRED forced splits.
- setup_and_docs 78: init --template chat and guide auth mapped onto M1; the chat template still used avatarUrl strings, and seeds refused 60_000 integer syntax (diary M1).
- data_modeling 77: Unique indexes, maintain counts, merge lanes, and wordPrefixes declared the model; M7 E_BOUND refused poll columns on retained messages.thread (7.2 MiB / 4.2 MiB).
- authorization 80: Membership rules (read <- exists memberships) mapped DMs/groups; write-rule vs unique unreadCounts is the Snapback RLS analogue (essay), though that loop was attributed agent-error.
- queries_and_live 86: Live queries and channel typing ttl 5s were defaults; after c last 20 pages feeds, but following-feed merge is first-50 follow lanes and thread+image joins hit E_BOUND.
- writes_and_transactions 82: Generated mutations plus unique mutationId indexes matched set-state intents; starter-m3 seed became idempotent once unread rows were writable (diary M3).
- offline_sync 70: SnapbackProvider offline={{}} is first-class; M7 m7-a05 stayed red because Playwright setOffline is not client.offline() (run-log ambiguous).
- media_assets 85: image/video columns and image once made avatars, chat media, and view-once a flag, not a bucket policy; thread queries fetched media separately after E_BOUND.
- background_work 62: digestPulse every 2m exists, but follower fan-out is E_STRUCTURAL_FANOUT without cap 50 by followed, and dropTrending is E_OPERATOR_REQUIRED (snapback2-defect).
- client_integration 84: snapback2/expo SnapbackProvider and generated api.* served web, seed, and custom-client-demo; Expo/Playwright fights were attributed agent-error, not the owner.
- diagnostics_dev_loop 84: snapback2 check fails closed with E_BOUND, E_STRUCTURAL_FANOUT, E_CONSTRAINT, E_SUCCESSOR_DESTRUCTIVE; the previous generation keeps serving until --apply-migration.
- scale_and_limits 30: Following-feed merge and write fan-out cap at 50; u0500's 500 follows and u0900's 900 followers cannot be projected. Scale.log was not replayed (final-report).
- operations 78: Write-path seed, per-directory owner, and M7 --apply-migration rebuilt messageCounts (backfilledMaintains=2); a fill-job over membership-scoped messages refused E_STEPS.

**convex**

- overall 80: M1–M8 and M7 went web-green including named-O5 scale (167157 actions); taxes were hand-rolled scrypt auth, non-ticking queries, a DIY offline queue, and the 16 MiB collect cap.
- setup_and_docs 68: CONVEX_AGENT_MODE=anonymous plus hidden --local-cloud-port came from package source, not getting-started; the dashboard still binds ~6790 with no published relocate flag.
- data_modeling 81: Typed tables, indexes, and mutations fit Clique's shallow graph (ctx.db.get as join); unique DM pairs were pairKey indexes, not SQL constraints (schema.ts).
- authorization 70: Trust is sessionUser inside every mutation returning ConvexError; there is no row-policy language, and tokens are function args because 1.45.0 has no email/password auth.
- queries_and_live 83: useQuery made two-client live a return-shape problem; typing/expiry needed client filters because queries do not re-run on wall clock (run-log convex-defect).
- writes_and_transactions 87: Mutations with clientId/mutationId lookup-or-insert matched fixture set-state; sample-50 and starter logs settled by waiting for the mutation (essay).
- offline_sync 48: No platform outbox; M6/M8/M7 used a durable localStorage queue plus 400ms flush because React online missed Playwright setOffline (diary M6).
- media_assets 76: generateUploadUrl plus storage.getUrl covered avatars/media/backgrounds; view-once was an HTTP accessCheck that collect()s messages, not a storage policy (media.ts).
- background_work 77: cronJobs().interval ran the 2-minute digest and 1-minute expiry recount; presence and the push seam were documents/mutations, not a job system (essay).
- client_integration 87: useQuery is the product surface; ConvexHttpClient plus /api/* HTTP actions satisfied custom-client-demo without a second gateway (essay).
- diagnostics_dev_loop 73: convex dev push is the loop; inherited ctx.db.get unions forced --typecheck disable, and there is no EXPLAIN before a query hits the byte budget (M7/final-report).
- scale_and_limits 71: Fresh scale-instance/ replay settled 167157 with named O5 pass; take(4000) on the busy chat hit the 16 MiB read cap (convex-defect) and had to paginate from Node.
- operations 73: Anonymous sqlite in .convex/local/default; a second instance is a second directory. M7 was optional messageCount plus backfillMessageCounts, not transactional DDL (M7 diary).

**supabase**

- overall 49: GoTrue and Postgres modeled M1 and the schema easily; after that, live, offline, view-once refusal, and digest were a Node sidecar, and only M1 (plus later M7) choreography went green.
- setup_and_docs 68: @supabase/supabase-js 2.112.4 Auth and DDL over DIRECT_URL were straightforward; hosted-without-CLI docs for buckets/Realtime were thin, and Edge Functions were never deployable (diary M1/M8).
- data_modeling 88: Unique DM pairs, membership, denormalized counts, and a GIN tsvector were ordinary Postgres; none of that fought the author the way a document store without unique constraints would (essay).
- authorization 56: GoTrue handled signup/JWT/revocation; data rules lived in a Node API (server/service.mjs), not RLS, because hosted Realtime+RLS was judged inoperable without the CLI (essay).
- queries_and_live 40: Feed/history SQL was easy; two-client live became setInterval after postgres_changes was abandoned and EventSource stalled PATCHes. M2/M3 choreography never greened (final-report).
- writes_and_transactions 82: INSERT ON CONFLICT and mutation-id unique indexes expressed idempotent set-state; hosted storage fetch failed on re-upload was attributed environment and retried (M3 suite).
- offline_sync 34: No outbox: src/offline.ts is localStorage queues plus a second client word-prefix search to match server tsquery (essay; diary M5/M6).
- media_assets 52: Private clqfg_media and signed URLs worked; view-once/delete-for-everyone fetch refusal required an API byte proxy, not a storage policy primitive (essay; diary M4).
- background_work 33: Digest and disappearing sweepers are setInterval in the Node process; with no CLI there were no Edge Functions or hosted cron (diary M8; final-report gap 4).
- client_integration 41: The Expo app never used supabase-js hooks; it fetches the sidecar on 49600. Session had to be mirrored into localStorage across remounts (agent-error) (essay).
- diagnostics_dev_loop 54: Postgres EMAXCONNSESSION (pooler 15) was clear; hosted storage fetch failed and Connection terminated unexpectedly on snapshot compare were not (M7 run-log).
- scale_and_limits 44: SQL would express 500 follows; replay started then was killed for hosted contention (environment). The session pooler cap of 15 starved two-client plus nested suites (M7).
- operations 51: Idempotent seed and ALTER ADD COLUMN plus UPDATE backfill were honest; prefix drop worked. Shared project plus 15-client pooler made reset and M7 observation the real tax.

### muse

**snapback2**

- overall 48: M1-M4 green on little Quarry code, but M5 1/4 after 13 attempts blocked M6/M8 and scale never ran.
- setup_and_docs 58: Tight edit-.q/check/reload loop and durable owner (200 in 113ms after 7h), but drain semantics undocumented, validator found in minified code, no substr.
- data_modeling 82: Schema-plus-rules as one Quarry unit (~1000 lines) with cert-time checks; paper cuts only: no substr, immutable reaction at, setWindows strictness.
- authorization 90: Viewer-gated rows refused cross-user DM by construction (E_AUTH_REQUIRED/SUPERSEDED fell out); token API inherited, residual Bearer-after-delete risk only.
- queries_and_live 38: Live pushes cluster ~15s, cold sync 10-25s and live-query 15-21s; WarmSyncBeat cut observer to 618ms but choreo still timed out.
- writes_and_transactions 55: clientKey idempotency made seeds converge cheaply, but browser settlement 30-60s vs 16ms node plus E_OFFLINE_CONFLICT marks hurt.
- offline_sync 38: Native drain is serial and contended; M5 search/view-once/disappearing failed warm (1/4 runId 96584b9b) and M6 web never attempted.
- media_assets 45: Tokenless /api/asset 404 E_ASSET_NOT_READY forced blob-URL choke plus 45s retry; old Bearer resolvability flagged as residual risk.
- background_work 38: Notify effect blackholed drains 30s per mutation; purge proven separately but digest/insights unbuilt (13-line stub) and M8 blocked.
- client_integration 42: Generated api.d.ts helped, but great inversion: outbox discipline, paging caps, stash persistence, blob plumbing all bespoke client work.
- diagnostics_dev_loop 45: snapback2 check fast, but invisible drain, minified validator archaeology, and slowness misread as platform slowness slowed fixes.
- scale_and_limits 20: Scale not-run with no replay or verification; 40-message threads melted pre-fix and paging capped at 4.
- operations 65: Idempotent seeds via clientKeys and durable owner handover were excellent; web disposable, M2/M3 receipts missing, plus 351-line harness mutation.

**convex**

- overall 82: M1-M8 green plus 167157/167157 replay with 67/67 verification; taxed only by hand-rolled auth and hand-built offline.
- setup_and_docs 80: Anonymous local binary was appliance-like with zero accounts; cost was undocumented dynamic-import ban and error codes needing CODE convention.
- data_modeling 80: Schema-as-code with adjacent indexes was fast; price was isolate limits (no node:crypto) and loops instead of GROUP BY/materialized views.
- authorization 68: Membership lookups inside queries checked every subscriber, but password auth was hand-rolled pure-JS bcrypt with no built-in credentials.
- queries_and_live 88: Subscriptions carried feeds, DMs, receipts and member changes; M2-M4 mostly first-attempt with one 10s projection retry absorbed.
- writes_and_transactions 86: Set-state intents mapped 1:1 to mutations with client IDs; full replay settled every action with zero failures.
- offline_sync 40: No platform cache, queue, presence or conflict story; entire snapshot store, ordered outbox and blob cache hand-built for green.
- media_assets 88: Upload-URL pattern plus per-fetch mediaServe checks made tombstone and view-once refusal cheapest; M4 green first-attempt.
- background_work 80: ctx.scheduler kept expiry, purge and digest in-band verified with clients closed; digest lacked independent shortened-config run.
- client_integration 70: No REST to hand-write; mass went to testIDs, pending markers and offline store, plus RNW a11y patch and Hermes crypto fallback.
- diagnostics_dev_loop 70: Package source answered everything and fixes landed in minutes once run; per-query operation budget forced driver-stepped counting.
- scale_and_limits 85: Fresh-instance replay settled 167157/167157 in 12.6min and verified 67/67 exact including 500-follow, celebrity and 10k busy chat.
- operations 80: Headless-client replay adapter with settle accounting and push-disable flag worked; minor dashboard-port and unlogged-reset gaps only.

**supabase**

- overall 72: M1-M8 web green with transactional digest/expiry, but full 167k replay never completed and signup throttle paced bulk identity.
- setup_and_docs 65: Auth sessions were instant and M1 fastest, but shared-project prefix collisions and missing windows/digest contract taxed setup.
- data_modeling 86: Postgres window pagination, partial indexes and on-conflict upserts made replay idempotent almost by accident; plpgsql carried jobs.
- authorization 85: RLS enforced membership, edit windows and revoked-Bearer refusal in a few SQL lines no matter which path touched rows.
- queries_and_live 70: Broadcast fit typing and invalidation; history RPC missing expiry columns and open m8-a02 like-count flake (74-to-74) hurt.
- writes_and_transactions 80: Arrival-time created_at with 10s cap plus queues and commit-gated paints; no supabase-defect loops, all fixes agent-error.
- offline_sync 40: No server outbox; AsyncStorage queue, flush order and durable-restart web proof all hand-built client code for green.
- media_assets 76: Authed /api/upload into prefixed bucket went green after unique paths fixed silent identical-bytes dedupe; revocation held.
- background_work 85: pg_cron digest_tick/expire_tick transactional with zero-activity skip; exercise emitted exact 2-2-1-1 then idempotent zero.
- client_integration 68: Thin server.mjs wrapper with gravity in Postgres plus Expo; reconnect resync, pollConvo and commit gates were honest client work.
- diagnostics_dev_loop 68: Hardest bugs sat at seams (dedupe, RPC columns, paint-before-commit); provider never misled, but failures surfaced far from causes.
- scale_and_limits 40: Full replay has no completion receipt; hosted-auth 429s (~30/5min/IP) blocked same-session envelope, only sample-50 50/50 proven.
- operations 62: Fresh prefix plus 49901 constructed isolation and dropped 36 tables/44 funcs cleanly; shared auth.users and residue checks remained.

