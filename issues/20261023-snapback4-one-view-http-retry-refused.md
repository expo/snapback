# Snapback 4 one-view HTTP retry is refused after an aborted transfer

Status: Open
Owner: core / HTTP integration (outside SEC9)
Observed: 2026-10-23

The SEC9 full client pool and two focused normal-binary reruns fail
`packages/snapback4/test/http-bounds.test.mjs`, subtest
`one-view assets finalize only after a complete non-range response`. After the
fixture's interrupted transfer, its expected complete response is HTTP 410 Gone
instead of HTTP 200 with Content-Length 8388608. This is an availability/one-view
finalization or fixture-timing concern; no unauthorized disclosure was observed.

The one-view serving/finalization implementation is outside SEC9's authored
changes. Inheritance is not established by an independent SEC8 execution; do not
call this a proven baseline failure. Preserve the finalization law rather than
loosening consumption or disabling the assertion to make the suite green.

Reproduce from snapback4/ with the ordinary worktree binary location:

```sh
timeout 600s env -u SNAPBACK4_BIN CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/http-bounds.test.mjs
```

The workstream report and compressed validation logs retain both the full run
and focused rerun. No full client pass or publication receipt is claimed.
