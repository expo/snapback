# The loop bar on Snapback 4 — fresh Astra agents on the published pins

**Status: complete.** The bar is met on `snapback4@0.0.11`: three of three fresh agents green in 443–537 s with no Snapback-attributed correction loop, every proof verified independently. The loop bar (LLP 3000 §3;
`rules/NOT-DOING.md` "The bars"): a fresh agent, with only the installed
package and the task, builds the reduced Clique M1–M3 (accounts and
profiles, posts and the follow graph, messaging core; React web; no media)
on the published package in under 1,200 s with at most one
Snapback-attributed correction loop, N ≥ 3.

| | |
| --- | --- |
| Brief | `snapback4/loopbar/brief.md` (the four-part proof: `check` clean, a fixture under `snapback4 test`, an HTTP acceptance script, a build) |
| Runner | `snapback4/loopbar/run.mjs`: serial codex `exec` sessions, `gpt-6-astra` at medium, each verified independently after it stops (`check`, the fixture test with every persona, the acceptance script, with the agent's own servers stopped and its dev stores dropped first); one line per run in `snapback4/metrics/loopbar.jsonl`; lanes under `~/loopbar-sb4-2026-09-12{,-b,-c,-d}/` |
| Host | the same Apple M5 Max as the Clique lane, which ran throughout; wall clocks are as measured |
| Evidence level | N=3 per pin; calibration, not a claim-eligible magnitude |

## Runs

Wall seconds are the runner's clock from launch to the agent's exit; the
agent's own clock (`start=`/`green=` in its run log) is shorter. Loops are
the agent's own attributions in its run log.

| Set | Pin | Run | Wall s | Snapback loops | Verified | Bar | What the loops were |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | 0.0.4 | 1 | 433 | 1 | yes | **met** | `conversationId ?? 'dm1'` after an optional reference scanned nothing (fixed 0.0.5) |
| A | 0.0.4 | 2 | 572 | 2 | yes | no | the same, and a cursorless merge page over 28 rows reading `complete: true` (fixed 0.0.6) |
| A | 0.0.4 | 3 | 567 | 2 | yes | no | the same two |
| B | 0.0.6 | 1 | 499 | 3 | yes | no | one defect three ways: a merged feed with a cursor could not continue when one lane filled the page (fixed 0.0.8) |
| B | 0.0.6 | 2 | 765 | 0 | yes | **met** | — |
| B | 0.0.6 | 3 | 420 | 2 | the fixture check refused a derived argument for one persona; green by the agent's proof | no | `dev --fresh` read from a newer README than the pin (0.0.9 added it); a pagination investigation the agent closed as correct |
| C | 0.0.8 | 1 | 366 | 0 | yes (on a second look, after stopping the agent's leftover server and dropping its dev store) | **met** | — |
| C | 0.0.8 | 2 | 592 | 2 | yes | no | `dev --fresh` from the registry README again (absent on 0.0.8) |
| C | 0.0.8 | 3 | 472 | 0 | yes | **met** | — |
| D | 0.0.11 | 1 | 537 | 0 | yes | **met** | — (the brief now names the installed README) |
| D | 0.0.11 | 2 | 443 | 0 | yes | **met** | — |
| D | 0.0.11 | 3 | 535 | 0 | yes | **met** | the agent first blamed a rejected merge cursor on the package, then retracted it as its own error (it had put the outer cursor on the inner lanes); the runner's count now ignores retracted attributions |

Every one of twelve runs went green inside 1,200 s (366–765 s). On the
pins before the fixes, four of nine met the bar on the loop count; every
counted loop was a defect or a docs mismatch fixed on main the same day
(0.0.5 through 0.0.13), and the `tests/loopbar.rs` cases hold them. On
0.0.11 all three met it.

## Docs gaps the agents named

`observe`'s shape (README, 0.0.6); the fixture test skipping queries with
required arguments (derived arguments, 0.0.5); the dev store persisting
between acceptance runs (`dev --fresh`, 0.0.9/0.0.10); a program's own
`require` on a derived argument counted as a failure (0.0.11).
