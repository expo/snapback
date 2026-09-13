# LLP 0188 G2f: full fencing acceptance matrix (succession, orphans, immutability probes)

**Opened:** 2026-08-10
**Systems:** Storage, Backup and restore, Testing
**Related:** LLP 0188 §4/§7, vendor/celld-ltx, scripts/g2-replication-drill

The landed G2 lane (commit 6c90c98b5) implements refusal-only fencing:
single generation, resume via the checksum-continuous-prefix rule, refusal
on rewind/divergence/foreign sidecar. LLP 0188 §7's G2f matrix requires
the rest before the fencing claims graduate: explicit succession with
traversable genesis chains and the successor's initial coverage record at
the divergence position; multi-succession restore with lineage selection
and manufactured-ambiguity refusal; orphan generation prefixes (crash
after genesis, before head CAS) excluded without spurious refusals then
lifecycle-collected; injected backdated/duplicate/conflicting coverage
records inert (unreachable) or refused (reachable); divergent-tip
advancement refused; crash windows around keyring snapshot/coverage
publication including rotation-then-prune mid-drill; encrypted-snapshot
missing-key/wrong-key failure paths; pin-preserving compaction; and the
store-enforced immutability probes (overwrite/delete and head-write
denied to the append credential) with per-store qualification receipts
(note: `assets_s3.rs` has only If-None-Match create-if-absent; the lane
uses celld-ltx's object_store client — record which mechanism satisfies
CAS and per-credential denial on MinIO).
