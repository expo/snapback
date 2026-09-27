# Snapback 4: replaying a write id after its mutation becomes ephemeral runs the new body

- **Status:** Closed, 2026-09-27 (DS round 1).
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

## Resolution — 2026-09-27, DS round 1

SQLite `mutate` and `replay_mutation`, plus the HTTP ephemeral entry, now honor
an existing bound durable receipt before signature decoding or ephemeral
execution. Only a missing receipt falls through. New ephemeral correlation
ids remain non-idempotent. A fresh SDK report with a removed/rebound delivery
clause refuses `E_DELIVERY_BINDING` before execution; a recorded outcome
still replays first.

Regression witnesses: `snapback4-lang/tests/delivery_replay_conversion.rs`
and `snapback4/tests/serve_delivery/mod.rs`, including positive controls that
two fresh calls with one ephemeral correlation id execute twice.

Warm in-memory SQLite, optimized Rust test profile, ten alternating batches
of 5,000 writes: median 19,678 ns/write before the lookup and 25,978 ns/write
with it (+6,300 ns, about 32%); an isolated missing-receipt lookup measured
2,890 ns. These are local engine costs, not a network latency estimate.
Command and raw evidence: `snapback4/reports/20260927-delivery-server/round1/ephemeral-cost.txt`;
test `measure_ephemeral_receipt_lookup_cost` with `--ignored --nocapture`.
