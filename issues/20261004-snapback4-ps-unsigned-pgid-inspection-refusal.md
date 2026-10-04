# Snapback 4: ps emits unsigned-max PGID during qualification inspection

Status: Open
Date: 2026-10-04
Scope: Snapback 4 qualification process inspection
Related: LLP 3000#publication-suite-under-contention

NL round 8's first integration suite on eb1000 refused cleanup of
`packages/snapback4/test/unicode.test.mjs` with `TEST_PROCESS_INSPECTION`.
All 12 assertions passed; the file wrapper failed. The retained `ps` row is:

```text
1021219       0 4294967295 1000 Sun Oct  4 05:32:40 2026 X+ MainThread
```

The first error is `malformed ps row: pid/ppid/pgid`. Its exact raw bytes:

```text
MTAyMTIxOSAgICAgICAwIDQyOTQ5NjcyOTUgMTAwMCBTdW4gT2N0ICA0IDA1OjMyOjQwIDIwMjYgWCsgTWFpblRocmVhZA==
```

`scripts/test-processes.mjs` rejects routing-prefix integers above
`0x7fffffff` before ownership classification or per-PID disappearance checks.
The file is byte-identical to `origin/main` **6e4967479f**, SHA-256
`fca0821b5264a58aa93936ddc8589733d8e2aee46c3c1d8acc9241edc37a683e`.
A read-only replay using `processTable` with the captured stdout and an
`exists: () => false` stub reproduces this refusal without inspecting or
signalling any process. This establishes the inherited parser boundary,
not the origin, ownership or lifetime of the captured process.

Keep unclassifiable routing prefixes fail-closed. Investigate why this host's
`ps` produced the unsigned-max group and whether there is a safe supported
classification. Do not infer ownership, ignore a failed enumeration, or
weaken cleanup checks to make qualification green. The earlier malformed
proc-stat ticket is resolved; this record retains a different ps-prefix case.

Evidence on eb1000: `/tmp/sb4-nl-r8-verification/ps-row.txt` and
`unicode-inspection-refusal.log`; the NL report's Round 8 section records the
suite and rerun results. No runner implementation changed in this integration.
