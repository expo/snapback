# Independent grade trace — focused Snapback3 Clique day-two (M7 text/web subset)

Single assessor, no delegation, no other model calls, no clones or remote commands. All grader
artifacts are under `grading/`. No builder result, snapshot, database or evidence file was modified
(re-hashed after the run). No environment credentials were inspected or printed; fixture test
credentials were used only to authenticate to the app, and no bearer token, session credential or
browser-storage secret appears in this trace or in `grader-report.json`.

Narrative exposure: none. No diary, essay, final report, model transcript, other grader narrative or
other lane was read.

## 1. Input binding

Verified by hash before use: `execution-input.json` (fb953bb0…), `SCOPE.md` (98ad61d3…),
`m7-final.manifest.json` (98d6a0e2…), instrument manifest (b183d949…), builder prompt hash only
(1f8b9c07…, content not read), package archive (719eba5b…), pre-M7 database three-file set,
three pre-M7 persona snapshots, the old-client archive (5b8c58f8…), the frozen pre-M7 regression
selection (32af9943…) and the builder M7 claim file (f93597cc…). Spot-checked app source files
(`src/chat.tsx`, `snapback/{polls,schema,conversations}.q`, `dist/index.html`) all match the
execution-input post-change hashes.

## 2. Isolation

Three replicas were built from byte copies (never the originals): the completed M7 database
(`grading/app-final`, port 54900), the supplied pre-M7 database (`grading/app-premig`, port 54901,
used for the independent migration replay and the canonical count/poll sequence) and a copy of the
migrated replay database for the old-client control only (`grading/app-oldclient`, port 54910).
SQLite was read read-only through `node:sqlite` on copies; no writes to private internals.

Owned PIDs, all stopped at the end: 1713498 (54900), 1717541 (54901), 1732131 (54910),
1736186 (54900, second window). No browser processes remain.

## 3. What I did, in order

1. Hash verification and read-only census of both databases.
2. Row-level preservation diff of all 16 pre-M7 message rows against the final store.
3. Independent migration replay on an isolated copy of the pre-M7 database, with an 8-persona
   inbox sweep and guard checks.
4. Independent snapshot comparison (supplied pre-M7 exports vs the builder's first post-migration
   exports) with non-empty control assertions.
5. Browser canonical checkpoints in two independent contexts: counts 6/9 → 10 → 11, poll creation,
   stable poll/option IDs, live tallies, vote change semantics.
6. Real browser-offline vote durability: offline vote, page close/reopen still offline, reconnect.
7. API bounds, authorization, idempotence and maintained-forward counts with a retry.
8. Rerun of the documented selected regression suites (output redirected; drivers otherwise
   unchanged) plus the documented and separately installed API clients.
9. Old-client pending-operation control: archive hash, private extraction, offline reopen at the
   original origin, then reconnect to a migrated database copy.

## 4. Headline observations (detail and evidence in grader-report.json)

- Same database, real migration: `_meta created_at` and all eight principal IDs are identical
  between the pre-M7 and final stores, and `_commits` extends 15 → 115. A persisted nullable
  `messageCount` column now exists on `conversations`; it is server state, not a client total.
  My own replay produced 6 and 9 (tombstone excluded), both committed, and repeat attempts were
  rejected `ALREADY_MIGRATED`. Physical census shows exactly two conversations existed, so coverage
  is complete rather than first-page-only.
- Preservation: all 16 preexisting rows (including the tombstone control, the edited flag and six
  reply references) are byte-identical in the final store; the persona snapshot comparison found
  0 coverage failures and 0 field differences, with edited/tombstone/reply/reaction/`mine` and
  own-message fetched/viewed controls all non-empty for Alice, Bob and Carol before comparison.
- Counts: on my own migrated replica the reachable Chat settings UI showed 6 (DM) and 9 (group),
  then 10 after one poll and 11 after one text, agreeing with the public API and stored rows.
  A distinct new message incremented once and a retry of the same message identity did not
  increment again. The retained final database's stored counts (18/11/3) agree with its visible
  rows once its later builder mutations are accounted for.
- Polls: 200/201-character question and 50/51-character option bounds, 2–4 options, D-without-C,
  DM rejection, invalid option IDs, nonmember and unauthenticated access were all exercised through
  real API/UI behaviour, not receipts. Poll and option IDs were identical in both browser contexts.
  Votes are a set operation: Alice A→B and Bob A→B (offline) yielded a=0, b=2, total 2.
- Offline: the context was actually offline (app reported `offline`), the pending vote kept its
  durable operation ID across a page close/reopen while still offline, settled exactly once on
  reconnect, and repeating the same option afterwards changed nothing.
- Regressions: selected only from the frozen pre-M7 builder-owned selection (25 pass, 1 pre-existing
  fail excluded rather than relabeled). All 25 previously passing IDs were re-covered and passed on
  the final build; raw suite outputs are kept separately under `grading/results/suite/`.
- Old client: the original archive hash is unchanged. Offline reopen at the original origin restored
  the shell and the session and showed the original queued operation `731cbc48…` with its original
  message ID. After reconnecting that exact profile to a migrated database copy the operation stayed
  pending for ~60 s plus a reload: not committed (the server DM still has 6 messages and no
  `m7-old-client-…` row), not rejected, not lost. Reported as **recoverably parked**, which is not
  automatic compatibility. No replacement intent was manufactured and the journal was not discarded.

## 5. Retained failures (mine)

- First census of the live-served final store failed with SQLITE_BUSY; re-run on a static copy.
- First browser probe used the wrong client-state accessor (`.state` instead of `getSnapshot()`) and
  aborted at the offline phase; retried once in a second probe. Both outputs retained.
- Two shell invocations failed with `timeout: failed to run command '--no-warnings'`; re-invoked.

## 6. Scope discipline

No full M7/Clique green, no weighted score, no calibrated holdout, and no Snapback2 comparison is
claimed. Media, expiry, native proof, scheduling, push/presence and large-scale acquisition remain
declared omissions and are not counted as passes. Omitted prerequisites did not block any selected
scenario.
