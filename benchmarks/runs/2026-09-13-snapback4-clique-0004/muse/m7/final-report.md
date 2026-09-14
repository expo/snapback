# M7 final report (lane muse-clique-snapback4-full-20260913)

## Raw clock

- start: `1789376048`
- backend: `snapback4@0.2.6` dev server, same starter-seeded store throughout
  the second half (PIDs 63759:49310 → 15436:49310 → 9542:49300; store
  preserved across the port move, timestamps stable, pre-snapshot valid).
- web: static `dist/` export served by `scripts/serve-dist.mjs` on 49311,
  then 49301 after the port move (PID 55256 → 16571).
- push worker live against the M7 backend (PIDs 52674 → 20424).
- Pre-M7 store of the inherited dev instance preserved untouched at
  `.snapback4.pre-m7-keep/` (restorable; inert to the server).

## Status

`green`

## What shipped

1. **Group polls** — `createPoll` (group-only, question ≤200 chars, 2–4
   options with client-minted stable ids, idempotent on the message id),
   `setVote` (one vote per user, changeable, idempotent set-state with
   client mutation id), `pollOf`/`threadPolls` with live tallies, total,
   and the caller's vote. A poll is an ordinary `text` message (body =
   question), so polls count as messages, search, expire, tombstone, and
   notify like any message. Votes queue offline through the device outbox;
   the busy signal reads the device's own unconfirmed-row flag
   (`mine.pending`), and a server-miss while online is re-sent (safe: the
   op is idempotent set-state).
2. **Backfilled visible message count** — `inbox`/`chatDetail` `count` is
   now `messageCounts − tombstoneCounts` (excludes tombstoned; expired
   rows stop counting at the engine sweep; polls count while visible),
   rendered in chat settings (`sm-chatsettings-messagecount`, already
   wired, now truthful). Record: **the pre-M7 schema already carried a
   count structure** — `maintain messageCounts: count messages by chatId`
   plus `count` fields (raw totals including tombstoned); M7 corrected
   the semantics, it did not invent the field.

## Evidence

- `npm run acceptance -- --milestone m7`: **31/31** (`m7/accept-m7.log`,
  EXIT 0). Coverage manifest `coverage/m7.json` maps every
  suite-required assertion (m7-a01/a03/a04/a06/a07) to test ids; a02/a05
  map to choreo receipts; a08 to the snapshot comparison; a09 to the
  full run below.
- Full regression on the M7 backend: **160/160, EXIT 0**
  (`m7/regression-final.log`) — m1, m2, m3, m4, m5, live, m6, m7, m8.
  No previously-green suite failed; there were no prior failures to
  preserve.
- Choreography `m7` (sole segment): **green** — `m7-a02-live-poll-tallies`
  passed, `m7-a05-offline-vote-reconciles` passed
  (`m7/choreo-receipts.jsonl`, outcome `green:true`, `outcomeClass:null`).
  Suite-status + setup-identity linkage at `m7/suite-status.json`,
  `m7/setup-identity.json` (lane-run-id
  `muse-clique-snapback4-full-20260913-m7`).
- Snapshot comparison (`scripts/m7-compare.mjs` over the M6 field
  manifest, per-persona tokens): pre-snapshot `m7/pre-snapshot/` (8
  personas + hashed manifest) vs post-migration, post-suite,
  post-choreography state — **checked=48, diffs=0**.
- Native artifact: iOS Hermes bundle
  `app-host/clique/dist-ios/_expo/static/js/ios/entry-ae6af08f792727e483a95577ebbb51e2.hbc`,
  2805530 bytes,
  sha256 `1893bec10e4b1992bca075eb6078dd4c1e19258fbc580f1b08dbaa3a037ce3f6`.

## Correction loops (attribution + evidence pointer)

1. Quarry nullable insert refs / ambiguous single-key lookup (agent-error;
   `npx snapback4 check` E_QUARRY_AMBIGUOUS/E_QUARRY_TYPE) → `by
   byMessage`, message re-read, `??`-narrowing. 2 iterations.
2. UI-vote tally flash without server state (ambiguous; suite observation
   vs server `pollOf`) → strict server-state assertion with tap retry.
3. Missing push worker on the fresh backend (agent-error; m8 tail FAIL) →
   minted fresh pusher token, started worker.
4. Expo stale bundle cache served the old backend port (environment; boot
   probe) → `expo export --clear`.
5. Carol search-result pollution overflowed `m5-a04`'s 20-hit page
   (environment/inherited cliff; `searchPeople car` hits=20) → privileged
   `/seed` rewrites of residue display names (starter rows untouched,
   indexes verified consistent).
6. Two overlapping full-suite runs interleaved one log and re-poisoned
   the search page (agent-error) → killed straggler PID 5317, re-cleaned,
   one solo green run.
7. Choreo a05 never saw the offline pending flag (ambiguous → root-caused
   to local projection; deep-repro DOM evidence) → optimistic intent.
8. Optimistic intent cleared instantly by local mine-match (agent-error;
   deep-repro `aria-busy=false` with local tally 1) → busy signal reads
   the device row flag `mine.pending` (README §local client).
9. iOS export clobbered web `dist/` (agent-error; web 404) → ios exports
   go to `--output-dir dist-ios`; web rebuilt and re-verified.
10. Prior suites hardcode backend 49300 in subprocesses (ambiguous;
    m3 seed + m6 demo) → moved the M7 stack to lane-default ports
    49300/49301 (same store, snapshot kept valid).

Knowledge lookups (all with source in `m7/run-log.md`): `snapback4
guide` reads/writes/types/bounds, package-README maintain/dev/release
sections, `why`/adoption diagnostics, plus skill preflights
(durable-test-collateral, taste, browser-app-delivery).

## Reproduce (grader path, lane defaults, no env needed)

- Backend: `npx snapback4 dev --port 49300` (serves `snapback/*.q`,
  generation 2, Additive).
- Seed fresh (only for a new store): `npm run seed -- --segment
  m1|m2|m3 [--url ...]` in order.
- Web: `node scripts/serve-dist.mjs --port 49301`
  (`app-host/clique/dist`, baked `http://127.0.0.1:49300`).
- Worker: `node scripts/worker.mjs --url http://127.0.0.1:49300`.
- Pre-choreo (idempotent): `node scripts/m7-ensure-poll.mjs`.
- Suite: `npm run acceptance -- --milestone m7`; full:
  `npm run acceptance`. Compare:
  `node scripts/m7-compare.mjs --snap m7/pre-snapshot`.
- Choreo (sole segment; needs CHOREO_*_PASSWORD env + the two JSON
  files in `m7/`): see the exact invocation in `m7/run-log.md`
  (`choreo-m7-start`).

## Candid gaps

1. The `car`-search 20-hit paging cliff is structural (inherited): each
   full acceptance run adds ~7 Carol-named users; ~19 headroom remains.
   Do not run the full suite repeatedly on this store without
   re-running `scripts/m7-decarol.mjs`.
2. Expired polls leave orphan `polls`/`pollOptions`/`pollVotes` rows
   (unrendered — the client joins against live messages). No sweep job.
3. Visible count has ≤1 s transient skew when a tombstoned message's
   expiry sweep and the ledger sweep interleave.
4. No M7 iOS-simulator artifact (web + API + choreography only, per the
   M7 acceptance list); the iOS bundle above is an export, not a
   simulator proof.
5. A transport-failed vote leaves a transient error line even when the
   retry later delivers; the line clears on the next vote, not on
   delivery.
6. No unvote/clear API (change-only, per spec); no 5+-option polls (cap
   4, per spec); poll edits refused rather than supported (documented in
   `API.md`).
7. No custom choreography adapter shipped — the default adapter's routes
   and fixture ids (`Weekend Plans`, `m7-option-a/b`) match this lane, so
   none is needed.

## Clock close

- wall: `6391` s (start 1789376048 → end 1789382439), inside the 4 h
  safety limit. Status: `green`.

end=1789382439
