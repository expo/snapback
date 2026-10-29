# Investigate Codex cost after MUSE1 opt-in fallback

Status: Open
Date: 2026-10-29
Scope: Snapback 4 authoring/proof routing; coordinate `bind/security/**` changes with its owner.

MUSE1 restores the four-draw Muse median input/call bars with both drafts opt-in,
but fails both Codex bars: 46 calls / 2,878,927.5 input versus .47's 34.5 /
2,227,055. CPAP is 55/3,923,611 versus 35/2,093,185; e-bike 37/1,834,244 versus
34/2,360,925. Keep every draw, including rejected candidates.

CPAP's completed fallback trace contains five fixture-based test invocations,
six related poll tools and three E_SECURITY_NOTES refusals (eleven test-related tools
total). The .47 CPAP control had no such fixture-test tools. Both final Codex
builders declined optional helpers. This does not prove a security-engine bug
or causally attribute every extra call to the scaffold change.

Compare those calls with the app-owned SDK proof route and inspect whether starter fixture commands/repair advice steer repeated tests. Investigate a cheaper
reuse path without an obligatory business-case workbook. Preserve truthful role,
refusal and coverage checks; coordinate any bind/security/** fix with its owner.
Verify both model bars on fresh fixed draws before claiming non-regression.

Evidence: [workstream report](../WORKSTREAM-REPORT.md),
[all exact measurements](../snapback4/reports/20261028-muse1/replays-final.json),
[method](../snapback4/reports/20261028-muse1/METHOD.md). Private sanitized sessions
remain at /tmp/muse1-evidence/lanes/optin-1 and /tmp/muse1-evidence/replay-tx/optin-1.json.
