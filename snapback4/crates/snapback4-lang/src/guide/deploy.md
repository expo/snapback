# Deploy: upgrade, real accounts and schema evolution

Stop the owned server, deploy, then restart it. A release is immutable source
over one durable store; production admits bearer tokens and refuses dev doors.

```sh
bunx snapback4 check
bunx snapback4 test
bunx snapback4 deploy ./deployment
bunx snapback4 serve ./deployment --port 4400
```

## Upgrade

`bun add snapback4@latest` upgrades the core package and its platform CLI.
For Expo, use **one command**: `bun add snapback4@latest snapback4-expo@latest`.
The adapter requires the exact core version, including the patch; `check`
warns on stderr if installed versions differ (also with --json). Rebuild your native development/release app
after changing the adapter (Expo Go uses the online tier). Commit the lockfile,
run `bunx snapback4 check`, typecheck the app and run your acceptance tests.
`snapback4 test` uses ./fixtures when present; `--fixture dir` overrides it.

## Deploy and password identity

Add `use identity password` to your schema (the recipe below includes it).
Deploy from the app directory; keep the deployment directory on durable storage:

`serve --port N` accepts 0 for an allocated port or an inclusive range A-B,
choosing its first free port. Invalid input refuses E_INPUT. Stdout's first
line is the actual URL; stderr includes `SNAPBACK4_READY verb=serve … url=…`.
Wait for readiness before requests. For a redeploy: stop the serve process
you own, wait for it to exit, deploy, restart serve, then verify a read and
write with a real account. Activation while serve owns the store refuses
E_STORE_BUSY; this path has downtime.

Layout: `releases/N/` holds each backend; `store.sqlite` holds rows, sessions,
receipts and queues; `assets/` holds uploads; `releases.jsonl` records activation.
`current` is a **text file containing a release number**, not a symlink. The
database's release metadata is authoritative; the file is a convenience copy.
Back up the whole directory with the server and external workers stopped;
include SQLite sidecars, assets and releases. See CLIENT-AND-OPERATIONS.md §6
for the tested stopped-backup/restore procedure and external-effect caveats.

```sh
U=http://127.0.0.1:4400
curl -s "$U/auth/signup" -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.test","password":"replace-with-a-private-password"}'
# {session:{principal,kind,token,expiresAt,scope}}
curl -s "$U/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.test","password":"replace-with-a-private-password"}'
```

For an executable headless account-seeding recipe, open `guide auth` or `guide headless`.
Use `signup`/`login` from `snapback4/auth` in the app; keep the returned
session in its session store and send `Authorization: Bearer <token>`.
Read the `session` or `denied` body (guide wire): wrong credentials and a
disabled identity method are 401 E_AUTH. A production persona is 401;
`/seed` and other development doors are 403. Signup creates an account,
not an admin. Sessions survive ordinary restarts and deployments of the same
store until expiry or revocation. A reset/replaced store requires sign-in again;
never deploy by deleting the store to make adoption pass.

## First admin: a service seat

Grant the signed-up account's principal through an operator seat. This recipe
permits ops and existing admins to insert grants, with no public first-user race:

```quarry
use identity password
table admins:
  principal: principal
  unique principal
  read <- .principal = viewer or viewer = 'service:ops'
  insert <- viewer = 'service:ops' or exists admins[principal = viewer]
mutation grantAdmin(principal: principal):
  return insert admins { principal }
table notes:
  owner: principal
  body: text <=200
  archived: bool default false
  status: enum('draft', 'live') default 'draft'
  read <- .owner = viewer
  insert <- .owner = viewer
```

```sh
TOKEN=$(bunx snapback4 token --service ops --release ./deployment)
curl -s "$U/m/grantAdmin" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"args":{"principal":"user:SIGNED_UP_ID"}}'
unset TOKEN
```

Mint on the server host, against the same store. Token stdout is just the token;
prose is stderr. Protect the token as an operator credential. A repeated grant
hits the unique key; this insert-only recipe never takes upsert's update path.
Add revoke/update rules deliberately if your application needs them.

## Migrations and adoption

Optional columns, new tables/operations, non-unique indexes, wider text bounds
and additional enum values are additive. A new required column needs a
**literal default** for existing rows: `archived: bool default false` above
fills missing values without rewriting old rows. A new required `default now`
or `default viewer` needs an empty table.

Run `snapback4 check --store ./deployment/store.sqlite` before deployment.
Without a store, check only compiles. Tightening text, removing enum values,
making a column required, unique indexes or stronger constraints need every
existing row to fit. Adoption refuses E_ADOPT when they do not; repair data
through authorized mutations under the old schema, then retry. For example,
adding 'archived' to status is safe; removing it after rows use it refuses.
`--allow-destructive` confirms data-losing changes, not invalid existing data.
Prefer expand → migrate data → contract, keeping old clients compatible.

## Rollback (current behavior)

Stop serve, run `snapback4 rollback ./deployment`, then restart it. Rollback
selects the previous earlier numbered release with schema.q; it does not rewind
rows, sessions or effects. It adopts that release's schema into today's store.
Removed columns/tables lose data and require `--allow-destructive`; narrowed
types still require valid existing values. Re-deploying newer source cannot
recover deleted values. Take a stopped backup first; repair enum values before
rollback or deploy a compatible fix forward. `--allow-feed-adoption` permits
the explicit feed adoption step. Revisit this section when rollback evolves.

## Inspection, proxies and TLS

`snapback4 sql 'SELECT id, archived FROM notes' --release ./deployment --json`
returns positional rows under `columns`; `--json-objects` returns object rows
with direct boolean columns as true/false. Schema-qualified relations, recursive
or shadowing/forward-reference CTEs need positional --json. Inspection bypasses read rules and can
show expired stored rows; it is an operator tool, not an app query surface.
Bind loopback behind a TLS proxy. Forward Authorization and preserve response
bodies; allow long polls without buffering or early timeouts. Non-loopback
HTTP requires `--i-understand-cleartext` and a trusted private hop behind TLS.
Identity rate keys use the socket peer, not forwarded headers. Serve refuses
personas and dev doors even through a local proxy; see SERVER.md for capacity.
