# LLP 0188 implementation: vendor celld's ltx crate and pass G1

**Opened:** 2026-08-06
**Systems:** Storage, Backup and restore, Testing, CI
**Related:** LLP 0188 (Accepted 2026-08-06, rev `4baee93955f2820c`), LLP 0044, LLP 0057, LLP 0134

LLP 0188 is Accepted: continuous SQLite replication via a vendored LTX
replicator lifted from celld (`crates/ltx` — Rust port of Litestream
v0.5, format superfly/ltx v0.5.1, conformance-tested byte-for-byte
against the Litestream binary). This ticket is the first implementation
increment: **vendoring + gate G1**, which proceeds independently of the
four dated amendments (0057/0072/0099/0111 — drafted 2026-08-06,
Proposed, pending author ratification; they gate the hosted lane and the
0057-contract restore claim, not G1/G2 or the self-hosted lane).

**Scope (G1, per LLP 0188 §1 + §7):**

1. Vendor `crates/ltx` at a pinned upstream commit with a provenance
   receipt (Apache-2.0 attributions preserved; patch-clean except, if
   required, a storage-backend adapter — record the storage-seam finding
   either way).
2. Verify at the pinned commit: crate + transitive license metadata and
   required notices; provenance of the ported test vectors and of the
   reference Litestream binary the differential test drives.
3. Run the upstream vectors + `differential_xtool` in our CI on macOS
   and Linux with the reference Litestream binary **required present** —
   upstream self-skips without it; a skipped leg is a G1 **failure**.
   The G1 receipt captures the provenance facts as verified at the
   pinned commit, not by README reference.
4. Decide vendor-vs-crates.io (LLP 0188 OQ1) based on Deno's publishing
   posture at implementation time; record in the receipt.

**Explicit non-scope:** G2 (local kill-drill), G2f (fencing matrix), G3
(hosted binding), the replication runtime integration into
`src/storage.rs`, and any capability-manifest claim — LLP 0188 claims
nothing until the full corpus passes, and a replication capability id
additionally owes an LLP 0134 `MaturityIntroductionRecordV1`
(experimental-first) when it first appears.

**Follow-ons (file separately when G1 lands):** G2/G2f local drill
against MinIO (needs the object-store protocol with CAS +
per-credential immutability qualification — note `src/assets_s3.rs`
implements only `If-None-Match: *` create-if-absent today); frontier +
attach/succession runtime work; then the amendment-gated hosted lane.

## Progress — 2026-08-09

- Vendored celld's `crates/ltx` from commit
  `553ae73f83c87c3f7c7a5f73c32c2211d9d7341f` under
  `vendor/celld-ltx/`, preserving the pinned source, tests, fixtures,
  references, Apache-2.0 license, and attribution README. Only the manifest's
  workspace dependency inheritance and standalone-workspace attachment differ;
  the complete inventory is in `VENDOR-RECEIPT.md`.
- Kept the crate's existing `object_store`-based S3/R2/MinIO client after
  inspecting the storage seam, as LLP 0188 §2 permits at vendoring time.
- Added `scripts/check-ltx-conformance`. The local macOS run executed 172 tests:
  167 non-MinIO tests plus all 5 `differential_xtool` cases, with no failures,
  ignores, or self-skips. The separate missing-Litestream run failed before
  Cargo with `LTX_G1_LITESTREAM_MISSING`, as required.
- Added `.github/workflows/ltx-conformance.yml` for `macos-latest` and
  `ubuntu-latest`, using checksum-pinned Litestream v0.5.11 release assets.
  The cross-platform CI run can happen only after push and remains the final G1
  evidence for the orchestrator to collect; this ticket therefore stays open.
- G2, G2f, G3, runtime/storage integration, and capability claims remain outside
  this increment and retain the follow-on scope above.

## G2 progress — 2026-08-09

- Added the off-by-default LLP 0188 self-hosted async lane using the
  provenance-receipted `vendor/celld-ltx` path dependency. The replicator is the sole checkpoint
  owner while enabled, attaches before readiness publication, and fences one
  incarnation/one generation with a database-adjacent sidecar plus a
  conditionally updated fixed head. Rewind, checksum divergence, foreign
  sidecars, and stale-writer head-CAS loss refuse or halt with coded errors.
- Added immutable, digest-addressed, XChaCha20-Poly1305 encrypted auth-keyring
  snapshots and coverage records. Snapshot/coverage durability precedes any
  dependent head advance, and the operator surface reports the conservative
  minimum of database position and keyring coverage as the restorable frontier.
- Added `snapback replicate status`, `checkpoint`, and the offline
  database-plus-keyring `restore` command. Restore verifies celld output with
  SQLite integrity and retained auth-key references, and explicitly remains
  non-servable until the LLP 0057 declared-restore/bulk-revocation composition.
- Added focused file-client tests and `scripts/g2-replication-drill`. The dated
  receipt under `scripts/g2-receipts/` records the live MinIO SIGKILL/load,
  exact lag/loss bound, paired restore, integrity result, lineage cut, and the
  foreign-sidecar negative control.
- Deliberately deferred LLP 0188 succession and epoch handover, generation
  rotation, hosted supervisor custody, hosted checkpoint proof envelopes,
  append/head credential separation, and store-enforced immutability
  qualification beyond the MinIO CAS note. The G2 lane therefore makes no
  hosted or multi-writer claim: status states that a compromised host or
  same-generation clone can re-PUT history and seize/rewrite the head.
  Provider-encrypted S3 segments and unencrypted `file://` segments are also
  reported honestly there.

## G2 wedge correction — 2026-08-09

- The first G2 receipt was invalid: it accepted `loss <= observed lag` even
  though the frontier stopped after its first shipment. Reproduction exposed
  the hidden cause as `capture WAL as LTX: EOF`; the database itself remained
  valid while celld-ltx's WAL shadow stopped advancing.
- The pinned celld port had explicitly deferred Litestream v0.5.11's
  `SQLITE_FCNTL_PERSIST_WAL` initialization. Continuous writer-process churn
  disproved the port's premise that keeping the capture connection open was
  sufficient. `vendor/celld-ltx/src/db.rs` now restores that lifecycle
  operation on both capture connections and exposes it to Snapback's primary,
  pooled-reader, registered-writer, and short-lived status-read connections.
  SQLite's VFS bit is connection-local; covering only the capture handle still
  allowed another Snapback connection to run a close-time checkpoint and leave
  a retained WAL with a zeroed header. The source/test divergence is enumerated in
  `vendor/celld-ltx/VENDOR-RECEIPT.md`.
- Degraded sidecars and `replicate status` now preserve both the stable error
  code and the underlying detail. The replacement G2 drill requires at least
  five distinct head commits after the first shipment, zero-lag convergence
  after load, lag and restored-version bounds below 100 commits, and an exact
  ahead-of-head SIGKILL/restart/restore before it can issue a receipt. The
  earlier vacuous receipt is retained only as an explicitly superseded record.
- `tests/replication_sustained_v0.rs` drives 100 mutations through a real
  `snapback start`/`snapback run` server with a `file://` replica while a second
  Snapback-owned read/write connection opens and closes between batches. Its
  negative-control run with only the primary connection's persistent-WAL setup
  removed wedged after the second batch with
  `SNAPBACK_REPLICATION_CAPTURE_FAILED` and the surfaced detail
  `capture WAL as LTX: io error: No such file or directory (os error 2)`; the
  restored implementation passes and restores the exact final source version.
- The replacement live MinIO receipt records 27 frontier advances after the
  first shipment, load-stop convergence at source version 151, a 25-version
  ahead-of-head SIGKILL cut (below the 100-version bound), clean reattachment,
  and an integrity-checked exact final restore at source version 176.

## Resolution — 2026-08-09

G1 complete and exceeded: vendor/celld-ltx landed at 553ae73f with
provenance receipt and forced-differential conformance
(scripts/check-ltx-conformance; 172 tests incl. 5/5 differential against
the real Litestream v0.5.11 binary; skipped leg = failure), CI green on
the ltx-conformance workflow (run 31337385024). The G2 self-hosted async
lane also landed (commit 6c90c98b5): frontier, encrypted keyring
snapshots, refusal fencing, snapback replicate CLI, non-vacuous MinIO
kill-drill with receipt, and a sustained-writes regression test. Root
cause fixed en route: the upstream port omitted Litestream's
persistent-WAL lifecycle (vendored divergence enumerated in
VENDOR-RECEIPT.md; upstream report to denoland/celld is a follow-up).
Remaining LLP 0188 work (G2f succession cases, hosted G3 under the
ratified amendments) proceeds separately. Closed.
