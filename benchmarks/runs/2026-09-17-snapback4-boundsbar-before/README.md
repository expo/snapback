# The bounds bar — "before", on `snapback4@0.2.27`

**Status: complete — four valid runs, all green; two invalid attempts, both the
host's.** Serial runs of the bounds bar (`snapback4/loopbar/bounds.mjs`, LLP
3000.007 §20.22.7 and §21.5) on the published pin that predates every wave-13
landing. The bar measures what a fresh builder pays to write reads that must work
at hub scale, and separates bounds *met* (the runner's own
`complete`/`cut`/`next`/meter observations) from bounds *narrated* (the vocabulary
of the builder's own report). The same instrument reruns on the pin published
after wave 13 lands; the difference is what the wave is judged by. N = 4 valid,
calibration, not a magnitude claim.

## Packet

| | |
| --- | --- |
| Instrument | `snapback4/loopbar/bounds-brief.md`, `bounds.mjs`, `bounds-seed.mjs`, `bounds-metrics.mjs`, `bounds-probes.mjs` (+ `ceremony-metrics.mjs`, `ceremony-process.mjs`, `run.mjs`) at `5d2fb848a`; packet hashes in each `runner-result.json`, identical across all six attempts (the instrument was not edited between the two batches) |
| Pin | `snapback4@0.2.27`, `snapback4-darwin-arm64@0.2.27`; binary SHA-256 `ae7838c7…2be7`, README SHA-256 `c28117bf…3a076`; the pin unchanged after every run |
| Agent | `~/.volta/bin/codex exec`, `gpt-6-astra`, reasoning effort medium; the brief as the whole prompt; the installed package, its README, `npx snapback4 guide` and `why` as the whole packet; a 60-minute budget including install and seed |
| Seed | `generateSeed()`, deterministic: 1,300 chats (the hub persona in 1,000, every message `coffee`; 200 newer hidden matches in chats it is not in), 1,349 memberships, 99,390 messages, 1,000 authors × 50 posts, 1,411 follows (a 900-follower author), 98 likes — imported through the builder's own mutations |
| Runner | serial; install → agent → independent reverification on fresh copies (`check`, the builder's acceptance, the runner's wire probes: the whole hub and sparse search walks by the builder's declared protocol, the three Following walks, roster + unread, Trending before and after 20 likes and one unlike, 60-sample latencies after 3 warm-ups) → metrics; one JSON line per attempt in `boundsbar.jsonl` |
| Host | Apple M5 Max, 18 cores, macOS 26; shared and loaded (two wave-13 Codex lanes, wave 12's fix round and a third program building): load average at each start below |
| Launched from | the lead's shell (`node loopbar/bounds.mjs --n 3 --version 0.2.27 --root …/runs`, then `--root …/runs-b` for the replacement batch); the lane that authored the instrument could not run it (no nested `codex exec` inside a sandbox) |
| Retained | `run-*/`: `runner-result.json` (every number, the packet and pin hashes, the verification tails; the per-request traces trimmed to their first and last entries — the full traces, 0.6–2.6 MB a run, stay local), the builder's `run-log.md` and `final-report.md`, its `snapback/*.q`, every saved `check` output (`checks/`); `runner.log`, `runner-b.log`; `boundsbar.jsonl` (trimmed the same way) |

## Attempts

| Attempt | Wall s | Agent s | Verify s | Green | Loops (snapback4-defect / docs / agent / env / ambiguous) | Search protocol | Following | Load at start |
| --- | ---: | ---: | ---: | --- | --- | --- | --- | --- |
| run-1 | 629.4 | 626.8 | 36.2 | yes, 8/8 probes | 1 / 0 / 3 / 0 / 0 | one cursor (grouped page) | merge-on-read | 30.2 |
| run-2 | 573.7 | 573.0 | 99.6 | yes, 8/8 probes | 0 / 0 / 3 / 0 / 0 | two cursors (the card's walk) | merge-on-read | 10.8 |
| run-3 | — | — | — | **invalid: host hibernated** | — | — | — | 30.3 |
| run-B1 | 627.4 | 622.5 | 81.7 | yes, 8/8 probes | 1 / 0 / 4 / 0 / 0 | two cursors | merge-on-read | 76.0 |
| run-B2 | 910.5 | 909.2 | 603.6 | **invalid: binaries would not launch** | 0 / 0 / 1 / 1 / 0 | one cursor (declared; never verified) | merge-on-read | 14.7 |
| run-B3 | 1,124.1 | 1,123.1 | 153.8 | yes, 8/8 probes | 0 / 0 / 5 / 0 / 0 | two cursors | merge-on-read | 8.9 |

Two attempts are the host's, not the builders'. **run-3**: the agent started at
03:21 PDT, the laptop entered "Low Power Sleep" at 03:22 with the battery at 1%
(`pmset -g log`) and woke at 07:22; the runner's wall-clock limit had elapsed with
nothing written (`wallSeconds` 14,541 against a 3,600 limit, no `snapback/`
directory). **run-B2**: every CLI launch stalled before `main` — the builder tried
the direct executable, a byte copy, PATH, a TTY and signature checks, attributed
it `environment`, and wrote `result=unsuccessful-partial-environment-blocked`; the
runner's own verification then hit "dev startup timeout" on `check`, the
acceptance and its probes. The cause was host-wide: from about 15:00 UTC every
newly created executable sat in `_dyld_start` for minutes (Gatekeeper/XProtect
provenance scanning with `XprotectService` saturated — a fresh copy of the 0.2.27
binary took 279 s to print `--version`). run-B3 met the same stall for about
nine minutes, diagnosed it itself by sampling its own process, and finished
green inside the budget. Both invalid attempts stay in `boundsbar.jsonl` as
attempted runs, as the bar requires.

Every valid run: `check` clean, the builder's acceptance green on a fresh copy,
and every runner probe green — the whole 99,090-message hub walk with hidden
matches absent, the three Following walks (250 / 25,000 / 250 posts), the
50-member roster and the 50,000 unread total, Trending's three exact top tens.
Every valid run also stayed inside the ceremony bar's envelope (≤ 1,200 s wall,
≤ 1 Snapback-attributed loop).

## Bounds met (the runner's own observations, whole walks)

| Task | run-1 (one cursor) | run-2 · B1 · B3 (two cursors) | Every page complete | Any cut |
| --- | ---: | ---: | --- | --- |
| hub search, 99,090 hits: requests / examined / index entries | 50 / 100,139 / 2,000 | 5,005 / 2,131,075 / 198,200 | yes | none |
| sparse search, 5 hits in 100 chats | 5 / 109 / 105 | 10 / 213 / 105 | yes | none |
| Following, 500 follows, whole walk | 1,250 / 1,899,000 | same | yes | none |
| Following, 5 follows and the celebrity follower | 13 / 1,195 | same | yes | none |
| roster + unread | 4 / 53 (run-1, B1) · 4 / 2,055 (run-2, B3) | | yes | none |
| Trending, three first pages | 3 / 870 (run-1, B1) · 3 / 33 (run-2, B3) | | yes | none |

Not one page of any verified walk was cut. The card's paved two-cursor walk —
chosen by three builders of four — answers the same 99,090 hits at a hundredfold
cost in requests and twentyfold in examined rows against the one-cursor grouped
page the fourth builder wrote.

## Bounds narrated (the builders' own text)

| Run | Chosen integer literals | `check` notes printed, all saved invocations | Bound vocabulary in run log + final report (total) | Cards read (lines) |
| --- | ---: | --- | --- | ---: |
| run-1 | 53 (`100` ×26, `0` ×9, `4000` ×6, `1` ×6, `4096` ×3, `1024` ×2, `25`) | N_WIDE_MERGE ×4, N_SPARSE_FILTER ×2 | complete 7, cap 5, meter 5, cursor 5, lanes 3, incomplete 2, N_WIDE_MERGE 2, cut 1, N_SPARSE_FILTER 1 | 2,494 |
| run-2 | 46 (`256` ×16, `128` ×9, `0` ×9, `4000` ×5, `2048` ×4, `1` ×2, `100`) | N_WIDE_MERGE ×2, N_SPARSE_FILTER ×2, E_QUARRY_SYNTAX ×1 | cut 6, batch 5, complete 5, cursor 5, ceiling 4, meter 3, bound 2, N_WIDE_MERGE 2, N_SPARSE_FILTER 2 | 1,458 |
| run-B1 | 35 (`128` ×12, `0` ×7, `1` ×7, `4000` ×5, `1024` ×2, `100`, `25`) | N_WIDE_MERGE ×8, N_SPARSE_FILTER ×4 | complete 7, cursor 7, meter 6, cut 4, lanes 4, cap 3, ceiling 3, bound 2, N_WIDE_MERGE 2, N_SPARSE_FILTER 2 | 1,820 |
| run-B3 | 55 (`80` ×17, `0` ×10, `100` ×10, `1` ×9, `4000` ×7, `4096` ×2) | E_QUARRY_TYPE ×5, E_QUARRY_SYNTAX ×4, N_SPARSE_FILTER ×2, N_WIDE_MERGE ×2 | cursor 6, complete 5, meter 4, batch 4, bound 2, ceiling 2, cut 2, N_WIDE_MERGE 2, N_SPARSE_FILTER 2 | 1,380 |

Every builder wrote the wide-merge note into its report as a limit it had not
met — run-1: "The compiler's wide-merge note remains in every relevant saved
check"; run-2: "a workload can exceed the unchanged 8,192 examined ceiling. It
passed the fixed 500-follow workload"; run-B3: "Following work grows with
followed-author lanes … Larger accounts … can produce incomplete answers". Three
narrated the search cut they never saw ("Search can still hit the engine's
32-word expansion bound or a query-wide meter cut; a cut matching merge may have
no safe continuation" — run-2). Between 35 and 55 integer literals a run were
the builder's to choose: key and body lengths, batch sizes, caps, lane counts.

## Schema shape

| Run | Tables | Maintains | Jobs | Operations (q / m / j) | Quarry lines | Per-task lines (search / following / roster+unread / trending) |
| --- | ---: | ---: | ---: | --- | ---: | --- |
| run-1 | 5 | 2 (`unreadTotals`, `postHours`) | 0 | 5 / 7 / 0 | 164 | 54 / 57 / 60 / 74 |
| run-2 | 5 | 2 (`messageCounts`, `likeCounts`) | 0 | 6 / 7 / 0 | 148 | 46 / 45 / 53 / 61 |
| run-B1 | 5 | 2 (`unreadTotals`, `postHours`) | 0 | 6 / 7 / 0 | 152 | 51 / 51 / 52 / 66 |
| run-B3 | 5 | 1 (`roomCounts`) | 0 | 6 / 9 / 0 | 151 | 52 / 51 / 55 / 64 |

The same five source tables every time, no jobs, no per-reader copies. Trending
split two ways: runs 1 and B1 partitioned rank by UTC hour behind a maintain and
merged 25 hour lanes (the shape LLP 3000.007 §21 measured the same day and wave
12 ships); runs 2 and B3 kept one rank index with a time filter and narrated the
cut it can meet (`N_SPARSE_FILTER`).

## Findings

- **Every builder asked for "grouped by chat" first wrote `group(page, 'roomId')`
  and lost the continuation** — four of four (run-1: "Grouping a merge page into
  a list lost its native cursor"; run-2: "group(page) consumed native cursor
  ownership"; run-B1: "group(page) discarded the merge cursor owner"; run-B3:
  "group(matches) consumes the page and loses its cursor owner"), and the
  instrument's own author before them. Reproduced as
  `benchmarks/runs/2026-09-17-snapback4-bounds-probes/group-drops-next/`: a query
  that pages `after c` and returns `group(page, …)` or `sort(page, …)` can never
  publish `next`, every full page reads `complete: false, cut: null`, and `check`
  says nothing. Open for the author (LLP 3000.007 §20.22.7).
- **A Snapback defect, P2, met by two builders of four** (run-1 and run-B1, each
  one Snapback-attributed loop): an expression inside a merge lane source's range
  seek passes `check` and fails every call with `E_INPUT: unknown variable
  $value1`. Reproduced and ticketed
  (`issues/20260917-snapback4-merge-lane-source-seek-expression-is-an-unknown-variable-at-runtime.md`);
  fixed in wave 13's language lane (W13c).
- **The lane-source rule was met head-on** (run-B3, loop 1): "merge lane
  selector used a local page variable; parser requires a bounded range read" —
  the builder inlined the membership read because a local could not be a lane
  source. Ruling 28 (a bounded list or page as a lane source) is the same
  complaint from the derived-data probes.
- **One real meter cut, met and designed around** (run-1, run-B1): a global rank
  filter for Trending cut at 8,193 examined in the builder's own extra
  shifted-window test; both repartitioned rank by UTC hour behind a maintain.
- **A misdiagnosis, P3** (run-2's first `check`): `-likeCounts[postKey]` is
  refused as "write sigils are invalid; use insert, update, upsert, or delete";
  `0 - likeCounts[postKey]` compiles. Ticketed with this record.
- **Following's 500-follow ÷ 5-follow ratio depends on the measurement path, and
  this record corrects the bounds finding on it.** Every builder chose
  merge-on-read Following. A 500-lane first page examines 1,540 rows against 115
  and costs about 2.5 ms more. The runner's requests, which ask for the meter
  counters and cost 1.8–3.7 ms each, read the ratio as 2.51× / 2.95× / 2.59× /
  2.22× at p50 (2.67× / 3.13× / 2.60× / 0.80× at p95, the last two under the
  launch stall); the builders' own bare clients, where a 5-follow page costs
  0.3–1.2 ms, read it as 8.97× / 7.32× / — / 5.21×. The Clique brief's "≤ 3×" is a
  ratio of loads on an unspecified path, so merge-on-read does not establish it;
  `N_WIDE_MERGE`'s rewrite to the feeds recipe is defensible at this width until
  the per-lane head cost falls. The celebrity write path is flat under the
  runner's measurement (post acknowledgement 0.99× at p50 in every run).
- Neither the seconds nor the loops changed with the load: green in 9.6–10.5
  minutes at load 11–76, and 18.7 minutes only when nine of them were the stall.
  The comparison this bar is for is the loops, the protocol chosen, the literals
  and the narration — and on 0.2.27 those read: a dead end every builder met,
  a defect half of them met, a paved walk three of four chose at a hundredfold
  cost, and a note every one of them wrote down as a limit.

## What the agents wrote

run-1 (one cursor): "Search preserves the native membership page and shapes
each of its twenty rows into a complete nested matching collection … twenty
larger chats can exhaust the examined, heap or output meter even below their
individual caps. Broad prefixes can also hit the engine's 32-word limit. Those
cases remain incomplete." On Following: "a merge on read over at most 1,024
follow edges, an enforced per-principal cap. Write cost does not fan out with
follower count."

run-2 (two cursors): "The server searches 20 membership lanes per batch, and
preserves a separate result continuation … Following uses a lazy plain-index
merge over the viewer's followed authors, with no fan-out on post writes." On
Trending: "N_SPARSE_FILTER is an honest limitation: many excluded old or future
high-ranked posts can exhaust the meter before ten results."

run-B1 (two cursors): the same walk, the same hour lanes as run-1 for Trending,
and the same `$value1` refusal worked around with named locals.

run-B3 (two cursors): "Grouping consumes a native page's cursor ownership. The
final wrapper returns grouped `rows` plus an empty projection of that same page
in `continuation`." On the stall: "The installed CLI initially stalled before
application startup for roughly nine minutes. Sampling our own process showed
only `_dyld_start` … recorded as an environmental startup observation, not a
demonstrated snapback4 defect."
