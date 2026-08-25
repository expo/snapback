# LLP 0192: The store durable-state set and the supported copy verb

**Type:** Decision
**Status:** Active
**Systems:** Storage, Auth, Assets, Admin, Operations, Developer experience
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-08
**Revised:** 2026-08-25 (Active: linked into `llp/foundation/` as part of the
LLP v2 larger kernel)
**Revised:** 2026-08-21 (the packaged `dev-fresh` reset now requires the
canonical CLI-owned managed-store path, validates the database before deleting
anything, and refuses shared-directory or symlink ambiguity)
**Revised:** 2026-08-08
**Related:** LLP 0018, LLP 0036, LLP 0044, LLP 0057, LLP 0061, LLP 0143,
LLP 0158, LLP 0189,
issues/20260808-sessions-store-copy-needs-auth-keyring-sibling.md,
issues/20260807-server-sigterm-strands-large-sqlite-wal.md

## Context

A Snapback store looks like one file. It is not.

On 2026-08-07 the zerobugs `zb5-hot` gate burned a complete receipted attempt
(`v4`) discovering that a byte-identical copy of a sessions-mode
`.sqlite3` file will not serve auth: the provider keeps its signing keyring in
a db-path-prefixed sibling, `<db>.auth-keyring.json`. The copy booted, reported
`SNAPBACK_AUTH_PROVIDER_UNAVAILABLE`, and named nothing. The operator had to
probe it in isolation — original reboots, clone fails, clone plus copied
keyring boots — to learn what was missing. No lane had ever booted a cloned
sessions store before, which is why three earlier receipted attempts and every
prior lane missed it
(`issues/20260808-sessions-store-copy-needs-auth-keyring-sibling.md`).

The keyring is not the only sibling. An audit of `crates/snapback/src/` found more than a dozen
path-bound siblings of the database filename plus several directory-bound
members, spread across auth, config, assets, admin, telemetry, branches, and
fork lifecycle. Two partial registries already existed and disagreed:
`managed_startup_paths` in `crates/snapback/src/cli.rs` (twelve db-bound paths, thirteen where
the target-instance restore reservation applies) and
`SIDECAR_CUSTODY` in `crates/snapback/src/instance_fork.rs` (ten entries, four of them prose
labels like `"assets/blobs tree"` rather than derived paths). Nothing
mechanically reconciled them, and neither is reachable by an operator asking
"what do I copy?".

The consequence is general, not specific to one gate: **every backup, copy,
migration, fork, and disaster-recovery flow that treats the `.sqlite3` file as
the complete durable state silently produces a dead — or worse, partially
alive — store.** The WAL-strand defect
(`issues/20260807-server-sigterm-strands-large-sqlite-wal.md`) compounds it: a
post-SIGTERM `cp` at scale can also miss committed WAL content.

LLP 0057 already specifies a hardened, quiesced, WAL-folding capture for the
*auth unit* (`snapback auth backup`), and explicitly disclaims the rest: "A
full instance backup may additionally include LLP 0036 config, but the auth
unit is successful only when these exact database and keyring bytes share the
one quiescence boundary." Nobody ever wrote the full-instance half. That is
what this document decides.

## Decision

### D-1: the durable-state registry

`crates/snapback/src/store_state.rs` owns one enumeration, `durable_state_members(db)`, that
returns every member of a file-backed store's durable state derived from the
database path. It is the single source of truth. `SIDECAR_CUSTODY` and
`managed_startup_paths` remain for their own purposes (fork custody, startup
path management) but a test asserts every db-path-bound member of this
registry is classified by both, so the three cannot silently diverge.

Each member carries one of six dispositions, and the disposition — not
folklore — decides what a copy does with it:

| Disposition | Meaning for a copy |
| --- | --- |
| `Database` | The SQLite main database. Captured by online backup, never by `cp`. |
| `Folded` | Content that the online backup already folds into the image. Copying it separately is forbidden. |
| `Required` | Path-bound durable state a copy MUST carry or the copy is not the same store. |
| `Optional` | Durable but reconstructible; the copy carries it when present. |
| `InstanceLocal` | Belongs to the *running instance*, not the store. Copying it wedges or misleads the copy. |
| `Refuse` | State whose presence means this store cannot be copied by this verb at all. |

The registry as of this decision:

**`Database`** — `<db>`.

**`Folded`** — `<db>-wal`, `<db>-shm`, `<db>-journal`. The
descriptor-bound online backup (LLP 0057 §Consistent backup) folds all
committed WAL pages into the image and normalizes the image header to rollback
mode. This is the WAL discipline: *never copy a `-wal` beside a database, and
never trust a database copied without one.*

**`Required`** — `<db>.auth-keyring.json` (auth signing keyring; a marked
catalog never re-mints it, so losing it silently invalidates every live
session), `<db>.config.json` (LLP 0036 config and secrets),
`<db>.operation-detail-keyring.json` (without it, existing protected
operation-detail rows are unreadable),
`<dir>/completeness-proof-keyring.json` (an invalid or absent file is a
boot-fatal `SNAPBACK_COMPLETENESS_PROOF_KEYRING_INVALID`), and
`<dir>/assets/blobs/` (finalized blobs; a database row referencing a missing
blob is a hard `ASSET_CUT_INCOMPLETE`).

**`Optional`** — `<db>.admin-token`, `<db>.console-credentials`,
`<dir>/resume-keyring.json`. Each is re-minted on demand; carrying them
preserves continuity, and carrying the admin token also **copies local admin
authority**, which the copy verb states in its receipt rather than hiding.

**`InstanceLocal`** — `<db>.snapback.lock`, the target-instance restore
reservation one directory up, `<db>.telemetry{,-wal,-shm,-journal}`,
`<dir>/assets/staging/`, and the ready-file siblings
(`<ready>.admin-token`, `<ready>.secret-read-root`, `<ready>.impersonation`).
Telemetry is deliberately local observability history, not store state; the
copy declares the exclusion instead of pretending the history moved.

**`Refuse`** — `<dir>/.<db>.in-app-branches-v1/` when non-empty (managed
branch workspaces hold `.immutable-base` snapshots that cannot be rebuilt from
head) and `<dir>/fork-mint-receipt.json` (a derived-fork instance has lineage
this verb would falsify). A store carrying either refuses the copy and names
the owning verb — `snapback fork` — instead of producing a wrong copy quietly.

**Rationale for `Refuse` over "copy anyway".** LLP 0158's fork custody already
established that a Snapback-owned artifact with no declared disposition must
fail closed (`SNAPBACK_FORK_CUSTODY_UNCLASSIFIED`). The same discipline applies
here: an unclassified or lineage-bearing member makes a copy that boots and is
wrong, which is strictly worse than a copy that refuses.

#### D-1a: reset ownership boundary

The packaged `snapback reset --dev-fresh` may erase the complete registered
store only for its canonical CLI-owned target,
`<project>/.snapback/dev.sqlite3`. That path is the proof that the
directory-shared `assets/blobs/`, `resume-keyring.json`, and
`completeness-proof-keyring.json` belong to the managed dev store being reset.
A custom `--db` path is ambiguous: another database in the same directory has
the same derived directory-shared members, so resetting either database cannot
safely assign those members to itself. `dev-fresh` refuses that case rather
than performing a partial one-file reset or deleting another store's custody.

Before removing any member, the database path must be a regular file or absent,
and the managed-store and asset roots must be non-symlink directories. Only the
owned `assets/blobs/` member receives directory-recursive removal; file members
are removed non-recursively, and unregistered files in `.snapback/` survive.
This keeps whole-store reset semantics on the paved managed target without
turning an arbitrary path into recursive deletion authority.

### D-2: the store export verb

`snapback store export --db <db> --output <dir>` publishes one directory that
**boots directly**:

```
<dir>/<db-basename>
<dir>/<db-basename>.auth-keyring.json
<dir>/<db-basename>.config.json
<dir>/resume-keyring.json
<dir>/assets/blobs/...
<dir>/store-export.json
```

`snapback start --db <dir>/<db-basename>` serves the copy. This is the
deliberate difference from `snapback auth backup`, whose output uses the
neutral `database.sqlite3` / `auth-keyring.json` layout and requires
`snapback auth restore` plus a `--restored-from-backup` declaration before it
can bind. A restore is a destructive, credential-revoking recovery of an
instance's identity. An export is a **faithful copy**: same sessions, same
tokens, same admin authority. The two are different products and keep
different verbs.

Publication is atomic by the same rule LLP 0057 uses: stage into an
unpredictable same-parent directory, `fsync` every member and the staging
directory, one rename, `fsync` the parent. Failure before the rename publishes
nothing; a failure at or after the rename is commit-ambiguous and says so.

The database member is captured with the descriptor-bound online backup, so
export is **WAL-consistent by construction** — its completeness does not depend
on how the previous run ended. This is the property that makes it the right
answer to the SIGTERM WAL-strand defect: a store whose server was `SIGKILL`ed
mid-run, leaving a 4 KiB database beside a 1.3 MiB stranded WAL, exports
completely, and no `PRAGMA wal_checkpoint` race is involved. Like
`snapback auth backup`, the verb itself runs offline under the instance lock
and refuses (naming the owning server) rather than copying a live directory;
`snapback store describe` takes no lock and answers while the server serves.

The capture is shared with `snapback auth backup` but is deliberately
catalog-agnostic: the auth unit asserts an exact recognized catalog on both
sides of the copy, while a whole-store export makes no such claim, because a
store whose auth catalog is still dormant is a copyable store.

`snapback store describe --db <db>` prints the same registry with per-member
presence and disposition. It is the operator's answer to "what do I copy?" and
the mechanical form of this document.

### D-3: push-token custody

The staged image is produced by the same descriptor-bound path
`snapback auth backup` uses, which removes the device-push-token registry rows
under LLP 0143 D-1 device-token custody. An export therefore carries schema but
not push-token bytes. This is a declared property of the verb, recorded in
`store-export.json`, not an accident: an export is an export surface, and
token custody does not travel across one.

### D-4: the diagnostic split

`SNAPBACK_AUTH_PROVIDER_UNAVAILABLE` has two audiences and now two shapes.

The **request-path 503** returned to HTTP clients is unchanged: no path, no
"keyring", no details. LLP 0057 §Security and redaction governs it and it
reaches unauthenticated callers.

The **startup/operator diagnostic** recorded by
`LocalSnapback::record_startup_diagnostics` now carries
`{durableStateMember, path, cause, remedy}` — the exact sibling path, whether
it is `missing` / `corrupt` / `unavailable`, and a pointer to the copy verb. No
key id and no key material, ever. A path is not secret material; the operator
who can read the diagnostic can already read the directory.

The prior behavior was mechanically pinned by a test asserting the startup
diagnostic contained neither `"keyring"` nor the database path. That assertion
encoded the defect. It is replaced by two assertions — the startup diagnostic
names the exact path, and the request-path diagnostic still does not — so the
split cannot regress in either direction.

## Consequences

- Operators, agents, and gates get one answer for "what is this store" and one
  verb for "copy it". `demos/zerobugs/control/tests/acceptance/gates/zb5-scale-support.mjs`
  is the cautionary case that motivated this; a gate that needs a bootable
  clone should call the verb rather than re-deriving the sibling list.
- The guide gains [`guide/operating/backup-and-copy.md`](../guide/operating/backup-and-copy.md),
  which teaches the set, the three verbs (`store describe`, `store export`,
  `auth backup`/`auth restore`), and the anti-pattern this decision exists to
  kill: `cp app.sqlite3 elsewhere/`.
- New path-bound durable state added anywhere in `crates/snapback/src/` must be added to the
  registry in the same change. The divergence test makes an omission loud
  rather than latent until someone copies a store.
- This decision does not claim a hosted or Cloudflare backup story. It is a
  local-target decision; hosted targets keep their own honest posture
  (LLP 0060 / `guide/auth/targets.md`).

## Open questions

- **OQ1.** Should `store export` grow a paired `store import` that re-homes an
  export under a different database basename? Today the export's member names
  are derived from the source basename, so re-homing means renaming siblings by
  hand. Deferred until an operator actually needs it.
- **OQ2.** Should telemetry history be an opt-in export member
  (`--include-telemetry`) rather than a flat exclusion? Deferred; nobody has
  asked to move telemetry history with a store.
- **OQ3.** The `Refuse` disposition for managed branch workspaces means a
  branching store cannot be exported at all. The alternative — teaching the
  export to carry `.in-app-branches-v1/` and its `.immutable-base` snapshots —
  is real work with its own custody questions and is deferred to whoever needs
  it.

## Status

Accepted 2026-08-08 and implemented in the same landing: the registry, both
`store` verbs, the diagnostic split, the guide page, and the acceptance tests
in `crates/snapback/tests/store_export_v1.rs`.
