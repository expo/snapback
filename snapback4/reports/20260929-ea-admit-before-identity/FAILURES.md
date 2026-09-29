# Failure ledger

Classification covers unsuccessful exploratory builds/tests as well as the requested full run. Raw logs retain messages and stacks. Passing reruns do not erase the original results.

## affected-expanded.log

ours — initialization TDZ on reopen, followed by the parent timeout and closed-browser cascade; fixed.

- ✖ deferred burst, prediction, ids and reload (wasm) (1360.067486ms)
- ✖ same-turn navigation before deferred custody commits (wasm) (1434.021183ms)
- ✖ deferred burst, prediction, ids and reload (Worker) (1465.670587ms)
- ✖ same-turn navigation before deferred custody commits (Worker) (1476.889582ms)
- ✖ process device persists immediate writes before identity and resumes in order (215.567686ms)
- ✖ web admission review: recovery and transport respect the session boundary (180146.187525ms)
- ✖ navigation recovers its original outbox id before held-sync startup completes (30800.358925ms)
- ✖ navigation recovers its original outbox id before offline startup completes (31306.298874ms)
- ✖ backend-required custody cannot exit offline and enables exit after validated adoption (31395.627404ms)
- ✖ a hide during the startup probe waits for its accepted decision (6305.878578ms)
- ✖ a hide during the startup probe waits for its refused decision (6218.60397ms)
- ✖ a hide during the startup probe waits for its restore decision (6245.69188ms)
- ✖ a hide during the startup probe waits for its replacement decision (6327.690677ms)
- ✖ a hide during the startup probe waits for its observed-replacement decision (7347.307113ms)
- ✖ legacy journal after logout preserves committed outbox custody (wrapped store: false, device: false) (7438.627111ms)
- ✖ legacy journal after logout preserves committed outbox custody (wrapped store: true, device: false) (7216.176121ms)
- ✖ legacy journal after logout preserves committed outbox custody (wrapped store: true, device: true) (7408.197204ms)
- ✖ legacy journal after logout preserves committed outbox custody (wrapped store: async, device: true) (7435.225367ms)
- ✖ an accepted probe enables exit before ordinary replay resolves (9630.103854ms)
- ✖ a successful reconnect enables exit after startup 503s (1.178676ms)
- ✖ an empty-outbox open gates new clicks on its accepted probe (1.512898ms)
- ✖ an empty-outbox open gates new clicks on its refused probe (1.026188ms)
- ✖ an empty-outbox open gates new clicks on its restore probe (1.046898ms)
- ✖ an empty-outbox open gates new clicks on its replacement probe (1.025617ms)
- ✖ A's committed ordinary result owns settlement when keepalive answers first (receipt abort: false) (1.460378ms)
- ✖ A's committed ordinary result owns settlement when ordinary answers first (receipt abort: false) (0.968261ms)
- ✖ A's committed ordinary result owns settlement when ordinary answers first (receipt abort: true) (0.937585ms)
- ✖ a known NOT_ADMIN refusal survives two receipt aborts when keepalive answers first (1.343924ms)
- ✖ a known NOT_ADMIN refusal survives two receipt aborts when ordinary answers first (5.430669ms)
- ✖ receipt abort then retry persists sent before any replacement sync or POST (3.742209ms)
- ✖ sync acknowledgement replaces an aborted replacement refusal after A committed, including reopen (1.544285ms)
- ✖ a refused _ops row never acknowledges success after its NOT_ADMIN response is lost (2.894348ms)
- ✖ a known NOT_ADMIN receipt wins over a legacy outbox acknowledgement in mutate and lookup (1.412286ms)
- ✖ a legacy refused observation with no history remains pending until same-id replay (1.333118ms)
- ✖ final begin_send preflight preserves an intervening NOT_ADMIN receipt in mutation and notification (1.335691ms)
- ✖ lookup repairs a stored replacement refusal from sent_seq alone before catch-up and reopen (1.26097ms)
- ✖ a pending changes rewind waits for an aborted successful receipt to become durable (1.267569ms)
- ✖ outbox-only sent_seq evidence rejects a replacement refusal without terminal history (1.189162ms)
- ✖ outbox-only observed_seq evidence rejects a replacement refusal without terminal history (0.938817ms)
- ✖ a keepalive settlement held past the exit timeout excludes ordinary delivery until commit (1.243003ms)
- ✖ an aborted keepalive receipt transaction retains custody until receipt and retirement commit together (1.098896ms)
- ✖ replacement after validation refuses the original orphan binding at the server (ordinary transport) (1.13475ms)
- ✖ replacement after validation refuses the original orphan binding at the server (exit transport) (0.848382ms)
- ✖ a fresh orphan bound to A is retired before enqueue on B (ordinary transport) (2.417213ms)
- ✖ a fresh orphan bound to A is retired before enqueue on B (exit transport) (0.838086ms)
- ✖ a recovered orphan bound to A is retired before enqueue on B (ordinary transport) (0.789714ms)
- ✖ a recovered orphan bound to A is retired before enqueue on B (exit transport) (0.789554ms)
- ✖ a fresh orphan waits for an unidentified destination and delivers its original id after matching sync (1.048131ms)
- ✖ same-epoch logout tombstone refuses live admission (0.993409ms)
- ✖ same-epoch logout tombstone refuses live admission even with retained session fields (0.742062ms)
- ✖ a confirmed epoch mismatch fences existing observations while the change poll is held (0.926809ms)

## affected-final.log

environmental — two 5 s response timeouts under concurrent load, then the 180 s parent timeout and six closed-browser failures; unchanged web code passes all 55 tests in admission-review-final.log.

- not ok 45 - replacement after validation refuses the original orphan binding at the server (ordinary transport)
- not ok 46 - replacement after validation refuses the original orphan binding at the server (exit transport)
- not ok 49 - a recovered orphan bound to A is retired before enqueue on B (ordinary transport)
- not ok 50 - a recovered orphan bound to A is retired before enqueue on B (exit transport)
- not ok 51 - a fresh orphan waits for an unidentified destination and delivers its original id after matching sync
- not ok 52 - same-epoch logout tombstone refuses live admission
- not ok 53 - same-epoch logout tombstone refuses live admission even with retained session fields
- not ok 54 - a confirmed epoch mismatch fences existing observations while the change poll is held
- not ok 21 - web admission review: recovery and transport respect the session boundary

## client-build-initial.log

environmental — generated wasm JS/types absent in this fresh checkout; built the prerequisite.

- src/web-wasm.ts(1,18): error TS2307: Cannot find module './wasm/snapback4_device.js' or its corresponding type declarations.
- src/web-worker-runtime.ts(1,27): error TS2307: Cannot find module './wasm/snapback4_device.js' or its corresponding type declarations.
- src/web.ts(23,27): error TS2307: Cannot find module './wasm/snapback4_device.js' or its corresponding type declarations.

## client-build-premerge.log

ours — closure temporarily moved outside its lexical scope; fixed.

- src/local.ts(99,49): error TS2304: Cannot find name 'call'.
- src/local.ts(99,77): error TS2552: Cannot find name 'settling'. Did you mean 'setLink'?
- src/local.ts(99,97): error TS2304: Cannot find name 'rerunTables'.

## client-build.log

ours — strict optional-property and reply narrowing errors; fixed.

- src/identity-admission.ts(20,63): error TS2375: Type '{ backend: string; store: string | undefined; deadline: number; }' is not assignable to type 'AdmissionIdentity' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the types of the target's properties.
- src/identity-admission.ts(57,5): error TS2375: Type '{ predictable: false; predicted: never[]; store_id: string | undefined; admission_waiting: boolean; admission_refusal: Refusal | undefined; id: string; seq: number; op: string; ... 8 more ...; now?: number; }' is not assignable to type 'Queued' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the types of the target's properties.
- src/identity-admission.ts(116,18): error TS2379: Argument of type 'Queued' is not assignable to parameter of type '{ store_id: string | undefined; id: string; seq: number; op: string; args: unknown; new_ids: string[]; predicted: string[]; predictable?: boolean; replay_candidate?: boolean; sent_seq?: number | null; ... 6 more ...; admission_refusal?: Refusal; }' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the types of the target's properties.
- src/identity-admission.ts(118,34): error TS2379: Argument of type '{ store_id: string | undefined; id: string; seq: number; op: string; args: unknown; new_ids: string[]; predicted: string[]; predictable?: boolean; replay_candidate?: boolean; sent_seq?: number | null; ... 6 more ...; admission_refusal?: Refusal; }' is not assignable to parameter of type 'Queued' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the types of the target's properties.
- src/identity-admission.ts(118,45): error TS2379: Argument of type '{ store_id: string | undefined; id: string; seq: number; op: string; args: unknown; new_ids: string[]; predicted: string[]; predictable?: boolean; replay_candidate?: boolean; sent_seq?: number | null; ... 6 more ...; admission_refusal?: Refusal; }' is not assignable to parameter of type 'Queued' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the types of the target's properties.
- src/web-worker-device.ts(150,102): error TS2345: Argument of type 'unknown' is not assignable to parameter of type 'string | null | undefined'.

## focused-current.log

ours — initialization TDZ on reopen; fixed.

- not ok 2 - deferred burst, prediction, ids and reload (wasm)
- not ok 3 - same-turn navigation before deferred custody commits (wasm)
- not ok 7 - deferred burst, prediction, ids and reload (Worker)
- not ok 8 - same-turn navigation before deferred custody commits (Worker)
- not ok 11 - process device persists immediate writes before identity and resumes in order

## focused-expanded-2.log

ours — fixture expected the eight reserved row IDs rather than the one consumed ID; corrected to assert preserved consumed prefix.

- ✖ deferred burst, prediction, ids and reload (wasm) (1495.593418ms)
- ✖ deferred burst, prediction, ids and reload (Worker) (1653.694823ms)

## focused-expanded.log

ours — fixture React module resolution; fixed.

- ✖ immediate mounted form before identity (wasm) (275.593063ms)
- ✖ deferred burst, prediction, ids and reload (wasm) (13.116548ms)
- ✖ same-turn navigation before deferred custody commits (wasm) (11.106905ms)
- ✖ identification timeout settles visibly without sending (wasm) (10.884843ms)
- ✖ identification adoption settles visibly without sending (wasm) (11.187076ms)
- ✖ immediate mounted form before identity (Worker) (11.06309ms)
- ✖ deferred burst, prediction, ids and reload (Worker) (16.530664ms)
- ✖ same-turn navigation before deferred custody commits (Worker) (10.460778ms)
- ✖ identification timeout settles visibly without sending (Worker) (10.474078ms)
- ✖ identification adoption settles visibly without sending (Worker) (10.924622ms)

## guide-final.log

ours — new diagnostic routing/pins, obsolete fact pin, and card word budget; fixed; 98/98 rerun.

- test definitions::w11_every_registered_code_quotes_its_definition ... FAILED
- test familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block ... FAILED
- test familiar::every_moved_fact_has_its_why_or_details_home ... FAILED
- test w11_every_registered_code_has_a_dedicated_section ... FAILED

## identity-and-online-final.log

ours — expiry-reopen fixture never started its prepared process client; corrected to model real reopening.

- ✖ expired identification deadline survives reopen (process) (5734.249705ms)

## reproduction-corrected.log

ours — reproduction helper still auto-started sync; corrected with direct prepareClient.

- ✖ immediate mounted form before identity (wasm) (1272.189961ms)
- ✖ immediate mounted form before identity (Worker) (1159.612943ms)

## reproduction.log

ours — invalid fixture operation and auto-starting helper; no baseline inference from this run.

- ✖ immediate mounted form before identity (wasm) (1871.406874ms)
- ✖ immediate mounted form before identity (Worker) (1063.376073ms)

## Setup command corrections

Ours: several commands initially used a repository-root path while already inside `snapback4`; reran in the correct directory. One poll used `tail` with a glob expanding to multiple paths and was corrected. These were command setup mistakes, not product-test results.

## Full suite

Exact result: `== 3 failure(s) in 1967 s`, exit 1. Cargo: six failed assertions in three targets. Clients: 4203 pass, 80 fail, 5 cancelled, 10 skipped (4298 tests). Models: 78 pass, 1 fail (79 tests). **All full-run failures are ours; none is baseline or environmental.**

The delivery-matrix child was stuck for over 15 minutes and was explicitly terminated with SIGTERM so the script could finish. This is an additional lane-owned verification interruption, not a passing traversal. The complete corrected matrix passes 319/319. The list below includes the failed/cancelled parent cases as reported, deduplicated from the runner's repeated summary.

Full-run dispositions:

- Admission/acquisition/startup assertions: changed custody and pending wording required fixture updates. Native receipt injection now starts identified. The obsolete web rejection case also polluted the shared fixture; its downstream failures disappeared after replacing that expectation with the dedicated immediate-save suite.
- Native authority/retention/clock/lifecycle: fixed commit callback forwarding and over-serialization, preserved ordinary same-store scheduling and captured the caller wait policy at submission. Original assertions pass.
- Raw wasm residency/event-slot/clock/pending-ID tests: restored raw kernel admission ABI; only SDK custody calls opt into deferral. Original assertions pass.
- Online custody/retirement/storage/replacement: removed the dispatch journal reread that could deadlock behind a later admission; declared store identity in unit stubs that never perform discovery. Updated the intended incompatible-unsent refusal expectation. Known-store storage refusal remains unchanged.
- Delivery census: classified the new required refusal settlement site, preserved previous semantic recipes, reviewed the changed await boundary. All 319 fault tests pass.
- Session model: documented pre-identity pending with durable custody and no known receipt in that runtime is now allowed; known delivered outcome equality stays strict. Seed 1807 replay and all 10,000 session sequences pass.
- Guide/CLI: added dedicated actionable diagnostic sections, updated manual pins and fact homes, kept the card within its word budget. All 98 guide tests and both CLI checks pass.

Every full-run failing assertion/cancellation follows (classification: **ours**):


- **ours** — definitions::w11_every_registered_code_quotes_its_definition
- **ours** — familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block
- **ours** — familiar::every_moved_fact_has_its_why_or_details_home
- **ours** — w11_every_registered_code_has_a_dedicated_section
- **ours** — w11_why_every_registered_code_returns_its_dedicated_section
- **ours** — verbs::doctor_tests::w11_check_renderer_has_a_dedicated_excerpt_for_every_registered_code
- **ours** — process: schema alone is not acquisition; queued guarded writes survive offline reopen
- **ours** — W5c wasm: online reopen reports acquisition and a missing-row reason, then predicts
- **ours** — W5c process: online reopen reports acquisition and a missing-row reason, then predicts
- **ours** — W5R2a: two native owners recover 600 completions without stale pending memory
- **ours** — W5 confirmation N3: another owner's durable receipt still notifies this client once
- **ours** — process: apply withdraws an owner-only answer despite having no rule probes
- **ours** — process: admit withdraws an owner-only answer despite having no rule probes
- **ours** — process: apply revocation, keep=undefined, held
- **ours** — process: admit revocation, keep=undefined, held
- **ours** — process: transfer revocation, keep=undefined, held
- **ours** — process: apply revocation, keep=undefined, throw
- **ours** — process: admit revocation, keep=undefined, throw
- **ours** — process: transfer revocation, keep=undefined, throw
- **ours** — process: apply revocation, keep=undefined, unavailable
- **ours** — process: admit revocation, keep=undefined, unavailable
- **ours** — process: transfer revocation, keep=undefined, unavailable
- **ours** — process: admit revocation, keep=undefined, retryExhausted
- **ours** — process: apply revocation, keep=false, held
- **ours** — process: admit revocation, keep=false, held
- **ours** — process: transfer revocation, keep=false, held
- **ours** — CCP existing custody is not replaced by a redundant save refusal (wait=undefined)
- **ours** — CCP existing custody is not replaced by a redundant save refusal (wait=0)
- **ours** — settle pins E_STORE_REPLACED, then compacts its id across normal receipt churn and reopen
- **ours** — settle pins E_STORE_RESTORE, then compacts its id across normal receipt churn and reopen
- **ours** — a saturated journal recovers an already-admitted intent as pending while its delivery is held
- **ours** — generated Expo storage keeps a!b and a~b write custody separate
- **ours** — generated Expo storage keeps a*b and a'b write custody separate
- **ours** — generated Expo storage keeps a(b and a)b write custody separate
- **ours** — generated Expo storage keeps user:01ABC and user_3A01ABC write custody separate
- **ours** — generated Expo storage keeps ab and 慢 write custody separate
- **ours** — recovery refuses an intent with a foreign recorded owner even at the correct safe key
- **ours** — recovery quarantines a valid same-principal journal transplanted from another backend
- **ours** — online app reopens after replacement; replacement accepts session: true
- **ours** — online app reopens after replacement; replacement accepts session: false
- **ours** — replacement waits for durable retirement of admitted writes; persistence fails: false
- **ours** — replacement waits for durable retirement of admitted writes; persistence fails: true
- **ours** — local pending writes emit once with the kept device identity
- **ours** — local pending writes emit once with their original binding ahead of a newer device identity
- **ours** — native: sync before a delayed write reply does not apply an increment twice
- **ours** — native: sync before a lost write reply does not apply an increment twice
- **ours** — composed query return wasm: revocation fences pre-revocation server fields
- **ours** — composed query return process: revocation fences pre-revocation server fields
- **ours** — every delivery await is explicitly classified
- **ours** — web residency reconciles committed UTF-8 bytes through prediction, rollback, deletion and reopen
- **ours** — event slots wasm: ordinary event reads with sync public last 1 by .at
- **ours** — event slots wasm: ordinary event reads with online only
- **ours** — event slots wasm: aggregate fence online=false
- **ours** — event slots wasm: aggregate fence online=true
- **ours** — event slots wasm: held floored unrepost aggregate online=false
- **ours** — event slots wasm: conditional original removal aggregate online=false
- **ours** — event slots wasm: slot activation with literal default, interrupted before source pages
- **ours** — event slots wasm: normalized source slots survive deferred fold and reopen
- **ours** — event slots wasm: unheld original/repost removal and repost insertion queue
- **ours** — process: keep=undefined across apply publishes no loading and replaces the old answer
- **ours** — process: keep=undefined across admit publishes no loading and replaces the old answer
- **ours** — process: keep=undefined across settle publishes no loading and replaces the old answer
- **ours** — process: keep=undefined across revoke publishes no loading and replaces the old answer
- **ours** — process: keep=undefined across leave publishes no loading and replaces the old answer
- **ours** — process: keep=undefined across refusal publishes no loading and replaces the old answer
- **ours** — process: keep=true across apply publishes no loading and replaces the old answer
- **ours** — process: keep=true across admit publishes no loading and replaces the old answer
- **ours** — process: keep=true across settle publishes no loading and replaces the old answer
- **ours** — process: keep=true across revoke publishes no loading and replaces the old answer
- **ours** — process: keep=true across leave publishes no loading and replaces the old answer
- **ours** — process: keep=true across refusal publishes no loading and replaces the old answer
- **ours** — an unidentified Node device defers both transports until its first store binding
- **ours** — the first fresh write after replacement binds B even when the pending journal is empty
- **ours** — retrying the first fresh replacement id recovers its receipt without retiring or executing it twice
- **ours** — failed intent identity persistence refuses admission before any dispatch
- **ours** — composition: a deadline behind the issued floor does not loop server refetches
- **ours** — composition publishes at both deadlines, device first
- **ours** — composition publishes at both deadlines, server first
- **ours** — composed data with no server deadline still withdraws at its local row deadline
- **ours** — web: a legacy admission keeps its floor through upgrade, retirement and rollback
- **ours** — wasm: maximum pending ids (232), cursor batches and every terminal acknowledgement (automatic)
- **ours** — wasm: maximum pending ids (233), cursor batches and every terminal acknowledgement (automatic)
- **ours** — wasm: maximum pending ids (256), cursor batches and every terminal acknowledgement (automatic)
- **ours** — wasm: maximum pending ids (256), cursor batches and every terminal acknowledgement (explicit sync)
- **ours** — synchronous refusal: before-first-sync
- **ours** — useAcquisition reports committed snapshot pages and completion
- **ours** — session-locked journal refuses stale authority: logout
- **ours** — session-locked journal refuses stale authority: principal
- **ours** — session-locked journal refuses stale authority: epoch
- **ours** — session-locked journal refuses stale authority: recovery
- **ours** — web startup: immediate admin navigation, synchronous refusals and acquisition hook
- **ours** — online session state machine preserves I1–I13 across 5,000 seeded three-runtime sequences

## acquisition-final.log

ours — N3 fixture injected sequence 1 after the real identified seed had already advanced past it; use a future sequence. Final acquisition run passes.

- ✖ W5 confirmation N3: another owner's durable receipt still notifies this client once (5217.394201ms)

## broad-corrected.log

ours — native handoff added asynchronous work to same-store read publication. All original clock assertions pass after bypassing drained custody (clock-final-2.log).

- ✖ composition: a deadline behind the issued floor does not loop server refetches (6.221065ms)
- ✖ composition publishes at both deadlines, device first (4.10279ms)
- ✖ composition publishes at both deadlines, server first (2.461629ms)

## clock-final.log

ours — same-store reads still invalidated the handoff cache; fixed without changing clock assertions.

- ✖ composition: a deadline behind the issued floor does not loop server refetches (5.512864ms)
- ✖ composition publishes at both deadlines, device first (2.66132ms)
- ✖ composition publishes at both deadlines, server first (1.986378ms)

## custody-auth-final.log

ours — two online CCP races remained; removed the redundant dispatch reread and waited for intended dispatched custody in the fixture. Online replacement/custody rerun passes.

- ✖ CCP existing custody is not replaced by a redundant save refusal (wait=undefined) (2.558305ms)
- ✖ CCP existing custody is not replaced by a redundant save refusal (wait=0) (2.669372ms)

## delivery-matrix-focus.log

ours — await boundary inventory had not yet been updated. Reviewed new paths and added a required fault recipe; matrix-final.log passes 319/319.

- ✖ every delivery await is explicitly classified (131.438078ms)

## final-admission-regressions.log

ours — wrapper accessed custody metadata before the existing incompatible-device protocol diagnosis. The initial protocol read now passes through unchanged; lifecycle-identity-final-2.log passes 96/96.

- ✖ device compatibility rejects old and malformed protocols before online or offline startup (2.710893ms)

## identity-store-final.log

ours — close-during-discovery fixture omitted the new explicit pending reason; updated that expectation. The unchanged pending identity and durable reopen assertions pass.

- ✖ close detaches a held first-store probe and preserves the pending intent for reopen (12.966947ms)

## lifecycle-debug.log

ours — exploratory native wrapper scheduling reproduced the lost-reply wait regression. Fixed by preserving ordinary scheduling and the caller wait policy.

- ✖ local pending writes emit once with the kept device identity (5028.651028ms)

## lifecycle-debug-2.log

ours — exploratory native wrapper scheduling reproduced the lost-reply wait regression; fixed.

- ✖ local pending writes emit once with the kept device identity (5028.979767ms)

## lifecycle-debug-3.log

ours — exploratory native wrapper scheduling reproduced the lost-reply wait regression; fixed.

- ✖ native: sync before a lost write reply does not apply an increment twice (251.728008ms)

## lifecycle-focus.log

ours — callback/serialization scheduling regressions, corrected in the final wrapper.

- ✖ local pending writes emit once with the kept device identity (5028.481232ms)
- ✖ local pending writes emit once with their original binding ahead of a newer device identity (5007.462367ms)
- ✖ native: sync before a delayed write reply does not apply an increment twice (12097.34573ms)
- ✖ native: sync before a lost write reply does not apply an increment twice (215.149825ms)

## lifecycle-focus-2.log

ours — incomplete callback/serialization scheduling correction, subsequently fixed.

- ✖ local pending writes emit once with the kept device identity (5030.568903ms)
- ✖ local pending writes emit once with their original binding ahead of a newer device identity (5007.189814ms)
- ✖ native: sync before a delayed write reply does not apply an increment twice (12077.913876ms)
- ✖ native: sync before a lost write reply does not apply an increment twice (215.10619ms)

## lifecycle-focus-3.log

ours — same-store scheduling still delayed lifecycle publication, subsequently fixed.

- ✖ native: sync before a delayed write reply does not apply an increment twice (12077.252683ms)
- ✖ native: sync before a lost write reply does not apply an increment twice (212.479267ms)

## lifecycle-identity-final.log

ours — the first compatibility fix checked only capability flags and still obscured malformed protocol diagnostics. Now preserve the entire initial protocol read; all original cases pass.

- ✖ device compatibility rejects old and malformed protocols before online or offline startup (11.213196ms)

## online-replacement-final.log

ours — this verification started against stale dist while the corrected build was still running; the sequential rebuilt rerun passes all 25 cases.

- ✖ online app reopens after replacement; replacement accepts session: true (3120.239977ms)
- ✖ online app reopens after replacement; replacement accepts session: false (3114.894953ms)
- ✖ replacement waits for durable retirement of admitted writes; persistence fails: false (3095.713165ms)
- ✖ replacement waits for durable retirement of admitted writes; persistence fails: true (3082.960427ms)

## clock-baseline-build.log

ours — baseline verification setup used a nonexistent package-local node_modules; linked the actual workspace dependencies and reran successfully (19/19 baseline).

- error: script "build" exited with code 127

No baseline failure remains or is claimed. The merged-main clock control passed all 19 cases. All environmental exploratory failures are explicitly listed above; all other unsuccessful invocations and assertions belong to this lane.
