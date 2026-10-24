# Deploy: upgrade, real accounts and schema evolution

A release is immutable source over one durable store. JSON fields, bounded ready waits and worker roots: `guide release-json`. Deploy from the app directory:

```sh
bunx snapback4 check
bunx snapback4 test
bunx snapback4 deploy ./deployment
bunx snapback4 serve ./deployment --port 4400
```
For Postgres, prefer `SNAPBACK4_STORE_URL` with explicit schema/ha=none and Unix sockets; a password in `--store-url` is visible in process arguments. Serve requires `--worker-state-dir /absolute/durable/path` or `SNAPBACK4_WORKER_STATE_DIR`. Queries, identified writes, sessions, ephemeral state and ordinary maintained count/sum columns are admitted. A deploy may add, redefine or drop those columns and indexes on them; it atomically recounts sources and mirrors parents before publishing the generation. Ordinary releases may also add tables, add optional or literal-defaulted columns, add/drop/redefine indexes, and retire ordinary tables or columns into dormant storage. Use `deploy DIR --restore-dormant` to restore retired names and their exact rows/values. A restored column must repeat its retained declaration: changing its type, default, text constraints or deletion policy refuses just as an in-place edit would. Unique collisions refuse the whole activation. Ordinary Postgres schema evolution currently refuses `evolution-authority` when the schema contains a durable temporal, read-through or recorded table, including an unchanged one. Their activation-time source retirement needs the later lifetime slice. Previously admitted maintained-column transitions with unchanged ordinary declarations remain available. Existing column types/defaults, rules, audiences and other authority declarations must stay unchanged. Type narrowing, backfills, renames, temporal/read-through/recorded evolution and retirement of tables with maintained columns remain named refusals. Token minting (`token`), SQL/data and release inspection, rollback, previews, prune, staging, saved versions and hot activation refuse; excluded runners, certified sync and complete configuration: `guide release-json`. SDK guest/signup/login and proof seedAccounts retry explicit identity 429 refusals using retryAfterMs (Retry-After for older servers). Sign-in has at most four attempts within timeoutMs (default three minutes); signal cancels requests/waits. No lost or malformed reply is replayed. Time-gated mutations on the real clock need a bounded retry of the authored refusal (for example `NOT_OPEN`), with a deadline and short delay; never retry unrelated refusals. Development and classified staging proofs can advance the clock (`guide time`); production always uses wall time.

Managed storage refuses foreign triggers, rewrite rules or row security with `E_STORE` / `SNAPBACK_MANAGED_RELATION_INTERCEPTION` on open, activation, reconnect and `doctor`, including foreign incoming foreign keys. Remove the reported interception and retry. Snapback's own index-key and device-residency triggers require their exact installed definitions; only recognized legacy constraints and their exact built-in triggers are admitted. Database event triggers are allowed; activation checks their managed-relation effects after installer DDL before moving data, and again before committing.

Runtime DDL on managed relations while serving is explicitly outside the store fence model. Owner/head locks do not prevent external DDL, and admission does not poll catalogs on each request. Doctor and the next open, activation or connection replacement detect such changes.

## Upgrade
`snapback4 upgrade [version]` resolves once and exactly pins core and installed Expo adapters with npm/bun/pnpm. Rebuild native apps after adapter changes; commit the lockfile, run check/typecheck/acceptance. `test` uses ./fixtures; `--fixture dir` overrides it. Use the password and first-admin recipes below.

## Deploy and password identity (SQLite)
Add `use identity password` (below). Serve admits bearer sessions; personas are 401 and /seed/dev doors 403, even through proxies. Signup creates an account, not a privileged role. See guide client for SDK session stores; auth/headless for account setup. HTTP auth returns session/denied; SDK signup/login from `snapback4/auth` returns ok/why. Check warns on installed version skew.
```sh
U=http://127.0.0.1:4400
curl -s "$U/auth/signup" -H 'Content-Type: application/json' -d '{"email":"admin@example.test","password":"replace-with-a-private-password"}'
# {session:{principal,kind,token,expiresAt,scope}}
curl -s "$U/auth/login" -H 'Content-Type: application/json' -d '{"email":"admin@example.test","password":"replace-with-a-private-password"}'
```
Keep the session and send `Authorization: Bearer <token>`. Wrong credentials or a disabled identity method are 401 E_AUTH. Sessions survive ordinary deployments and restarts until expiry/revocation; a replaced/reset store requires sign-in again. Never delete a store to make adoption pass. `serve --port N` accepts 0 or A-B; stdout's first line is its URL, stderr includes SNAPBACK4_READY. Wait for readiness. Layout: releases/N/ holds source; store.sqlite data/sessions/queues; assets/ uploads. The database owns current release/history; current is a text convenience copy, releases.jsonl a convenience ledger. Back up the whole directory, including sidecars/assets/releases, with serve and external workers stopped (CLIENT-AND-OPERATIONS.md §6). A restore does not rewind external effects.

## First admin: a service seat (SQLite)
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
curl -s "$U/m/grantAdmin" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"args":{"principal":"user:SIGNED_UP_ID"}}'
unset TOKEN
```
This roster is synced. A whole service-seat branch may add the first member; ordinary callers must already hold the roster. Service grants add no device audience. The seat's own program lookups and `exists` obey read rules too: to inspect a roster, add `or viewer = 'service:ops'` to its read rule, as above. A rule probe has authorization visibility; a program probe does not. The mutation completes before the grant syncs; wait for the enrolled account's client to receive its scope before using offline staff reads. A synced row has at most one group-roster audience: cross-table crew grants are not a second group. Enroll those readers in the same roster or keep the table `online only` (`guide rule-recipes`). Mint locally against the same store. Token stdout is only the credential; prose is stderr. Protect it; it expires under the seat-session policy. Rotate the credential by revoking its session (guide services) and minting a replacement. Expired or revoked bearer sessions cannot invoke the mutation. A repeat grant hits uniqueness; add membership revocation deliberately. Programmatic account sessions use `mintSession(url, serviceToken, principal)` from `snapback4/worker` (guide services); service seats themselves are minted locally by `token`.

## Migrations and adoption (SQLite)
Optional/defaulted columns, new tables/ops, non-unique indexes and wider types are additive. Required new fields need a literal default or a declarative `backfill table name(fields: types): {column: expression}`; default now/viewer cannot invent historical values. Dev check/adoption refuses incompatible values with E_ADOPT. Release type narrowing instead retains each row whose present values cannot fit. Unique/cap conflicts still refuse atomically; repair active rows, or restore through a widened non-unique bridge, repair, then reinstate constraints. Prefer expand → migrate → contract for client compatibility. Generations climb on actual switches, including rollback/forward; identical execution content is a no-op.

## Which migration shape survives edits and rollback?
Choose the shape before writing a migration:

- **Only a spelling changed, with identical types?** Use `renamed from`; `$rename:down` presents the edited scalar under its old name, while file/reference homes and lifetimes stay put. Preserve frozen endpoint/result wrappers separately.
- **A historical value must be computed?** Use a named `backfill`; every input and lookup reads the assembled pre-patch row/snapshot before simultaneous patches, so a renamed destination names its historical source. Retain a declaration while its meaning holds, rename a different transform, and use digest-bearing refusals; pruning never resets a name.
- **The current value needs a truthful old representation?** Declare `down`; it reads the assembled newer snapshot when leaving it. Exact forward preimages and nonnull retained old cells win, except a generated identical-type rename presents the current value. Preview both directions after edits.
- **An image/file/list moved into a child record?** Use `extract CHILD from PARENT via REF`; scalar transforms cannot duplicate assets, and one child per parent differs from `each` list elements (`guide evolution`).
- **The old domain cannot hold null media, a new enum or wider money?** Keep a widened rollback view or authored bridge with current guards. Exact old source may retain dormant rows but cannot invent truthful values. Inspect the registered view and use `--exact` only deliberately.

Preview rollback after a v2 edit, forward after a v1 edit, and v2-native rows without a v1 preimage. A bridge keeps current value and old workflow until authorized repair. `prune` discards migration preimages and dormant data, names blinded `down` projections, and can make reversal/re-entry refuse; keep history or a backup.

## Rollback after widening, restore and prune (SQLite)
```sh
bunx snapback4 rollback ./deployment --to 1 --check
bunx snapback4 rollback ./deployment --to 1
```
`deploy ./deployment --check` previews deploy direction and restoration intent. `bunx snapback4 check --store ./deployment/store.sqlite --release 1` also previews a selection; `bunx snapback4 releases ./deployment latest` inspects it. Forward with `bunx snapback4 rollback ./deployment --to latest`. Preview runs exact adoption on a private disk snapshot and removes it, without activating; disk/time scales with the store, and later writes can change the plan. Release is immutable source; latest is the highest successfully adopted source even after rollback. A refused deploy removes its candidate directory and private stage. An ambiguous reply preserves source until committed history resolves the outcome; inspect releases before retrying. Bare rollback selects the previously active release; rollback prints the resolved target before preview or activation. Generation is a monotone identity; releases N/latest inspects source. Source identical to the active release is a no-op; source matching a retained release reactivates its existing id with restoration and full validation. Deploy/rollback return after serve switches: `release N is current as generation G`. In-flight one-shot operations finish in their generation; no settle sleep is needed. Default adoption is one measured receipt; --verbose/--json includes phases/cache advice. N_ADOPTION_PAUSE appears above one second. Deploy/rollback wait up to five seconds for a shutting-down store owner before admission; live serve keeps its authenticated control path. A remaining owner refuses with E_STORE_BUSY; stop that owned process before retrying. Failed or ambiguous activation is never automatically replayed. `await host.stop()` from startServe waits for its native child and the kernel store lock, including delayed worker cleanup, before resolving. `snapback4 stop ./deployment` asks the retained owner to shut down through its same-owner private control socket and waits for the store lock; it never signals a recorded PID or removes a lock. `serve ./deployment --wait-stopped` remains the bounded five-second lock barrier after a caller has already requested shutdown; it neither stops a process nor opens SQLite. It refuses other serve flags. A timeout rejects cleanup rather than claiming the store is free. Widened enum values, or short codes a loose release wrote, become dormant rows when selected types cannot hold them; compatible forward restores exact values. Reference dependents also leave the active population. Rules, counts, maintained views and reacquired sync partitions see only active rows. Point reads/updates/ deletes see absent rows; dormant ids stay reserved. Nominal reference values stay legal, as for other missing ids; require/read-through decides live-target admission. Dormant rows occupy no cap/unique slots, so older writes can require a bridge repair. Removed tables/columns/indexes also stay dormant. Fresh-source name reuse needs --restore-dormant; selecting retained source by deploy or rollback already selects restoration. The same --restore-dormant flag is accepted by both commands. Old active updates keep dormant cells; active deletion removes them. Only active referential actions run: parent deletion invalidates dormant lifetimes. Narrowed rows with invalid visible references stay dormant; whole-table/column restoration retains its E_ADOPT barrier. Prune previews counts/bytes/sample ids; `prune ./deployment --allow-destructive` permanently drops all dormant storage. No age collector or implicit pruning exists. Deploy/rollback --allow-destructive bypasses neither validation nor retention. --allow-feed-adoption permits the explicit feed launch. Inspect releases after an ambiguous reply. Details: [SERVER.md — Release lifecycle](SERVER.md#release-lifecycle).

## Visible rollback by default (SQLite)
Deploy prepares compiled rollback views when a predecessor cannot hold newly allowed values. With current independent intent, changed source also prepares a view without widening, so a repaired workflow cannot silently roll back to its unsafe old body. These views retain the complete authored current schema, helpers, programs and policy while admitting old names and inputs; unsupported mappings require authored compatible guarded source. Old inputs may fit wider same-format text/list bounds or omit new optional arguments; narrowed or removed inputs still refuse. `rollback --to 1` selects release 1's registered view in the active deployment's context, retaining current guards and widened domains; output names both original and actual ids. The original source remains immutable. After upgrading the CLI/runtime, restart an older running serve before switching releases; an older host refuses the new custody control feature before admission. `--exact` deliberately selects that source and reports its dormant population. Newer views never become ordinary latest. If a guard cannot be transported safely or a view cannot compile, deploy refuses until source supplies a compatible workflow. Nullable old results remain a client compatibility change: render an amount still to follow as pending, never zero. Optional media must remain optional in old UI consumers. Intentional null hiding uses `rollback 1 hides orders where fee = null because 'An unquoted fee must not look free.'` in candidate source. The writer permits only those null rows and their actual hidden-reference dependents. Widened nonnull values still stay visible. Removed defaulted fields require truthful `down` expressions; previews suggest cross-table candidates for moved values, never silently show a misleading old default. Snapshot previews do not freeze later writes: activation revalidates under its writer transaction.

## Bridge a safety gate before exact rollback (SQLite)
Use this beside the enum-widening rollback recipe above. Suppose v2 added `grounding.state = 'inspection'`; v1 holds only `'clear'`/`'hold'`. Selecting exact v1 hides that row and its children, so v1's `book` guard may allow a booking that v2 blocks. Counts and sample ids are snapshot dependencies, not predicate matches; later writes can change the plan.

1. Start from the old UI/operations, but keep v2's widened `grounding.state` domain, safety table, read audience and booking `require`. Save this complete source as `versions/bridge/schema.q` and deploy it with `deploy ./deployment --schema versions/bridge/schema.q --check`, then without `--check`.
2. While the gate still runs, migrate each inspection to a truthful old-domain hold through an authorized bridge mutation. Do not relabel it clear just to satisfy v1. Keep linked metadata until its parent can be safely represented; if v1 cannot invalidate newer metadata, keep that behavior in the bridge too.
3. Prove the same booking/payment still refuses for the blocked case and that the named lists/counts preserve the intended business denominator. Re-run the final old-source preview against the repaired live population.
4. Select v1 only when those checks pass. If the old source cannot preserve the invariant, keep the bridge or pause that workflow. Retained storage cannot supply absent logic.

## What the old release sees (SQLite)
| Request after rollback | Result |
|---|---|
| An operation absent from the old release | HTTP 404 `{denied:{code:"E_OP"}}` |
| Bare point query of a dormant row | Reads null |
| Point query or mutation with an explicit `! else CODE` guard | Refuses its guard code (`NOT_FOUND` when authored that way) |
| Added columns after rollback | Ignored by the older release; their cells stay dormant |
| Counts, rules, maintained views and sync | Only the active population |
| Compatible forward to the newer release | Original dormant values restored |

These dormant-row outcomes require `rollback <deployment> --to 1 --exact`. A registered default view keeps widened old-table rows visible with the current guard. Ordinary renames, required-field additions and splits with a fitting down do not require a view merely because the app declares an invariant. A needed view uses the current workflow or a compatible loosened bridge with current guards. A guarded current view names removed nullable fields as absent results and removed writes as E_OP; author a compatible current endpoint to keep an old write available. On a pre-0.4.39 store, a refusal names `rollback <deployment> --to N --exact` and "redeploy with 0.4.39 to register a view"; preview exact selection with --check before accepting its historical behavior. Absent operations still return E_OP. Test audiences and guards with real accounts. Rollback previews lead with records hidden from tables the target release has, then empty/defaulted legacy cells and newer-only table rows. Counts precede read rules; they do not infer birth release or a viewer’s query result. Declare a reverse projection for a truthful old representation, or keep a bridge. Guard/refusal and query/count/safety diffs follow. Verify filtered/paged/per-viewer results and denominators. Literal-default backfills print `table.column ← value on N rows` in previews and cold/hot deploy receipts: interpreted historical fields, not physical writes. Preview shows old and new rule clauses and mutation `require`s side by side, preserving Boolean parentheses. A proved tightening is a note, including `require A else X` becoming `require A else X; require B else Y` when A's refusal contract is unchanged; changed codes/messages still warn. A loosening or unproved implication is a WARNING, including rollback that removes a new guard. Unchanged clauses and consulted keys, fields, rules, auth and visibility are silent. Unread column domains and forward domain widening do not unprove a probe; narrowing still gets exact dormant-value/population warnings. Changed dependencies group once: verify refusal cases. Comparison never changes admission. Missing operations/schedules, populated removed tables, changed clauses and job bodies are named separately. An unchanged job compiling differently after a dependency change gets a note. Predicate-only read-through changes preserve bound captures and parent lifetimes; structural capture changes and new uncaptured rows still need safe audience correspondence. Receipts and previews count storage by kind: `1 row, 2 cells, 0 index entries dormant`. Dormant rows cover their retained cells; standalone cell counts/samples belong only to active rows. Bytes/assets follow the same disjoint ownership. Samples are labelled and unique within each kind/path, for example `rows notes [A]; cells notes.color [B, C]`. A retained index definition represents logical entries to rebuild, not a dormant physical index. A widening note describes values later writes could use; a compatibility WARNING counts only current values the selected release cannot hold. Compatible forward has no such warning.

## Clients across rollback (SQLite)
Save versions/v1/schema.q (and any other .q modules with their original names) outside snapback/ and create `snapback/client-compatibility.json` containing `{"baseline":"versions/v1","since_release":2}`. `check`/`dev` emit added row/result fields as optional, labelled "Since release 2", retaining older result value domains. Required operation parameters remain required; only declared optional, defaulted or deprecated arguments may be omitted. Baseline generation warns about real old-client input breaks and changed/removed result domains; a declared table rename preserves reference input identity, and purely additive result fields print a RESULT NOTE. This is your release label, not server generation; ordinary types stay required without opt-in. Use `row.color ?? "none"` for the baseline fallback. Keep contemporary fixtures in versions/v1/fixtures/; deploy with `--schema versions/v1` and test with `--source versions/v1` (guide testing). Baselines resolve from the original project root, including saved-source deploys. `useRelease()` from snapback4/react follows the authenticated catalog even when query gates are closed: loading, denied, or `{generation, operations, tables}` with public argument/field shapes. Generated `api.op.available(release)` is false while unready or when name/kind/existing-argument signatures differ or the server adds a required argument; extra optional served parameters are compatible. This checks capability, not authorization or unchanged business semantics; still handle E_OP/E_INPUT and authored guard refusals when a switch races it. The SDK withdraws old metadata on observed generations, polls while subscribed, and returns loading offline/on catalog failure; account retirement/close withdraws it. Keep draft state above generation-sensitive read/action gates; remount only the gated children. Dormant means unavailable on this release, not deleted. Test v2 → v1 → v2 with one frontend: field fallbacks, missing operations, retained drafts and restored values. Alternatively check selected immutable source in a separate copy and rebuild its matching frontend. Preserve deployment source; Expo/Exact runtime changes also require a device rebuild.

## Trigger a deployed job (SQLite)
A running serve accepts `POST /jobs/<job>` with a full service token; the job executes as the system on its FIFO queue and server clock. Every full service seat can trigger system jobs, so provision these tokens only to trusted operators. Guest/account sessions, read-scoped tokens and personas cannot use this door. `POST /dev/jobs/<job>` remains development-only.
```sh
export SNAPBACK4_SERVICE_TOKEN=$(bunx snapback4 token --service ops --release ./deployment)
bunx snapback4 run reconcile --release ./deployment --json
unset SNAPBACK4_SERVICE_TOKEN
```
`--token-env NAME` reads another environment variable. The command uses served source, so it also works outside the app directory. A lost reply is ambiguous; inspect the queue before retrying. Starter/client recipes: `guide client`. Real-account production and its durable role/restart/rollback proof: `guide production`.

## Inspection, proxies and TLS (SQLite)

`data TABLE --release ./deployment --json` returns `{rows, more, limit}`. The default limit is 50; `more:true` means the snapshot was truncated. Increase `--limit N` to inspect more; `--limit 0` returns no rows and reports whether any exist. Non-JSON output remains one row per line. `snapback4 sql 'SELECT id, archived FROM notes' --release ./deployment --json` returns positional rows under `columns`; `--json-objects` returns object rows with direct booleans and schema-proven media columns decoded to ordinary wire JSON. Positional `--json` retains tagged media text. Schema-qualified relations, recursive or shadowing/forward-reference CTEs need positional --json. A truncated JSON query reports its repair on stderr without corrupting stdout. Default `sql`, `data` and `releases` output also reports a nonzero dormant-row count on stderr; a missing active table names its retained rows and the concrete dormant query. `sql --dormant --release ./deployment` shows retained rows/cells, including removed tables; `sql --all-releases --release ./deployment` adds active images. `_snapback_state`, `_snapback_source` and `_snapback_columns` identify provenance and provided cells; these are retained images, not historical snapshots. Both modes are read-only; internal tables remain unavailable. Inspection bypasses read rules and can show expired stored rows; it is an operator tool, not an app query surface. Bind loopback behind a TLS proxy. Forward Authorization and preserve response bodies; allow long polls without buffering or early timeouts. Non-loopback HTTP requires `--i-understand-cleartext` and a trusted private hop behind TLS. Identity rate keys use the socket peer, not forwarded headers. Serve refuses personas and dev doors even through a local proxy; see SERVER.md for capacity. `--json-objects` returns `{header, columns, rows, limit, more, ruleFiltered:false}` with object `rows`; `--json` uses positional `rows`. Put flags outside the quoted SQL. N_NO_PRODUCTION_WRITER means no production insert path can bootstrap this table. It groups root blockers with their dependents; persona-only schemas get one identity note. Add a service-seat insert mutation and provision real account relationships. E_UPGRADE means installation or post-upgrade check failed. Repair the package-manager or registry error and rerun upgrade. Packages may already be pinned: if check failed, repair the reported schema/device refusal and rerun check.

## Capture a saved version (SQLite)
After check and business cases pass, from the app root:
```sh
snapback4 deploy ./deployment --save-version versions/v1
snapback4 rollback ./deployment --to 1 --check --bridge ./bridge
snapback4 deploy ./deployment --schema ./bridge --restore-dormant --check
```
The new versions/v1 captures selected modules, their contemporary fixtures, an importable `versions/v1/generated/api.ts` plus its package marker, and `versions/v1/release.json` with the actual immutable release id, source hash and CLI version. An unchanged deploy keeps its id and may refresh those derived generated/label artifacts only when the saved directory's complete Quarry source set and bytes exactly match the selected source; source and fixture evidence stay intact, and differing source refuses. Choose a new positive-numbered versions/vN for changed source; saving cannot combine with --check. Saved-source deploy uses its own fixtures and emits the saved source's API rather than the working tree's API. Use the recorded id when choosing a baseline; since_release remains the author-supplied newer-schema label. The bridge starts from complete target Quarry operations with compatible value domains loosened to include current data, retaining new tables with their current rules, plus this app's `bridge/ROLLBACK-CHECKLIST.md`. Retain current domains, audiences, guards and quotas; repair records through authorized mutations; prove blocked cases refuse and affected lists/counts remain correct; repeat the old-source preview. No bridge is activated or business migration synthesized. JSON includes checklist; --verbose retains full evidence/index paths. Dormant rows reserve ids but no unique slots: new active rows may block restoration. A widened non-unique bridge permits repair before reinstating uniqueness; retained storage cannot supply absent safety logic. Hot deploy and rollback require the running `serve` host to support this CLI's activation protocol, including `--exact` selection of original source. If `E_RELEASE_RUNTIME` says the host predates release custody, restart `serve` with this CLI and repeat the command; the mixed-version request refuses before activation.

## Keep v1 clients working (SQLite)

`deploy --check --json` reports `clientCompatibility` separately from data adoption: missing operations, changed kinds, required new arguments, removed or narrowed inputs, result shape/value changes and changed refusal codes/messages. Deploy prints the same warnings. Input breaks name the old release and the E_INPUT/E_OP outcome. A result or behavior review asks you to verify the intended contract; a correct new privacy denial is intentional behavior, not an input shape failure. The comparison is conservative, not a proof of unchanged logic. For example, save this v1 source and its callers sending `{name:"Ada",obsolete:"old input"}` to `greet`:

```quarry
use identity guests
query greet(name: text <=40, obsolete: text <=40):
  return {message: name + '!'}
```
Deploy this v2 source. The unchanged v1 call still returns `{message:"Ada!"}`; new callers can use `greeting` and omit `suffix` and `obsolete`:

```quarry
use identity guests
query greeting(displayName: text <=40 alias name, suffix: text <=1 default '!', obsolete: text <=40 deprecated):
  return {message: displayName + suffix}
alias greet = greeting
```
`alias name` maps the old argument to `displayName`; supply either spelling, never both. Use the alias for renames; `deprecated` deliberately discards its value. A literal default handles omitted or null arguments and must fit the declared scalar type; explicit non-null input still validates. `deprecated` accepts a validated optional argument but forbids referring to it in the body. Unknown arguments still refuse. These modifiers apply to non-native Quarry queries and mutations; helpers, actions and jobs keep their distinct invocation contracts. Aliases target an authored query/mutation in the same module, carry the same rules/guards/results, and cannot chain. Retain the old endpoint until its callers have retired; preserve the old result projection and handle intended denials.

Deploy registers a compiled visible view for widened domains and relaxed unique keys, or refuses unsupported adaptation. It also reports remaining reverse-projection risks: dropping a required old column or widening a value domain can strand newly written rows. The preflight separately attempts exact reverse adoption on its post-deploy snapshot, naming present-data failures. Keep old fields and compatible domains in an expand/contract bridge; after writes run the named `rollback <deployment> --to N --check --bridge <new-dir>` before selecting N. A green snapshot never freezes later writes.

## Persistent production: SQLite v1 → v2 → rollback → forward

Replacement transforms read reversible preimages; input types cover original/native rows. `down table name(typedInputs): {oldField: expression}` declares a reversible old view for newer rows; exact old preimages win, conflicting projected-cell edits refuse forward. Native preimages and old-view outputs must be authoritative scalars; use separate scalar columns instead of replacing a reference, asset, collection or lifetime field. Reference inputs retain their parent lifetimes across older views; deleted/reused parents refuse forward. Unrepresentable values stay dormant. `newField: Type renamed from oldField` carries a scalar cell both ways; asset columns and asset lists move their actual cell and single home together. Reference renames require identical target/type/on-delete semantics and retain lifetime evidence; engine-owned moves refuse before activation; keep old operation/result wrappers where clients need them.

A table declares `table observations renamed from behaviors:` to preserve its row/reference identity and old-release writes; it refuses merging independent table histories. Ordinary backfill expressions may read indexed cross-table `exists` or unique points against one pre-patch snapshot. The language-card example uses migration-only `fileText(file)` with `nonemptyLines(text)` for repeated nonempty UTF-8 entries; unavailable bytes, invalid UTF-8 or a job-meter cut refuse atomically. It never supplies ordinary mutation-time file validation. Active writes refresh accepted backfill inputs; older-release edits still need recomputation agreement or conflict repair. An absent optional rename destination is not a conflict.

Computed `down` cannot replace files/images, asset lists, references or a missing table. Required → optional media, an album becoming empty, or nullable money needs a generated loosened-target bridge when no truthful scalar substitution exists. Review target operations reading loosened columns and nullable UI assumptions. Keep current safety guards absent from the target; retaining new tables does not make them visible through frozen old operations. Automatic registered views handle compatible widenings. For an authored bridge, deploy it as a new release with `--restore-dormant`, first with `--check`.

Save this script and run it with Node. `PRODUCTION_DIR` selects its persistent store; reruns preserve rows/users. It proves backfill, privacy and rollback/forward behavior. This example widens the stored weight domain, so deploy registers a view. Default rollback preserves current privacy through that view; `--exact` deliberately restores v1's broader reads after an explicit review. REL5 owns reactivation/old-client reporting; SEC3 owns privacy/audit.

```js
// day-two-production.mjs — this exact fence runs against the packed package.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { cli, deploy, rollback, startServe } from "snapback4/proof";
import { signup } from "snapback4/auth";
const directory = resolve(process.env.PRODUCTION_DIR ?? "production-day-two");
const v1 = `use identity password
table roles:
  principal: principal
  role: enum('member', 'reviewer')
  unique principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only
mutation provision(principal: principal, role: enum('member', 'reviewer')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] {principal, role}
table tickets:
  owner: principal
  body: text 1..200
  legacy: text <=200 ?
  weight: int 0..5000
  length: int
  read <- .owner = viewer or exists roles[principal = viewer, role = 'reviewer']
  insert <- .owner = viewer
  update <- .owner = viewer
  online only
mutation add(body: text 1..200, weight: int 0..5000, length: int):
  return insert tickets {owner:viewer, body, legacy:body, weight, length}
mutation revise(ticket: tickets, weight: int 0..5000):
  update tickets[ticket] {weight}
query ticket(ticket: tickets):
  return tickets[ticket]
`;
const v2 = v1.replaceAll("weight: int 0..5000", "weight: int 0..10000").replace("  owner: principal", "  vehicleClass: enum('car', 'van', 'commercial')\n  owner: principal")
  .replace("  read <- .owner = viewer or exists roles[principal = viewer, role = 'reviewer']", "  read <- .owner = viewer")
  .replace("{owner:viewer, body, legacy:body, weight, length}", "{owner:viewer, body, legacy:body, weight, length, vehicleClass:'commercial' if weight > 3500 else 'van' if length >= 500 else 'car'}")
  + `backfill tickets vehicleClass(weight: int, length: int):
  {vehicleClass:'commercial' if weight > 3500 else 'van' if length >= 500 else 'car'}
-- Spec: only the ticket owner may revise its weight.
invariant tickets.revise only .owner = viewer
invariant tickets.read only .owner = viewer
down tickets legacyText(body: text 1..200): {legacy:body}
`;
for (const [version, source] of [["v1", v1], ["v2", v2]]) {
  mkdirSync(`versions/${version}`, { recursive: true });
  writeFileSync(`versions/${version}/schema.q`, source);
}
async function checked(args) {
  const result = await cli(args);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  return result.stdout;
}
async function snapshot() {
  const count = JSON.parse(await checked(["sql", "SELECT COUNT(*) FROM tickets", "--release", directory, "--json"])).rows[0][0];
  const full = JSON.parse(await checked(["sql", "SELECT id, owner, body, weight, length FROM tickets ORDER BY id", "--release", directory, "--limit", String(Math.max(1, count + 1)), "--json"]));
  assert.equal(full.rows.length, count, "complete population");
  return new Map(full.rows.map(row => [row[0], row]));
}
if (existsSync(directory + "/store.sqlite")) await rollback(directory, 1, {args:["--exact"]});
else await deploy(directory, "versions/v1");
const host = await startServe(directory);
try {
  const before = await snapshot();
  const users = [];
  for (const role of ["member", "reviewer"]) {
    const signed = await signup(host.url, `${role}-${randomUUID()}@example.test`, randomUUID() + randomUUID());
    assert.equal(signed.ok, true);
    users.push(signed.session);
  }
  const [alice, reviewer] = users;
  async function post(path, session, args) {
    const response = await fetch(host.url + path, { method:"POST", headers:{"content-type":"application/json", authorization:`Bearer ${session.token}`}, body:JSON.stringify({args}), signal:AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    return response.json();
  }
  const operator = {token:await host.operatorToken()};
  for (const [index, role] of ["member", "reviewer"].entries()) {
    assert.equal((await post("/m/provision", operator, {principal:users[index].principal, role})).state, "sent");
  }
  const first = await post("/m/add", alice, {body:"historical ticket", weight:1000, length:400});
  assert.equal(first.state, "sent");
  const ticket = first.result.id;
  assert.equal((await post("/q/ticket", reviewer, {ticket})).data.body, "historical ticket", "v1 reviewer can read");
  const historical = await snapshot(); assert.equal(historical.size, before.size + 1);
  const preview = await checked(["deploy", directory, "--schema", "versions/v2", "--check", "--restore-dormant"]);
  assert.match(preview, /vehicleClass/);
  assert.deepEqual(await snapshot(), historical, "read-only preview");
  await deploy(directory, "versions/v2", {args:["--restore-dormant"]});
  assert.deepEqual(await snapshot(), historical, "historical fields preserved");
  assert.equal((await post("/q/ticket", alice, {ticket})).data.vehicleClass, "car");
  assert.equal((await post("/q/ticket", reviewer, {ticket})).data, null, "v2 tightened privacy");
  const oldCall = await post("/m/add", alice, {body:"old-shaped call on v2", weight:4000, length:400});
  assert.equal(oldCall.state, "sent"); assert.equal(oldCall.result.vehicleClass, "commercial");
  const allV2 = await snapshot(); assert.equal(allV2.size, historical.size + 1);
  await rollback(directory, 1);
  assert.deepEqual(await snapshot(), allV2, "native rows preserved"); assert.equal((await post("/q/ticket", reviewer, {ticket})).data, null, "default view keeps current privacy");
  assert.equal((await post("/q/ticket", alice, {ticket})).data.vehicleClass, "car");
  await rollback(directory, 1, {args:["--exact"]}); // Deliberate original-source exercise; default keeps v2 policy.
  const oldView = (await post("/q/ticket", reviewer, {ticket})).data;
  assert.equal(oldView.body, "historical ticket"); assert.ok(!("vehicleClass" in oldView));
  assert.equal((await post("/q/ticket", alice, {ticket:oldCall.result.id})).data.legacy, "old-shaped call on v2", "declared reverse view for native row");
  assert.equal((await post("/m/revise", alice, {ticket, weight:4000})).state, "sent");
  const changed = await snapshot(); const expected = new Map(allV2); const changedRow = [...expected.get(ticket)]; changedRow[3] = 4000; expected.set(ticket, changedRow);
  assert.deepEqual(changed, expected, "only intended edit");
  await rollback(directory, "latest");
  assert.deepEqual(await snapshot(), changed, "complete population preserved");
  assert.equal((await post("/q/ticket", alice, {ticket})).data.vehicleClass, "commercial", "old edit caught up");
  assert.equal((await post("/q/ticket", reviewer, {ticket})).data, null, "privacy restored");
  console.log(JSON.stringify({status:"passed", persistent:true, before:before.size, after:changed.size, backfill:"car → commercial after v1 edit", privacy:"v1 broad → v2 private → default private → exact v1 broad → v2 private"}));
} finally { await host.stop(); }
```
Storage, users and rows survive. Resolve reported conflicts through a truthful bridge.
Deploy and deploy --check lead with a verdict and test status. Changed-scope security review is last, followed by a repeated verdict; full JSON retains all findings. Ordinary check policy belongs to SEC7. The recorded test result includes its age; stale or missing evidence is explicit. Without a matching completed campaign they demand `snapback4 test` for the selected source and fixtures (saved-source previews name `test --source`). Add `--strict` to refuse reachable refuted intent before activation; unproved intent and no-invariant notes remain advisory. A finite campaign is evidence, not proof. See `guide security` for the independent-intent loop.

Migration warnings require a recorded older version crossing the behavior's introduction. Fresh init/check stays quiet; stderr delivery acknowledges the installed version, including CI. Paths cover session literals, advance arithmetic, persistent startDev and data --json. Future known-family store formats refuse with “a newer Snapback (FORMAT)”; upgrade the CLI. SQL inspection also exits nonzero.
