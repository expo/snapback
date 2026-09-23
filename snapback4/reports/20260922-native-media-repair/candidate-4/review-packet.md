# Final candidate 4 — retain the test; preserve reviewed runtime

Frozen at 2026-09-23T00:58:01.288966+00:00. Astra xhigh.

Only asset-blob-lifecycle.test.mjs differs from frozen candidate 2: the new
trailing-terminator regression case covers LF, CR, CRLF, U+2028 and U+2029.
Each payload fills the expected four encoded characters for a three-byte Blob
but would decode to fewer bytes under a permissive decoder. The real fetchAsset
fallback rejects it and closes its Blob. All 23 focused tests pass against the
original candidate-2 runtime. The strict affected dependency closure typecheck
passes across 11 source files. Actual local argv/start/end/exit and outputs are
in local-execution.json, focused.log and typecheck.log.

## Disposition of candidate 3

The proposed `$`-anchor bypass did not reproduce in unflagged JavaScript on
Node 24.18.0: the original expression rejects all five tested terminators.
Candidate 3's explicit negative-lookahead endpoint was therefore unnecessary
complexity, not a confirmed product fix. At root's direction, assets.ts was
restored byte-for-byte from frozen candidate 2, while retaining the useful test.
Candidate 3's patch, manifest, source snapshot and checks remain preserved under
../candidate-3/. No historical review response or previous receipt was rewritten.

All runtime/config/version/doc inputs in the owned ten-file manifest are exact
candidate-2 bytes. Local dist/assets.js also matches the packed candidate-2
module's SHA256. The active native candidate-2 run therefore exercises the same
runtime source as final candidate 4. No remote source/dist/package edits, builds,
services or simulator operations were performed for candidates 3 or 4.
