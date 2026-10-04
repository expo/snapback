# Snapback 4 QF: transient Linux PGID refuses an otherwise passing client file

Status: Open
Date: 2026-10-04
Scope: `snapback4/scripts/test-processes.mjs`, inherited from main `6e4967479f`

RP round 7's full eb1000 suite passed the application subtest in
`familiar-forms.test.mjs` (one pass, zero failures), then QF's cleanup inspection
failed with `TEST_PROCESS_INSPECTION: malformed ps row: pid/ppid/pgid`.
The captured `ps` row was:

```text
1301666       0 4294967295 1000 Sun Oct  4 05:45:04 2026 X+ snapback4
```

`processTable` rejects the routing prefix because the PGID exceeds signed
32-bit range. It calls `metadataFailure(undefined, ...)`, so it refuses before
selection or a disappeared-PID recheck. The file then reports failure even
though its native Node test result passed. No unrelated process was signalled.

The module is **byte-identical to unmodified main `6e4967479f`**, SHA-256
`fca0821b5264a58aa93936ddc8589733d8e2aee46c3c1d8acc9241edc37a683e`.
Extract that exact module and call its exported function with the recorded row:

```js
processTable({
  group: 12345,
  exists: () => false,
  run: () => ({
    status: 0,
    stdout: Buffer.from('1301666 0 4294967295 1000 Sun Oct 4 05:45:04 2026 X+ snapback4\n'),
    stderr: Buffer.alloc(0),
  }),
});
```

It deterministically raises the same error, including with `exists: false`.
This reproduces the **captured parser failure** on unmodified main; it does
not claim the transient live process-table race occurs on every file rerun.
The main-module reproduction and log remain on eb1000 in
`/tmp/rp-r7-main-inspection/`. The full run's raw evidence is
`/tmp/rp-r7-full-qualified.log` and the RP Round 7 report.

Follow up in QF without weakening ownership: distinguish a transient exiting
process-table snapshot from persistent malformed routing data, potentially by
bounded fresh-snapshot retry. Continue to refuse persistent unclassifiable
routing, and never infer signal authority from a damaged prefix. RP leaves the
inherited runner and its fail-closed policy unchanged.
