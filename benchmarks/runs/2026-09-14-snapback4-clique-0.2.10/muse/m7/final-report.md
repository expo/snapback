# M7 final report — Day-2 evolution (polls + backfilled counts)

- lane id: muse-clique-snapback4-full-20260913
- model: muse-spark-1.3, effort=xhigh, backend=snapback4-0.2.10
- start=1789439356 end=1789440202 wall=846s status=green
- ports: backend 49340 (pid 67534, supervised worker 67552), web 49341
  (pid 13990). All three stopped at the end by PID; no pkill/killall.
- data env: fresh dev instance (continuous-session sqlite moved intact to
  `.snapback4/pre-m7-backup/`), seeded `--segment m3` (86 applied,
  0 skipped) through the app seed path. No scale DB reuse.

## Pre-M7 count-structure record
The pre-M7 schema already carried a count structure: `maintain
messageCounts: count messages by conversationId` (read-allowed, online
only) — raw row counts, tombstones included. M7 adds read-time
`convoMessageCount` (visible only) and leaves the maintain untouched.

## What shipped
- `snapback/schema.q` (additive migration via `dev` re-adoption; `check:
  ok`, notes only of pre-existing classes): `kind:'poll'` +
  `pollQuestion` on messages; `pollOptions` / `pollVotes` tables synced to
  members; `createPoll` / `pollVote` (receipts + push mirror text sends);
  `pollState` / `convoMessageCount` queries.
- App: `app/components/PollBlock.tsx`, poll branch in `app/chat/[id].tsx`
  (+ PollCompose composer), count line in `app/chat/[id]/settings.tsx`,
  API.md poll/count docs. Web + iOS bundles re-exported.
- Harness: m7 block in `scripts/acceptance.mjs` (durable collateral),
  `scripts/m7-snapshot.mjs`, `scripts/m7-snapshot-compare.mjs`,
  `scripts/m7-poll-setup.mjs`; `m7/pre-snapshot/` (8 files + manifest),
  `m7/post-snapshot/`; `suite-status.json` refreshed to post-M7 receipts.

## Results
- `npm run acceptance -- --milestone m7`: 6/6 pass, uncovered=[]
  (receipt `acceptance/m7-mu22ei65/receipt.json`): a01 create+shape
  refusals, a03 vote/switch/cross-user tallies, a04 same-id replay +
  same-option set-state, a06 backfill vs history ground truth (starter DM
  + group) + tombstone exclusion + polls count, a07 forward increments,
  a09 regressions.
- Previously green suites re-run post-M7, all pass: m1 (m1-mu22eid7),
  m2 (m2-mu22ejeb), m3 (m3-mu22ejon), m4 (m4-mu22eq7h), m5 (m5-mu22eqap),
  m6 (m6-mu22eqef), m8 (m8-mu22ero5). No prior failures existed to
  preserve (all were green).
- Choreography `m7` (sole segment): GREEN first attempt
  (`receipts-m7.jsonl`): m7-a02-live-poll-tallies 3/3 attempts,
  m7-a05-offline-vote-reconciles 1/1 (pending flags offline, tally+1 and
  flags cleared on reconnect).
- Snapshot comparison pre-vs-post over the M6 manifest: INTACT (all
  pre-existing messages byte-identical on manifest fields; reactions,
  receipt marks, members, media hashes intact; only new rows are M7
  polls/acceptance traffic).

## Correction loops (attribution + evidence)
1. agent-error: `at` listed immutable on pollVotes broke vote switches
   (E_CONSTRAINT); own API probe caught it pre-suite; fixed mirroring
   msgReactions; re-probed green (run-log + probe output).
2. agent-error: two acceptance-draft slips (count 4-vs-3, 5-option
   expectation) corrected on re-read before running.
3. environment: macOS lacks `setsid`, `nohup`/`&` rejected — servers ran
   as runtime-managed sessions, PIDs recorded and killed by PID.
4. environment: shared `/tmp` log name collided with another lane's
   backend output — unique filenames after.
5. ambiguous: page-scoped `sm-poll-total` allows exactly one live poll per
   group view — answered with fresh-ids-per-run setup + fail-loud guard.

## Knowledge lookups
instrument ENVIRONMENT.md / social-messenger.md M7 + global rulings /
CONTRACT.md poll IDs / assertions.json / fixtures + choreography READMEs;
snapback4 README (maintains, sync, expire, write authority, dev/deploy,
client card) + `guide` language card + contract.d.ts onWrite signature.

## Candid gaps
- Expiry exclusion from counts not live-tested (24h production TTL;
  rests on engine `expire at` semantics — rows absent to every reader).
- No migration-at-scale run (per brief: starter state only).
- Raw `messageCounts` maintain and historyPage `total` retained as the M6
  surface; visible count is the new query.
- Poll questions/options not search-indexed; no unvote (change-only);
  DMs may carry polls (spec's group path tested).
- iOS bundle re-exported; M7 has no native-artifact acceptance item.

end=1789440202
