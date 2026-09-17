# Received independent review — 2026-09-16

Invocation: grok-4.6-build, xhigh. Baseline: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15`.
This is the received report with trailing whitespace normalized, not an accepted verdict. Lead adjudication is in the review index. Absolute paths refer to the reviewer workspace.

---

I’ll continue from the orientation already done and start tracing real implementation paths—auth, sync, writes, assets, device, and HTTP—then write the full evidence-based review.I’ll treat those tickets as already-tracked and now trace the live security and data-loss paths in serve, identity, partition, writes, and the device.Confirmed several live defects by tracing call paths. Checking one remaining native-module size bound, then writing the full report.# Snapback 4 independent review

Pinned commit: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15` (workspace HEAD). Single reviewer, read-only. No other reviewer reports were read. No builds, suites, clones, remotes, or git mutations.

## Verdict

The production SQLite path is a real system: one interpreter, partitioned sync, write-authority work, loopback/dev fencing, and H0 deploy/serve are implemented and internally consistent with LLP 3000’s settled decisions. The 2026-09-13 security remediations I traced are present in code even when leftover `issues/` copies still say Open.

What is not settled is the **server-runtime half** (LLP 3000.009): service seats are named in the language but not isolated at claim time; native wasm is metered for fuel/rows but not for host allocations; the web device’s durability still depends on Web Locks + IndexedDB racing an in-memory store; Postgres replay still skips the id/argument binding SQLite now enforces.

I did not run tests. Findings below are from tracing call paths. **Validated** means the code path is complete enough to name a trigger. **Suspicion** means the path is real but I did not close every adjacent branch.

---

## Validated defects

### 1. High — any service token can verify another service’s provider route

**Already tracked:** no.

**Evidence:** `snapback4/crates/snapback4/src/serve_route_verify.rs:23–40` (claim), `:60–81` (settle Allow), `snapback4/crates/snapback4-core/src/engine/routes.rs:42–44` (admit as the *declared* seat).

`claim` requires `service_of` (any `service:*` session) and that the ticket’s route name is in the claim list. It does **not** require `worker == route.service`. On Allow, `request_verified_route` always admits work as the route’s declared seat (`Context::new(principal, …)` where `principal` is `schema.routes[name].service`), using the generation captured at ingress.

**Trigger:** schema declares `route billing: post "/hooks/billing" as service:billing` and also `service:ranker`. Ranker token `POST /routes/verify/claim` with `{"routes":["billing"]}`. When a billing POST is waiting, ranker Allow-settles it. Engine queues durable work as `service:billing`.

The routes card says the verifier checks the provider signature (`snapback4/crates/snapback4-lang/src/guide/routes.rs:18–20`). The wire does not bind that verifier to the declared seat.

**Fix:** at claim and settle, require `worker == declaration.service`. Refuse with `E_ROUTE_LEASE` / `E_AUTH` otherwise. Same check inside `request_verified_route` against the settling worker, not only against the stored generation.

---

### 2. Medium — service seats are not isolated for effects or actions either

**Already tracked:** no (same class as 1; actions/effects have no per-seat claim filter).

**Evidence:** `snapback4/crates/snapback4-core/src/engine/effects.rs:132–140` (`claim_effects_inner` filters by effect name, not worker). `…/engine/actions.rs:254–259` (`claim_selected_actions` checks `is_service(worker)` then claims any matching queued name). HTTP `/effects/*/cancel` (`serve.rs:1124–1127`) cancels by id after any service auth, with no lease.

**Trigger:** `service:ranker` claims `effect: "mail"` or `action: "invite"` (or `cancel`s another seat’s effect). The generated worker can poll a name set, but the engine will hand that work to whoever asked.

**Reasoning:** LLP 3000 §7 (“the engine never calls out; a worker with a seat does”) and named `service:<name>` in rules imply seats are principals with distinct authority. Claim is currently “any service is a worker.” Fine for a single Node worker; wrong once two seats exist.

**Fix:** bind effects to an optional declared seat (or to the emitting mutation’s intended worker). For actions, either declare `as service:…` on the action (schedules already do) or restrict `claim_action_set` to names that seat is allowed to run. Cancel must require the claim lease, as settle already does.

---

### 3. High (resource) — native wasm can force unbounded host allocations before fuel matters

**Already tracked:** not specifically. Related research: LLP 3000.002 (physical work outside the meter).

**Evidence:** `snapback4/crates/snapback4-core/src/engine/native.rs:136–138`:

```136:138:snapback4/crates/snapback4-core/src/engine/native.rs
    let mut bytes = vec![0u8; len.max(0) as usize];
    if memory.read(&caller, ptr as u32 as usize, &mut bytes).is_err() {
        return 0;
```

`len` is guest `i32`. The host allocates that many bytes, then `memory.read` fails if the guest memory is smaller. `read_packed` (`:157–159`) does the same for the guest’s return `(ptr<<32)|len`. The `log` op (`:284–286`) `push`es an unbounded string. Chunk logs accumulate on `Engine.native_logs` (`job.rs:380`) until maintenance prints them (`serve_maintenance.rs:39`). Fuel (`FUEL_PER_CHUNK = 2_000_000_000`, `:23`) counts wasm instructions, not host heap.

Native jobs run as `SYSTEM_PRINCIPAL` (`job.rs:372–374`), so a trapped/buggy module is also data-plane root. That is the LLP 3000.005 contract; the missing piece is that a module should not be able to OOM the process in one host call.

**Trigger:** `job score(): native` whose wasm calls `sb4_call` with `len = i32::MAX`, or returns a huge packed length, or logs a multi-megabyte string per chunk.

**Fix:** cap `len` at remaining wasm memory and at a host ceiling (e.g. the heap meter). Charge heap before `vec![0; n]`. Cap log line length and `native_logs` depth. Treat oversize as `E_NATIVE` / park the job.

---

### 4. High (data loss) — without Web Locks, every tab shares one in-memory device over one IndexedDB

**Already tracked:** no.

**Evidence:** `snapback4/packages/snapback4/src/web.ts:273–281`:

```273:281:snapback4/packages/snapback4/src/web.ts
async function claim(name: string): Promise<Claim> {
  const locks = lockManager();
  if (!locks) return { name, exclusive: false, async release() {} };
  const held = await hold(locks, name);
  if (held) return { name, exclusive: true, release: held };
  const own = `${name}:tab-${Math.random().toString(36).slice(2, 10)}`;
```

Web Locks need a secure context. `http://192.168.x.x:4400` (dev `--bind 0.0.0.0 --i-understand-cleartext`) is not one. Two tabs then open the same store name, each with its own wasm `MemoryStore`, each `persist.save` last-writer-wins. `AdmissionJournal.capture` no-ops when `exclusive` is false (`web-journal.ts:107`), so the localStorage crash journal is also off.

**Trigger:** serve/dev on a non-localhost HTTP origin; open the chat app in two tabs; both queue writes; reload. Lost or duplicated outbox is the expected outcome of two unsynchronized memory stores.

**Fix:** refuse `webDevice()` without `navigator.locks` (typed `complete: false` / `E_DEVICE` with a rewrite), or use a single SharedWorker/exclusive IDB versionchange lock. Do not silently share the name.

---

### 5. Medium (data loss) — admission journal can drop a write with no signal

**Already tracked:** no. Adjacent: LLP 3000.001 (durable outbox); Muse navigation-loss ticket is still “needs reproduction.”

**Evidence:** `web-journal.ts:105–118`. `capture` returns `undefined` if not exclusive, no `storeId` yet, record > 64 KiB, more than 32 records, or journal > 256 KiB. `web.ts:152` then admits only in wasm/IDB. If IndexedDB `save` fails after wasm commit, `discard()` drops memory (`web.ts:175–177`). The comment at `:168` calls recovery indeterminate.

**Trigger:** 33rd offline write in one tab, or a >64 KiB args blob, then crash before IDB commit. Or first write before `device:store_id` is remembered.

**Fix:** if `capture` cannot persist, fail the admit (`denied` / queue locally with backpressure) instead of proceeding. Surface journal-full as a typed write failure. Do not admit without a store id.

---

### 6. Medium — query output over the meter is `E_BOUND`, after the result is fully built

**Already tracked:** remaining scope of LLP 3000.002 (the old “return oversized data” leak is gone).

**Evidence:** `engine/runner.rs:729–744`. `meter.charge` under `Cut::Cap` returns `Ok(false)` (`meter.rs:128–134`), but `charge_output` turns that into `RuntimeError::Bound`. `Engine::query` uses `Cut::Cap` (`engine/mod.rs:712–714`) then `charge_output`. The 1 MiB output ceiling is applied only after `runner.run` has allocated the tree. HTTP still has a separate 16 MiB encoder cap (`serve.rs:494, 571–579`).

**Trigger:** a query whose canonical JSON is > `Ceilings.output_bytes` (default 1 MiB) but whose scan was under examined/heap. Client sees a bound refusal, not `{ data, complete: false, cut: "meter" }`. Sync snapshots are not charged on this meter at all.

**Fix:** either cut/page before building the full tree, or document that output is an abort axis even for queries. Charge (or refuse) snapshot/stream encoding on the same bound.

---

### 7. Medium — worker-pool overflow resets the socket instead of refusing

**Already tracked:** 20260913 unbounded-HTTP tickets were remediations for unbounded threads; this leftover remains.

**Evidence:** `serve.rs:388` `request.abort()` when `RequestAdmission` is full. tiny_http default `max_connections: 128` (`vendor/tiny_http/src/limits.rs:24`). Write timeout is 5 s (`:28`) against a 16 MiB JSON ceiling and 25 s long polls.

**Trigger:** 32 short + 32 wait + 16 route + 4 registry + 4 verifier permits held; the next client sees a dropped connection, not `503`/`429`. A slow reader of a large `/sync` page can hit the 5 s write deadline.

**Fix:** respond `503` with `E_RATE_LIMIT` / `retryable` before abort. Raise write timeout for known large responses, or cap sync pages so they fit the deadline.

---

### 8. Medium — Postgres replay still ignores operation name and argument digest

**Already tracked:** `issues/20260915-snapback4-postgres-replay-skips-the-id-binding.md` (kept open for C3).

**Evidence:** `engine/postgres/mod.rs:163–177` (`replay` by `(viewer, op id)` only). `engine/postgres/store.rs:184–186` (`SELECT outcome FROM _ops WHERE principal = $1 AND id = $2`). SQLite now binds name + digest (`store.rs:801–809`). Postgres `record_applied` (`store.rs:188–190`) still inserts `(principal, id, seq, outcome)` with no name/digest columns.

**Trigger:** reuse a client-minted mutation id with a different op or args against the evaluation engine; the old receipt is returned.

**Fix:** as the ticket says — shared `replay_bound` on both stores, persisted atomically with the receipt.

---

### 9. Low — signup is an email oracle; login is not

**Already tracked:** no.

**Evidence:** `identity.rs:304–306` returns `"that email already has an account; sign in instead"` after a lookup, with no dummy Argon2. Login (`:345–354`) always verifies against `DUMMY_HASH` when the email is unknown.

**Trigger:** `POST /auth/signup` with an existing email vs a new one; the message differs. Rate limits apply off loopback (`auth.rs:110–115`).

**Fix:** same work and same message as failed login, or a constant “if this email is new, check your mail” shape. Keep the atomic unique insert.

---

### 10. Low — production CORS reflects any syntactically valid Origin

**Already tracked:** no (the 20260913 loopback-CORS ticket was about *dev doors*, and those are fenced in `dev_request`).

**Evidence:** `serve.rs:477–485`. `Access-Control-Allow-Origin` is the request Origin whenever `origin_authority` parses. `authorization` is allowed. No `Allow-Credentials`, so this is not cookie CSRF. A page that already has a bearer token can call the API from any origin. Combined with guests (`/auth/guest` is unauthenticated), any site can mint a guest and download `/schema`.

**Fix:** for `serve`, reflect only configured app origins (or none; let the proxy handle CORS). Keep reflect-any for loopback `dev`.

---

## Suspicions (path real, not fully closed)

| Severity | Issue | Why not validated |
|---|---|---|
| Medium | Native `install_native` stores full wasm as hex in device meta with no size cap (`device.rs:321–338`). A huge `/native.wasm` bloats the replica. | App-authored module; I did not measure a malicious crate. |
| Medium | `mintId` falls back to `Math.random` if `crypto.getRandomValues` is missing (`client.ts:54–59`). Colliding client ids break at-most-once. | Browsers/Node 24 have Web Crypto; only exotic hosts hit this. |
| Low | `Engine.native_logs` can grow between maintenance ticks if a job logs faster than the drain. | Tied to finding 3; not a separate root cause. |
| Low | Postgres `record_effects` drops presence deferral (`store.rs:193–196`). Presence-gated emits on PG are wrong. | Prototype explicitly out of scope for effects; still a semantic fork. |
| Low | `dispatch` spawn failure (`serve.rs:389–390`) drops the `Request` without a response. | Rare (`thread` resource). |

---

## Already tracked — confirmed still in the tree

These I re-traced and they still match the ticket. Do not duplicate.

- **Postgres replay unbound** — finding 8 / `20260915-snapback4-postgres-replay-skips-the-id-binding`.
- **Mixed left/held query** — `20260914-snapback4-mixed-left-held-query-loses-retained-rows-online`. Device vs server whole-query fallback; documented limit, not a silent bug.
- **C1/Postgres performance and serializable cells** — `20260916-snapback4-postgres-serializable-benchmark-failures`, `20260916-snapback4-w9-integration-handoff`, `20260914-snapback4-membership-feed-query-cost`, `20260916-snapback4-request-decoding-concurrent-tails`.
- **Wasm diet, suite > 60 s, flaky witnesses/lifecycle** — `20260913-snapback4-wasm-device-diet`, `20260913-snapback4-blocking-suite-over-60-seconds`, `20260914-snapback4-lifecycle-tests-time-out-under-host-load`, `20260915-snapback4-witness-driver-existing-app-test-flaky-under-load`, `20260916-snapback4-acquisition-readiness-client-test-baseline`.
- **Needs reproduction** — Grok like-list, Muse navigation outbox, W5c secondary receipt.

**Stale Open copies:** many `issues/20260913-snapback4-*` files still say Open while `issues/closed/` has the same slug as Closed. Code at this commit contains the remediations: `principal_of` on `/`, `/schema`, `/api.ts`, `/native.wasm`, `/changes`; `private_fs` 0700/0600; `release_bind` loopback unless `--i-understand-cleartext`; KDF off the engine mutex; unique hidden collisions → `E_RULE`; asset 416 + `private, no-store`; once-view recorded after full send; `validate_sync` grant_guard (schema.rs:1038–1052); upload prepare/write/finish split. Treat those Open files as duplicates, not live defects.

---

## Direction / rewrite questions (map to LLPs)

1. **Are named `service:*` seats isolated principals, or aliases for one worker?**
   Findings 1–2. LLP 3000 §7 (engine never calls out), LLP 3000.009 §5.1 (authority bound at admission). If seats are principals, claim/verify/cancel must be seat-scoped. If they are not, the language should stop pretending they are.

2. **What is the physical bound for native modules and partition acquisition?**
   Finding 3, 6. LLP 3000.002 is still Draft for a reason: fuel, row ceilings, and the 16 MiB HTTP encoder do not bound host `Vec` growth, snapshot materialization, or native logs. Either native jobs are trusted root (document that, and the bakeoff accepts process-level DoS from app wasm) or the host ABI must meter allocations.

3. **Is the web device allowed to run without exclusive custody?**
   Finding 4. LLP 3000 §7 (one implementation, memory under wasm, host persists behind the call; a tab is a device). That contract is unimplemented when Web Locks are absent. LLP 3000.001’s “atomic snapshot ownership” is implemented *inside* one device (`device.rs:468–538` watermark/generation/send_revision/snapshot owner) and does not cover two devices on one IDB.

4. **Postgres: evaluation adapter or second production store?**
   LLP 3000.009 decision 1–2, NOT-DOING Moves 2026-09-15. The generic `r`/`i` layout plus a single `_head` row is an honest comparison harness, not a multi-writer database. Finding 8 plus missing auth/assets/jobs on PG means C3 is still a productization cliff, not a toggle. Do not describe Snapback 4 as “SQLite or Postgres” until replay binding, presence, assets, and serve exist on both.

5. **Online-only vs local-first on `/schema`.**
   Any live principal, including a guest, receives the full schema and IR (`serve.rs:744–748, 829–838`). Required for the wasm/native device. For the online-only brief (LLP 3000.009 §2, `init --online`) it is an authorization-map leak. A public subset (`guests`/`password` is already `/auth/config`) vs a device-only schema download is an unanswered product question.

6. **Query-wide provenance for retained vs live rows.**
   Tracked mixed-query ticket; LLP 3000.007 §18.2. Composing device-retained and server-authoritative fragments in one `Read` needs a new card word. Do not patch with more fallbacks.

7. **Activation ownership.**
   LLP 3000.000. `deployment_lock` (`verbs/releases.rs:14–23`) plus DB-authoritative `release` meta is the H0 answer: stop the server, then deploy. Remaining: `sql`/`data`/`run` vs a live host, and rollback as a new activation of old source (implemented: release numbers never reuse). I would not reopen this unless a live `serve` can still install.

LLP 3000.003’s TypeScript-twin divergences are historical; the twin is gone. Cross-host obligations now sit in LLP 3000.009 §11 (SQLite vs Postgres vs device). I did not re-prove corpus parity.

---

## Coverage inventory

| Area | What I actually traced | Depth |
|---|---|---|
| HTTP serve / dispatch / CORS / loopback | `serve.rs` handle, principal_of, body ceilings, admission classes, declared-route early return | Deep |
| Auth / sessions / KDF / custom sessions | `auth.rs`, `identity.rs` (signup/login/guest/rotate/revoke/authority chain) | Deep |
| Routes / verification tickets | `serve_routes.rs`, `serve_route_verify.rs`, `engine/routes.rs` | Deep |
| Actions / claim / settle / authority expiry | `actions.rs` (HTTP + engine), `identity::authority_expiry` | Deep |
| Effects claim/settle/cancel | `serve.rs` effects arms, `engine/effects.rs` claim | Medium |
| Assets upload/serve/range/once | HTTP `assets.rs`, core sniff/TTL/pixel caps (headers) | Medium |
| Partition stream / current-image screen | `partition.rs` stream + expand_joins + put→fetch/check_rule | Deep |
| Write authority / hidden unique / upsert | `write.rs`, `write_target.rs` | Deep |
| Meter / charge_output / Cut | `meter.rs`, `runner.rs` | Medium |
| Native wasm host ABI / jobs | `engine/native.rs`, `job.rs` native_chunk, system principal | Deep |
| Postgres engine | create/open, mutate/replay/applied, prefetch cache, `_head` FOR UPDATE | Deep on write/replay; light on scan SQL |
| Device apply / snapshot owner / native install | `device.rs` apply + install_native, `call.rs` dispatcher | Deep on apply; light on predictions/history helpers |
| Web persistence / journal / locks | `web.ts`, `web-journal.ts` | Deep |
| TS clients | `local.ts` (session/refresh/sync hooks), `client.ts` (refresh, mintId), `auth.ts` stores | Medium |
| Expo C ABI / Swift | `ffi.rs`, `Snapback4Module.swift` (lock, asset id charset) | Medium |
| Deploy / rollback / bind | `verbs/releases.rs` | Medium |
| SQL inspect verb | `verbs/sql.rs` authorizer + wrapping | Medium |
| Worker env / secret redact | `worker_environment.rs` | Medium |
| Maintenance / schedules | `serve_maintenance.rs`, `fire_schedules` | Medium |
| Guide cards | README + actions/routes cards; not every keyword card | Light |
| Compiler binder / parser / emit | `bind/schema.rs` sync + validate_sync grant_guard; not program lowering | Light |
| Simulator / corpus / witnesses / apps | listed, not path-traced | Not inspected |
| React hooks, generated server.ts, publish, search/words, successor, store activation internals | — | Not inspected |

### Explicitly not inspected

- Full Quarry lowering (`bind/program.rs`, helpers, `where`, `group`, page merge in `pages.rs`).
- Word-prefix search and feed recipes.
- Simulator fault schedule and the seven invariants’ current tests.
- Chromium/Expo witnesses, loop bar, Clique apps.
- `packages/snapback4/src/react.tsx`, `server.ts` / generated handler runtime in Node.
- `scripts/publish.mjs` signing, Darwin optional dependency.
- `vendor/tiny_http` patch beyond ConnectionLimits/admission comments.
- Postgres experiment harness SQL and ignored tests’ bodies.
- Android/Kotlin (no tree under this fence).
- Other reviewers’ reports for this pin.

I did not execute the suite, Postgres harness, or any HTTP probe. Line numbers are from this commit’s files.

---

## What looks sound (so the lead does not re-litigate it)

- Loopback `dev` doors: peer + Host + Origin (`serve.rs:463–474`); `serve` defaults to 127.0.0.1 (`release_bind`).
- Catalog/schema/changes require a live principal; `/auth/config` is the anonymous advertisement.
- Password hashing is off the engine mutex, rate-keyed by peer/email, dummy-hash on unknown login.
- Hidden unique collisions are `E_RULE`, not a named constraint (`write.rs:398–414`).
- Sync catch-up re-fetches the current row and suppresses hidden historical puts (`partition.rs:602–632`).
- Device apply refuses backward watermarks, overlapping sends, and foreign snapshot owners (`device.rs:485–528`).
- SQLite mutation replay binds op name + args digest (`store.rs:801–809`).
- Audience self-grant is refused at schema validate (`schema.rs:1038–1052`); the Open ticket is a stale duplicate.
- Asset once is consumed only after a successful full send; ranges on once are refused.

The remaining work that matters is **seat isolation, native host bounds, web exclusive custody, and Postgres identity binding** — not another pass over the 2026-09-13 HTTP/auth list.
