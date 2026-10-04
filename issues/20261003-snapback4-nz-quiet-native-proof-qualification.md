# Snapback 4 NZ: finish quiet-host background native-proof qualification

Status: Open
Date: 2026-10-03
Area: export:ios / background witness performance and cold social proof
Source: lane NZ on the Apartment mini, based on WD `38d9bfe0de`

The detached export implementation and its full Mac suite are complete, but the
requested performance qualification is not. There were zero admitted checks in
448 observations. In the final 355 seconds after all lane-owned builds/smokes
ended, 28 checks still failed; CPU idle ranged 72.6–86.8%. Unrelated
`PerfPowerServices` had a 193.3% median across the retained history. The user's
quiet-only rule and prohibition on signalling unrelated processes were respected.
The timing watcher is stopped; no benchmark is left waiting to run.

The [NZ report](../snapback4/reports/20261003-nz-native-proof-zero-cost/REPORT.md)
binds source, binaries, host, raw evidence and the measurement scripts. The full
Mac suite passed `== 0 failure(s) in 2540 s`. An earlier plain native proof passed
prime/offline/restart with exact published/loaded hashes. Three social cold
attempts under unrelated host load hit the existing 900-second preparation limit;
the first two also overlapped our full suite. Cold social proof is unqualified.
A final-binary plain repeat invalidated its older cache on the changed CLI
binary and was deliberately cancelled through its birth-verified guardian to
clear the machine. All eight created functional simulator UDIDs are absent.

Remaining work, on this mini only, with a quiet host:

1. Run `python3 snapback4/reports/20261003-nz-native-proof-zero-cost/measure.py before`.
   It measures baseline plain/social cold plus three warm samples each and deletes
   only devices in its private ownership store when done.
2. Run the same command with `after`. It measures command-return time separately
   from detached proof completion, checks every segment/hash and preserves failures.
3. Run `python3 snapback4/reports/20261003-nz-native-proof-zero-cost/interference.py`.
   It brackets concurrent native work with foreground client-pool controls and
   samples an owned CPU probe under foreground/background taskpolicy.
4. Inspect all during-run host samples, discard no attempts, report distributions,
   confirm cleanup, refresh the evidence archive/index and update REPORT/JOURNAL.
   If quiet cold social proof still exceeds 900 seconds, investigate preparation
   scheduling/budget before claiming native background completion is qualified.

The scripts set `SNAPBACK4_SMOKE_DEVICE_PREFIX=sb4-nz-`, reject unrelated compiler
activity and busy PerfPowerServices, and use the same restored NX 0.4.11 audited
fixtures before/after. The separate
[0.4.12 audit-pin issue](20261003-snapback4-0.4.12-native-cache-audit-pins-stale.md)
remains; do not bypass its conservative cache misses. The reported hardware has
Performance/Super levels and no Efficiency tier; background policy alone proves
neither exclusive placement nor zero interference. No office host or X27R worktree
is involved. Keep large receipts, gzip files and videos outside git.
