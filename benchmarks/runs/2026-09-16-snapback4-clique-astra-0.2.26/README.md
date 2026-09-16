# Clique on Snapback 4 — Astra-medium calibration on 0.2.26

**Status:** the tenth Astra calibration of the agent-ergonomics program, on `snapback4@0.2.26` / `snapback4-expo@0.2.17`. The pins carry wave 10 (LLP 3000.007 §20.19).

**Baseline.** The 0.2.25 calibration: holistic **91** — the program's best — with queries 86, scale 87, zero Snapback defects and no failing assertions. Record: `benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.25`. Scores by run so far: 0.2.19 91 · 0.2.21 88 · 0.2.22 91 · 0.2.23 88 · 0.2.24 88 · 0.2.25 91.

**Instrument.** The same frozen instrument, scripts and templates as `~/clique-sb4-20260916-astra-cal9`, copied without lanes, scores or logs. Ports 49360–49379, Astra builder only (gpt-6-astra, medium). N=1: a few points is noise.

**Addressed since 0.2.25** (from that record's `friction-review.md`):
- **Rank 1, the whole setup drop.** The README's opening names all three published documents and what each is for, with a "Start here" path — including `guide actions` and `guide routes`, and the section of the client reference a builder needs next. This was the run's largest single scoring item and it was a paragraph, not a feature.
- **Rank 2, the discoverability loop that had failed twice.** When a note or refusal repeats in one `check` run, its card section now prints **inline** under the first occurrence instead of only a `guide:` pointer — bounded to three excerpts. Wave 9's `why <CODE>` had been invoked zero times; pointing at a card was not reaching the builder.
- **Rank 6.** `N_NO_CURSOR`'s rewrite names the `cap` remedy as well as the cursor — and, after review, only where a cap is actually the right answer.
- **Rank 7.** The effect/job qualification asymmetry is documented where a module declares both.
- **Rank 4.** The recipe's repost helper takes `eventId`, so the obvious call compiles instead of hitting `E_QUARRY_TYPE`. Three lanes in a row had paid for this.
- **Rank 5.** `init --recipe feeds --authors N` sizes the backfill with the caps; no literal is left to hand-edit.
- **Rank 3.** The expiry filter is shown on the typing indicator, where it actually bites.
- **Rank 8.** `test --residency` is named at installation, once, and a missing `--fixture` directory now refuses instead of reporting a zero-row measurement.
- **Rank 9, the recurring low items.** `matching ''` matching nothing is documented with the paved two-query shape; the one-time service token is off the stream harnesses capture; `N_NO_HORIZON`'s silence is described accurately; and a cascade diagnostic whose rewrite a builder cannot act on is suppressed — in `dev` as well as `check`, with `--verbose` to show it.

**Also in this wave, from the blind reviews** (`llp/reviews/3000.007-agent-ergonomics-wave-10.*`):
- The follow backfill is bounded by the mutation write ceiling, so a follow inside the recipe's declared envelope cannot refuse `E_BOUND`. Wave 10 introduced that regression and the review caught it before publication.
- The four commonest compile refusals — `E_QUARRY_SYNTAX`, `E_QUARRY_UNKNOWN`, `E_QUARRY_PLACEMENT`, `E_EMIT_IN_QUERY` — have dedicated card sections, so the new inline excerpt fires where builders actually land. **66 codes still have none**; the census is in the journal and is wave 11's largest item.

**Chain:** `calibration-0.2.26.sh`.

**Attempt 1 aborted (no score), 18:45–19:13 UTC.** The builder copied the frozen
choreography into `lanes/astra-snapback4/harness/choreography/` — one level deeper
than the layout `lanes/lib/json-schema.mjs` serves — so `setup-identity.mjs`'s
`../../lib/json-schema.mjs` resolved to a path that does not exist. It then
correctly **refused to fabricate** the module, recorded `nonGreenCause=instrument`
and stopped at M1. That is the right behaviour and is preserved under
`attempts/attempt-1-aborted/`. The packet was not changed: `lanes/lib/` is the
sanctioned location for a flattened harness copy and was present throughout.

For the record, two earlier runs met the same import and wrote their own shim
rather than aborting — cal6 (0.2.22) and cal9 (0.2.25), the program's two highest
scores. Both shims are **real AJV-backed validators** over the unchanged frozen
schema, not weakened no-ops, so those scores stand; the variance in how builders
resolve this import is an instrument fragility worth removing, and is recorded
here rather than fixed mid-programme.

---

## Result: holistic 90 (0.2.25: 91)

Grader: **85 pass, 0 fail, 16 not-run** (M6's seven and M7's nine web assertions;
M7 was not run and M6's were covered by Node-replica proofs rather than the web
suite). M1–M6 and M8 green; both fresh scale replays verified; two complete
167,243-action replays; cold sync 6.1 s; client/replica peak RSS ≈375 MiB.

| category | 0.2.25 | 0.2.26 | delta |
|---|---:|---:|---:|
| **overall** | **91** | **90** | **-1** |
| setup_and_docs | 85 | 89 | **+4** |
| authorization | 96 | 97 | +1 |
| writes_and_transactions | 95 | 96 | +1 |
| diagnostics_dev_loop | 94 | 95 | +1 |
| operations | 88 | 88 | 0 |
| media_assets | 98 | 97 | -1 |
| background_work | 96 | 95 | -1 |
| client_integration | 89 | 88 | -1 |
| offline_sync | 95 | 92 | -3 |
| data_modeling | 88 | 84 | -4 |
| queries_and_live | 86 | 82 | -4 |
| scale_and_limits | 87 | 83 | -4 |

**Correction.** The first version of this record carried a wrong 0.2.25 baseline row
for `setup_and_docs` (90 instead of 85) and wrong rows for four other categories,
and concluded from it that wave 10's central bet had not paid off. It had. Read
from the two scorer files directly, `setup_and_docs` is the **largest gain in the
run, +4**, and the rank-1 item of the 0.2.25 review is closed: no misleading
documentation was established and the published feed, search and operations guides
were used successfully. The wave-11 friction review caught the error by reading
`astra/FINAL.md` rather than trusting this table.

**N=1; a few points is noise, and 91 → 90 is inside it.** What is *not* noise is
what the run says about wave 10's central bet.

**The setup fix worked.** The 0.2.25 run lost its largest single item to a README
split that left the builder with four places to look — the scorer named "the README,
client reference, keyword cards, and generated API". Wave 10 answered that, and
`setup_and_docs` is this run's biggest gain, 85 → 89. The residual is different in
kind: the builder still reads two complete documents before M1 and calls the README
"broad", so the next move is a *sufficient stopping point* for a first working
screen, not another reorganisation.

**Three categories fell four points each** — data_modeling 88→84, queries_and_live
86→82, scale_and_limits 87→83 — around the same three causes the scorer names: the
1,000-chat optional server-search ceiling (`N_WIDE_MERGE`), Trending needing an
explicitly maintained index for freshness, and explicit execution bounds costing
learning time. None is new in 0.2.26; all three are long-standing design edges,
and the Trending item is the "system-owned write" design deferred four times.

**Instrument, not Snapback.** This builder also met the frozen harness's
`lib/json-schema.mjs` import and resolved it with "a disclosed AJV dependency
adapter in a lane-contained layout" — the third of four builders to shim it, after
cal6 and cal9 and after attempt 1 aborted on it. Four builders, three resolutions.
That variance sits underneath every score in this programme and should be removed
before the next run: the fix is to make the copyable choreography directory
self-contained.
