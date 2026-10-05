# Evidence custody

`baseline/manifest.json` identifies the source commit, private binary/source
hashes, CPU sample and group launch commands. `fixed/manifest.json` identifies
the revised fixture files. Each `dist-sha256.json` records the immutable built
JavaScript used by that phase. Both snapshots use the same private binary and
wasm; no other lane's build output is used.

`group-*.json` records the runner, its two owned busy-loop PIDs and inherited
four-CPU affinity. `group-*.jsonl` records **every** completed native invocation,
including failed invocations. `passed` is the native runner's verdict; the
driver does not turn a failed file into a success. `keeperExit` records the
existing file-owner cleanup protocol, whose acknowledged SIGKILL is normal.
`logSha` is SHA-256 of the uncompressed corresponding `NAME.log.gz`.
Completed phases consolidate their original gzip logs into `logs.tar.gz`.
`python3 harness/verify-logs.py PHASE` verifies each receipt against either
loose or archived logs. `cleanup.json` records that the phase's owned runner
and hog PIDs exited before consolidation; no process in another lane is signalled.

The scripts in `harness/` are the exact diagnostic/stress scripts used. The
original scratch driver was `/tmp/sb4-it-stress.mjs`; it imported the diagnostic
probe from `/tmp/sb4-it-probe.mjs`. A group is invoked as:

```sh
taskset -c CPUS node /tmp/sb4-it-stress.mjs SNAPSHOT OUTPUT GROUP TASKS.json
```

Its task list contains `{ "file": "server-e2e", "iteration": 1 }` records.
Each file is run in full with its original cases and seeds. Groups receive
disjoint assignments. No failed test is retried. The read-only diagnostics
probe logs nested fetch causes, connection errors, event-loop delay, descriptor
limits/counts and socket/TCP counters, then rethrows the original error. Kernel
counters describe the shared host; only per-process/per-socket evidence can
attribute a condition to this lane.
`lagMaxMs` is the largest sampled event-loop delay since that file process
started, not necessarily the delay of the failing request. Diagnostics can
perturb scheduling; passing instrumented controls do not classify historical
failures that lack their own cause/phase records.

The probe was extended during the run to collect read-only `ss` listener and
connection snapshots for the failing port. `harness/probe-versions.json` and
the retained source versions record that change. It affects diagnostics only;
each file process keeps the probe it imported at startup. No healthy request
is changed, and no exception is retried or replaced.

`burst/` adds two complete runs of each transport consumer, with twelve file
slots sharing CPUs 74–77 and two busy loops. Those CPUs were sampled idle
before launch. This intentionally denser startup contention is additional
evidence, separate from the required one-file-per-group baseline repetitions.
`harness/burst.mjs` records the exact driver.
`pressure/` sustains the same twelve-file-slot/two-hog contention for twenty
runs each of six startup-heavy consumers. The original burst CPUs were busy
when resampled, so this control uses newly sampled idle CPUs 60–63. The exact
driver and its CPU/owner manifest are retained separately.

`probes/manifest.json` records the native exit code and source/log hashes of
the targeted controls. Each `.patch.gz` records its delta against the named test
version; final-fixture controls use the corresponding fixed source (the later
worker DDL controls record `sourceRoot` explicitly). It produces a temporary
`.it-NAME.test.mjs` beside that source so relative imports
remain intact. Controls use the original assertions. Expected failing negative
controls remain failed evidence; they are not counted as qualification passes.
`probes/failure-signatures.json` extracts the failing controls' error and
assertion signatures. `probes/auxiliary-logs.json` separately hashes earlier
setup/experiment output, including the unsuccessful worker dev-clock attempt;
those auxiliary logs do not supply qualification receipts.
For example:

```sh
gzip -dc worker-delay.patch.gz | \
  patch -o packages/snapback4/test/.it-worker-delay.test.mjs \
    packages/snapback4/test/server-e2e.test.mjs
taskset -c 0-3 node --import /tmp/sb4-it-probe.mjs --test \
  --test-name-pattern='actual worker crashes' \
  packages/snapback4/test/.it-worker-delay.test.mjs
```

Worker fixed-delay covers both deliberate-crash tests. Ephemeral controls run
the complete five-trial file. Provenance selects the two shifted-page cases;
overflow selects the first oversized-sync case. Same-key controls select the
wasm arrival/delete case, repeated as recorded in their patches. MQ controls
select the wasm local-branch watch case. Temporary probe files are removed after
their run and never become part of the full suite.

Patches are compressed to preserve their exact whitespace, including unified
diff context lines; `probes/patches.json` binds their uncompressed bytes.

`suite-start.json` records the exact requested full-suite command, private
target environment and idle-CPU selection. Its native exit and final output
are retained separately. The initial build disables debug info/incremental
output to keep this lane below its 40 GB disk limit; it does not reduce tests.

`worker-fixed/` repeats the complete 77-case worker regression file sixty
times after baseline run 44 exposed an additional cleanup `ESRCH` race. Eight
groups each inherit a separately sampled four-CPU mask and two owned hogs.
The baseline continues unchanged and retains the original native failure.
`suite-final-start.json` records the additional complete suite after this
late fixture correction; the first complete passing invocation remains retained.

`worker-final/` is a fresh immutable snapshot containing both late worker
fixture corrections. Its eight groups share this lane's already allocated
four-CPU masks with `worker-fixed/` and add one owned hog each. Thus there
are three hogs per group while the earlier phase is active, and one afterward;
every final invocation remains under a confined hog. Neither running snapshot
is mutated. The held-writer probe uses those same allocated groups and keeps
its failure/pass logs, patches and native results in `probes/`.

The later full-suite attempt hit storage exhaustion. Its native exit is 1,
and `suite-final-result.json` explicitly marks the collected outer log
incomplete. Do not reconstruct missing per-file receipts from earlier live
progress observations. The complete stress-phase receipts/log hashes remain
verifiable, including their failed invocations. `enospc.json` is a post-event
filesystem sample, not a contemporaneous measurement of zero free blocks;
`enospc-cleanup.json` records only the private build-cache cleanup.
