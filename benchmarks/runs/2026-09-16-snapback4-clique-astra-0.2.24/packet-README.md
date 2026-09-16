# Clique on Snapback 4 — Astra-medium calibration on 0.2.24

**Status:** the eighth Astra calibration of the agent-ergonomics program, on `snapback4@0.2.24` / `snapback4-expo@0.2.15`. The pins carry wave 8 (LLP 3000.007 §20.17), published from main `b1d69912a`.

**Baseline.** The 0.2.23 calibration: holistic 88; setup 92, data 85, auth 95, queries 82, writes 91, offline 91, media 96, background 92, client 87, diagnostics 92, scale 79, operations 83. Grade 88 pass / 0 fail, O1 80, O2 72, O4 50, O5 75. Record: `benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.23`.

**Instrument.** The same frozen instrument, scripts and templates as `~/clique-sb4-20260916-astra-cal7`, copied without lanes, scores or logs. Ports 49360–49379, Astra builder only (gpt-6-astra, medium). N=1: a few points is noise.

**Addressed since 0.2.23** (from that record's friction-review.md):
- **d-01 (major):** a meter cut is no longer an empty success — a read reports `cut`, within the disclosure boundary (devices and uniform reads precise; a non-uniform server read withholds the reason, with `complete: false` still truthful and the precise reason in the dev-only meter).
- **Held queries:** `query … held:` declares a device-only query; serving refuses with `E_QUERY_HELD`. `snapback4 test` skips a held query instead of failing.
- **H2:** recipe caps are printed and sizeable at install.
- **V8:** the feeds card carries a measured cold-acquisition row for a wired app.
- **H8:** a failed startup adoption is sticky, visible in `doctor`, retried, and its repeated logs bounded.
- **d-05:** deferred pushes appear in `doctor` and `/effects`, and the cards name the dev clock as the test lever.
- **V1:** loopback dev returns read meters by default.

**Chain:** `calibration-0.2.24.sh`.
