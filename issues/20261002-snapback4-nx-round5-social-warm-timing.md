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

## Round 5b control — 2026-10-02

Still **Open**. Built installable packages for e1adc01ddc and adbabda71e and
prepared four independently warmed projects. Six warm samples per revision per
starter, in ABBA blocks, measured medians **18.346 / 27.786 s** for round 4 and
**18.335 / 26.716 s** for round 5 (plain/social). Every measured command hit cache,
passed all native segments and matched export/loaded/publication proof hashes.
No round-5 slowdown was reproduced in this contemporaneous comparison.

This does not close quiet-host qualification: eight of 24 runs ended above load1
6 despite starting below it; another checkout's builds/tests interrupted the
cohort. A separate 30-minute attempt to start a quieter cohort never fell even
to the original load1 <= 6 threshold (minimum 6.717, maximum 143.772; no sample
started). Social still exceeds 25 s in the completed shared-load cohort. No
product code, audit pin, proof check, assertion or timeout was changed.

The report's “Round 5b — timing control” section includes every sample with load,
whole/native/outside durations and the top-CPU/timestamp records, plus exact
package hashes and archived raw evidence. Next: reserve a quiet host window and
use the already warmed `~/sb4-np/nx-r5b/{r4,r5}-{plain,social}` copies to collect
six quiet warm samples per cell. Do not replace the recorded contended cohort.

## Round 6 disposition — 2026-10-02

Still **Open**. The 25 s social target is unmet on the current host; quiet-host
qualification is pending. Round 5b found no round-5 slowdown, but both social
medians (27.786 s control / 26.716 s candidate) exceed the unchanged target.
Round 6 repairs publication recovery and the fork-inheritance test; it runs no
new native timing cohort and changes no budget, timeout or sample classification.
