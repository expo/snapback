# Final report — M7 day-2 evolution, lane muse-clique-snapback2

## Raw epochs and wall

- M7 session start: 1788999016. M7 session end: see `end=` below.
- Fresh owner on 50700 (PID 16706) 1788999357; stopped for schema
  experiments via `dev --stop`; restarted, successor installed
  (PID 23885) ~1788999550. Web bundle exported ~1788999865; web server
  on 50710 (PID 37014).
- Pre-M7 snapshot: 2026-09-10T00:16:39Z (m7/pre-snapshot/manifest.json).
- Schema successor generation dd7f91b4 installed with status ready, no
  refusal, no `--apply-migration`.
- M7 suite green 1789000300 (6/6). Choreo m7 green ~1789000600.
  Snapshot comparison green ~1789000450.
- Wall ≈ 25 minutes. Status: `green`.

## Pre-M7 count structure (spec record)

The pre-M7 schema ALREADY carried a count structure:
`maintain messageCounts = count messages by conversationId`
(snapback/schema.q), surfaced as `api.conversations.conversation.count`
and shown in chat settings (`ChatSettingsForm`
`sm-chatsettings-messagecount`). It counted raw rows including
tombstoned messages; expired messages were already excluded (purged by
delete). M7 kept the maintain and added composite-group
`visibleMessageCounts` (by conversation + tombstoned flag); both
user-facing count sites now read the visible-only group.

## Suite results

- m7: 6/6 pass, coverage maps all six suite-required assertions
  (a01, a03, a04, a06, a07, a09), unmapped []. Receipt
  acceptance/m7/receipt.json.
- Previously-green milestones re-run post-migration: m1 6/6, m2 9/9,
  m3 5/5, m4 4/4 — all pass. m5 suite 5/5 (milestone stays
  capability-failure at choreography level; unchanged).
- m6 still red: pre-existing import defect
  (acceptance/m6/suite.mjs imports `acceptance/scripts/replay.mjs`,
  which does not exist; identical failure in the pre-M7 receipt).
  Preserved, not repaired per M7 budget.
- Note: m3's post-close failure on the old dev DB (receipt
  1788997495) does not reproduce on the M7 fresh instance (5/5) —
  old-DB residue artifact, not a product regression.

## Choreography results

- Frozen `m7` segment as sole selected segment: segment-summary
  green:true. m7-a02-live-poll-tallies passed, m7-a05-offline-vote-reconciles
  passed. Receipts m7/choreo-m7.receipts.jsonl (+ observations sidecar).
- One startup refusal on the way: suite-status m6.pass=false required
  an outcomeClass; annotated `setup` (metadata only, entry stays red).

## Snapshot comparison (m7-a08 support)

- Pre: m7/pre-snapshot/ (8 personas + manifest with sha256, exported
  through token-scoped custom clients over the M6 field manifest;
  baseline DM 6 msgs, Weekend Plans 9 msgs, 0 reactions).
- Post: m7/post-snapshot/ + comparison.json via m7/compare-snapshot.mjs:
  48 pre-existing message views checked, 0 drift in message content,
  media leaves, reaction sets, or delivery rows; 72 new rows from M7
  test/choreography traffic (allowed and reported).

## Correction loops with attribution

- agent-error: scratch probe picked `dm.id` instead of
  `dm.conversation.id` and voted on the newest thread row (evidence:
  /tmp/m7node/m7-probe.mjs iterations; fixed, backend probes 23/23).
- agent-error (prior session, inherited): m6 suite bad import path —
  preserved, not repaired.
- environment: node:test recursive-run() refusal forced the a09
  nesting remap to fresh-receipt verification (evidence:
  /tmp/m7node/nest-repro*.mjs); RNW selected/busy mapping forced the
  lane-owned PollView with explicit aria attributes (precedent: kit
  sm-chatsettings-color aria-pressed); choreo suite-status
  outcomeClass startup refusal (one-line annotation).
- snapback2-defect: none encountered in M7 (successor path clean).
- ambiguous: none.

## Candid gap list

- Poll editing/deletion UX beyond tombstoning (edit/caption paths
  reject polls server-side; client hides edit affordance by
  null-body rule) — acceptable per spec, no vote migration on edit.
- No unvote affordance (tapping the selected option is a no-op, not a
  toggle-off); spec requires changeable, not removable.
- Poll push preview uses the question text; no dedicated "Poll" preview
  string (spec silent; consistent with text behavior).
- Vote rows do not cascade on message expiry purge (mirrors reactions
  precedent; dangling rows are unreadable off-member queries and
  invisible in tallies).
- m6 suite import defect and missing scale-replay evidence remain from
  the prior session; untouched under M7 budget.

end=1789000504
