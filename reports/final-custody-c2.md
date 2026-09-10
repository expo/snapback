# custody-c2 — D6 candidate, 2026-09-10

**Disposition: not ready to claim all D6 acceptance criteria.** Template cutover, grammar deletion, guide and supersession work are implemented. Template `snapback2 test`: **32 pass, 0 fail, 0 blocked**. Acceptance 3 has one real SDK failure: a cap successor drops a departed member's unrelated retained bodies. The failing regression is committed to neither git nor a skip list; it remains in the working tree for the owning lane.

- Base: `5877ec209e51`; branch `s2/ri-custody-c2`; worktree `/Users/ccheever/projects/snapback-s2-pay`.
- No commit, stash, branch change, main/c1 merge, publication, new checker, registry, configuration file or design document.
- RFC Status remains `Accepted`. D4/D5's r3 report is held on client bytes; D6 is uncommitted and Acceptance 3 is not satisfied. The RFC implementation record names this candidate and its unresolved check.
- No production SDK, evaluator, engine, corpus or measurement source changed. No byte allocation raised.

## Implemented claims

| Requirement | Evidence |
|---|---|
| Declaration replaces authored custody | `messages` declares `deliver to memberships[.conversationId] as deliveries with receipts`. Authored `deliveries`, `proc deliver`, import, seven calls, `purgeMessage`, authored `edit`/`expired` event kinds, log seed rows and `tombstones` line deleted. |
| Reads and public generated names | `inbox`, `thread`, `history`, `conversationView`, `receipts` compile; the compiler test checks all five generated `api.d.ts` members. Inbox drains every native event; thread selects `delivered` and resolves `.row`. |
| Joining history | A new Carol sees pre-join bodies in `history` and `conversationView`, while her inbox is empty. `conversationView` composes content history, count and preview; the existing item binding falls back to delivered `thread` under partial offline custody. |
| Native expiry and edits | `schedule expireMessage on messages at .expiresAt: delete .`; authored `editedAt: time ?` and compare-and-set edit updates `editedAt: now`. Owner-clock expiry works with all clients closed. |
| Offline bar | CLI journeys prove never-opened thread from drained inbox, sender-only predicted offline send, stable identity/no duplicate, unsend eviction after cold restart, closed-client expiry. All pass. |
| Historical removal | Metadata-only log reads deliver `removed` for unsend and expiry to both Alice and departed Bob; these reads cannot supply message point absences. Carol does not become an original recipient. Unrelated Bob history survives without a successor. |
| Old edit outside tail | Drain 106 messages without mounting thread, disconnect, edit first message, reconnect only drain, cold restart, query thread and search offline: new body and `editedAt`, one bubble, no extra transport. Pass. |
| Template successors | Add empty custody and add bootstrap custody; bootstrap happens once; raise cap/A to 60; valid retarget and removal require destructive plans and retain predecessor until approved. Pass. Lower cap 50→2 retains actual historical audience A=3 in manifest and successor report. |
| Grammar deletion | `TombstoneDecl`, parser branch/method, binder/predicate validator, AST field, synthetic AST arrays, diagnostic helper/code, test module/registration and family row removed. Raw IR `Table.tombstones` and engine `tombstone_issues` remain; binder creates removed-event metadata directly for the generated log. |
| One spelling | All `offline/deliver` refusal labels changed to `deliver`, including raw IR wire assertions, compiler delivery diagnostics and cards. Word inventory already had c1's six words; D6 removes `tombstones` and records the paid offset in NOT-DOING and LLP 1011. |
| Historical records | LLP 1012 §3 current-member authored recipe and LLP 1018.003 §3 authored tombstone syntax explicitly marked superseded by LLP 1019. |
| Size | Backend schema/access/messages/seed: **272→241 lines (−31)**. React Thread: **60 lines**; Expo Thread: **42 lines**; both unchanged and free of `@ref`. |

## Tests and exact results

Commands use real Node 24.18.0 at `/Users/ccheever/.volta/tools/image/node/24.18.0/bin`, with commands below run from `snapback2/` or the named package. `dist/` rebuilt after compiler/package changes. Compiler suite and Rust guide tests rebuild shared `dist/`; their final runs were isolated from package/owner tests.

| Command / scope | Result | Evidence file |
|---|---|---|
| `cargo build`; `cargo build -p snapback2-media`; `scripts/hermes build -p snapback2` | exit 0 | `/tmp/custody-c2-hermes-final.log` and build tool output |
| Package `node build.mjs` | exit 0; `guide: 32 cards, 90394/98304 bytes (8% headroom)` | `/tmp/custody-c2-build-final.log` |
| Hermes binary `snapback2 test` in `/tmp/custody-c2-chat`, with compiler/media paths set | JSON `verdict: pass`; 32 checks, all `verdict: pass`; `schedules: { fired: 1, late: 1, rejected: 0 }` | `/tmp/custody-c2-template-complete.log` |
| Compiler `bun src/test.ts` | `Compiler checks: 298 passed, 0 failed` | `/tmp/custody-c2-compiler-isolated.log` |
| Final `registerDeliveryChecks` run, after adding executable deletion-rewrite assertion | `Delivery compiler checks: 13 passed, 0 failed` | `/tmp/custody-c2-delivery-final.log` |
| Evaluator suite | `Delivery prediction checks: 10 passed, 0 failed`; `{"visibilityChecks":2,"passed":2,"failed":0}`; `{"cases":266,"passed":266,"serverOnly":27,"failed":0,"corruptionPath":"replay-mismatch"}` | `/tmp/custody-c2-evaluator.log` |
| Named nextest checks for delivery wire labels, generated argument/rule probes, SSE silence, and guide keyword/command definitions | `11 tests run: 11 passed, 425 skipped` | `/tmp/custody-c2-rust-verified.log` |
| Nextest harness follow-up after generated-ack probe change | `6 tests run: 6 passed, 430 skipped` | `/tmp/custody-c2-rust-harness-final.log` |
| `node --test --test-concurrency=1 tests/real-owner-chat-custody.test.ts tests/real-owner-delivery.test.ts tests/chat-screens-owner.test.ts` | `tests 11`, `suites 0`, `pass 10`, `fail 1`, `cancelled 0`, `skipped 0`, `todo 0` | `/tmp/custody-c2-package-complete.log` |
| Final historical-custody subset after strengthening to metadata-only removal reads | `tests 2`, `suites 0`, `pass 1`, `fail 1`, `cancelled 0`, `skipped 0`, `todo 0` | `/tmp/custody-c2-metadata-custody.log` |
| `./ref-check --verbose` | `ok — 439 LLP docs, 8013 refs in 19160 files, 0 errors, 0 unchecked` | `/tmp/custody-c2-refs-final.log` |
| `git diff --check` | exit 0 | final tool output |
| `node scripts/caps.mjs` | 1 inherited violation: unchanged Snapback 1 `crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs`, 1504 lines; `oversize files: 205 of 204 allowed by baseline` | `/tmp/custody-c2-caps-final.log` |

Final affected guide bytes: `deliver.md` **5539**, `expiry.md` **2895**, `schedule.md` **5928**, `retain.md` **351**, `offline.md` **7598**; each ≤8192. Largest changed source is `test_invalidation.rs`, **1467** lines. Existing LLP 1012 is a >1500-line corpus document, not a new source-cap violation; it was already oversized before this lane. No source is split or exempted to evade the cap.

The lane-specific instruction to run targeted tests, not the whole suite, overrides the common brief's `scripts/test.sh` request. No whole suite or measurement claim is made. `ps` is denied in this sandbox; the final named runs have no owner-stop sandbox failure. React act warnings appear in the screen test output; the screen test passes.

## Before / after outputs

Before snapshot captured before editing (`/tmp/custody-c2-before-shape.log`):

```text
tombstones []
logColumns: [id, recipient, conversationId, messageId, kind, at]
messages.deliver: absent
messages.history: absent
messages.receipts: absent
messages.purgeMessage: present
```

The new compiler regressions against that base (`/tmp/custody-c2-before-regressions.log`):

```text
FAIL authored tombstones is an unknown table declaration Error: []
FAIL chat derives custody and exposes history and receipts without authored fan-out Error: messages has no deliver declaration
```

After (`/tmp/custody-c2-after-shape.log`):

```text
E_QUARRY_UNKNOWN at snapback/schema.q:3:3: unknown table declaration tombstones
deliver: {target: memberships, prefix: [conversationId], principal: principal, log: deliveries, receipts: true}
logColumns: [id, recipient, row, incarnation, conversationId, kind, audience, seq, at]
generated tombstone: messages[.row] when .kind = 'removed'
messages.history and messages.receipts: present
messages.purgeMessage: absent
messages._timerDelete_expireMessage: present
```

The deletion diagnostic retains the existing unknown-name family/page; the final compiler regression applies its public comment rewrite at the refused line and recompiles successfully.

Base authored-log owner regressions were also run using the saved template under `/tmp/custody-c2-before`. Only its now-deleted `tombstones` syntax line was removed so the current compiler could load that older backend; its authored fan-out, reads and writes remained unchanged. Original schema is saved at `/tmp/custody-c2-before-schema.q`. These are base-backend reproductions against the current compiler, not claims to have checked out or rebuilt a base binary after editing.

```text
Before departed-recipient unsend: tests 1, pass 0, fail 1; actual removed events 0, expected 1.
After departed-recipient unsend: PASS chat removal is delivered to an original recipient who left before unsend.
Before old-edit metadata: tests 1, pass 0, fail 1; typeof editedAt actual 'undefined', expected 'number'.
After old-edit metadata: PASS chat old edit outside the live tail reaches cold thread and search without a duplicate bubble.
Before CLI (non-Hermes): 32 checks, 30 pass, 2 blocked (effects unavailable).
After CLI (Hermes): 32 checks, 32 pass, 0 blocked.
```

Owner logs: `/tmp/custody-c2-before-recipient.log`, `/tmp/custody-c2-before-old-edit.log`, `/tmp/custody-c2-package-complete.log`. The base CLI's effects block is a build-capability difference, not counted as a product defect fixed by D6.

## Deviations, scope extensions and unresolved question

1. **Acceptance 3 remains red; SDK reset contract conflicts with it.** Exact failure: `AssertionError [ERR_ASSERTION]: other departed history remains held`, actual false, expected true, in `real-owner-chat-custody.test.ts`. Both Alice and Bob receive native `removed` events; Carol's live history, cap lowering, actual A, destructive retarget plan, schedule and cold body removal assertions pass first. Unrelated `Welcome` is lost only when the cap successor occurs. `OfflineRuntime.resetCoverage` (`src/offline.ts`) commits `resetCoverage: true`; `RangeStore.applyCoverage` (`src/store/range-store.ts`) clears `state.rows` and all answers. LLP 1012 §8 explicitly specifies this all-coverage reset, while LLP 1019 says no change to twin swap rules. Retention under ordinary revocation passes. Requested owner routing: hand the regression to custody-c1, or explicitly extend this lane to change successor retention. No answer received while preparing this report; no incompatible retention rule was silently introduced.
2. **§5's proposed fallback does not cover an empty log.** Existing `withHistory` activates on partial custody; a new recipient's empty log is complete. `conversationView` now uses content history online, preserving the existing delivered-thread partial fallback and untouched Thread screens. RFC §5 and `guide/deliver` record the code fact and the replacement. No new SDK fallback mode or audience backfill.
3. **Acceptance 3's old-cap sentence was stale.** The implemented/revised §3 rule is `max(current target cap, largest stored delivered audience)`. The test sends to three principals and lowers 50→2, therefore asserts A=3, not 50. RFC acceptance wording is corrected to match §3 and code.
4. **The baseline has 32 checks, not thirty.** Kept the equivalent complete set with revised native-log assertions; no check deleted or bypassed to reach green.
5. **CLI proof-harness changes beyond the explicitly named D6 files were necessary for Acceptance 1.** `test_policy.rs` derives a row bound for native seed logs/receipts rather than blocking on absent authored log seeds. `test_invalidation.rs` treats generated schedule targets like existing system continuations and obtains real owner-minted event IDs for the generated acknowledgement, preserving its physical receipt invalidation proof. `test_authority_ir.rs` changes receipt policy consistently with content while keeping copied rule-column storage stable. `test_sse.rs` uses the existing multiplex stream and explicit session close to release each probe's worker; `test_unit.rs` adapts the stream-close regression. Runtime limits and production transport did not change.
6. **Existing test consumers beyond the template were updated.** `owner-harness.ts` selects the generated log index when using the derived template; `chat-screens-owner.test.ts` identifies the user send by operation/state and counts user writes separately from acknowledgements. Temporary successor fixtures remove application journeys when intentionally removing their read programs. The full template journeys are exercised separately, all green.
7. **Authored edit timestamp needs a pre-read.** The prior assigned update followed by a null check reread its own post-write row for prediction; adding `now` to that row made replay compare against a prediction-time timestamp. The edit now reads the message first, then runs the same conditional update with `editedAt: now`. Existing online/offline CAS journeys and screen conflict behavior pass.

## Changed files

All paths below are repository-relative; brace groups enumerate the full changed set. The only new files are this requested report and the owner regression test.

- `llp/{1011-quarry-ergonomics.rfc.md,1012-local-first-v1.spec.md,1018.003-truthful-and-composed-client.decision.md,1019-derived-delivery-custody.rfc.md}`; `rules/NOT-DOING.md`.
- `snapback2/crates/snapback2/src/{check.rs,protocol.rs,test_authority_ir.rs,test_invalidation.rs,test_policy.rs,test_sse.rs,test_unit.rs}`.
- `snapback2/packages/compiler/src/quarry/{ast.ts,bound-schema.ts,catalog.ts,deliver.ts,diagnostics.ts,index.ts,parser.ts}`.
- `snapback2/packages/compiler/src/{bound-schema-checks.ts,delivery-checks.ts,diagnostics.ts,ir.ts,quarry-chat-composition-checks.ts,quarry-fanout-checks.ts,quarry-language-checks.ts,quarry-schedule-checks.ts,test-final-gates.ts,test.ts}`; deleted `src/tombstone-checks.ts`.
- `snapback2/packages/compiler/fixtures/quarry-chat/snapback/schema.q` (only the deleted syntax line; this historical compiler fixture keeps its authored log).
- `snapback2/packages/snapback2/guide/{deliver.md,expiry.md,families.source.json,offline.md,retain.md,schedule.md}`.
- `snapback2/packages/snapback2/templates/chat/snapback/{access.q,messages.q,schema.q,seed.ts,tests/chat.test.ts}`.
- `snapback2/packages/snapback2/templates/chat/react/src/Inbox.tsx`; `templates/chat/expo/src/{Witness.tsx,screens/Inbox.tsx}` under the same package.
- `snapback2/packages/snapback2/tests/{owner-harness.ts,chat-screens-owner.test.ts,real-owner-chat-custody.test.ts}`.

No worktree cleanup deleted another session's data. The CLI and owner fixtures are temporary and each harness closes only the owner it started. Reports/evidence remain available under `/tmp/custody-c2-*`.


## Fix round r1

Base `e7b5822bdeafdc51ab56d5e964cdf1b52ff6867e`; no merge, commit, stash, branch operation, publication, Status change, or allocation increase. **Acceptance 3 is fixed. D1–D5 are landed; D6 remains unqualified on client bytes.** Full file inventory, before output, scope and all run artifacts: `REPORT-custody-c2.md` at this worktree root.

| Requested item | Disposition / evidence |
|---|---|
| 1. Successor reset | Fixed: keep native delivered-history log anchors and non-removed content; clear answers/facts/slots. The original `other departed history remains held` assertion is unchanged and passes. Added all-carrier reset + unanchored/removed exclusions + cold reopen; added metadata-only viewed-photo removal/retention with both successor variants. LLP 1012 §8 records the dated ruling. |
| 2. Guide and material review | Fixed: schedule/expiry/offline/testing cards; direct `expireMessage` deletion and native `removed`; live joiner history/count/preview; LLP 1012 and 1018.003 stale shapes superseded/corrected. Generated policy tables block when actual probes are zero; empty-audience regression passes. |
| 3. Cutover suite | Fixed all old operation/index/kind/count/composite/acknowledgement expectations. Real `deliver` label corrections cover writer, replay, job and schedule serializers. Compiler typecheck errors fixed without changing emitted evaluator behavior. The cap fixture waits for the asynchronous watcher publication while retaining its atomicity assertion. |
| 4. Loop | Fixed: same-stream ordered SSE boundary replaces each 250ms silence wait; the new regression rejects an earlier unexpected delivery. All 32 checks remain. Consumer smoke **31.03s →20.83s**, chat `test` **16.9s →5.60s**, no budget raised. Final Hermes **32/32**, 12.82s. |
| 5. Records | This section and LLP 1019's one-line r1 record appended; RFC Status unchanged. No claim that D6 has landed or that its bytes are authorized. |

Final passing evidence:

- Named package files (including the three additional coverage requests): **168 tests, 168 pass, 0 fail**, fleet snapshot compiled with Cargo 1.93.1 and real Node 24.18.0.
- Local full-script package stage: **1140 tests, 1140 pass, 0 fail**. A later fleet full package stage had an intermittent `E_OWNER_STOP_TIMEOUT` and its cascade (**1131 pass, 9 fail**); the unchanged complete owner-session file then passes **10/10** in isolation. Logs preserve the failing attempt.
- Final full Rust workspace: **1104 tests, 1103 pass, 1 fail, 4 skipped**; the one remaining schedule label was fixed, then the entire delivery test file plus the root-video asset witness passed **60/60**. Earlier owner-stop artifacts pass on the fleet. No unresolved Rust content failure.
- Compiler typecheck **exit 0**; compiler **298 passed, 0 failed**; evaluator **266 passed, 0 failed, 27 server-only**, delivery prediction **10/10**, visibility **2/2**. Final language run uses matching Bun 1.3.12; the earlier Bun 1.4.0 run is not qualification evidence.
- Package build **32 guide cards, 90822/98304 bytes**. Complete runtime **86538 gzip ≤90000**. Ref audit **439 LLP docs, 8014 refs, 0 errors, 0 unchecked**; diff whitespace check passes.

**Byte hold:** client **140861**, React **150597**, Expo **154200** gzip: +168 each over custody-c1's measured landing, and **161 /97 /100** over its one-time maxima. The generic scorer also still refuses against its older baseline. No baseline was accepted or increased. The first npm measurement encountered the sandbox's cache-write denial; the completed consumer run uses a temporary writable npm cache. Final logs: `/tmp/custody-c2-measure-rerun.log`, `/tmp/custody-c2-twin-complete.log`.

Every changed source is ≤1500 lines (largest 1497). LLP 1012 was already 1855 and is now 1861; the scoped amendment does not delete unrelated corpus to satisfy a literal all-file limit. Root caps retains its unchanged Snapback 1 1504-line violation. Additional scope is fully enumerated in the root report: SDK reset path (authorized), CLI proof helpers, wire/job/timer labels, compiler/evaluator type checks, test expectations and watcher synchronization, guide/corpus amendments and measurement records. No new check, script, registry, configuration or design document.

The canonical program report was read outside writable roots; this local mirror preserves that report and appends the requested section for the orchestrator to collect.


## Fix round r2

**FIXED.** Client / React / Expo closures are **140,680 / 150,416 / 154,019 gzip bytes**, **−181 each** from r1. This pays the requested 168 bytes plus 13 bytes; headroom below the custody maxima is **20 / 84 / 81 bytes**. **D1–D6 are all landed or landing:** D1–D5 landed; D6 is ready for the orchestrator's commit and landing. This supersedes r1's byte hold; no commit or landing is claimed for this worktree.

Base `dfac9e92d14d3b146b1bb2bcb1b8de1e847762fe`; no merge, commit, stash, branch change, publication, budget/scorer change, or RFC Status change. Only the named/affected checks ran; no whole suite.

| Measured object | r1 / before | r2 / after | Delta | Ceiling / maximum |
|---|---:|---:|---:|---:|
| client closure | 140,861 | 140,680 | −181 | 140,700 |
| React closure | 150,597 | 150,416 | −181 | 150,500 |
| Expo closure | 154,200 | 154,019 | −181 | 154,100 |
| complete runtime | 86,538 | 86,455 | −83 | 90,000 |
| shared client-runtime leaf, minified | 301,578 | 300,292 | −1,286 | unchanged |
| shared client-runtime leaf, gzip | 96,022 | 95,841 | −181 | included above |

### Construction and input evidence

- `src/offline.ts` sends the schema once; the duplicate runtime retention map and `StoreSwap.retention` are deleted. One schema predicate in `range-store.ts` governs both ordinary retention and reset custody. Reset uses the predecessor's held schema when no explicit schema is supplied.
- Reset uses one null-prototype dictionary for log anchors and body dispositions; `removed` wins regardless of traversal order. It removes unretained rows in place and still clears answers, sequence guards, facts and slots. Reauthentication/reset share fact clearing; answer-key/program resolution and normalized fact-slot counting stop repeating work.
- `dropOverlay` centralizes the identical four-field cleanup used by retirement, explicit overlay removal and outbox removal. Receipt admission is unchanged. Provisional log recognition is lazy; ordinary rows need no schema scan. The reset anchor walk cannot consume retirement's incoming-page scan: reset uses predecessor custody before new pages, while retirement considers accepted arrivals after the swap.
- Follower inbox insert/remove/take share their existing connection check, durable action and refresh. Validation prose is shorter; refusal classes/codes, checks, factory repair wording and actionable rewrites remain. No diagnostic or implementation bytes moved behind another entry.

Esbuild metafile **bytesInOutput** for the shared client-runtime leaf (minified contribution, not an additive gzip attribution):

| Input | Before | After | Delta |
|---|---:|---:|---:|
| `src/assets.ts` | 6,682 | 6,659 | -23 |
| `src/client-assets.ts` | 2,301 | 2,298 | -3 |
| `src/delivery-acknowledgements.ts` | 2,193 | 2,096 | -97 |
| `src/offline.ts` | 23,311 | 22,771 | -540 |
| `src/store/overlay-retirement.ts` | 6,175 | 5,974 | -201 |
| `src/store/range-store.ts` | 26,904 | 26,483 | -421 |

The asset sources are unchanged; their −26 attributed bytes are esbuild binding-name changes. The remaining one-byte difference is bundle glue. `client.mjs`, `image-runtime.mjs`, `internal.mjs`, `react.mjs`, `react-core.mjs`, and `expo.mjs` have identical minified byte counts and input contributions before/after. Every closure still includes its original dependency graph; nothing was transferred to another entry.

Evidence: `/tmp/custody-c2-r2-{before,after}/` holds each esbuild metafile and packaged closure inventory; `/tmp/custody-c2-r2-input-diff.json` holds the full diff. Instrumentation was a temporary stdin copy of unchanged `build.mjs`, adding only metafile capture. The ordinary build and canonical measurement confirm the same artifacts. Toolchain: **Node 24.18.0 / esbuild 0.25.9 / gzip level 9**.

### Stub audit

| Item | Tree finding / disposition |
|---|---|
| Empty generated-table policy coverage | **Already paid in r1:** `test_policy.rs` requires actual probes and returns blocked for no stored rows; the empty-audience regression remains. No change in r2. |
| Dead `fn conversation(Log\|Preview)` strip | **Already removed in r1** from `real-owner-chat-custody.test.ts`. No change in r2. |
| `expiry.md` composite sentence | **Already corrected in r1** to live content history/count/preview for joiners. R2 adds the precise screen/fallback sentence. |
| LLP 1018.003 later index | **Already corrected in r1:** §5 names generated `byRecipientGroup: recipient, conversationId, kind, seq, id`. No change in r2. |
| LLP 1012 §5 rule 3 | **Already marked superseded in r1**, naming generated `removed` tombstones. No change in r2. |
| Acceptance 2 on the screen's query | **Added in r2:** `never-opened Thread binding renders a cold drained chat and predicts one offline send` bundles the actual shared `conversationItems` imported by both Thread screens. Only the inbox is drained online; after cold offline restart it observes `conversationView` through `withHistory` → `threadItems`, renders the held message and exactly one predicted send, and asserts no query/transport was used to prime or serve the screen. Both participants are isolated from existing screen fixtures. The original template journey is retained. |

### Verification and before/after controls

| Command / scope | Exact result | Log |
|---|---|---|
| `cargo build`; media build; `scripts/hermes build -p snapback2` | exit 0 | `/tmp/custody-c2-r2-{cargo-build,media-build,hermes-build-final}.log` |
| `node build.mjs` (ordinary build and canonical measure build) | exit 0; **32 cards, 90996/98304 bytes** | `/tmp/custody-c2-r2-build-final.log`, `/tmp/custody-c2-r2-measure-final.log` |
| `node build.mjs --measure-twin` | exit 0; **86455 gzip**, **262856 minified** | `/tmp/custody-c2-r2-twin.log` |
| All six requested package files, serial | **tests 89, pass 87, fail 2, cancelled 0, skipped 0, todo 0**. Both failures were owner readiness timeouts before the successor test bodies. | `/tmp/custody-c2-r2-targeted-final.log` |
| Those two successor cases in isolation, final source | **tests 2, pass 2, fail 0, cancelled 0, skipped 0, todo 0** | `/tmp/custody-c2-r2-successors-final.log` |
| All three real-owner/screen files on the warm M1 Max snapshot, final source | **tests 15, pass 15, fail 0, cancelled 0, skipped 0, todo 0** | `/tmp/custody-c2-r2-m1-owners-qualified.log` |
| Affected store, history, overlay, inbox and fact-custody files | **tests 312, pass 312, fail 0, cancelled 0, skipped 0, todo 0** | `/tmp/custody-c2-r2-stores-final.log` |
| Final reset-store file after null-prototype hardening | **tests 101, pass 101, fail 0, cancelled 0, skipped 0, todo 0** | `/tmp/custody-c2-r2-reset-final.log` |
| Compiler `bun run check`; `bun src/test.ts` | typecheck exit 0; **Compiler checks: 298 passed, 0 failed** | `/tmp/custody-c2-r2-compiler-{check-final,final}.log` |
| Template `target/hermes/debug/snapback2 test --json`, `SNAPBACK2_MEDIA=target/debug/snapback2-media` | **32 checks, 32 pass, 0 fail, 0 blocked**; schedules **fired 1, late 1, rejected 0** | `/tmp/custody-c2-r2-hermes-final.json` |
| Original runtime sources at the base, with the schema-only retention probes | **tests 2, pass 0, fail 2**: `retained` was **undefined**, expected **true**. Both probes pass in the 312-test run. | `/tmp/custody-c2-r2-before-control.log` |

The before control substitutes the four original runtime modules during esbuild; it does not checkout, reset or change branches. The new screen check fills a coverage gap, rather than claiming its existing binding was broken. The r1 reset and historical-custody assertions remain intact. Existing low-level retention fixtures now supply schema metadata; no assertion or tolerance was removed. The paginated fixture supplies its real index components along with retention.

`npm_config_cache=/tmp/custody-c2-r2-npm-cache node scripts/measure.mjs --check` confirms all four byte values above. **Every functional and timing step passes in the final run**: consumer smoke **19.49s ≤30s**, chat test **6.296744959000003s**, incremental build **4.76s ≤15s**, check **0.807s ≤1s**, doctor **0.2 /0.052s ≤0.5s**, init→dev **1.645s ≤10s**. **The command exits 1 only for the four unchanged historical byte comparisons.** The custody maxima and runtime ceiling pass; no accepted baseline or synthetic passing record was created. Log: `/tmp/custody-c2-r2-measure-final.log`; original attempts remain in `metrics/{loop,twin}.jsonl`.

Discarded attempts remain visible: an overly broad callback type stopped the declaration build, and an unsuccessful before-control bundle left checker declarations missing (initial compiler run **257 passed, 41 failed**); both were repaired before final verification. Early local runs also overlapped package replacement. The new screen fixture initially shared a seeded participant and changed that participant's inbox count; both accounts are now isolated, with the original count assertion unchanged. A broad fleet run was **87/89** because of that fixture plus the snapshot's lack of Git metadata for the literal-NUL test; the latter passes in the full local named run. The first Hermes invocation used the default binary (**30 pass, 2 blocked**), then the Hermes invocation needed its media helper configured; the correct final engine/helper run is **32/32**. The initial measurement was **40.24s** with a **16.44s** first cache installation and a **0.697s** first doctor boot; the next was **31.75s**, including a **9.26s** Vite bundle. The final unchanged-source warm run above clears both timing issues. These attempts are not claimed as passing invocations.

### Scope, caps and disposition

Changed implementation: `src/{offline.ts,delivery-acknowledgements.ts,store/range-store.ts,store/overlay-retirement.ts}`. The helper reuse touches the acknowledgement file only for outbox-removal cleanup; the inbox-method consolidation stays in the named offline module. Additional affected tests: `tests/{offline-store,client-history,overlay-retirement,chat-screens-owner}.test.ts`. Documentation/evidence: `guide/expiry.md`, LLP 1019's record, both custody-c2 reports, and existing measurement logs. All paths in this paragraph are under `snapback2/packages/snapback2/` unless explicitly named otherwise. No compiler, Rust, template, other LLP, scorer, configuration, registry or check source changed.

All changed files are **≤1500 lines**; largest is `offline-store.test.ts`, **1483**. Root caps retains only the unchanged Snapback 1 1504-line violation (**205/204** baseline). The existing oversized LLP 1012 is untouched in r2. Reference audit and whitespace validation pass; the final audit log is `/tmp/custody-c2-r2-refs-final.log`.

**Open semantic/allocation questions: none.** The generic scorer still reflects historical accepted baselines, as it did for the author's custody allocation; its policy remains unchanged. This writable `reports/final-custody-c2.md` mirror is the program report for the orchestrator to collect. Local writes stay in the allowed roots; fleet verification reuses r1's isolated `/tmp/s2-custody-c2-r1.dc7UEr` snapshot. No other checkout or branch was changed. No commit and no whole-suite run.

## Fix round r3


Base: `cc64186513` (r2 + orchestrator test fix + pre-round main merge). No commit, stash, branch change, or main merge. RFC Status unchanged. **Items 1–6 fixed; no byte refusal.** Item 7 residuals are listed once at the end. Item 8 records are written here and in `reports/final-custody-c2.md` and LLP 1019.

## Allocation and construction

| Measure | Before | Final | Delta | Maximum | Headroom |
|---|---:|---:|---:|---:|---:|
| Client packaged closure, gzip | 140,680 | **140,696** | +16 | 140,700 | 4 |
| React packaged closure, gzip | 150,416 | **150,432** | +16 | 150,500 | 68 |
| Expo packaged closure, gzip | 154,019 | **154,035** | +16 | 154,100 | 65 |
| Complete runtime, gzip | 86,455 | **86,538** | +83 | 90,000 | 3,462 |
| Shared client-runtime leaf, minified | 300,292 | 299,660 | −632 | — | — |
| Shared client-runtime leaf, gzip | 95,841 | 95,857 | +16 | Included above | — |

Toolchain: Node **24.18.0**, esbuild **0.25.9**, Node gzip level **9**. Esbuild metafile contributions below are minified bytes, not additive gzip attribution:

| Shared client-runtime input | Before | Final | Delta |
|---|---:|---:|---:|
| `src/offline.ts` | 22,771 | 22,068 | −703 |
| `src/store/canonical.ts` | 539 | 605 | +66 |
| `src/store/overlay-retirement.ts` | 5,974 | 5,979 | +5 |
| `src/store/range-store.ts` | 26,483 | 26,483 | 0 |

The overlay-retirement source is unchanged; its five-byte difference is esbuild binding allocation. Every other packaged `.mjs` output has identical byte counts and input contributions. Existing entry graphs are unchanged. Evidence: `/tmp/custody-c2-r3-{before,after}/`, `/tmp/custody-c2-r3-input-diff.json`. Metafiles came from a temporary stdin copy of `build.mjs` adding only capture; no build/check/config source changed. The ordinary build and canonical measurement produce the same closures.

Payment by construction: reuse program-map/fact/reset/commit construction; remove only undefined fields from fresh result records with one shared `defined` helper (nulls and nominal values remain); fold delivery-time collection into the existing answer walk; use one canonical tuple per range key; share close/wipe release, row deletion, and inbox transaction adapters; compute query clock once; remove redundant promise wrappers while preserving the original `answer()`/`coverage()` settling boundaries. Receipt/bounds validation, outbox notification, authority checks, reset sequencing, and corruption checks remain. No diagnostic prose was shortened and no implementation moved to another entry.

## Disposition by requested item

1. **Codex B1 FIXED.** `range-store.ts` validates retained content only when an incoming held program's schema differs from its predecessor, using the exact `prepareWireRow` used by cold preparation. The incoming program is first known at the `swap.programs` installation, before `state.programs` changes; `storedProgram(state, swap)` may still select the predecessor named by old facts, so validation explicitly uses the incoming program. Reset and adoption share the existing row-removal walk. Invalid content images and their sequence entries leave; anchor events and fitting siblings survive. Only expected row-validation failures are caught. Same-schema ordinary delivery is unvalidated here, and later corrupt cold preparation still throws. After successful durable replacement, one structured line per affected table reports e.g. `{"snapback2":"adopt","table":"messages","removed":1}`. The reset anchor walk now recognizes prepared RowImages as well as wire records: before this correction, a warm prepared anchor could be lost even without a schema change.

   Tests: 36 carrier/control cases (three carriers × Optional/required successor × reset-together/reset-before/no-reset × wire/prepared), plus the real-owner departed Bob extension. Bob receives null and fitting-7 messages, departs, the owner fills and installs required `version: int`, Bob reconnects through a metadata-only delivery query and cold-restarts offline; history keeps the null message's anchor with absent body and the fitting sibling, and an unrelated query does not claim current-generation completeness. `real-owner-chat-custody.test.ts` is 333 lines. LLP 1012 §8 and `guide/deliver.md` record the ruling; the reset `@ref` uses `LLP 1012#coverage-reset-amendment`.

2. **Codex B2 FIXED.** `SseProbe` retains the multiplexed frame through a checked payload accessor: exact child identity, explicit `terminal: false`, and a query-result state are required before payload acceptance. The authority proof calls the shared row-free, exact-sequence denial check. A terminal or refused barrier also fails. The unit negative control executes the authority proof's entire consumed-event sequence: denial then ordered barrier. It rejects terminal probe denial followed by a valid barrier, terminal barrier, refused barrier, and wrong probe identity; the ordinary nonterminal denial passes. Rust only; zero client bytes for this item.

3. **Codex B3 APPLIED AS RULED.** LLP 1012 is **1,861 lines at this worktree base and final**, net zero; the brief's 1,853 is not this HEAD's count. The replacement reset paragraph records adoption semantics, and the former blank line becomes the exact anchor heading. No spec split. All changed source files are ≤1,500 lines (largest Rust `test_authority.rs`: 1,485; store: 1,478).

4. **Without-transport assertion FIXED.** The offline fetch records and fails every attempted request before examining payload shape. Offline observe and predict assert zero attempts. Online priming inspects both top-level `op` and every `mounted[].op`. The exercised subject remains the actual shared Thread binding, not a mounted Thread component; that residual is explicit below.

5. **Grok material 3 FIXED.** `resetClock` and `resetCoverage` share a schema-first commit: `{ schema: this.schema, ...extra, resetCoverage: true, facts, superseded }`. Explicit `extra.schema` wins. Reset state/trust updates remain in the callers after awaiting commit. Direct regression checks both schema presence and override precedence. The final closures above include this change.

6. **Minor items FIXED.** LLP 1019's non-goal now names both the ruled custody reset extension and incompatible-image adoption rule while retaining the fence/retain meanings. Reset `@ref` names LLP 1012's exact amendment anchor. Seed comment says `row-keyed edit/unsend mutations`. Receipts guide uses `require isMember(msg.conversationId, viewer)` like the template. `guide/deliver.md` is **5,982 bytes ≤8,192**; no budget changed.

## Before / after evidence

| Reproduction | Base output | Final evidence |
|---|---|---|
| All-carrier adoption controls | **tests 37, pass 12, fail 25**; required successor throws `E_INPUT: messages.version must be an i53 integer`; prepared reset variants also lose anchors/fitting rows | **37/37 pass** within named run; optional controls keep null, required drops null only, anchors/fitting remain; later corrupt delivery still rejects `expected safe integer` |
| Terminal denial then valid barrier | **0 passed; 1 failed**: result accepted `true`, expected `false` | unit module **9 passed; 0 failed**, including five-case authority sequence |
| Clock reset schema | **tests 1, pass 0, fail 1**: actual `undefined`, expected runtime schema | new schema/override test passes within named run |
| Never-opened screen transport observation | Base only collected top-level `body.op`; mounted resume attempts were invisible | all attempted offline fetches fail and are counted; zero attempts after observe/predict |
| Departed owner's null image | Existing reviewed cold-store failure; new end-to-end fixture added | required successor + metadata-only reconnect + offline history/unrelated read passes; adoption logs one removed messages row |

Before logs: `/tmp/custody-c2-r3-b1-before.log`, `/tmp/custody-c2-r3-b2-before.log`, `/tmp/custody-c2-r3-clock-before.log`. Base controls temporarily substituted original source from HEAD without checkout/reset/branch mutation, and restored final source before final verification. The four older client/asset failures listed below also reproduce with all three changed TS runtime modules restored to HEAD: **tests 4, pass 0, fail 4**, `/tmp/custody-c2-r3-stale-base-tests.log`.

## Verification

| Scope / command | Exact result | Evidence |
|---|---|---|
| Initial `cargo build`, media build; final `scripts/hermes build -p snapback2` | exit 0 | `/tmp/custody-c2-r3-{cargo-build,media-build,hermes-build}.log` |
| Final ordinary `node build.mjs` | exit 0; **32 cards, 91351/98304 bytes** | `/tmp/custody-c2-r3-restored-build.log` and canonical measure |
| Six named package files, final fleet run | **tests 407, pass 407, fail 0, cancelled 0, skipped 0, todo 0** | `/tmp/custody-c2-r3-remote-targeted-final.log` |
| `scripts/test.sh`, local package portion | **tests 1179, pass 1179, fail 0, cancelled 0, skipped 0, todo 0** | `/tmp/custody-c2-r3-full-final.log` |
| `scripts/test.sh`, local Rust nextest | **1105 tests run: 1103 passed, 2 failed, 4 skipped**; both owner-stop sandbox artifacts below | same |
| Final fleet Rust workspace nextest | **1105 tests run: 1105 passed, 4 skipped** | `/tmp/custody-c2-r3-remote-rust.log` |
| Rust `test::unit_tests`; `test::test_authority` | **9 passed; 0 failed**; **13 passed; 0 failed** | `/tmp/custody-c2-r3-rust-{unit-real,authority}.log` |
| Evaluator | **cases 266, passed 266, serverOnly 27, failed 0**; prediction **10 passed, 0 failed** | `/tmp/custody-c2-r3-full-local.log` |
| Compiler `bun run check`; `bun src/test.ts`, local Bun 1.3.12 | typecheck exit 0; **Compiler checks: 298 passed, 0 failed** | `/tmp/custody-c2-r3-compiler-{check-final,final}.log` |
| Hermes chat template `test --json` | **32 checks, 32 pass, 0 fail, 0 blocked**; schedules **fired 1, late 1, rejected 0** | `/tmp/custody-c2-r3-hermes-final.json` |
| Full package, every `tests/*.test.ts`, final serial fleet run | **tests 1319, pass 1314, fail 5, cancelled 0, skipped 0, todo 0**; four base-proven older failures + snapshot Git metadata artifact | `/tmp/custody-c2-r3-remote-all-final.log` |
| `node scripts/measure.mjs --check` | all functional/timing steps pass; exit 1 only four historical byte baselines; all custody allocations pass | `/tmp/custody-c2-r3-measure-order-final.log` |

Canonical measurement: warm build **0.29s ≤300s**; incremental **2.95s ≤15s**; consumer smoke **13.06s ≤30s**; project check **0.486s ≤1s**; doctor **0.122 /0.047s ≤0.5s**; init→dev **0.841s ≤10s**. Historical comparator still uses **136547 /146166 /149836 /84580** plus 1%; no accepted baseline or synthetic passing record added. All original attempts remain in existing `metrics/{loop,twin}.jsonl`.

The first complete `scripts/test.sh` invocation (`/tmp/custody-c2-r3-full-local.log`) exits 1 only because the sandbox denies `ps`: `stop_during_generation_update_is_bounded_and_cannot_recreate_owner_state` and `owner_cases::wire_lifecycle::chat_owner_wire_sse_channels_and_successors` report `E_OWNER_STOP_TIMEOUT`. Both pass in the final fleet workspace run. The first full local run and fleet run pass doctests. After restoring the two read promise wrappers, the repeated blocking run again passes all 1,179 package tests and has the same two Rust sandbox failures; it was interrupted (exit 130) after repeatedly stalling in unchanged Rust doctests. One zero-test doctest target had completed; the repeat is not claimed a completed full invocation. Rust/doc sources were unchanged by the wrapper restoration. Final compiler/type checks and canonical measurement were run separately afterward. Root caps retains the inherited Snapback 1 `crates/snapback-tools/src/bin/snapback-agent-safe-paired.rs` 1,504-line violation (**205/204** baseline); no changed source violates the cap. Reference audit and `git diff --check` pass.

Additional attempts are not claimed green: first local named run **407 tests, 405 pass, 2 fail** (owner readiness timeouts before bodies); the final six-file fleet run above clears them. The legacy package-directory entry point (`tests/index.js`) runs only **713 tests: 707 pass, 5 fail, 1 skipped**, so it was followed by the explicit all-files glob. The first all-files run overlapped compiler package regression tests that delete/rebuild `dist/`: **1319 tests, 1301 pass, 18 fail** included missing compiler/declarations, timing-sensitive owner/recovery failures, the four baseline failures, and missing Git metadata. The stable-dist serial run was **1319 tests, 1313 pass, 6 fail**: four base failures, missing Git metadata, and an early reset-refusal assertion. That reset assertion passed ten consecutive checks on base, failed intermittently after wrapper removal, and passes ten consecutive checks after restoring the original `answer()`/`coverage()` promise boundaries (`/tmp/custody-c2-r3-reset-{base,order-final}.log`). That finding is fixed in the final source; full verification was repeated. An intermediate mechanical edit also put `async` on two interface signatures; the declaration build rejected it, and the signatures were corrected before final testing. The extra remote compiler run under Bun **1.4.0** is **296 passed, 2 failed** on null-prototype-vs-plain-object deep equality; unchanged compiler/evaluator source, local Bun **1.3.12** required suite is **298/298**. No compiler source was changed to conceal that toolchain difference.

## Files, deviations, scope

Runtime: `snapback2/packages/snapback2/src/{offline.ts,store/range-store.ts,store/canonical.ts}`. The small existing canonical helper module is the only runtime scope extension beyond the two named sites; it pays shared record construction. Tests: `snapback2/packages/snapback2/tests/{store-review-custody,real-owner-chat-custody,chat-screens-owner}.test.ts`. Rust: `snapback2/crates/snapback2/src/{test_sse,test_authority,test_unit}.rs`. Docs/template: `llp/{1012-local-first-v1.spec,1019-derived-delivery-custody.rfc}.md`, `snapback2/packages/snapback2/guide/deliver.md`, `snapback2/packages/snapback2/templates/chat/snapback/seed.ts`. Evidence: existing `snapback2/metrics/{loop,twin}.jsonl`, `REPORT-custody-c2.md`, `reports/final-custody-c2.md`. No other source files changed.

Code-fact corrections: adoption's authoritative incoming schema is known in the program swap before old facts are replaced; prepared rows require `imageRecord` when discovering anchors; LLP 1012 base is 1,861 lines. Cargo accepts one filter, so the requested three-name shorthand was implemented with real module filters plus the full workspace. An initial literal `test_unit` filter matched zero and is not claimed as a test. The same-source owner fixture needed required-field values in both seed data and future insert sites when installing the successor. This is fixture preparation, not a production exception. No compatibility shim, new apparatus, design doc, diagnostic, budget increase, or user-facing text shortening.

## Residuals for the orchestrator's single follow-up ticket

- Mounted Thread Acceptance 2 component test remains beyond the existing shared-binding proof; zero transport is now checked exhaustively for that binding.
- End-to-end manifest-only-schema reset test remains; direct clock-reset schema/override regression and all-carrier reset/adoption controls are added.
- Carol offline after paginated joiner history remains untested in this round.
- LLP 1011 B5 wording remains outside this lane.
- Four inherited older expectations outside the blocking package list remain: `client.test.ts` “query retries HTTP and network transport failures while mutation retries neither”; `assets.test.ts` “mutation substitutes scalar, optional, list, and video sources from one manifest generation”, “descriptor fence refuses an observed manifest generation change after uploads”, and “local serialization failure discards automatic uploads before any mutation request”. Exact base-source control fails all four identically. They concern current transport refusal/expectedGeneration behavior, not adoption custody.
- Fleet snapshots lack Git metadata for the tracked-source NUL check; that check passes in the real local worktree. Remote Bun 1.4.0's two compiler object-prototype assertion failures differ from the passing local invocation. Neither is hidden as a passing result.

Open semantic/allocation questions: **none**. Orchestrator owns commit and integration.
