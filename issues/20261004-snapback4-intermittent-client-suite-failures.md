# Snapback 4: intermittent client suite transport and assertion failures

- Opened: 2026-10-04 during AP round-1 full-suite verification on eb1000.
- Status: Open; cause unclassified. No fixture retry or product workaround added.
- Scope: the worker readiness case and seven client files named below.
- Qualification: two complete suites exited 1; neither is a green result.

One complete `bash snapback4/scripts/test.sh` run failed the initial
`/auth/config` fetch for `restart refuses an entry symlink already rejected by
discovery`, before changing the entry or exercising the symlink assertions.
The error is `WORKER_FIXTURE_READY: fetch failed`. The captured diagnostic shows
the host and worker running, one worker start, zero restarts/crashes, no file
descriptor exhaustion, and startup adoption finishing in under a millisecond.
The fetch's underlying cause was not retained by the formatted test diagnostic.

The exact test immediately passed in isolation (2.572 s). Rerunning the entire
worker-regression file then passed all 61 tests (444.360 s), on the same binary
and package output without any product/test edit. The failing complete attempt's
other 310 client files, all Rust targets, fixtures and 79 serial models passed.
This establishes an intermittent observation, not a proven environment cause
or proof that the underlying worker behavior is correct under every race.

A second complete run, without a product/test edit, failed seven other files.
The worker file passed; all seven newly failing files had passed in the first
complete run. Five failures were transport errors: `read-through`,
`read-through-upsert`, `readauth` (explicit `UND_ERR_CONNECT_TIMEOUT`),
`keep-app-model` (online seed 44), and `ordinary-search-oracle` (process seed 183
failed its seed HTTP request, before comparing oracle answers).

Two failures were assertions and remain separate observations:

- `read-through-provenance`: the shifted-page retained query returned A,B,C,
  expected A,C,B; its preceding remote provenance assertion had passed.
- `server-e2e`: the parked action's attempt journal contained [1,2,3], expected
  [1,2]. Do not conflate this with a fetch failure or assume a shared cause.

Both complete attempts passed every Rust/build/fixture stage and all 79 serial
client models. The second attempt had 6,180 passing client tests, seven failures
and 11 existing skips. The client/wasm source and bytes are unchanged in AP.
A read-only snapshot found ample available RAM and no observed port exhaustion;
that snapshot does not classify the failures or exclude transient contention.

AP does not change networking, worker scheduling, action retry policy, client
JavaScript or wasm bytes. Its new ordinary-store invalidations return immediately
unless the server-only activation read-ahead buffer is enabled. This narrows the
changed-code surface but does not prove that the complete-run failures are
unrelated to the candidate.

Retain the underlying fetch cause and host readiness evidence on recurrence;
determine whether this is connection reuse/startup transport, host resource
contention, or a serving defect before changing readiness/retry semantics.
Do not weaken the symlink assertions or blindly retry the fixture to hide it.

Evidence: [AP Round 1](../snapback4/reports/20261004-ap-adoption-pause/REPORT.md#round-1--refusal-order-memory-and-complete-pause-advice),
[failure](../snapback4/reports/20261004-ap-adoption-pause/round1/worker-readiness-failure.txt),
[scoped reruns](../snapback4/reports/20261004-ap-adoption-pause/round1/worker-readiness-reruns.txt),
[second complete run](../snapback4/reports/20261004-ap-adoption-pause/round1/second-suite-failures.txt),
[stage summaries](../snapback4/reports/20261004-ap-adoption-pause/round1/full-suite-summary.txt).

Scoped controls for the seven files subsequently passed against both the retained
pre-AP `2154dc163d` release binary and the current candidate debug binary:
89 tests each, including 300 process and 300 wasm search seeds. A temporary fetch
probe logged and rethrew errors without retrying or changing requests; it caught
ordinary aborts but no reproduced failing transport. The profile difference
precludes timing comparisons; these scoped successes do not classify the full
run failures. [Control evidence and command](../snapback4/reports/20261004-ap-adoption-pause/round1/client-controls.txt).
