# Deploy: upgrade, real accounts and schema evolution

A release is immutable source over one durable store. Deploy from the app directory:

```sh
bunx snapback4 check
bunx snapback4 test
bunx snapback4 deploy ./deployment
bunx snapback4 serve ./deployment --port 4400
```

## Upgrade

`snapback4 upgrade [version]` resolves once and exactly pins core and installed Expo adapters with npm/bun/pnpm. Rebuild native apps after adapter changes; commit the lockfile, run check/typecheck/acceptance. `test` uses ./fixtures; `--fixture dir` overrides it. Use the password and first-admin recipes below.

## Deploy and password identity

Add `use identity password` (included below). Deploy from the app directory onto durable storage:

Serve admits bearer sessions; personas are 401 and /seed/dev doors 403, even through proxies. Signup creates an account, not a privileged role. See guide client for SDK session stores; auth/headless for account setup. HTTP auth returns session/denied; SDK signup/login from `snapback4/auth` returns ok/why. Check warns on installed version skew.

```sh
U=http://127.0.0.1:4400
curl -s "$U/auth/signup" -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.test","password":"replace-with-a-private-password"}'
# {session:{principal,kind,token,expiresAt,scope}}
curl -s "$U/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.test","password":"replace-with-a-private-password"}'
```

Keep the session and send `Authorization: Bearer <token>`. Wrong credentials or a disabled identity method are 401 E_AUTH. Sessions survive ordinary deployments and restarts until expiry/revocation; a replaced/reset store requires sign-in again. Never delete a store to make adoption pass. `serve --port N` accepts 0 or A-B; stdout's first line is its URL, stderr includes SNAPBACK4_READY. Wait for readiness.

Layout: releases/N/ holds source; store.sqlite data/sessions/queues; assets/ uploads. The database owns current release/history; current is a text convenience copy, releases.jsonl a convenience ledger. Back up the whole directory, including sidecars/assets/releases, with serve and external workers stopped (CLIENT-AND-OPERATIONS.md §6). A restore does not rewind external effects.

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

Mint locally against the same store. Token stdout is only the credential; prose is stderr. Protect it. A repeat grant hits uniqueness; add revocation deliberately.

## Migrations and adoption

Optional/defaulted columns, new tables/ops, non-unique indexes and wider types are additive. Required new fields need a literal default or explicit backfill; default now/viewer cannot invent historical values. Dev check/adoption refuses incompatible values with E_ADOPT. Release type narrowing instead retains each row whose present values cannot fit. Unique/cap conflicts still refuse atomically; repair active rows, or restore through a widened non-unique bridge, repair, then reinstate constraints. Prefer expand → migrate → contract for client compatibility.

## Rollback after widening, restore and prune

```sh
bunx snapback4 rollback ./deployment --to 1 --check
bunx snapback4 check --store ./deployment/store.sqlite --release 1
bunx snapback4 rollback ./deployment --to 1
bunx snapback4 releases ./deployment latest
bunx snapback4 rollback ./deployment --to latest
```

`deploy ./deployment --check` previews the deploy direction, including restoration intent.

Preview runs exact adoption on a private disk snapshot and removes it, without activating; disk/time scales with the store, and later writes can change the plan. Release is immutable source; latest is the highest successfully adopted source even after rollback. A refused candidate is never selectable. Bare rollback selects the previously active release, and generation a monotone identity; releases N/latest inspects source. Identical source is a no-op. Deploy/rollback return after serve switches: `release N is current as generation G`. In-flight one-shot operations finish in their generation; no settle sleep is needed. Default adoption is one measured receipt; --verbose/--json includes phases/cache advice. N_ADOPTION_PAUSE appears above one second. A dev/older unreachable owner requires stopping that owned process before retrying; failed adoption keeps current.

Widened enum values, or short codes a loose release wrote, become dormant rows when selected types cannot hold them; compatible forward restores exact values. Reference dependents also leave the active population. Rules, counts, maintained views and reacquired sync partitions see only active rows. Point reads/updates/ deletes see absent rows; dormant ids stay reserved. Nominal reference values stay legal, as for other missing ids; require/read-through decides live-target admission. Dormant rows occupy no cap/unique slots, so older writes can require a bridge repair. Removed tables/columns/indexes also stay dormant. Fresh-source name reuse needs --restore-dormant; rollback selects restoration explicitly. Old active updates keep dormant cells; active deletion removes them. Only active referential actions run: parent deletion invalidates dormant lifetimes. Narrowed rows with invalid visible references stay dormant; whole-table/column restoration retains its E_ADOPT barrier. Prune previews counts/bytes/sample ids; `prune ./deployment --allow-destructive` permanently drops all dormant storage. No age collector or implicit pruning exists. Deploy/rollback --allow-destructive bypasses neither validation nor retention. --allow-feed-adoption permits the explicit feed launch. Inspect releases after an ambiguous reply. Details: [SERVER.md — Release lifecycle](SERVER.md#release-lifecycle).

Check business compatibility separately: old payment code may accept payment while a new review row is dormant. Pause that workflow or deploy a bridge preserving its checks. Old source cannot supply absent product logic. An absent operation returns
404 `{denied:{code:"E_OP",…},generation:G}`; a mutation's incompatible arguments
return 200 `{state:"failed",why:{code:"E_INPUT",…},generation:G}`.

## What the old release sees

| Request after rollback | Result |
|---|---|
| An operation absent from the old release | HTTP 404 `{denied:{code:"E_OP"}}` |
| Point mutation of a dormant row | `NOT_FOUND` from an explicit lookup guard; a point query reads null |
| Counts, rules, maintained views and sync | Only the active population |
| Compatible forward to the newer release | Original dormant values restored |

This proof assumes v1 declares `readItem(item)` returning `items[item]` and `editItem(item)` with `row = items[item]! else NOT_FOUND`; v2 adds `newOnly` and writes an enum value v1 cannot hold. Keep the bearer session in `headers`:
```js
await cli('rollback', deployment, '--to', '1');
const absent = await fetch(url + '/q/newOnly', {method:'POST', headers, body:'{"args":{}}'});
assert.equal(absent.status, 404);
assert.equal((await absent.json()).denied.code, 'E_OP');
assert.equal((await post('/m/editItem', {item})).why.code, 'NOT_FOUND');
assert.equal((await post('/q/readItem', {item})).data, null);
await cli('rollback', deployment, '--to', 'latest');
assert.equal((await post('/q/readItem', {item})).data.status, 'new');
```

Preview flags absent schedules and populated removed tables: dormant holds no longer enforce their safeguards. Captures from the original read-through lifetime stay dormant with columns; restoring the same capture definition restores them. New rows without those captures still need safe audience correspondence.

## Trigger a deployed job

A running serve accepts `POST /jobs/<job>` with a full service token; the job executes as the system on its FIFO queue and server clock. Every full service seat can trigger system jobs, so provision these tokens only to trusted operators. Guest/account sessions, read-scoped tokens and personas cannot use this door. `POST /dev/jobs/<job>` remains development-only.
```sh
export SNAPBACK4_SERVICE_TOKEN=$(bunx snapback4 token --service ops --release ./deployment)
bunx snapback4 run reconcile --release ./deployment --json
unset SNAPBACK4_SERVICE_TOKEN
```
`--token-env NAME` reads another environment variable. The command uses served source, so it also works outside the app directory. A lost reply is ambiguous; inspect the queue before retrying. DX2 owns starter and client job recipes.

## Persona transition checklist
1. Add password identity and signup/login UI; persist the real session.
2. Map each persona role to real account principals through the trusted seat recipe.
3. Give profiles a production write path and authorized directory; expose no credentials.
4. Provide invitations or explicit principal sharing; test expiry, revocation and outsiders.
5. Bootstrap every required table without fixtures/seed; guide start/client covers first writers and password starters.
6. Prove real-account writes, role checks, sign-out and rollback on durable storage behind TLS.

## Inspection, proxies and TLS

`snapback4 sql 'SELECT id, archived FROM notes' --release ./deployment --json` returns positional rows under `columns`; `--json-objects` returns object rows with direct boolean columns as true/false. Schema-qualified relations, recursive or shadowing/forward-reference CTEs need positional --json. Inspection bypasses read rules and can show expired stored rows; it is an operator tool, not an app query surface. Bind loopback behind a TLS proxy. Forward Authorization and preserve response bodies; allow long polls without buffering or early timeouts. Non-loopback HTTP requires `--i-understand-cleartext` and a trusted private hop behind TLS. Identity rate keys use the socket peer, not forwarded headers. Serve refuses personas and dev doors even through a local proxy; see SERVER.md for capacity. For the `--json-objects` envelope fields, see `snapback4 sql --help`.

## Authoring and proof refusals

N_NO_PRODUCTION_WRITER means no production insert path can bootstrap this table. Add a service-seat insert mutation.

E_UPGRADE means installation or post-upgrade check failed. Repair the package-manager or registry error and rerun upgrade. Packages may already be pinned: if check failed, repair the reported schema/device refusal and rerun check.
