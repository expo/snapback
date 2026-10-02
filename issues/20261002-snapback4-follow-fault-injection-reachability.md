# Delivery fault matrix intermittently misses the follow fault injection

**Status:** Open
**Date:** 2026-10-02
**Scope:** Snapback 4 client qualification fixture

CT round 3's one complete suite failed `47 transient: local.ts:850 follow` in
`packages/snapback4/test/delivery-fault-matrix.test.mjs:264`: “the classified await
must actually experience an injected fault.” All preceding outcome/FIFO checks
in that case succeeded. This fixture uses mocked transport over the wasm device;
it does not start a server or exercise CT's maintenance threads.

The whole file immediately reran successfully on the CT branch (321/321).
An isolated current-main snapshot, 738d45830c9d51c9c92f65180c56cbecb2f2b068,
rebuilt its own wasm (610,174 B gzip) and client, then passed the isolated site-47
transient case and the full matrix (321/321). The initial full-main attempt used
an insufficient 120-second outer timeout; the completed invocation took 140.235 s
and exited zero with a 240-second guard. No source or test assertion was changed.

Classify the original invocation as a transient test-harness/environmental failure;
its precise scheduling cause is unresolved. This is not a reproduced main product
failure and not a claim that CT fixed the client. Investigate whether follow
reachability needs an explicit barrier instead of finite event-loop draining.

Evidence: `snapback4/reports/20261001-ct-contended-reads/round3/qualification/`:
`test-sh.log`, `fault-matrix-rerun.log`, `main-commit.txt`, `main-wasm.log`,
`main-client-build.log`, `main-fault-47.log`, `main-fault-matrix-complete.log`.
The sole suite summary is `== 2 failure(s) in 1411 s`; the other failure was CT's
separately fixed maintenance-gate timing accounting.
