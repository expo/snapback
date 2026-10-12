# Deploy: upgrade, real accounts and schema evolution

A release is immutable source over one durable store. Deploy from the app directory:

```sh
bunx snapback4 check
bunx snapback4 test
bunx snapback4 deploy ./deployment
bunx snapback4 serve ./deployment --port 4400
```

## Upgrade
`bun add snapback4@latest` upgrades core and its platform CLI. Expo needs one
command: `bun add snapback4@latest snapback4-expo@latest`, with matching exact
versions including patch. Check warns on installed version skew. Rebuild native
apps after adapter upgrades; Expo Go uses the online tier. Commit the lockfile,
check, typecheck and run acceptance tests. Test defaults to ./fixtures when present.

## Deploy and password identity

Add `use identity password`. Serve admits bearer sessions; personas are 401 and
/seed and dev doors are 403, including through local proxies. Signup creates an
account, not a privileged role. See guide client for SDK session-store examples;
guide auth/headless has executable account setup. HTTP auth returns session or
denied; the SDK signup/login from `snapback4/auth` returns ok/why.

```sh
U=http://127.0.0.1:4400
curl -s "$U/auth/signup" -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.test","password":"replace-with-a-private-password"}'
# {session:{principal,kind,token,expiresAt,scope}}
curl -s "$U/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.test","password":"replace-with-a-private-password"}'
```

Keep the session and send `Authorization: Bearer <token>`. Wrong credentials or
a disabled identity method are 401 E_AUTH. Sessions survive ordinary deployments
and restarts until expiry/revocation; a replaced/reset store requires sign-in again.
Never delete a store to make adoption pass. `serve --port N` accepts 0 or A-B;
stdout's first line is its URL, stderr includes SNAPBACK4_READY. Wait for readiness.

Layout: releases/N/ holds source; store.sqlite holds data, sessions and queues;
assets/ holds uploads. The database owns current release/history; current is a
text convenience copy and releases.jsonl a convenience ledger. Back up the whole
directory, including sidecars/assets/releases, with serve and external workers
stopped (CLIENT-AND-OPERATIONS.md §6). A restore does not rewind external effects.

## First admin: a service seat

Provision roles through an operator seat, with no public first-user race:
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

Mint locally against the same store. Token stdout is only the credential; prose
is stderr. Protect it. A repeat grant hits uniqueness; add revocation deliberately.

## Migrations and adoption

Optional/defaulted columns, new tables/ops, non-unique indexes and wider types
are additive. Required new fields need a literal default or explicit backfill;
default now/viewer cannot invent historical values. Dev check/adoption refuses
incompatible values with E_ADOPT. Release type narrowing instead retains each row
whose present values cannot fit. Unique/cap conflicts still refuse atomically;
repair active rows, or restore through a widened non-unique bridge, repair, then
reinstate constraints. Prefer expand → migrate → contract for client compatibility.

## Rollback after widening, restore and prune

```sh
bunx snapback4 rollback ./deployment --to 1 --check
bunx snapback4 check --store ./deployment/store.sqlite --release 1
bunx snapback4 rollback ./deployment --to 1
bunx snapback4 releases ./deployment
bunx snapback4 rollback ./deployment --to latest
```

Preview runs exact adoption on a private disk snapshot and removes it, without
activating; disk/time scales with the store, and later writes can change the plan.
Release is immutable source, latest the highest complete source even after rollback,
and generation a monotone execution identity. Identical packaged source is a no-op.
Deploy/rollback return after serve switches: `release N is current as generation G`.
In-flight one-shot operations finish in their generation; no settle sleep is needed.
Default adoption is one measured receipt; --verbose/--json includes phases/cache
advice. N_ADOPTION_PAUSE appears above one second. A dev/older unreachable owner
requires stopping that owned process before retrying; failed adoption keeps current.

Widened enum values, or short codes a loose release wrote, become dormant rows
when selected types cannot hold them; compatible forward restores exact values.
Reference dependents also leave the active population. Rules, counts, maintained
views and reacquired sync partitions see only active rows. Point reads/updates/
deletes see absent rows; dormant ids stay reserved. Nominal reference values stay
legal, as for other missing ids; require/read-through decides live-target admission.
Dormant rows occupy no cap/unique slots, so older writes can require a bridge repair.
Removed tables/columns/indexes also stay dormant. Fresh-source name reuse needs
--restore-dormant; rollback selects restoration explicitly. Old active updates keep
dormant cells; active deletion removes them. Only active referential actions run:
parent deletion invalidates dormant lifetimes. Narrowed rows with invalid visible
references stay dormant; whole-table/column restoration retains its E_ADOPT barrier.
Prune previews counts/bytes/sample ids; `prune ./deployment --allow-destructive`
permanently drops all dormant storage. No age collector or implicit pruning exists.
Deploy/rollback --allow-destructive bypasses neither validation nor retention.
--allow-feed-adoption permits the explicit feed launch. Inspect releases after an
ambiguous reply. Details: [SERVER.md — Release lifecycle](SERVER.md#release-lifecycle).

Check business compatibility separately: old payment code may accept payment while
a new review row is dormant. Pause that workflow or deploy a bridge preserving its
checks. Old source cannot supply absent product logic. An absent operation returns
404 `{denied:{code:"E_OP",…},generation:G}`; a mutation's incompatible arguments
return 200 `{state:"failed",why:{code:"E_INPUT",…},generation:G}`.

## Persona transition checklist
1. Add password identity and signup/login UI; persist the real session.
2. Map each persona role to real account principals through the trusted seat recipe.
3. Give profiles a production write path and authorized directory; expose no credentials.
4. Provide invitations or explicit principal sharing; test expiry, revocation and outsiders.
5. Bootstrap every required table without fixtures/seed. DX owns first-writer notes and password starters (guide start/client).
6. Prove real-account writes, role checks, sign-out and rollback on durable storage behind TLS.

## Inspection, proxies and TLS

`sql 'SELECT id, archived FROM notes' --release ./deployment --json-objects` returns
`{columns,header,limit,more,rows,ruleFiltered}`, with object rows and direct booleans:
`{"columns":["id","archived"],"rows":[{"id":"…","archived":false}],…}`. Positional
--json handles qualified relations and recursive/shadowing/forward CTEs. Inspection
bypasses rules and can show expired stored rows; use it only as an operator tool.
Bind loopback behind TLS. Preserve Authorization, bodies and unbuffered long polls.
Non-loopback HTTP requires --i-understand-cleartext and a trusted proxy hop;
identity rate keys use the socket peer, not forwarded headers. See SERVER.md.
