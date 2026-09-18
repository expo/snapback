# Snapback 4: the package has no root export, and six bounds-bar builders of eight paid their first loop guessing it

Status: Open
Priority: P3 (a repeated first loop with a packaging cause, self-attributed by every builder as their own error)
Date: 2026-09-18
Systems: snapback4 (packages/snapback4 export map; README; CLIENT-AND-OPERATIONS.md)
Related: LLP 3000.007 §20.22.7 (the bounds bar), §20.23; `benchmarks/runs/2026-09-17-snapback4-boundsbar-before/`,
`benchmarks/runs/2026-09-18-snapback4-boundsbar-after/`

## What the bar recorded

`snapback4@0.2.27` and `@0.2.29` export subpaths only — `./auth`, `./client`, `./contract`, `./local`, `./mock`, `./native`,
`./react`, `./server`, `./identity`, `./web`, `./worker` — and no `.`; the README of either pin has no `import … from "snapback4…"`
line (the subpath imports are in `CLIENT-AND-OPERATIONS.md`). A fresh builder's first move is `import … from "snapback4"`, and
Node answers `ERR_PACKAGE_PATH_NOT_EXPORTED`.

Across the eight bounds-bar attempts (four valid + one host-invalidated on 0.2.27; three on 0.2.29), six builders logged that
loop, every one self-attributed `agent-error`:

| Attempt | Loop line (the builder's own) |
| --- | --- |
| before run-1, loop 1 | "Assumed root client export and bare wire args; export unavailable and missing-argument wire replies" |
| before run-2, loop 2 | "Root package export absent; detached shell server did not persist" |
| before run-B1, loop 1 | "snapback4 has no root export" → "import snapback4/client" |
| before run-B2, loop 2 | "import createClient from snapback4 … ERR_PACKAGE_PATH_NOT_EXPORTED" |
| before run-B3, loop 3 | "guessed snapback4 root export for mintId is not exported" |
| after run-1, loop 1 | "Guessed root package export, then a background server exited with its shell; bare mutation arguments returned E_INPUT" |

Four of the same builders paid a second loop on the wire body — bare operation arguments instead of the `{args: …}` envelope
(before run-1 and run-B3; after run-1 and run-3). Neither loop is the builder's: the export map and the envelope are the package's
shape, and nothing the builder reads first says so. The loops are cheap individually (a minute or two each) and they are the
only loop class the wave-13 pin did not remove: the "after" record's four loops across three runs are all of this class.

## Why it matters for the reading

Both bars attribute loops from the builder's own log. A builder who blames itself for a packaging shape lowers Snapback's share
in the record; the derived-data session found the same self-blame in calibration #12's diary ("agent mistakes, not demonstrated
backend defects" over seven `Cannot use import statement outside a module` failures — `5b6779c56d`). Builder self-attribution
is a floor on Snapback's share, not a count.

## Options (for the author; the remove-vs-document question is open)

1. Add a root export that re-exports `snapback4/client` (the online tier, which every bar builder wanted first) — one line in the
   export map; the subpaths stay. The loop disappears without a documentation line.
2. Put the import line on the README's first screen (documents the shape instead of changing it — the surface budget went the
   other way in the "after"; prefer 1).
3. Make the bar's runner re-attribute this loop class (`ERR_PACKAGE_PATH_NOT_EXPORTED`, bare-arguments `E_INPUT`) to `docs`
   regardless of the builder's word, so the before/after ledgers stop under-counting it.
