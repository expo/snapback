pub const CODES: &[(&str, &str)] = &[
    ("N_OPTIONAL_FILTER_LIMIT", "at most three optional filter inputs get planned presence variants; the named extra filters remain metered residual predicates. Keep them, or split the screen into queries that branch on those inputs. guide reads."),
    ("E_MAINTAIN_READ_RULE", "an aggregate view without read derives the source's rule only when the source is public/allow or every rule field survives as a bare group key. Calendar keys and reference paths do not preserve a source rule field. Add read <- deny, then replace deny with the intended aggregate audience over its group keys; guide maintains."),
    ("E_MAINTAINED_COLUMN_REFERENCE", "a maintained column without by needs exactly one source column referencing its parent table. With none, declare postId: posts on the source; with several, choose one explicitly: likeCount: count likes by postId (or total: sum likes of .weight by postId); guide maintains."),
    ("E_QUARRY_POSITIONAL_SCAN", "positional reads select id or a full unique key; write a predicate read such as posts where .authorId = owner last 20 by .at for a population. guide reads."),
    ("E_VIEW_FEED_SHAPE", "the feed view needs public originals and reposts with actor/time projections and a declared unique follower/followed pair. guide feeds."),
    ("E_MAINTAINED_COLUMN", "a maintained column belongs to the engine; omit submitted values and write the source rows. Parent and source must be ordinary tables outside timelines. Authority, identity, lifetime, delivery and other aggregates cannot depend on it. Use an ordinary column or a separate aggregate view; guide maintains."),
    ("E_POSTGRES_MAINTAINED_COLUMN", "the Postgres evaluation backend does not support maintained columns or their private maintains. Use the SQLite engine for maintained columns; guide maintains."),
    ("E_MAINTAINED_COLUMN_PRIVATE", "no program, native call, rule, constraint, seed, fixture, import, or raw IR or schema can name the parent column's private storage, not even as the system. Read the parent row or write its source rows; guide maintains."),
    ("E_MAINTAINED_COLUMN_RESULT", "write results retain ordinary columns and id but omit maintained columns. Read the row under its read rule; guide maintains."),
    ("N_MAINTAINED_COLUMN_STREAM", "each contributing commit streams the whole parent image per destination partition. Consider the parent's size and update frequency; a hot counter can stay a separate online-only view. guide maintains."),
    ("N_MAINTAINED_COLUMN_DISCLOSURE", "parent readers learn a count or sum, predicate selection and indexed relative order even without source-row read permission. Restrict the parent audience or use a separate aggregate view if that disclosure is unwanted. guide maintains."),
    ("E_SERVER_REQUIRED", "actions, routes and schedules naming an action require use server. One directive in any module (schema.q is usual) enables the whole project; repeating it is harmless. Effects (including secrets, retry, backoff, deadline and cancellation), jobs, schedules naming a job and service seats need no directive. guide actions, routes, language."),
    ("E_HOST_UNICODE", "family store — host NFC normalization is unavailable or disagrees with the contract. Use a browser with standard String.prototype.normalize; the web device will not index text differently from the server. guide search."),
    ("E_QUARRY_BOUND", "a collected population needs a fitting schema cap or an explicit page. Return t where .owner = viewer first 20 by .at after c; declare c: cursor ?. For a total, use count(t where .owner = viewer); for a job, use for row in t:. A mutation loop still needs its whole-group admission proof. guide bounds."),
    ("E_INTERNAL", "an undefined compiler temporary reached the interpreter. The operation and site identify a compiler defect; recompile and report it if it persists. guide programs."),
    ("E_ROUTE_DECLARATION", "a route declaration has invalid syntax, authority, path, work policy or wait, or duplicates a route name or path. Use route name: post \"/hooks/name\", optional as service:<seat>, declared secrets and bounded work clauses. The located diagnostic gives the rewrite. guide routes."),
    ("E_ROUTE_PRIVATE", "a route's private durable handler cannot be admitted through the public action API. Send the request to its declared POST path with session authentication or a valid provider signature. guide routes."),
    ("E_ROUTE_GENERATION", "the route declaration changed or disappeared after this invocation was admitted. The recorded contract cannot run under another declaration; inspect the invocation and reconcile its prior effects before issuing new intent. guide routes."),
    ("E_ROUTE_UNKNOWN", "no route work is available under this name and standing authority. Use the declared path and the original live authority; a fresh sign-in does not restore an old caller's authority. guide routes."),
    ("E_ROUTE_INPUT", "the request does not match the declared POST path or exceeds the route's bounded HTTP envelope. Bodies are at most 64 KiB; headers at most 64 fields and 16 KiB. Send canonical bounded input to the declared route. guide routes."),
    ("E_ROUTE_RESULT", "the route handler did not return a valid bounded Response. Use status 200–599, at most 64 KiB of body and bounded headers, without transport-owned headers. Invalid results fail terminally; reconcile any external effects before new intent. guide routes."),
    ("E_ROUTE_REFUSED", "the route handler raised a plain application refusal. Its redacted refusal is recorded and acknowledged with a bare HTTP 204, so the provider need not repeat it. Inspect why <id> for the stored refusal; infrastructure failures retain 5xx retry behavior. guide routes."),
    ("E_ROUTE_PENDING", "route verification is unavailable or the invocation has not settled within its wait. HTTP 503 asks the sender to retry the same body; this response alone does not prove admission. Provider verification runs afresh before collection. guide routes."),
    ("E_ROUTE_VERIFY", "the provider verifier rejected the request signature. HTTP 403 is returned without durable admission; send a valid signature over the exact body bytes. guide routes."),
    ("E_ROUTE_LEASE", "the verifier claim expired or its fence does not match the current claim. Its response cannot authorize admission; obtain a current verification claim before replying. guide routes."),
    ("E_EFFECT_CANCELLATION", "this effect's admitted policy forbids cancellation; inspect its state with doctor or why."),
    ("E_EFFECT_CANCELLED", "the effect was cancelled; no further claim or settlement is admitted. External effects already performed are not undone."),
    ("E_EFFECT_CLOSED", "family effect — the private generated effect context closed when its handler lifetime or authority ended. Callers must not retain or reuse it after the handler; start work only while its invocation signal is live. guide effects."),
    ("E_EFFECT_DEADLINE", "the effect's admitted deadline passed; it is terminal and will not be claimed again."),
    ("E_EFFECT_ATTEMPTS", "the effect exhausted the admitted attempt limit after a lease expired; inspect the provider before replacing it."),
    ("E_EFFECT_GENERATION", "the effect declaration changed or disappeared after admission. The effect is parked before claim or settlement; inspect its steps and provider outcomes before issuing new intent. guide effects."),
    ("E_RECIPE_RETIRED", "the Following recipe installer is retired. Declare maintain feed: timeline with events, reposts and edges before event and edge data exists; no author count or delivery size is needed. No files were written. guide feeds."),
    ("E_TIMELINE_SIZE", "an older timeline sizing key or value is invalid. Remove authors and size lines; background delivery chooses its bounds. guide feeds."),
    ("N_TIMELINE_COMPAT", "authors and size are accepted for compatibility and do nothing. Remove those lines: background delivery needs only events, reposts and edges. guide feeds."),
    ("E_TIMELINE_FILTER", "the originals filter must be row-local and use immutable columns, except the one-way removal flag. Declare parentId immutable and use events posts where .parentId = null and not .removed by authorId, at removed by removed. guide feeds."),
    ("N_TIMELINE_PROFILE_CAP", "the application's profile cap is lower than the timeline's author cap. Raise the profile cap to the declared author count, or keep the intentional application limit. guide feeds."),
    ("E_TIMELINE_SHAPE", "the declaration does not fit the supported public feed bridge. Use four distinct tables with an explicit public audience and full sync public, no horizon, expiry or maintained definition, and the required identities, keys, ownership and immutability rules; other models need their own bounded serving design. guide feeds."),
    ("E_TIMELINE_FOLLOWS", "the mapped edge table does not fit the supported follower/author mapping. Declare edges follows by followerId, followedId and the required immutable unique pair. The engine chooses delivery indexes and work bounds. guide feeds."),
    ("E_TIMELINE_REMOVAL", "the removal signal must be a required bool default false and may only change false to true. Insert new cards with false, retain removed cards, and use a fresh card for new content. guide feeds."),
    ("E_TIMELINE_READ", "a timeline reads one viewer newest first by time, then event id, excluding tombstoned events. Use NAME[viewer] after c last 20, then shape its event rows. guide feeds."),
    ("E_TIMELINE_OWNED", "timeline rows are engine-owned. Write the mapped application profiles, posts, reposts or follows instead; no principal or application job can write the projection. guide feeds."),
    ("E_TIMELINE_SERVER", "edge changes schedule durable delivery work. Queue a mutation that needs server-only state without predicted rows. Currently held source writes may still predict; materialized delivery runs on the server. guide feeds."),
    ("E_TIMELINE_IMPORT", "a fixture import cannot reconstruct timeline history. Seed mapped rows through application operations, or restore a complete trusted persistence image. guide feeds."),
    ("E_TIMELINE_ACTIVATE", "activation requires empty mapped event and edge tables. Declare the timeline before events or edges exist; in dev use a fresh store. guide feeds."),
    ("E_TIMELINE_REDEFINE", "a populated timeline cannot be removed or redefined because its history cannot be rebuilt. Keep the declaration unchanged, or start a fresh store in dev. guide feeds."),
    ("FEED_APP_NOT_FOUND", "a mapped application profile, card or repost no longer exists. A typed reference does not prove current existence. Refresh the app row, create the caller's profile before registration, or resume the explicit backfill in dependency order. guide feeds."),
    ("FEED_APP_OWNER", "the caller does not own the mapped application profile, post or repost. Call the bridge in the owner's mutation; an application reference is not permission to publish or remove another account's event. guide feeds."),
    ("FEED_APP_EVENT", "the existing recipe event disagrees with the mapped application's author or event time. Stop adoption and reconcile the explicit mapping; do not deliver a second event, retarget an existing one or silently change app identity. guide feeds."),
    // @ref LLP 3000.007#20.3 — only reserved recipe names own global Following explanations.
    ("FEED_EVENT_REMOVED", "an event with this post ID was already removed. Mint a new post ID for a new event; do not resurrect the removed one. guide feeds."),
    ("FEED_ORIGINAL_REQUIRED", "the requested event is a repost. Pass the original event instead; only an original can be reposted or removed through the original path. guide feeds."),
    ("FEED_NOT_AUTHOR", "the caller does not own the event being removed. Remove the caller's own event; the original author can remove the original through its own path. guide feeds."),
    ("FEED_PULL_COUNT_MISSING", "an installed pull route has no matching count row. Repair imported pullCounts to match the reader's installed routes, then retry unfollow with a new write ID. guide feeds."),
    ("FEED_CANNOT_FOLLOW_SELF", "the Following recipe cannot follow the caller's own account. Own posts already use the caller's own delivery lane; follow a different author. guide feeds."),
    ("FEED_AUTHOR_NOT_FOUND", "the target author has not registered in the Following recipe. Register during that author's profile creation, then retry the follow with a new write ID. guide feeds."),
    ("FEED_POST_NOT_FOUND", "the requested source post/event is absent. Refresh the source lookup and pass an existing event reference; a new repost requires a live original event. guide feeds."),
    ("FEED_PULL_CAP", "the Following recipe's reader already pulls 32 shared authors. Free a pull slot by unfollowing a shared author, then retry the refused follow with a new write ID. The app and recipe follow edges were rolled back. guide feeds."),
    ("FEED_PROMOTION_PULL_CAP", "another follower already uses all 32 shared-author slots. The triggering follow and promotion were rolled back; existing followers still receive private pushes. Show this refusal in the app. Have each saturated follower unfollow a shared author, then retry the refused follow with a new write ID. Freeing only the caller's slot cannot fix another follower's full slots; if they cannot free a slot, decline the new follow and keep pushed delivery. Until every saturated follower frees a slot, every later follow refuses the same way and the author stays at 50 followers, gaining no new followers. A server-run query over public follows and pullCounts identifies the blocker by used = 32 in 51 reads (one scan plus 50 count lookups). More than 32 shared authors needs a separate serving design. guide feeds."),
    ("E_QUERY_HELD", "this query is declared held and runs only on the device. Call it with the local client; for server search, use the grouped or newest form in guide search, section Search every chat I'm in. A held read never falls back to the server."),
    ("E_SHAPE_EXCEEDS_METER", "following an inclusive cursor starved the same first returned shape again, leaving an empty page at the same position. The refusal names the read site and meter ceiling (8,192 examined rows). Bound the shape's read with `first N`/`last N`, or move it out of the returned shape; guide reads. If an earlier read spent the meter, the refusal names that read as the one to bound."),
    ("E_INDEX_KEY_BYTES", "family schema — an encoded index key, including its components, encoding overhead and appended id, must fit 2048 bytes on every store; table and index labels together have 512 UTF-8 bytes. Bound indexed text with <=N, reduce the composite key or shorten the labels; check names the column and suggests a bound. Writes enforce the same limits. guide indexes."),
    ("E_WRITE_ID", "family input — write id must be 26 uppercase Crockford base32 digits, starting with 0–7 (the mintId() form). Mint once and keep the id with the intent; guide writes."),
    ("E_WRITE_ID_REUSE", "family input — write id already belongs to a different operation or arguments; retry the original input or use a new id. The original write remains unchanged; guide writes."),
    ("E_WRITE_RECEIPT_EXPIRED", "family input — this client already used the write id, but its receipt is no longer retained; reopen the client to ask the server for the original outcome. The client never admits a known id twice; guide writes."),
    ("E_QUARRY_MODIFIER_SCOPE", "by or matching immediately after an unparenthesized read inside where could belong to the inner or outer read. Parenthesize the inner read, or move the modifier before where; check --fix preserves the inner modifier by adding parentheses. guide reads."),
    ("E_REPLAY_DEV_ONLY", "--replay requires dev without --release; serve and releases always emit effects normally. Use snapback4 dev --replay to suppress new effects and hold schedules; guide replay."),
    ("E_STORE_RESTORE", "family store — the same backend store identity reports a head below this device's watermark. Sync and reads halt; stop the client and use a fresh device store and outbox for the restored backend. A retry or backend adoption does not reacquire the same identity. See `guide sync`."),
    ("E_CURSOR_INDEX", "a cursor needs a declared id or a total unique key, and must retain its argument-presence/search variant. Use a column-ordered read for a separate page index; keep nullable unique constraints unchanged. A non-unique explicit index may append id with check --fix. When filters change, restart with a null cursor. guide indexes, reads."),
    ("E_CLOCK_DEV_ONLY", "clock controls require dev; serve always uses wall time. Use dev --clock-offset, clock advance or a local run --now; guide clock."),
    ("E_CLOCK_INPUT", "clock advances need a positive whole duration with ms, s, m, h, d or w; run --now accepts Unix milliseconds or +duration. Backward advances and out-of-range times are refused; guide clock."),
    ("E_SCHEMA_CAPABILITY", "this backend or stored schema needs unsupported engine/device capabilities, or its derived capability declaration is inconsistent. Upgrade the engine and devices together; see guide sync."),
    ("E_RECORDED_FIELD", "recorded attribution belongs to the engine: insert, update, upsert and no-op payloads, including jobs, seeds and untrusted imports, must omit the named field. The engine captures on insertion/import; trusted restoration preserves stored values without recapture. See guide maintains."),
    ("E_QUARRY_MAINTAIN", "aggregate view predicates use row-local typed scalar comparisons; group keys are columns such as .author, admitted one-hop paths, or day/hour/bucket of required time columns or recorded times. Calendar offsets are nonnegative literals smaller than the period. Scalar reads need the complete key. Follow the expression-specific rewrite; guide maintains."),
    ("E_QUARRY_MAINTAIN_EXPIRE", "stored order is stale before the physical sweep, so taking stored top-N can miss a live winner. A server count upper-bound threshold scan would be sound but is not built and would have to refuse on devices, whose snapshots deliver live values. Signed sums have no such upper bound. For a window over an entity's immutable time, use the feeds card's Trending predicate with both time endpoints and a maintained column over a non-expiring source. For expiring contributions, read live totals without ordering by stored .value. guide maintains."),
    ("E_WITNESS_INPUT", "invalid witness arguments, launch configuration or signal label. Use snapback4 guide witness for the flags and app recipe. guide witness."),
    ("E_WITNESS_PLATFORM", "witness ios requires macOS, Xcode and an installed iOS simulator. guide witness."),
    ("E_WITNESS_SIMULATOR", "a simulator could not be selected or simctl failed. Boot a dedicated iOS simulator and pass its --udid; never select an ambiguous booted set. guide witness."),
    ("E_WITNESS_APP", "the app is missing, its installed Info.plist could not be read, or process ownership could not be established. Quit an already running app before starting; replacement instances are left running. Build and install a missing app using the printed command. guide witness."),
    ("E_WITNESS_PORT", "the requested backend port is unavailable. Choose a free --port and build the app for that origin; the witness never stops an existing listener. guide witness."),
    ("E_WITNESS_BACKEND", "the owned backend did not become ready, exited early, or its stopped port did not refuse connections. Inspect the backend log; only owned processes are stopped. guide witness."),
    ("E_WITNESS_PROCESS", "a witness child failed to start, exited early or could not be stopped. Inspect capture and backend logs. guide witness."),
    ("E_WITNESS_ARTIFACT", "an artifact is missing, empty, changed containers or would overwrite a previous run. Use a fresh artifacts directory; inspect the failed run manifest. guide witness."),
    ("E_WITNESS_RECEIPT", "a receipt is not a JSON object, its witness envelope is invalid, its serialized app object has the reserved witness key, previously observed rows changed, or the file is empty/truncated or could not be written. Preserve one complete JSON object and its witness envelope per line. guide witness."),
    ("E_WITNESS_STEP", "an application assertion failed, a milestone arrived out of order, or helper steps overlapped. Steps must be sequential; inspect the app receipts and log. guide witness."),
    ("E_WITNESS_TIMEOUT", "an app step, command or signal did not arrive before the step timeout (120 seconds by default). Inspect the last recorded step; increase --timeout only for a measured slow run. guide witness."),
    ("E_WITNESS_INTERRUPTED", "the witness was interrupted; its owned backend and capture processes are stopped and available artifacts retained. guide witness."),

    ("E_ADOPT", "the compiled schema cannot adopt the stored rows. check reads the dev store (or --store path) without changing it; dev refuses the same successor step. Add an optional column or a literal default, or repair existing values/duplicate keys before narrowing. now and viewer belong to inserts and cannot fill old rows. guide types."),
    ("E_QUARRY_LIVE_MAINTAIN_PROBE", "a rule cannot compare the value of a view over an expiring source. Read the view in the program; its live value cannot be probed at one unit. Existence probes still cost one unit; guide expire."),
    ("SNAPBACK4_EXIT", "the dev/serve loop returned; status, generation and the startup/listener error or normal-stop reason are on stderr. Generation 0 means it has not served yet. guide refusals."),
    ("SNAPBACK4_PANIC", "a Rust panic on any host thread; stderr names the thread, serving generation, reason, source location and abort/unwind action. guide refusals."),
    ("SNAPBACK4_SIGNAL", "the host received a signal; stderr names it, its number and the serving generation. INT/TERM/HUP allow worker cleanup; fatal signals retain their OS status. guide refusals."),
    ("SNAPBACK4_THREAD_EXIT", "the watcher or maintenance thread stopped; stderr names the thread, serving generation and reason. An unexpected stop ends dev/serve instead of silently losing background work. guide refusals."),
    ("E_ACTION_AUTHORITY", "family action — the authority that admitted this action was revoked or has expired; the request fails terminally and no delegated session is minted (guide actions)."),
    ("E_ID_REUSED", "family input — this id already admitted another operation or different arguments; resend the original operation and arguments, or mint a new id (guide actions, writes)."),
    ("E_ACTION_PENDING", "family action, retryable — the request is durable but the handler has not settled within the wait; repeat client.act with the same id (guide actions)."),
    ("E_ACTION_UNKNOWN", "family action — no declared action or recorded request is available under this name and id for this viewer (guide actions)."),
    ("E_ACTION_LEASE", "family action — this claim expired or no longer owns the request; settle with the current claim's session.token in x-snapback-action-lease (guide actions)."),
    ("E_ACTION_FAILED", "family action — the handler gave up or exhausted its declared attempts; why.message is its error (guide actions)."),
    ("E_ACTION_RESULT", "family action — the handler's result violates its declared object type or output bound. The invocation fails terminally and is not retried, because external work may already have happened. Fix the handler and inspect why before starting a new invocation; guide actions."),
    ("E_ACTION_GENERATION", "family action — queued work's declaration changed, or the worker manifest does not match its admitted contract. Work is parked; regenerate the handler module and inspect the invocation before replacing it. guide actions."),
    ("E_ACTION_DEADLINE", "family action — the invocation reached its declared deadline. It cannot be claimed or retried; inspect its steps before starting new work. guide actions."),
    ("E_ACTION_ATTEMPTS", "family action — the invocation exhausted its declared total attempt count, including the first attempt. Inspect its steps before starting new work. guide actions."),
    ("E_ACTION_CANCELLATION", "family action — the operation declares cancellation deny, so this cancellation request is refused. guide actions."),
    ("E_ACTION_CANCELLED", "family action — this invocation was cancelled. In-flight cancellation is cooperative; external effects may already have happened. guide actions."),
    ("E_ACTION_CLOSED", "family action — the invocation context has finished and cannot start more work. Await handler work before returning. guide actions."),
    ("E_OIDC_BINDING", "OIDC begin needs bindingHash to be a 43-character base64url SHA-256 browser binding hash. Supply a SHA-256 browser binding hash; see SERVER.md, Identity refusal reference. guide services."),
    ("E_OIDC_CALLBACK", "the provider callback was refused: provider error, missing code, or callback state, binding or transaction admission mismatch. see SERVER.md, Identity refusal reference. guide services."),
    ("E_OIDC_CONFIG", "invalid fixed issuer, redirect, client secret-name, scopes, TTL or session settings. Correct the configured settings; see SERVER.md, Identity refusal reference. guide services."),
    ("E_OIDC_EXCHANGE", "the authorization-code exchange or ID-token verification failed. Inspect why.message; see SERVER.md, Identity refusal reference. guide services."),
    ("E_OIDC_HANDOFF", "after lost delivery, the minted session token is no longer available to this live handler. see SERVER.md, Identity refusal reference. guide services."),
    ("E_OIDC_MINT", "the private identity session endpoint returned an invalid session shape or value. see SERVER.md, Identity refusal reference. guide services."),
    ("E_OIDC_PROVIDER", "discovered provider metadata does not match the fixed secure configuration. see SERVER.md, Identity refusal reference. guide services."),
    ("E_OIDC_RECIPE", "a configured identity query or mutation handle is invalid, or the identity query returned no data. see SERVER.md, Identity refusal reference. guide services."),
    ("E_OIDC_REPLAY", "the transaction is already completing elsewhere or cannot be completed by this invocation. see SERVER.md, Identity refusal reference. guide services."),
    ("E_OIDC_TRANSACTION", "the stored transaction is invalid or mismatched, or the verified transaction failed to settle. see SERVER.md, Identity refusal reference. guide services."),
    ("E_STEP_INPUT", "family action/effect — a step's name/input is invalid or out of bounds, or the same step name was reused with different input. Keep one stable name and input per external step. guide actions, effects."),
    ("E_STEP_BUSY", "family action/effect — this attempt already has the same step in flight. Await it before using that name again. guide actions, effects."),
    ("E_STEP_UNKNOWN", "family action/effect — no step was begun under this work id and name before settlement. Begin the step before recording its outcome. guide actions, effects."),
    ("E_STEP_RESULT", "family action/effect — the external step returned an invalid or oversized outcome. Work parks; it is not retried automatically because repeating the external request could duplicate its effect. Reconcile through the step's stable key. guide actions, effects."),
    ("E_STEP_PARKED", "family action/effect — an external step's outcome is uncertain. Reconcile through its stable provider key; work that cannot be reconciled stays parked for an operator. guide actions, effects."),
    ("E_SECRET_MISSING", "a declared action/effect secret is absent when the supervised runtime starts. Supply that environment variable without putting its value in Quarry or generated files. guide actions."),
    ("E_SERVER_TYPECHECK", "the application's server entry or import graph failed TypeScript checking. Fix the reported handler/argument/result error and run check again; guide actions."),
    ("E_SERVER_TOOLCHAIN", "check could not start Node 24 or load the application's local TypeScript compiler. Read the accompanying cause: fix Node or SNAPBACK_NODE for a launch failure; install or repair the application's TypeScript dependency for a compiler-load failure. Then run check again; check does not fetch a compiler dynamically. guide actions."),
    ("E_SERVER_CONFIG", "the server runtime needs SNAPBACK_URL and SNAPBACK_SERVICE_TOKEN, or explicit url/token options, and a positive statusIntervalMs. Start it under dev/serve or supply valid runtime options. guide actions."),
    ("E_SERVER_HANDLERS", "the server runtime needs exactly one own handler for every declared action and route. Session routes use a function; service routes require verify and handle. Extra, missing, inherited or malformed handlers refuse. Optional effects must name declared effects; empty registries may be omitted. Regenerate the server module and fix its handler registry. guide actions, routes."),
    ("E_WRITE_LABEL", "ctx.writeIdFor(label) needs 1–128 printable ASCII characters. Use one stable label per mutation in the invocation. guide actions."),
    ("E_SQL_READ_ONLY", "developer SQL accepts exactly one SELECT or WITH … SELECT. Writes, attachment, pragmas and side effects are refused; guide personas."),
    ("E_SQL_INTERNAL", "developer SQL reads only generated application-table views. Raw r/i, internal tables and SQLite metadata are refused; guide personas."),
    ("N_NOW_SERVER", "a query now reads a server-only site; why names it and the rewrite. See guide residency."),
    ("E_NOT_PREDICTABLE", "a mutation declared predicts has a server site and cannot predict. The header diagnostic names the reason and rewrite. Remove the server dependency to keep the assertion; guide prediction explains eligibility and horizon limits."),
    ("N_NOT_PREDICTABLE", "a mutation lost eligibility, or gained a horizon site that may queue without a row; one note per mutation lists distinct root causes, deduplicated sites and rewrites. See guide residency."),
    ("N_HORIZON_GUARD", "require not exists on an argument id reads through a horizon and costs offline prediction on a miss. The mutation write id already dedupes retries for that principal; remove the guard only if retry dedupe is its purpose. A fresh write id is a new write. See guide prediction."),
    ("N_PUBLIC_AGGREGATE_COPY", "every write to a public column derives from reads, but its insert or update rule is unrestricted. An argument may choose which derived value is written; it may not supply the value itself or how many values contribute to it. Keep a count in an aggregate view and read it, or pin the copy to its source in both rules. A note about latent table permission, not a claim that an existing mutation accepts arbitrary scores. guide feeds."),
    ("N_MAINTAIN_DELTA", "a readable aggregate view declares an insert/delete/update delta channel, including filter/key/value dependencies; restrict its read audience or source write authority if the delta is private."),
    ("N_MAINTAIN_SYNCED", "maintains inherit public sync or a group audience with unbounded recipients or multiple values per group; one grouped note retains every maintain's source site and names mutations that would stop predicting if online only opts out. snapback4 test --residency measures its cold rows."),
    ("E_INPUT", "family input — an argument or a row value does not fit its declared type, or an HTTP request exceeds its body bound (sync: 256 KiB, HTTP 413). The message names the field; fix the value or the declaration. A table reference validates the id's shape, not the target's existence: the string \"null\" is an id, while JSON null needs an optional type; `require exists t[id] else CODE` checks for a visible target (guide writes)."),
    ("E_TYPE", "family input — a value has the wrong type for its position at run time (a Quarry program that binds cannot raise it; a seed or a wire argument can); the message names both types."),
    ("E_OVERFLOW", "family input — integer arithmetic left ±(2^53 − 1), the value model's range. Internal aggregate overflow names the view and its value column, never the computed sum. Store minor units in a decimal or money column, or narrow the operands."),
    ("E_DIV_ZERO", "family input — divmod, / or % by zero. Check the divisor first: `require n != 0 else EMPTY`."),
    ("E_FIELD", "family input — a field was read from a value that has none (a null row's column, a missing object field). Narrow the row first: `row ! else NOT_FOUND`."),
    ("E_SCHEMA", "family schema — the schema or the store is inconsistent. `snapback4 check` names the line."),
    ("E_SCHEMA_CONSTRAINT", "family schema — a declaration the compiler binds but the core refuses: a cap or an expire without its index, an aggregate view without its unique group index, a sync whose aggregate would reveal rows its audience may not read. The message names the declaration; guide indexes."),
    ("E_STRUCTURAL_FANOUT", "a mutation cannot safely iterate this population. Compiling and serving refuse it, and a native device checks again; the web device trusts that admission and does not repeat the check, so a hand-built or corrupted backend can still run there. Mutation pages need a uniform plain prefix over a table without expiry. For expiry, read the page in a query and pass the selected ids to the mutation, or use a job sweep, which may read a table with expiry. Predicting page and row-writing list loops need a whole capped group; accumulated or filtered lists can lose that proof. Bounded lists that only read, compute and emit need no whole-group proof. The rewrite names missing rule columns and a capped loop. Pinning a private reader decides visibility, not authority. Iterate the original group or use a job sweep.\n\nExample: declare `cap 50 by room` on members, then iterate `for m in members where .room = room:`; put the condition and row write inside that loop."),
    ("E_UNBOUND_SCAN", "family schema — a compiled program scans a table or index the schema no longer has. Compiling and serving refuse it, and a native device checks again; the web device trusts that admission and does not repeat the check, so a hand-built or corrupted backend can still run there. Recompile: `snapback4 check` after the schema change."),
    ("E_RULE", "family auth — a table's insert, update or delete rule did not admit this viewer, or a unique key collided with a row you cannot read; to write into another principal's row use `upsert` under an `update` rule, or let an aggregate view keep the count. Reads never raise it: a hidden row is null. Read the rule with `snapback4 why <table>`."),
    ("E_AUTH", "family auth — no principal, a session that is not live, or the wrong kind at a door: send `x-snapback-persona` in development or a bearer token (a persona is refused off loopback and under `serve`); claiming effects and minting sessions take a service token (`snapback4 token --service <name>`), never a user's (guide services)."),
    ("E_CONFLICT", "family constraint — `update .. if` found the row changed; the failed write carries the current row. Read it and retry with a fresh edit. Retryable."),
    ("E_CONSTRAINT", "family constraint — a unique index, a cap, an immutable column, a text format or an after-insert postcondition refused the write. The message names which."),
    ("E_FANOUT", "family bound — a loop received more items than its declared bound."),
    ("E_BOUND", "family bound — the meter cut a mutation (or a response exceeded 16 MiB): the message names the meter, the ceiling and the site, never the count (it would measure rows the viewer may not read). Read a smaller page, narrow its where predicate, or move the sweep into a job."),
    ("E_OP", "family op — no such operation, a query called as a mutation (or the reverse), a job called over the wire, or an unknown route."),
    ("DIGEST_CHAT_BOUND", "an older digest recipe stopped after 100 qualifying messages in one chat. Its recipient transaction rolled back. Replace the collected page with count(messages where ...), use for p in profiles: for the job, and emit push {...} once [p.principal, periodEnd]. The engine still meters each recipient transaction. guide jobs."),
    ("E_RUN_BUSY", "local run could not open/adopt the store before its 15-second contention deadline. No operation was admitted. Inspect doctor and the dev adoption log, wait for the writer or stop your dev host, run once, then restart dev. guide refusals."),
    ("E_RUN_SOURCE_CHANGED", "local run's source changed after compilation or became unreadable before admission. No operation was admitted; check the source and rerun with the intended arguments. guide refusals."),
    ("E_STORE", "family store — SQLite failed; retryable."),
    ("E_GENERATION", "family generation — the backend the caller assumed is not the one in the store: the schema changed under a queued write (the client re-sends under the new generation), a dev store belongs to a deployment, or a release's source is not the activated backend. The message says which."),
    ("E_JOB_GENERATION", "family generation — a queued job run found its job changed or gone since it was queued; the run is parked. Queue it again."),
    ("E_ASSET_TYPE", "family asset — the upload's bytes are not a JPEG, PNG, WebP or MP4, the body is empty, or no column of this backend takes that kind. Declare `photo: image <=10000000` / `clip: video <=50000000` and upload a file of that kind."),
    ("E_ASSET_TOO_LARGE", "family asset — the upload is larger than the largest column of its kind (or the column it is placed in). Downscale before uploading, or widen the column's bound."),
    ("E_ASSET_UNKNOWN", "family asset — no asset is served under that id to this viewer: it was never uploaded, it is another uploader's unplaced upload, its home row is gone, cleared, expired or hidden from this viewer. Hidden and absent are one word on purpose."),
    ("E_ASSET_PLACED", "family asset — the upload already belongs to a row: one asset, one home. Upload the bytes again for a second row."),
    ("E_ASSET_BOUNDS", "family asset — media dimensions or duration are invalid, missing for video, or exceed the limits on the assets card. Resize or shorten the source before uploading."),
    ("E_ASSET_RANGE", "family asset — a once asset requires a whole-file request without Range. The rejected range did not consume a view."),
    ("E_RATE_LIMIT", "family auth — bounded identity, upload, or HTTP admission is full. Retry later; see the personas and assets cards."),
    ("E_ASSET_VIEWED", "family asset — a `once` asset was served to this principal already; the second view is refused (HTTP 410). The uploader is counted after placement; an unplaced preview is not."),
    ("E_EFFECT_UNKNOWN", "family schema — no effect is queued under that id on this server (HTTP 404): it was never emitted here, or `doctor` shows it under another id. A worker settles only what it claimed (guide effects)."),
    ("E_EFFECT_LEASE", "family schema — this request no longer holds the effect's exact live claim. Status reports lost authority only and never requeues the effect. A later claim or maintenance path may separately observe lease expiry and requeue eligible work; obtain a current claim and token before settling (guide effects)."),
    ("E_PREDICT", "family prediction — the device could not predict this mutation locally (a read it needs is not on the device, or an id that was not fixed at submission); the refusal names the undecidable site, table, index and key. The write is queued without local rows and the server judges it. An `emit` predicts nothing and needs nothing: the server keeps the effect when the write lands."),
    ("E_OFFLINE", "family link — the client could not reach the server; retryable. A local-first read still answers from the device with `fresh: false` and `since`; a write waits as `pending` and lands when the link returns."),
    ("E_CLIENT", "family client — the client threw without returning a write or asset outcome. The message includes the original exception; a missing write outcome does not prove whether the server admitted it. Repair the client and collect with the original intent id before issuing another write."),
    ("E_CLOSED", "family client — the client was closed while this request was in flight. The local-first client resolves such a write `pending` instead: it is queued durably and lands on the next open."),
    ("E_DEVICE_VERSION", "family client — the device this client opened predates it: the native module in this build, or a wasm from another package version, lacks the sync receipt protocol (`sync_state`, `begin_send`, `admit`, `settle`). Reloading JavaScript does not update a native module: rebuild the development build (`npx expo run:ios`) with the matching `snapback4-expo`; on the web serve the wasm this package version ships."),
    ("E_QUARRY_SYNTAX", "the parser expected the token or construct named at file:line:column. Object fields use name: expression (or a bare name for name: name); ...shape belongs in a row/page shape, not an object payload. Operations need name(args): followed by an indented body, including () for no arguments. Close each (, [ and { with its matching delimiter; separate fields and arguments with commas. The rewrite names the expected spelling; `check --fix` applies only repairs marked mechanical. Read `snapback4 guide language` for complete examples. `check` hides a parser-proven empty-operation cascade after an earlier error in that operation; `--verbose` and `--json` retain it. Independent errors stay visible. A query merge lane takes a prefix page, range(a, b), or a bounded list; walk is not a lane domain. A time function occurs at most once per index."),
    ("E_QUARRY_UNSUPPORTED", "a form Snapback 4 does not have; the rewrite names the one it does. The language card lists every form left out and its idiom."),
    ("E_QUARRY_UNKNOWN", "a name is not declared; the rewrite suggests the nearest one."),
    ("E_QUARRY_TYPE", "a value meets a declaration of another type; the message names both. A computed index key needs a required time column of its table, a valid literal period/offset, and no real column with the same function name; see guide indexes. Computed keys are not writable columns."),
    ("E_QUARRY_AMBIGUOUS", "a positional key matches more than one declared unique key. Name the columns, for example profiles[principal = viewer]; for a population use a where predicate and column order such as by .at. Older explicit-index reads can still name their index. guide indexes."),
    ("E_QUARRY_PLACEMENT", "a statement stands where it cannot: a write or `new` in a query, `break` outside a loop. The rewrite says where it belongs."),
    ("E_QUARRY_RETAIN", "a table has more than one `retain` line, or its policy word is not `until-revoked` or `delivered-history`."),
    ("E_SYNC", "a sync line cannot be honoured; the message names the rule term, column or index to change."),
    ("E_SYNC_GENERATION", "family generation — the sync request names another generation. No page was materialized. Observe store_id, adopt /schema and retry from the device's resulting position; the reply's watermark is not delivered progress. guide sync."),
    ("E_UNBOUND_LOOP", "a loop has no static bound; iterate a page, a bounded list argument, `range(a, b)` or `tokens(text)`."),
    ("E_SCHEDULE", "a schedule must name a job or an action taking only `periodStart: time` and `periodEnd: time`, or nothing. An action requires `as service:<seat>`; a job runs as the system and forbids as. guide actions, jobs."),
    ("E_JOB_CURSOR_INDEX", "a job sweeps an order a write could change under the cursor. Declare its non-id order columns immutable, including the time column beneath day, hour or bucket, or write for row in table: to sweep by stable id. guide jobs."),
    ("E_JOB_SWEEP", "a stored job has no recorded table sweep or has an unsupported top-level work loop. Bounded, write-free and emit-free setup loops are allowed before a sweep. The run parks before any chunk instead of skipping work and reporting success. Bind the work as for row in table: and put optional filters inside that loop. guide jobs."),
    ("E_OP_RESERVED", "refusal codes in `require .. else CODE` cannot start with E_; that namespace is the platform's."),
    ("E_EMIT_IN_QUERY", "queries cannot emit effects; make it a mutation. An emitted effect is kept in the mutation's commit and performed by a worker with a service token (guide effects)."),
    ("E_NATIVE", "family schema — `native` on a mutation (a job or a query can be native; a mutation is predicted on a device and replayed by the server, in Quarry); a native read that writes; a read the module does not implement; a native job declared with no snapback/native/Cargo.toml; a job the module does not implement (the message lists what it does); a module that does not load; a native job run with no module installed (`snapback4 check` builds it). guide native."),
    ("E_NATIVE_TOOLCHAIN", "family store — cargo is not on PATH, or the wasm32-unknown-unknown target is not installed; the rewrite is the rustup line. A native job is Rust compiled to wasm by `snapback4 check`."),
    ("E_NATIVE_BUILD", "family schema — `cargo build` of snapback/native failed; the message is the tail of its output. Build it by hand with the rewrite to see everything."),
    ("E_NATIVE_TRAP", "family native — the module trapped in a chunk: a panic (its text follows), an unreachable, an out-of-bounds memory access. The chunk rolled back and the job is parked; fix the module, `snapback4 check`, and queue the job again."),
    ("N_NO_HORIZON", "a note, not an error — a synced table with no `last N by .at` horizon delivers every row of every group a device holds, and keeps delivering as the table grows. Suppression is reader-dependent, even for an uncapped `sync public` table. Eligible mutations that require whole-partition coverage can suppress this advice. An absent note does not certify bounded acquisition or a safe cold-start size. Silent when whole-partition reads or insert proofs of eligible mutations depend on that absence of a horizon. For eligible mutations with ascending pages or pages on a different index, names the prediction a horizon would cost instead of recommending it. Otherwise declare `sync ... last 500 by .at` (older rows remain online; local reads past them say `complete: false`), or bound the group with a `cap`. Inspect `check --residency`."),
    ("N_WIDE_MERGE", "a note, not an error — a merge visits every source lane. Uniform plain lanes without setup and with a non-nullable unique index or one ending in id read one head each, then advance the winning lanes; other lanes read a page each. Discovery, rule probes, lookahead, duplicates and expired rows still consume the meter. Inspect structural costs with `snapback4 check --cost`; if a held query answers this read, delete the merge. Relationship-driven merges may benefit from entries per reader (guide feeds). `why` opens the first matching diagnostic's card in the current project: feeds for Following, search for membership search; without a matching diagnostic it defaults to search. Membership search points to guide search, section 'Search every chat I'm in': the grouped one-cursor form continues through a meter cut; the newest form is one globally ordered stream while every head opens in one read. An opening or word-limit cut has no merge continuation. A resumable read-meter cut while an owning uniform lazy merge drains established heads can carry `next` after its last fully shaped emitted row (§5.6), subject to final-answer eligibility, with `complete: false, cut: 'meter'`. Heap exhaustion clears the whole page even during the drain; step exhaustion aborts and output exhaustion can refuse after materialisation. A terminal full page need not carry `next`; following a cut does not clear `usePage`'s accumulated incompleteness."),
    ("N_NO_CURSOR", "a note, not an error — a query returns a page with no cursor argument, so it cannot continue: when more rows exist than the page holds the card reads `complete: false` with no `next`. Declare `c: cursor ?` and page with `after c`, or read the whole group: `t where .conversationId = conversationId`, using its declared cap, such as `cap 50 by conversationId` when pinned by conversationId. The cap must fit the examined ceiling; other metered work can still cut the read."),
    ("N_SEEK", "a where on the next index column is a seek; write it in the key, with the comparison after the pinned prefix."),
    ("N_SPARSE_FILTER", "a residual predicate may examine many rejected rows before finding a page. Pin its scope with where .owner = owner. For a time window, give both endpoints, for example .at > now - 24h and .at <= now. The engine chooses the index; the read meter still bounds work. guide reads."),
    ("N_NEVER_COMPLETE", "a note, not an error — a page whose read rule reads a column the scan does not pin is complete: false on the server whatever it finds. Pin that column with a where equality. For membership search, use messages matching q where exists members[.roomId, viewer] last 20 by .at after c; or read held rows on the device. guide reads, search."),
    ("NOT_FOUND", "the program's own code for a write whose row does not exist (a direct update or delete of a missing point), and the conventional code for `t[key] ! else NOT_FOUND`."),
];

/// The codes, for a listing.
pub fn codes() -> Vec<&'static str> {
    CODES.iter().map(|(code, _)| *code).collect()
}

/// Includes the CLI's final newline and the full-card pointer, even when the
/// paragraph is longer. This is an output bound, not a runtime meter ceiling.
pub const WHY_MAX_BYTES: usize = 4096;

pub fn explain_code(code: &str) -> Option<String> {
    explain_code_with_guide(code, crate::diag::guide_for(code))
}

pub(crate) fn explain_code_with_guide(code: &str, keyword: &str) -> Option<String> {
    explain(code, keyword, false)
}

/// Inline help must contain prose dedicated to this code; explicit why keeps
/// its opening-paragraph fallback.
pub(crate) fn explanation_section(code: &str, keyword: &str) -> Option<String> {
    explain(code, keyword, true)
}

fn explain(code: &str, keyword: &str, dedicated: bool) -> Option<String> {
    let (_, explanation) = CODES.iter().find(|(name, _)| *name == code)?;
    let card = super::card(keyword)?;
    let paragraphs = prose(card);
    let section = paragraphs.iter().find(|(_, paragraph)| paragraph.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').any(|word| word == code));
    if dedicated && section.is_none() { return None; }
    let mut text = format!("{code}: {explanation}\n\n");
    if section.is_none() { text.push_str(&format!("No dedicated section for {code}; opening of guide {keyword}:\n")); }
    if let Some((heading, paragraph)) = section.or_else(|| paragraphs.first()) {
        text.push_str(heading);
        text.push_str("\n\n");
        text.push_str(paragraph);
    } else {
        text.push_str(card.lines().next().unwrap_or(keyword));
    }
    let pointer = format!("\n\nFull card: snapback4 guide {keyword}");
    let budget = WHY_MAX_BYTES - pointer.len() - 1;
    if text.len() > budget {
        const CUT: &str = "\n[excerpt truncated]";
        let mut end = budget - CUT.len();
        while !text.is_char_boundary(end) { end -= 1; }
        // Prefer a complete word; never split a UTF-8 character.
        if let Some(at) = text[..end].rfind(char::is_whitespace) { end = at; }
        text.truncate(end);
        text.push_str(CUT);
    }
    text.push_str(&pointer);
    Some(text)
}

/// Paragraphs retain their card heading, but never treat a code in a Quarry
/// example as documentation of that code. Cards remain the source of the prose.
fn prose(card: &str) -> Vec<(String, String)> {
    let mut result = Vec::new();
    let mut heading = String::new();
    let mut paragraph = Vec::new();
    let mut fence = None;
    for line in card.lines().chain([""]) {
        let trimmed = line.trim_start();
        if let Some(marker) = fence {
            if trimmed.starts_with(marker) { fence = None; }
            continue;
        }
        let marker = ["```", "~~~"].into_iter().find(|marker| trimmed.starts_with(marker));
        if trimmed.is_empty() || trimmed.starts_with('#') || marker.is_some() {
            if !paragraph.is_empty() { result.push((heading.clone(), paragraph.join("\n"))); paragraph.clear(); }
            if trimmed.starts_with('#') { heading = line.to_owned(); }
            fence = marker;
        } else { paragraph.push(line); }
    }
    result
}
