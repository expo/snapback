pub(super) const CARD: &str = r##"# Presence: who is connected right now

Presence reports which principals have an active or recently active connection.
Use it for online indicators and absence-guarded notifications.

```quarry
query connections(p: principal):
  return connected[p]                    -- an int; `exists connected[p]` is the bool
```

`connected[p]` is how many connections a principal holds open on the
server now: a device following the stream keeps a long poll open
(`GET /changes?wait=25&heartbeat=1`), and a poll that answered a moment ago still
counts for 35 seconds, the gap before the next. Heartbeats are JSON whitespace
every 2 seconds before the final object. On a running host, 4 seconds of
silence marks the link offline within 5 seconds; native fetch without streams
uses at most 2-second polls. Browser connectivity events give immediate hints;
authenticated `/probe` confirms recovery. Suspended hosts notify on resume.
It is not a table: nothing
syncs, nothing is written. A mutation uses it to defer an absence-guarded
notification while a connected-looking client is unconfirmed (guide effects); a query reads it for an online mark.
An observed query that reads it re-runs every 5 seconds, keeping its answer meanwhile, so an online
mark turns within 5 seconds of a first poll and of the end of the grace after the last one.
On a device the word is unknown: a query that reads it is `complete: false`, and the server answers it online.
A mutation stays eligible to predict when presence decides only effects: connection state never changes its rows or result on a successful commit, but can change which effect arms run and therefore its charges, as live versus absent presence already could. The server commits the effects and defers unconfirmed absence decisions until their deadline. The paved `if not exists connected[p]: emit …` form charges the same whether the recipient is held, graced or absent.
Shared boolean payloads and separate positive-presence emits can cost more for
held than graced recipients; a held recipient may get both a deferred absence
effect and an immediate positive-presence effect.
For a proven necessary absence guard in those effects-only mutations, a held poll is unconfirmed: the push is recorded and deferred five seconds from the commit, and only a new poll arriving within that window cancels it. Grace alone keeps its deadline, up to 35 seconds. Cancellation records the `satisfied` outcome `presence_reconnected` (guide effects). The guard decision does not change the value of `connected[p]` in a payload. Only a proven necessary absence guard authorizes cancellation; payload-only reads and alternative guards retain their ordinary decisions and remain immediate. Grace deadlines and recorded reconnects survive restart; `clock advance` makes a waiting effect due along with its grace.
Presence-derived values may use comparisons, `exists`, boolean logic and field values. An infallible point read feeding only an effect payload, including through local bindings, runs and is charged on the server only (`guide prediction`). Other reads, fallible arithmetic or builtins, `new` and refusals controlled by presence keep `predicts: never`, as do conditional values without a fixed-size proof. Prediction charges both safe presence arms apart from the omitted effect-payload work, so it may reach a bound even when the server would fit. If an untaken arm needs a combined guard's value refinement, the device queues without a row; put the data guard outside presence.

## Operations

In tests: `snapback4 clock advance 36s` or `POST /dev/clock/advance` with `{ "duration": "36s" }` closes the up-to-35-second deferral after a poll ends; open polls stay connected, and online client queries read the server's updated answer (guide clock). `snapback4 clock advance 6s` expires a held-poll effect deadline.
`snapback4 run` reads nobody as connected."##;
