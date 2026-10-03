# Snapback 4 CLI shim exits 0 when its binary dies from a signal

Status: Closed
Date: 2026-10-02
Scope: `snapback4/packages/snapback4/bin/snapback4.js` (every `npx snapback4 <verb>` call)

The shim forwards SIGINT, SIGTERM and SIGHUP to the Rust binary. When the
binary dies from a signal, the `exit` handler calls
`process.kill(process.pid, signal)` to die the same way, but the shim's own
forwarding handlers are still installed. The handler catches the re-raised
signal and tries to forward it to the child, which has already exited. The
event loop then empties, and the shim exits with status 0.

Any `snapback4` command whose binary is terminated by one of those signals
therefore reports success to its caller, for example a `check` or a
`witness` step killed by a CI timeout. This behaviour predates lane NX and
ships in every published version up to 0.4.12.

Found by the round-4 Astra review of lane NX
(`snapback4/reports/20261001-nx-export-proves-native/`): a terminated
publisher made `npm run export:ios` print "native smoke passed" without a
verified publication, because the export wrapper trusted the shim's status.

Fix: remove the shim's forwarding handlers before re-raising, and fall back to
`process.exit(128 + signal number)` if the re-raise does not end the process.
Add a regression that runs the real shim against a child that dies from each
forwarded signal, and asserts the shim's own exit status. Lane NX round 5
carries the fix; close this ticket when it lands.

## Resolution — NX round 9, 2026-10-02

Merged into the NX branch with the round-5 shim fix retained. The real CLI shim
removes SIGINT/SIGTERM/SIGHUP forwarding handlers before re-raising the child
signal and retains a numeric nonzero fallback. `export-failure.test.mjs` runs
the installed shim against all three signals; export publication separately
requires verified receipts. Round-9 verification is recorded in
`snapback4/reports/20261001-nx-export-proves-native/REPORT.md`.
This closes the source defect on this branch; nothing is pushed or published.
