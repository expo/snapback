# Snapback 4: which device queries withhold a whole answer (for LLP 3000.019 P1)

- **Opened:** 2026-09-26, from LLP 3000.008.002.000 lane L3 (research only; no note shipped).
- **For:** the author of [LLP 3000.019](../llp/3000.019-what-the-builder-still-wrote.rfc.md) P1 (`N_SYNC_ORDER`).
- **Evidence:** 26 real-device observations (process device, base and published 0.4.2) and 104 routing
  probes through the unchanged `evaluateLocal`; the full report is
  `~/projects/snapback-ccp-20260926/lanes/CCP-REPORT-L3.md` on the black M5 Max, summarized here.

## What the device does

| Shape (device query) | Device answer | With an intersecting predictable pending write |
| --- | --- | --- |
| A page in the window's own order | complete data | complete data |
| The same rows, ordered differently from the window | **partial** (`complete: false`, not speculative) | partial data, no server call |
| An aligned list with a nested domain `count` over horizon-crossing input | **withheld** (`loading`, no data/next) | `loading` |
| A mismatched bounded page plus `count(page)` | partial page, count of the page | partial data |
| A mismatched bounded page plus `min(page, .ordinal)` | **withheld** | `loading` |
| An unpaged domain `count` | **withheld** | `loading` |
| A point read that misses past the horizon (e.g. a quoted message) | internal null, unknown + speculative | `loading` |
| The `jobs` card's `inbox` (embedded `unreadIn`) | **withheld** — fixed in LLP 3000.008.002.000 by splitting the total out | — |

Code: streaming `Count`/`Sum` open a scalar coverage frame and set `scalar_unavailable` when its input
coverage is incomplete (`crates/snapback4-core/src/engine/read.rs` ~734–752), which `runner.rs` ~335 turns
into `query_unavailable` for the whole answer; `engine/extrema.rs` ~57–89 does the same for domain and
page min/max; a horizon point miss is unknown and speculative (`engine/authorized_point.rs` ~189–195);
expiring-aggregate sources add unknown coverage even when the aggregate's own table is held
(`engine/read.rs` ~197–229). `count(page)`/`sum(page)` fold the chosen page and stay partial.

## For `N_SYNC_ORDER`

An order the window cannot serve yields **partial** data on the device (and falls back to the server only
when online and unfenced) — it does not by itself make the query `loading`. A truthful note about
*withholding* must name the scalar and point shapes above; a sound first predicate is "a device query
evaluates a streaming total or domain/page extremum whose evaluated input has a Horizon site (including
the implicit expiring-aggregate source sites), or a point read with a Horizon site". It needs consumer
context from the expanded IR, not just `Execution.sites`, and it fires truthfully on the reads card's
`recentTotal` and on any card that embeds a total in a list — decide those cards before shipping it.
