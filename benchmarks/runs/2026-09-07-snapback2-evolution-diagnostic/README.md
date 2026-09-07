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
