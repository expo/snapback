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

## Resolution (2026-08-08)

All three asks landed, governed by
[LLP 0192](../llp/0192-store-durable-state-set.decision.md) (Decision,
Accepted) with a dated amendment to LLP 0057.

**1. The durable-state set is declared, and the copy verb exists.**
`src/store_state.rs` owns one mechanical registry, `durable_state_members(db)`,
covering 21 members with six dispositions (`Database`, `Folded`, `Required`,
`Optional`, `InstanceLocal`, `Refuse`). The keyring was not the only sibling —
config, the operation-detail keyring, the completeness-proof keyring, and the
`assets/blobs` tree are all `Required`, and two members
(`resume-keyring.json`, `completeness-proof-keyring.json`) are *directory*-named
rather than db-named, so two stores in one directory share them. Every path
comes from the same helper the runtime uses, and a test pins the registry
against `managed_startup_paths` (with a documented allow-list) so new durable
state cannot be added silently.

- `snapback store describe --db <db>` prints the set with per-member presence.
  It takes no lock and answers while the server is serving.
- `snapback store export --db <db> --output <dir>` publishes a directly
  bootable directory plus a `store-export.json` manifest, atomically, with
  LLP 0057's three publication states. The database member reuses the
  descriptor-bound online backup (now split so it is catalog-agnostic), so the
  export is **WAL-consistent by construction**. Managed-branch workspaces and
  derived-fork lineage `Refuse` rather than producing a wrong copy.

This also answers the compounding concern from
`20260807-server-sigterm-strands-large-sqlite-wal.md`: export completeness does
not depend on how the previous run ended.

**2. The boot diagnostic names the missing sibling.** The startup/operator
`SNAPBACK_AUTH_PROVIDER_UNAVAILABLE` now carries
`{durableStateMember, path, cause, remedy}` — the exact
`<db>.auth-keyring.json` path and whether it is `missing` / `corrupt` /
`unavailable`. The request-path 503 that reaches HTTP clients stays redacted;
tests pin both directions.

**3. Guide page.** `guide/operating/backup-and-copy.md`, with the
`operating.store-durable-state` capability row and retrieval-eval seed 18.

### Evidence

- `cargo test --lib`: 2261 passed, 0 failed (includes 6 new `store_state`
  tests: export-boots, db-only-copy-diagnosis, WAL-fold, refusal,
  unpublished-on-existing-output, registry/startup divergence).
- End-to-end on the built binary: started a store, `SIGKILL`ed it leaving a
  4 KiB `app.sqlite3` beside a 1.29 MiB stranded `-wal`, exported it, and
  booted `snapback start` on the exported copy (`ready: true`,
  `diagnostics: []`). `store export` against the still-running server refused
  and named the owning pid/URL.

### Found and fixed along the way

- `backup_auth_catalog_into` re-proved an *auth catalog* on the produced image,
  so a whole-store export of a dormant-catalog store failed. Split so the
  shared capture proves only that the image reopens standalone.
- The export swallowed the underlying capture error — the same
  "diagnostic names nothing" defect this ticket is about. It now names it.
- Two new codes were added to the reviewed HTTP diagnostic inventory in
  `src/server.rs` (500 fail-safe class, operator-plane only).
