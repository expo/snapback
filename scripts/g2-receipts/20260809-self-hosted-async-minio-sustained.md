# LLP 0188 G2 self-hosted async replication receipt

> **Supersedes `20260809-self-hosted-async-minio.md`.** That earlier receipt was vacuous: its frontier wedged after the first shipment while its lag/loss comparison still passed.

- Date: 2026-08-09
- Source commit: `31ba6b706b58b3260906ae49c10184b123a55b1a` (working tree implementation under test)
- Store: `minio version RELEASE.2025-09-07T16-13-09Z (commit-id=07c3a429bfed433e49018cb0f78a52145d4bedeb)`, random loopback port, SigV4 path-style S3
- Segment encryption posture: `provider` (provider only; keyring snapshots were client-side XChaCha20-Poly1305 encrypted)
- Weaker custody consequence: a compromised host or same-generation clone can re-PUT history and seize/rewrite the head; stale-writer harmlessness is not claimed
- Acknowledged write transactions: 176
- Minimum payload bytes written: 720896 (the per-write title prefix is additional)
- Sustained-load proof: frontier advanced 30 times after the first shipment (required at least 5)
- Load-stop convergence: source version 151 reached zero observed lag before the crash-cut phase
- SIGKILL cut: local source version 176 after the one in-flight writer commit quiesced
- Restorable frontier at kill: LTX position 35
- Observed source-version lag at kill: 25 (< configured bound 100)
- Restored LTX position: 35
- Restored source version: 151
- Bounded loss: 25 <= observed lag 25 and 25 < configured bound 100
- Status at kill: degraded=`false`, error=`none`, errorDetail=`none`
- Integrity: `PRAGMA integrity_check` returned `ok`
- Pairing: exact governing `database.sqlite3.auth-keyring.json` was decrypted and validated against retained auth key ids
- Restore quarantine: LLP 0057 `restore-declaration.json` was present; the image was non-servable without bulk revocation
- Lineage: restored position equaled the fixed-head frontier
- Ahead-of-head restart: killed database reattached without a malformed-image error, converged to LTX position 37, and restored source version 176 exactly matched kill version 176
- Final restore integrity: `ok`
- Negative control: foreign-incarnation sidecar refused with `SNAPBACK_REPLICATION_ATTACH_REFUSED`

This receipt qualifies only the LLP 0188 self-hosted, single-incarnation, single-generation G2 lane on MinIO. Succession/epoch handover, hosted supervisor custody, per-credential store immutability, and non-MinIO providers remain unqualified.
