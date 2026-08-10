# SUPERSEDED — LLP 0188 G2 self-hosted async replication receipt

> This receipt is vacuous and does not qualify G2: its frontier wedged after
> the first shipment. It is superseded by
> `20260809-self-hosted-async-minio-sustained.md`.

- Date: 2026-08-09
- Source commit: `31ba6b706b58b3260906ae49c10184b123a55b1a` (working tree implementation under test)
- Store: `minio version RELEASE.2025-09-07T16-13-09Z (commit-id=07c3a429bfed433e49018cb0f78a52145d4bedeb)`, random loopback port, SigV4 path-style S3
- Segment encryption posture: `provider` (provider only; keyring snapshots were client-side XChaCha20-Poly1305 encrypted)
- Weaker custody consequence: a compromised host or same-generation clone can re-PUT history and seize/rewrite the head; stale-writer harmlessness is not claimed
- Acknowledged write transactions: 200
- Payload bytes written: 819200
- SIGKILL cut: local source version 200 after the one in-flight writer commit quiesced
- Restorable frontier at kill: LTX position 2
- Observed source-version lag at kill: 14
- Restored LTX position: 2
- Restored source version: 186
- Bounded loss: 14 <= 14
- Status at kill: degraded=`true`, error=`SNAPBACK_REPLICATION_CAPTURE_FAILED` (retryable capture/upload/store races are admissible only after a fully head-committed live frontier was observed)
- Integrity: `PRAGMA integrity_check` returned `ok`
- Pairing: exact governing `database.sqlite3.auth-keyring.json` was decrypted and validated against retained auth key ids
- Restore quarantine: LLP 0057 `restore-declaration.json` was present; the image was non-servable without bulk revocation
- Lineage: restored position equaled the fixed-head frontier
- Negative control: foreign-incarnation sidecar refused with `SNAPBACK_REPLICATION_ATTACH_REFUSED`

This receipt qualifies only the LLP 0188 self-hosted, single-incarnation, single-generation G2 lane on MinIO. Succession/epoch handover, hosted supervisor custody, per-credential store immutability, and non-MinIO providers remain unqualified.
