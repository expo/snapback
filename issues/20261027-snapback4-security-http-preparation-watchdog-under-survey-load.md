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
