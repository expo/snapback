# SS round 7 — preserve restore proof and completed admission replies

2026-09-28, `sb4-intent/ss-sync-at-scale`, Linux `expo-build-1000`.
All three Astra findings are addressed and the observer audit is below.
This is local implementation evidence, not an independent READY verdict.
Nothing pushed or published; no tool installed.

First command: `git fetch origin && git merge origin/main`. Integrated
`3a8360db12be50a984b6da50d3634cc4f4cf2467` without conflicts. Merge commit
`e608e25db` retains both parents and the required co-author trailer. Read the
round 0–6 prompts, reports and SS journal entries, and Astra's entire review.
Grok's file contained progress text and no verdict at startup; did not wait
or treat it as approval. Round 7 changes no Rust, wasm, meter, authorization
rule, on-disk format, ABI, package version or default device selection.

## Findings and fixes

**High: 100 → 90 → 101.** Cold transport now distinguishes a valid same-store
regression from a foreign/malformed/missing head. Proven regression immediately
calls the same client refusal/invalidation path and withdraws page control and
prepared exit authority. New queries, admissions, actions and uploads refuse;
ordinary transport also checks after an asynchronous store capture. A delayed
101 reply cannot restore freshness. A newly captured admission may invalidate
read publication, but it cannot erase a same-store regression already proved
against that request's own floor.

The Worker host keeps the original head and complete capture until strict
persistence succeeds. Before any subsequent host transaction, and before close
releases ownership, it checks current identity and uses the existing
`observe_store` operation to commit the refusal. A currently executing terminal
publication may finish before this observation. Only the watermark/send guards
are rebound to that same store's current transaction; the original floor/head
remain the proof. This is refusal-only work, never authority to publish, adopt
or send. Failure/termination retains proof across Worker restart. Another store
does not inherit it. The page latch also survives later control publication.

The browser test holds the actual Worker inside terminal apply, records a
private/image floor of 100, holds two query responses, captures an admission,
releases head 90 and requires immediate refusal, then delivers head 101. Both
watches (including `keep: true`), a delayed ordinary read, new query, captured
and new admissions, upload and action refuse; no mutation/action/upload send
occurs. Terminal publication then advances the watermark to 101, but the
refusal still persists and survives an offline new-Worker reopen. A separate
protocol case interrupts the refusal before its strict commit, restarts the
Worker and requires the next read and reopen to see the refusal. The final
audit also exposed a successful sync observation already in flight clearing
the new refusal before its next call. A fifth browser case delays that reply,
then proves that it cannot reauthorize an action. It also hides the current
page control snapshot during proof delivery (the unavailable-control state
used during Worker restart); the captured proof is retained for host-side
identity revalidation instead of being discarded. The adjacent partition
refusal and adoption completion paths also preserve the sticky refusal.

**Medium: preparation cannot replace admission's reply.** The adapter catches
exit-preparation failure separately from the completed transaction, preserves
its success or known refusal, invalidates preparation permission and uses the
existing bounded background recovery (1/2/4-second retry budget). The two
browser cases throw after real preparation, including after it could have
prepared permission. They assert the original committed success or `NOT_ADMIN`,
transferred/cancelled journal, correct durable outbox, no immediate pagehide
send, and a separate preparation retry. Neither changes to unknown `E_STORE`.

**Low: test the footprint producer.** A real Worker admits and persists a
predictable send. After acknowledgement and a cold reset, its emitted control
contains `messages` and `messageCounts`; the stored outbox contains the actual
predicted row keys. The shared query procedure with that emitted snapshot
blocks an intersecting server answer with zero server posts and zero VM reads.
No test-created prediction snapshot substitutes for the runtime producer.

## Observer and fence audit

This checkout has no function named `witnessGeneration`. Generation's equivalent
is `syncRound`'s `observe_store` → `observeIncarnation` → captured `adopt` path,
plus native-install validation. The table names the actual paths inspected.

| Ordinary fence / observer | Bypass or Worker disposition and evidence |
| --- | --- |
| `witnessRestore` / `store_identity::observe`: same-store published watermark, private cursor and retained image head | Fixed above. Numeric nonnegative safe head required; every captured floor retained. New blocked-Worker/refilled-head and failed-save tests. Ordinary witness moved without semantic change to `device-restore.ts` to keep `local.ts` within the 1,500-line limit. |
| Store replacement: `observe_store`, `observeIncarnation`, receipt retirement, `backend_required` | Cold replies from another store cannot publish or collect. Ordinary `/q` also does not adopt a foreign store; authenticated sync/probe/change paths still do that work. Control compares store and transfer identity at dispatch/delivery. New proof persistence rechecks identity instead of adopting the old one. Store-reset tests and existing Worker orphan/receipt cases pass. |
| Generation/adoption/native ownership | Bypass requires the local generation, an unchanged control generation/acquisition and no backend requirement. Sync's generation refusal, private evidence, captured adoption and native installer are unchanged and still use the original wasm observer. Query replies themselves did not have a separate ordinary generation-adoption observer to skip. Generation and store-reset tests pass. |
| Send revision, published capture and private progress | Normal sync/probe/change/adoption calls retain engine checks. Cold publication compares send revision and acquisition; a newer publication terminates the bypass. Ordinary staging may advance private progress without invalidating an otherwise valid server answer: the bypass uses its own dispatch floors and grants no sync progress. Only a **proved refusal** rebinds guards after overtaking publication. An older successful sync observation, adoption or partition refusal cannot clear/replace the sticky refusal. Tested at watermark 101, across interruption and across a held observation reply. |
| Synchronous capture, queue revision and prediction dependencies | Page capture makes authority unknown before transfer. Older completion cannot clear another id. Worker footprint contains predictable, unobserved entries, including derived tables; unknown footprints block. Shared query checkpoints fence both dispatch and delivery. New real-producer test; existing pending-admission, unknown, queue and delayed-answer controls. |
| Session/credentials, refresh, logout, close and local commit authority | `refusedSession`, credential revision, `evaluateLocal` checkpoints and publication checks remain shared. Restore evidence is accepted from the current credential for the same store, even if a new admission has made the read unusable. The ordinary call commit hook still invalidates answers before fallible follow-up. Existing delayed credential/authority tests and observer suites pass. |
| Issued clock floor and expiry | Worker commits emit the durable floor; page raises its clock from it. Control compares issued floor; shared query publication checks device/server deadlines without awaiting before publication. Clock/expiry tests and the actual busy-Worker expiry case pass. |
| Held queries, retained composition, remembered answers and local coverage | Only an already wholly server-answered cold watch is eligible. Bypass never composes, serves a remembered fallback, or executes a held query. Ordinary engine/local routing remains intact elsewhere. Held/prediction routing and retained-store suites pass. |
| Ephemeral observation ordering | The bypass still uses `EphemeralReads.request/current/accept`, poll authority and the shared credential/expiry checkpoints; it introduces no ephemeral observer or stored presence state. Presence suites pass. |
| Freshness and cache/watch lifetime | `serverOnly` eligibility, `ReadObservation` publication, current incarnation/authority, and final credential/deadline checks remain shared. Only accepted server answers enter remembered-answer ordering. Restore clears answers/lingering watches synchronously; the new browser case includes a kept watch. |
| Supplementary delivery collection | Every bypass reply deletes its manifest, so it under-reports rather than collecting without observation. Bypass does not set `deliveryWitness` or authorize the delivery queue. Ordinary acceptance/facade approval and Worker's page-side conditional IDB commit remain intact; existing conditional abort/reopen protocol case passes. Restore immediately fences the queue and its persisted observer clears current debt. |
| Page admission authority, cancellation and shared receipts | Capture remains synchronous localStorage under the page claim; admission/transfer share strict IDB, and orphan ownership/shared-receipt-before-deletion are unchanged. Preparation now preserves completed outcomes. Both outcome regressions and existing authority/orphan/navigation cases pass. |
| Prepared and ordinary sends | Every newer queued transaction invalidates prepared permission. Restore additionally withdraws it synchronously; client guards block new admission, exit, ordinary send, action and upload dispatch. Device `begin_send` still checks durable binding/health; a queued admission after restore drains the proof first. New tests plus old stale-preparation/keepalive cases pass. |
| Worker failure and ownership handoff | Lifetime Web Lock, termination barrier, strict persistence, private invocation and committed callback remain unchanged. Pending restore proof drains on restart and close, before releasing ownership. A temporarily unavailable control snapshot does not erase a captured same-store proof; durable identity is rechecked on the host. All existing crash/termination/mixed-navigation cases pass. |
| Row rules, disclosure, meters, stage atomicity and physical deletion | No engine or persistence algorithm changes. Worker still executes the same interpreter and strict transaction. Existing default web durability and staged-deletion tests pass; the bypass never reads staged rows. |

There is no additional skipped observer requiring a different generation,
identity or authorization protocol in this audit. Immediate transport guards
for restore, proof persistence after overtaking publication/failure, and
preserving the refusal across older sync completion are the additional
corrections found while tracing the High finding.

## File map and forms

Paths relative to `snapback4/` unless prefixed `../`:

| File | Change |
| --- | --- |
| `packages/snapback4/src/device-restore.ts` | Internal evidence capability, captured floor/observation builder and extracted ordinary restore witness. |
| `packages/snapback4/src/device-control.ts` | Three-way cold reply classification and store-bound sticky page refusal. |
| `packages/snapback4/src/local-device.ts` | Optional internal restore-evidence host capability. |
| `packages/snapback4/src/local.ts` | Immediate restore observation; require host evidence custody for bypass; read/send/admission/action/upload/exit guards. 1,500 lines. |
| `packages/snapback4/src/web-worker-host.ts` | Retain proof through strict commit, Worker failure and close; same-store revalidation before later transactions. |
| `packages/snapback4/src/web-worker-device.ts` | Wire restore custody; isolate completed replies from exit preparation and retry independently. |
| `packages/snapback4/test/web-worker-control.test.mjs` | Malformed versus regressed heads and sticky publication/restart control, alongside existing fences. |
| `witness/worker-protocol.mjs` | Real prediction producer, both preparation outcomes and interrupted restore persistence. |
| `witness/worker-watch.mjs` | Real-client blocked-Worker 100 → 90 → 101, pending admission, delayed read, send guards and offline reopen. |
| `../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md` | §20.4 records proof custody and independent preparation, with the existing durability boundary. |
| `JOURNAL.md`, this report and `round7-*` evidence | Append-only outcome, audit, logs, regressions and failure accounting. |

No new public form. Existing forms compile/run:

```js
webDevice();                 // existing default, exercised by web/browser tests
webDevice({ worker: true }); // opt-in, exercised by protocol/navigation/reopen
const watch = client.observe({ kind: 'query', name: 'thread' },
  { conversationId: 'c000' }, { keep: true });
```

The guide's existing Quarry forms still compile and run under the whole guide.

## Qualification, negative controls and every failure

| Check | Result |
| --- | --- |
| Frozen workspace install, package build/typecheck | Pass; no dependency changes |
| Web device + Worker controls + server clock | 193 passed, zero failed |
| Sync-scale and repair-B files | 73 passed, zero failed |
| Prediction routing, generation, store-reset and presence audit files | 316 passed, zero failed, one existing skip |
| Final focused controls | 19 passed, zero failed |
| Final sync/generation/store completion check | 85 passed, zero failed, one existing skip |
| Chromium Worker protocol | 40/40, zero unexpected page errors |
| Actual busy-Worker watches | 5/5, zero page errors |
| Navigation | 10/10 default and 10/10 Worker |
| IndexedDB browser witness | Both exit 1, same two baseline assertions below |
| Whole guide | 92 passed, zero failed |
| Reference, whitespace and source-length checks | Pass |

Six isolated mutants are rejected: remove restore handling (blocked-Worker
assertion); make preparation reject admission (both success/refusal assertions);
emit `predictions: []` (actual producer assertion); forget pending proof before
commit (post-interruption next read lacks the required refusal); let an older
sync observer clear the refusal (action dispatch returns `E_ACTION_UNKNOWN`
instead of `E_STORE_RESTORE`); drop proof when the current page control is
unavailable (the immediate restore-fence assertion). They use copied
SDK sources/builds under `target/lane-ss-round7/mutants`, never mutated working
product files. Final ordinary source stays unmutated. These deliberately red
controls are not unresolved failures.

Every failure, classified:

- **Baseline, unresolved:** `durability.adoptionRejected` and
  `durability.adoptionUnlocked` are false in **both** IDB browser modes. They
  assume eager orphan recovery at open; current recovery waits for a call or
  authority attachment. All other reported checks pass; no page errors. Round
  4 already reproduced both on main. Reproduce with `node witness/idb.mjs`
  and `SS_WORKER=1 node witness/idb.mjs`. Existing ticket:
  `issues/20260928-snapback4-idb-witness-assumes-eager-orphan-recovery.md`.
- **Ours, corrected test harness/setup:** one edit used the repo-relative path
  while already inside `snapback4`; no file was changed by that failed edit.
  Initial isolated-mutant setup omitted `dist/#fetch` targets and matched the
  wrong compiled indentation. A later mutant run selected the ordinary opener
  rather than the copied Worker, so its hold assertion was a setup failure.
  Corrected the copied package and opener, then obtained the intended restore
  assertion failure. These earlier failures are retained separately and never
  counted as successful negative controls. The first fifth-case setup reused
  the preceding test's restored store and correctly refused during setup; the
  corrected fixture uses another seeded principal and store. Two exploratory
  source reads also named absent files; those reads changed no files. An initial
  ad-hoc gzip command used
  the default compression level; canonical `gzip -9 -c` below is the budget
  measurement, not that incomparable count.
- **Ours, expected:** the six semantic negative controls above. No unresolved
  lane-owned product/test failure.
- **Environmental:** no final qualification failure. No tools installed on a
  shared path or elsewhere this round.

**Did not run `scripts/test.sh`, as instructed.** Round 6's exact historical
result stands: `== 0 failure(s) in 1349 s`, exit 0. This is not a round-7 full
suite claim; the supervisor owns the landing suite. The inherited 60-second
full-suite limit remains unmet in that historical run.

Wasm remeasured, not rebuilt: **2,019,815 B raw / 585,384 B gzip**, delta
**0 / 0**, cap **586,193 B**, headroom **809 B**. Canonical GNU
`gzip -9 -c`, SHA-256
`083297984d5d963d3d356ac1fb73fb4b05c3239f7a25ac6c69bc05f50185f625`.
No wasm input or budget changes. Round-6 performance numbers stand;
no new scale measurement or stronger performance claim.

## Reproduction, context and limits

From `snapback4/`, existing Node 24.13.1 / Bun 1.3.14 / Rust 1.97.0:

```sh
export PATH=$PWD/target/lane-ss-round4/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
ulimit -n 65536
bun install --frozen-lockfile
bun run --cwd packages/snapback4 build
bun run --cwd packages/snapback4 typecheck
node --test packages/snapback4/test/web-*.test.mjs packages/snapback4/test/server-clock-wire.test.mjs
node --test packages/snapback4/test/sync-scale.test.mjs packages/snapback4/test/repair-b*.test.mjs
node --test packages/snapback4/test/prediction-routing.test.mjs packages/snapback4/test/sync-generation.test.mjs packages/snapback4/test/store-reset*.test.mjs packages/snapback4/test/presence-*.test.mjs
node witness/worker-protocol.mjs target/lane-ss-round7/worker-protocol-final.json
node witness/worker-watch.mjs target/lane-ss-round7/worker-watch-final.json
node witness/navigation-immediate.mjs
SS_WORKER=1 node witness/navigation-immediate.mjs
node witness/idb.mjs
SS_WORKER=1 node witness/idb.mjs
cargo test -p snapback4-lang --test guide
```

Scoped `llp-orient` context: Snapback 4's fence, LLP 3000, LLP 2000.000
§§7–9, LLP 3000.001 Repair B, LLP 3000.007 §§18.2/20.4, LLP 3000.016 §2.2,
LLP 3000.019 §3.3 and LLP 3000.022 §4. The current sync card was read.
The root, .007, .019 and .022 remain current; no new working-set document.
The local skill mirror is absent, so the populated sibling
`lane-gs/vendor/llp/skills/llp-orient/SKILL.md` was read without modifying it.
Risk reviewed: confusing a proved regression with publication authority, or
losing a known reply after commit. Existing .007 updated; hand-off none.

No deviation from round 7's requested scope. Broader limits remain those in
ROUND6: original Node acquisition and synthetic live-writer targets; Darwin's
90-second timeout; bucket amplification; within-budget bulk indexes; total
Worker memory; broader browser/bundler/platform qualification and independent
review. Their reproductions remain in ROUND6 and the acquisition ticket.
As with ordinary queued observation, page destruction before the strict restore
commit is outside durable-reopen evidence; no new synchronous restore journal
or physical-power-loss guarantee is introduced. Worker termination with the
page alive, strict commit, close, and subsequent offline reopen are tested.
