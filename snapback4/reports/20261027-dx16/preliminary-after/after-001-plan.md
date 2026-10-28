# Day-two discovery and implementation plan

Discovery timestamp: 2026-10-27T20:48:00Z. Workspace: `/tmp/dx16-replay/after-001`.

This session stops at this document. No backend/UI implementation, package installation, deployment, account creation, frontend build or full proof was performed. Commands below are the intended implementation sequence, not claims of successful execution. No end-to-end score is claimed.

## Observed baseline

- Began with `npx snapback4 init --adapt --day2`, without `--apply`. It reported preview only and no file changes. Its proposed changes freeze `v1/`, capture `versions/v1` and `versions/v2`, and add a day-two proof. Application-owned files remain untouched. Do not assume its generated proof satisfies this harness: the handover says its default uses a fresh temporary store and storage-only business hook.
- Read `PREVIOUS-DIARY.md`, `PREVIOUS-REPORT.md` and `PREVIOUS-friction.jsonl`. Day one reported two successful runs each of acceptance (139 assertions) and browser proof, 78 client replay outcomes, real password identity, and production-classified persistent serving. Those are inherited claims, not results obtained today.
- `package.json` pins both backend packages to exactly `0.4.43`. Actual local `node_modules/snapback4/package.json` says **0.4.44**. `node_modules/snapback4-expo/package.json`, Expo and TypeScript are absent. The exact-version upgrade step is therefore not already satisfied by the installation. No install was attempted during discovery.
- `snapback/schema.q` has two application tables (`profiles`, `restorations`), four roles (`owner`, `foreman`, `technician`, `master`), password identity, private operator provisioning and no development personas. All fourteen operation names can remain unchanged.
- `npx snapback4 releases ./data/release --json` reports current/latest release **1**, generation 1, exact source, no rollback view or dormant items. The current schema bytes equal `data/release/releases/1/snapback/schema.q`.
- `./deploy` is absent. Existing persistent production is `data/release/`, including `store.sqlite`, assets, immutable releases, authentication material and `proof-accounts/workshop.json`. The database and roster have mode 0600. No credentials were read or printed.
- Existing `backend-choice.json` and `scripts/snapshot.mjs` point at `data/release/store.sqlite`. Existing `scripts/staging.mjs` deploys before starting even its persistent branch. This is unsuitable for `prod:serve`, which must attach without activating anything.
- `board(c)` returns a paginated array with `*`; `restoration(job)` returns `{job: r, stage, storageCents, storageDailyCents}`. Technicians currently receive raw consent text/timestamps through both. `App.tsx` uses the shared generated SDK and renders a consent/no-consent fallback for all staff. Merely hiding a new label in React would not enforce the request.
- Existing browser scripts use `$CHROME` and `--no-sandbox`. Existing port helper reads `$PORT_LO`/`$PORT_HI`, but only checks a port then closes the socket; new server drivers must bind/retry within the assigned range rather than assume this removes the allocation race.
- Existing `acceptance` uses a disposable **staging serve**, not a live **development** backend. The original harness explicitly requests development acceptance; adjust its host lifecycle while retaining private accelerated time and real signup/login.

## Documentation path and decisions

Followed the installed CLI card's required-field route:

```sh
npx snapback4 guide deploy --section 'Migrations and adoption'
npx snapback4 guide deploy --section 'Which migration shape'
npx snapback4 guide api proof
npx snapback4 guide production --section 'Serve script and reusable accounts'
```

On demand, resolved compatibility, saving, rollback, backfill spelling and field privacy with:

```sh
npx snapback4 guide deploy --section 'Capture a saved version'
npx snapback4 guide deploy --section 'Keep v1 clients working'
npx snapback4 guide deploy --section 'What the old release sees'
npx snapback4 guide deploy --section 'Visible rollback by default'
npx snapback4 guide deploy --section 'Persistent production: SQLite v1 → v2 → rollback → forward'
npx snapback4 guide deploy --section 'Persistent production: SQLite v1 → v2 → rollback → forward (continued 2)'
npx snapback4 guide evolution --section 'Release rollback and hot activation'
npx snapback4 guide language --find backfill
npx snapback4 guide rule-recipes --section 'Column-level privacy: public identity, private fields'
npx snapback4 guide security --section 'N_COLUMN_RESULT_EXPOSURE'
npx snapback4 deploy --help
npx snapback4 rollback --help
npx snapback4 serve --help
npx snapback4 releases --help
npx snapback4 data --help
```

The API signature digest is sufficient; no runtime implementation or complete declaration file was inspected. Documentation here comes from installed 0.4.44 and must be revalidated against the requested 0.4.43 before implementation.

Decisions: use SQLite release rollback, not the alternate frozen-client-only compatibility mode. Add a scalar required field with a named historical backfill; no table split, asset extraction, rename or scalar `down` is needed. Preserve original operation names, arguments and wrappers. Keep frozen generated handles separate from v2's generated API.

## Exact implementation sequence (deferred)

Run only in this workspace, with dependencies from the configured npm mirror. Never change registries. First satisfy and verify the requested package pins, then repeat the handover against that actual version:

```sh
npm install --save-exact snapback4@0.4.43 snapback4-expo@0.4.43
npm ls snapback4 snapback4-expo --depth=0
npx snapback4 init --adapt --day2
npx snapback4 init --adapt --day2 --apply
npm run check
```

Save the v1 source/client before any v2 edit. Inspect the generated `v1/` import closure to ensure it contains generated v1 handles, `shared/sdk.ts`, the inherited business replay and its `test-data.mjs` dependency, with ESM package metadata. It must not contain `.harness-env.json`, deployment data, private logs or credential rosters. Record hashes of frozen source/API files and never regenerate them using v2.

Preserve the inherited deployment while satisfying the required `./deploy` location. Choose a **one-time whole-directory rename**, not a new empty production or a database-only copy. Before this step, use `serve --wait-stopped` to confirm the inherited store has no server owner; do not stop any process not launched and recorded by this work. Read all application rows with the inherited read-only snapshot adapter and retain the baseline privately. Check resource-path assumptions before moving; there are no captured application workers in the inspected release.

```sh
npx snapback4 serve ./data/release --wait-stopped
node --input-type=module -e 'import {existsSync,renameSync} from "node:fs"; if (!existsSync("deploy")) { if (!existsSync("data/release/store.sqlite")) throw Error("inherited production missing"); renameSync("data/release","deploy"); } else if (existsSync("data/release/store.sqlite")) { throw Error("two production locations: inspect before proceeding"); }'
npx snapback4 releases ./deploy --json
npx snapback4 deploy ./deploy --schema versions/v1 --save-version versions/v1
```

The last command should be an identical-source activation/no-op and add the saved version's API/release label; verify its receipt. Read the actual ID from `versions/v1/release.json`, not a hard-coded `1`. Compare the full row baseline, assets and release history after relocation. If relocation exposes any unsupported path assumption, stop this route without creating replacement production; document and resolve the path issue first.

Update all application-owned persistent paths to `deploy/`, including `backend-choice.json` (`databaseFiles: ["deploy/store.sqlite"]`) and `harness:snapshot`. Keep `deploy/proof-accounts/workshop.json` with this store. Do not let the old persistent staging helper recreate `data/release`.

Serve and exercise v1 production through the new `prod:serve` lifecycle below. Save a v1 web artifact inside the workspace before editing if a visual baseline is desired; it is not the frozen client proof. The frozen source/generated API replay is mandatory.

## V2 source shape

Edit `snapback/schema.q`, then maintain an identical complete saved candidate in `versions/v2/schema.q`. Keep fixtures contemporaneous with each version. Add the migration inline to these files; planned `migrationFiles` is `["snapback/schema.q", "versions/v2/schema.q"]`.

Compact Quarry sketch (compile against the pinned version before accepting):

```quarry
-- Inside restorations; required, no misleading unconditional historical default:
selectorConsentSummary: enum('written consent held', 'no written consent recorded')
read (selectorConsentSummary, consentText, consentAt, selectorApprovedAt, selectorApprovedBy) <- .ownerId = viewer or exists profiles[viewer, role = 'foreman'] or exists profiles[viewer, role = 'master']

-- Independent product intent, separate from enforcement:
invariant restorations.selectorConsentSummary read only .ownerId = viewer or exists profiles[viewer, role = 'foreman'] or exists profiles[viewer, role = 'master']
-- Repeat the same independently justified column intent for protected evidence/status fields.

backfill restorations selectorConsentSummaryFromWrittenV1(consentText: text 20..4000 ?):
  {selectorConsentSummary: 'written consent held' if consentText != null else 'no written consent recorded'}
```

Use the stored written document as the historical evidence, rather than approval status or an invented timestamp. Valid existing non-null `consentText` counts as held even if a historical timestamp is absent. Retain the named declaration unchanged while this meaning holds. A changed historical algorithm would require a new name and reviewed migration.

- `openRestoration`: explicitly insert `selectorConsentSummary: 'no written consent recorded'` with all existing intake fields.
- `giveConsent`: retain owner, stage and already-recorded guards; atomically write the existing text/time and `selectorConsentSummary: 'written consent held'`. No client-supplied summary parameter or arbitrary setter.
- `approveSelector`: preserve the existing master-only role, allowed stages, BOTH original text/time prerequisites and duplicate-approval refusal. Do not substitute the summary for actual evidence.
- Preserve all other stored fields, IDs, media homes, quote terms, stages, scheduling and authorization. Add column intent for evidence/status to prevent raw text or approval metadata from bypassing summary privacy. Normal technicians retain shop-board rows and workflow operations; they lose protected consent/status payloads.
- Whole-row returns omit protected fields, explicit selections return null, and generated properties are optional according to the docs. Verify this on `board`, nested `restoration.job`, mutation returns and raw HTTP. Do not compute a summary fallback from a projected null for an unauthorized viewer.
- Keep shared row audiences, endpoint names, optional `c`, arguments and `{job, ...}` detail wrapper intact. Do not replace v1 responses with a differently nested v2 DTO.
- `shared/model.ts`: add the exact summary union as an optional projected property; make protected existing fields optional/null-aware. Preserve remaining v1 properties.
- `App.tsx`: authorized owner/foreman/master cards show the exact server-provided summary. Technicians see no consent section, fallback, approval badge or summary data. Existing owner consent entry and master approval stay wired to the original operations. Use ordinary Snapback live bindings to observe updates.

Backfill is historical adoption, not continuous maintenance. Audit all mutation paths affecting consent; today only `giveConsent` changes it. Prove migration catch-up for older-client writes during rollback rather than assuming a retained dormant summary recomputes correctly.

## Preview, deploy, rollback and forward commands

After v2 source and proofs are authored:

```sh
npm run check
npx snapback4 test --source versions/v2
npx snapback4 deploy ./deploy --schema versions/v2 --check
npx snapback4 deploy ./deploy --schema versions/v2
npx snapback4 releases ./deploy --json
```

In scripts, load `V1_ID` from saved release metadata and use argument arrays with `cli`; these are the equivalent shell commands:

```sh
npx snapback4 rollback ./deploy --to "$V1_ID" --check
npx snapback4 rollback ./deploy --to "$V1_ID"
npx snapback4 releases ./deploy --json
npx snapback4 rollback ./deploy --to latest --check
npx snapback4 rollback ./deploy --to latest
npx snapback4 releases ./deploy --json
```

Capture pre-preview/post-preview release identity AND full application snapshots; preview must change neither. Await command completion/activation, not a sleep. Deploy/rollback support hot activation with a compatible serving runtime; cold stage scripts need no host.

Use default rollback first, inspect `live.source`, `live.target`, `live.view` and `rowShape`. A registered view can keep v2 privacy/programs while selecting the historical target. Report that accurately instead of calling it exact historical source. The newly protected evidence must not become public to technicians just because rollback succeeds. Do **not** blindly add `--exact`: that would deliberately restore the old broader evidence policy. If preview requests a bridge, generate a new workspace-local bridge with `rollback ./deploy --to "$V1_ID" --check --bridge .scratch/selector-rollback-bridge`, inspect its checklist, and re-preview the authored repair. Any resulting extra ordinary release changes what `latest` means; pin/verify the intended v2 forward release rather than accidentally forwarding to a repair release. If no safe old workflow is available, record a blocked rollback, not a false pass or an unapproved exact-policy weakening.

No reset, prune, destructive flag or database recreation. Dormant v2 cells and assets count as preserved storage; whether they remain client-visible is a separate assertion. Required-field additions should keep v1 rows active and retain the new cells on rollback, but this must be measured after both v2-native and old-client writes.

## Production account roster and process ownership

Create `scripts/production.mjs` for shared configuration and bounded host startup. Load `.harness-env.json` only server-side without printing it. Do not pass private configuration wholesale to the Expo build or frozen runner.

Use the inherited enrollment plan unchanged, including argument construction and roster name:

```js
const plan = {
  roles: {owner: 2, foreman: 2, technician: 2, master: 2},
  provision: api.provision,
  args: a => ({
    name: `${a.role[0].toUpperCase() + a.role.slice(1)} ${a.email.split('@')[0].slice(-6)}`,
    email: a.email
  }),
  roster: 'workshop'
};
const host = await startServe('./deploy', {
  env: serverEnv, logsDir: 'logs', timeoutMs: 300000,
  args: ['--port', `${serverEnv.PORT_LO}-${serverEnv.PORT_HI}`],
  provisionUsers: plan
});
// host.sessions: role -> [{kind,role,email,password,principal,token,expiresAt}, ...]
```

Validate the port environment is present and within 21010–21019. Backend binds within the range and readiness must identify this host. For static assets, either verify a documented bounded-port option for `startStatic`, or implement a small owned Node static/SPA server that binds/retries EADDRINUSE within this range, serves correct MIME types and retains its server handle. Do not assume `ProofOptions.args` controls `startStatic`'s port; its exact bounded-port mechanism was not resolved in this reading session.

Roster provisioning logs in existing entries and finishes incomplete setup using real signup plus the original private operator mutation. Signup alone grants no staff role. Keep mode 0600, stable provision IDs/args and partial completion; do not delete a roster or resolve plan/lock conflicts by creating another account batch. Reuse sessions within each run to respect production auth budgets. Use `freshUser` only for genuinely isolated proof identities when necessary; unique business row names do not require new accounts every run.

All servers have recorded child handles/PIDs, log files under this directory and `finally` cleanup. Use `serveUntilSignal` for persistent drivers; readiness plus returning is insufficient. No discovery/termination of unrelated processes. SIGTERM/SIGINT must stop owned children and release the store lock. Production never uses seedUsers, personas, clock overrides or public role-setting shortcuts.

## Script contracts to implement

| npm script | Planned entrypoint and behavior |
|---|---|
| `day2:proof` | `node scripts/day2-production-proof.mjs`; persistent orchestration below, replacing the generated temporary-store proof for this contract |
| `prod:serve` | `node scripts/prod-serve.mjs`; serve deployment as it stands, provision/reuse workshop roster, emit exactly `{backendUrl,users:host.sessions}`, hold until signal; no deploy/build/migration |
| `prod:rollback` | `node scripts/prod-stage.mjs rollback`; preview then select saved v1 ID through the reviewed safe path; assert stored rows and release/view identity; no host left running |
| `prod:forward` | `node scripts/prod-stage.mjs forward`; activate saved v2 source on first transition, then select verified v2 release idempotently; preserve data and do not require a server |
| `client:calls` | inherited `node scripts/client-calls.mjs` extended for v2 summary reads/privacy, old operation coverage and failures that continue |
| `probe:serve` | production v2 stage, bounded backend, typecheck/export configured for production URL, bounded static server, real roster, exactly `{backendUrl,frontendUrl,sessions,apiNotes}`, hold/cleanup |
| `harness:snapshot` | read-only complete application snapshot over `deploy/`, stable IDs, no identity/credential tables; include retained cells/rows |

Do not use `startStaging({persistent:true})` in these drivers. `prod:serve` must never activate a release; `probe:serve` explicitly ensures v2 first. Build with only public `EXPO_PUBLIC_SNAPBACK_URL=host.url` and serve the result. Explain password login, roles, API operation names, summary projection behavior and ordinary upload access in `apiNotes`; include no operator key. Keep stdout to the one readiness JSON line, with operational logs redirected to stderr/files.

The existing SQL audit adapter selects only active `r` storage and will miss dormant cells. Prefer `snapshotAll('profiles',{release:'./deploy'})` and `snapshotAll('restorations',{release:'./deploy'})` from `snapback4/proof`, which the handover says merge retained values once per ID. Alternatively use `data TABLE --release ./deploy --all --json`. Validate both on the target package; all snapshots must fail on inspection errors rather than return an empty success. Read while serve is live without silently accepting E_STORE_BUSY. Do not expose this administrator inspection as a public API.

## Persistent proof pseudocode

```text
load server-only env; validate port range; acquire app-owned proof serialization lock
load immutable v1 metadata and reviewed v2 release/source metadata
try:
  initial = snapshotAllAppTables()                     # ALL rows, including outsiders' rows
  activate reviewed v1 target (idempotently); assert initial IDs/values retained
  start production serve + persistent workshop roster; real login for all eight users
  replay frozen v1 client; collect each outcome separately from transport/setup failures
  write fresh v1 rows through app operations:
    one with no consent, one accepted with real owner consent
  historical = snapshotAllAppTables()
  preview v2; assert snapshot AND live identity equal historical pre-preview state
  activate v2; verify source/view identity and every historical ID/old field
  assert each historical restoration summary == summaryFrom(historical.consentText)
  assert current full database population is covered, not a first page
  authenticated cross-user matrix: owner1/owner2, foremen1/2, masters1/2, techs1/2
  assert allowed exact labels; disallowed columns omitted/null in list/detail/raw results
  assert other owner cannot obtain row, evidence or private photo
  assert no-consent approval refuses CONSENT_REQUIRED; only master can approve after consent
  write native v2 rows; mutate consent through owner operation; assert live summary changes
  replay frozen v1 client on v2, preserving its generated handles and all recorded outcomes
  beforeRollback = snapshotAllAppTables()               # includes frozen client's new rows
  preview+activate reviewed v1 target; compare full stored population, including v2 cells
  test current rollback audience and inspect selected source/view
  replay frozen v1 client; read v2-native IDs through frozen API, not only replay-created IDs
  make an explicit old-client consent edit to a preexisting/native row where allowed
  afterOldWrites = snapshotAllAppTables()
  preview+forward to verified v2; compare all stored IDs/old values again
  assert summaries reflect all old-client consent changes and v1-created rows
  replay frozen client on forward; inspect full population after its writes
  assert v2 source/policy live; write honest day2-proof.json
finally:
  close each client; stop every host/static server owned by this run; release proof lock
```

Use fresh UUID/`uniqueName` business labels for each run. Preserve rows from earlier proof runs, frozen client replays, and independent reviewers. Do not require a production count to equal only this run's data. Never clean up production business rows to satisfy a cap or rerun.

Compare stable IDs and every existing field/media reference, not merely row counts. For each release-only move, take the before snapshot after intentional business writes and compare immediately afterward. For real-clock maintenance, retain all IDs and immutable evidence; recognize only schema-authored quote expiry (`quoted` to `returned` after its actual deadline) and storage charge accrual as permitted time changes, validating their formulas. Never exclude arbitrary changed fields wholesale or wait for a real-clock window. Session time, quote deadlines and storage boundaries are exercised on fresh production data or with read-time expectations; accelerated time belongs only to development acceptance.

The frozen runner command is:

```sh
BACKEND_URL="$BACKEND_URL" CALLS_USERS="$PRIVATE_USERS_FILE" npm --prefix v1 run client:calls
```

Create the private input file under the workspace with mode 0600; unlink it in `finally`. The adapter preview promises support for inline JSON too, but a file matches the inherited replay's `readFileSync(CALLS_USERS)`. Never send server-only environment to this child. Keep `v1/` package/API unchanged across every transition. Hash-check this after proofs. The frozen replay creates records: resnapshot afterward. Classify `works`/`degraded`/`broken` from actual per-call results; expected guard refusals must have the expected code, and transport failure is not an expected security refusal.

Extend v2 `client:calls` to accept both inline JSON and file inputs, sign in each supplied user, exercise both summary values and protected read paths, emit one structured line per call and continue after failures. An unexpected success on a forbidden call fails the script. Projection privacy tests are successful assertions of omission/null, not invented refusal codes for otherwise authorized technician board reads.

Write every requested `day2-proof.json` field. `recordsBeforeV2` and `recordsCheckedAfterV2` count all historical restorations and must agree. `migrationPreservesV1Rows` reflects real per-row assertions. With release rollback mode, record `v1ClientAfterChange: null`; rollback/forward and post-v2/post-rollback client fields hold measured results. Include migration paths, selected rollback source/view and any response-shape degradation in notes. Leave v2 selected on disk and stop serving processes on success; stage/probe scripts can start it later. On failure, write truthful partial/failure evidence and clean up, without pretending all flags passed.

## Verification to run after implementation, never during this reading replay

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
npm run --silent harness:snapshot
npm run probe:check
```

Development acceptance must retain all original operations/refusals, two real users per role and accelerated quote/storage boundaries; add summary migration/maintenance, both technician denials, other-owner isolation and master approval invariants. Use `startDev` plus private `devAccounts` with the existing operator plan, and the host's private advance/drain methods; no public test-time endpoint. Check the host API against pinned 0.4.43 before replacing staging.

Browser proof must rebuild from source each run after deletion of dist, sign in, create a restoration, observe its no-consent summary, sign in as its owner, accept and submit written consent, then observe held summary after refresh/reload. Also check the technician UI lacks the section. Browser uses `$CHROME --no-sandbox`; all serving stays within assigned ports. No simulator/native proof is implied.

Test the actual `prod:serve` and `probe:serve` readiness lines, all four role pairs, frozen/v2 client replays and liveness beyond 30 seconds under a driver that stops only its recorded process group. The stage loop above also needs before/after complete snapshots around EVERY move, including repeat/idempotent calls from either state; commands alone do not prove conservation. Probe verification must target production v2 and rebuild its frontend, not reuse a day-one dist.

## Unresolved limits and friction to carry forward

1. Installed 0.4.44 documentation may describe API/column privacy/adoption behavior absent or different in requested 0.4.43. Installing the pinned packages and re-reading only relevant differences is the first implementation gate. The missing frontend dependencies prevent a present green-check claim; this session intentionally did not install or run check/build.
2. No runtime evidence yet for the proposed backfill plus protected columns, required-field re-entry after older consent edits, or v2-native row survival. Forward recomputation/conflicts require explicit proof; do not paper over a refusal with a false summary default.
3. The safe default rollback view for this exact privacy tightening is not yet established. Verify its receipt and real technician reads. Exact original-source rollback restores broader evidence access; this plan does not silently authorize that weakening or claim frozen clients preserve every returned field.
4. Whole-directory deployment relocation must preserve private identity configuration, assets and immutable history. It has not been performed. Keep both app paths and audit metadata synchronized, and never initialize a competing empty deployment.
5. The exact bounded port control for `startStatic` remains unresolved. Use a verified helper option or an owned bounded Node server; do not start a default-port host to discover it.
6. Complete snapshot behavior and simultaneous scheduled maintenance need target-version checks. Administrative retained-row inspection is storage evidence, not a substitute for authenticated v1/v2 reads or asset download checks.
7. The inherited persistent roster's pinned plan/partial state was not opened because it contains credentials. Reuse the existing helper plan and `workshop` roster; allow the provisioning helper to validate it and report precise conflicts without logging secrets.
8. Day-one acceptance host classification differs from the harness's development requirement. Its test intent is reusable, but host behavior still needs confirmation after the proposed switch.

Discovery observations for the eventual diary/report: focused guide sections provide concrete save/preview/roster commands; the CLI preview explicitly separates scaffold preservation from application-owned proof work. The temporary default day-two proof is insufficient for this persistent-production harness and must be replaced. Day one's roster classification and advisory-noise observations remain useful context. Expo build/native behavior was not exercised today. Keep `PREVIOUS-*` untouched; implementation should append timestamped DIARY/friction entries as incidents actually occur and write REPORT with honest measured results. This document is the completed reading-phase milestone.
