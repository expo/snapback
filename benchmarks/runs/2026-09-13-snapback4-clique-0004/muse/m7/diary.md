# M7 diary (lane muse-snapback4, fresh session)

## What I built

Group polls plus a backfilled visible-message count on the inherited Clique/Snapback 4 app:

- **Schema (`snapback/schema.q`, adopted as generation 2, classified Additive):**
  `polls` / `pollOptions` / `pollVotes` tables with `pollTallies` and
  `pollTotals` maintains; `createPoll` (group-only, 2–4 options with
  client-minted stable ids, idempotent on the message id) and `setVote`
  (idempotent set-state upsert carrying a client mutation id) mutations;
  `pollOf` / `threadPolls` queries with a `pollCard` shape (options with
  live tallies, total, my vote). A poll is an ordinary `text` message
  whose body is the question, so polls count as messages, are searchable,
  expire with disappearing chats, and tombstone on delete — no new message
  kind, no enum surgery. A `tombstones` ledger table plus a
  `tombstoneCounts` maintain redefines the pre-existing
  `inbox`/`chatDetail` `count` as visible messages (total minus
  tombstoned; expired rows stop counting at the engine sweep).
  `editMessage` refuses poll messages (`POLL_IMMUTABLE`) so the question
  text cannot diverge from the poll row.
- **Web client:** poll rendering under each poll message via the frozen
  kit `PollDisplay` (stable option ids, tally/total semantics, busy state
  exactly as the choreography consumes them), a group-only `PollCompose`
  flow, and vote intents through the same outbox as sends. The pending
  signal is the device's own row flag (`mine.pending`), not a local
  guess. `API.md` documents `createPoll`/`setVote`/`threadPolls`/`pollOf`
  and the count semantics.
- **Harness:** `tests/m7.mjs` (31 checks, wire + browser), `coverage/m7.json`
  mapping every suite-required assertion, `scripts/m7-snapshot.mjs` and
  `scripts/m7-compare.mjs` (pre/post migration comparison),
  `scripts/m7-ensure-poll.mjs` (idempotent choreo-poll setup),
  `scripts/m7-decarol.mjs` (one-off residue hygiene, documented below),
  `scripts/serve-dist.mjs` (static dist server with SPA fallback).

## What felt easy

Quarry itself. The compiler is a strict pair-programmer: its rewrites
(`polls[msgId] by byMessage`, `??`-narrowing for optional args) were
correct every time, and three iterations took the whole M7 block from
draft to `check: ok`. The maintain system backfilled the new aggregates
over existing rows with zero migration code, and the dev server's
adoption log classified the change Additive with per-table lines — the
migration honesty the brief demands came out of the tooling, not out of
me. The frozen kit components (`PollDisplay`/`PollCompose`) already
carried the exact choreography semantics, so the client work was pure
wiring. The pre-M7 snapshot/compare loop gave me a machine-checked
"data survived" proof in minutes.

## What fought me

1. **The offline-vote pending flag (two rounds).** First I marked pending
   only when `mutate` returned `pending` — but the device applies queued
   writes locally and can report `sent`, so the flag never showed. Then I
   marked it optimistically but cleared it when the local projection
   matched — and the device projects queued votes instantly, so the flag
   died in under a second while still offline. The fix was humbling and
   small: the device stamps unconfirmed rows with `pending: true`, so the
   busy signal reads `mine.pending` straight off the row. Lesson: on a
   local-first backend, never mirror confirmation state by hand — the
   device already tracks it; my job is to render it.
2. **Test-residue cliffs.** Repeated full-suite runs accumulated
   Carol-named users until people-search `car` overflowed its 20-hit page
   and `m5-a04` fell over — exactly the pollution failure the inherited
   final-report warned about. I fixed it with privileged `/seed` rewrites
   of residue display names (engine-consistent, starter rows untouched),
   then learned the harder way that two overlapping suite runs
   re-poisoned the same page and interleaved one log. One run at a time,
   and no full runs after the last green.
3. **Stale caches and clobbered outputs.** Metro's cache served a bundle
   still pointing at the old port (`--clear` is now muscle memory), and a
   bare `expo export --platform ios` overwrote the web `dist/` (it needs
   `--output-dir dist-ios`). Both cost a rebuild each; both are now in
   the report so the next session does not pay again.
4. **Running the instrument choreography in-lane.** The lane's choreo copy
   is byte-identical to the instrument's but unrunnable flat: it imports
   `../metering/observations.mjs` and `../../lib/json-schema.mjs`, and the
   lane has neither sibling. I staged verbatim copies (metering from the
   instrument, the validator from the run root) plus a one-line import
   adaptation for the flat layout. It felt like assembling furniture with
   someone else's screws — all documented.

## What a migration on this backend is like

Compared to the systems I know: unlike a SQL migration (hand-written
DDL plus a backfill script you must get exactly right, with downtime
fear), and unlike a schemaless store (no migration, but every reader
defends against every shape forever), Quarry sits in a third place —
**the schema is the migration**. I declared new tables and maintains;
the engine classified the diff, rebuilt the aggregates over live rows,
and kept serving. There is no down-migration language and no data
rewrite hook, which is freeing for additive evolution (polls, ledgers,
counters) and would be constraining for the day you need to reshape a
hot table — that day you would model the new shape beside the old and
drain it with a job, not ALTER it in place. The honest limitation I hit:
maintains cannot filter, so "visible count" became total-minus-tombstones
with a ledger table instead of a single predicate — a small extra table
in exchange for never scanning. For a Day-2 feature of this size, the
whole backend half was one file, one command, zero downtime, machine-
verified. That is a good trade and I would take it again.
