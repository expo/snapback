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

## Resolution — 2026-08-10

`guide/operating/replication.md` landed (operator page grounded in LLP 0188,
`src/replication.rs`, `src/cli.rs`, and the retained G2 receipt): the full
`SNAPBACK_REPLICATION_*` surface, 32-byte key-file custody, segment/keyring
posture, restorable-frontier and lag semantics, `status` / offline
`checkpoint` / quarantined `restore`, restored keyring use, and the MinIO G2
drill. Guide index routing added; `guide/capabilities.md` carries the
Experimental row with no capability-manifest, hosted, succession, or G3
claim. Unshipped LLP 0188 legs remain unclaimed by design (tracked by the
G2f/G3 tickets).
