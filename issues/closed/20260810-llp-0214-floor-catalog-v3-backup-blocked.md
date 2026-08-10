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

## Update (2026-08-10)

The backup regression is **confirmed real** independent of the DYLD red herring:
on the WIP, `cargo test --lib 'auth::'` **without** `DYLD_FRAMEWORK_PATH` still
fails 18 `auth::backup::` + 1 `auth::runtime` (current main is 25/0 without
DYLD). So catalog v3 genuinely breaks the backup format-1 manifest.

Correction: the earlier focused fix lane's "deadlock" was not a real deadlock —
its prompt set `DYLD_FRAMEWORK_PATH`, which hangs the SQLite online-backup path
(see the withdrawn hang ticket). Re-running the fix WITHOUT that override lets
the backup tests actually run, so this is tractable. Retrying.

## Resolved (2026-08-10) — LANDED

Unblocked and landed as commit `961b8be8c`. The backup regression was fixed by
extending the auth backup manifest to a closed **format-2** covering the
catalog-v3 table/state inventory + recovery-code keyring references (format-1
retained for v1/v2; all backup security assertions kept, not relaxed). The
earlier fix-lane "deadlock" was the DYLD_FRAMEWORK_PATH hang, not a real
deadlock — re-running tests without that override let the fix proceed.

Verified without DYLD: `auth:: 383/0`, `auth::backup:: 26/0`, `auth::throttle 7/7`,
schema drift check pass, ref-check clean. Floor acceptance tests
(guest create/claim + atomic collision, password register/auth/change +
recovery rotation + claims, last-authenticator rollback, assurance
kind/provenance separation, redaction fail-closed) all green. Merged cleanly
with the already-landed LLP 0215 budget code in auth_catalog_ops.rs.
