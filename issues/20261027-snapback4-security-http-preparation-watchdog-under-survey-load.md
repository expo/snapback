# Private HTTP preparation leaves survey test qualification incomplete under load

Status: Open
Date: 2026-10-27
Scope: Snapback 4 security test preparation; SEC11L follow-up

SEC11b's source-only 800-schema survey encountered the existing private HTTP
preparation watchdog: `private serve preparation stopped early (time) after
180 seconds`. Wave25 lane040 reproduced it with two survey workers and the
same immutable production binary, while unrelated host work remained active.
Its fresh and post-test deployment commands completed with exit 0. Other
initial test attempts reached the harness's external 900-second watchdog.

The survey preserves the original results and same-source/binary retries.
A precision result assesses actual check and fresh/post-test deployment gates,
FIXes and refusals; it does not qualify an HTTP subcampaign that timed out.
Known HTTP/external test watchdogs are reported separately as incomplete test
qualification, never changed to PASS. Unmatched gates/FIXes, unknown deploy
exits, source mismatches and runtime panics remain unclassified.

Reproduce on a schema/fixture-only copy of wave25 lane040 using the retained
`reports/sec11b/tools/survey.py`, with `--default-output --workers 2`, under
concurrent host work. Binary and source hashes plus affected rows are retained
in `snapback4/reports/sec11b/item2/`; private scratch logs remain outside git.
Do not require an idle main branch or change product verdicts to meet timing.

The commissioned SEC11L lane owns check/deploy/test preparation latency.
SEC11b changes neither deploy scheduling nor this watchdog. Integration owns
complete HTTP qualification; the security report explicitly retains this gap.

## SEC11b assignment snapshot

The completed 800-case composition on frozen binary
`f90a285713ce229d3de35a230b474401167cdab518fff74797c16f5307ca82f3`
retains 26 private HTTP preparation/admission campaigns that hit the same
180-second internal watchdog. All check/default/fresh/post-test deployment
commands have ordinary exit0/1 verdicts; there are zero unclassified or
assessed false gates/refusals. This is not full HTTP test qualification.
`reports/sec11b/item3/precision.json` enumerates every affected lane and actual
failure; the policy survey and presentation replay have separate provenance.

Affected cases: wave18 030-snapback-cat-show-ring-judging, wave18 043-snapback-safe-deposit-access, wave19 030-snapback-cat-show-ring-judging, wave21 049-snapback-sign-shop-installs, wave22 025-snapback-backflow-test-filings, wave23 008-snapback-arborist-removal-quotes, wave25 020-snapback-fly-fishing-guide-trips, wave26 003-snapback-vintage-amplifier-repairs, wave26 010-snapback-canyoneering-guided-trips, wave26 016-snapback-vintage-motorcycle-restorations, wave26 018-snapback-livestock-ultrasound-scans, wave26 028-snapback-chandelier-restorations, wave26 029-snapback-boat-delivery-voyages, wave26 033-snapback-asphalt-sealcoating-jobs, wave26 035-snapback-sheepskin-tannery-orders, wave26 038-snapback-water-cooler-deliveries, wave26 041-snapback-espresso-machine-repairs, wave27 016-snapback-vintage-motorcycle-restorations, wave27 020-snapback-llama-trekking-trips, wave27 038-snapback-water-cooler-deliveries, wave27 048-snapback-shade-sail-installs, wave28 005-snapback-wrought-iron-gate-commissions, wave28 006-snapback-binocular-overhaul-jobs, wave28 016-snapback-vintage-tractor-restorations, wave30 026-snapback-film-camera-repairs, wave30 050-snapback-grain-dryer-servicing.

Wave25 lane040 and wave27 lane035 completed their full test commands in the
selected assignment measurement, so their earlier failures are not carried
forward as current gaps. An unused shorter-180-second external replay of
wave27 lane035 timed out; it is retained outside the selected800 and never
substituted for the completed original. Host timing varies; no latency or
complete-HTTP claim follows from these concurrent survey attempts.

## SEC11b item 4 measurement (2026-10-27)

The selected native 800-schema packet on executable
`3a4ac751164bb96b7a07c8076e65b89350b2916c1d50704e73dc99815212d6b7`
contains no preparation or external watchdogs. It retains 17 non-timeout private
preparation exits as incomplete HTTP qualification, not PASS. Diagnostic 033
and wave-26/008 replays show existing pending security findings blocking the
private deployment before HTTP admission. Non-timeout exits are not presumed
latency faults. Both previous long cases complete here (wave-25/040 test
274.698s, wave-27/035 954.182s). This concurrent, different-source/host packet
does not identify the cause or qualify an isolated latency improvement; the
watchdog ticket remains open for SEC11L. Original failed records are retained.

Accounting correction: item 2 has 24 incomplete qualifications (22 preparation
exits and two watchdogs); item 3 has 40 (14 exits and 26 watchdogs). The original
watchdog lists remain accurate for that subset. Full corrections are beside
the original precision receipts under reports/sec11b/item2 and item3.
