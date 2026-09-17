# Received independent review — 2026-09-16

Invocation: Muse CLI default model, xhigh; first pass used read/search because shell sandbox failed. Baseline: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15`.
This is the received report with trailing whitespace normalized, not an accepted verdict. Lead adjudication is in the review index. Absolute paths refer to the reviewer workspace.

---

muse: workspace root: /home/ccheever/projects/snapback-review-20260916 (explicit)
muse: warning: rules file at /home/ccheever/projects/snapback-review-20260916/AGENTS.md exists, but the workspace is untrusted, so it is skipped for this session; restart with --trust-workspace to load project rules
muse: Skills: 20 loaded · 1 warning
muse:   .agents: project-skills-untrusted: project skills skipped because workspace is untrusted
muse:   Run `muse skills list --source all` for full diagnostics.
muse: Agent delegation: auto unavailable: workspace is untrusted.
# Snapback 4 — independent review at pinned commit `a0d48a4`

One reviewer, no subagents, no worktrees, no remote commands, no implementation, no git mutations. Read-only probes only (`read_file`/`search`); shell was unavailable in this session (`bwrap: loopback: Operation not permitted` on every `bash` call, so the pinned SHA could not be re-verified via `git rev-parse` — the tree below is reviewed as present, assumed to be the pin).

Read before reviewing: `snapback4/AGENTS.md`, `snapback4/NOT-DOING.md`, `rules/RULES.md`, `llp/3000-snapback4.explainer.md` (root), `llp/2000.000-keep-the-core-flip-two-substrates.rfc.md` (brief), `llp/3000.005`, `llp/3000.007`, `llp/3000.009` plus `3000.001/3000.004/3000.006/3000.008.*` headers, `snapback4/JOURNAL.md` tail (through `0.2.26` / wave 10, ~line 24773), `snapback4/packages/snapback4/README.md`, `CLIENT-AND-OPERATIONS.md` (skim), `SERVER.md` (skim). Skipped style and all `NOT-DOING.md` explicit non-goals.

## Coverage inventory

Traced across boundaries (read the bodies, not just listings):

- Core: [identity.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/identity.rs:1), [partition.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/partition.rs:1), [meter.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/meter.rs:1), [store.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/store.rs:1), [private_fs.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/private_fs.rs:1), [assets.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/assets.rs:1), [ids.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/ids.rs:1), `engine/rules.rs`, `engine/admission.rs`, `engine/postgres/store.rs` (partial).
- HTTP/CLI: [serve.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/serve.rs:1) (`Shared`, admission, `principal_of`, `dev_request`, `cors`, body ceilings, `JsonBuffer`), [auth.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/auth.rs:1), `verbs/sql.rs`, `native.rs` (partial).
- TS: [client.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/client.ts:1), [local.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/local.ts:1) (partial), [web.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/web.ts:1), [server-routes.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/server-routes.ts:1), [react.tsx](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/react.tsx:1) (partial).
- Rust device: [device.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-device/src/device.rs:1) (header/types only).
- Tickets: all `issues/2026091*-snapback4-*.md` titles + full read of cleartext, store-perms, unauth-catalog; skim of postgres-serializable, postgres-replay, request-decoding, acquisition-baseline, w5c-receipt.

Could not inspect (name explicitly): `engine/runner.rs` + `read.rs`/`local.rs` bodies; `store.rs` beyond line ~150 (catalog upgrade, seq, log read paths); `partition/storage.rs` (snapshot vs stream bounds, horizon/cap enforcement); `engine/job.rs`, `engine/actions*.rs`, `engine/effects.rs`, `engine/native.rs` (wasm sandbox, fuel, imports); `engine/postgres/prefetch.rs` + `tail.rs`; `engine/prefetch.rs`; `schema.rs` + `bind/*` (residency, audience_binding proof); `emit/rust.rs` + `emit/server.rs` (codegen sanitization); `serve_routes.rs` ingress bounds, `serve_changes.rs`, `serve_adoption.rs`, `actions.rs`, `assets.rs` (server side), `dev_worker.ts`/`lifecycle`, `deploy`/`rollback`/`data`/`doctor`/`token`/`device` verbs; `local-exit.ts`, `web-journal.ts`, `local-assets.ts`, `changes.ts`, `writes.ts`, `auth.ts` (TS), `backend.ts`, `worker.ts`, `server.ts`/`server-context.ts`/`server-steps.ts`/`server-json.ts`; Expo Swift bridge + `packages/snapback4-expo`; `crates/snapback4-sim` invariants; `scripts/test.sh`, `scripts/publish.mjs`, `scripts/signing.mjs`; `apps/chat*` rendering/XSS posture; `witness/*`, `loopbar/*`, `experiments/postgres` beyond the two reports. No builds or suites were run (forbidden); all findings are code-traced, not execution-verified.

## Validated defects (code path traced)

### V1 — Medium — `mintId` falls back to `Math.random` and forces wall-clock into the future
- Evidence: [client.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/client.ts:54) `now = Math.max(now, lastMinted + 1)`; [client.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/client.ts:58)`else for (...) bytes[i] = Math.floor(Math.random()*256)`.
- Trigger: (a) any context without `crypto.getRandomValues` (non-secure context, old WebView) mints 80-bit ids from a predictable PRNG — the server side correctly uses `getrandom` ([ids.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/ids.rs:11)); (b) a backward clock step pins `lastMinted` in the future process-wide, so all later ids carry a future `minted_at`, breaking time-ordering vs peers and any `minted_at`-derived expiry/horizon reasoning.
- Fix: fail closed when `crypto.getRandomValues` is absent; replace `Math.max(now, lastMinted+1)` with same-ms entropy ordering or a bounded skew window that never advances the timestamp more than 1ms per mint without fresh entropy.
- Tracked: no (server-side `predictable-server-minted-ids` is a different surface).

### V2 — Medium — guest principals accumulate without bound
- Evidence: [identity.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/identity.rs:237) `guest()` inserts a fresh `guest:<id>` principal; [identity.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/identity.rs:134) `insert_session` GCs only expired `_sessions`, never `_principals`.
- Trigger: `POST /auth/guest` at the 30/min/IP limit sustained over days creates one `_principals` row per mint forever. Disk growth with no quorum; also enlarges every principal scan.
- Fix: GC guest principals with no rows/sessions/outbox references, or rate-cap guest creation per IP/day and document the retention.
- Tracked: no (session-lifecycle ticket covers expiry, not principal GC).

### V3 — Medium — 16 MiB JSON response buffer × 88 threads is a 0.5–1 GiB heap cliff
- Evidence: [serve.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/serve.rs:494) `JSON_RESPONSE_CEILING = 16<<20`; [serve.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/serve.rs:499) `JsonBuffer::write` grows to the ceiling per request; [serve.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/serve.rs:355) limits admit 32 short + 32 wait + 16 route + 4 + 4 concurrent request threads.
- Trigger: a handful of concurrent large-page `/q/` or `/sync` replies (each legitimately up to the meter's 1 MiB output, but the wire allows 16× that) co-located with long polls exhausts a small host. The `E_BOUND`-on-overflow fallback ([serve.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/serve.rs:575)) is correct, but the pre-failure allocation is the defect.
- Fix: lower the wire ceiling toward the meter's `output_bytes` (1 MiB default) or stream the body instead of buffering the full JSON tree; account `JsonBuffer` against admission (fewer concurrent large replies).
- Tracked: partially (`unbounded-http-threads` covers thread counts, not the 16 MiB × threads product).

### V4 — Low — CORS reflects any well-formed `Origin`
- Evidence: [serve.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/serve.rs:477) `cors()` pushes `Access-Control-Allow-Origin: <origin>` whenever `origin_authority(origin).is_some()`, with no loopback or allowlist check; allowed headers include `authorization` and `x-snapback-persona`.
- Trigger: any site can read unauthenticated same-shape responses cross-origin. Authenticated exfiltration still needs the token (not present), and `dev_request` separately fences personas to loopback ([serve.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/serve.rs:463)), so exploitability is low — but the reflection is broader than the documented loopback-dev model.
- Fix: reflect only loopback origins (same predicate as `dev_request`), otherwise omit the header.
- Tracked: yes — `20260913-snapback4-dev-cross-origin-loopback-doors.md`; keep, do not re-file.

### V5 — Low — `useQuery` cache key collides on `undefined`-valued args
- Evidence: [react.tsx](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/react.tsx:58) `const key = JSON.stringify(args)`.
- Trigger: `observe(op, {a: undefined})` vs `observe(op, {})` stringify identically, so two distinct argument shapes share one `Observation` and one screen can show the other's snapshot. `BigInt` args throw instead.
- Fix: canonicalize args with the same `canonical_json` the core uses (or a stable serializer that preserves `undefined` vs absent and supports `BigInt`).
- Tracked: no.

### V6 — Low — `sql --limit` is unbounded (CLI DoS on self)
- Evidence: [verbs/sql.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/verbs/sql.rs:28) `--limit` parses any positive `u32`; [verbs/sql.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/verbs/sql.rs:104) wraps as `LIMIT <n>+1` and materializes `rows: Vec`.
- Trigger: `snapback4 sql 'SELECT ...' --limit 4294967295` attempts to materialize billions of rows in the developer's own process. Developer-only, local-host scope — hence Low.
- Fix: cap `--limit` (e.g. 10k) or stream rows instead of collecting.
- Tracked: no.

## Suspicions (need a repro before filing)

### S1 — Medium — null sync keys write successfully but sync nowhere
- Reasoning: [partition.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/partition.rs:114) drops `Column`-audience rows whose field is not `Value::Id`, and drops `Target` groups containing `Null` ([partition.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/partition.rs:122)). With one `sync` line per table, such rows are invisible to every device while the mutation reports success — a write/read divergence between the online tier (rule-checked) and replicas. Needs a binder check: if the compiler already refuses non-`Id`/null sync keys at write sites, this is not a bug.
- Repro: table with `sync to memberships[.conversationId]`, insert a row with null/wrong-typed key as a permitted principal, then `/sync` from a member device and compare with `/q/`.
- Fix if confirmed: refuse the write with the sync key named, not silent drop.

### S2 — Medium — no-Web-Locks fallback shares one IDB store between tabs
- Reasoning: [web.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/web.ts:273) returns `{name, exclusive:false}` when `navigator.locks` is missing, so two tabs run two in-memory devices against one persisted name with no fencing. Watermark/outbox last-write-wins; server-side id deduplication bounds duplication, but watermark regression can delay rows until the next full sync.
- Repro: two tabs, locks API removed, interleave writes + `apply` on both, compare watermarks and server `_ops`.
- Fix if confirmed: fail closed (second tab opens its own `name:tab-*` store, as the locked path does) or ship an IDB-based mutex.

### S3 — Medium — pagehide outbox window may lose just-admitted writes
- Reasoning: [web.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/web.ts:78) `settle()` persists `device.drain()` asynchronously; `onSuspend/beginSend` ([web.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/web.ts:111)) snapshots in-memory state, but a `pagehide` that kills the async `persist.save` leaves an admitted-but-unpersisted outbox entry in discarded memory. `adoptOrphans` only adopts persisted stores. `local-exit.ts` (not inspected) decides whether the flush actually reaches the network.
- Repro: admit a write, `pagehide` within milliseconds on a throttled IDB, close, reopen, check `_ops`/device outbox.
- Maps to LLP `3000.001` (durable replica and write lifecycle). Do not file until `local-exit.ts` + `web-journal.ts` are traced.

### S4 — Medium — cross-tab concurrent session rotation logs one tab out
- Reasoning: [identity.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/identity.rs:222) rotation is atomic (loser gets `Ok(None)`), but TS singleflight is per-client ([client.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/client.ts:186) `refreshing`, `local.ts` `rotating`). Two tabs sharing one session via `sessionStore` can race; the loser treats `E_AUTH` as logout (`endCredentials`).
- Repro: two tabs, force expiry within the same second, observe one tab signed-out.
- Fix if confirmed: cross-tab refresh serialization or retry-once against the replacement token.

### S5 — Low-Medium — hub-scale `acknowledged` maps may exceed the 256 KiB sync ceiling and stall sync
- Reasoning: [serve.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/serve.rs:492) `SYNC_REQUEST_CEILING = 256<<10`; `StreamPage.acknowledged: BTreeMap<String,u64>` ([device.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-device/src/device.rs:79)) grows with held groups (hub principal holds ~1k groups; each `g:<table>:<json>` key is tens of bytes). Near the ceiling the device can never acknowledge a full generation and retries 413 forever.
- Repro: hub principal, full-generation `POST /sync` with a complete `acknowledged` map, measure bytes vs 262144.
- Fix if confirmed: paginate acknowledgements or bound the key encoding.

### S6 — Low — asset serve has a check-to-send TOCTOU on home-row deletion
- Reasoning: server-side `assets::serve` re-resolves the principal after the body ([assets.rs via serve.rs recheck pattern](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/serve.rs:787)), and `AssetTransfers` serializes one-view grants ([serve.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/serve.rs:134)) — both good. Unconfirmed: whether the home row's read-rule check and the filesystem `open`/`send` share one engine transaction. If the file is opened after the guard is released, a delete/expire racing the send still serves bytes once.
- Repro: `image once` asset, race home-row delete against `GET /assets/<id>`.
- Fix if confirmed: open the file descriptor under the same guard that authorizes it.

### S7 — Low — Postgres evaluation schema has no global-seq index for streams
- Reasoning: Postgres DDL PKs `_log(partition,seq,ord)` ([engine/postgres/store.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/engine/postgres/store.rs:25)); a watermark-ordered stream across partitions cannot use that prefix efficiently. SQLite side not compared (not inspected). The serializable-contention failures are already tracked; this is the separate read-path concern.
- Repro: `EXPLAIN` the stream query on a 100k-row eval schema.
- Tracked in part: `postgres-serializable-benchmark-failures` (write contention) and `postgres-replay-skips-the-id-binding` (C3) — do not conflate; file separately only with the plan attached.

## Already tracked — do not re-file

Code now shows fixes for several 2026-09-13 tickets (lead to close after validation): store world-readable perms (fixed by `private_fs.rs` + `store.rs:70`), unauthenticated `/`/`/schema`/`/changes` (now gated by `principal_of` at [serve.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/serve.rs:744)); still-open and correctly open: serve-cleartext-all-interfaces (P1), postgres-replay-skips-id-binding (C3), postgres-serializable-benchmark-failures (P3, experimental), request-decoding-concurrent-tails, acquisition-readiness-client-test-baseline, w5c-secondary-receipt-intermittent, witness-driver-flaky-under-load, plus auth/session/asset/HTTP-bounds tickets whose acceptance I did not re-verify. The `sql` authorizer spoof hardening ([verbs/sql.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/verbs/sql.rs:69)) and route 64 KiB/64-header/10 s bounds ([server-routes.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/server-routes.ts:42)) read as already-deliberate; Rust ingress parity is the remaining gap (not inspected).

## Major direction questions (no rewrite proposed now)

1. Thread-per-request + one engine `Mutex` ([serve.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/serve.rs:381)) with `QueryReaders` reuse ([serve.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/serve.rs:86)): keep for the slice and measure head-of-line under digest/rescore load before any async or read/write-split redesign. Maps to LLP 2000.000 §6/§8, LLP `3000.008.003`.
2. Web persistence (wasm memory + async IDB behind a sync interpreter, [web.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/web.ts:1)): keep vs synchronous origin-private storage. The close-loss question (S3) is the falsifier. Maps to LLP `3000.001`.
3. App Rust in the data plane (LLP `3000.005`, [native.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/native.rs:1)): the wasm sandbox (fuel, imports, determinism, digest pinning) was not inspected here — no claim for or against; needs a dedicated sandbox review before any widening. Alternative stays LLP `3000.004` §6.5 (external ranker over a service seat).
4. Application SQL reads (admitted 2026-09-16, LLP `3000.009` §6.2): the inspection verb's authorizer reads sound ([verbs/sql.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/verbs/sql.rs:78)); the application-read authorization-before-selection path was not in this tree to review. Keep Quarry-only until that path plus the SQLite/Postgres parity half are reviewable together.
5. Group-keyed partition log with one `sync` line per table (LLP 2000.000 §7, LLP `3000.007` §20.6): the fan-out win is real (floors: ~0.15 ms/send); the open risks are the S1/S5 edges above, not the shape. No union-audiences or exact-horizon work follows from this review.
