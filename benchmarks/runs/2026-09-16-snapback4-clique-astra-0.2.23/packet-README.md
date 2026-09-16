# Clique on Snapback 4 — Astra-medium calibration on 0.2.23

**Status:** the seventh Astra calibration of the agent-ergonomics program, on `snapback4@0.2.23` / `snapback4-expo@0.2.14`. The pins carry wave 7 (LLP 3000.007 §20.16), published from main `609f99936`.

**Baseline.** The 0.2.22 calibration: holistic 91; setup 90, data 89, auth 96, queries 91, writes 94, offline 94, media 97, background 94, client 90, diagnostics 90, scale 84, operations 89. Its grade was 85 pass / 7 fail (waived native assertions), O2 68, O4 40, O5 band 30. Record: `benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.22`.

**Instrument.** The same frozen instrument, scripts and templates as `~/clique-sb4-20260915-astra-cal6`, copied without lanes, scores or logs. Ports 49360–49379, Astra builder only (gpt-6-astra, medium). N=1: a few points is noise.

**Addressed since 0.2.22** (from that record's friction-review.md):
- **d-03:** a prefixed recipe install no longer exposes client-callable operations that take arbitrary post references.
- **d-02:** a push decided only by the presence grace is deferred and delivered after it.
- **Recipe:** routes stay reader-private; `saveProfile` and `createPost` predict, and `follow`/`unfollow` queue, as the card states.
- **Capacity:** follow/unfollow churn releases its routing-accounting slot.
- **H8:** dev-only read meters, and `run --as <principal>`.
- **H6:** the dev banner names the store, with `--memory`.
- **H7 and d-05:** service tokens name their store, and readiness is documented.
- **H5:** a measured global-search card section.
- **H10:** the `aggregates` alias.

**Chain:** `calibration-0.2.23.sh`.
