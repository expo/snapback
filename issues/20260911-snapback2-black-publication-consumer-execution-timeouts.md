# Snapback 2 publication consumer repeatedly times out on Black

**Status:** Open
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Snapback 2 npm publication, Black publisher-host execution
**Related:** LLP 1002 §11; [0.0.24 release evidence](../benchmarks/runs/2026-09-11-snapback2-release-0024-linux/README.md)

## Evidence

The exact Snapback `5f115db401a41954f10dc3737e5b03872470a4eb` / Ibex
`49fa9841212cf1fc119a3f8dcd246b1f9ab71ea8` release artifacts passed all19
production consumer steps on Silver (Darwin arm64) and EPYC (Linux x64).
The unchanged Darwin artifact then failed two publisher-host consumer runs
on Black before either invocation reached npm registry convergence.

| Black attempt | Execution environment | Observed result |
| --- | --- | --- |
| Wrapper80761,21:05:40–21:08:44 UTC | Homebrew Node25.9.0 | Both Vite builds hit30s; chat dev hit10s. Doctor passed in22.905s. Both journey receipts and the React live round trip passed. |
| Wrapper2826,21:13:14–21:16:34 UTC | Volta Node24.18.0 | Doctor, guide, both Vite builds and chat test hit30s; chat dev hit10s. The todos receipt and live round trip passed. |

Both invocations returned1. Native artifact SHA-256 values remained
`990fc4ce5791bd335943177ccd88dc529bb194932c7ffefee791ed340f40b262`
(Darwin), `23c34a21b61253f86d60ebd5fc77f19300b5d11fc1dbddc190419c261203124a`
(Linux), and `dbb2c3ce953bc9eae903faa24997794632e4e0a47d2f609a0fb11ae71d475733`
(shim). The local resume's path-only rewrite is expected portable staging,
not changed package content. All three0.0.24 registry slots remained absent.

Raw logs and process records are retained on Black at
`/Users/ccheever/release-inputs/snapback2-0024-publication-49fa-20260911`
and `.../snapback2-0024-publication-49fa-r2-20260911`.

## Disposition and follow-up

Stop the Black retry loop and use the already-qualified Silver host with
the same immutable artifacts, publisher and timeouts. Preserve both failures.
Node24 did not repair the problem; Node25, host pressure, cold execution,
OS policy and product code are not established root causes. Passing on Silver
does not explain Black's failures or justify calling them green.

Reproduce with a bounded, PID-tracked minimal invocation on Black, compare
the same bytes on Silver, and distinguish executable launch, bundler launch,
owner startup and resource/policy waits. Record the actual wait location and
an independently corroborated cause before changing code or budgets. Do not
disable OS security, change user Keychain settings, or kill unrelated fleet
processes. Close this ticket when the cause and recovery are demonstrated,
or when an explicit host-eligibility decision and its evidence replace it.
