# Diary 0113 — Clique on published 0.1.25, Sol high

Full-scope Clique run against the newly published Snapback 0.1.25 closure,
using `gpt-5.6-sol` at high effort. Explicit and Familiar each ran M1–M6/M8 in
one continuous session and M7 in a fresh session. The lanes ran serially on the
idle fleet machine `expo-build-450b` (Ryzen 5 3600, 125 GiB RAM). Consolidated
record:
`benchmarks/runs/2026-08-23-clique-published-0125-sol-high/record.md`.

## What shipped in the benchmark lanes

Both profiles reached web authoring-green for accounts/profiles, feeds,
messaging, media/reactions, ephemeral settings/search, offline/push seams,
Insights/multi-device behavior, and fresh-session poll/count evolution. The
frozen suites and required web choreography passed for M1–M6/M8. M7 has no
official harness segment, so its green is suite/intactness-backed; Explicit
also retained a clearly labeled 3/3 browser supplement.

The scale outcome split the profiles. Explicit completed all 167,157 actions
and reconciled every exact invariant after correcting one transport-retention
mistake. Familiar stopped honestly at 2,620 contiguous actions, before 10%,
because its adapter retained a growing synchronized public replica per actor.
That result is a useful failure record, not a backend impossibility claim: the
lane did not prove a bounded alternative adapter topology.

## What felt good

- The 0.1.25 served Guide was usually exact enough to unblock unfamiliar
  surfaces. Familiar M7 found the reviewed migration loop, queue outcome, and
  `replayQueuedMutations()` contract without repository access. Explicit used
  the migration and cron surfaces to keep a derived message count current even
  after clock-only expiry.
- Durable realtime remained the strongest shared behavior. Once UI identity
  and render cost were bounded, two-browser updates for profiles, feeds,
  messages, reactions, settings, receipts, and Insights were reliable.
- Day-2 data evolution was credible in both profiles. Each lane expanded the
  schema, backfilled through authenticated app mutations, tightened the field,
  and compared persona-scoped exports without losing old messages, media,
  receipts, or reactions.
- The large Hetzner was a comfortable execution host. Peak application memory
  never threatened its 125 GiB envelope, and the primary laptop remained free
  for other work. The benchmark was mostly serial settlement/model work, so
  excess RAM protected the run more than it shortened it.

## What fought us

- Explicit's scale adapter first exhausted the 1,024 retained mutation-result
  records. The successful fresh attempt had to opt one-shot sequential calls
  out of unnecessary transport mutation-ID custody while retaining application
  intent identity.
- Familiar M3 typing took many loops. The ephemeral channel itself eventually
  proved prompt; the real tail was 45 controlled keystrokes repeatedly
  reconciling a large message tree. Bounding history and memoizing bubbles
  brought visibility to about 1.5 seconds with roughly 3.3-second withdrawal.
- Familiar's scheduled digest remains outside the profile grammar. The Guide
  correctly says to leave Familiar for cron, but this lane was forbidden to do
  so, leaving the grader-owned M8 schedule obligation absent.
- Familiar M7 exposed a sharper mismatch: `offline_mutation_replay` appears in
  generated target capability facts, but Familiar cannot declare it, the
  binding omits it, and native queue dispatch refuses safely. The lane had to
  build a localStorage vote queue. That is now an open filesystem issue.
- The supervised Expo launcher again selected undeclared ports, so both lanes
  used fixed-port external-client topology. Clean Metro restarts were also
  needed after several generated descriptor/module changes.
- The Explicit M7 handoff lacked `personas.json`, reproducing the existing
  relocatability issue. A supposedly self-contained day-2 packet should not
  require the fresh agent to reconstruct that dependency.

## Comparison to familiar alternatives

Familiar still resembles the best part of Convex: typed functions, generated
references, and live hooks make ordinary product work compact. Explicit feels
more like authoring a checked server protocol: more ceremony, but cron,
ephemeral declarations, effects, and operational intent are visible and
complete. Supabase/Postgres would make aggregate counts and bulk fixture loads
more natural, but would demand more manual realtime/RLS alignment. Firebase
would likely beat both lanes on mature offline ergonomics. A hand-rolled
Postgres/Express stack would maximize control while making sessions,
idempotency, live fan-out, and offline settlement bespoke.

## Reading the result

Explicit was faster across the comparable M1–M6/M8 milestone walls (6,270s vs
7,961s), reached M7 green sooner (1,076s vs 2,049s), completed scale, and could
author the scheduled digest. Familiar used fewer total tokens, but it also did
not complete scale, so that is not an efficiency win. This is one calibration
pair, not a magnitude claim.

The practical conclusion from this run is the same shape as the prior 0.1.24
full run but stronger: Familiar is pleasant for the typed application core;
Explicit is currently the profile that completes this production-shaped app's
advanced and scale obligations.

## Score snapshot

| Dimension | Explicit | Familiar |
|---|---:|---:|
| B1 schema/data | 82 | 74 |
| B2 auth | 72 | 64 |
| B3 realtime | 68 | 71 |
| B4 offline/sync | 36 | 49 |
| B5 media/storage | 34 | 45 |
| B6 search | 38 | 47 |
| B7 push/actions | 70 | 28 |
| B8 day-2 evolution | 84 | 78 |
| B9 DX/docs | 62 | 56 |
| B10 diagnostics | 44 | 39 |
| B11 operations | 58 | 63 |
| Continuous holistic | 68 | 58 |
| M7 holistic | 91 | 76 |

These are builder self-scores, not grader outcomes. No weighted or O-dimension
total is published.
