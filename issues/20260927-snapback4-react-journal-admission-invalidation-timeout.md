# Snapback 4: cross-tab journal admission invalidation intermittently times out

Status: Open
Date: 2026-09-27
Scope: `snapback4/packages/snapback4/test/react.test.mjs`, browser online custody
Observed by: lane QE round 2, implementation head `55e8c29af`
Classification: baseline failure outside the Quarry changes; underlying cause unconfirmed

In the single full `scripts/test.sh` run, the nested test
`closing the last journal owner during admission still invalidates another tab`
timed out at `react.test.mjs:146` after 30,000 ms. The write admission itself
returned pending, but the first tab's hook never reported the admitted ID before
the deadline. Its enclosing `React hooks and reference-app lifetimes` test also
failed as a consequence. This is one underlying failure, two Node test failures.

The browser fixture uses real online custody and a controlled transport sharing
`localStorage`; it launches neither a backend nor the Quarry compiler. The
React test, every client/app source, the imported receipts guide snippet and
Bun lockfile are unchanged between merged pre-fix `ccb09c02a` and `55e8c29af`.
This supports the baseline classification; it does not establish a scheduling,
product or browser cause. No environmental failure is confirmed.

Reproduction from `snapback4/`, using Node 24.13.1, Bun 1.3.14, Rust 1.97.0:

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0
ulimit -n 65536
scripts/test.sh
```

Observed on Linux expo-build-1000. The script selected concurrent client files
at host load 21.48 across 96 CPUs. Exact full result:
`== 1 failure(s) in 1393 s`, group `client tests`, exit 1. Rust, all 78 models,
both app typechecks and all other stages pass.

A single isolated follow-up after the suite:

```sh
node --test packages/snapback4/test/react.test.mjs
```

passes **46/46** in **3,496.960007 ms**, including the failed nested case in
**250.18955 ms**. This is intermittent evidence, not a deterministic reproducer
or a repair. The full suite was not repeated. No test, timeout or runtime source
was changed. Investigate the cross-tab invalidation after the last owner closes
during admission, retaining the admission and hook assertions.

Evidence in the lane checkout: `snapback4/target/lane-qe-r2/full-suite.log`,
`full-suite.exit`, `react-isolated.log`, `react-isolated.exit`. Durable summary:
[`ROUND2.md`](../snapback4/reports/20260927-qe-quarry-ergonomics/ROUND2.md).
