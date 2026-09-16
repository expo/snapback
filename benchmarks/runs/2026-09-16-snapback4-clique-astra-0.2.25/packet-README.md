# Clique on Snapback 4 — Astra-medium calibration on 0.2.25

**Status:** the ninth Astra calibration of the agent-ergonomics program, on `snapback4@0.2.25` / `snapback4-expo@0.2.16`. The pins carry wave 9 (LLP 3000.007 §20.18), published from main `545f92a22`.

**Baseline.** The 0.2.24 calibration: holistic 88; setup 90, data 88, auth 95, queries 78, writes 95, offline 93, media 96, background 92, client 88, diagnostics 94, scale 80, operations 86. Grade 85 pass / 0 fail, O1 75, O2 75, O4 45, O5 75. Record: `benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.24`.

**Instrument.** The same frozen instrument, scripts and templates as `~/clique-sb4-20260916-astra-cal8`, copied without lanes, scores or logs. Ports 49360–49379, Astra builder only (gpt-6-astra, medium). N=1: a few points is noise.

**Addressed since 0.2.24** (from that record's friction-review.md):
- **Rank 1:** the expire and reads cards say a live reader may drop a row at its own `expiresAt`, with the client form.
- **Rank 2:** `check` states what a held query proves — horizon-free source coverage — and the search card leads with it.
- **Rank 3:** the wide-merge rewrite names a command that exists.
- **Rank 5:** the cards say a denied read answers as an empty page by design, and what to use instead.
- **Rank 6:** `why <CODE>` prints the card's section, so a diagnostic carries its own explanation.
- **Rank 4:** `N_MAINTAIN_SYNCED` no longer prints a count that is structurally zero; residency sites carry `file:line`.
- **Ranks 7 and 8:** a bounded-list loop that only emits is no longer refused as fan-out, and `unique … else CODE` names its own refusal.

**Chain:** `calibration-0.2.25.sh`.
