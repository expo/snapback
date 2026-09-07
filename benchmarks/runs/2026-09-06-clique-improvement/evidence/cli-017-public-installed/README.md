# 0.0.17 public installed checks

The fresh public Expo/guide witness passed all 12 original bounded commands and all 156 installed-file comparisons. Actual outer and child exits were 0; total child duration was 77.791084708 seconds. The unchanged project preserved all 26 public operations and backend/build-cache contents. Root read the complete [report](expo/installed-expo-verification.json), including command receipts and scope assertions. This does not establish native-device behavior.

The separate default npm11 witness failed. Install PID 74883 exceeded its original 30-second limit, then timeout cleanup raised `process identity unavailable/changed`. The [raw traceback](npm11/outer.log), [original running receipt](npm11/receipts/default-install.running.json) and [npm log](npm11/receipts/default-install.log) are retained. Although the npm log says four packages were added, the actual npm exit was not captured and remains unknown. The helper exited 1 and `npm ci` did not run. Later exact owned-PID/parent/group observations found no matching processes; absence does not imply exit 0. No retry or later signal occurred.

[Actual terminal summary](terminal-summary.json) preserves the separate outcomes. The measurement helper race is tracked in [the follow-up ticket](../../../../../issues/20260907-snapback2-install-witness-timeout-reaping.md). Its repair must retain a timeout as failed even if a later wait observes child exit 0; it cannot retroactively qualify this attempt.

The earlier [standard publication and registry reconciliation](../cli-017-published/README.md) remain valid separate evidence. Original timing reds, initial E404/activation exit 1 and later matching SRIs/latest tags are unchanged. No default install/ci success, causal slowdown diagnosis, broad latency qualification or benchmark score improvement is claimed. The generated-type fix landed afterward and is not in the frozen 0.0.17 artifacts.

All 50 original witness logs/reports/inventories were copied exactly, with [copy hashes](copied-evidence.json). Full evidence was retained without repeating any original command.
