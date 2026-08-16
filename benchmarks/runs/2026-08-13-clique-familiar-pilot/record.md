# Clique convex-familiar pilot record

**Date:** 2026-08-13
**Evidence:** calibration-only reduced Clique M1–M3, one run per cell
**Instrument/source pin:** `e15064b46dd4afdfc57603a3cc079e67096cca72`
**Backends:** unreleased `snapback-familiar-ts-v1` source checkout and
`convex@1.44.0`

This is not an LLP 0201 magnitude result. Snapback's familiar profile was not
published in the 0.1.20 closure, so both Snapback cells measured an explicitly
diagnostic source-consumer path. The run also used only M1–M3 and one sample per
cell. It can identify friction and generate hypotheses; it cannot support a
general speed, quality, or token-efficiency claim.

## Results

| Model / backend | M1 | M2 | M3 | Whole-run wall | Input tokens | Cached input | Output tokens | Outcome |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| GPT-5.6 Sol xhigh / Snapback familiar | 3,308s | 594s | 1,005s | 5,272s | 66,834,385 | 65,601,536 | 164,292 | M1–M3 green |
| GPT-5.6 Sol xhigh / Convex | 1,213s | 600s | 385s | 3,600s | 39,207,508 | 38,741,248 | 114,758 | M1–M3 green |
| Grok 4.6 xhigh / Snapback familiar | 4,457s | 2,839s | no green | 10,098s | 840,962 | 88,813,184 | 223,282 | M1–M2 green; M3 suite green, choreography non-green |
| Grok 4.6 xhigh / Convex | 1,670s | 457s | 457s | 2,705s | 289,577 | 19,609,344 | 119,074 | M1–M3 green |
| GPT-5.6 Sol xhigh / Snapback explicit 0.1.20 (prior) | 2,141s | 330s | 620s | 3,616s | — | — | — | Suites and executable choreography pass; old instrument kept M2–M3 officially non-green |
| GPT-5.6 Sol xhigh / Convex 1.43.0 (prior) | 1,532s | 229s | 176s | 2,219s | — | — | — | Suites and executable choreography pass; old instrument kept M2–M3 officially non-green |
| Grok 4.5 default / Snapback explicit 0.1.20 (prior) | 1,610s | 464s | 288s | 2,537s | — | — | 109,486 | M1 green; M2 implemented choreography 0/4; M3 implemented choreography 2/2 |
| Grok 4.5 default / Convex 1.43.0 (prior) | 1,277s | 63s | 131s | 1,775s | — | — | 82,290 | Suites and executable choreography pass; old instrument kept M2–M3 officially non-green |

The Codex CLI reports a large cumulative input count that includes its cached
input count; the Grok CLI reports fresh input and cache reads as separate usage
events. For transparency the table preserves each tool's raw fields instead of
pretending they are directly interchangeable. Grok's reasoning-token sums were
200,983 on Snapback and 104,151 on Convex; Codex's reasoning output was 44,925
on Snapback and 33,020 on Convex.

The four `prior` rows come from the 2026-08-11/12 seven-model exploratory
sweep in
[`benchmarks/records/2026-08-12-social-messenger-model-sweep.md`](../../records/2026-08-12-social-messenger-model-sweep.md).
That sweep is the closest historical evidence: the same reduced M1–M3 Clique
shape, serial execution on one reserved office M1 Max, Snapback first within
each pair, and N=1 calibration labeling. It differs materially from this run:
Snapback used the published explicit 0.1.20 surface with the consumer skill,
Convex was 1.43.0, Grok was 4.5 at harness-default effort, and the older
instrument hard-coded required checks as unimplemented. The table preserves
launcher wall and the old run's actual outcome labels; missing token fields stay
missing rather than being reconstructed.

There is also an older full M1–M6 P2 pilot in
[`benchmarks/records/2026-08-09-social-messenger-p2-pilot.md`](../../records/2026-08-09-social-messenger-p2-pilot.md).
It is not folded into this table because its scope included M4–M6 and scale
replay, used Fable 5, and its Snapback M5–M6 wall was contaminated by a machine
outage and harness stall. Its uncontaminated first-three milestone figures were
Snapback 16.2/17.6/30.3 minutes and Convex 19.8/10.7/13.7 minutes.

## What the Sol pair says

Sol is the cleanest direct comparison because both cells reached the same green
boundary. Snapback took 1,672 seconds (46%) longer overall and emitted 49,534
more output tokens (43%) than Convex. The difference was not evenly distributed:

- M1 favored Convex by 2,095 seconds. Snapback's source carrier, Hermes assets,
  package singleton identity, generated-name grammar, and first-bundle work
  dominated the initial milestone.
- M2 was effectively tied: 594 seconds on Snapback and 600 seconds on Convex.
  Once the source closure was running, familiar schema/functions/hooks gave the
  model an authoring loop with Convex-like speed.
- M3 favored Convex by 620 seconds to first green. Snapback exposed an invalid
  generated `take(4096)`/runtime-limit pairing and a receipt acknowledgement
  feedback loop. Convex later exposed its own loaded-conversation typing
  regression during post-green hardening, so neither backend made reactive
  query economics disappear.

The defensible hypothesis is therefore narrower than “Convex is faster”:
Snapback familiar made ordinary feature authoring competitive in M2, while the
unreleased package/runtime closure and some Snapback-specific realtime limits
made onboarding and loaded-chat stabilization materially more expensive.

Grok's pair points in the same direction but does not have an equal outcome
boundary: its Convex cell finished M1–M3 green in 2,705 seconds, while its
Snapback cell ended after 10,098 seconds with M3 choreography still non-green.
The Convex cell used 119,074 output tokens versus 223,282 on Snapback and
104,151 reasoning tokens versus 200,983. This is strong evidence that Grok's
Snapback source-integration loops were costly, but not a backend speed ratio:
the Snapback cell never reached the comparison boundary.

## Familiar surface: what worked

Both Snapback builders independently described the application layer as
recognizable and compact: `schema.ts`, top-level modules, `ctx.db` chains,
generated `api.module.function` references, and familiar query/mutation hooks.
The same generated references served UI, fixture replay, and acceptance code.
Profiles, follow state, feeds, reactions, DMs, groups, messages, quotes, and
typing did not require a hand-authored REST or websocket layer.

The surface did not erase Snapback semantics. Builders still had to understand
sessions custody, explicit auth, table visibility, list-shaped familiar
returns, prepared React bindings, artifact identity, structured refusals, live
query limits, and the split between durable queries and ephemeral presence.

## Confirmed friction and defects

The source diagnostic found several closure mismatches that should be removed
before a published comparison:

1. Source codegen emitted module-qualified names such as `profiles.upsert`
   while the paired headless client rejected that grammar without a narrow
   patch.
2. Codegen admitted `take(4096)` while the runtime caps the query at 1024,
   turning a live messages projection into structured 400 refusals.
3. File-linked source React/client packages could load two prepared-binding
   singletons and report `SNAPBACK_REACT_BINDING_REQUIRED` after preparation.
4. The source carrier was not provided as a qualified, build-matched consumer
   artifact. Both runs spent measured time assembling or rebuilding Hermes and
   the native runtime; the older published carrier correctly refused the new
   artifacts.
5. Grok found that owner-scoped visibility can hide an existing globally unique
   denormalized feed row from a writer, making a read-before-insert strategy
   unsafe. It recovered by composing the Following feed at read time.
6. Sessions development needed repeated generate/restart/replay handling after
   function artifact changes. The source path and guide did not give either
   builder a short, reliable familiar-app reload recipe.

## Model observations

Sol was systematic, instrument-led, and ultimately green in both cells. It also
generated very large cached-input traffic through long diagnostic loops. Grok
front-loaded a broader implementation and produced more output/reasoning tokens
on Snapback, then reached M1 and M2 green but could not stabilize the frozen
RN-web message Composer and typing presence for M3. Its final Snapback result
correctly remained non-green rather than relabeling the failure.

Grok's Convex cell did stabilize the same M3 browser choreography. The first DM
attempt failed because a broad `hasText(/Alice/i)` selector opened a group whose
preview contained Alice's name; the next attempt passed required DM and typing
checks, then the lane added a quote control because an implemented optional
assertion still gated the segment. This makes the earlier Snapback M3 result
look partly app/instrument-shaped, but not wholly backend-neutral: its polling
fallback, presence integration, and repeated source reloads were absent from
the Convex recovery. Grok remained much more narration-heavy than Sol in both
backends and spent a larger share of its budget constructing broad machinery
before driving the frozen receipts.

These are observations about one run per cell, not model rankings.

## Instrument and environment notes

- The frozen profile component renders “Edit profile” before the display name,
  while choreography treats the first `sm-profile` line as the name. Both
  backends needed a lane wrapper; this is instrument/UI integration friction.
- Cold Expo web compilation can exceed the frozen 10-second navigation ceiling.
- The orchestrator supplied the exact pinned Snapback debug carrier and
  readiness receipt after both source cells had already begun building a
  runtime. That correction happened inside measured wall time and is disclosed;
  it did not make the source cells comparable to a published install.
- Sol ran on the office M1 Max fleet host; Grok ran on the local M-series host.
  Wall time therefore supports within-model paired reading more strongly than
  cross-model reading.

Raw lanes, event streams, stderr timing logs, and receipts remain outside git at
`/Users/ccheever/clique-familiar-20260813/` on the corresponding execution
machines. This record retains the authored prompts in the adjacent files.
Whole-run wall is launcher-to-exit where launcher metadata survived; milestone
wall is the lane's recorded milestone-start-to-first-green interval.
