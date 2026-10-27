# Day-two discovery plan — Jukebox Restorations

Recorded: 2026-10-27T21:42:03Z. Scope: `/tmp/dx16-replay/after-001` only.

This is a reading/discovery deliverable, not an implementation report. Commands
below are proposed execution commands unless explicitly listed as already run.
No backend/UI edits, dependency installation, deployment, account provisioning,
frontend build or full proof execution was performed. No end-to-end score is
claimed. `PREVIOUS-*` remains the inherited handover.

## Findings and documentation path

The first command was `npx snapback4 init --adapt --day2`. It printed the day-two
handover and an adaptation preview, explicitly reporting **no files changed**.
The selected route was **add a required field computed from old values**:

```sh
npx snapback4 guide deploy --section 'Migrations and adoption'
npx snapback4 guide deploy --section 'Which migration shape'
npx snapback4 guide api proof
npx snapback4 guide production --section 'Serve script and reusable accounts'
```

Targeted follow-ups for frozen callers, rollback/re-entry, deployment paths and
release saving were:

```sh
npx snapback4 guide deploy --section 'Keep v1 clients working'
npx snapback4 deploy --help
npx snapback4 rollback --help
npx snapback4 guide deploy --section 'Rollback'
```

Only the named `ProofPage`, `exhaustPages` and `snapshotAll` declaration excerpts
were inspected to resolve complete pagination. No CLI implementation, full
declarations, other lanes, source repositories or session logs were read.

Inherited facts from `PREVIOUS-DIARY.md`, `PREVIOUS-REPORT.md`,
`PREVIOUS-friction.jsonl` and the necessary app/script sources:

- Four roles: `owner`, `foreman`, `technician`, `master`. Consent is optional
  **text**, `consentText`, with `consentAt`; there is no separate consent-file
  table. Cabinet/changer/lighting photos are separate verified image references.
- Two app tables, `profiles` and `restorations`; 14 operations. Existing row
  access lets all staff read restorations, and owners read only their own.
- `giveConsent` is the only existing consent-changing path. It requires the
  owner, an in-progress stage and no prior consent. `approveSelector` requires
  master role, the existing stage conditions, both consent fields and no prior
  approval. Keep these guards.
- `package.json` and lockfile pin both backend packages to `0.4.43`. Actual local
  `node_modules/snapback4` is **0.4.44**. The Expo adapter, TypeScript and frontend
  dependencies are absent. This discovery used 0.4.44 documentation, not a
  verified 0.4.43 runtime.
- `npx snapback4 releases data/release --json` reports ordinary release **1**,
  current/latest 1, generation 1, exact source 1, no rollback views. It reports
  the original restoration fields, with no summary.
- Production already lives at `data/release/store.sqlite`, with assets and
  `data/release/proof-accounts/workshop.json`. Only roster filenames were read,
  not credentials. `./deploy`, `versions/v1`, `versions/v2` and `v1/` are absent.
  Do not replace this production with an empty deployment.
- The inherited persistent helper deploys to `data/release` on every start;
  acceptance uses a disposable **staging serve**, not a development host. Both
  need different entrypoints for the day-two contracts.
- The inherited snapshot adapter reads the two active SQLite tables directly.
  It does not establish conservation of dormant cells across rollback.
- No root `AGENTS.md` or `.harness-env.json` exists. `PORT_LO`, `PORT_HI`,
  `TMPDIR` and `CHROME` were not supplied to this shell. Do not infer their
  future harness values or locate another builder's browser.

Checks actually run:

| Command | Observed result |
| --- | --- |
| `npm run check` | Exit 127: `sh: 1: tsc: not found`; full project check did not pass. |
| `npx snapback4 check` | Exit 0 under 0.4.44: 2 tables, 14 operations, 0 pending gates; existing nonblocking `N_INSERT_WRITE_INTENT` advisory. No v2 source was checked. |

The adaptation preview would add frozen source/API/package files under `v1/`,
source/fixture snapshots under `versions/v1` and `versions/v2`, and a temporary-
store day-two proof. Its authored-file preservation is useful, but the generated
temporary-store proof alone does **not** satisfy this harness's persistent
production proof.

## Chosen v2 source shape

Use one additive required column, a named historical backfill and explicit
maintenance inside existing mutations. Do not rename tables, operations,
arguments or existing result wrappers; do not reshape media or old fields.
Use the requested display strings as the enum values themselves.

Proposed Quarry additions in `snapback/schema.q`, then mirrored with fixtures
into `versions/v2/schema.q`:

```quarry
-- Inside table restorations, before its existing table-level rules:
  selectorConsentSummary: enum('written consent held', 'no written consent recorded') read <- .ownerId = viewer or exists profiles[viewer, role = 'foreman'] or exists profiles[viewer, role = 'master']

-- At module level; keep this declaration/name stable while its meaning holds:
backfill restorations selectorConsentSummaryV2(consentText: text 20..4000 ?):
  {selectorConsentSummary: 'written consent held' if consentText != null else 'no written consent recorded'}
```

`consentText != null` is the historical evidence predicate: the request concerns
written evidence, not whether a master has already approved replacement. Include
all stages, including returned/collected records. Existing lawful `giveConsent`
writes text and time together. Audit a text/time mismatch without rewriting or
discarding the original evidence; a nonnull text still maps to “held”.

Mutation changes, preserving names, inputs and return shapes:

```text
openRestoration(existing arguments):
    keep every existing guard and intake value
    insert existing fields + selectorConsentSummary = 'no written consent recorded'
    return the inserted row as before

giveConsent(job, writtenConsent):
    keep every existing guard
    atomically update consentText, consentAt,
        selectorConsentSummary = 'written consent held'
    return null as before

approveSelector(job):
    unchanged; require original text AND timestamp, not merely the new summary
```

Do not use an unconditional default as the migration: that would mislabel old
consents. Do not add an arbitrary summary setter or accept a caller-supplied
summary. Other workflow/scheduling mutations leave it alone. No custom `down`
transform is presently indicated: every pre-existing field and type remains
valid for v1, including all v2-created records. The new column should be retained
when absent from v1; prove that behavior rather than treating retention as
application visibility.

Column access is intersected with the unchanged row audience. Authorized
foremen/masters and the matching owner get the field. Technicians receive whole
rows with the field **omitted**; scalar selection, if exposed, must return null.
Other owners still cannot get the row. Check the `board` wildcard projection,
`restoration` nested row and `openRestoration` result, including raw transport
JSON, so wrapping a row cannot leak the field. Generated client properties must
be treated as optional because of field privacy.

Frontend changes belong in `App.tsx`'s `JobCard` and generated types only as
needed. Render the exact summary when it is present and the signed-in role is
owner/foreman/master. Never turn a missing property into the negative summary.
The existing consent section already prints “No written consent recorded” and
“Owner consent recorded” for all staff: remove/gate those derived summary labels
for technicians, including collapsed cards, details and accessibility text.
Keep uploads, quotes, progress and approval controls. Backend field rules remain
the authority; UI gating is additional.

Privacy limit: original `consentText`/`consentAt` are currently readable by
technicians, so they can infer consent existence. This route restricts the new
summary and its UI labels while preserving the inherited evidence audience.
It does not claim to hide all evidence of consent. If the intended rule includes
inference privacy, those evidence fields and derived approval signals need a
separate, explicit access review; that broader change is not silently assumed.

## Save v1 and retain the existing production store

The following are **future implementation commands**, not authorization to run
them during this discovery session.

Freeze before editing. Use the installed preview's adaptation only once while
the app is still original; preserve inherited `client:calls` and its dependencies
without studying/rebuilding its business implementation:

```sh
npx snapback4 init --adapt --day2 --apply
```

Verify `versions/v1` matches the deployed v1 `.q` modules/fixtures, and preserve
`v1/` plus its generated API independently of subsequent root code generation.
The harness's own frozen copy remains authoritative. Never recapture either
snapshot from v2 on rerun. Keep the full saved sources, not a handwritten
approximation of v1.

Restore the requested actual package versions in an implementation session:

```sh
npm install --save-exact snapback4@0.4.43 snapback4-expo@0.4.43
npm ls snapback4 snapback4-expo --depth=0
npm run check
```

The manifest pins are already correct; the install reconciles the incomplete,
mismatched installation. Revalidate the used CLI flags/proof exports against
0.4.43 before relying on 0.4.44 discovery output. Do not switch registries.

Chosen path arrangement: keep the complete existing release directory in place
and make `./deploy` a directory symlink to **`data/release` inside this workspace**.
This gives the required CLI path without moving/copying a live SQLite database,
splitting its WAL, losing assets, changing the store or abandoning the roster.
`backend-choice.json.databaseFiles` remains `data/release/store.sqlite`.

One-time setup, only when `deploy` is absent; refuse a conflicting existing path:

```sh
node --input-type=module <<'NODE'
import { existsSync, lstatSync, realpathSync, symlinkSync } from 'node:fs';
if (!existsSync('data/release/store.sqlite')) throw Error('Inherited store missing');
let entry;
try { entry = lstatSync('deploy'); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
if (!entry) symlinkSync('data/release', 'deploy', 'dir');
if (realpathSync('deploy') !== realpathSync('data/release'))
  throw Error('deploy must alias the inherited release directory');
NODE
npx snapback4 releases ./deploy --json
```

Require this to report the same release/store identity before activation. Symlink
acceptance by the pinned CLI is not tested here; if refused, stop this setup and
resolve the named refusal without starting a second production store. Do not
silently fall back to a new empty directory or copying only `store.sqlite`.

For an immutable v1 release label use a separate, initially absent destination,
so adaptation's existing `versions/v1` is never overwritten:

```sh
npx snapback4 deploy ./deploy --schema versions/v1 --check
npx snapback4 deploy ./deploy --schema versions/v1 --save-version saved-releases/v1
npx snapback4 releases ./deploy --json
```

Reusing identical v1 should be a no-op. Persist the actual v1 release ID from
history in nonsecret release-state metadata; current discovery suggests 1, but
scripts must verify it, not assume an ID. Save/seal once; later runs reuse it.

## V2 validation, preview, release and both directions

After implementing the source shape and refreshing only `versions/v2`, use:

```sh
npm run check
npx snapback4 test --source versions/v2
npx snapback4 deploy ./deploy --schema versions/v2 --check
npx snapback4 deploy ./deploy --schema versions/v2
npx snapback4 releases ./deploy --json
```

Save v2's adopted immutable ID too. In a stage driver, `V1_RELEASE` and
`V2_RELEASE` below come from verified local release metadata, never credentials:

```sh
npx snapback4 rollback ./deploy --to "$V1_RELEASE" --check
npx snapback4 rollback ./deploy --to "$V1_RELEASE"
npx snapback4 releases ./deploy --json
npx snapback4 rollback ./deploy --to "$V2_RELEASE" --check
npx snapback4 rollback ./deploy --to "$V2_RELEASE"
npx snapback4 releases ./deploy --json
```

The handover's `--to latest` is equivalent only while latest is verified to be
the intended v2. Use explicit saved IDs in reusable scripts. Deploy/rollback
await activation; do not use a settle sleep. Inspect `live.source`, `live.view`,
`live.exact`, row shape and retained items. A compiled compatibility view is
acceptable when disclosed; a successful rollback does not establish exact v1
source or successful frozen calls. Do not add `--exact` automatically or weaken
current access guards to force the old source live.

Only if preview calls for a bridge, request its concrete checklist in a fresh
directory, resolve it and preview again:

```sh
npx snapback4 rollback ./deploy --to "$V1_RELEASE" --check --bridge bridges/v1
```

`--bridge` writes a source/checklist draft, not a completed automatic repair.
Do not use `--allow-destructive`, prune, reset, delete history or automatically
add `--restore-dormant`; follow a concrete refusal and prove the repaired route.

Critical unresolved re-entry case: while v1 is live, its `giveConsent` can change
text/time while a retained summary cell is dormant. On forward, verify the named
backfill produces the current truthful summary instead of restoring a stale
negative value. Also check v1-native rows without a summary preimage. The docs
say backfill is historical, not ongoing maintenance; no claim is made here that
the current declaration alone handles every re-entry case. This is a release
gate. If it fails, resolve with a supported migration/compatible-view design
that retains existing guards and updates consent consistently; do not report a
successful migration based only on the first deployment.

## Persistent accounts and bounded production hosts

Add a production helper separate from the disposable development helper. It
must **serve without deploying**. Reuse the inherited plan verbatim, including
custom name/email arguments and the named roster:

```js
const roles = { owner: 2, foreman: 2, technician: 2, master: 2 };
const host = await startServe('./deploy', {
  env: privateServerEnv,
  logsDir: 'logs',
  provisionUsers: { ...inheritedPlan, roles, roster: 'workshop' }
});
// host.sessions[role][i]: {kind, role, email, password, principal, token, expiresAt}
```

The retained path through the alias is
`./deploy/proof-accounts/workshop.json` (same file as the inherited roster).
Keep it mode 0600 with the store. Do not switch to the helper's default roster,
change the pinned plan, delete locks/credentials or make a new batch on each
rerun. Helpers log in again and provision unfinished entries only; signup alone
does not grant a role. Staff enrollment still calls the ordinary private
`api.provision` as `service:operator`. Never expose that service token or add a
public role-setting shortcut. An ambiguous signup calls for login with the same
credentials, not repeated account creation.

Load `.harness-env.json`, if later present, only in server-side Node code; never
print it, put its values in Expo public variables, or include it in frozen
sources. Readiness is the sole intentional output of ordinary account secrets;
keep passwords/tokens out of this plan, diaries, reports and friction records.

Normalize missing port variables to this assignment's 21010–21019; reject any
range outside it. Pass the bounded environment to all backend/static/browser
drivers. Bind first and verify the owned host's response; a preflight free-port
probe alone is insufficient. Keep every child handle/PID, fail on foreign store
ownership rather than killing it, and stop only owned children in `finally`.
Await `host.stop()` so native children and store locks are released. Hold serve
drivers with `serveUntilSignal` until SIGTERM/SIGINT, and clean up every host.
Logs stay in `logs/`; package-importing scratch code stays in `.scratch/`.

## Script contracts to implement

| npm script | Proposed command | Contract |
| --- | --- | --- |
| `day2:proof` | `node scripts/day2-proof.mjs versions/v1 versions/v2` | Replace the generated temporary-store driver with the persistent production orchestration below. |
| `prod:serve` | `node scripts/prod-serve.mjs` | Serve current release only; reuse roster; one stdout JSON line `{backendUrl,users}`; stay alive. No deploy/rollback. |
| `prod:rollback` | `node scripts/prod-stage.mjs rollback` | Preview then select saved v1; verify identity; no reset; leave no server running. |
| `prod:forward` | `node scripts/prod-stage.mjs forward` | First adoption deploys saved v2; subsequent runs preview/select its saved ID. Verify v2; no server left running. |
| `client:calls` | inherited entrypoint, extended for v2 | Use only `BACKEND_URL` and `CALLS_USERS`; sign in ordinary users, exercise summary reads/consent writes, continue after per-call failures. |
| `harness:snapshot` | `node scripts/snapshot.mjs` | Read all app rows/cells, including retained storage; print one `{tables:{profiles:[...],restorations:[...]}}` object. No auth/session bookkeeping. |
| `probe:serve` | `node scripts/probe-serve.mjs` | Ensure v2 without reset; build for this production backend, start static frontend and persistent production host, emit required readiness, remain alive. |

For `harness:snapshot`, prefer `snapshotAll('profiles', {release:'./deploy'})`
and `snapshotAll('restorations', {release:'./deploy'})` over extending the private
SQLite decoder. Verify these helpers/`data --all` on the pinned version first.
The documented inspection merges active/retained values once per stable ID,
active values winning and deleted rows absent. It bypasses app authorization and
cannot count as privacy or frozen-client evidence. Never serve it publicly.

Admin inspection commands, complete rather than first-page reads:

```sh
npx snapback4 data profiles --release ./deploy --all --json
npx snapback4 data restorations --release ./deploy --all --json
```

For app-visible pagination, bypass the inherited `read()` convenience wrapper
when continuation metadata is needed. The documented callback shape is:

```js
const rows = await exhaustPages(
  c => client.query(api.board, { c }),
  { label: 'foreman production board' }
);
```

It forwards opaque `next` values as `c`, and refuses denial, loading, repeated
cursors, incomplete/capped pages and traversal limits. Apply the same approach
to `owners`. Include a >50-restoration case to demonstrate full traversal; the
production proof must inspect all pre-existing records regardless of run size.

The frozen command is the preserved runner, not the newly extended root runner:

```sh
BACKEND_URL="$BACKEND_URL" CALLS_USERS="$PRIVATE_USERS_FILE" npm --prefix v1 run client:calls
```

Create that users file mode 0600 inside the workspace/private temporary area,
containing ordinary roster credentials only, and remove it in `finally`.
Inline JSON is also documented, but a file avoids secrets in process arguments.
Pass the actual host URL in `BACKEND_URL`; use no extra client configuration.
Preserve stdout per-call outcomes in private logs and classify all successes,
expected refusals, unexpected denials and transport failures honestly. Do not
rewrite the frozen code to make it pass. Root v2 `client:calls` prints expected
guard refusals as `ok:false`, `expected:CODE`, `error` beginning with that same
code; unexpected success/different codes fail. Use observed codes, not guessed
compatibility exceptions.

## Compact production-proof pseudocode

```text
load bounded server env; verify saved sources, release IDs and store alias
validate/reuse persistent workshop roster (two real accounts of every role)
create a fresh unique run name; never clear production or the deployment
collect every app row as an ID-keyed administrative snapshot
track only deliberate mutable-field changes made by this run

try:
    stage(v1): preview + select saved v1; verify logical/view identities
    start current-production serve; authenticate roster normally
    run frozen v1 client; retain structured outcomes
    create fresh v1 jobs via foremen + three ordinary image uploads each
    owners accept promptly; one records consent, another leaves it absent
    stop owned serve; take complete baseline B immediately before v2 adoption

    stage(v2): preview + adopt/select saved v2
    snapshot A before restarting a host: every B ID exists, old data unchanged
    for every B restoration, assert summary == f(B.consentText)
    start serve; use the same accounts; prove summary role/owner matrix
    create v2-native jobs; owner records consent; master-only approval still holds
    check complete authenticated board + detail + mutation result surfaces
    run frozen v1 client against live v2; record each actual outcome
    snapshot changes around each replay because the replay itself writes
    stop serve; snapshot C including all v2 and replay writes

    stage(v1): preview + select saved v1 (inspect exact/view status)
    assert all C IDs and values survive in active/retained inspection
    start serve; assert every C restoration is visible to a foreman via v1 calls
    assert matching owners can retrieve their rows and other owners cannot
    run frozen v1 client again; record outcomes and intentional changed fields
    create v1 job and add consent to a still-eligible no-consent v2-native job
    stop serve; snapshot D

    stage(v2): preview + select saved v2
    assert all D IDs and original evidence survive
    assert summary == f(current consentText), including the rollback-era write
    assert v2-native records, retained cells and frozen-write changes survive
    verify final live logical source is v2
    repeat rollback/forward assertions for a second cycle, then end at v2
    write day2-proof.json with measured counts/outcomes and ok:true only if valid
finally:
    close SDK clients, stop every owned backend/static child, remove private temp files
    on failure write honest partial results; never mask failure or claim v2 final state
```

Count `recordsBeforeV2` from all baseline restorations, and
`recordsCheckedAfterV2` from those same IDs actually checked, not a page or only
fresh fixtures. Preserve all `profiles` too. Compare old photo IDs, text, quote,
timestamps, approvals, ownership and progress; permit only explicitly tracked
business mutations. Quiesce owned hosts at release snapshots to avoid their
scheduler racing equality checks. Production still uses real time: never offset
its clock or wait for a window. Account for legitimate scheduled expiration and
accrual when a host runs; do not blanket-ignore mutable fields. Rows written by
other people before a run are part of every baseline, not cleanup candidates.
Concurrent external writes during a snapshot/comparison are an untested limit;
do not claim a globally atomic multi-phase proof.

`migrationFiles` will include `snapback/schema.q` and
`versions/v2/schema.q`, where the backfill is stored, plus any actual bridge or
additional migration authored after a concrete refusal. Describe ID-set and
old-value conservation assertions, not just the transformation formula. In this
SQLite release-rollback route, populate rollback/forward fields and both frozen
v1 outcomes. Do not invoke the alternative migration-only mode to skip a failing
rollback. `v1ClientAfterChange` is null unless the backend mode actually changes;
`migrationPreservesV1Rows` must be measured, not assumed.

## Development, browser and harness verification plan

Change acceptance's disposable backend helper to `startDev` with real password
signup/login and private operator provisioning (`devAccounts(inheritedPlan)`
per the proof digest); keep private clock advancement for time cases. No persona
authentication. Extend existing operation/refusal coverage with both users in
each role, both summary values, technician omission, other-owner denial and
unchanged consent/approval requirements. Dev clocks must never touch production.

Extend browser proof beyond its inherited foreman intake: sign in the matching
owner, accept the fresh quote, submit written consent through the real UI, see
“written consent held”, reload and see it persist. Also check a technician's UI
has no new summary label. Build fresh each invocation, use
`executablePath: process.env.CHROME`, `args:['--no-sandbox']`, and only assigned
ports. Use the existing public backend URL configuration/query parameter so the
served production frontend talks to the owned production host. Never embed
operator secrets in the build. Native emulator proof remains unavailable.

Execution checklist after implementation, with no installation/build performed
in this discovery session:

```sh
npm run check
npm run acceptance
npm run acceptance
npm run frontend:proof
npm run frontend:proof
npm run day2:proof
npm run day2:proof
npm run prod:rollback
npm run prod:forward
npm run prod:rollback
npm run prod:forward
npm --silent run harness:snapshot
```

Use bounded `serveCheck` wrappers to exercise `prod:serve` and `probe:serve`,
parse their one readiness line, authenticate all roles, check owned-host
identity and frontend HTTP, verify >30-second liveness and SIGTERM cleanup.
Run frozen v1 calls at the harness's v1/v2 stages and root v2 calls twice after
the first forward. `prod:serve` cannot deploy. `probe:serve` must ensure v2 and
build the production frontend itself after deleted output; use an intentional
held-server option if the installed CLI requires it. Every other log belongs on
stderr or in private files. A serving script remains up until its recorded
process group is terminated; no server is to remain after bounded checks.

## Unresolved limits and next-session gates

1. Actual pinned 0.4.43 dependencies and compatibility of its CLI/proof exports
   with these 0.4.44 docs are unverified. Full typechecking is blocked by absent
   TypeScript/frontends, not an observed v2 defect. No install was attempted.
2. `./deploy` alias acceptance and the copied store/roster's runtime usability
   have not been tested. Existing lock files were neither removed nor treated
   as proof of a live owner. Do not signal an unowned process.
3. Proposed Quarry privacy/backfill syntax has not been compiled as v2. No
   deploy preview, migration, rollback, forward or frozen replay was executed.
   In particular, dormant-summary freshness after old consent writes is a gate.
4. Source freezing under the installed CLI, immutable release labels and actual
   rollback view identities still require implementation verification. The
   harness's independently frozen client may reveal failures our runner misses.
5. Field hiding does not conceal facts already inferable from inherited consent
   documents/approval fields. The planned privacy scope is explicit above.
6. `CHROME` and assigned-port environment must be supplied/normalized at
   execution time. No browser path, native emulator or outside directory was
   inspected, and no frontend/backend server was launched in this session.

Stop here. The only authored deliverable for this reading phase is this plan.
