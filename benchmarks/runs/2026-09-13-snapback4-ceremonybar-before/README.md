# The ceremony bar — "before", on `snapback4@0.2.8`

**Status: complete.** Three serial runs of the ceremony bar (LLP 3000.007
§10.3) on the published pin that predates every LLP 3000.007 landing.
Each run went green, was independently reverified, and stayed inside the
loop bar's envelope (≤ 1,200 s wall, ≤ 1 Snapback-attributed loop). This
is the "before"; the same instrument reruns on the pin published after
the language landing, and the difference is the number the RFC is judged
by. N = 3, calibration, not a magnitude claim.

## Packet

| | |
| --- | --- |
| Instrument | `snapback4/loopbar/ceremony-brief.md` and `ceremony.mjs` with `ceremony-{metrics,probes,process}.mjs` at `b8acd113f`; packet hashes in each `runner-result.json` |
| Pin | `snapback4@0.2.8`, `snapback4-darwin-arm64@0.2.8`; binary SHA-256 `92db0d86…`, README SHA-256 `eaa5d557…` (in `runner-result.json`); the pin unchanged after every run |
| Agent | `~/.volta/bin/codex exec`, `gpt-6-astra`, reasoning effort medium; the brief as the whole prompt; the installed package, its README, `npx snapback4 guide` and `why` as the whole packet |
| Runner | serial; install → agent (≤ 1,800 s) → independent reverification on fresh copies (`check`, the agent's acceptance, the runner's wire probes that change likes, messages and membership before re-querying) → schema-shape measurement; one line per run in `snapback4/metrics/ceremonybar.jsonl` |
| Host | Apple M5 Max, 18 cores, macOS; shared and loaded (five Codex lanes building concurrently): load average at each run's start below |
| Launched from | the lead's shell (`node loopbar/ceremony.mjs --n 3 --version 0.2.8`); the lane that authored the instrument could not run it, since a fresh-agent Codex cannot start inside Codex's sandbox |
| Retained | `run-{1,2,3}/`: `runner-result.json` (every number, the packet and pin hashes, the verification tails), the agent's `run-log.md` and `final-report.md`, and its `snapback/*.q`; `runner.log` |

## Runs

| Run | Wall s | Agent s | Verify s | Green | Loops by attribution (snapback4-defect / docs / agent / env / ambiguous) | Snapback-attributed | Load at start |
| --- | ---: | ---: | ---: | --- | --- | ---: | --- |
| 1 | 509.9 | 494 | 174.4 | yes, 5/5 probes | 0 / 0 / 3 / 0 / 0 | 0 | 14.6 |
| 2 | 406.8 | 384 | 193.0 | yes, 5/5 probes | 0 / 1 / 4 / 0 / 0 | 1 | 12.9 |
| 3 | 455.6 | 441 | 144.2 | yes, 5/5 probes | 0 / 0 / 3 / 0 / 0 | 0 | 14.9 |

Every run: `check` clean, the agent's acceptance green on a fresh copy,
and all five wire probes green (insights, trending, search, digest,
receipt), including the probes' own like, message and membership changes.

## Schema shape (what the bar exists to measure)

| Run | Tables | Maintains | Operations | Quarry lines | Work tables (agent-declared / heuristic) | Per-principal counter tables (agent-declared / heuristic) | World-readable counter lines |
| --- | ---: | ---: | ---: | ---: | --- | --- | ---: |
| 1 | 10 | 8 | 14 | 206 | `digestPeriods` / none | 7 maintains (`postCounts`, `postDays`, `receivedPosts`, `authorLikes`, `likeDays`, `followers`, `following`) / `digestPeriods` | 0 |
| 2 | 10 | 1 | 14 | 191 | none / none | none / `digestPeriods` | 0 |
| 3 | 10 | 1 | 14 | 203 | `digestPeriods` / none | none / `digestPeriods` | 0 |

Two designs appeared: run 1 maintained the Insights totals and day
buckets as seven maintains; runs 2 and 3 computed them by bounded scans
("queries scan at most 100 original posts and 100 messages per chat").
Every run kept a `digestPeriods` table as the digest's once-per-period
guard, which two agents declared a work table. No run made a counter
world-readable: the brief's digest is computed by the job as the system
principal, so the cross-principal counter shape that opened tables in the
Clique lanes does not arise here.

## Findings

- **Every run paid the same language loop.** Each agent's first `check`
  produced `N_NEVER_COMPLETE` on the membership scan behind the receipt
  aggregate and the chat directory ("membership rule mixed scopes"), and
  each resolved it the same way: a second, private table duplicating the
  membership relationship keyed by the other column (`userChats` in runs
  1 and 2, `chatLinks` in run 3), kept in step by the same mutations. Run
  1's own gap list says it: "the directory and roster duplicate the
  membership relationship to support complete private reads on both
  axes." A membership row read by the viewer's own principal is its own
  witness for a rule of the form `exists memberships[.chat, viewer]`; the
  compiler does not see that today. This is a candidate for the language
  work, not commissioned by this record.
- **`snapback4 token` cost two loops in one run** (one classified docs,
  the Snapback-attributed loop of run 2): the command's prose and the
  token share stdout, so a script capturing the token got the prose.
  Filed as `issues/20260913-snapback4-token-prints-prose-with-the-token.md`.
- The remaining loops were the agents' own: a shadowed parameter name, a
  stray write outside the lane directory, an acceptance timer, a report
  writer's template escaping, an optional-object equality the type checker
  refused.
- No Snapback defect, no timeout, no environment loop. The wall clocks
  ran under machine load 13–15 with five other Codex lanes building; the
  loops, not the seconds, are the comparison this bar is for.

## What the agents wrote

Run 1: "This is an online-only headless app … The directory and roster
duplicate the membership relationship … Digest emission guards persist
indefinitely." Run 2: "Bounded scans support the required complete
dataset and probe additions; substantially larger datasets require
pagination or another aggregate design." Run 3: "No known missing
requirement on the complete small seed. Reads are intentionally bounded
… growth beyond page limits can report incomplete rather than silently
promise complete."

## Rerun

The "after" runs the same command against the pin published after the
LLP 3000.007 language landing, with `--version <pin>`; the comparison is
loops by attribution, the schema-shape columns, and wall, in that order.
