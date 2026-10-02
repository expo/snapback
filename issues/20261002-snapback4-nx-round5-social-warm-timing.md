# Snapback 4 NX round 5: social warm median exceeds 25 seconds

Status: Open
Date: 2026-10-02
Scope: native-smoke performance qualification; LLP 3000.030 §15

On the Apartment M5 Pro mini, the round-5 candidate's five retained JS-edit warm
exports measured 26.686, 29.128, 28.563, 30.380 and 29.797 s (median 29.128 s).
All five were cache hits, all three native segments passed, and export/loaded
bundle hashes and publication/smoke proof hashes matched. Plain's median was
20.840 s. The user requested medians below 25 s; social did not qualify.

Round 3's medians were 15.820 / 21.073 s; round 4's single samples were
15.805 / 22.944 s. The current native-only social durations were 21.264–25.506 s;
whole-command time outside that receipt was 4.160–5.422 s. The round-4 single
social receipt had 19.019 s native plus 3.925 s outside. Shared-host load was
extreme earlier in this task and declined during the cohort, but causation is
not established and there is no same-time round-4 control. No sample was omitted,
no timeout or target raised, and the guide reports the new slower median.

Evidence: `snapback4/reports/20261001-nx-export-proves-native/round5/timings.json`,
`measure-final.log`, `measure-cohort.log`, per-sample summaries, and every raw
receipt/media blob via the report's `EVIDENCE-ARCHIVE.tsv`.

Next: compare native-stage timings against a controlled baseline on this host,
identify the increase, and restore the below-25-second median without weakening
export custody, proof checks, native cache validation or lifecycle assertions.
