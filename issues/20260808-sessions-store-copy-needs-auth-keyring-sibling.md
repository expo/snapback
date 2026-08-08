# Copying a sessions-mode database silently produces a store that cannot boot

**Opened:** 2026-08-08 · **Severity:** P2 (operational correctness / backup semantics) · also guide-gap

## Observed

The sessions auth provider keeps its keyring in a db-path-prefixed sibling
file (`<db>.auth-keyring.json`). A byte-identical copy of the database
alone refuses to boot with `SNAPBACK_AUTH_PROVIDER_UNAVAILABLE` (probed and
verified 2026-08-07: original reboots; clone fails; clone + copied keyring
sibling boots). Nothing in the guide or the diagnostics names the sibling;
the zb5-hot gate burned a full receipted attempt (v4) discovering it, and
no lane had ever booted a cloned sessions store before.

## Implications beyond the gate

Every backup, copy, migration, or fork flow that treats the `.sqlite3` file
as the complete durable state silently produces a dead (or worse, partially
alive) store. The WAL-strand ticket
(`issues/20260807-server-sigterm-strands-large-sqlite-wal.md`) compounds
this: a post-SIGTERM copy at scale can also miss WAL content.

## Ask

1. Define and document the complete durable-state set for a sessions store
   (db + WAL discipline + auth keyring + anything else path-bound), ideally
   with a supported `snapback` copy/export verb that captures it atomically.
2. Make the boot diagnostic name the missing sibling path explicitly.
3. Guide page for backup/copy semantics (guide-gap).

- **Claimed 2026-08-08:** session dc26442d (13-ticket sweep orchestrator) is executing this ticket now; sibling sessions should not duplicate.
