# guide-gap: `snapback replicate` surface has no guide page or capability-index row

**Opened:** 2026-08-10
**Systems:** Guide, Storage, Backup and restore
**Related:** LLP 0061 §5, LLP 0188, commit 6c90c98b5

The landed LLP 0188 self-hosted replication lane added operator surface
the guide does not cover: `snapback replicate status|checkpoint|restore`,
the SNAPBACK_REPLICATION_* configuration (target/endpoint/credentials/
key file/interval), the mandatory keyring-snapshot encryption key file,
the restorable-frontier semantics an operator reads from `status`, the
non-servable-until-declared-restore rule on `restore` output, and the
G2 drill (`scripts/g2-replication-drill`). Per LLP 0061 the capability
index should carry a row (experimental; no capability-manifest claim —
LLP 0188 claims nothing until its corpus passes) and a guide page should
absorb the operator journey. Until then this is an explicit GAP.
