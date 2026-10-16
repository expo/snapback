# Deploy: upgrade, real accounts and schema evolution

A release is immutable source over one durable store. Deploy from the app directory:

```sh
bunx snapback4 check
bunx snapback4 test
bunx snapback4 deploy ./deployment
bunx snapback4 serve ./deployment --port 4400
```

Generations climb on every actual switch, including rollback and forward; selecting identical execution content is a no-op. `token --service ops --release ./deployment` works while serve runs. Signups are rate-limited: create proof accounts sequentially and respect a returned retry delay. Time-gated mutations on the real clock need a bounded retry of the authored refusal (for example `NOT_OPEN`), with a deadline and short delay; never retry unrelated refusals. Development proofs can advance the clock (`guide time`).

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
  immutable principal
  sync
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

This roster is synced. A whole service-seat branch may add the first member; ordinary callers must already hold the roster. Service grants add no device audience. The seat's own program lookups and `exists` obey read rules too: to inspect a roster, add `or viewer = 'service:ops'` to its read rule, as above. A rule probe has authorization visibility; a program probe does not. The mutation completes before the grant syncs; wait for the enrolled account's client to receive its scope before using offline staff reads.

A synced row has at most one group-roster audience: cross-table crew grants are not a second group. Enroll those readers in the same roster or keep the table `online only` (`guide rule-recipes`). Mint locally against the same store. Token stdout is only the credential; prose is stderr. Protect it; it expires under the seat-session policy. Rotate the credential by revoking its session (guide services) and minting a replacement. Expired or revoked bearer sessions cannot invoke the mutation. A repeat grant hits uniqueness; add membership revocation deliberately. Programmatic account sessions use `mintSession(url, serviceToken, principal)` from `snapback4/worker` (guide services); service seats themselves are minted locally by `token`.

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

Check business compatibility separately: old payment code may accept payment while a new review row is dormant. Pause that workflow or deploy a bridge preserving its checks. Old source cannot supply absent product logic. An absent operation returns 404 `{denied:{code:"E_OP",…},generation:G}`; a mutation's incompatible arguments return 200 `{state:"failed",why:{code:"E_INPUT",…},generation:G}`.

## What the old release sees
| Request after rollback | Result |
|---|---|
| An operation absent from the old release | HTTP 404 `{denied:{code:"E_OP"}}` |
| Bare point query of a dormant row | Reads null |
| Point query or mutation with an explicit `! else CODE` guard | Refuses its guard code (`NOT_FOUND` when authored that way) |
| Added columns after rollback | Ignored by the older release; their cells stay dormant |
| Counts, rules, maintained views and sync | Only the active population |
| Compatible forward to the newer release | Original dormant values restored |

This proof assumes v1 declares `readItem(item)` returning `items[item]` and `editItem(item)` with `row = items[item]! else NOT_FOUND`; v2 adds `newOnly` and writes an enum value v1 cannot hold. Keep the bearer session in `headers`:
```js
await cli('rollback', deployment, '--to', '1'); const absent = await fetch(url + '/q/newOnly', {method:'POST', headers, body:'{"args":{}}'});
assert.equal(absent.status, 404); assert.equal((await absent.json()).denied.code, 'E_OP');
assert.equal((await post('/m/editItem', {item})).why.code, 'NOT_FOUND');
assert.equal((await post('/q/readItem', {item})).data, null);
await cli('rollback', deployment, '--to', 'latest'); assert.equal((await post('/q/readItem', {item})).data.status, 'new');
```

Preview leads with affected queries/counts and active table populations, then linked rows going dormant with parents, then safety dependencies. Table counts do not predict filtered, paged or per-viewer results: verify the named queries and any progress denominator. Dormant warnings group operations by table; accept the absence or preserve the gate in a bridge before switching. Literal-default backfills print `table.column ← value on N rows` in both previews and deploy receipts, including a running serve. These are interpreted historical fields, not a claim of physical writes.

Preview shows old and new rule clauses and mutation `require`s side by side. A proved tightening is a note; a loosening or unproved implication is a WARNING, including rollback that removes a new guard. Equivalent Boolean clauses are notes. Unchanged clauses with unchanged consulted keys, fields, rules, auth and visibility are silent; unrelated additive schema changes do not warn. Changed dependencies are counted once across affected guards; verify their refusal cases. Comparison never changes admission.  Preview names missing operations, changed rule clauses, absent schedules and populated removed tables: dormant holds no longer enforce their safeguards. A changed job body is named separately; an unchanged job that compiles differently after a dependency change gets a note. Captures from the original read-through lifetime stay dormant with columns; restoring the same capture definition restores them. New rows without those captures still need safe audience correspondence.

Receipts and previews count storage by kind: `1 row, 2 cells, 0 index entries dormant`. Dormant rows cover their retained cells; standalone cell counts/samples belong only to active rows. Bytes/assets follow the same disjoint ownership. Samples are labelled and unique within each kind/path, for example `rows notes [A]; cells notes.color [B, C]`. A retained index definition represents logical entries to rebuild, not a dormant physical index. A widening note describes values later writes could use; a compatibility WARNING counts only current values the selected release cannot hold. Compatible forward has no such warning.

## Clients across rollback
Save the baseline .q files with their original names under versions/v1 outside snapback/ and create `snapback/client-compatibility.json` containing `{"baseline":"versions/v1","since_release":2}`. `check`/`dev` emit added row/result fields and existing-operation parameters as optional, labelled "Since release 2", retaining older result value domains. This is your release label, not server generation; ordinary types stay required without opt-in. Use `row.color ?? "none"` for the baseline fallback.

`useRelease()` from snapback4/react follows the authenticated catalog even when query gates are closed: loading, denied, or `{generation, operations, tables}` with public argument/field shapes. Generated `api.op.available(release)` is false while unready or when name/kind/argument signatures differ. This checks capability, not authorization or unchanged business semantics; still handle E_OP/E_INPUT and authored guard refusals when a switch races it. The SDK withdraws old metadata on observed generations, polls while subscribed, and returns loading offline/on catalog failure; account retirement/close withdraws it. Keep draft state above generation-sensitive read/action gates; remount only the gated children. Dormant means unavailable on this release, not deleted. Test v2 → v1 → v2 with one frontend: field fallbacks, missing operations, retained drafts and restored values. Alternatively check selected immutable source in a separate copy and rebuild its matching frontend. Preserve deployment source; Expo/Exact runtime changes also require a device rebuild.

## Bridge a safety gate before rollback
Use this beside the enum-widening rollback recipe above. Suppose v2 added `grounding.state = 'inspection'`; v1 holds only `'clear'`/`'hold'`. Selecting v1 hides that row and its children, so v1's `book` guard may allow a booking that v2 blocks.

1. Start from the old UI/operations, but keep v2's widened `grounding.state` domain, safety table, read audience and booking `require`. Save this complete source as `versions/bridge/schema.q` and deploy it with `deploy ./deployment --schema versions/bridge/schema.q --check`, then without `--check`. DAY3 owns the saved-source/baseline layout; KIT2 owns the packaged day-two proof recipe.
2. While the gate still runs, migrate each inspection to a truthful old-domain hold through an authorized bridge mutation. Do not relabel it clear just to satisfy v1. Keep linked metadata until its parent can be safely represented; if v1 cannot invalidate newer metadata, keep that behavior in the bridge too.
3. Prove the same booking/payment still refuses for the blocked case and that the named lists/counts preserve the intended business denominator. Re-run the final old-source preview against the repaired live population.
4. Select v1 only when those checks pass. If the old source cannot preserve the invariant, keep the bridge or pause that workflow. Retained storage cannot supply absent logic.

`rollback --check` groups safety dependencies by dormant table with counts, affected operations and bounded sample ids. They are dependency warnings, not predicate matches. Counts describe the preview snapshot; later writes can change activation.

## Trigger a deployed job
A running serve accepts `POST /jobs/<job>` with a full service token; the job executes as the system on its FIFO queue and server clock. Every full service seat can trigger system jobs, so provision these tokens only to trusted operators. Guest/account sessions, read-scoped tokens and personas cannot use this door. `POST /dev/jobs/<job>` remains development-only.
```sh
export SNAPBACK4_SERVICE_TOKEN=$(bunx snapback4 token --service ops --release ./deployment)
bunx snapback4 run reconcile --release ./deployment --json
unset SNAPBACK4_SERVICE_TOKEN
```
`--token-env NAME` reads another environment variable. The command uses served source, so it also works outside the app directory. A lost reply is ambiguous; inspect the queue before retrying. Starter/client recipes: `guide client`.

## Persona transition checklist
The complete account directory, linked membership and real-account transition is `guide production`.
1. Add password identity and signup/login UI; persist sessions with localStorageSessionStore on web or the secure native store, and verify restart.
2. Replace hard-coded persona owners/UI with signed-in account principals; map roles through the trusted seat recipe.
3. Give profiles a production write path and authorized directory; expose no credentials.
4. Create required teams/memberships, invitations or principal sharing; wait for scope delivery before offline reads; test expiry, revocation and outsiders.
5. Bootstrap every required table without fixtures/seed; guide start/client covers first writers and password starters.
6. Prove real-account writes, role checks, sign-out and rollback on durable storage behind TLS.

## Inspection, proxies and TLS
| Door | `dev` | `serve` |
|---|---|---|
| `/q`, `/m`, `GET /` compatibility record | Loopback persona or bearer | Bearer session required, including public rows |
| `/auth/config`; signup/login/guest | Public config; declared sign-in methods | Public config; declared sign-in methods |
| `/seed`, `/dev/*` | Development only | Refused |
| `/jobs/<job>` | Service seat | Full service seat |

Public visitors obtain guest sessions with `use identity`; `use identity password` disables guests (`guide rule-recipes`).

`snapback4 sql 'SELECT id, archived FROM notes' --release ./deployment --json` returns positional rows under `columns`; `--json-objects` returns object rows with direct boolean columns as true/false. Schema-qualified relations, recursive or shadowing/forward-reference CTEs need positional --json. Inspection bypasses read rules and can show expired stored rows; it is an operator tool, not an app query surface. Bind loopback behind a TLS proxy. Forward Authorization and preserve response bodies; allow long polls without buffering or early timeouts. Non-loopback HTTP requires `--i-understand-cleartext` and a trusted private hop behind TLS. Identity rate keys use the socket peer, not forwarded headers. Serve refuses personas and dev doors even through a local proxy; see SERVER.md for capacity. `--json-objects` returns `{header, columns, rows, limit, more, ruleFiltered:false}` with object `rows`; `--json` uses positional `rows`. Put flags outside the quoted SQL.

## Authoring and proof refusals
N_NO_PRODUCTION_WRITER means no production insert path can bootstrap this table. It groups root blockers with their dependents; persona-only schemas get one identity note. Add a service-seat insert mutation and provision real account relationships. E_UPGRADE means installation or post-upgrade check failed. Repair the package-manager or registry error and rerun upgrade. Packages may already be pinned: if check failed, repair the reported schema/device refusal and rerun check.
