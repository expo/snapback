# Day-two discovery plan — Jukebox Restorations

Recorded 2026-10-27T21:09:26Z. Scope: reading and planning only, entirely within
`/tmp/dx16-replay/after-001`. No backend/UI changes, adapt application, package
installation, deployment, provisioning, server launch, build or proof execution
was performed. Commands below are **future implementation commands**, unless
explicitly listed as discovery evidence. This is not a completion/proof report.

## Evidence and documentation path

Started with `npx snapback4 init --adapt --day2` without `--apply`; it confirmed
preview-only operation. Followed the required-field route:

```sh
npx snapback4 guide deploy --section 'Migrations and adoption'
npx snapback4 guide deploy --section 'Which migration shape'
npx snapback4 guide api proof
npx snapback4 guide production --section 'Serve script and reusable accounts'
```

Two targeted follow-ups concerned backfill re-entry and rollback:
`npx snapback4 guide deploy --section backfill` redirected to the already-read
migration section; `npx snapback4 guide deploy --section rollback` explained
retained cells, compatible views, exact rollback and activation completion.
No full guide, implementation of `snapback4/proof`, declaration dump or backend
source repository was read. The inherited `client:calls` implementation was
left unopened: reuse it as the frozen business probe.

Read all three `PREVIOUS-*` handovers. Examined the app schema, relevant UI
consent/rendering sites, package manifests, shared SDK, production/staging
wrapper and audit adapter, plus selected proof setup references. No other
workspace, transcript, session log or prior probe result was consulted.

Observed:

- `package.json` and `package-lock.json` pin `snapback4` and `snapback4-expo`
  to `0.4.43`. The **installed** `node_modules/snapback4/package.json` says
  **0.4.44**. `node_modules/snapback4-expo/package.json` is absent. The
  predecessor's successful checks concern its earlier installed environment,
  not this replay's current dependency tree.
- `npx snapback4 releases data/release --json` reports current/latest release
  **1**, generation 1, exact source, no rollback views. Its row shape has
  `profiles` and `restorations`, without a consent summary.
- `snapback/schema.q` and
  `data/release/releases/1/snapback/schema.q` have identical SHA-256:
  `ca6ca972fdbba5262a46e230bc4f1bf6aa9a9abed17a37817ad270f17d47a047`.
  The saved release is authoritative for v1; do not recapture v1 from edited v2.
- `deploy`, `versions/v1`, `versions/v2` and `v1` do not exist yet.
  Persistent data is at `data/release/store.sqlite`; the release directory
  also contains assets, release history, WAL/SHM and ownership metadata.
- The existing roster is `data/release/proof-accounts/workshop.json`, with
  lock artifacts. Only names were inspected, never credential contents.
  `default.json` is absent. `.harness-env.json` and root `AGENTS.md` are absent.
- Existing scripts lack `day2:proof` and all three `prod:*` entries.
  `startStaging({persistent:true})` deploys the working schema before serving;
  it therefore cannot implement a serve-as-it-stands stage.
- The existing persistent audit adapter reads just active rows from SQLite
  table `r`. It is insufficient evidence for retained columns/rows after
  release changes. The published `snapshotAll`/`data --all` interface includes
  active and retained data, deduplicated by ID, with active values winning.

No check was run. No current pass/fail score is claimed.

## Source shape and access decision

Use a required, persisted enum column, a named historical backfill and explicit
maintenance in the existing create/consent operations. No rename, extraction,
new consent document format or replacement of existing records is needed.

Proposed Quarry edits to `snapback/schema.q`, copied into `versions/v2` after
v1 is safely frozen:

```quarry
# Within table restorations (use Quarry -- comment syntax in the actual file):
  selectorConsentSummary: enum('written consent held', 'no written consent recorded') read <- .ownerId = viewer or exists profiles[viewer, role = 'foreman'] or exists profiles[viewer, role = 'master']

backfill restorations selectorConsentSummaryV2(consentText: text 20..4000 ?):
  {selectorConsentSummary: 'written consent held' if consentText != null else 'no written consent recorded'}
```

Use `consentText != null` as the historical predicate: this is the actual
owner-authored written authorization, not approval or a timestamp alone.
The inherited `giveConsent` writes both text and time atomically. Audit all
rows for a text/time mismatch; retain inconsistent original values and report
them rather than fabricate consent. Keep the backfill name and meaning stable.
Do not use viewer/now to invent historical values or a literal default as the
historical migration.

Compact operation deltas:

```text
openRestoration(existing arguments):
  keep all existing guards, uploads, deadlines and fields
  insert {...existing, selectorConsentSummary: 'no written consent recorded'}
giveConsent(job, writtenConsent):
  keep NOT_OWNER, WRONG_STAGE, CONSENT_RECORDED and all existing guards
  update {consentText: writtenConsent, consentAt: now,
          selectorConsentSummary: 'written consent held'}
approveSelector(job):
  keep master-only authority AND consentAt != null AND consentText != null
  do not replace the prerequisite with a client-set summary
```

Retain the existing row read audience so technicians still receive the shop
board. Apply privacy at the new column, intersecting with row access. Do not
add a client-set summary argument or an alternate write endpoint. Keep the
names, arguments, envelopes, return types and guard codes of all v1 operations.
Existing `{*}` and nested row results must retain the column's policy: test
both `board` and `restoration`, not just the UI. Whole-row hidden properties
should be omitted; a scalar selection should yield null if such a selection
is exposed. Do not invent an unsupported scalar-query endpoint for the proof.

In `App.tsx`, render the exact new server-provided enum label for a foreman,
master or the job's owner, treating the SDK field as optional. Never fall back
to a consent-derived summary when the field is absent. The current details
panel already renders “No written consent recorded.” for every staff role;
gate/remove that technician-facing summary as part of this change. Preserve
existing consent text, photographs, quote and workflow UI. Backend assertions
must demonstrate privacy without relying on role checks in React.

The inherited consent text/time are themselves readable by technicians.
This route restricts the **new summary field** and its UI, while preserving
the old document audience. It does not promise to hide information inferable
from already-readable documents. A stronger inference/privacy interpretation
would require tightening those old fields too and measuring the resulting v1
compatibility change; that is an explicit unresolved product interpretation.

## Capture v1 and retain the inherited production

Do not delete/recreate the inherited deployment or copy just its SQLite file.
Use `./deploy` as an in-workspace directory alias of the entire existing
`data/release` tree. This preserves the database, assets, history and existing
roster together. Future setup, after confirming no owned host is running:

```sh
node -e 'const fs=require("node:fs"); if(fs.existsSync("deploy")) throw Error("inspect existing deploy first"); fs.symlinkSync("data/release","deploy","dir")'
npx snapback4 releases ./deploy --json
npx snapback4 init --adapt --day2 --apply
```

Verify that the alias resolves inside this workspace and that release 1 still
matches the recorded schema digest. The alias's acceptance by the installed
release/provisioning helpers remains untested. If unsupported, stop and plan
an offline whole-directory relocation; never create a second divergent store.
Leave `backend-choice.json.databaseFiles` as `data/release/store.sqlite` while
using the alias; do not count the same physical database twice.

The adapt preview promises absent `versions/v1`, `versions/v2`, a frozen `v1/`
ESM client/API package and missing proof infrastructure. It leaves authored
proofs and application-owned files alone. Verify its frozen dependency closure
includes this app's custom SDK/test-data imports and current generated API;
do not reconstruct the old business calls or import the future v2 API there.
Keep the original saved release source alongside the v1 snapshot.

For a genuinely absent production, the documented v1 capture command is:

```sh
npx snapback4 deploy ./deploy --save-version versions/v1
```

**Do not use that to overwrite/re-capture this already-saved release 1.** Reuse
its source and verify the generated `versions/v1` matches it. Frozen v1 client
hashes must remain fixed through the rest of the work. Record v1 release ID 1
in private driver state; do not assume future v2 has ID 2.

## Package reconciliation and validation order

There is no manifest upgrade to make, but the installed tree does not satisfy
the requested exact versions. In an implementation session, reconcile it
without changing registry or downloading browsers:

```sh
npm install --save-exact snapback4@0.4.43 snapback4-expo@0.4.43
node -e 'const fs=require("node:fs"); for(const n of ["snapback4","snapback4-expo"]) { const p=JSON.parse(fs.readFileSync("node_modules/"+n+"/package.json","utf8")); if(p.version!=="0.4.43") throw Error(n+": wrong version"); console.log(n+"@"+p.version) }'
npx snapback4 init --adapt --day2
```

The handover/docs read here came from installed **0.4.44**. Confirm that the
required adapt, release, backfill and helper APIs exist on **0.4.43** before
mutating production. A missing capability is a version-bound limitation,
not permission to ship 0.4.44 silently. No install is authorized in this session.

After implementing only the deltas above and adapting fixtures:

```sh
npm run check
npx snapback4 test --source versions/v2
npm run acceptance
npm run acceptance
npm run frontend:proof
npm run frontend:proof
```

Change acceptance setup from the inherited temporary staging **serve** helper
to `startDev` plus real password-account provisioning via `devAccounts`;
preserve private `advance`/`drain` time tests. The original contract specifically
requires a live development backend. Production drivers must never advance
time. Extend acceptance to exercise both values, both users of all four roles,
unauthenticated and cross-owner reads, technician field omission, board/detail
consistency, old approval prerequisites and post-consent maintenance.

Keep frontend proof self-contained: typecheck, fresh `npx expo export -p web`,
start its backend and static server, use `$CHROME` with `--no-sandbox`, sign in
through the UI, accept a fresh quote as owner, record written consent, observe
the summary change and persistence after reload. Add a technician UI check
that the summary label is absent. No cached dist or frontend install in discovery.

## Production drivers and persistent roster

Add the following scripts during implementation, without changing frozen v1:

```json
{
  "day2:proof": "node scripts/day2-proof.mjs versions/v1 versions/v2",
  "prod:serve": "node scripts/prod-serve.mjs",
  "prod:rollback": "node scripts/prod-stage.mjs rollback",
  "prod:forward": "node scripts/prod-stage.mjs forward"
}
```

Use `startServe('./deploy', ...)`, which serves production through the real
CLI, rather than the inherited deploy-on-start `startStaging`. Reuse the
existing roster name **workshop** and the unchanged enrollment plan/args from
`scripts/staging.mjs`:

```js
const provisionUsers = {
  roles: {owner: 2, foreman: 2, technician: 2, master: 2},
  provision: api.provision,
  roster: 'workshop',
  args: a => ({
    name: `${a.role[0].toUpperCase()+a.role.slice(1)} ${a.email.split('@')[0].slice(-6)}`,
    email: a.email
  })
};
```

`startServe` returns ordinary accounts `{kind,role,email,password,principal,
token,expiresAt}` in `host.sessions`. Signup creates identity; the existing
private operator-only `provision` mutation enrolls its role. No public seed,
role switch or bypass. Reuse accounts and sessions within a run. Persist the
0600 roster with its store; never delete it, its partial entries or locks to
force a rerun. A pinned-plan mismatch or live setup lock needs inspection and
a deliberate recovery, not a new accidental batch. Do not print credentials
to this plan, diary, friction or report.

```text
prod:serve:
  load optional private harness config server-side, without logging it
  host = startServe('./deploy', {provisionUsers, env, ...boundedOptions})
  print exactly one JSON readiness line {backendUrl: host.url, users: host.sessions}
  await serveUntilSignal([host]); finally await host.stop()
  # No deploy, rollback, schema adoption or frontend build.

probe:serve:
  await the idempotent forward stage; then startServe('./deploy', ...)
  build Expo web with EXPO_PUBLIC_SNAPBACK_URL=host.url
  startStatic('dist'); print one JSON line {backendUrl, frontendUrl, sessions, apiNotes}
  await serveUntilSignal([host, web]); finally stop both owned handles
```

Keep `apiNotes` sufficient for login with the two harness inputs; ordinary
sign-in needs no public API key in this app. Send build/CLI logs to files or
stderr, never readiness stdout. Keep secrets out of frozen source and dist.

All hosts must bind only `$PORT_LO`–`$PORT_HI` (21010–21019), confirm the
answering instance belongs to this driver and retain child handles/PIDs.
The inherited `unusedPort()` merely checks then closes a port, so it cannot
guarantee ownership. Use a bounded launch/retry on bind conflict, without
killing another listener. Preserve process groups and `finally` cleanup;
SIGTERM must stop every owned child. No process-name or port-based killing.

## Exact release commands and stage semantics

These are the selected CLI arms, from the saved v1 baseline:

```sh
npx snapback4 deploy ./deploy --schema versions/v2 --check
npx snapback4 deploy ./deploy --schema versions/v2
npx snapback4 releases ./deploy --json
npx snapback4 rollback ./deploy --to 1 --check
npx snapback4 rollback ./deploy --to 1
npx snapback4 releases ./deploy --json
npx snapback4 rollback ./deploy --to latest --check
npx snapback4 rollback ./deploy --to latest
npx snapback4 releases ./deploy --json
```

`prod:rollback` selects saved release 1; `prod:forward` deploys/adopts
`versions/v2` (preview first) when absent, otherwise selects the recorded v2
release. Use `latest` only while it is verified to mean that v2 source;
persist/resolve its actual release ID from history for general reruns. Both
scripts work from either state, return after activation, start no persistent
host and leave none running. A live caller-owned serve can switch through
its authenticated control path; stage scripts must not stop an unowned host.

Default rollback can select a registered compatible view retaining current
guards and operations. Inspect `live.source`, `live.view`, `live.exact` and
row shape; record the actual selection. Do not use `--exact` automatically:
it requests original source and requires deliberate policy review. Await
activation receipts instead of sleeps. Preview is a private snapshot, not a
guarantee against later writes. On ambiguity inspect release history before
retrying; on `E_STORE_BUSY` stop only a host owned by this driver. Never
prune, reset, discard dormant cells, bypass adoption or delete production.

**Re-entry issue requiring an implementation proof:** removed summary cells
can be retained during v1, and old active updates keep retained cells. A
historical backfill alone does not establish that a retained `none` summary
will refresh after v1's `giveConsent`. Prefer the documented compatible view
when it retains v2's consent-maintaining operation and defaults. Explicitly
test its actual workflow and old endpoint behavior. If it runs the original
v1 operation, an authored guarded re-entry migration/view is required before
claiming success; the sections read do not supply exact syntax for that
repair. Do not assume reusing or renaming the historical backfill repairs it.
An exact v1 arm is blocked until this case is resolved. Preserve all v2-native
rows and documents, including rows with no v1 preimage.

## Complete preservation and frozen-client proof

Use the published inspection contract, not first-page board results:

```sh
npx snapback4 data profiles --release ./deploy --all --json
npx snapback4 data restorations --release ./deploy --all --json
```

Or use `snapshotAll('profiles', {release:'./deploy'})` and
`snapshotAll('restorations', {release:'./deploy'})` from `snapback4/proof`.
Update `harness:snapshot` to return one JSON object with these complete tables,
stable IDs and no identity bookkeeping/credentials. It must be read-only and
work when serve is live; verify locking behavior before choosing CLI versus
the existing SQLite adapter. The current adapter cannot simply be relabeled
complete. Admin inspection is preservation evidence, not privacy evidence.
Use `exhaustPages` where business queries need complete coverage; never assume
the inherited 50-row board is all production.

The generated `day2:proof` template owns a **fresh temporary store** and its
default business hook proves storage conservation only. It does not satisfy
this harness's persistent-production contract unchanged. Replace that driver
with this bounded orchestration, retaining useful helper interfaces:

```text
acquire a driver lock; validate persistent store/history and saved source IDs
try:
  inspect current state; preserve an initial all-table snapshot
  put saved v1 live without rebuilding/resetting production
  start production host; reuse workshop accounts via real login/signup
  also use freshUser(host,{role,provision:api.provision,args}) for isolated batches
  use uniqueName/UUID for each newly written model/serial
  create v1 rows through app operations: with consent and without consent
  capture ALL app rows/IDs, original fields, photo references and asset hashes
  stop owned host if needed; preview + deploy v2; restart owned production host
  assert every baseline ID and original document/photo/quote/progress survives
  assert every active restoration's summary equals predicate(consentText)
  assert all baseline touched IDs are actually readable to authorized users
  exercise new rows, giveConsent updates and role/owner privacy matrix
  run frozen v1 client on changed backend; retain every structured outcome
  capture full post-v2 state, including v2-native rows and client writes
  rollback; inspect source/view/exact and complete retained + active data
  assert baseline and v2-written IDs/content remain, run frozen v1 again
  make a v1 consent write to a previously no-consent row
  create another fresh v1 row during rollback
  forward; assert all rows, summary freshness and v2 rule again
  run frozen v1 once more on forward for additional evidence
  account for its writes and inspect the final full state
  write day2-proof.json truthfully, then leave the release selection at v2
finally:
  close all SDK clients, stop every owned host, release only own driver lock
```

Production proof time is always the real clock. Write fresh business cases
and act immediately, never wait for a time-of-day window or exercise delayed
expiry/storage rules by sleeping. Pre-existing rows may already be overdue;
do not try to accept them. Preservation comparisons allow only explicit
business writes and precisely validated existing expiry/storage job effects
using observed time bounds. Do not mask all differences in progress/money.
Compare full pre-existing values/IDs, not just counts. Keep snapshots in
memory/private proof scratch and do not put consent documents in logs.

Frozen replay invocation (generated runner accepts a private JSON file path):

```sh
BACKEND_URL=http://127.0.0.1:21010 CALLS_USERS=.scratch/day2-users.json npm --prefix v1 run client:calls
```

The driver substitutes its owned host URL; 21010 is only the invocation
example, not a fixed launch port. Create `.scratch/day2-users.json` with 0600
permissions from `host.sessions`; remove this driver's temporary credential
file in `finally`. Do not pass a token/operator key or private harness config
into frozen source. Hash frozen source/API before and after each arm.

Keep the inherited v1 calls unchanged. Record works/degraded/broken from real
per-call results, separately from intentional guard refusals and transport
failures. A frozen-client failure must not disappear into a success claim;
continue through later release arms and write the evidence even on failure.
Only an actual preservation/feature/privacy failure fails those assertions;
v1 compatibility itself is measured and reported, not presumed.

Extend the working `scripts/client-calls.mjs` to v2 business calls without
touching the frozen copy. Print one JSON object per call and continue after
failures. An expected refusal must use `ok:false`, `expected:CODE`, and an
`error` starting with that same code. Test hidden-field omission as a
successful restricted read; do not label it as a nonexistent refusal code.

Write every specified key in `day2-proof.json`, including counts over **all**
restorations, source/view details in notes, actual rollback/forward results,
v1 outcomes and `migrationFiles: ['snapback/schema.q',
'versions/v2/schema.q']` plus any later re-entry/view file. Set
`migrationPreservesV1Rows` only from assertions. This stack exposes release
rollback, so use the release mode: `v1ClientAfterChange:null`; do not silently
substitute compatibility-only mode or use null rollback results.

## Rerun schedule and remaining limits

Future complete validation commands, after the checks above:

```sh
npm run day2:proof
npm run day2:proof
npm run prod:rollback
npm run prod:forward
npm run prod:rollback
npm run prod:forward
```

Around **each** stage, independently snapshot all persistent data, start
`prod:serve` through an owned bounded process, parse its single readiness
line, replay frozen v1, then terminate/reap that owned group. On v2 arms,
run the working v2 client twice. On the second rollback, assert that business
reads return the applicable v2-written rows as well as that admin snapshots
retain them. Finish with forward. Verify `probe:serve` separately with an
owned bounded checker: readiness, eight users, real sign-ins, frontend access,
liveness beyond 30 seconds, then controlled shutdown. No server stays running
when implementation finishes; “v2 live” means the durable selected release.

Unresolved until an implementation session:

1. Exact 0.4.43 support for the 0.4.44 CLI/doc contracts used here, and the
   missing installed adapter. No downgrade/install/check was performed.
2. Release-helper support for the in-workspace deployment alias; the existing
   roster's pinned plan and lock health were not read or exercised.
3. Which rollback view will actually be selected; truthful summary maintenance
   after original-v1 writes, retained values and v2-native rows on re-entry.
4. Field privacy propagation through both existing result shapes and actual
   frozen SDK compatibility. These require live assertions, not inspection.
5. Whether the inherited audit's active/retained merge needs a custom adapter
   while serving. No complete data snapshot or asset audit was run here.
6. Stronger privacy against inference from old consent documents, as described
   above, is outside the chosen field-only route and cannot be claimed.
7. No current check, acceptance, browser, deployment, stage or production proof
   result exists from this discovery session.

During implementation, keep new `DIARY.md` and `friction.jsonl` current and
write `REPORT.md` only with observed results, including comparison with the
read predecessor handover. The package-tree mismatch is the first discovered
environment friction; the temporary-store template versus persistent harness
is a proof-contract adaptation, not an observed backend correctness defect.
This session stops at this plan; it does not implement any of these steps.
