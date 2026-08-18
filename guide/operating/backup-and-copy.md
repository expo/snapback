---
title: Back up, copy, and move a store
id: operating.backup-and-copy
order: 9
audience: agent-first
capabilities: [operating.store-durable-state]
authorities: [llp/0192-store-durable-state-set.decision.md, llp/0057-auth-provider-protocol.spec.md, crates/snapback/src/store_state.rs, crates/snapback/src/cli.rs, crates/snapback/src/auth/backup.rs, crates/snapback/src/auth/runtime.rs]
examples: [crates/snapback/src/store_state.rs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:d7a40a97571ef8ca095a38d8bed21070410b646277c209f5344dbd49c35b277a
---

# Back up, copy, and move a store

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

**A Snapback store is not one file.** `app.sqlite3` is the largest member of
its durable state, not the whole of it. Auth keys, config and secrets,
operation-detail keys, completeness-proof keys, and finalized asset blobs all
live in path-bound siblings of that database. Copy the `.sqlite3` alone and you
get a store that boots and is wrong: sessions stop resolving, config reads come
back empty, protected operation detail is unreadable, and asset rows point at
blobs that are not there.

This page is the answer to three questions: what is the durable state, how do I
copy it, and how do I get it back after a disaster.

**Aliases for the thing you are probably searching for:** backup, back up,
restore, copy database, clone database, duplicate store, move store, migrate
store, snapshot, disaster recovery, `cp app.sqlite3`, sqlite backup, WAL,
`auth-keyring.json`, missing keyring, `SNAPBACK_AUTH_PROVIDER_UNAVAILABLE`.

These CLI verbs are **contributor-source** today: they exist in the source
`snapback` binary and are not yet part of a published `@expo/snapback-*`
closure. Build from source to use them.

## Ask the store what it is made of

Never guess the sibling list. Ask:

```sh
snapback store describe --db .snapback/dev.sqlite3
```

It prints every member of the durable-state set with its path, its disposition,
and whether it is present right now. It is read-only and does not need the
instance lock, so you can run it against a store while the server is serving.

## The durable-state set

Six dispositions, and the disposition decides what a copy does:

| Disposition | What it means |
| --- | --- |
| `Database` | The SQLite main database. Captured by SQLite's online backup, never by `cp`. |
| `Folded` | Already folded into the captured image. Copying it separately is a bug. |
| `Required` | A copy that omits it is not the same store. |
| `Optional` | Durable but re-minted on demand; carried when present. |
| `InstanceLocal` | Belongs to the running instance, not the store. Copying it wedges or misleads the copy. |
| `Refuse` | Its presence means this store cannot be copied by this verb at all. |

For a store at `<db>` in directory `<dir>`:

| Member | Path | Disposition |
| --- | --- | --- |
| `database` | `<db>` | `Database` |
| `sqliteWal` / `sqliteShm` / `sqliteJournal` | `<db>-wal`, `<db>-shm`, `<db>-journal` | `Folded` |
| `authKeyring` | `<db>.auth-keyring.json` | `Required` |
| `configStore` | `<db>.config.json` | `Required` |
| `operationDetailKeyring` | `<db>.operation-detail-keyring.json` | `Required` |
| `completenessProofKeyring` | `<dir>/completeness-proof-keyring.json` | `Required` |
| `assetBlobs` | `<dir>/assets/blobs/` | `Required` |
| `adminToken` | `<db>.admin-token` | `Optional` |
| `consoleCredentials` | `<db>.console-credentials` | `Optional` |
| `resumeKeyring` | `<dir>/resume-keyring.json` | `Optional` |
| `instanceLock` | `<db>.snapback.lock` | `InstanceLocal` |
| `targetInstanceReservation` | `<dir>.snapback.restore.lock` | `InstanceLocal` |
| `telemetry` (+ companions) | `<db>.telemetry*` | `InstanceLocal` |
| `assetStaging` | `<dir>/assets/staging/` | `InstanceLocal` |
| `managedBranchWorkspaces` | `<dir>/.<db-name>.in-app-branches-v1/` | `Refuse` |
| `forkMintReceipt` | `<dir>/fork-mint-receipt.json` | `Refuse` |

Two members keep **fixed names in the database's directory** rather than
db-prefixed names: `resume-keyring.json` and
`completeness-proof-keyring.json`. Two databases in one directory share them.
That is worth knowing before you put two stores side by side.

`<db>.auth-keyring.json` is the one that bites first. It holds the signing keys
for the auth catalog, and a marked catalog **never re-mints it** — startup
deliberately refuses to invent replacement keys for sessions that already
exist. A database copied without it boots with a `Ready` catalog and no way to
sign or verify email-code challenges.

## Copy a store

```sh
snapback store export --db .snapback/dev.sqlite3 --output /backups/dev-2026-08-08
```

The output is a directory that **boots directly**:

```text
/backups/dev-2026-08-08/
  dev.sqlite3
  dev.sqlite3.auth-keyring.json
  dev.sqlite3.config.json
  resume-keyring.json
  completeness-proof-keyring.json
  assets/blobs/...
  store-export.json
```

Serve the copy with no further ceremony:

```sh
snapback start --db /backups/dev-2026-08-08/dev.sqlite3
```

`store-export.json` records what was carried, what was excluded and why, and
the export's declared properties:

```json fragment reason="manifest shape; digests and timestamps are per-export"
{
  "formatVersion": 1,
  "sourceDatabaseBasename": "dev.sqlite3",
  "members": [{ "id": "authKeyring", "file": "dev.sqlite3.auth-keyring.json", "disposition": "Required" }],
  "excluded": [{ "id": "sqliteWal", "disposition": "Folded", "reason": "folded into the captured image by the online backup" }],
  "declaredProperties": { "walFolded": true, "carriesAdminAuthority": true, "carriesLiveSessions": true }
}
```

### It is WAL-consistent, and that matters

The database member is captured with SQLite's online backup API bound to the
staged file descriptor. Every committed page in the WAL is folded into the
image, and the image's header is normalized to rollback mode so it stands
alone. Consequences:

- **You do not need a clean shutdown.** A store whose server was `SIGKILL`ed —
  or whose shutdown stranded a large WAL — still exports completely, because
  the online backup reads committed WAL content rather than trusting the
  database file alone. There is no `PRAGMA wal_checkpoint` to race. This
  matters more than it sounds: a bare instance killed mid-run can leave a 4 KiB
  `.sqlite3` beside a 1.3 MiB `-wal`, so `cp app.sqlite3` copies essentially
  nothing.
- **Never copy a `-wal` file beside a database.** The exported directory has no
  `-wal` or `-shm` sibling by design, and one appearing next to an export is a
  sign somebody opened the copy, not that the copy was incomplete.

The export runs offline under the instance lock, exactly like
`snapback auth backup`. Against a running server it refuses and names the
owner:

```text
SNAPBACK_STORE_EXPORT_INVALID
  Snapback database is already owned by another local server:
    db: .snapback/dev.sqlite3
    server: http://127.0.0.1:51670
    pid: 57921
```

Stop the server and re-run. `snapback store describe` has no such
restriction — it takes no lock and answers while the server serves.

### Publication is atomic

The export stages into an unpredictable sibling directory, fsyncs every member,
renames once, and fsyncs the parent. Every exit reports one of three states:

| `publicationState` | Meaning |
| --- | --- |
| `Unpublished` | Nothing exists at the output path. The staging directory was cleaned up. |
| `Published` | The complete directory is durable at the output path. |
| `CommitAmbiguous` | The rename was attempted and something after it failed. A complete unit **may** exist at the output path; validate or remove it yourself. |

Only `Unpublished` may be described as "published nothing."

### What an export deliberately is and is not

An export is a **faithful copy**. It carries live sessions, agent tokens, and —
when the admin token is present — local admin authority over the copy. Treat
the output directory as being exactly as sensitive as the original store, and
do not hand somebody an export you would not hand your admin token to.

It does **not** carry device push-token bytes: the staged image drops the
push-token registry rows under LLP 0143 device-token custody, because an export
is an export surface and token custody does not travel across one. The schema
survives; the tokens do not.

It **refuses** rather than lying when the store carries state it cannot
faithfully copy: a non-empty managed-branch workspace directory, or a
`fork-mint-receipt.json` marking the store as a derived fork. Both refuse with
`SNAPBACK_STORE_EXPORT_REFUSED` naming the member. For a derived deployment,
use [local instance forks](./instance-forks.md) instead — that verb owns
lineage, scrubbing, and TTL.

## Copy versus restore versus fork

Three verbs, three different products. Pick by what you want to be true
afterwards:

| You want | Verb | Sessions and credentials afterwards |
| --- | --- | --- |
| A second store that behaves exactly like this one | `snapback store export` | Preserved — same sessions, same tokens, same admin authority |
| To recover an instance's auth unit from a disaster | `snapback auth backup` then `snapback auth restore` | Destroyed on purpose — restore revokes and requires an explicit `--restored-from-backup` declaration before the instance may bind |
| An independent, finite-lived development instance from realistic rows | `snapback fork create` | Rotated — fresh instance, authorization-stream, admin-token, and resume-keyring identities |

`snapback auth backup` publishes the neutral `database.sqlite3` /
`auth-keyring.json` layout that `snapback auth restore` consumes; it is not
directly bootable, and that is deliberate. `snapback store export` publishes a
bootable layout named after your database and does not revoke anything.

## Recover from a disaster

```sh
snapback auth backup --db .snapback/dev.sqlite3 --output /backups/auth-2026-08-08
# ... later, into a wholly absent instance directory:
snapback auth restore --from /backups/auth-2026-08-08 --db /srv/recovered/dev.sqlite3
# the restore prints a declarationId; the next start must present it:
snapback start --db /srv/recovered/dev.sqlite3 --restored-from-backup <declarationId>
```

The declaration is the safety interlock: a restored instance refuses to bind
until an operator explicitly says "yes, this is a restore," so a backup
directory can never be silently served as if it were the original.

## Diagnose a bad copy

A store copied without its keyring records this at startup — the message names
the exact file it wants:

```text
SNAPBACK_AUTH_PROVIDER_UNAVAILABLE
  email-code auth provider is unavailable: the auth keyring sidecar is missing
  durableStateMember: authKeyring
  path: /srv/copy/dev.sqlite3.auth-keyring.json
  cause: missing
```

`cause` is `missing`, `corrupt`, or `unavailable`. Read it from
`recentDiagnostics` in `snapback inspect`, or from the server's startup output.

The **503 returned to HTTP clients** carries the same code with no path and no
details. That asymmetry is deliberate: the operator gets the path, and an
unauthenticated caller does not learn your filesystem layout. Do not go looking
for the path in a client response — run `snapback store describe` instead.

## Anti-patterns

- **`cp app.sqlite3 elsewhere/`.** The defect this page exists to kill. It
  drops the keyring, config, operation-detail keys, completeness-proof keys,
  and every asset blob, and it may drop committed WAL content on top of that.
  Use `snapback store export`.
- **`cp app.sqlite3*` (glob).** Better, and still wrong. It picks up
  `-wal`/`-shm` (which the online backup would have folded, and which a naive
  copy can tear against a live writer), the instance lock (which wedges the
  copy), and the telemetry store — while still missing the two
  fixed-name directory members and the whole `assets/blobs/` tree.
- **Hard-coding the sibling list in a script or a test gate.** It has changed
  and it will change again. Call `snapback store describe` or
  `snapback store export`; a gate that re-derives the list is a gate that will
  discover the next new sibling the expensive way.
- **Copying a store while assuming a clean shutdown made it safe.** Shutdown
  can strand a WAL. The export does not care about shutdown state; a `cp` does.
- **Serving an `auth backup` directory directly.** It is not bootable, and if
  you rename it into a bootable shape you have skipped the restore declaration
  that exists to stop exactly that.
- **Treating an export as sanitized.** It is not. It carries sessions and, if
  the admin token was present, admin authority. Use `snapback fork create` when
  you want the scrubbed thing.
