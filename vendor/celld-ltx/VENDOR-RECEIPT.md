# celld-ltx vendor receipt

**Vendored:** 2026-08-09  
**Upstream repository:** <https://github.com/denoland/celld>  
**Pinned commit:** `553ae73f83c87c3f7c7a5f73c32c2211d9d7341f`  
**Pinned `crates/ltx` tree:** `fccd82ba10dd8008bfe6d48056920d2299636878`

The 43 files in the pinned `crates/ltx` tree were copied from a Git archive of
that commit. The intentional local changes are enumerated below; unlisted
scripts, references, golden fixtures, `README.md`, and `LICENSE` remain
blob-identical to the pinned tree.

## Provenance verified from the pinned tree

The provenance chain below comes from files in the pinned commit, now preserved
in this directory; it does not depend on the current contents of an upstream
branch or website.

- The pinned [Cargo.toml](Cargo.toml) describes the source as “Vendored
  2026-08-03 from rustyriver,” identifies rustyriver as Apache-2.0, and says it
  is a Rust reimplementation of Litestream v0.5 and the LTX format.
- The pinned [README.md](README.md) says the code was “Seeded on 2026-08-03
  from a read-only snapshot of rustyriver” and that celld owns this snapshot
  rather than tracking a rustyriver branch.
- The same README pins Litestream to **v0.5.11** and records that replication
  behavior and test vectors were ported for wire-compatible interoperability.
  Its test section says `differential_xtool` checks LTX reads and writes
  byte-for-byte against the real Litestream binary in three directions.
- [tests/fixtures/golden/MANIFEST.md](tests/fixtures/golden/MANIFEST.md) records
  that the committed replica tree was produced by the real Litestream v0.5.11
  binary (commit prefix `016c3687`) and explains which reader and differential
  tests consume those bytes.
- The README pins the LTX reference implementation to **superfly/ltx v0.5.1**.
  [reference/ltx-format.md](reference/ltx-format.md) independently records that
  its byte layout was derived from `reference/ltx-go` at v0.5.1, and
  `src/ltx.rs` identifies the corresponding v0.5.1 implementation files.

The package is `version = "0.0.0"` and `publish = false` at the pinned commit,
so no stable crates.io publication is offered by this source snapshot. LLP
0188's vendor path remains the applicable choice.

## License and notice verification

The crate declares `Apache-2.0`. Its full Apache License 2.0 text is preserved
at [LICENSE](LICENSE) with SHA-256
`cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.
The pinned README's rustyriver, Litestream, and Superfly attribution block is
also preserved byte-for-byte (SHA-256
`ad2ddd3153cb4e753cf2b809d154faa76f7165c83cfa74cd0a603cc6154aac71`).
The pinned crate has no separate `NOTICE` file.

The following direct dependency versions were resolved by `cargo tree
--manifest-path vendor/celld-ltx/Cargo.toml --depth 1 -e normal,build,dev` on
2026-08-09. License expressions and license/notice filenames were read from
each resolved crates.io package's Cargo registry metadata and package root.

| Direct dependency | Resolved version | Scope | Registry license metadata | Packaged license / notice files |
|---|---:|---|---|---|
| `async-trait` | 0.1.92 | normal | MIT OR Apache-2.0 | `LICENSE-APACHE`, `LICENSE-MIT` |
| `bytes` | 1.12.1 | normal | MIT | `LICENSE` |
| `futures-util` | 0.3.33 | normal | MIT OR Apache-2.0 | `LICENSE-APACHE`, `LICENSE-MIT` |
| `hex` | 0.4.3 | dev | MIT OR Apache-2.0 | `LICENSE-APACHE`, `LICENSE-MIT` |
| `lz4_flex` | 0.11.6 | normal | MIT | `LICENSE` |
| `object_store` | 0.11.2 | normal | MIT/Apache-2.0 | `LICENSE.txt`, `NOTICE.txt` |
| `proptest` | 1.11.0 | dev | MIT OR Apache-2.0 | `LICENSE-APACHE`, `LICENSE-MIT` |
| `reqwest` | 0.12.28 | normal, optional/default `s3` | MIT OR Apache-2.0 | `LICENSE-APACHE`, `LICENSE-MIT` |
| `rusqlite` | 0.31.0 | normal | MIT | `LICENSE` |
| `serde` | 1.0.229 | normal | MIT OR Apache-2.0 | `LICENSE-APACHE`, `LICENSE-MIT` |
| `serde_json` | 1.0.151 | normal | MIT OR Apache-2.0 | `LICENSE-APACHE`, `LICENSE-MIT` |
| `tempfile` | 3.27.0 | dev | MIT OR Apache-2.0 | `LICENSE-APACHE`, `LICENSE-MIT` |
| `thiserror` | 2.0.20 | normal | MIT OR Apache-2.0 | `LICENSE-APACHE`, `LICENSE-MIT` |
| `tokio` | 1.53.1 | normal and dev | MIT | `LICENSE` |
| `tracing` | 0.1.44 | normal | MIT | `LICENSE` |

The resolved graph contained 225 registry packages beyond `celld-ltx`; every
one had non-empty license metadata. The expressions observed were:

| Count | License expression |
|---:|---|
| 128 | MIT OR Apache-2.0 |
| 31 | MIT |
| 18 | Unicode-3.0 |
| 12 | Apache-2.0 OR MIT |
| 9 | MIT/Apache-2.0 |
| 5 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| 3 | Apache-2.0 OR ISC OR MIT |
| 2 each | Unlicense/MIT; Unlicense OR MIT; MIT OR Apache-2.0 OR Zlib; MIT OR Apache-2.0 OR LGPL-2.1-or-later; ISC; BSD-2-Clause OR Apache-2.0 OR MIT |
| 1 each | Zlib OR Apache-2.0 OR MIT; BSD-3-Clause; Apache-2.0 OR BSL-1.0; Apache-2.0 AND ISC; Apache-2.0 / MIT; Apache-2.0; (MIT OR Apache-2.0) AND Unicode-3.0 |

Two resolved registry packages carry notice files. The direct dependency
`object_store` 0.11.2 packages this required notice, preserved here in the
receipt as well as in the registry artifact:

> Apache Arrow Object Store  
> Copyright 2020-2024 The Apache Software Foundation  
> This product includes software developed at The Apache Software Foundation.

The transitive build dependency `cfg_aliases` 0.2.2 packages `NOTICES.md`,
which preserves the MIT notice for code derived from `tectonic_cfg_support`.
No required notice found in the resolved packages was removed or replaced.

## Storage-seam finding

The vendored crate already defines its own `ReplicaClient` backend protocol in
`src/client/mod.rs` and ships both file and object-store implementations.
`src/client/object_store.rs` constructs its own
`object_store::aws::AmazonS3Builder`, supports S3/R2/MinIO configuration, and
implements the `ReplicaClient` operations directly. Per LLP 0188 §2's
decided-at-vendoring-time clause, this vendor keeps that client. It does not add
an adapter over Snapback's separate SigV4 asset client. Conditional head/CAS
and credential-immutability work required by later fencing gates remains later
integration scope; G1 does not claim it.

## Divergences from the pinned upstream tree

1. Every `workspace = true` dependency in `Cargo.toml` was replaced with the
   explicit version, default-feature setting, and inherited features declared
   by celld's pinned workspace root. In particular, `rusqlite` remains exactly
   `0.31`; Snapback also pins 0.31, and `libsqlite3-sys` has
   `links = "sqlite3"`, so these versions must never diverge.
2. An empty `[workspace]` table (plus its explanatory comment) was appended to
   `Cargo.toml` so this crate is a standalone workspace rather than joining a
   parent workspace.
3. `src/db.rs` now calls
   `sqlite3_file_control(SQLITE_FCNTL_PERSIST_WAL)` while initializing both
   managed connections, exports that narrow initializer for Snapback's other
   connections to the same WAL, and tests that the setting is enabled. The
   pinned celld port explicitly deferred this Litestream v0.5.11 lifecycle
   operation on the premise that its capture connection kept the WAL alive.
   Snapback's G2 sustained-writer drill disproved that premise: an application
   writer in a separate process could close or restart the WAL underneath the
   long-lived capture reader, leaving capture halted at
   `capture WAL as LTX: EOF`. The local divergence restores the behavior of the
   claimed upstream semantic reference and keeps the capture frontier live
   across writer churn.

There are no fixture, script, reference, README, or license changes. No storage
adapter was required.
