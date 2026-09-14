# The ceremony bar — fourth run, on `snapback4@0.2.12`

**Status: complete.** Three fresh-agent runs of LLP 3000.007 §10.3, one
after another, on the pin that carries §18 (the catch-up landing for the
0.2.9 calibration's findings). Every run went green and was reverified
independently. Every run stayed inside the loop bar's envelope: at most
1,200 s wall and at most one Snapback-attributed loop. All three agents kept
the natural membership rule and wrote Trending as a seek over the trailing
day, the form now on the feeds card. N = 3 per pin, so these numbers are calibration, not a
claim about magnitude.

## Packet

| | |
| --- | --- |
| Instrument | `snapback4/loopbar/ceremony-brief.md`, `ceremony.mjs`, `ceremony-{metrics,probes,process}.mjs`, `run.mjs`; every packet hash matches the 0.2.10 third run |
| Pin | `snapback4@0.2.12`, `snapback4-darwin-arm64@0.2.12`; binary SHA-256 `46696513876d0bbb059b51ae2711fb04b4c77c628b7b767a7b551ca3178bf1a1`; README SHA-256 prefix `d66543c2cd0eba44`; unchanged after every run |
| Agent | `~/.volta/bin/codex exec`, `gpt-6-astra`, reasoning effort medium; the brief as the whole prompt; installed package, README, CLI guide and diagnostics as the documentation packet |
| Runner | One run at a time: install, then the agent (≤ 1,800 s), then a fresh-copy `check`, the agent's acceptance and five independent wire probes, then schema measurement; `snapback4/metrics/ceremonybar.jsonl`, entries 10–12 |
| Host | Apple M5 Max, 18 cores, macOS, shared and loaded. Load at the start of each run: 27.6, 24.8 and 20.7. The 0.2.10 three-model Clique cell was running its later builders throughout; the Astra calibration on 0.2.12 started only after run 3 |
| Launch | The catch-up lead, 16:58 UTC, from the landing worktree: `node loopbar/ceremony.mjs --n 3 --version 0.2.12 --root ~/projects/snapback-ceremony-fourth/runs` |
| Retained | `run-{1,2,3}/runner-result.json`, `run-log.md`, `final-report.md` and `snapback/*.q`, plus `runner.log`; acceptance artifacts stay local in the original runs |

## Runs

| Run | Wall s | Agent s | Verify s | Green | Loops by attribution (snapback4-defect / docs / agent / env / ambiguous) | Snapback-attributed | Load at start |
| --- | ---: | ---: | ---: | --- | --- | ---: | --- |
| 1 | 388.7 | 368 | 205.7 | yes, 5/5 probes | 0 / 0 / 1 / 0 / 0 | 0 | 27.6 |
| 2 | 519.7 | 505 | 199.7 | yes, 5/5 probes | 0 / 0 / 2 / 0 / 0 | 0 | 24.8 |
| 3 | 406.2 | 390 | 194.7 | yes, 5/5 probes | 0 / 0 / 1 / 0 / 0 | 0 | 20.7 |

Wall time includes installation and the builder but not verification, which
is timed separately. Agent seconds come from the run log's clock. In every
run, `check` succeeds, acceptance succeeds on a fresh copy, and all five
runner probes pass: insights, trending, search, digest and receipt. Each
run keeps the informational `N_NO_CURSOR` note on its search membership
page. No run has the membership `N_NEVER_COMPLETE` correction.

## Schema shape

| Run | Tables | Maintains | Operations | Quarry lines | Work tables (agent-declared / heuristic) | Per-principal counter tables (agent-declared / heuristic) | World-readable counter lines |
| --- | ---: | ---: | ---: | ---: | --- | --- | ---: |
| 1 | 9 | 1 (`likeCounts`) | 14 | 201 | `digestEmissions` / none | none / `digestEmissions` | 0 |
| 2 | 9 | 1 (`likeCounts`) | 14 | 208 | `digestPeriods` / none | none / `digestPeriods` | 0 |
| 3 | 9 | 1 (`postLikes`) | 14 | 220 | `digestDeliveries` / none | none / `digestDeliveries` | 0 |

The nine source tables are `profiles`, `posts`, `likes`, `follows`, `chats`,
`members`, `messages`, a receipt table (`acknowledgements` or
`acknowledgments`) and a digest ledger, named differently in each run. The
heuristic calls the ledger a per-principal counter, and the agents do not;
both measurements are kept rather than silently reconciled.

## Four pins, side by side

The [before](../2026-09-13-snapback4-ceremonybar-before/README.md),
[after](../2026-09-13-snapback4-ceremonybar-after/README.md) and
[third](../2026-09-14-snapback4-ceremonybar-third/README.md) records keep
the earlier evidence. Means are computed from unrounded runner walls.

| | Before (0.2.8) | After (0.2.9) | Third (0.2.10) | Fourth (0.2.12) |
| --- | --- | --- | --- | --- |
| Green and independently reverified | 3/3 | 3/3 | 3/3 | 3/3 |
| Loops, total | 11 (3, 5, 3) | 6 (3, 2, 1) | 4 (1, 2, 1) | 4 (1, 2, 1) |
| Snapback-attributed loops | 1 (0, 1, 0) | 0 (0, 0, 0) | 0 (0, 0, 0) | 0 (0, 0, 0) |
| Wall seconds | 510, 407, 456 | 494, 403, 535 | 437, 407, 419 | 389, 520, 406 |
| Mean wall seconds | 457.4 | 477.4 | 421.0 | 438.2 |
| Source tables | 10, 10, 10 | 9, 9, 9 | 9, 9, 9 | 9, 9, 9 |
| Maintains | 8, 1, 1 | 0, 1, 6 | 1, 1, 0 | 1, 1, 1 |
| Natural membership rule retained | 0/3 | 0/3 | 3/3 | 3/3 |
| Trending as a seek over the trailing day | 0/3 (scan and filter) | 3/3 | 3/3 | 3/3 |
| World-readable counter lines | 0 | 0 | 0 | 0 |

## Membership rule, Trending and grouped search in each run

| Run | `members` read rule | Trending | Grouped search |
| --- | --- | --- | --- |
| 1 | `.principal = viewer or exists members[.chatKey, viewer]` | `posts['original', at >= at - 86400000, at <= at] first 1000 by byKindTime`, sorted and sliced | per chat: `messages[.chatKey] matching q` inside a `members[viewer]` shape |
| 2 | same | same form, `first 200` | per chat, in a loop over the viewer's memberships |
| 3 | same | same form, `first 200`, with `postLikes` | per chat, in a loop over the viewer's memberships |

## Findings

The shape the 0.2.10 run settled holds on 0.2.12. Every agent kept the
natural membership rule without a loop, and no agent paid a
Snapback-attributed loop. All three agents wrote Trending as the
trailing-day seek that §18.5 put on the feeds card, but agents on 0.2.9 and
0.2.10 had already written that form from the range-seek syntax. The card
recipe therefore changes nothing this bar can measure, and only the 0.2.8
agents scanned and filtered. The bar's grouped search groups
by chat, so every agent searched each chat on its own. None needed the new
cross-group matching merge, which this bar therefore does not exercise; the
Clique calibration's `search.all` does.

The four loops are all agent errors. Two were timestamps written outside
the lane before its run log existed. One was a delayed signal left by an
acceptance-cleanup timer. One was a harness parameter that shadowed the
server-start function, the same shadowing a 0.2.10 agent hit.

- Run 1: `loop=1 attribution=agent-error command="date +%s > /tmp/ceremony-time-unused" resolution="The preliminary clock command unintentionally wrote one timestamp file outside cwd before run-log creation; no external data was read. All subsequent task artifacts and temporary projects are confined to cwd. The initial file was not used. This scope violation cannot be undone retroactively."`
- Run 2: `loop=1 attribution=agent-error command=timestamp resolution=stopped-outside-writes` (initial shell wrote a timestamp outside cwd)
- Run 2: `loop=2 attribution=agent-error command=acceptance-process-cleanup-review resolution=clear-shutdown-escalation-timer-after-child-exit-to-avoid-delayed-signal; acceptance milestones now append to run-log directly`
- Run 3: `loop=1 attribution=agent-error failed="npm run acceptance" resolution="Renamed shadowing argument; full acceptance including real schedule and positive probes passed"`

## Non-claims and deviations

- N = 3 per pin, on a shared host whose load (20–28 at run start, higher
  than the 0.2.10 run's 14–24) and concurrent work differ between pins. The
  wall difference is not an isolated performance effect.
- The bar's small complete seed and finite pages prove the brief's shapes,
  not scale behaviour. Its tables are online-only, so this is not a proof
  of retained history or device sync, and it does not exercise §18.1's
  cross-group merge, §18.2's retained history or §18.3's adoption path.
- Two agents wrote a timestamp outside their lane before the run log
  existed. These are process deviations, kept above, and a green result
  does not erase them.
