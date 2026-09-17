# Received independent review — 2026-09-16

Invocation: Muse CLI default model, xhigh; supplemental pass with read-only shell instructions. Baseline: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15`.
This is the received report with trailing whitespace normalized, not an accepted verdict. Lead adjudication is in the review index. Absolute paths refer to the reviewer workspace.

---

muse: workspace root: /home/ccheever/projects/snapback-review-20260916 (explicit)
muse: warning: rules file at /home/ccheever/projects/snapback-review-20260916/AGENTS.md exists, but the workspace is untrusted, so it is skipped for this session; restart with --trust-workspace to load project rules
muse: Skills: 20 loaded · 1 warning
muse:   .agents: project-skills-untrusted: project skills skipped because workspace is untrusted
muse:   Run `muse skills list --source all` for full diagnostics.
muse: Agent delegation: auto unavailable: workspace is untrusted.
# Supplemental report — Snapback 4 at `a0d48a4` (gaps the first report could not inspect)

Pin verified read-only (`git rev-parse HEAD` = `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15`, `git status` clean). No code changes, no git mutations, no subagents/worktrees/remotes, no builds or suites. Read `snapback4/AGENTS.md` plus the root `AGENTS.md` fence section before reviewing.

## New confirmed defects

### N1 — Medium — native job `log` is unbounded and outside fuel/meter accounting
- Evidence: [native.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/engine/native.rs:284) pushes every `log` message into `Host.logs` with no count/byte cap; [native.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/engine/native.rs:174) sets only wasmi fuel, and host-side JSON/allocation per call is outside fuel accounting. Per-chunk logs extend the engine-wide [job.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/engine/job.rs:380) `native_logs`, drained only by printing (`verbs.rs:391`, `serve_maintenance.rs:39`).
- Trigger: app's own row-loop job calling `log` per row (8k-row chunk) × many chunks accumulates strings in memory and floods stderr. Self-DoS (trusted app code), but it is the data-plane host's availability at stake.
- Fix: cap logs per chunk (e.g. 64 entries / 64 KiB, truncation marker) and charge the meter.
- Tracked: no.

### N2 — Medium — S1 CONFIRMED: null/optional sync keys write OK but sync nowhere
- Evidence: binder checks prefix columns for existence only ([schema.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-lang/src/bind/schema.rs:232)), never optionality; `Column` audience checks `TypeKind::Principal` but ignores the `optional` flag ([schema.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-lang/src/bind/schema.rs:221)). Runtime drops them silently: `group_of` yields `Null` ([partition.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/partition.rs:100)), `partitions` returns empty for null groups/non-Ids ([partition.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/partition.rs:114)), `row_changed` then emits zero events on a committed write.
- Repro: table with `sync to memberships[.conversationId]` where `conversationId` is optional; insert a row with null key as a permitted principal; `/q/` shows it, `/sync` on a member device never does.
- Fix: reject optional columns in sync-audience positions at bind time, and/or refuse the write naming the null key instead of dropping.
- Tracked: no (was suspicion S1, now confirmed — file it).

### N3 — Medium — S2 CONFIRMED: no-Web-Locks fallback shares one IDB store with no fencing
- Evidence: [web.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/web.ts:273) returns the shared `name` with `exclusive:false` when `navigator.locks` is missing (locked path instead mints `name:tab-*`). Journal capture and recovery both early-return when not exclusive ([web-journal.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/web-journal.ts:106), [web-journal.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/web-journal.ts:163)). Store name is per `(base, viewer)` ([local.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/local.ts:188)), so two same-viewer tabs share it.
- Fix: second tab opens its own `tab-*` store (as the locked path does) or ship an IDB mutex; at minimum fail closed instead of shared-name operation.
- Tracked: no (was S2, now confirmed — file it).

### N4 — Low — Expo store `name` is unsanitized in the file path
- Evidence: [index.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4-expo/src/index.ts:36) interpolates `name` into `${documentDirectory}/${name}.sqlite`. Swift `assetFile` allowlists alphanumerics ([Snapback4Module.swift](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4-expo/ios/Snapback4Module.swift:101)), but `open(path)` takes any path. `name` with `../` escapes Documents (app-sandbox scope, self-inflicted).
- Fix: sanitize `name` the way `assetFile` sanitizes `id`.
- Tracked: no.

### N5 — Low — Rust codegen can collide after `snake()` normalization
- Evidence: [rust.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-lang/src/emit/rust.rs:82) maps every non-alphanumeric to `_`, so `foo-bar` vs `foo_bar` (if the lexer admits both spellings) emit duplicate struct/const names. Fail-closed (compile error), but a confusing one far from the declaration.
- Fix: binder rejects declarations whose `snake()` forms collide.
- Tracked: no.

### N6 — Low — publish ships signed-but-not-notarized binaries on a log line
- Evidence: [signing.mjs](/home/ccheever/projects/snapback-review-20260916/snapback4/scripts/signing.mjs:67) returns `notarized:false` with only `console.log` when `SNAPBACK4_NOTARY_PROFILE` is unset; [publish.mjs](/home/ccheever/projects/snapback-review-20260916/snapback4/scripts/publish.mjs:124) publishes anyway (record is honest about it). macOS Gatekeeper treats this worse than the log suggests.
- Fix: require notarization for non-`--dry-run` publishes, or print the Gatekeeper consequence explicitly.
- Tracked: no.

## Earlier suspicions, updated against code

- S3 (pagehide loss) — narrowed, not withdrawn. Exclusive-lock path has two layers: synchronous localStorage journal before mutate's first await ([web-journal.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/web-journal.ts:104)) plus keepalive-head transport of the oldest entry only ([local-exit.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/local-exit.ts:15)). Loss there needs localStorage disabled/quota-exhausted *and* IDB persist killed *and* keepalive failing. The no-locks path has no journal and `adoptOrphans` requires locks ([web.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/web.ts:306)), so S3 is confirmed for that path. Do not file separately from N3.
- S4 (cross-tab rotation logout) — downgraded to Low/conditional. Default store is per-tab memory ([auth.ts](/home/ccheever/projects/snapback-review-20260916/snapback4/packages/snapback4/src/auth.ts:83)); the race needs the opt-in shared `localStorageSessionStore` plus same-window expiry, with no cross-tab coordination primitive in the tree.
- S5 (hub `acknowledged` stalls sync) — stays suspicion. 256 KiB request ceiling is real ([serve.rs:492] per first report); no per-map bound found on either side. Needs a byte measurement, not a filing.
- S6 (asset TOCTOU) — confirmed shape, stays Low. Grant is taken under the engine lock, then the lock is released before `File::open`/send ([assets.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/assets.rs:63)); a racing delete serves already-authorized bytes once. `ExactReader` correctly avoids consuming one-view grants on truncation. Accept or revalidate post-open; not a privilege escalation.
- S7 (Postgres global-seq index) — withdrawn. The storage trait reads per-partition spans ([storage.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/partition/storage.rs:29)), so no global-seq index is needed by design; the tracked serializable-contention tickets are the separate write-path concern.

## First-report gaps now closed (no new filing)

- Codegen sanitization verified sound: `serde_json` literals both sides, U+2028/29 escaping and `__proto__`/comment-breakout handling ([emit.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-lang/src/emit.rs:140)).
- Rust route-ingress parity verified: 64 KiB body, 16 KiB/64 headers, ticket cap, persona-vs-provider separation ([serve_routes.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/serve_routes.rs:58)).
- Native sandbox shape verified: single `sb4_call` import, fuel per chunk/read, read-only refusal for writes in reads ([native.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-core/src/engine/native.rs:120)); determinism holds via host-supplied `now`/args (mint falls back to seeded entropy only when ids are not supplied). N1 is the remaining hole.
- Deploy/rollback verified sane: advisory lock forces downtime deploys, DB-first `current()` survives pointer/file skew, immutable numbered releases ([releases.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4/src/releases.rs:57)). Grievances are ledger fsync/replay (observability-only) — not filed.
- Device admission/replay verified careful: id-equality at-most-once under the writer transaction, `SUBMISSION` high-water against seq reuse, snapshot ownership counters, watermark/generation/ack guards ([device.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-device/src/device.rs:468)).
- Chat XSS probe negative: no `innerHTML`/`dangerouslySetInnerHTML` in `apps/chat` (React default escaping). Not a full audit.
- Sim invariants observed: card/words, monotone watermarks, at-most-once, revoked-never-renders, checked per event ([chat.rs](/home/ccheever/projects/snapback-review-20260916/snapback4/crates/snapback4-sim/src/chat.rs:170)).

## Architecture concerns (unchanged direction, one addition)

First-report items 1–5 stand as read. Add: the web tier now has two durability regimes (locks vs no-locks) with silently different guarantees — journaling, orphan adoption, and S3 exposure all hinge on `exclusive`. That split deserves one documented guarantee ("second tab gets its own store or refuses") rather than per-path emergent behavior.

## Coverage

Read this round (bodies, not listings): `lang/bind/schema.rs` (sync/audience), `lang/emit.rs` + `emit/rust.rs` + `emit/server.rs`, `core/schema.rs` (audience_binding), `core/partition.rs` + `partition/storage.rs`, `core/engine/native.rs` (full), `engine/job.rs` (chunk/logs), `engine/runner.rs` (head), `engine/actions.rs` + `actions/steps.rs` (heads) + `engine/routes.rs` (full), `device/device.rs` (apply/admit/settle), `device/store.rs` + `ffi.rs` (full), `serve_routes.rs` + `serve_changes.rs` + `serve_adoption.rs` + `src/assets.rs` (serve), `verbs/releases.rs` (full), `server.ts` + `server-steps.ts` + `worker.ts` (heads) + `web.ts` (locks/orphans) + `web-journal.ts` (full) + `local-exit.ts` + `local.ts` (heads) + `auth.ts` (stores), Expo Swift + `index.ts`, `scripts/test.sh` + `publish.mjs` + `signing.mjs`, sim `chat.rs`/`world.rs` (heads).

Explicitly not read: `engine/write.rs`/`read.rs`/`local.rs` bodies, `store.rs` seq/log paths, postgres `tail.rs`/`prefetch.rs` bodies, `serve_tests`/`dev_worker`/`lifecycle`, `data`/`doctor`/`token`/`device` verb bodies, `local-assets`/`changes`/`writes`/`backend` details, `loopbar`/`witness` bodies, postgres experiments. No full-review claim beyond the files above.
