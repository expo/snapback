# Snapback 4 acquisition readiness test fails on untouched main

Status: Open
Date: 2026-09-16
Scope: `snapback4/packages/snapback4/test/acquisition.test.mjs:260`
Severity: P3 (baseline test failure; product cause not established)

## Reproduction

On otherwise idle `450b` (Ryzen 5 3600, Ubuntu 24.04, Rust 1.97.0,
Node 24.13.1), the A1/C1 integrated `bash scripts/test.sh` at `ce4404fbd`
reported 400/401 client tests passing. The only client failure was
`process: snapshot and catch-up publish readiness together; later failures
preserve acquired rows`, at line 267. `assertUnknown` expected `E_OFFLINE`
for `one`; the received answer had no `denied.code`.

A separate clean worktree at untouched main `e16baf3483cc840057128da8335aaa14880cf3f4`
ran workspace build, wasm build, package build and chat `check`, then the
same client command `node --test 'packages/snapback4/test/*.test.mjs'`.
It reported 394/395 passing in 66.65 s, with the same test, line and
assertion failing for `guarded`. Neither run had cancelled or skipped tests.
The suites were serialized; no benchmark or other build ran concurrently.

## Investigation boundary

This proves the failure predates A1/C1, not that it is harmless. The fixture's
`before-catchup` mode interrupts `/sync` but permits `/probe` and query
requests; a background probe changing reachability between the four
sequential observations is a plausible timing explanation, not yet proven.
Do not replace the assertion with a permissive success check without checking
that no partial local snapshot is exposed as authoritative data.

Next: instrument query source, acquisition and link transitions; make the
fixture's offline boundary deterministic if that is the cause, preserving
the partial-snapshot and acquired-row assertions on both device tiers.

Logs retained for the integration run at
`/home/ccheever/sb4-w9-tools/{test-integrated,client-baseline}.log` on `450b`.
