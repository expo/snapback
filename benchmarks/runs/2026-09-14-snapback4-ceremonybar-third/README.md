# The ceremony bar — third run, on `snapback4@0.2.10`

**Status: complete.** Three serial fresh-agent runs of LLP 3000.007 §10.3,
after the pin carrying lane S's membership-rule absorption and lanes W–W4.
Every run went green, was independently reverified, and stayed inside the
loop bar's envelope (≤ 1,200 s wall, ≤ 1 Snapback-attributed loop). All three
kept the natural membership rule. N = 3 per pin: calibration, not a
magnitude claim.

## Packet

| | |
| --- | --- |
| Instrument | `snapback4/loopbar/ceremony-brief.md`, `ceremony.mjs`, `ceremony-{metrics,probes,process}.mjs`, `run.mjs`; every packet hash matches the 0.2.9 after run. Relative to the 0.2.8 before run, only two `@ref` comment rewrites differ (`c82b22824`); brief and probe hashes are unchanged |
| Pin | `snapback4@0.2.10`, `snapback4-darwin-arm64@0.2.10`; binary SHA-256 `af4e26be10419df9428bf6be0c7513de07d227e33f77cdb464c4d93dc2a0767d`; README SHA-256 `5c39274c701d6392031b1a65e4a398070686a45598d5e748a9c39f8d6bb07b74`; unchanged after every run |
| Agent | `~/.volta/bin/codex exec`, `gpt-6-astra`, reasoning effort medium; the brief as the whole prompt; installed package, README, CLI guide and diagnostics as the documentation packet |
| Runner | Serial install → agent (≤ 1,800 s) → fresh-copy `check`, agent acceptance and five independent wire probes → schema measurement; `snapback4/metrics/ceremonybar.jsonl`, entries 7–9 |
| Host | Apple M5 Max, 18 cores, macOS, shared and loaded; start loads 14.2 / 23.9 / 15.4. The Clique Astra builder started at 11:15:05 UTC, overlapping the latter part of run 1 and all of runs 2–3; run 1 started at 11:11:20 UTC |
| Launch | The previous orchestrator's publish continuation: `node loopbar/ceremony.mjs --n 3 --version 0.2.10 --root ~/projects/snapback-ceremony-third/runs` |
| Retained | `run-{1,2,3}/runner-result.json`, `run-log.md`, `final-report.md`, `snapback/*.q`, and `runner.log`; original runs retain acceptance artifacts locally |

## Runs

| Run | Wall s | Agent s | Verify s | Green | Loops by attribution (snapback4-defect / docs / agent / env / ambiguous) | Snapback-attributed | Load at start |
| --- | ---: | ---: | ---: | --- | --- | ---: | --- |
| 1 | 436.6 | 416 | 206.2 | yes, 5/5 probes | 0 / 0 / 1 / 0 / 0 | 0 | 14.2 |
| 2 | 407.4 | 386 | 192.2 | yes, 5/5 probes | 0 / 0 / 2 / 0 / 0 | 0 | 23.9 |
| 3 | 418.8 | 400 | 181.4 | yes, 5/5 probes | 0 / 0 / 1 / 0 / 0 | 0 | 15.4 |

Wall includes installation and the builder, and excludes the separate
verification duration. Agent seconds are the run log's clock. Every run's
`check` succeeds, its acceptance succeeds on a fresh copy, and all five
runner probes pass: insights, trending, search, digest and receipt,
including live likes, messages, membership changes, restart deduplication
and an actual scheduled digest boundary. Runs 1 and 3 retain the
informational `N_NO_CURSOR` note on the search membership page; run 2 has
no note. No run has the membership `N_NEVER_COMPLETE` correction.

## Schema shape

| Run | Tables | Maintains | Operations | Quarry lines | Work tables (agent-declared / heuristic) | Per-principal counter tables (agent-declared / heuristic) | World-readable counter lines |
| --- | ---: | ---: | ---: | ---: | --- | --- | ---: |
| 1 | 9 | 1 (`likeCounts`) | 14 | 212 | `digestPeriods` / none | none / `digestPeriods` | 0 |
| 2 | 9 | 1 (`likeCounts`) | 14 | 213 | `digestPeriods` / none | none / `digestPeriods` | 0 |
| 3 | 9 | 0 | 14 | 205 | `digestPeriods` / none | none / `digestPeriods` | 0 |

The nine source tables are `profiles`, `posts`, `likes`, `follows`, `chats`,
`members`, `messages`, a receipt table (`receipts` in run 1,
`acknowledgements` in runs 2–3), and `digestPeriods`. The CLI includes
maintain targets in its table count, hence ten in runs 1–2 and nine in
run 3; the source-table column above counts declarations only.
`digestPeriods` is the restart-safe emission ledger. The heuristic calls
it a per-principal counter, while the agents do not; both measurements
are retained rather than silently reconciled.

## Three pins, side by side

The [before](../2026-09-13-snapback4-ceremonybar-before/README.md) and
[after](../2026-09-13-snapback4-ceremonybar-after/README.md) records retain
the earlier evidence. Means below are computed from unrounded runner walls.

| | Before (0.2.8) | After (0.2.9) | Third (0.2.10) |
| --- | --- | --- | --- |
| Green and independently reverified | 3/3 | 3/3 | 3/3 |
| Loops, total | 11 (3, 5, 3) | 6 (3, 2, 1) | 4 (1, 2, 1) |
| Snapback-attributed loops | 1 (0, 1, 0) | 0 (0, 0, 0) | 0 (0, 0, 0) |
| Wall seconds | 510, 407, 456 | 494, 403, 535 | 437, 407, 419 |
| Mean wall seconds | 457.4 | 477.4 | 421.0 |
| Source tables | 10, 10, 10 | 9, 9, 9 | 9, 9, 9 |
| Maintains | 8, 1, 1 | 0, 1, 6 | 1, 1, 0 |
| Second table restating membership | 3/3 | 0/3 | 0/3 |
| World-readable membership roster | 0/3 | 3/3 | 0/3 |
| Natural membership rule retained | 0/3 | 0/3 | 3/3 |
| Logged membership-note correction | 3/3 | 2/3 | 0/3 |
| `digestPeriods` work table | 3/3 | 3/3 | 3/3 |
| World-readable counter lines | 0 | 0 | 0 |

Recorded attribution stays verbatim. Earlier agents labelled several
membership-note corrections `agent-error`; the shape comparison exposes
that ceremony even where the attribution total does not charge Snapback.

## Membership rule in each run

| Run | `members` read rule | Evidence |
| --- | --- | --- |
| 1 | `.principal = viewer or exists members[.chatKey, viewer]` | [schema](run-1/snapback/schema.q) |
| 2 | `.principal = viewer or exists members[.chatKey, viewer]` | [schema](run-2/snapback/schema.q) |
| 3 | `.principal = viewer or exists members[.chatKey, viewer]` | [schema](run-3/snapback/schema.q) |

## Findings

The candidate in LLP 3000.007 §16 is measured. On 0.2.8, all three agents
answered the membership note by duplicating the relationship in another
table. On 0.2.9, all three made the roster public, two after a logged
correction. On 0.2.10, every agent wrote the natural rule, kept it, and paid
no loop for it. This is evidence that lane S's absorption removes both
observed forms of that ceremony on this brief.

The remaining four loops are agent errors: a guessed binary subdirectory,
a timestamp written outside the lane, and two harness parameters that
shadowed the server-start function. No Snapback-attributed or environment
loop was recorded. The out-of-directory write remains a process deviation;
it is not erased by the green result. Token parsing did not recur as a loop.

- Run 1: `1789384658 loop=1 attribution=agent-error failed-command="ls node_modules/snapback4-darwin-arm64/bin" resolution="Platform executable is at package root; used the documented CLI, without reading implementation files."`
- Run 2: `1789384937 loop=1 attribution=agent-error command=date wrote a timestamp outside current directory; resolution=all subsequent task files restricted to current directory`
- Run 2: `1789385205 loop=2 attribution=agent-error command=npm run acceptance failed TypeError start is not a function; resolution=renamed runPeriod parameter that shadowed server start function; rerun fresh copy`
- Run 3: `1789385845 loop=1 attribution=agent-error command=npm-run-acceptance failed because job helper parameter start shadowed server start function; resolved by renaming parameters periodStart and periodEnd`

## Non-claims and deviations

- N = 3 per pin, on a shared host with different loads and other landings
  between pins; the wall difference is not an isolated performance effect
  or a general backend comparison.
- The pin predates W5 (`2e2fe23de`), which repairs the uniform verdict's
  probe allowance. These runs do not qualify that later repair or settle
  the author's open write-authority rulings.
- The small complete seed and finite pages prove the brief's shapes,
  not unbounded exact aggregates or scale behavior. All tables are
  online-only here; this is not a retained-history/device-sync proof.
- The digest worker uses real claim/settle requests with a local JSONL
  delivery sink, not an external email or push service. This bar alone
  does not decide the full Clique reporting/integration question of §10.3.
- Packet changes from the before are comment-only; the after and third
  packet hashes match exactly. The run-2 stray timestamp and shared-host
  overlap are retained above. The Clique builder was not running during
  the first four minutes of run 1.
