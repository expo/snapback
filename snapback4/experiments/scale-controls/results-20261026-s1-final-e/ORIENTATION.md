# S1-WE context pack

Scope: report-only qualification of candidate `6b73305aa1`; no product or runner edits.

Governing documents: LLP 3000 (Snapback 4 root; current), LLP 3000.009.001.002 §4 and §6 (control fairness and S1 qualification; current), LLP 3000.009.001.000.000.002 §10 ruling 8 and §3.8–3.9 (E acknowledgement/reader durability), and Snapback 4 AGENTS/NOT-DOING.

Active constraints: expose the E selection, per-ack covering-flush assertion and raw-SQL visibility window; run reads under concurrent writes; preserve all failed repetitions, arrival/SLO/counter qualification, pinning and same-source control comparisons. The one-host S1 method supersedes the historical multi-host topology. A power cut is not authorized on the shared host; the existing PG SIGKILL qualification retains that explicit limit.

Open limits: product candidate is under review; performance-relevant revisions invalidate reuse. Release qualification needs core debug assertions to compile the existing flush-position witness; ordinary release rejects test-support. Both E and paired S use the same optimized release binary with core-only debug assertions. No unqualified release-capacity or publication claim.

Likely doc update: requested results README and aggregate evidence only. Hand-off: none.
