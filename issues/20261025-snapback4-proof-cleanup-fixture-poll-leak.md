# Proof cleanup fixture keeps polling after its deadline under contention

Status: Open
Date: 2026-10-25
Scope: packages/snapback4/test/proof.test.mjs, process-cleanup fixture

The Integration25 documentation-consumer pool fails the unchanged case
`proof command cleanup owns npm descendants and caller death` with
`process tree npm-pids.json cleanup timed out after 5000 ms`. The test target
then stays alive until the file watchdog reports 900 seconds without progress.
The failed async pidsGone poll has no cancellation after bounded() rejects.
The exact initiating reason for the missing/not-gone marker is not established.

The exact case passes alone (1/1), then the complete original target passes
31/31 with the same assertions, five-second fixture deadline and product code.
The earlier broad integration pool also passed this file. This follows the
required flake rule; raw failures are retained rather than relabeled as passes.

Evidence: [isolated case](../snapback4/reports/integration25/incoming/proof-cleanup-alone.log.gz),
[complete target](../snapback4/reports/integration25/incoming/proof-complete-target-rerun.log.gz),
and [original pool](../snapback4/reports/integration25/incoming/incoming-docs-affected.log.gz).

Make fixture polling cancellable at its deadline and test teardown. Investigate
startup coordination around the deliberately short npm command timeout before
changing the custody witness. Preserve process-tree cleanup assertions and
product startup/stop deadlines; this report does not establish a product fix.
