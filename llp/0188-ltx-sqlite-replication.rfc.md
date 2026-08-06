# LLP 0188 — Continuous SQLite replication via a vendored LTX replicator

**Type:** RFC
**Status:** Draft
**Systems:** Storage, Backup and restore, Deployment, Control plane, CLI, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-08-06
**Related:** LLP 0007, LLP 0044, LLP 0057, LLP 0072, LLP 0081, LLP 0083,
LLP 0099, LLP 0111, LLP 0134, LLP 0158

## Summary

Snapback has no continuous replication of its SQLite databases anywhere in
the system. The local server writes a WAL-mode SQLite file
(`src/storage.rs`); durability beyond the local disk exists only as the
LLP 0057 quiesced backup/restore image and as control-plane backup
manifests that LLP 0072 and LLP 0111 specify for the hosted lane. LLP 0099
(Accepted) already *requires* a "streaming backup" to a separately
permissioned object store as the qualifying pre-apply checkpoint for the
container-VM migration executor — but no LLP owns the design of that
stream. This RFC proposes to fill the gap by adopting the LTX replication
lane that celld (Deno's self-hosted Durable Objects runtime,
<https://github.com/denoland/celld>, Apache-2.0) has already built in
Rust: a WAL-tailing replicator that ships LTX segments (Litestream's v0.5
replica format, spec at superfly/ltx) to an S3-compatible bucket, restores
a database from the bucket, and exposes the replicated position so a
caller can gate on durability.

The proposal is deliberately narrow: take the *replication lane* (the
`crates/ltx` crate and its conformance posture), not celld's runtime,
placement, or lease machinery. Those belong to the LLP 0083 prior-art
discussion of self-hosted DO substrates and are out of scope here.

## Motivation

1. **The local-first durability story has a hole.** A Snapback instance's
   effective RPO today is "time since the last `snapback auth backup`
   run." Continuous replication turns that into a bounded, measurable
   number (seconds of WAL tail) against a bucket the operator owns —
   matching the self-hosted posture LLP 0033/0083 record and the
   operator-owned-bucket shape celld demonstrates in production form.
2. **LLP 0099's checkpoint needs an owner.** The Accepted executor
   profile binds admission to "create and read back the streaming backup,
   restore it into isolation" — with the stream itself unspecified. An
   LTX stream whose replicated position is provably ≥ the admission's
   source position is exactly that artifact, and it composes with LLP
   0072's backup-manifest identities rather than replacing them.
3. **The engineering is substantially done, in our language, under our
   license.** celld's `crates/ltx` is a Rust port of Litestream v0.5
   (seeded from rustyriver, replication behavior and test vectors taken
   from Litestream v0.5.11, format pinned to superfly/ltx v0.5.1), with a
   conformance suite that verifies byte-for-byte output compatibility
   against the real Litestream binary (`differential_xtool`). Adopting it
   buys us a tested WAL reader, LTX encoder/decoder, restore path, and
   durability-position API instead of a from-scratch replication project.

## Prior art

- **Litestream / LTX.** Litestream v0.5 rebased its replica format on LTX
  (log-structured transactions, superfly/ltx), the format LiteFS
  introduced: page-level transaction files with checksums, compactable
  into snapshot levels, restorable to any retained transaction boundary.
  This is the de-facto standard for SQLite-to-object-store streaming.
- **celld.** Uses the same crate to get RPO=0 semantics: a cell's write is
  acknowledged only once the bucket holds it (~90 ms durable-write cost),
  and a cell restores from the bucket when its lease moves. We adopt the
  mechanism but not the default policy (see Design §3).
- **LLP 0022** surveyed Turso/Electric/PowerSync sync engines; those are
  *logical* sync products. LTX is physical page replication of one
  database file — a durability lane, not a sync lane — and does not
  overlap LLP 0008/0155's client-sync direction.

## Design

### 1. Vendor the crate, track upstream

Vendor celld's `crates/ltx` (Apache-2.0, attributions preserved) with a
pinned upstream commit and a provenance receipt, following the
`vendor/` + receipt discipline the repo already uses for skills. A
crates.io dependency is preferred if/when Deno publishes the crate
stably; vendoring is the default because the crate is young and we want
the conformance suite (upstream Litestream vectors + differential test)
running in our CI, not just theirs. Snapback-side glue lives in our tree;
the vendored crate stays patch-clean so upstream diffs stay reviewable.

### 2. Integration point: the storage engine, one database at a time

The replicator attaches to the data-plane database (`database.sqlite3`)
managed by `src/storage.rs`. Litestream-style replication takes over WAL
checkpointing (the replicator must observe every WAL frame before
checkpoint truncation), so the integration must route checkpoint control
through the replicator when replication is enabled. Scope for v1 is the
single per-instance data-plane DB; the auth keyring is *not* SQLite and
stays under LLP 0057's image semantics (see §5 and OQ2).

Object-store I/O goes through the existing S3-compatible seam
(`src/assets_s3.rs` — SigV4, qualified against live MinIO per LLP 0044)
rather than a second S3 client, into a **separately permissioned bucket
or prefix** per LLP 0111's backup posture — replication credentials must
not be readable through the application secret API (LLP 0099 §pre-apply
rule carries over unchanged).

### 3. Durability policy: bounded-RPO async by default, gated sync on demand

celld's RPO=0 default (ack after bucket write) is wrong for Snapback's
local-first posture — user-visible commits must not wait ~90 ms on a
bucket. The proposed modes:

- **`async` (default):** commits ack locally; the replicator ships the
  tail continuously and exposes `replicated_position`. The instance
  reports its current replication lag as an operational metric; the
  honest claim is "RPO ≤ observed lag," not zero.
- **`checkpoint` (on demand):** a caller (the LLP 0099 executor, the LLP
  0072 backup flow, `snapback replicate checkpoint`) requests proof that
  `replicated_position ≥ P` for a named commit position `P`, and blocks
  until the bucket confirms. This is the qualifying streaming-backup
  artifact: deterministic, read-back-verified, bindable into a
  `MigrationCheckpointV1` / LLP 0072 backup manifest by content identity.

### 4. Single-writer safety

Exactly one live process may replicate a given database to a given
prefix. LTX generations alone do not prevent a split-brain double-writer
(two servers pointed at one prefix after a botched migration). v1 rule:
the replication prefix embeds the LLP 0072 deployment identity and a
generation record written on attach; a replicator that finds a newer
generation than its own **halts replication and raises** rather than
overwriting. This is deliberately weaker than celld's CAS lease protocol
— Snapback's hosted lane already has an ownership authority (the control
plane); we need fencing, not placement.

### 5. Restore composes with LLP 0057

`snapback replicate restore` materializes a database from the bucket at a
chosen retained position and verifies integrity (`PRAGMA integrity_check`
plus LTX checksum continuity). A *full instance* restore is LTX restore
composed with the latest LLP 0057 keyring/manifest artifacts; the restore
CLI must refuse to present a data-plane-only restore as a full instance
restore. Fork (LLP 0158) may later source its snapshot from a retained
LTX position instead of the live SQLite backup API, but that is expressly
a follow-on, not part of this proposal.

### 6. Honesty and qualification

Per LLP 0134, no capability manifest claims replication until an
acceptance corpus passes. Sketch of the gates:

- **G1 (format conformance):** vendored crate's upstream vectors +
  differential test green in our CI on macOS and Linux.
- **G2 (local drill):** replicate a live instance under sustained write
  load to MinIO; kill the server mid-write; restore on a clean machine;
  verify integrity and bounded loss ≤ observed lag at kill time.
- **G3 (hosted binding):** the LLP 0099 executor consumes a `checkpoint`
  proof as its pre-apply streaming backup in a real drill, with the
  read-back-and-restore-into-isolation step executed, against the LLP
  0111 separately permissioned bucket.

## What this RFC deliberately does not take from celld

Lease-by-CAS placement, the bucket-as-control-plane coordination model,
the V8 runtime, and RPO=0-by-default all stay out. They are recorded as
prior art for the self-hosted-DO discussion (LLP 0083 should gain a celld
row beside Rivet), and some may be argued for later — but each is a
separate decision with its own blast radius, and bundling them here would
put a working durability lane behind an architecture debate.

## Open questions

1. **Vendor vs. dependency.** Confirm celld's `ltx` crate license
   metadata and publishing intent; if Deno publishes it on crates.io with
   semver discipline, prefer the dependency and keep only the conformance
   suite vendored.
2. **Auth-database coverage.** Should the auth SQLite database (distinct
   from the keyring bytes) join the replication set in v1, or is
   data-plane-only acceptable given LLP 0057 covers auth at lower
   frequency? Data-plane-only creates a restore-freshness asymmetry that
   must at least be surfaced in the restore receipt.
3. **Retention and compaction policy.** LTX supports compaction levels
   and point-in-time restore windows; pick a default retention (and its
   S3 cost story) and decide whether point-in-time restore is a v1
   user-facing feature or an internal drill capability.
4. **Fencing scheme details.** Is the generation-record-plus-halt rule of
   §4 sufficient for the Fly lane's failover story, or does LLP 0072 need
   a first-class replication-epoch it signs, mirroring the barrier-lease
   epochs LLP 0099 already binds?
5. **Local operator surface.** What does the self-hosted (non-Fly)
   operator configure — bucket URL + credentials in instance config, and
   does `snapback doctor`-style diagnosis gain replication-lag checks?
6. **Upstream tracking cadence.** celld is weeks old and "still
   evolving"; decide who re-pins the vendored crate and how upstream
   format changes (superfly/ltx version bumps) are absorbed.
