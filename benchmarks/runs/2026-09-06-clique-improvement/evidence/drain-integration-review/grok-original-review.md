# Drain composition review — 680b68716dd876823348a94fb8915ac7384305e7

**Verdict: CHANGES_REQUIRED**

Reviewer: native Grok 4.6 xhigh on PRIMARY. Snapshot-only. No subagents, clones, remotes, network research, author/peer LLP panel reads, moving-worktree reads, publication, or version changes. Product snapshot files were not modified.

Target `680b68716dd876823348a94fb8915ac7384305e7` is declared as frozen e911 drain work composed onto main `3c8028238ca67fb35365fa0788ec7f0ad3639bdc`. Comparison evidence is `revision.patch` (vs main) plus the combined sources in this snapshot. `factual-checks/` are copied author receipts from `clique-release-next`, not this reviewer's execution.

---

## Finding 1 — owner mounted-limit 413 cannot take the specified one-shot retry

**Severity:** composition defect in a named drain/resume path (LLP 1012 §8, guide `offline.md`). Not Clique-messenger-typical (inbox+thread stays far under 32), but it is the only owner-emitted `reason: "limit"` signal.

**Observable behavior (source-bound, not executed here):**

1. Owner resume refuses `mounted.len() > 32` as HTTP 413 `E_OFFLINE_RESUME` with `reason: "limit"`, `which: "mounted"`, `cap: 32` (`MAX_MOUNTED`).
2. Client `resumeAdjustment` accepts that shape only when `cap < 32`.
3. Therefore the production refusal never becomes an adjustment. `performOfflineResume` does not retry; it throws. `refuseDrains` also does not fire (`which` is `mounted`, `reason` is not `unsupported-log`).
4. The log is still not dropped on that throw (the request already included `log`; there is no omit-log retry). The specified *smaller retry* does not happen.
5. The client test that claims this path uses `cap: 0`, which satisfies `< 32` and therefore does not witness the owner's literal `cap: 32`.

**Sources:**

- `snapback2/crates/snapback2/src/writer_resume.rs` `MAX_MOUNTED = 32`; resume mounted-count arm sets `cap` to that constant.
- `snapback2/packages/snapback2/src/client-offline.ts` `resumeAdjustment` (`cap < 32`) and `performOfflineResume` retry (`retry && next && next.cap < request.mounted.length`).
- `snapback2/packages/snapback2/guide/offline.md`: only `{ reason: "limit", which: "mounted", cap }` permits one smaller retry (`mounted <= 32`); other refusals never drop log.
- `llp/1012-local-first-v1.spec.md` resume contract: `413 E_OFFLINE_RESUME { reason: "limit", which: "mounted", cap }` and “only a structured mounted-count limit can trigger one smaller retry”.
- `snapback2/packages/snapback2/tests/offline-store.test.ts` “E_OFFLINE_RESUME adjusts only structured mounted limits and never drops the log” injects `cap: 0`.

**Scope:** client resume retry predicate vs owner 413 body. Does not disturb drain admission, watermark, outbox replay, or wire/certificate formats.

**Coherent repair:** accept `0 <= cap <= 32` (the owner’s `MAX_MOUNTED`). Keep `next.cap < request.mounted.length` so a default 32 does not no-op-retry. Extend the store test to send the owner literal `cap: 32` with `mounted.length > 32`, and assert the second request keeps `log` and slices `mounted`. Do not raise deadlines or weaken the population.

---

## Drain behavior (combined code, not textual merge)

Overlap files vs both parents (`factual-checks/source-correspondence.json`): `drain.ts`, `offline.ts`, `fake-owner.ts`, `offline-resume-tail.test.ts`, `llp/1012-local-first-v1.spec.md`. Those are the composition surface. Other drain files match the e911 original hashes in that correspondence record.

### Returned ascending page provenance; same Cursor.after; ≤50

`resumable_log_cursor` walks **returns**, not auxiliary reads. Every return must be `Origin::Page(_, Some(cursorName))`, `Order::Asc`, take `<= 50` from the matching read/merge site, and the cursor name must be identical across returns. Auxiliary scans, descending pages, take 51, mixed cursor names, fallthrough, and loop early-returns refuse (`cursor-binding` / `descending` / `page-bound`). Merge lanes that do not share one `after` Cursor become `Page(site, None)` and refuse.

`scan_cursor` requires `after` bound to a Cursor argument and `before: none`. Aliases (`position = c`) and later assigns are followed through bindings. Unit tests in `certificate/page.rs` cover “not first arg or auxiliary read”, mixed branches, loop return, and assign-from-`a`.

Owner metadata is `{ cursor }` or `{ reason: shape }` on **manifest/program ops**, not inside the certificate. `ResultPageSite` / frozen envelope fields are unchanged. Internal `Origin::Page(site, Option<cursor>)` is not serialized.

Chat `deliveries.inbox` is `after c first 50` then a one-to-one shape (`return page { *, message: ... }`). Lowering emits an empty collector plus a single unconditional push (`emitPageShape`); `origins` transports the domain `Page` origin onto that collector. `deliveries.thread` is `last 50` (descending) and must refuse. That pair is the recipe in LLP 1012 §3 and the public-browser author receipt (`op: deliveries.thread`, `shape: descending`).

**Gap, not a demonstrated defect:** `page.rs` does not unit-test the collector/`DerivedArray` inbox shape. Qualification of real compiled inbox admission is an author browser receipt plus this IR walk. Independent owner execution was not possible here.

### Same Cursor.after binding on the client

Main keyed the cursor by the first manifest argument typed `Cursor` (name order). That would pick `aAux` ahead of `after`. Composition prefers owner returned-page `drain.cursor`, then falls back to name-order / `c`.

- Drain pages and tail watch: `drainCursor` → `admitDrain` (refuses without a cursor contract).
- Watermark / resume tail filing: `cursorArg`, which returns `contract.cursor` when present.

The renamed test “the returned-page cursor drives drain and resume, ahead of an auxiliary Cursor argument or c” keeps the original `c`/early-mount/watermark/cold-resume assertions and adds `aAux` negatives. Faithful composition, not a product-semantic change beyond e911’s admission rule.

### Owner auth and current-generation checks

Query/subscribe `drain=1`: `resolve_authority` then `admit_drain` on the **current** serving generation (`writer.rs`). Unauthenticated drain is 401 (`serve.rs` maps `E_AUTH_REQUIRED` / `E_AUTH_SESSION`). Resume: protocol → `resolve_authority` → `auth_epoch` (session) → generation/schema (`E_OFFLINE_RESET`) → mounted cap → `log_page` / `resumable_log_cursor`. That matches LLP 1012 §8 “authenticate; compare authEpoch; generation/schemaHash; admit the log shape”.

Live reruns re-check `admit_drain` after re-subscribe so a successor that loses eligibility refuses the drain frame. Session was already bound on the live client.

### Persistent structured refusal and waiter termination

`DrainSubscription.refuse` bumps generation (cancels in-flight drain/tail), delivers `{ state: "refused", live: false, ...envelope }`, then `fail`s remaining waiters. `until` after failure rejects immediately. Matching `state === "refused"` waiters resolve from `deliver`. `wireRefusalEnvelope` / `copyRefusal` preserve `reason`, `op`, `shape`. React `reduceQueryState` keeps `code/reason/op/shape/which`. `refuseDrains` pushes owner `unsupported-log` onto matching mounted drains, including after reopen (`lastRefusal` is not cleared by an ordinary query).

`start()` converts `SnapbackRefusal` from `admitDrain`/`query` into `refuse`, so unsupported drain never issues pages (`drain-admission` asserts `queries === 0`).

### Bounded cap retry

See Finding 1. Unstructured `E_OFFLINE_RESUME` is not retried and does not omit `log` (the old `which === "log"` omit path and stand-in log are gone). That part of the composition is correct.

### Legacy watermark, queue, grant, coverage, IDs

`resumeRequest` still sends a persisted watermark even when drain metadata is missing (“legacy missing metadata must reconnect” applies to **fresh** drains, via `drainCursor` on other mounted drains). Owner `log_page` admits or refuses the current generation’s shape. Client does not drop coverage, queue, grant, or IDs on `unsupported-log`. `unsupportedLog` skips only settlement **tail fetch**, not `outbox.drain()`. Explicit replay remains independent; `online()` stays rejected.

### Current/future waiter termination

Covered by `failure` sticky state + generation bump. Ordinary (non-drain) query remains legal.

### Independent valid outbox replay

`client-outbox.ts` `logTail` returns undefined when `runtime.unsupportedLog(watermark.op)`. FIFO `outbox.drain()` still uses the held grant. Drain-admission test: queued intent commits, IDs/intent preserved, `lastRefusal.reason` still `unsupported-log`, subsequent `online()` still rejects, `owner.executions.length === 1` from the explicit drain not from `online()`.

### Cold initial-epoch adoption and full inbox page-chain cursor

`reauthenticate`: first epoch (`known === undefined`) is adoption, not a fence (`coverageRevision` unchanged). That is main’s persona/grant fix; drain work does not rewrite it. Chat-screens test remains.

Offline drain adopts the **persisted** watermark as resume position when pages are `connection: "offline"`, and `watchTail` from the **page-chain cursor** so the caught-up view stays the drained first page (main browser-witness fix). e911 adds `refuse`/`failure` without replacing that tail rule.

Cold drain requires held eligibility metadata (`drainCursor` on held program). Main’s cold-start test had none; composition adds the seven-line programs fixture (`offline-resume-tail.test.ts` 236–242). That is the allowed metadata-fixture addition, not a product-semantic change. Author `client-seam-2` failed `metadata-unavailable` before the fixture; `client-seam-3` passed after. Current snapshot **has** the fixture.

### Denied / partial reply shape

Frozen envelope still carries `next` for every state (`decodeDeliveryEnvelope` requires it). Query/subscription **wire shape** forbids `next` on denied/partial (`wireQuery`). `OfflineRuntime.accept` strips `next` on denied/partial for both full envelopes and `unchanged` replay of a held denied answer. Test: second ask is conditional; result is typed denied without `next`.

### Strict wire and certificate formats

- Resume request/response structs still `deny_unknown_fields`; no new resume fields.
- Delivery envelope decoder required-key set unchanged.
- Certificate `ResultPageSite` / `ReadSite` / `MergeSite` unchanged; `resumable_log_cursor` is a function over existing `result_pages` + IR.
- Additive `drain` on manifest/program **ops** (sibling of `planHash` / `certificate`), permissive `wireManifest`.
- Additive `drain=1` query param.
- Additive refusal details `reason`/`op`/`shape` (optional strings).

`serve.rs` maps `E_OFFLINE_RESUME` → 413, `E_OFFLINE_RESET` → 409, auth → 401. Matches the public-browser author receipt (`ownerStatus: 413`, `unauthStatus: 401`).

### Metadata fixture / fake-owner

Seven lines on the cold-start store commit only. `fake-owner.ts` also stamps `drain: { cursor }` on inbox so admission tests do not hit `metadata-unavailable`; `outbox-custody` copies inbox drain onto `deliveries.thread` for a second ascending log. Those are test-double updates, not owner semantics.

---

## Inherited widening0236 (out of scope)

`revision.patch` also carries successor/text-widening files vs main (`engine/index.rs`, `runner_ops.rs`, `successor.rs`, …). `source-correspondence.wideningSourceCorrespondence` marks them `sameAsOriginal: true` (e911). The known “skips maintained-target survivors” defect is **not** cleared and is **not** this drain verdict. Independent repair is elsewhere.

## Search R8 resource/Unicode

Absent from this drain composition. `NOT-DOING.md` still records the search trade as unqualified. This review cannot qualify it.

---

## Execution limits (independent)

This snapshot has **no** `.git`, **no** `snapback2/node_modules`, **no** `packages/snapback2/dist`, **no** `snapback2/target`. Prompt forbids heavyweight Cargo/full battery and owner/browser without private port/PID custody. No prepared runtime was supplied. **This reviewer executed no product tests, no owner, no browser, no package/Hermes/Clique clearance.**

Source-bound checks: combined drain/resume/admission/wire sources, `revision.patch` vs main, LLP 1012/1011 + current package guides (`offline.md`, `live-query.md`, `quarry.md` as needed), `page.rs` unit tests as source, snapshot hashes.

`factual-checks/*` are **copied author receipts** (`cwd`: `/Users/ccheever/projects/snapback-worktrees/clique-release-next/...`). They are not independent execution.

---

## Original failures — preserved, not reclassified

Policy in `factual-checks/first-failures.json`: original per-test 10s deadlines retained; no failure reclassified as a pass.

| Receipt | Command (abbrev) | Deadline | Exit | What happened |
|---|---|---|---|---|
| `core-focused-1` | `cargo test … --test receipt_goldens` | original | 101 | No such test target in `snapback2-core` (command error, ~0.79s). Not a product drain fail. |
| `core-focused-2` | `offline_goldens` + `corpus_cursors` | original | 0 | Author receipt; ~321s. Not repeated here. |
| `client-focused-1` | 14 test files, concurrency=2, timeout=10000 | 10s/test | 1 | File-level timeouts: `chat-screens`, `offline-protocol`, `outbox`, `supersession`, `twin`. **Content fail:** cold-start drain `metadata-unavailable` (before seven-line fixture). First-epoch chat-screens test itself passed (`ok 141`, 459ms). |
| `client-seam-2` | resume-tail + drain-admission, conc=1, 10s | 10s | 1 | Cold-start `metadata-unavailable` (27.9ms). Other 6 tests passed. |
| `client-seam-3` | same pair | 10s | 0 | After fixture; author receipt only. |
| `client-timeouts-2` | chat-screens, offline-protocol, outbox, supersession, twin; conc=1; 10s | 10s | 1 | `offline-protocol.test.ts` file timeout 10004ms after 12 passing tests (declaration-export did not finish). `twin.test.ts` file timeout 10003ms after corpus **passed 8959.9ms**. Summary: pass 80, fail 0, cancelled 2. |
| `wire-runtime-3` | offline-protocol **skip** `offline protocol values and types` | 10s | 0 | 9 tests / 9 pass / 2861ms. **Not** broad qualification of the skipped export test. |
| `twin-focused-3` | twin **skip** `every corpus query round-trips` | 10s | 0 | 3.39s. **Not** a whole-file pass. |
| `browser-1` | witness-web-local `--keep` | original | 1 | **All 8 original main witness steps passed.** Extra public-check fixture failed: `E_OFFLINE_ID_BLOCK` “log in, or drain a query online, before writing”. Whole runner fail retained. |
| `public-browser-2` | public-browser `--keep` | original | 0 | Author receipt: 2 members, 51 posts, head 50 + history 1, 4 ascending pages, thread `unsupported-log`/`descending`, 401/413, pending+future waiters typed refusal, denied reasks 2, ordinary offline, supported resume count 1. **Not independent.** |
| `package-build-1` / `owner-build-1` | `node build.mjs` / `cargo build -p snapback2` | original | 0 | Author receipts in another worktree. |
| `measure-1` | measure five-root-integrated | original | 1 | Failed first; `measure-2` exit 0. gzip 39971 / ceiling 66000 (author). |

**Do remaining test limits hide a concrete drain regression?**

- File-level 10s timeouts under `node --test` are the **file** treated as a test while inner tests already passed (chat-screens including first-epoch; twin corpus at 8959.9ms then file cancel). That is harness wrap, not a silent drain fail. Deadlines were not increased.
- Declaration-export (`offline protocol values and types are exported from the package index`) is a `tsc` program over `dist/*.d.ts`. Drain adds optional `DrainContract` and optional refusal strings; it does not change envelope required keys. Skip is **not** a drain proof, and it is **not** evidence of a hidden drain regression.
- Twin corpus skip: corpus itself passed in the timed-out file; remaining tests passed when corpus was skipped. The only drain-related twin edit is `drain: { reason: "not-a-log" }` on the throwing-args fixture so `needsDrainMetadata` does not refetch `/api/program` during that test.
- The one **content** drain fail (`metadata-unavailable` on cold-start) is explained by missing held eligibility and is repaired in **this** snapshot by the seven-line fixture. That is composition, not a remaining product hole in the current tree.
- Finding 1 is **not** hidden by those timeouts; it is a source mismatch the cap:0 test never exercised.

Original failures remain failures. Later selected green runs are not broad qualification. Fresh package/Hermes/full Clique clearance is later work.

---

## Hash check (after review)

See `review-evidence/hash-check.json`.

- 948 files hashed against `snapshot-before.json`; 2 directory keys skipped (`templates/chat/{expo,react}/shared`).
- Drain/product files including `revision.patch` match.
- Three `llp/current/*.md` hashes differ because `snapshot-before` recorded short relative-link files (24–30 bytes) and this checkout materializes the LLP bodies (hashes equal the corresponding `llp/1000|1001|1002` leaves). Not a review edit.
- No `snapback2/` product file changed during this review.

---

## Disposition for Root

**CHANGES_REQUIRED** for Finding 1 only. Remaining drain composition (admission provenance, Cursor.after vs auxiliary, auth/generation order, structured refusal + waiters, legacy custody, independent outbox replay, first-epoch adoption, page-chain tail, denied/partial `next` stripping, additive metadata vs frozen envelope/certificate) is source-consistent with LLP 1012/1011 and the current offline/live-query guides, with the seven-line fixture as the declared metadata addition.

Do not treat inherited widening0236 or absent search R8 as this drain verdict.
