# Populated app evolution diagnostic, 2026-09-07

The existing operator tools on published **Snapback 2 0.0.14** passed this
small headless evolution exercise: add a maintained message count to populated
data, expand/fill/contract an ordinary column, preserve the original rows,
reject a foreign-room write, and retain a forward count after restart.
This is a prepared engineering diagnostic, not a fresh builder trial or a
canonical Clique M7 result. No comparative score follows.

## Fixture and scope

Three private rooms contain 12 messages, six reactions, and 12 read receipts,
split between Alice and Bob. Each table uses owner-scoped reads. The original
schema has no count table or category column. The successor adds
`messageCounts = count messages by roomId, ownerId` and an optional room
category. A job fills categories before the final schema makes them required.
All fixture messages are current: expiry filtering, tombstones, shared-room
membership, polls, offline votes, media bytes, native clients, and pending
intents across generations are outside this exercise.

The [fixture](fixture/) contains the baseline, optional successor, and final
successor sources, including the seed and the unchanged preservation journey.
The two journey receipts use isolated seeded stores; **preservation of the
actual migrated store is established separately** by eight before/after
persona-query snapshots and the restart inspection.

The existing npm installation at
`/Users/ccheever/bench-snapback2-dx/published-0.0.14/bootstrap/` was reused through
a dependency symlink. No source package or compiler override was supplied.
This does not measure a fresh installation. [Environment and installed file
hashes](evidence/environment.json) identify the package and platform binary;
test receipts report `0.0.14`, binary digest `rust64:0c64cf0914f5b3e1`.
The separate working app remains at
`/Users/ccheever/bench-snapback2-evolution/0.0.14/app`.

## Results

| Exercise | Observed result |
|---|---|
| Baseline journey | Pass: Alice sees eight messages, Bob four; a foreign-room send refuses without changing Alice's rows |
| Add maintained count | Existing source rows rebuild into three count rows, each with value four |
| Require category before fill | Owner retains the optional generation and refuses `E_SUCCESSOR_NARROWING` for three missing values |
| Plan and rehearse fill | Plan succeeds; rehearsal reports one chunk and three room writes, `copyDiscarded: true`; live categories remain null at sequence one |
| Run fill and require category | One committed chunk fills three rooms; required schema becomes the owner's ready generation |
| Preserve existing data | All original fields of 3 rooms, 12 messages, 6 reactions, and 12 receipts match across the two personas; category is the intended addition |
| Regression journey | Same authored journey passes against the successor's isolated seed |
| Forward maintenance | Bob's send into Alice's room refuses; Alice's successful send changes room one's count from four to five |
| Restart | Count remains five; all original field values still match and the new message remains |

[Computed comparisons](evidence/comparison.json),
[before snapshot](evidence/snapshot-before.json), and
[after snapshot](evidence/snapshot-after.json) retain the field-level result.
Numbered command receipts preserve the arguments, exit status, stdout/stderr,
PID, and timing. Expected refusals are not treated as successful mutations.
Both development owner PIDs were recorded and confirmed absent after the
ordinary stop command; no test-run directories remained
([cleanup](evidence/cleanup.json)).

## Friction retained

1. The initial queries shared table names and hit the already-known generated
   binding collision in 0.0.14. Renaming them to `listRooms`, `listMessages`,
   and so on allowed the diagnostic to proceed. The source repair on main
   receives no retrospective credit for this published run.
2. An initial journey accessed `after.data` without narrowing the result's
   state. `E_OP_INVALID` identified that authoring error; the journey was fixed.
3. The first required-column attempt refused `E_SEED_VALUE` because the seed
   omitted category. After supplying category in seed rows, the same live
   store still had three missing categories and correctly refused narrowing.
   This distinction was absent beside the operator fill recipe; the guide
   update landed with this report explains both seed validation and live fill.
4. A local reporting helper initially had a Python syntax error before any
   command ran; correcting it did not rerun or overwrite earlier product
   evidence. CLI output excerpts are display truncations only; retained JSON
   holds complete output.

No benchmark deadline or original failure was changed. Commands used a
35-second diagnostic wrapper; no command reached it. Baseline/expanded checks
took 4.195/3.922 seconds on this shared host, exceeding the 1-second check
budget. This is a workload observation, not a timing qualification or an
attribution to these packaging/test changes. The published-DX measurement
already records slow checks; this run introduces no competing performance fix.

## Repeat with an unused local app

Install the pinned package with `npm install --save-exact snapback2@0.0.14`,
copy `fixture/v1/snapback` into the app, and run `check --json`,
`test --journeys-only --json`, then `dev --json`. Use that app's local
`node_modules/.bin/snapback2` for every command below.

1. Export `records.listRooms`, `records.listMessages`, `records.listReactions`,
   and `records.listReceipts` with `run <op> '{}' --as alice|bob --json`.
   Preserve the complete result and ensure each is complete with no next page.
2. Copy the optional successor sources. Run `check`, then verify `dev --status`
   reports that generation ready. Inspect `data messageCounts --as system`.
3. Copy the final seed and required schema. A successful static `check` does
   not mean the owner applied it: `dev --status` must report narrowing refused.
4. Restore only the optional schema, keeping the final seed. Wait for ready;
   run `admin.fillCategories --as system --plan`, then `--dry-run`. Inspect
   rooms to confirm that rehearsal did not fill them. Run the job with `--wait`.
5. Restore the required schema, verify the owner is ready, repeat the journey
   and eight exports, and compare every original field by row ID. Categories
   must all be `general`; no original row may disappear or change.
6. Send into `room-1` as Bob (must refuse), then Alice (must commit), through
   `records.send`. `records.countForRoom` must return five. Stop and restart
   the same app without reset, then verify the count and original data again.

Use `snapback2 run` before every operation/job spelling above. The retained
receipts contain exact invocations. Stop the owned development server when done.
This prepared exercise may help choose a later M7 workload, but cannot replace
M7's required fresh session, full application, offline vote, media preservation,
and prior milestone regression evidence.


## Pending-client successor exercise — source build, 2026-09-07

The [real-owner client regression](../../../snapback2/packages/snapback2/tests/real-owner.test.ts)
passes against source base `df959d36a` plus this change, using rebuilt package
bundles and the real Rust owner, Node 24.18.0, and the file carrier. This is
source qualification; the package metadata still says 0.0.14 and these are
not the published 0.0.14 artifacts used above. No runtime code changed.

The seeded chat contains two conversations with Alice/Bob and Alice/Charlie
memberships. Alice drains the ordinary inbox, holds a thread and count, and
queues two predicted posts without sending mutation requests. The client and
owner close; an optional message category is added; the owner and client
reopen with their persistent stores. The client receives `E_OFFLINE_RESET`,
then replays both admitted envelopes in FIFO order without changing args,
grant, offset, slice size, intent identity, or trace.

Both intents settle as `E_OFFLINE_CONFLICT`: rule verdicts bind the complete
schema, so even an unrelated optional column invalidates their previous rule
hashes. The original message remains unchanged except for `category: null`,
and neither conflicted intent writes a message. Two explicitly admitted
new intents commit once each and advance the maintained count by two. The
guide now explains this consequence and the new-intent recovery path.

A second case drops the response only after the real owner commits a post.
The client retains it as queued, closes, and reopens after the owner restarts
with the operation renamed. Its retry is byte-identical and receives the
original stored terminal; exactly one message exists. A fresh call to the
removed operation refuses `E_OP_UNKNOWN`.

[Final output](evidence/pending-client/final.log): one named regression passes,
16.285 seconds in the test and 25.603 seconds including harness setup. Both
owned owners, the isolated application, and its file-carrier directory are
closed/removed through the harness's cleanup. This uses graceful close and
reopen, not a physical process-kill witness or a native-carrier qualification.

Original unsuccessful attempts are retained: [unsupported test import](evidence/pending-client/round1.log),
[incorrect commit expectation](evidence/pending-client/round2.log),
[full conflict diagnosis](evidence/pending-client/diagnosis.log), and
[discarded unheld-room assumption](evidence/pending-client/contract.log).
The last attempt incorrectly assumed the second room was unheld; the inbox
drain had already hydrated it, so that supplementary case was removed.
There is no claim here about unpredicted writes across a schema change.
The final conflict assertion follows `Schema::rule_hash`'s documented
complete-schema binding; the authority check was not relaxed.

For LLP 1018's two outcome measures, this engineering exercise used **zero
application-owned corrective caches, coordinators, resume anchors, or data
repair code**, and exposed **one contract requiring probing**: conservative
schema-wide invalidation of saved rule verdicts. Test transport observation,
post-commit response loss, and owned fixture setup are diagnostic apparatus,
not application requirements. These observations do not replace counts from
a fresh builder's diary or establish formal M7.

## Public count acquisition and offline prediction

The second real-owner regression builds a separate Quarry fixture with
`cap 3 by principal`, matching `maintain principalCounts = count capEntries
by principal`, and one mutation looping over at most 49 principal arguments.
This execution uses two-principal cases. Only ordinary source rows are
seeded; the owner builds maintained counts. Separate file-backed guest clients
acquire their grants through `auth.guest()` and their counts through public
queries. No count rows, receipts, grants, or coverage are injected.

| Publicly acquired coverage | Offline observation | Owner result after reconnect |
|---|---|---|
| Both principal counts held at one | Predicts both increments; offline count queries return two | Both commit at two |
| Only the first principal's count held | Queues without prediction, empty trace | Both commit at two |
| Query returns zero for a new group | Queues without prediction, empty trace | Commits at one |
| Counts one and three, second principal at cap | Queues without prediction, empty trace | E_CONSTRAINT; both remain one and three, proving rollback of the first insert |

The zero case exposes a conservative coverage gap: the actual complete query
returns `data: 0`, `rows: []`, and empty `absences`, `ranges`, and `verdicts`.
The count fast path consequently has no absence evidence to trust. The
[follow-up](../../../issues/closed/20260907-snapback2-public-zero-count-does-not-enable-offline-cap-prediction.md)
records it without claiming unsafe zero inference or a completed repair.
Held nonzero counts work; an unheld count is never treated as zero.

[Final output](evidence/counts/04-scope-reduced.log): one regression passes,
5.418 seconds in the test and 14.436 seconds including owner setup. Earlier
[persona grant setup failures](evidence/counts/01.log),
[second setup attempt](evidence/counts/02.log), and
[incorrect zero-prediction expectation](evidence/counts/03.log) remain intact.
After the bounded attempts, zero prediction was explicitly left unqualified;
the final diagnostic asserts the observed conservative behavior and exercises
its reconnect and cap rollback. No runtime behavior changed.

These public queries establish practical acquisition for representative
multi-principal prediction, not a 49-insert execution, scale measurement,
native-carrier qualification, or published cold-builder outcome. No
application corrective infrastructure was needed. Grant acquisition through
a real auth session is documented; the unresolved zero-count coverage limit
is an engineering discovery rather than a newly required application cache.

## Formal M7 handoff readiness — 2026-09-07

Formal M7 remains open. This diagnostic and the pending-client successor
exercise are engineering evidence, separate from the fresh builder result.
The current-release prerequisite application is not ready: the 0.0.13 Astra
run stopped during M4, and the next full published Grok run is prepared at
`/Users/ccheever/clique-full-grok-015-20260907` with the original 169 instrument
leaves but no final package pin or application yet. The existing release
owner is repairing the closed CLI review findings before publication and
installed verification. Its prepared `ff894d7ce` source predates the
survivor-uniqueness fix `036fc240c`; a published claim covering that fix needs
a qualified package that includes it. This is the coordination state observed
on 2026-09-07, not an instruction to change a frozen release artifact.

Use that existing benchmark lane for the prerequisite. Once its continuous
run reaches M6, attempts M8 under the original dependency rules, and is graded:

1. Preserve its authored source, lockfile, published package identity,
   original instrument, custom-client API contract, and actual milestone
   results. Prepare a separate instance without builder essays or grading
   narratives in the fresh agent's context.
2. Seed the canonical pre-replay starter log into a fresh backend. Do not use
   the scale-replay database or acceptance-mutated development store. Export
   the M6 field manifest through the custom-client API with each persona
   before M7 starts. Preserve snapshot hashes, visible IDs/counts, and any
   existing count structures. Keep credentials private.
3. Give the fresh builder the unchanged M7 brief and same aid condition.
   Record its own clock, applicable original metering, diary, and closing
   essay before numeric grading. Prior milestone failures remain prior
   failures; they are not repaired within M7's budget.
4. Verify polls, idempotent changeable votes, live tallies, offline vote
   settlement, visible-message count backfill and forward maintenance,
   pre-existing data preservation, and previously-green milestone
   regressions. Counts exclude tombstoned and expired messages and include
   polls.
5. Count LLP 1018's two outcomes in the diary: application-owned corrective
   infrastructure and contracts learned by probing rather than diagnostics,
   status, or the guide.

These steps implement the existing [M7 brief](../../briefs/social-messenger.md)
(the heading is “M7 — Day-2 evolution”) and [benchmark protocol](../../protocol.md),
without adding an acceptance. Empty attachment/reaction fields in the starter
must be reported as empty-case preservation. Populated preservation and
already-queued intents across a successor remain separately labeled supplements.

Historical preparation examples remain useful, with their original limits:
[0.0.6 diagnostic grading](../2026-09-06-clique-improvement/evidence/m7-completion-006/independent-grader-report.md)
and [0.0.8 preservation evidence](../2026-09-06-clique-improvement/evidence/m7-preservation/README.md).
The latter proves m7-a08 only: 15 messages, 48 persona views, and 18
profile/post assets, with no message attachments or reactions. It does not
establish complete M7 or native qualification; its resumed token metering
was invalid. Neither historical record closes this current-release handoff.


## Integrated validation

The two added real-owner regressions pass together in
[29.904 seconds](evidence/integrated-client-tests.log), including harness setup.
The [real Chromium session witness](../2026-09-07-snapback2-1018-browser/README.md)
and its nine focused fake-owner regressions also pass at the same runtime
source. Package build/guide validation, caps, ref-check (412 LLP documents,
7,725 references, zero errors), and source/doc whitespace checks pass.
Raw test logs preserve reporter whitespace; the unrestricted committed
whitespace check flags those original log lines. No production runtime
code changed and no full battery or new loop-performance qualification is
claimed.

The offline recipe initially exceeded its existing 4,352-byte limit
([original build refusal](evidence/guide-over-budget.log),
[compression attempt](evidence/guide-compression-over-budget.log)). Existing
prose was shortened while preserving the documented contracts; the final
page is 4,352 bytes and package build passes. The limit was not raised.


## Indexed-candidate zero-count projection — 2026-09-07

A follow-up audit pinned architecture `02e13629b` and executed its actual
`TwinStore.sync/intent/row` methods with dependency stubs. With a primary
negative at sequence 10 and no base row, a queued whole-row count overlay is
hidden at issued sequences 10 and 11, cold and incremental. All four matching
no-negative controls expose count 1. The intent remains listed in every case.
[Raw results](./zero-count-architecture-projection.json) record the source hash,
inputs and stub limitations. This is isolated projection evidence, not a new
public-client or capability qualification. The [integration ticket](../../../issues/20260907-snapback2-indexed-twin-masks-predicted-count-after-proved-absence.md)
requires retaining the already shipped public zero-count/cap witness while
adapting the proof to the candidate's scalar index components.
