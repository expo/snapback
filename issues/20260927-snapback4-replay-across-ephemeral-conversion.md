# Snapback 4: replaying a write id after its mutation becomes ephemeral runs the new body

- **Opened:** 2026-09-27, from lane DS (LLP 3000.022's server half), which
  stopped on it rather than redesign ephemeral replay. Report:
  `~/sb4-intent/lane-ds/snapback4/reports/20260927-delivery-server/REPORT.md`,
  "Replay across conversion to ephemeral is unresolved".
- **Severity:** Low. It needs a program that renames a durable mutation's
  execution class across generations, and a client that replays an old id
  after that change.

## What happens

A later backend generation can keep a mutation's name and make it ephemeral:
for example `delivered` without its clause, writing an ephemeral `signals`
table. SQLite's `mutate`, `replay_mutation`, and the HTTP dispatch route
ephemeral operations **before** the durable receipt lookup. So replaying an old
durable write id executes the new ephemeral body instead of returning the
recorded receipt: `replayed: false`, `rows_written: 1`, `tables: ["signals"]`.
The lane's reproduction is `reports/20260927-delivery-server/replay-conversion-repro.rs`.

## Why it is not a delivery blocker

The SDK's delivery queue never replays across that change. A generation that
drops a binding ends the binding's state and fences its callbacks (LLP 3000.022
§5), and the compiler refuses an ephemeral reporter today. The exposure is a
general one: any durable mutation later redeclared ephemeral, replayed by a
client that kept an old id.

## Fix direction

Decide custody across an execution-class change, for example: a write id that
has a durable receipt returns it before ephemeral routing. That costs one
indexed receipt lookup on the ephemeral path, which is otherwise store-free, so
measure it. Ephemeral correlation ids stay non-idempotent (`serve_ephemeral`
tests pin that).
