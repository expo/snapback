# The ceremony bar — "after", on `snapback4@0.2.9`

**Status: complete.** Three serial runs of the ceremony bar (LLP 3000.007
§10.3) on the pin published after the language landing — every lane of the
LLP 3000.007 program but W (§8.7/§5.9, in its second blind pass) and S
(§16, landed after this pin). Each run went green, was independently
reverified, and stayed inside the loop bar's envelope (≤ 1,200 s wall, ≤ 1
Snapback-attributed loop). The "before" is
[`2026-09-13-snapback4-ceremonybar-before`](../2026-09-13-snapback4-ceremonybar-before/README.md)
on 0.2.8. N = 3 each side, calibration, not a magnitude claim.

## Packet

| | |
| --- | --- |
| Instrument | `snapback4/loopbar/ceremony-brief.md` and `ceremony.mjs` with `ceremony-{metrics,probes,process}.mjs`; the brief, the probes and the process helper hash identically to the "before" (`runner-result.json` → `packet`); `ceremony.mjs` and `ceremony-metrics.mjs` differ from it only by the `@ref` anchor rewrite of `c82b22824` (two comment lines) |
| Pin | `snapback4@0.2.9`, `snapback4-darwin-arm64@0.2.9`; binary SHA-256 `6550376e…`, README SHA-256 `aa026f23…`; the pin unchanged after every run |
| Agent | `~/.volta/bin/codex exec`, `gpt-6-astra`, reasoning effort medium; the brief as the whole prompt; the installed package, its README, `npx snapback4 guide` and `why` as the whole packet — as before |
| Runner | serial; install → agent (≤ 1,800 s) → independent reverification on fresh copies (`check`, the agent's acceptance, the runner's wire probes) → schema-shape measurement; lines 4–6 of `snapback4/metrics/ceremonybar.jsonl` |
| Host | Apple M5 Max, 18 cores, macOS; shared and loaded: run 1 started under the 0.2.9 publish chain's xcframework build and two Codex lanes (load 31.8), runs 2 and 3 under the lanes and the blind reviewers (14.9, 19.9) |
| Launched from | the lead's shell, by the publish chain, the moment npm served 0.2.9 (`node loopbar/ceremony.mjs --n 3 --version 0.2.9`) |
| Retained | `run-{1,2,3}/`: `runner-result.json`, the agent's `run-log.md` and `final-report.md`, its `snapback/*.q`; `runner.log` |

## Runs

| Run | Wall s | Agent s | Verify s | Green | Loops by attribution (snapback4-defect / docs / agent / env / ambiguous) | Snapback-attributed | Load at start |
| --- | ---: | ---: | ---: | --- | --- | ---: | --- |
| 1 | 494.5 | 470 | 151.1 | yes, 5/5 probes | 0 / 0 / 3 / 0 / 0 | 0 | 31.8 |
| 2 | 403.1 | 382 | 196.9 | yes, 5/5 probes | 0 / 0 / 2 / 0 / 0 | 0 | 14.9 |
| 3 | 534.7 | 512 | 184.7 | yes, 5/5 probes | 0 / 0 / 1 / 0 / 0 | 0 | 19.9 |

Every run: `check` clean, the agent's acceptance green on a fresh copy,
and all five wire probes green (insights, trending, search, digest,
receipt), including the probes' own like, message and membership changes.

## Schema shape

| Run | Tables | Maintains | Operations | Quarry lines | Work tables (agent-declared / heuristic) | Per-principal counter tables (agent-declared / heuristic) | World-readable counter lines |
| --- | ---: | ---: | ---: | ---: | --- | --- | ---: |
| 1 | 9 | 0 | 14 | 221 | `digestPeriods` / none | none / `digestPeriods` | 0 |
| 2 | 9 | 1 (`likeCounts`) | 14 | 214 | `digestPeriods` / none | none / `digestPeriods` | 0 |
| 3 | 9 | 6 (`authored`, `targeted`, `postLikes`, `receivedLikes`, `followers`, `following`) | 14 | 216 | `digestPeriods` / none | `authored`, `targeted`, `receivedLikes`, `followers`, `following` / `digestPeriods` | 0 |

Table names per run: run 1: `profiles`, `posts`, `likes`, `follows`, `chats`, `members`, `messages`, `acknowledgements`, `digestPeriods`; run 2: `profiles`, `posts`, `likes`, `follows`, `chats`, `members`, `messages`, `acknowledgements`, `digestPeriods`; run 3: `profiles`, `posts`, `likes`, `follows`, `chats`, `members`, `messages`, `acknowledgments`, `digestPeriods`

## Before and after, side by side

| | Before (0.2.8) | After (0.2.9) |
| --- | --- | --- |
| Loops, total over three runs | 11 (3, 5, 3) | 6 (3, 2, 1) |
| Snapback-attributed loops | 1 (0, 1, 0) | 0 (0, 0, 0) |
| Wall, s | 510, 407, 456 (mean 458) | 494, 403, 535 (mean 477) |
| Tables | 10, 10, 10 | 9, 9, 9 |
| Maintains | 8, 1, 1 | 0, 1, 6 |
| A second table restating membership | 3 of 3 (`userChats`, `userChats`, `chatLinks`) | 0 of 3 |
| A world-readable membership roster | 0 of 3 | 3 of 3 |
| Work table (`digestPeriods`) | 3 of 3 | 3 of 3 |
| World-readable counter lines | 0 | 0 |
| The `N_NEVER_COMPLETE` loop on the membership rule | 3 of 3 | 2 of 3 |

The loops are the number the bar is for: eleven became six, the one
Snapback-attributed loop became none, and the wall clocks are the same
within the noise of a heavier host. The tenth table is gone from every
run. What replaced it is the finding below.

## Findings

- **The membership note moved the agents from a restatement to a
  disclosure.** Every "before" agent answered `N_NEVER_COMPLETE` on the
  chat-pinned roster scan with a second private table keyed the other
  way. Every "after" agent answered it by making the roster public
  ("explicit public roster policy so both principal and chat scans are
  uniform"; "declared the membership roster directory public, making
  scans uniform"; run 3 chose it without logging a loop: "membership
  identities form an intentionally public directory"). Nine tables
  instead of ten, and a membership relationship any signed-in principal
  can enumerate — on the brief's seed a harmless choice, on a product a
  worse one than the duplicate. The note was wrong both times: the
  natural rule, `.principal = viewer or exists members[.chat, viewer]`,
  is uniform over a chat-pinned prefix because the row is its own
  witness on the unique key (LLP 3000.007 §16). Lane S landed that
  absorption on main at `30cf4ce80`, after this pin; the next pin gets
  the bar a third time, and the column to watch is the roster's rule.
- **`snapback4 token` cost a loop again** (run 1: "worker token parser
  mixed stdout and stderr and could choose prose instead of token"), the
  fourth time in six runs. The P3 ticket
  `issues/20260913-snapback4-token-prints-prose-with-the-token.md` is
  being fixed as lane T.
- Run 3 kept five per-principal counters (`authored`, `targeted`,
  `receivedLikes`, `followers`, `following`) private, with no loop and
  no world-readable line: on this brief the digest runs as the system
  principal, so the cross-principal counter shape of the Clique lanes
  does not arise, as before.
- The remaining loops were the agents' own: a missing index the type
  checker named (`E_QUARRY_UNKNOWN`), a report writer's template
  escaping, a stray write outside the lane directory.
- No Snapback defect, no timeout, no environment loop.

Loops, verbatim from each agent's run log:
- run 1, loop 1 (agent-error): loop=1 attribution=agent-error command="npx snapback4 check" found N_NEVER_COMPLETE on roster OR rule; resolved with explicit public roster policy so both principal and chat scans are uniform. Profiles made public to support target existence checks for follows.
- run 1, loop 2 (agent-error): loop=2 attribution=agent-error command="npm run acceptance" worker token parser mixed stdout and stderr and could choose prose instead of token; resolved by preserving separate streams and parsing stdout only
- run 1, loop 3 (agent-error): loop=3 attribution=agent-error command="node final-report generator" failed with SyntaxError from escaped backticks in template literal; resolved by writing the report with a Python multiline string
- run 2, loop 1 (agent-error): loop=1 attribution=agent-error failed="npx snapback4 check" missing chat key/admin authorization index; resolved by declaring byKeyAdmin. knowledge source=why E_QUARRY_UNKNOWN.
- run 2, loop 2 (agent-error): loop=2 attribution=agent-error failed="npx snapback4 check completeness review" OR-based membership read rule makes recipient scan never complete; resolved with explicitly public roster directory (message content remains membership-gated). knowledge source=diagnostic N_NEVER_COMPLETE and generated snapback/generated/api.ts.
- run 3, loop 1 (agent-error): loop=1 attribution=agent-error failed-command=initial-clock-write resolution=all-subsequent-work-confined-to-current-directory

## What the agents wrote

Run 1: "Membership rosters are explicitly public; message and
acknowledgement content remains private to current members." Run 2: "The
roster directory is intentionally public; this app does not promise
membership privacy." Run 3: "Membership identities form an intentionally
public directory; chat/message/acknowledgment contents remain
membership-protected. Per-principal counters are private; only the
public-post like counter is world-readable."

## Rerun

The bar runs a third time on the pin that carries lanes S and W, with
`--version <pin>`; the comparison is the same three columns, and the
roster's read rule in each run's `schema.q` is the sentence to read.
