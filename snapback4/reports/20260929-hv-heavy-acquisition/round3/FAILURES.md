# Round 3 failure ledger

## Detecting controls (expected failures)

- `witness-before.log.gz`: the new SQLite allocation/storage observer test fails on
  round-2 `batch.rs`. It succeeds under under-reserved ceilings and decodes the
  80,000-byte private witness. This is the requested negative control.
- `idb-before.log.gz`: three new Chromium modes fail on round-2 `web-idb.ts`, each
  observing three bucket writes after another built-in adapter migrates to 4.
  These are the requested negative controls, not qualification failures.

## Affected-check corrections (ours)

`browser-affected.log.gz` initially reports 131 passed / 3 failed, including the
parent suite counted as a failure. The two failing leaves were:

1. `IndexedDB save resolves on transaction completion, not request success`:
   its metadata-only stub has no `get`. Unconditional marker probing was
   unnecessary for metadata. Corrected production code reads the row marker
   only for row/stage/base changes, retaining the original metadata path.
2. `cold row batches use 64 bounded buckets in one strict transaction`:
   observed 65 gets, formerly expected 64. The additional transaction-local
   marker read is required by this repair. The test now distinguishes exactly
   64 bucket reads and one marker read, retaining all writes, strictness, rows,
   values and metadata assertions.

`browser-recheck.log.gz`: 48/48 pass across pages, review and navigation. No old
assertion about transaction completion or bucket counts was weakened.

## Wasm experiments

The final artifact must not grow, with or without Binaryen. A debug assertion
expressed by lifting a row image into a local changed release instruction order
and increased optimized gzip by 22 B; an inline block trial increased it by
47 B (logs retained). Explicit debug-only checks now preserve the original
release insertion expression. Both final binaries are byte-identical to the
merged baseline. The fixed cap remains exceeded; this is retained HV size debt,
not an environmental failure or a permitted budget increase.

One build shell used the repository-relative `snapback4/` prefix despite its
working directory already being `snapback4/`: the preparatory Python edit
raised FileNotFoundError. No file was changed; corrected from the repository
root. The subsequent cached build was not used as final-source evidence.

## Full-suite corrections (ours)

The full client stage found two failed leaves:

- `IndexedDB model: reset termination before-commit preserves one complete transaction`
- `IndexedDB model: reset termination after-commit preserves one complete transaction`

Both failed `fixture must hold r`. The fake IndexedDB model returned a read
result without delivering `onsuccess`, then completed the write transaction
before its marker callback could enqueue writes. This was a model deficiency
exposed by the new correct IDB request ordering; the real Chromium cases pass.
The model now counts pending read callbacks and waits before completing, with
read-your-writes semantics. Its before/after-commit interruption rules and all
row, staging, base, metadata and outbox assertions remain unchanged.
`reset-model-recheck.log.gz` passes 2/2. No production change followed these failures.

The single full run exits 1 with exactly:

```text
== 2 failure(s) in 1405 s
   wasm build
   client tests
```

The full suite was not restarted after corrections. All 79 serial models pass.
The remaining wasm-cap red is ours (retained HV debt), not baseline or
environmental. Baseline and environmental failures: zero. REPORT.md lists all
failed stages/leaves, their measured sizes and the final focused checks.
