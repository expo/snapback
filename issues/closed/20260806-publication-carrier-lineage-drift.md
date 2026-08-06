# Local publication carriers lagged their implementation lineage

**Status:** Resolved
**Opened:** 2026-08-06
**Resolved:** 2026-08-06
**Systems:** Publication, local storage, conformance
**Related:** LLP 0110, LLP 0135, LLP 0166

The relation-activity, sequence-allocation, and local persistent-store
publication gates all refused because their governed carriers still pinned an
older `src/storage.rs` digest after the day's Rust landings. The same mismatch
reproduced with Node 24.18.0 outside the keep-going sweep, so it was repository
lineage drift rather than a missing worktree artifact or toolchain difference.

## Resolution

After the owning Rust changes were complete, the governed
`scripts/refresh-publication-carrier.mjs` path recomputed source and receipt
digests and updated the embedded manifest/test anchors. No verifier or
qualification requirement was weakened.

Verification with Node 24.18.0:

- `tests/conformance/relation-activity-publication-v1.mjs` — passed
- `tests/conformance/sequence-allocation-publication-v1.mjs` — passed
- `tests/conformance/local-persistent-store-publication-v1.mjs` — passed
