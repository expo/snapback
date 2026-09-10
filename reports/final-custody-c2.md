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
