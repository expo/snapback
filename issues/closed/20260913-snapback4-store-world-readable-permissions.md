# Snapback 4: Store and asset files are created with the process umask

Status: Closed
Resolved: 2026-09-13
Priority: P1
Observed: 2026-09-13
Review finding: S07
Evidence: Code-traced; umask 022 on a typical macOS/Linux account yields mode 0644
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Related: [security review](../../llp/reviews/3000-security-review-20260913.md)

## Problem and reproduction

`Project::open_engine` does `create_dir_all(.snapback4/)` and `Store::open` creates `store.sqlite`, WAL/SHM, and `assets/` with the process umask. There is no `0o700` / `0o600`. The database holds argon2 password hashes, session digests, and every row. `assets/` holds uploaded bytes.

On a shared machine (CI user, university login, multi-user VPS) another account can copy the store and the photos. Slice one excludes at-rest encryption; that exclusion does not require world-readable files.

`serve` of a deployment directory has the same shape (`store.sqlite` beside `releases/`).

## Acceptance

- Create the data directory `0700` and the sqlite/WAL/SHM/asset files `0600` (Windows: equivalent ACLs, owner only).
- Tighten existing files on open if the process owns them, or refuse to open a world-readable store in `serve`.
- Cover `dev`, `serve`, memory-store asset temp dirs, and the native device sqlite path.

## Implementation locations

- [crates/snapback4/src/project.rs](../../snapback4/crates/snapback4/src/project.rs)
- [crates/snapback4-core/src/store.rs](../../snapback4/crates/snapback4-core/src/store.rs)
- [crates/snapback4-core/src/engine/mod.rs](../../snapback4/crates/snapback4-core/src/engine/mod.rs) (`store_asset`)

## Resolution — 2026-09-13

Private directories are created with mode 0700 and database/sidecar/asset files with 0600 on Unix, with existing owned files tightened on open. The database is created privately before SQLite opens it; the bundled Unix VFS inherits that mode for new WAL/journal/SHM files. Symlink/nonregular private entries are refused, while the intentional deployment database link is resolved before admission. Dev, deployment, memory assets, and native SQLite use the private-file helper. Non-Unix hosts fail closed until an owner-only ACL implementation exists. Permission, reopening, sidecar, and asset regressions pass.

Delivery validation and independent review for the current-main port are in
the [remediation record](../../llp/reviews/3000-security-remediation-20260913.md).
