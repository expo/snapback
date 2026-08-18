---
title: Continuously replicate a local SQLite store
id: operating.replication
order: 10
audience: agent-first
capabilities: [operating.replication]
authorities: [llp/0188-ltx-sqlite-replication.rfc.md, crates/snapback/src/replication.rs, crates/snapback/src/cli.rs, scripts/g2-replication-drill, scripts/g2-receipts/20260809-self-hosted-async-minio-sustained.md]
examples: [scripts/g2-replication-drill]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-10
reviewed-authorities-digest: sha256:9b727f6437aaba9ddc8a5ca69cf043f818a3f6e9c109e65925fed2d341d564d7
---

# Continuously replicate a local SQLite store

> **Local target only.** This page describes the experimental self-hosted
> local lane. Hosted replication, supervisor custody, succession, and the G3
> checkpoint substitution are not shipped.

The contributor-source `snapback` binary can continuously copy a file-backed
SQLite instance to a filesystem or S3-compatible target as LTX segments. It
also copies the auth keyring as separately encrypted, content-addressed
snapshots. Use this lane to reduce a self-hosted instance's disaster-recovery
window; it is physical durability, not client sync and not a general hosted
backup product.

**Aliases:** replication, Litestream, LTX, SQLite streaming backup, continuous
backup, disaster recovery, RPO, restore point, restorable frontier, MinIO,
`snapback replicate`, `SNAPBACK_REPLICATION_TARGET`.

This is an **Experimental Guide classification only**. No target capability
manifest advertises replication, and passing the local G2 drill does not make
the hosted or full LLP 0188 corpus true.

## Configure the self-hosted async lane

Replication is off when `SNAPBACK_REPLICATION_TARGET` is absent or empty. When
it is set, a file-backed server requires an externally provisioned encryption
key file and starts the async replication runtime with the instance:

```sh
umask 077
openssl rand 32 > /srv/snapback/replication-key

export SNAPBACK_REPLICATION_TARGET='s3://my-backups/production'
export SNAPBACK_REPLICATION_REGION='us-east-1'
export SNAPBACK_REPLICATION_ACCESS_KEY_ID='...'
export SNAPBACK_REPLICATION_SECRET_ACCESS_KEY='...'
export SNAPBACK_REPLICATION_KEY_FILE='/srv/snapback/replication-key'

snapback start --db /srv/snapback/app.sqlite3
```

The complete environment surface is:

| Variable | Meaning |
| --- | --- |
| `SNAPBACK_REPLICATION_TARGET` | Required to enable the lane. Accepts `file:///absolute/or/resolved/path` or `s3://bucket/prefix`. |
| `SNAPBACK_REPLICATION_KEY_FILE` | Required when enabled. Owner-only file containing exactly 32 raw bytes; encrypts every keyring snapshot. |
| `SNAPBACK_REPLICATION_ENDPOINT` | Optional S3-compatible endpoint override. Setting it selects path-style requests, as needed by MinIO. |
| `SNAPBACK_REPLICATION_REGION` | Optional S3 region override. |
| `SNAPBACK_REPLICATION_ACCESS_KEY_ID` | Optional S3 access-key id. |
| `SNAPBACK_REPLICATION_SECRET_ACCESS_KEY` | Optional S3 secret access key. |
| `SNAPBACK_REPLICATION_SESSION_TOKEN` | Optional temporary S3 session token. |
| `SNAPBACK_REPLICATION_PREFIX` | Optional prefix override; otherwise the path from the S3 target is used. |
| `SNAPBACK_REPLICATION_INTERVAL_MS` | Positive async capture interval in milliseconds; defaults to 250 when absent or invalid. |

The key file is not recoverable from the bucket. Back it up in custody separate
from the replicated instance and test clean-machine access to it: losing it
makes the encrypted keyring snapshots unrecoverable, and a database restored
without its governing keyring is deliberately refused.

Keyring snapshots are client-side XChaCha20-Poly1305 encrypted on both target
kinds. Segment posture is weaker in this experimental lane: S3 reports
`segmentEncryption: "provider"`, while a file target reports `"none"`.
`status.weakerPosture` states the concrete single-custody consequence. Do not
infer append/head credential separation, store-enforced immutability, or
stale-writer harmlessness from successful upload.

## Read the restorable frontier and lag

```sh
snapback replicate status --db /srv/snapback/app.sqlite3
```

With replication disabled, this still returns a
`snapback.replication-status.v1` JSON object with `enabled: false`. An enabled
status reports:

| Field | Read it as |
| --- | --- |
| `replicatedPosition` | The database position committed by the authoritative remote head. |
| `keyringCoverage` | The greatest head-committed position with a governing encrypted keyring snapshot. |
| `frontier` | The **restorable frontier**: the lesser of `replicatedPosition` and `keyringCoverage`. |
| `observedLag.positions` | Local LTX transaction positions ahead of the remote head at observation time. |
| `observedLag.sourceVersions` | Local Snapback source versions ahead of the remote head at observation time. |
| `degraded` / `error` / `errorDetail` | Whether the lane has stalled or halted, and the stable `SNAPBACK_REPLICATION_*` reason. |
| `segmentEncryption` / `weakerPosture` | The actual segment confidentiality and custody claim, including its downgrade. |

The frontier, not `replicatedPosition` alone, is the disaster-recovery
boundary. A segment that has reached the target is not restorable until the
head also commits keyring coverage for it. RPO language must therefore use the
observed frontier lag; `degraded: true` is an availability/durability incident,
not permission to keep claiming the old bound.

## Force one offline checkpoint

Stop the server first, then run the checkpoint against the same file-backed
database and environment:

```sh
snapback replicate checkpoint --db /srv/snapback/app.sqlite3
```

The command takes the instance lock, captures outstanding WAL, publishes
durable keyring coverage, verifies the remote state, performs the final SQLite
checkpoint, and prints the resulting replication status. It refuses when the
database is missing or replication is disabled.

This landed command is the self-hosted G2 operation. Its status output is not
LLP 0188's complete hosted `MigrationCheckpointV1` proof envelope, and it does
not qualify the unbuilt G3 substitution.

## Restore only within the frontier

Restore into a new, absent directory. Omitting `--position` chooses the current
restorable frontier; an explicit position is an LTX transaction id and must be
positive and no greater than that frontier:

```sh
snapback replicate restore --output /srv/restores/2026-08-10
# or: snapback replicate restore --output /srv/restores/2026-08-10 --position 417
```

The command verifies the remote lineage and LTX chain, selects and decrypts
the keyring snapshot governing that position, runs SQLite integrity checks,
and writes:

```text
/srv/restores/2026-08-10/
  database.sqlite3
  database.sqlite3.auth-keyring.json
  restore-declaration.json
```

Its JSON result deliberately says `servable: false` and prints a
`restoreDeclarationId`. The restored image is quarantined until the existing
LLP 0057 declared-restore path performs bulk session revocation:

```sh
snapback start \
  --db /srv/restores/2026-08-10/database.sqlite3 \
  --restored-from-backup <restoreDeclarationId>
```

Do not copy or reuse the source database's
`<db>.replication.json` sidecar. Restore and fork outputs must not inherit the
source replication incarnation; this experimental implementation refuses a
missing/foreign/divergent attach rather than silently minting succession.

## Run the G2 crash-and-restore drill

`scripts/g2-replication-drill` is the qualification path for the landed local
slice. It uses a real MinIO server, sustained Snapback writes, a clean
convergence boundary, a deliberate ahead-of-head `SIGKILL`, clean-directory
restore, integrity and exact-keyring pairing, ahead-of-head resume, and a
foreign-incarnation refusal. It never self-skips.

Provide an already-built current binary plus MinIO and SQLite when running the
drill from a prepared checkout:

```sh
SNAPBACK_G2_BIN=/absolute/path/to/snapback \
LTX_MINIO_BIN=/absolute/path/to/minio \
SQLITE3_BIN=/usr/bin/sqlite3 \
scripts/g2-replication-drill
```

The script also requires `curl` with `--aws-sigv4` and Ruby. Its retained
receipt is
`scripts/g2-receipts/20260809-self-hosted-async-minio-sustained.md`. That
receipt qualifies only MinIO, self-hosted single custody, one incarnation, and
one generation. It explicitly does not qualify succession, hosted epoch
handover, per-credential immutability, or another provider.

## Anti-patterns

- **Do not call the raw database position restorable.** Keyring coverage can
  hold the frontier behind it.
- **Do not keep the only encryption key beside the replicated database.** A
  clean-machine restore then loses both copies in one failure.
- **Do not serve the restore directory directly.** Start with the emitted
  restore declaration so bulk revocation runs before bind.
- **Do not copy the replication sidecar into a restore or fork.** Incarnation
  fencing treats it as foreign or divergent state.
- **Do not promote G2 into a hosted or capability-manifest claim.** The hosted
  custody, succession, retention, checkpoint-proof, and G3 work remains open.
