pub const CODES: &[(&str, &str)] = &[
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
    ("E_EFFECT_DEADLINE", "the effect's admitted deadline passed; it is terminal and will not be claimed again."),
    ("E_EFFECT_ATTEMPTS", "the effect exhausted the admitted attempt limit after a lease expired; inspect the provider before replacing it."),
    ("E_RECIPE_CAPS", "invalid Following recipe sizing. --authors and --edges require --recipe feeds and positive 32-bit integers; edges must fit authors * 1000 followers/author, and the derived route/count cap must fit one full follower group plus its author. See guide feeds for coupled caps and acquisition costs."),
    ("FEED_PULL_CAP", "the Following recipe's reader already pulls 32 shared authors. Free a pull slot by unfollowing a shared author, then follow again. Promotion skips saturated readers instead of refusing; those readers keep old pushed entries but miss new broadcasts until they free a slot and unfollow/refollow. guide feeds."),
    ("E_QUERY_HELD", "this query is declared held and runs only on the device. Call it with the local client; for server search, use the scoped server walk in guide search, section Search every chat I'm in. A held read never falls back to the server."),
    ("E_INDEX_KEY_BYTES", "family schema — an encoded index key, including its components, encoding overhead and appended id, must fit 2048 bytes on every store; table and index labels together have 512 UTF-8 bytes. Bound indexed text with <=N, reduce the composite key or shorten the labels; check names the column and suggests a bound. Writes enforce the same limits. guide indexes."),
    ("E_WRITE_ID", "family input — write id must be 26 uppercase Crockford base32 digits, starting with 0–7 (the mintId() form). Mint once and keep the id with the intent; guide writes."),
    ("E_WRITE_ID_REUSE", "family input — write id already belongs to a different operation or arguments; retry the original input or use a new id. The original write remains unchanged; guide writes."),
    ("E_WRITE_RECEIPT_EXPIRED", "family input — this client already used the write id, but its receipt is no longer retained; reopen the client to ask the server for the original outcome. The client never admits a known id twice; guide writes."),
    ("E_QUARRY_MODIFIER_SCOPE", "by immediately after an unparenthesized read inside where could belong to the inner or outer read. Parenthesize the inner read, or move the modifier before where; check --fix preserves the inner index by adding parentheses. guide reads."),
    ("E_REPLAY_DEV_ONLY", "--replay requires dev without --release; serve and releases always emit effects normally. Use snapback4 dev --replay to suppress new effects and hold schedules; guide replay."),
    ("E_STORE_RESTORE", "family store — the same backend store identity reports a head below this device's watermark. Sync and reads halt; stop the client and use a fresh device store and outbox for the restored backend. A retry or backend adoption does not reacquire the same identity. See `guide sync`."),
    ("E_CURSOR_INDEX", "a cursor needs an index ending in id or a total unique key. Append id to the named index with check --fix; guide indexes."),
    ("E_CLOCK_DEV_ONLY", "clock controls require dev; serve always uses wall time. Use dev --clock-offset, clock advance or a local run --now; guide clock."),
    ("E_CLOCK_INPUT", "clock advances need a positive whole duration with ms, s, m, h, d or w; run --now accepts Unix milliseconds or +duration. Backward advances and out-of-range times are refused; guide clock."),
    ("E_QUARRY_MAINTAIN", "maintain predicates use row-local typed scalar comparisons; group keys are bare columns or day/hour/bucket of required time columns with an optional nonnegative literal offset smaller than the period; scalar reads need the complete key. Follow the expression-specific rewrite; guide maintains."),
    ("E_QUARRY_MAINTAIN_EXPIRE", "a value-order maintain index cannot stay exact when its source expires without a commit. Use a live bounded query or guide feeds' scheduled Trending recipe: like stays predictable, and scores from non-expiring counts and post time lag by one schedule period."),
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
    ("E_QUARRY_LIVE_MAINTAIN_PROBE", "a rule cannot compare the value of a maintain over an expiring source. Read the maintain in the program; its live value cannot be probed at one unit. Existence probes still cost one unit; guide expire."),
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
    ("E_STEP_INPUT", "family action — a step's name/input is invalid or out of bounds, or the same step name was reused with different input. Keep one stable name and input per external step. guide actions."),
    ("E_STEP_BUSY", "family action — this attempt already has the same step in flight. Await it before using that name again. guide actions."),
    ("E_STEP_UNKNOWN", "family action — no step was begun under this invocation and name before settlement. Begin the step through ctx.step. guide actions."),
    ("E_STEP_RESULT", "family action — the external step returned an invalid or oversized outcome. Work fails terminally or parks; it is not retried automatically because repeating the external request could duplicate its effect. Reconcile through the step's stable key. guide actions."),
    ("E_STEP_PARKED", "family action — an external step's outcome is uncertain. Reconcile through its stable provider key; work that cannot be reconciled stays parked for an operator. guide actions."),
    ("E_SECRET_MISSING", "a declared action/effect secret is absent when the supervised runtime starts. Supply that environment variable without putting its value in Quarry or generated files. guide actions."),
    ("E_SERVER_TYPECHECK", "the application's server entry or import graph failed TypeScript checking. Fix the reported handler/argument/result error and run check again; guide actions."),
    ("E_SERVER_TOOLCHAIN", "the server entry needs a locally installed TypeScript compiler. Install the application's TypeScript dependency and run check again; check does not fetch a compiler dynamically. guide actions."),
    ("E_SERVER_CONFIG", "the server runtime needs SNAPBACK_URL and SNAPBACK_SERVICE_TOKEN, or explicit url/token options, and a positive statusIntervalMs. Start it under dev/serve or supply valid runtime options. guide actions."),
    ("E_SERVER_HANDLERS", "the server runtime needs exactly one own handler for every declared action and route. Session routes use a function; service routes require verify and handle. Extra, missing, inherited or malformed handlers refuse. Optional effects must name declared effects; empty registries may be omitted. Regenerate the server module and fix its handler registry. guide actions, routes."),
    ("E_WRITE_LABEL", "ctx.writeIdFor(label) needs 1–128 printable ASCII characters. Use one stable label per mutation in the invocation. guide actions."),
    ("E_SQL_READ_ONLY", "developer SQL accepts exactly one SELECT or WITH … SELECT. Writes, attachment, pragmas and side effects are refused; guide personas."),
    ("E_SQL_INTERNAL", "developer SQL reads only generated application-table views. Raw r/i, internal tables and SQLite metadata are refused; guide personas."),
    ("N_NOW_SERVER", "a query now reads a server-only site; why names it and the rewrite. See guide residency."),
    ("E_NOT_PREDICTABLE", "a mutation declared predicts has a server site and cannot predict. The header diagnostic names the reason and rewrite. Remove the server dependency to keep the assertion; guide prediction explains eligibility and horizon limits."),
    ("N_NOT_PREDICTABLE", "a mutation lost eligibility, or gained a horizon site that may queue without a row; one note per mutation lists distinct root causes, deduplicated sites and rewrites. See guide residency."),
    ("N_HORIZON_GUARD", "require not exists on an argument id reads through a horizon and costs offline prediction on a miss. The mutation write id already dedupes retries for that principal; remove the guard only if retry dedupe is its purpose. A fresh write id is a new write. See guide prediction."),
    ("N_MAINTAIN_DELTA", "a readable maintain declares an insert/delete/update delta channel, including filter/key/value dependencies; restrict its read audience or source write authority if the delta is private."),
    ("N_MAINTAIN_SYNCED", "maintains inherit public sync or a group audience with unbounded recipients or multiple values per group; one grouped note retains every maintain's source site and names mutations that would stop predicting if online only opts out. snapback4 test --residency measures its cold rows."),
    ("E_INPUT", "family input — an argument or a row value does not fit its declared type, or an HTTP request exceeds its body bound (sync: 256 KiB, HTTP 413). The message names the field; fix the value or the declaration. A table reference validates the id's shape, not the target's existence: the string \"null\" is an id, while JSON null needs an optional type; `require exists t[id] else CODE` checks for a visible target (guide writes)."),
    ("E_TYPE", "family input — a value has the wrong type for its position at run time (a Quarry program that binds cannot raise it; a seed or a wire argument can); the message names both types."),
    ("E_OVERFLOW", "family input — integer arithmetic left ±(2^53 − 1), the value model's range. Internal aggregate overflow names the maintain and its value column, never the computed sum. Store minor units in a decimal or money column, or narrow the operands."),
    ("E_DIV_ZERO", "family input — divmod, / or % by zero. Check the divisor first: `require n != 0 else EMPTY`."),
    ("E_FIELD", "family input — a field was read from a value that has none (a null row's column, a missing object field). Narrow the row first: `row ! else NOT_FOUND`."),
    ("E_SCHEMA", "family schema — the schema or the store is inconsistent. `snapback4 check` names the line."),
    ("E_SCHEMA_CONSTRAINT", "family schema — a declaration the compiler binds but the core refuses: a cap or an expire without its index, a maintain target without its unique group index, a sync whose aggregate would reveal rows its audience may not read. The message names the declaration; guide indexes."),
    ("E_STRUCTURAL_FANOUT", "a mutation cannot safely iterate this population. Mutation pages need a uniform plain prefix over a table without expiry. Predicting page and row-writing list loops need a whole capped group; accumulated or filtered lists can lose that proof. Bounded lists that only read, compute and emit need no whole-group proof. The rewrite names missing rule columns and a capped loop. Pinning a private reader decides visibility, not authority. Iterate the original group or use a job chunk.\n\nExample: declare `cap 50 by room` on members, then iterate `for m in members[room] first 50 by byRoom:`; put the condition and row write inside that loop."),
    ("E_UNBOUND_SCAN", "family schema — a compiled program scans a table or index the schema no longer has. Recompile: `snapback4 check` after the schema change."),
    ("E_RULE", "family auth — a table's insert, update or delete rule did not admit this viewer, or a unique key collided with a row you cannot read; to write into another principal's row use `upsert` under an `update` rule, or let a `maintain` keep the count. Reads never raise it: a hidden row is null. Read the rule with `snapback4 why <table>`."),
    ("E_AUTH", "family auth — no principal, a session that is not live, or the wrong kind at a door: send `x-snapback-persona` in development or a bearer token (a persona is refused off loopback and under `serve`); claiming effects and minting sessions take a service token (`snapback4 token --service <name>`), never a user's (guide services)."),
    ("E_CONFLICT", "family constraint — `update .. if` found the row changed; the failed write carries the current row. Read it and retry with a fresh edit. Retryable."),
    ("E_CONSTRAINT", "family constraint — a unique index, a cap, an immutable column, a text format or an after-insert postcondition refused the write. The message names which."),
    ("E_FANOUT", "family bound — a loop received more items than its declared bound."),
    ("E_BOUND", "family bound — the meter cut a mutation (or a response exceeded 16 MiB): the message names the meter, the ceiling and the site, never the count (it would measure rows the viewer may not read). Read a smaller page, add an index, or move the sweep into a job."),
    ("E_OP", "family op — no such operation, a query called as a mutation (or the reverse), a job called over the wire, or an unknown route."),
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
    ("E_EFFECT_LEASE", "family schema — the effect is not running under this worker's claim: another worker holds it, its lease expired and it was queued again, or it is already settled. Claim it again (`POST /effects/claim`) before settling; two workers never hold one effect (guide effects)."),
    ("E_PREDICT", "family prediction — the device could not predict this mutation locally (a read it needs is not on the device, or an id that was not fixed at submission); the refusal names the undecidable site, table, index and key. The write is queued without local rows and the server judges it. An `emit` predicts nothing and needs nothing: the server keeps the effect when the write lands."),
    ("E_OFFLINE", "family link — the client could not reach the server; retryable. A local-first read still answers from the device with `fresh: false` and `since`; a write waits as `pending` and lands when the link returns."),
    ("E_CLIENT", "family client — the client threw without returning a write or asset outcome. The message includes the original exception; a missing write outcome does not prove whether the server admitted it. Repair the client and collect with the original intent id before issuing another write."),
    ("E_CLOSED", "family client — the client was closed while this request was in flight. The local-first client resolves such a write `pending` instead: it is queued durably and lands on the next open."),
    ("E_DEVICE_VERSION", "family client — the device this client opened predates it: the native module in this build, or a wasm from another package version, lacks the sync receipt protocol (`sync_state`, `begin_send`, `admit`, `settle`). Reloading JavaScript does not update a native module: rebuild the development build (`npx expo run:ios`) with the matching `snapback4-expo`; on the web serve the wasm this package version ships."),
    ("E_QUARRY_SYNTAX", "the parser expected the token or construct named at file:line:column. Object fields use name: expression (or a bare name for name: name); ...shape belongs in a row/page shape, not an object payload. Operations need name(args): followed by an indented body, including () for no arguments. Close each (, [ and { with its matching delimiter; separate fields and arguments with commas. The rewrite names the expected spelling; `check --fix` applies only repairs marked mechanical. Read `snapback4 guide language` for complete examples. `check` hides a parser-proven empty-operation cascade after an earlier error in that operation; `--verbose` and `--json` retain it. Independent errors stay visible."),
    ("E_QUARRY_UNSUPPORTED", "a form Snapback 4 does not have; the rewrite names the one it does. The language card lists every form left out and its idiom."),
    ("E_QUARRY_UNKNOWN", "a name is not declared; the rewrite suggests the nearest one."),
    ("E_QUARRY_TYPE", "a value meets a declaration of another type; the message names both."),
    ("E_QUARRY_AMBIGUOUS", "several indexes match a key without a single exact-type match or full unique positional-key choice; add `by index`, or apply the diagnostic's rewrite with `check --fix`."),
    ("E_QUARRY_PLACEMENT", "a statement stands where it cannot: a write or `new` in a query, `break` outside a loop. The rewrite says where it belongs."),
    ("E_QUARRY_RETAIN", "a table has more than one `retain` line, or its policy word is not `until-revoked` or `delivered-history`."),
    ("E_SYNC", "a sync line cannot be honoured; the message names the rule term, column or index to change."),
    ("E_UNBOUND_LOOP", "a loop has no static bound; iterate a page, a bounded list argument, `range(a, b)` or `tokens(text)`."),
    ("E_SCHEDULE", "a schedule must name a job or an action taking only `periodStart: time` and `periodEnd: time`, or nothing. An action requires `as service:<seat>`; a job runs as the system and forbids as. guide actions, jobs."),
    ("E_JOB_CURSOR_INDEX", "a job's chunk sweeps an index a write could change under the cursor; declare its non-id columns `immutable`, or sweep by `byId`."),
    ("E_OP_RESERVED", "refusal codes in `require .. else CODE` cannot start with E_; that namespace is the platform's."),
    ("E_EMIT_IN_QUERY", "queries cannot emit effects; make it a mutation. An emitted effect is kept in the mutation's commit and performed by a worker with a service token (guide effects)."),
    ("E_NATIVE", "family schema — `native` on a mutation (a job or a query can be native; a mutation is predicted on a device and replayed by the server, in Quarry); a native read that writes; a read the module does not implement; a native job declared with no snapback/native/Cargo.toml; a job the module does not implement (the message lists what it does); a module that does not load; a native job run with no module installed (`snapback4 check` builds it). guide native."),
    ("E_NATIVE_TOOLCHAIN", "family store — cargo is not on PATH, or the wasm32-unknown-unknown target is not installed; the rewrite is the rustup line. A native job is Rust compiled to wasm by `snapback4 check`."),
    ("E_NATIVE_BUILD", "family schema — `cargo build` of snapback/native failed; the message is the tail of its output. Build it by hand with the rewrite to see everything."),
    ("E_NATIVE_TRAP", "family native — the module trapped in a chunk: a panic (its text follows), an unreachable, an out-of-bounds memory access. The chunk rolled back and the job is parked; fix the module, `snapback4 check`, and queue the job again."),
    ("N_NO_HORIZON", "a note, not an error — a synced table with no `last N by index` horizon delivers every row of every group a device holds, and keeps delivering as the table grows. Suppression is reader-dependent, even for an uncapped `sync public` table. Eligible mutations that require whole-partition coverage can suppress this advice. An absent note does not certify bounded acquisition or a safe cold-start size. Silent when whole-partition reads or insert proofs of eligible mutations depend on that absence of a horizon. For eligible mutations with ascending pages or pages on a different index, names the prediction a horizon would cost instead of recommending it. Otherwise declare `sync ... last 500 by <index>` (older rows remain online; local reads past them say `complete: false`), or bound the group with a `cap`. Inspect `check --residency`."),
    ("N_WIDE_MERGE", "a note, not an error — a merge visits every source lane. Uniform plain lanes without setup and with a non-nullable unique index or one ending in id read one head each, then advance the winning lanes; other lanes read a page each. Discovery, rule probes, lookahead, duplicates and expired rows still consume the meter. Inspect structural costs with `snapback4 check --cost`; if a held query answers this read, delete the merge. Relationship-driven merges may benefit from entries per reader (guide feeds). `why` opens the first matching diagnostic's card in the current project: feeds for Following, search for membership search; without a matching diagnostic it defaults to search. Membership search points to guide search, section 'Search every chat I'm in': one unscoped words index on held messages, or separate membership and result cursors for bounded server batches. A result cursor alone cannot continue undiscovered chats or a meter-cut matching merge."),
    ("N_NO_CURSOR", "a note, not an error — a query returns a page with no cursor argument, so it cannot continue: when more rows exist than the page holds the card reads `complete: false` with no `next`. Declare `c: cursor ?` and page with `after c`, or bound a single group's population with a table cap the page covers, such as `cap 50 by conversationId` for a page of 50 pinned by conversationId. The cap must fit the examined ceiling; other metered work can still cut the read."),
    ("N_SEEK", "a where on the next index column is a seek; write it in the key, with the comparison after the pinned prefix."),
    ("N_SPARSE_FILTER", "an unscoped where pins no index prefix; sparse matches can exhaust the row meter and return short complete: false pages. Pin a leading index key, or use the Following recipe (guide feeds)."),
    ("N_NEVER_COMPLETE", "a note, not an error — a page whose read rule reads a column the scan does not pin is `complete: false` on the server whatever it finds; the note names the index that would decide it, or a merge of matching scopes for word search (guide search), then reading the page on the device."),
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
