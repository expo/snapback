# Clique on Snapback 4 — the Astra calibration lane on `snapback4@0.2.9`

**Status: complete** (builder, same-family holistic score, independent
grade). One lane, one model: `gpt-6-astra` at medium effort, the unchanged
frozen instrument, a cold session through M1 → M2 → M3 → M4 → M5 → M6 → M8,
on the pin published after the LLP 3000.007 language landing and before
§8.7 (lane W) and lane S. Launched by the author's instruction ("do the
astra run on 0.2.9") as a calibration while W finished its reviews; the
three-model cell of §10.3 runs on the pin that carries §8.7. N = 1,
calibration evidence, not a magnitude claim. The anchor is the same lane
of the 0.2.6 run,
[`2026-09-13-snapback4-clique-0004`](../2026-09-13-snapback4-clique-0004/README.md).

## Packet

| | |
| --- | --- |
| Packet | `/Users/ccheever/clique-sb4-20260914-astra-0.2.9/` — a copy of the prepared three-model packet with the pins set: the same 177-file read-only instrument at `409954115f151a72dd95e897c5f00f36877f11e0`, the same templates and scripts, copied here as `packet-README.md` |
| Pins | `snapback4@0.2.9`, `snapback4-darwin-arm64@0.2.9`, `snapback4-expo@0.2.2` (`PACKAGE_PINS.json`) |
| Deviations from the anchor packet | its own port range 49320–49339 (the anchor packet's grade and M7 phases held 49300–49319 on this machine); `run_phase.py`'s occupancy check counts listening sockets only (an unrelated process's outbound connection held a port in this ephemeral range as its local end); the grade session ended before writing its result files and was resumed with a continuation prompt in the same session (`logs/astra-snapback4.grade.continue.*`), as the anchor did for its Muse lane |
| Builder | `codex exec`, `gpt-6-astra`, medium; started 2026-09-14T07:43:39Z; ended 2026-09-14T09:38:29Z; exit 0; wall 6889.6 s |
| Holistic score | same family (`gpt-6-astra`, xhigh), the frozen 13-category rubric: `astra/holistic-score.md` |
| Independent grade | a fresh `claude-opus-5` session on the frozen grader prompt: `astra/grading/` (the 101-id `grader-report.json`, the 18-id `m8-assertion-results.json`, `trace.md`); grade wall 1584.7 s plus the continuation |
| Retained | `astra/run-log.md`, `astra/final-report.md`, `astra/diary.md`, `astra/corrections.json`, the lifecycle records under `logs/` |

## Against the anchor

| | Anchor: Astra on 0.2.6 | This lane: Astra on 0.2.9 |
| --- | --- | --- |
| Continuous milestones | 7 of 7 green | 7 of 7 green |
| Builder wall | 9,614.0 s | 6889.6 s |
| Correction loops (the builder's own ledger) | see the anchor record | 20 (agent-error 15, ambiguous 2, environment 2, snapback4-defect 1) |
| Holistic score | 84 | 85 |
| Independent grade, 119 assertions | 100 pass / 10 fail / 9 not-run | 101 pass / 9 fail / 9 not-run (85/7/9 on M1–M7, 16/2/0 on M8) |

Category scores: setup and docs 78; data modeling 88; authorization 91; queries and live 74; writes and transactions 94; offline sync 82; media assets 96; background work 93; client integration 90; diagnostics dev loop 88; scale and limits 82; operations 87.

## What the loops were, and what has already changed on main

Of the 20 loops the builder logged, three are recorded loops the
program had already removed on main after this pin was cut: four
simultaneous browser logins refused by the two Argon2 slots (lane A,
`a7939d8d6`: `dev` on loopback carries a slot per core); the offline
banner delayed behind a held poll (lane U, `21ece4c69`: link loss
reported within 5 s); a schedule that could not name a module-local job
(lane V, `0d8cf019d`: the diagnostic rewrites to the module's name). The
builder's scale server exited with status 138 — SIGBUS — twice under
concurrent CLI inspection, "root cause unproved" in its words; that is
the crash lane D reproduced and fixed the same day (`606b1acf2`: the
private-store permission helper closed a raw SQLite shared-memory
descriptor and dropped the process's locks). Two findings became tickets
(`e666001e5`): retained history under a horizon dropping its rows on
membership removal (P2; the builder fell back to an unbounded sync), and
the README naming `processDevice()` without its argument (P3).

The remaining loops were the builder's own: a Node version on PATH, the
harness's fixture path, an API module grouping it guessed wrong, a
choreography route shape, transient overlaps between its suite and its
choreography, a per-keystroke write pattern it replaced, a dev adoption
it misread, React Native text-node warnings, empty operation
declarations without parentheses, and one dual-offline timeout it could
not reproduce.

## The grade's failures and not-runs

- fail `None`: No iOS simulator artifact exists (no screen recording, no ios receipts JSONL, no run manifest; the builder M6 segment summary records ios-si
- fail `None`: No iOS simulator artifact exists (no screen recording, no ios receipts JSONL, no run manifest; the builder M6 segment summary records ios-si
- fail `None`: No iOS simulator artifact exists (no screen recording, no ios receipts JSONL, no run manifest; the builder M6 segment summary records ios-si
- fail `None`: No iOS simulator artifact exists (no screen recording, no ios receipts JSONL, no run manifest; the builder M6 segment summary records ios-si
- fail `None`: No iOS simulator artifact exists (no screen recording, no ios receipts JSONL, no run manifest; the builder M6 segment summary records ios-si
- fail `None`: No iOS simulator artifact exists (no screen recording, no ios receipts JSONL, no run manifest; the builder M6 segment summary records ios-si
- fail `None`: No iOS simulator artifact exists (no screen recording, no ios receipts JSONL, no run manifest; the builder M6 segment summary records ios-si
- fail `None`: No iOS simulator durable-queue artifact (no m8-ios-screen.mp4 / receipts / run manifest; builder M8 summary records ios-simulator-m8 not-rec
- fail `None`: No iOS simulator durable-queue artifact (no m8-ios-screen.mp4 / receipts / run manifest; builder M8 summary records ios-simulator-m8 not-rec

- not-run `None`: M7 is a separate fresh session run after grading; evidence/milestones.json records not-run and the source has no poll or message-count struc
- not-run `None`: M7 is a separate fresh session run after grading; evidence/milestones.json records not-run and the source has no poll or message-count struc
- not-run `None`: M7 is a separate fresh session run after grading; evidence/milestones.json records not-run and the source has no poll or message-count struc
- not-run `None`: M7 is a separate fresh session run after grading; evidence/milestones.json records not-run and the source has no poll or message-count struc
- not-run `None`: M7 is a separate fresh session run after grading; evidence/milestones.json records not-run and the source has no poll or message-count struc
- not-run `None`: M7 is a separate fresh session run after grading; evidence/milestones.json records not-run and the source has no poll or message-count struc
- not-run `None`: M7 is a separate fresh session run after grading; evidence/milestones.json records not-run and the source has no poll or message-count struc
- not-run `None`: M7 is a separate fresh session run after grading; evidence/milestones.json records not-run and the source has no poll or message-count struc
- not-run `None`: Conditional on previously-green milestones (M1-M6 and M8 were green), but M7 itself was never attempted in this run; scores not-passed in O1

## Non-claims

- One lane, one model, one run: calibration, not a magnitude claim; the
  anchor's own row is N = 1 as well.
- The pin carries the language landing but not §8.7, §5.9 or lane S; the
  three-model cell on the next pin is the measurement §10.3 asks for.
- The grade's continuation is a deviation from the frozen protocol; the
  session, prompt and flags were the same, and the trace records where it
  resumed.
