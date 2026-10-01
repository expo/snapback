# Repeated bisect

Every step rebuilds the historical SDK and runs the unchanged test selected by
`--test-name-pattern="1,000 per-row useQuery hooks:"` ten times, sequentially,
with Node 24.13.1 and Chromium on the unconfined 96-CPU host. Same installed JS
dependencies, Vite source aliases, and ignored main wasm build support the static
native import; the selected online case does not execute Rust or wasm.
Raw TAP, build logs, full commits, statuses and durations are under `raw/bisect-*`.

| Step | Passes | Loading renders in failed runs |
| --- | ---: | ---: |
| `d959efe2ed` | 0/10 | 34–81 |
| `d1e6061174` | 10/10 | 0 |
| `11ddefd88c` | 10/10 | 0 |
| `267788df36` | 10/10 | 0 |
| `096a1b78ef` | 0/10 | 57–88 |
| `88dcf7bd86` | 1/10 | 91–124 |
| `c3c4ed0976` | 0/10 | 30–85 |
| `ab2da069c5` | 10/10 | 0 |
| `c586a5904f` | 10/10 | 0 |

The first bad listed landing is PR `096a1b78ef`. Within it, `c3c4ed0976`
(PR round 1) fails 10/10 and its exact first parent `c586a5904f` passes 10/10.
The midpoint's one passing run illustrates why single samples are insufficient.

The breaking diff changes online `ObservationWork()` to `ObservationWork(false)`
and `reload(changed, {queued:true})` to `reload(changed, {queued:!changed})`.
A relevant feed event now starts the one-second bound on receipt and capacity
wait does not pause it. `ReadEpisode.check` withdraws at that deadline; the queued
replacement later publishes successfully, explaining unchanged 2,000 calls and
1,000 rows. The local evidence revision and detached/saved-answer fences are not
the cause of this online test.

The baseline trace reports `change-timeout`, with the last replacement starting
at 1,276.5 ms. The first scheduling-only experiment still failed. A CPU profile
shows React tree work dominating the active processing, and the causal browser
control sees nine commits for invalidation plus eight completions on main versus
one invalidation commit while the corrected ready-notification turn is held.
The first causal control failed main 10/10; after widening its held backlog from
16 to 32 rows, `raw/final-causal-main.log` independently fails 9 versus 1 again.

This preserves the necessary PR fence. Scope-ambiguous online evidence still
expires after one second even if all eight slots stay occupied. The fix removes
avoidable notification/turn cost; it does not promise continued visibility past
that authorization deadline under an arbitrarily suspended host.
