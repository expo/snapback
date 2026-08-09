# LLP 0188 G1 receipt

**Date:** 2026-08-09  
**Pinned celld commit:** `553ae73f83c87c3f7c7a5f73c32c2211d9d7341f`  
**Pinned `crates/ltx` tree:** `fccd82ba10dd8008bfe6d48056920d2299636878`  
**Local state:** passed; macOS/Linux GitHub workflow evidence is pending the
post-push run.

## Local qualification environment

- macOS 26.5.2 (25F84), Darwin 25.5.0, arm64
- rustc 1.97.0 (`2d8144b78 2026-07-07`)
- cargo 1.97.0 (`c980f4866 2026-06-30`)
- SQLite CLI 3.50.6
- Official Litestream v0.5.11 darwin-arm64 release archive, SHA-256
  `ed96599f041b65d798b705c6029f7673e641df3bf6b9ea21d6ce536f44a2ff5a`;
  extracted binary SHA-256
  `4fbbcacdfb5ee973a3e0e22326cb359fda8109658c9dd50a2c99b543d2a3da57`

Command:

```sh
LTX_LITESTREAM_BIN="$PWD/../tools/litestream" scripts/check-ltx-conformance
```

## Executed suites and results

| Suite | Passed | Failed | Ignored | Evidence |
|---|---:|---:|---:|---|
| `src/lib.rs` unit tests | 122 | 0 | 0 | Included golden LTX/WAL decoding and file-client conformance |
| `tests/conformance.rs` | 0 | 0 | 0 | Target executed; it contains no standalone test functions |
| `tests/faults_inject.rs` | 7 | 0 | 0 | Executed |
| `tests/fuzz_parsers.rs` | 7 | 0 | 0 | Executed |
| `tests/integration_file.rs` | 3 | 0 | 0 | Real-Litestream golden restore comparison executed, not skipped |
| `tests/integration_resilience.rs` | 3 | 0 | 0 | Executed |
| `tests/litestream_helpers.rs` | 24 | 0 | 0 | Litestream v0.5.11 vectors executed |
| `tests/property_roundtrip.rs` | 1 | 0 | 0 | Executed |
| `tests/differential_xtool.rs` | 5 | 0 | 0 | Forced real-binary oracle; details below |
| Rust doc tests | 0 | 0 | 0 | Target executed |
| **Total executed** | **172** | **0** | **0** | MinIO runtime suite excluded as described below |

`tests/integration_minio.rs` compiled successfully with the default `s3`
feature but was deliberately not executed in the default G1 run. It is a live
MinIO integration suite, not the G1 format oracle, and is separated behind
`LTX_RUN_MINIO=1`; when requested, the wrapper rejects its upstream skip path.

## Differential-leg evidence

The official v0.5.11 release prints `0.5.11` for `litestream version`, while the
pinned celld tests accept only a string beginning with `v0.5`. The conformance
wrapper first verifies that the real binary reports exactly 0.5.11, then adapts
only that version probe to `v0.5.11`; all replication and restore invocations
are executed by the verified real binary. This avoids a vendored source patch.

The run printed `running 5 tests`, printed no `skip`/`skipping` line, and ended:

```text
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

The five executed oracle cases were:

1. our write → real Litestream restore → logical database equality;
2. real Litestream write → our restore → logical database equality;
3. both restorers over our replica → byte-identical output;
4. both restorers over a real Litestream replica → byte-identical output;
5. real Litestream write → both restorers at a target TXID → equality.

The required negative test removed both Litestream environment variables and
used a PATH with no Litestream binary. It exited 1 before Cargo ran and printed:

```text
LTX_G1_LITESTREAM_MISSING: set LTX_LITESTREAM_BIN to the Litestream v0.5.11 binary or put litestream on PATH; the differential leg may not skip
```

## Provenance facts bound to this gate

The facts below were verified from files in the pinned commit and are detailed
with hashes and licensing evidence in [VENDOR-RECEIPT.md](VENDOR-RECEIPT.md):

- the crate was seeded from a read-only rustyriver snapshot on 2026-08-03;
- its replication behavior and test vectors target Litestream v0.5.11;
- its LTX format implementation targets superfly/ltx v0.5.1;
- its golden replica was produced by the real Litestream v0.5.11 tool; and
- `differential_xtool` covers both write directions, both byte-equality
  directions, and target-TXID restore.

The dedicated workflow runs the same wrapper on `macos-latest` and
`ubuntu-latest`, downloading checksum-pinned Litestream v0.5.11 release assets.
Cross-platform CI evidence can exist only after push, so the filesystem ticket
remains open until the orchestrator observes that run.
