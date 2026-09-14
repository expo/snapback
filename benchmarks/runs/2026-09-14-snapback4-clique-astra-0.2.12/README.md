# Clique on Snapback 4 — the Astra calibration lane on `snapback4@0.2.12`

**Status: complete.** The run had a builder, a holistic score from the same
model family, and an independent grade. It is one lane with one model,
`gpt-6-astra` at medium effort, on the unchanged frozen instrument, in a
cold session through M1 → M2 → M3 → M4 → M5 → M6 → M8. The pin carries LLP
3000.007 §18, the catch-up landing for the 0.2.9 calibration's findings. It
asks whether the three categories the 0.2.9 lane lost moved. N = 1, the
scorer is the builder's own family, and the comparison is across runs: a
gap of a few points is inside the noise. The previous calibration is
[`2026-09-14-snapback4-clique-astra-0.2.9`](../2026-09-14-snapback4-clique-astra-0.2.9/README.md).

## Packet

| | |
| --- | --- |
| Packet | `/Users/ccheever/clique-sb4-20260914-astra-0.2.11/` (prepared for 0.2.11, a number another session published first; the directory name stays). It is a copy of the 0.2.9 calibration packet: the same 177-file read-only instrument at `409954115f151a72dd95e897c5f00f36877f11e0`, the same templates and scripts. Its README is copied here as `packet-README.md` |
| Pins | `snapback4@0.2.12`, `snapback4-darwin-arm64@0.2.12`, `snapback4-expo@0.2.4` (`PACKAGE_PINS.json`, `REGISTRY_RECEIPTS.json`). Landed as main `a5ef8da61`, published 16:54–16:57 UTC |
| Ports | 49360–49379. `render.py`, `verify.py` and `run_phase.py` were edited for that range only, because the 0.2.10 three-model cell held 49340–49359 on this machine |
| Attempt 1 (unscored) | The builder aborted at M1 after 777 s: the frozen choreography's `../../lib/json-schema.mjs` does not resolve from a lane copy. The 0.2.9 and 0.2.10 Astra builders each supplied the file themselves and logged the workaround as environment; this builder recorded M1 aborted instead. See `attempt-1/WHY.md` |
| Deviation from the 0.2.9 packet | `lanes/lib/json-schema.mjs` is a byte copy of the packet's own `lib/json-schema.mjs` (sha256 `7b882f61…`), so the frozen import resolves. No check, prompt, template or instrument file changed |
| Builder | `codex exec`, `gpt-6-astra`, medium; started 2026-09-14T17:45:27Z; ended 19:16:05Z; exit 0; wall 5,437.6 s |
| Holistic score | Same family (`gpt-6-astra`, xhigh), the frozen 13-category rubric: `astra/holistic-score.md` |
| Independent grade | A fresh `claude-opus-5` session on the frozen grader prompt: `astra/grading/` (the 101-id `grader-report.json`, the 18-id `m8-assertion-results.json`, `trace.md`); grade wall 2,092.4 s, with no continuation |
| Retained | `astra/run-log.md`, `final-report.md`, `diary.md`, `essay.md`, `corrections.json`, and the lifecycle records under `logs/` |

## Against the 0.2.9 calibration

| | Astra on 0.2.9 | Astra on 0.2.12 |
| --- | --- | --- |
| Continuous milestones | 7 of 7 green | 7 of 7 green |
| Builder wall | 6,889.6 s | 5,437.6 s |
| Correction loops (the builder's own ledger) | 20 (agent-error 15, ambiguous 2, environment 2, snapback4-defect 1) | 13 (agent-error 10, ambiguous 1, snapback4-defect 2) |
| Holistic score | 85 | 86 |
| Independent grade, 119 assertions | 101 pass / 9 fail / 9 not-run | 101 pass / 0 fail / 18 not-run (85/0/16 on M1–M7, 16/0/2 on M8) |

The grade's pass count is unchanged. The nine iOS-simulator assertions
(m6-a01–a07, m8-a17–a18) were graded `fail` on 0.2.9 and `not-run` on
0.2.12, with the same evidence: no simulator artifact in either run. That
is a grader classification difference, not a change in what was built.

| Category | 0.2.9 | 0.2.12 | Convex / Supabase (Sept 5) |
| --- | ---: | ---: | --- |
| Overall | 85 | 86 | 84 / 77 |
| setup_and_docs | 78 | 79 | 83 / 85 |
| data_modeling | 88 | 89 | 88 / 94 |
| authorization | 91 | 94 | |
| queries_and_live | 74 | 80 | 87 / — |
| writes_and_transactions | 94 | 94 | |
| offline_sync | 82 | 90 | |
| media_assets | 96 | 97 | |
| background_work | 93 | 88 | |
| client_integration | 90 | 91 | |
| diagnostics_dev_loop | 88 | 78 | |
| scale_and_limits | 82 | 86 | |
| operations | 87 | 87 | |

The Convex and Supabase numbers are the September 5 Astra-scored cells
that §18 named as targets (a dash is a category §18 did not compare); the
scorer sessions differ, and every cell is N = 1.

## What moved, and why

Every finding the scorer charged on 0.2.9 is absent from its 0.2.12 notes:
`processDevice()` without its signature, retained history lost under a
horizon, server search that is never complete, and the adoption refusal
behind a green `check`. The builder's run log records none of them as a
loop. On 0.2.9 it had called the raw search endpoint untrustworthy; on
0.2.12 its offline search, retained departed-member history and additive
schema evolution ("Additive schema evolution preserved the existing
messages without a migration script") all appear as strengths.

The scorer instead charged two different Snapback-attributed loops, and
they account for most of the remaining deficit:

- **Presence recipe against prediction (M6).** The presence card says the
  device treats everyone as connected, but the binder classifies a
  mutation that reads `connected[...]` as never predicting. It is charged
  in setup_and_docs, offline_sync, background_work and
  diagnostics_dev_loop. This is the same contradiction the 0.2.10 builder
  hit, and it is now on `issues/20260914-snapback4-guide-gap-presence-prediction-contradicts-residency.md`.
- **A helper's early `return` drops the page cursor (M8).** A shape
  calling a helper that returns early made a 10,000-message history return
  `next: null`, `complete: true`. It is charged in queries_and_live and
  diagnostics_dev_loop. The lead reproduced it in 12 rows on the published
  binary: `issues/20260914-snapback4-helper-early-return-drops-page-cursor.md`
  (P1).

The builder also recorded that its own strict search midpoint gate
failed: 2.397 ms against a 2.185 ms bound at 50%. The full-to-10% ratio
passed (1.312×), as did every other scale probe: page 50 against page 1,
following 500 against following 5, the celebrity read and write, the
busy-group send, a cold 100-conversation replica in 634 ms, insights and
trending. 167,243 scale actions settled in 184 s, and the persisted state
verified exactly at 10%, 50% and the end.

## The grade

M1–M5 pass in full, as do M6's six non-simulator assertions and M8's
sixteen. M7 is not run by design. The grader's defects are in the
builder's application, not the backend:

- Two major: a sign-up with a taken handle orphans the auth account, and
  in-chat search is reachable only for the fixture conversation.
- Three minor:
  - The group picker pre-fills a fixture persona.
  - Every DM is named "Direct message".
  - At scale, a read-time filter over the global feed index hits the row
    meter and returns short `complete: false` pages. The completeness word
    is honest, but it costs extra pages.
- One cosmetic: raw engine text for a duplicate handle.

## Non-claims

- One lane, one model, one run: calibration, not a magnitude claim. The
  scorer is the builder's family; the grader is not.
- The 0.2.10 three-model cell
  (`/Users/ccheever/clique-sb4-20260913-relaxed-3models/`) had no scores
  when this record was written; its Muse builder was still running.
- Attempt 1 is excluded from every number above and kept in full under
  `attempt-1/`. The packet fix gives the builder a file the two earlier
  builders had to supply themselves. That removes an environment loop they
  paid; it does not touch any Snapback surface.
- The builder's search midpoint miss is its own strict gate, not the
  hidden O5 probes.
