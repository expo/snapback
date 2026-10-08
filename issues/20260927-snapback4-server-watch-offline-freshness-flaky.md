# Snapback 4: server watch intermittently fails to downgrade freshness offline

**Status:** Open
**Date:** 2026-09-27
**Area:** Snapback 4 client observations / remembered server answers

Lane GS round 2's single full suite, implementation `ad4ad7cf6`, failed
`server-class watches run locally first and recover remembered server data offline`
at `snapback4/packages/snapback4/test/residency.test.mjs:134`:
`AssertionError: offline watch downgrades the remembered answer`.
The existing 8-second polling helper did not observe `fresh === false` after
`f.offline(true); await client.sync()`. Total test time was 9,393.988324 ms.
This is the only failing client test, with no cancelled tests; the outer test
has a 20-second limit, which was not the assertion that failed.

This exact failure predates GS: the round-3 failure table in
[snapback4/reports/20260926-lane-o-pending-writes.md](../snapback4/reports/20260926-lane-o-pending-writes.md)
records the same name, line, wait and message, with passing isolated and
baseline-source controls. GS changes no client source or this test; its schema
contains no word search or membership merge. The new compact-search dispatch
therefore does not execute on its `audits` query. Classify this as a **baseline
intermittent failure**, with cause unresolved, not as a proven host/environment
failure. No assertion or timeout has been changed.

Observed-context reproduction (intermittent, not guaranteed each run):

```sh
cd snapback4
scripts/test.sh
```

Focused probe:

```sh
cd snapback4
node --test --test-concurrency=1 \
  --test-name-pattern='server-class watches run locally first' \
  packages/snapback4/test/residency.test.mjs
```

The GS failure stack is retained in
[suite-failures.txt](../snapback4/reports/20260927-gs-global-search-round2/suite-failures.txt).
Its final report records the exact suite result and any isolated follow-up;
a passing focused run does not replace the full-run failure. Investigate the
ordering of link changes, server-watch responses and freshness publication;
no root cause or product fix is claimed here.


GS's final full result is `== 1 failure(s) in 1585 s`, exit 1. One unchanged
focused post-suite probe passes 1/1 (180.598508 ms test / 267.290277 ms process).
This supports the recorded intermittence but establishes no fix or root cause.


## FT investigation — 2026-10-08

Still open for the historical freshness-downgrade signature. FT reproduced a
different failure in this same case: the recreated watch lost remembered data
after sync publication. The mounted watch did downgrade freshness in every
observed failing run. That reproduced race is repaired and closed in
[the recreated-watch ticket](closed/20261007-snapback4-recreated-offline-watch-timeout.md).
The test now awaits sync and a fresh settled server answer before disconnecting;
the original downgrade, data, since and reconnect assertions remain, with
snapshot/link/device/transport diagnostics on both offline waits. The complete
fixed file passes 30 loaded runs. This removes an invalid precondition but does
not establish why the older 8-second downgrade predicate failed. No product
change, timeout increase or historical-cause claim.

[FT commands, retained evidence and final counts](../snapback4/reports/20261008-ft-client-flakes/REPORT.md).
