# Snapback 4: keep remount snapshot identity test is timing-dependent

Status: Open
Date: 2026-09-29
Scope: Snapback 4 client retention test; LLP 3000.023 §10
Found by: Lane SR round 0 blocking-suite run

`packages/snapback4/test/keep-device.test.mjs:162`, test
`online: keep remount lifetime, isolation, last subscriber and sign-out`,
expects strict reference identity with the earlier ready answer. Some runs
instead return the same data/meter with `revalidating: true` on remount.

This is inherited: the unmodified test and an independently built server from
`aedd35615ad54901a481a01481e5d8f6110c69b4` fail 4/10 focused repetitions.
The SR tree fails 9/10 repetitions. One preliminary baseline run passed and
one preliminary current run failed. These are observed counts, not estimated
failure probabilities. SDK/core/device/test source inputs are identical to base;
the baseline reproduction reuses their source-matched compiled JS/wasm.

Reproduce from the Snapback 4 workspace:

```sh
node --test --test-name-pattern='^online: keep remount' packages/snapback4/test/keep-device.test.mjs
```

Determine whether the remount revalidation marker is permitted by §10 and make
the intended invariant deterministic: correct the test's identity assertion or
the observation lifecycle as warranted. Do not weaken withdrawal/account/store
fences to satisfy strict identity.

Evidence: [SR report](../snapback4/reports/20260929-sr-starter-routes/REPORT.md),
[all repetition outcomes](../snapback4/reports/20260929-sr-starter-routes/keep-repetition.json),
[baseline stacks](../snapback4/reports/20260929-sr-starter-routes/baseline-keep-repeat.log.gz),
[current stacks](../snapback4/reports/20260929-sr-starter-routes/current-keep-repeat.log.gz).
