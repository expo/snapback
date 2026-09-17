# Clique on Snapback 4 — Astra-medium calibration on 0.2.27

**Status:** the eleventh Astra calibration of the agent-ergonomics program, on
`snapback4@0.2.27` / `snapback4-expo@0.2.18`. The pins carry wave 11
(LLP 3000.007 §20.19–§20.20).

**First run on the repaired instrument.** The copyable choreography harness now
carries its own validator (`issues/closed/20260916-clique-harness-not-self-contained.md`).
Across the previous four builders that one missing import was resolved three
different ways and aborted one whole run with no score; this builder met it not at
all and ran 90 minutes clean. `INSTRUMENT.sha256` is 179 files — the previous
packet's 177 plus the validator and its test — and nothing else in the instrument
changed, so category comparisons remain readable.

## Result: holistic 89 (0.2.26: 90)

Grader: **84 pass, 1 fail, 16 not-run** (M6's seven and M7's nine web assertions;
M7 was not attempted). M1–M6 and M8 green, Hermes exports, scale invariants passed.

| category | 0.2.26 | 0.2.27 | delta |
|---|---:|---:|---:|
| setup_and_docs | 89 | **92** | **+3** |
| scale_and_limits | 83 | 85 | +2 |
| queries_and_live | 82 | 83 | +1 |
| offline_sync | 92 | 93 | +1 |
| client_integration | 88 | 89 | +1 |
| data_modeling | 84 | 84 | 0 |
| diagnostics_dev_loop | 95 | 95 | 0 |
| **overall** | **90** | **89** | **-1** |
| media_assets | 97 | 96 | -1 |
| authorization | 97 | 95 | -2 |
| writes_and_transactions | 96 | 94 | -2 |
| operations | 88 | 84 | -4 |
| background_work | 95 | 86 | -9 |

**N=1. The overall move is inside noise; two things in this table are not.**

**`setup_and_docs` is now 85 → 89 → 92 across three runs**, and it is the category
waves 10 and 11 deliberately spent themselves on. This builder calls the published
documentation "unusually detailed" and reports first-pass schema checking. Rank 1 of
the 0.2.25 review — four places to look — is closed, and the first-screen path of
wave 11 sits on top of it. This is the clearest evidence in the programme that the
documentation work paid.

**The one failing assertion is an application defect, not Snapback.** `m5-a11`
(d-03): search results are not visibly grouped by chat because the app used the
conversation title as the group label and every DM is titled "Direct message", so
six results render under one header. Group chats do get their own header.

**`background_work` −9 is not traced to wave 11 and the builder self-attributes it.**
Its two M8 corrections are both recorded `attribution=agent-error`: an invalid
joined-field rule term, and `E_STRUCTURAL_FANOUT` forbidding a mutation scan of an
expiring table, which sent the digest job to a non-expiring staging table with
revalidated candidates. The builder's words: *"That was a workaround in my design,
not an omitted requirement."* Both constraints are long-standing; wave 11 changed
neither. The builder's own account of the category is positive — resumable sweeps,
and an isolated real-clock proof passing seven scenarios including restart
mid-period and after emission. `operations` −4 is scope: M7 migrations and
production operations were not exercised.

**Still worth taking as friction, despite the self-attribution.** A digest job over
expiring rows needing a non-expiring staging table plus revalidation is real added
design work, and a builder being gracious about it is not evidence that it is free.
It is the strongest new candidate for the next wave.

**Not used:** the `maintain`-as-fresh-ranking form ruled in §20.20 shipped in this
version's card, and this builder still chose "a dedicated expiring rank table" for
trending — while using server maintains for the Insights totals. Whether the card
now reaches a builder at the moment they need it is an open question this run does
not settle.

**Chain:** `calibration-0.2.27.sh`. Packet: `~/clique-sb4-20260916-astra-cal11`.
