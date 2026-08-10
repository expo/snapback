# LLP 0214 floor (catalog v3) blocked on the backup interaction — dedicated program needed

**Opened:** 2026-08-10
**Area:** Auth / identity core / catalog v3 / auth backup
**Status:** blocked-partial; WIP preserved at `origin/wip/llp-0214-floor-partial` (commit 16f59d620)

## What

The LLP 0214 wave-1c floor (catalog v3, `defineAuth`, assurance model, guest +
password + recovery, provisioning hook, `ctx.auth` claims) was attempted as one
codex xhigh lane. It produced a substantial, **compiling** partial — the
assurance model (`src/auth/identity_core.rs`: AssuranceKind/Provenance incl.
Rehearsal, DeploymentPosture), `src/storage/auth_identity.rs` (~976 lines,
password/argon2 + guest/claim), catalog-v3 ops, and `defineAuth` codegen — but:

1. **Real regression:** catalog v3 broke the auth backup subsystem.
   `cargo test --lib 'auth::backup::' -- --test-threads=1` fails 18/25 with
   `SNAPBACK_AUTH_BACKUP_INVALID "backup manifest is not a valid closed
   format-1 object"` (src/auth/backup.rs:1777). Catalog v3 adds
   identity/session/credential/assurance state the format-1 manifest does not
   round-trip. Verified a real regression (fails alone, serially — not the
   parallel SQLite-backup flake).
2. **Deadlock:** a focused fix lane deadlocked during reproduce —
   `storage::auth::tests::auth_backup_excludes_push_registry_custody_rows`
   hung >11 min at 0% CPU, suggesting catalog v3 also perturbs the backup
   quiescence path, not only the manifest serialization.

## Why blocked

This is a foundational schema change (catalog v3) whose backup interaction —
extend the manifest to format-2 covering v3 tables while preserving every
backup security property (owner-only perms, hash integrity, atomic publish,
quiescence blocking provider writes + key rotation), and resolving the
quiescence deadlock — needs careful, focused work, not a fire-and-forget lane.

## Next

Dedicated program: (a) design the catalog-v3 backup manifest (format-2 +
version recognition per 0057), (b) resolve the quiescence deadlock, (c) get
`auth::backup::` + full `auth::` green, (d) then land the floor (splitting into
catalog-v3+backup, then defineAuth/assurance, then password/guest/hook is
recommended over one lane). WIP to build from: `origin/wip/llp-0214-floor-partial`.
The three commissioned Specs (0213/0214/0215) are already on main; 0213 slices
1 and B are landed and green.
