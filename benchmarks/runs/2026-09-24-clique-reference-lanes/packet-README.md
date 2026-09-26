# Clique reference lanes — Convex, Supabase and Snapback 4 on the current brief

**Created:** see `CREATED_AT`. **Instrument:** repository commit in `INSTRUMENT_COMMIT`
(the same frozen instrument as calibration #19, byte-for-byte except this run's
`ENVIRONMENT.md` overlay, which says three lanes share the host per wave and that
token accounting is null where the harness does not expose it). **Pins:**
`PACKAGE_PINS.json` — snapback4@0.4.0 / snapback4-expo@0.4.0 (the published
release calibration #19 measured), convex@1.46.0 (latest published, anonymous/local),
@supabase/supabase-js@2.117.1 (latest published) against the hosted `clique-pilot`
project with lane-private `provider-secrets.env` and per-wave namespace prefixes
(`clqra_` for the Astra wave, `clqro_` for the Opus wave).

Commissioned by Charlie Cheever 2026-09-24 for LLP 4000 §9: "run convex, supabase,
and latest snapback4 with astra medium and also opus 5.5 high." Purpose: the
reference clock. The incumbents were last clocked on this brief text on 2026-09-05
(Astra medium: Supabase M8 first green at 110.5 min cumulative, Convex about 94 min by
LLP 3000.007 §2.1; Snapback 4 0.4.0 reached M8 first green at 54 min on 2026-09-24),
but in a different week, on an older instrument (commit f40559f3), beside Snapback 2,
so the protocol's same-machine rule does not admit that comparison. This packet reruns
the incumbents with current pins, on calibration #19's instrument, on #19's host, with
a Snapback 4 lane beside them under the same load, and adds a second builder family. This packet creates that comparison
under the protocol's same-host, same-week rule: every lane runs on the black M5 Max,
the host calibration #19 ran on.

## Waves

Two waves, run one at a time so the three backends of a wave share the machine
under the same load, and so the hosted Supabase project and Convex's local ports are
never contended across waves. Within a wave the three lanes run in parallel.

| Wave | Harness | Model / effort | Lanes | Ports |
|---|---|---|---|---|
| astra | codex-cli `exec` | gpt-6-astra / medium | snapback4, convex, supabase | 49500–49519, 49600–49619, 49700–49719 |
| opus | claude `-p` | claude-opus-5-5 / high | same | 49200–49219, 49300–49319, 49400–49419 |

Per lane: `lanes/<wave>-<backend>/` (the app, `run-log.md`, `diary.md`, `essay.md`,
`final-report.md`, choreography receipts, native artifacts);
`logs/<wave>-<backend>.{ndjson,stderr.log,pid,start.json,end.json}`;
`prompts/<wave>-<backend>.md` rendered by `scripts/render.py` from
`prompts/template.md` (calibration #19's builder template, unchanged; the platform
paragraphs for Convex and Supabase are the September 5 three-backend run's, with the
pins and prefixes updated).

## Phases per wave

1. **Continuous session** M1 → M2 → M3 → M4 → M5 → M6 → M8, one cold session per lane:
   `nohup python3 scripts/run_phase.py builder <wave> <backend> &`.
2. **Grading**: one independent grader for every lane, `claude-opus-5` on the frozen
   `instrument/grader/grader-prompt.md`, all 119 assertions (101 in the schema-bound
   report plus the 18 M8 results beside it): `run_phase.py grade <wave> <backend>`.
   For the Opus wave the grader is the same family as the builder; the record says so
   (`sameFamilyGraded`), and one grader for all six lanes keeps the pass counts
   comparable, which is what the bar reads.
3. **Holistic score**: `gpt-6-astra` xhigh, read-only, from the lane's narrative files
   only: `run_phase.py score <wave> <backend>`. The score is the floor in LLP 4000 §9,
   not the target; for the Astra wave it is same-family, as in every calibration.
4. **Record**: `benchmarks/runs/2026-09-24-clique-reference-lanes/` in the repository,
   with per-lane wall (start to end, and M8 first green from `final-report.md`), the
   119-assertion grade, and the scores. M7 is not run.

## What is compared

Under LLP 4000 §9: time to first green on the milestones all three backends attempt
(reported for the whole brief too), the independent grade's pass count and coverage
honesty, then the holistic score. On 2026-09-05 Supabase went green on M6 and M8 and
passed 13/13 M6 assertions and Convex reached its own M6/M8 greens (6/13 on M6), so the
incumbents do attempt the offline milestones; how far each gets is what the grade records.
Wall clocks are compared within a wave only (same host, same load); across the two
waves the builders differ, so only the backend ordering is read, never the minutes.

N=1 per (builder, backend) cell. A reference, not a claim-eligible magnitude.

## Protocol deviation, recorded before any result

`benchmarks/protocol.md` rule 5 says every lane of a comparison set runs
**serially** on the same machine. This packet runs the three lanes of a wave in
parallel, as the September 5 three-backend run did, so that all three backends see
the same host load at the same time and the whole comparison fits in one day. The
cost is contention: absolute wall clocks are inflated for every lane of the wave.
The reading that survives is the within-wave ordering and ratio, not the minutes,
and no cross-wave minute comparison is made. Load samples are in `host-load.jsonl`.
If a serial rerun is wanted for a claim-eligible record, this packet's prompts and
scripts are the frozen inputs for it.

## Ports and processes

Only the ranges above belong to this packet. Each phase is launched under nohup with
recorded PIDs; stop only recorded owned listeners. `scripts/host-load.sh` samples
`uptime` every 60 s into `host-load.jsonl` for the life of the packet.

## Deviation 2 (2026-09-25): the Opus Supabase builder was terminated by the harness

The `opus-supabase` builder (`claude -p`, pid 34188, started 2026-09-25T00:08:13Z) was a child of the orchestrating Claude Code session and died when that session ended at about 10:03Z, after roughly eleven hours, past its M8 green but before `final-report.md`. There is no `end.json`; `logs/opus-supabase.terminated.json` records the facts. The lane is **incomplete and not graded or scored**; it is not rerun because a rerun would not be a cold lane and would cost 6–11 hours. Its per-milestone first-green clocks remain recoverable from `logs/opus-supabase.ndjson`. The six-lane record therefore has five complete lanes; the Astra Supabase lane is the only complete Supabase lane.
