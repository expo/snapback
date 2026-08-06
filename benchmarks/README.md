<!-- @ref LLP 0186#w1--competitive-benchmark-and-ratchet-owned-here — this
     directory is W1's instrument: the fixed brief corpus, run-record schema,
     protocol, and per-release calibration records the ratchet reads. -->

# Snapback competitive benchmark

This directory is the instrument mandated by **LLP 0186 W1**
(`llp/0186-agent-authoring-efficiency-program.plan.md`): a repeatable,
same-brief, same-harness comparison of what it costs a coding agent to
build a real application on Snapback versus its competitors, formalizing
the 2026-08-05 paired bakeoffs
(`diaries/0058-relay-room-expo-backend-bakeoff.diary.md`,
`diaries/0059-tandem-expo-messaging-bakeoff.diary.md`).

It is scaffolding plus protocol. No benchmark lane has been executed from
this directory yet; the first instrumented run ratifies the draft
attribution rule in `protocol.md` and records the binding baseline
(LLP 0186, Measurable outcome 3).

## What it measures, per lane per run

| Metric | Definition | Provenance |
|---|---|---|
| Wall-clock | Epoch-timestamped start/finish of the lane, split into orientation / authoring / verification / diagnosis where the transcript supports it | Diary 0058 recorded 26m03s (Snapback) vs 11m15s (Convex) from local epoch timestamps — the calibrated baseline pair. That clock excluded Snapback-only orientation reading, biasing it in Snapback's favor; the instrument makes orientation an explicit split instead of an exclusion. |
| Input + output tokens | Usage accounting from the run harness, with the accounting channel named in the record (`tokens.source`) | Diary 0058: "Model token counts are unavailable. This Codex surface did not expose a per-lane token meter." **OPEN (LLP 0186 OQ1):** which harness channel is trustworthy, and whether cross-model token comparison is ever fair or the ratchet pins one model per epoch. |
| Correction loops | Count of correction loops, each carrying an attribution (`snapback-defect`, `agent-error`, `environment`, `ambiguous`) and an evidence pointer | The prior-run figures (~11 for diary 0058, ~4 heavy for 0059) are reconstructions from qualitative diary text, not recorded counts (LLP 0186, Measurable outcome 3). The first instrumented run defines the attribution rule and the binding baseline. |
| Hand-authored LOC | Hand-authored source/test lines, generated artifacts excluded | Diary 0058: Snapback 1,202 lines / 14 files vs Convex 868 / 13. A ceremony proxy only — see fairness rules. |
| Rubric scores | Diary 0058's weighted dimensions, unchanged (see `schema/run-record.schema.json`) | Functional completeness 20%, realtime + typing 10%, offline behavior 20%, images/assets 10%, data model + type safety 10%, DX/docs/setup 15%, testability + diagnostics 5%, operations + current maturity 10%. |

## Lanes

Snapback, Convex, Supabase, PocketBase, raw Postgres+Express. Same agent
harness, same model, cold context, no human steering (LLP 0186 W1).

**OPEN (LLP 0186 OQ4):** the messaging brief advantages realtime-native
platforms; the CRUD and media briefs in `briefs/` exist so the
Supabase/PocketBase/Postgres lanes are representative rather than
strawmen, but which brief mix keeps them so is not yet settled.

## Brief corpus

- `briefs/messaging.md` — the WhatsApp-shaped brief the calibrated
  baseline runs used (extracted from diaries 0058/0059).
- `briefs/crud.md` — conventional CRUD shape (authored for W1's
  diversification requirement, no prior run).
- `briefs/media.md` — media-heavy shape (authored for W1's
  diversification requirement, no prior run).

## Fairness rules (carried from the diaries)

1. **Auth parity is labeled, never assumed.** Both bakeoff arms used a
   visibly labeled test-persona seam, not production authentication
   (diary 0058: "neither app pretends that tapping 'Ada' is production
   authentication"; diary 0059: "the line-count result must not be read
   as a security comparison"). Every run record states the auth posture
   of each lane; lanes with unequal auth work are compared with that
   labeled, not silently.
2. **Guarantees are scored, not line counts.** Raw lines are "a rough
   ceremony signal" (0058) and "a crude measure" (0059): the Snapback
   arms expressed more image policy and runtime admission; the Convex
   arms hand-built typing cleanup and an app-owned offline cache with
   offline sends disabled. The rubric scores what is guaranteed
   (offline/durability contracts, atomicity, presence semantics), so the
   ratchet never rewards omitting guarantees to look cheap.
3. **Orientation cost is measured, not excluded.** The 0058 clock
   excluded shared Snapback-heavy orientation; the instrument records it
   as a wall-clock split instead.
4. **Failures caused by the lane's own authoring mistakes are attributed
   as such**, per the attribution rule in `protocol.md` (draft until the
   first instrumented run ratifies it).

## Ratchet: measurement-only until calibrated

Per-release results land under `calibration/`. Per the accepted LLP 0186
W1 text, the ratchet **starts measurement-only: it becomes
release-gating only after a calibration phase resolves OQ1/OQ2** (pinned
model/epoch, repetition count, variance treatment, tolerance, run cost).
Until then a breach is a report, not a block.

## Publication gate

No comparative numbers are published until W0 has landed and Snapback's
own lane is not losing on self-inflicted plumbing (LLP 0186 W1). Status:
**W0 exited 2026-08-06** — the qualified `0.1.9` closure is live on npm
`latest` with a green cold install from the public registry
(`issues/closed/20260803-first-npm-latest-promotion.md`), so baseline
runs from here forward run the Snapback lane **against published
packages**, not the source checkout the diaries used. The gate then
turns on the run evidence itself: a published-package run whose Snapback
lane carries no `snapback-defect` correction loops of the W0 plumbing
class.

**OPEN (LLP 0186 OQ5):** what disclosure (harness, model, briefs,
fairness rules, raw diaries) makes published results credible rather
than vendor-benchmark noise. Draft position in `protocol.md`; not
resolved here.

## Directory layout

- `briefs/` — the fixed brief corpus (verbatim per lane per run).
- `schema/run-record.schema.json` — JSON Schema for one lane-run record.
- `protocol.md` — the run protocol and the draft attribution rule.
- `calibration/` — per-release run records (measurement-only phase).
