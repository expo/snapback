# Day-two reading/discovery plan — Jukebox Restorations

Discovery timestamp: 2026-10-27T20:32:33Z.

This session stops at this plan. No backend/UI sources were changed, dependencies installed, builds performed, accounts provisioned, servers started, deployments activated, or proof scripts run. Commands below are future implementation/verification commands unless explicitly described as discovery. No end-to-end result or score is claimed.

## Evidence from the takeover

The first command was `npx snapback4 init --adapt --day2`. It exited 0 and explicitly reported **preview only; no files changed**. It proposed `.gitignore` maintenance, `versions/v1` and `versions/v2` source/fixture captures, a day-two proof script, and a package script. It preserved the app-owned UI/client/README. Do not blindly apply the generic proof: its default deployment lifecycle is unsuitable for the persistent production contract here.

Read `PREVIOUS-DIARY.md`, `PREVIOUS-REPORT.md`, and `PREVIOUS-friction.jsonl`. Day one reports real password accounts, operator-only staff enrollment, 139 acceptance assertions, browser writes, a private SQLite snapshot adapter, and a durable production-classified reviewer deployment. Those are inherited reports, not verification in this session.

Observed current files and source:

- `package.json` and `package-lock.json` pin both backend packages to `0.4.43`. The installed `snapback4` package and CLI report **0.4.44**; `node_modules/snapback4-expo/package.json` is absent. Manifest/lock pins do not establish installed runtime equivalence. No install was attempted.
- Backend: `snapback/schema.q`; two app tables, `profiles` and `restorations`; password identity; roles `owner`, `foreman`, `technician`, `master`; online reads.
- Consent evidence is nullable `consentText` and `consentAt`. Only the owning account can record it, during active restoration, once. `approveSelector` requires a master, an eligible stage, both evidence fields, and no existing approval. Preserve all these guards.
- `board(c)` returns a paged array (50 rows) with computed stage/storage values; `restoration(job)` returns a wrapper containing `job`, `stage`, and storage values. Preserve names, inputs, wrappers, photo values, and existing value domains.
- `shared/sdk.ts`, `scripts/client-calls.mjs`, and `scripts/test-data.mjs` form the headless client replay's local import closure. `App.tsx` uses the same generated handles and supports pagination.
- `data/release/store.sqlite`, `data/release/assets`, and `data/release/proof-accounts/workshop.json` exist. `deploy/store.sqlite`, saved versions, fixtures, compatibility configuration, and `.harness-env.json` are absent. Only existence was checked; credentials and stored business values were not read.
- `scripts/staging.mjs` deploys before *every* persistent start and targets `data/release`. This cannot implement `prod:serve`, which must serve the current release without changing it.
- Existing acceptance uses **staging-classified production serve**, despite the new harness requiring acceptance against a live **development** backend. Change that helper path during implementation; retain time advancement only for development/disposable staging.
- The existing snapshot adapter reads all two-table app rows directly from SQLite in a read-only transaction. Its path and pinned-format assumptions need review when production moves to `./deploy`.

## Documentation path and relevant contracts

Followed the package README's recommended `guide start`, then selected release, production, migration, privacy, and testing sections on demand. `guide day2` is not a card (CLI suggested `time`, `deploy`, `start`); use the testing/deploy sections below instead. No external repository or other lane was inspected.

Reopen only the relevant section when implementing:

```sh
npx snapback4 guide start
npx snapback4 guide deploy --section 'Capture a saved version' --repeat
npx snapback4 guide deploy --section 'Which migration shape survives edits and rollback?' --repeat
npx snapback4 guide deploy --section 'Persistent production' --repeat
npx snapback4 guide evolution --section 'Release rollback and hot activation' --repeat
npx snapback4 guide rules --section 'Column read rules' --repeat
npx snapback4 guide rule-recipes --section 'Column-level privacy' --repeat
npx snapback4 guide production --section 'Serve script and reusable accounts' --repeat
npx snapback4 guide release-json --section 'Clients across rollback' --repeat
npx snapback4 guide release-json --section 'Fields and automatic workers' --repeat
npx snapback4 guide testing --section 'Day-two proofs with immutable sources' --repeat
npx snapback4 guide testing --section 'Production moves in a stage script' --repeat
npx snapback4 guide testing --section 'Check an npm serve script' --repeat
npx snapback4 guide api proof --repeat
npx snapback4 guide api auth --repeat
```

Contracts used in this plan:

- `deploy DIR --schema SOURCE --check` previews adoption on a private snapshot; it does not activate or guarantee a later activation against changed data.
- `--save-version versions/vN` captures complete selected source, contemporary fixtures, generated bindings/package marker, and `release.json` containing the actual immutable release ID/hash/CLI version. Saving cannot combine with `--check`. A matching repeated capture may refresh derived artifacts; differing source refuses.
- A named backfill computes historical data atomically from pre-patch inputs. Retain its declaration/name/meaning. Old-release writes are caught up on forward; migration conflicts must be surfaced, never bypassed by deleting data.
- Added private columns become dormant cells under original v1; the owning rows remain visible. Compatible forward restores the cells. No narrowing or asset movement is needed for this change.
- Default rollback may select a registered current guarded view. `--exact` deliberately selects historical source. Inspect `live`, `rowShape.matchesTarget`, and per-operation differences; an exit-0 switch is not evidence of frozen-client result compatibility.
- `startServe` waits for readiness and owns a stoppable child. `serveUntilSignal` holds the process and awaits cleanup. `withServeScript`/`serve-check` own the npm serve process group; do not write another ad hoc serve driver.
- `snapshotAll(table,{release:'deploy'})` / `data TABLE --all --json` read all active rows independently of user visibility. A normal `data` or board page is insufficient. SQL `--all-releases` includes retained storage. Private administrative reads must never become public API endpoints.
- A persistent production roster is a mode-0600 file under the deployment's `proof-accounts/`. Reuse the same roster name and plan. Reruns log in and complete unfinished enrollment; plan mismatch and concurrent setup refuse. Preserve this file alongside its store.

## Chosen source and migration shape

Use the SQLite **release rollback** mode, not the alternate migration-only compatibility mode. The package exposes saved immutable releases, rollback, forward, and retained storage. Keep full original source in `versions/v1`, outside `snapback/`; keep the final v2 source in `versions/v2`. Do not place two versions' `.q` modules in the working namespace.

Add one required stored enum, `selectorConsentSummary`, to `restorations`. Use the requested strings as enum values so clients do not invent a second status mapping. Do not use a false historical literal default: a named backfill distinguishes existing written documents.

Proposed Quarry additions/edits (compact pseudocode, to compile and qualify during implementation):

```quarry
-- In table restorations, with no literal default:
selectorConsentSummary: enum('written consent held', 'no written consent recorded')
  read <- .ownerId = viewer or exists profiles[viewer, role = 'foreman'] or exists profiles[viewer, role = 'master']

-- At top level; retain this name and meaning in subsequent v2 sources:
backfill restorations selectorConsentSummaryV2(consentText: text 20..4000 ?):
  {selectorConsentSummary: 'written consent held' if consentText != null else 'no written consent recorded'}

invariant restorations.selectorConsentSummary read only .ownerId = viewer or exists profiles[viewer, role = 'foreman'] or exists profiles[viewer, role = 'master']

-- openRestoration's insert adds:
selectorConsentSummary: 'no written consent recorded'

-- giveConsent's existing single update additionally sets:
selectorConsentSummary: 'written consent held'
```

Put the column rule on the same declaration line if required by Quarry syntax; the split above is for readability. Use stored `consentText != null` as the evidence predicate: approval alone is not a document, and a timestamp alone does not establish written consent. Existing app writes set text/time together. Audit any inconsistent historical pair explicitly; do not erase or fabricate evidence to normalize it. The approval guard continues requiring **both** original fields.

Keep this additive change in `snapback/schema.q`; report `migrationFiles: ["snapback/schema.q", "versions/v2/schema.q"]`. No external SQL rewrite, new table, extraction, rename, `down`, asset copying, or destructive flag is needed. The migration must retain original row IDs and every old column's value, including all three asset handles, quote anchors, progress, consent text/time, and approval evidence.

The backend column rule enforces the summary audience on board rows, detail rows, and mutation returns. Do not add an unguarded scalar helper, filter, count, order, or error message that reveals this column. Test actual wire responses: hidden whole-row properties are omitted; explicit protected projections may be null. UI role checks are supplemental.

In `App.tsx`, show the exact summary text on every authorized restoration card/detail. Render it only when the backend supplies it; a missing property must not become “no written consent recorded.” Remove the technician's unconditional textual summary fallback. Keep owner consent entry and master approval actions. Use existing React Native hooks and generated handles. Add `snapback/client-compatibility.json`:

```json
{"baseline":"versions/v1","since_release":2}
```

The baseline makes added result fields optional for the v2 frontend while v1 is active. It does not change server permissions or certify semantic compatibility. Preserve the original `board` and `restoration` result wrappers and every v1 operation signature.

## Freeze v1 and prepare production once

Future implementation starts by freezing the inherited client **before** regeneration or edits: copy `scripts/client-calls.mjs`, `scripts/test-data.mjs`, `shared/sdk.ts`, `snapback/generated/` and its package marker into the same relative layout under `frozen/v1/`. Save `App.tsx`, `src/`, package manifest, and lockfile there as client evidence too. Hash the copy and never rewrite it. Exclude `data`, sessions, `.harness-env.json`, logs, and all privileged configuration. Replays resolve installed dependencies from this project; note that limitation alongside the harness's independently frozen client.

Exact dependency correction for a later implementation session:

```sh
npm install --save-exact snapback4@0.4.43 snapback4-expo@0.4.43
npx snapback4 --version
node -e "const fs=require('fs'); for(const n of ['snapback4','snapback4-expo']) console.log(n,JSON.parse(fs.readFileSync('node_modules/'+n+'/package.json','utf8')).version)"
npm run check
```

This command is **not authorized in this reading session**. It may also install currently missing frontend dependencies. Recheck the named docs/helper exports under 0.4.43 before relying on the 0.4.44 documentation observed here.

There is already inherited production data. Do not initialize an empty parallel database and ignore it. Once all owners of the inherited deployment have been explicitly stopped by their recorded handles, capture a complete read-only audit and transfer the **whole** `data/release` directory, including releases, sidecars, assets, identity material, and roster, to `deploy` once. Prefer an in-workspace rename so the store and roster stay together:

```sh
node -e "const fs=require('fs'); if(fs.existsSync('deploy')) throw Error('Inspect existing deploy; never replace it'); fs.renameSync('data/release','deploy')"
```

Run that only in one-time setup after ownership/backup validation, never in `day2:proof` or a stage script. Retain a stopped whole-directory backup inside this workspace if required. Verify the audit before/after relocation, including IDs and assets. Update `backend-choice.json` to list `databaseFiles: ["deploy/store.sqlite"]`, and change the audit adapter to this canonical path. A missing expected store must fail the snapshot rather than silently report zero rows. If `deploy` already exists, inspect/adopt that state; never overwrite it or repeat the rename.

Before capture, author contemporary `fixtures/profiles.jsonl` and `fixtures/test.cases.jsonl` with role/profile reads and allowed/refused owner-picker cases under explicit engine principals. These cases require no fabricated image assets. They provide real executed schema/function cases; real sign-in, uploads, complete workflows and privacy still require the separate HTTP acceptance. Capture v1 while the working source is still v1:

```sh
npx snapback4 test --source snapback --fixture fixtures
npx snapback4 deploy ./deploy --schema snapback --save-version versions/v1 --json
npx snapback4 releases ./deploy current --json
node scripts/capture-release.mjs v1
```

Do not assume v1's ID is 1: the inherited deployment already has history. Implement `capture-release.mjs` to read the documented `releases DIR current --json` envelope, assert `selected.release === current`, cross-check the saved source label/hash, and write this app's own `day2-releases.json` as `{v1:<immutable numeric ID>,v2:<immutable numeric ID when captured>}`. Preserve existing mappings; refuse conflicting recapture. This avoids assuming an undocumented property name inside the package's saved `release.json`. The captured source and fixtures must remain paired. No fixtures existed during discovery, and a fixture sweep must not be reported as business acceptance.

After implementing/checking v2 and its real business tests, preview and save it:

```sh
npx snapback4 check --store ./deploy/store.sqlite
npx snapback4 test --source snapback --fixture fixtures
npx snapback4 deploy ./deploy --schema snapback --check --json
npx snapback4 deploy ./deploy --schema snapback --save-version versions/v2 --json
npx snapback4 releases ./deploy current --json
node scripts/capture-release.mjs v2
```

Compare complete pre/post-preview snapshots and active identities; the preview must not mutate production. After activation check actual IDs, migration values, and all audiences. Use the saved v2 source for later moves; do not deploy arbitrary future working edits.

## Production scripts and persistent accounts

Add these package script mappings during implementation:

```json
{
  "day2:proof": "node scripts/day2-proof.mjs",
  "prod:serve": "node scripts/prod-serve.mjs",
  "prod:rollback": "node scripts/prod-stage.mjs rollback",
  "prod:forward": "node scripts/prod-stage.mjs forward"
}
```

Create `scripts/production.mjs` for shared safe configuration/account setup, independent of the development helper. Load optional `.harness-env.json` privately, without printing it or adding it to a frontend bundle. Require all configured store/worker paths to remain here and all child ports within `PORT_LO..PORT_HI` (21010–21019). Pass only public backend URL configuration to Expo. Use package-managed readiness and child handles; no process discovery/killing.

Persistent account plan: reuse `roster: 'workshop'`, roles `{owner:2,foreman:2,technician:2,master:2}`, `provision: api.provision`, the inherited enrollment-argument function and default operator service. Preserve the exact existing serialized plan; role counts/order, operation name, service, or custom users must not drift. Do not print the private roster to inspect it. On mismatch, fail before creating another batch and resolve privately. Signup/login are real password auth; only private service enrollment grants staff roles. Never use `seedUsers`, personas, clock offsets, public role setters, or an admin shortcut for normal production business calls.

`prod:serve` pseudocode:

```js
requireExistingDeployment('deploy');
host = await startServe('deploy', {
  env: privateServerEnv,
  provisionUsers: pinnedWorkshopPlan,
  logsDir: 'logs'
}); // only serve; no deploy, rollback, seed, or frontend build
try {
  // Proof helper uses the assigned port environment; enforce bounds on host.url.
  assertProductionAuthAndOurHost(host);
  printExactlyOneJSON({backendUrl:host.url, users:ordinarySignInDetails(host.sessions)});
  await serveUntilSignal([host]);
} finally { await host.stop(); }
```

Only the readiness contract may contain ordinary user credentials. Everything else goes to stderr/files; reports and diary contain none. `serveUntilSignal` must remain referenced and reap children on TERM/INT. Keep authenticated clients closed in finally blocks.

Stage scripts need no server of their own. Resolve the saved immutable ID from the app-owned mapping, cross-check the saved source label, inspect current history, and await the selected activation. Conceptually the commands are:

```sh
JUKEBOX_V1_ID=$(node -p "require('./day2-releases.json').v1")
npx snapback4 rollback ./deploy --to "$JUKEBOX_V1_ID" --check --json
npx snapback4 rollback ./deploy --to "$JUKEBOX_V1_ID" --json
JUKEBOX_V2_ID=$(node -p "require('./day2-releases.json').v2")
npx snapback4 rollback ./deploy --to "$JUKEBOX_V2_ID" --check --json
npx snapback4 rollback ./deploy --to "$JUKEBOX_V2_ID" --json
```

Use Node argument arrays in the scripts. Target recorded v2 rather than an unqualified `latest` that could later name a bridge. When already in the intended live identity, validate and return success. Inspect `live.source/target/exact`, `rowShape`, and source hashes; do not equate `current === requested ID` with original-source execution. This additive design should permit an actual v1 view with all old rows and only the added cells dormant; verify that prediction. Do not silently add `--exact` to bypass a safety warning. If a bridge becomes necessary, retain current guards, record the actual served shape, and report the compatibility effect.

On a failed/ambiguous activation, inspect `releases ./deploy --json` before another attempt. Never reset, prune, add `--allow-destructive`, or blindly retry the switch.

## Complete conservation and frozen-client proof

Implement a custom persistent `scripts/day2-proof.mjs`, using `withServeScript('prod:serve', callback, {deployment:'deploy', ...boundedTimeouts})`. This is deliberately different from the generated fresh-destination proof. The callback gets private readiness plus an AbortSignal. Production remains in place across runs; only new business names/serials use UUIDs.

Compact pseudocode:

```js
requireExistingDeploymentAndSavedLabels();
await withServeScript('prod:serve', async (ready, signal) => {
  users = await loginAllEight(ready); // reuse sessions within this run
  initial = await completeSnapshot();
  await stage('rollback');
  assertAllOldRowsAndEvidence(initial, await completeSnapshot());
  await runFrozenV1AndRecordOutcomes(ready, 'baseline');
  // Every run creates new evidence cases through ordinary app operations:
  cases = await createFreshV1Cases(users, {
    noConsent:true, consentBeforeApproval:true, consentAndApproval:true
  });
  beforeV2 = await completeSnapshot();
  await previewV2AndAssertNoStoreOrIdentityChange();
  await stage('forward');
  afterV2 = await completeSnapshot();
  assertEveryIdAndHistoricalFieldSurvives(beforeV2, afterV2);
  assertSummaryForEveryRestoration(afterV2, r => r.consentText != null);
  await assertBothUsersPerRoleAndCrossOwnerPrivacy(users, cases);
  await createAndExerciseV2NativeCases(users); // intake, consent, approval
  afterFeature = await completeSnapshot();
  await runFrozenV1AndRecordOutcomes(ready, 'afterV2');
  // Replay adds rows; snapshot AFTER it, then validate their summaries too.
  beforeRollback = await completeSnapshot();
  await stage('rollback');
  assertOldShapeAndAllRows(beforeRollback, await completeSnapshot());
  await runFrozenV1AndRecordOutcomes(ready, 'afterRollback');
  // Also record consent on a previously no-consent active case while v1 runs.
  // This explicitly tests forward recomputation of a retained negative cell.
  await giveConsentUsingFrozenV1(users, cases.forwardCatchup);
  beforeForward = await completeSnapshot();
  await stage('forward');
  final = await completeSnapshot();
  assertEveryIdAndHistoricalFieldSurvives(beforeForward, final);
  assertAllV2CellsRestoredOrCorrectlyCaughtUp(final);
  assertSummaryForEveryRestoration(final, r => r.consentText != null);
  await assertBothUsersPerRoleAndCrossOwnerPrivacy(users, cases);
  assertV2IsLive();
}, {deployment:'deploy', thenTimeoutMs:boundedProofDeadline});
writeRedactedDay2ProofJSONOnlyAfterAssertionsAndShutdown();
```

Take complete snapshots of **profiles and restorations**, keyed by stable ID; change-request counts specifically count restorations. Never use just rows this run wrote, a first page, a viewer-filtered list, or a fixed count. Prefer `snapshotAll` for active populations; retain/qualify the inherited read-only transaction adapter for dormant-cell auditing. On exact v1, compare all historical columns and physical retained cells separately: the summary's absence from an old API response is not deletion. On forward require its correct current value, including after v1 consent writes and for v1-created/v2-native rows.

At each transition require every expected ID to remain, every original photo handle and consent document to match, and unrelated profile/quote/progress values to remain intact. Include v2 writes in the next baseline. New replay rows are additions, not permission to ignore old rows. The known frozen script creates new rows/profiles and completes its own workflows; snapshot after it and account for those exact effects.

Production jobs use the real clock. Compare derived fees/stages against their timestamp anchors; if a maintenance tick changes stored `stage`/`storageCents`, permit only the independently computed due transition/fee for that row over the measured interval. Never blanket-exclude mutable columns or run maintenance as a migration. Do not assert old quotes are still acceptable hours later; write fresh quoted cases each run. No production clock advancement or waiting for a time-of-day window.

Privacy/business assertions:

- Foremen and masters both see the exact summary for each case; each owner sees it only on their own cases. Both technicians keep the live board, photos, quotes, progress, and stage operations but receive no summary property/value. Check board **and** detail, raw response shapes, and mutation results. Other owners' detail remains `NOT_FOUND`; anonymous calls remain `E_AUTH`.
- Intake starts with no consent; owner `giveConsent` changes the summary atomically; reload/requery observes it. Reject cross-owner consent, staff consent, repeat consent, and invalid stages exactly as before.
- Non-master approval remains refused; master approval without both original evidence fields remains `CONSENT_REQUIRED`; with evidence it succeeds and records the same approval fields.
- Add over-50-row/page-boundary coverage using real operations in disposable acceptance, and exhaust every production cursor. Do not drive production growth solely to reach a page threshold.

Frozen replay adapter: create a private mode-0600 credentials JSON inside `.scratch/` for `CALLS_USERS`, supply only that path and `BACKEND_URL`, then run `node frozen/v1/scripts/client-calls.mjs` with bounded `command`. Delete the ephemeral credentials file in finally. Never regenerate frozen bindings or import v2's SDK into that closure. Parse every line; carry on after failures. An expected guard is successful only when its error starts with the exact declared code. Distinguish expected refusals from unexpected failures and unexpected successes.

Classify observed calls as `works`, `degraded`, or `broken`; record their failures without turning the frozen-client outcome itself into a conservation assertion. Separately compare old data-bearing result fields (photos, quote, consent evidence, progress) against the preserved v1 contract. `rowShape.matchesTarget` is supporting metadata, not a substitute for replay. The harness's unmodified day-one replay is authoritative; a successful local replay alone is not that measurement.

Write all required `day2-proof.json` fields, with rollback/forward strings and booleans from actual assertions. Use release mode: `v1ClientAfterChange: null`; do not set migration-only null rollback fields. Fill `migrationPreservesV1Rows` from complete ID/evidence comparisons. Counts must reflect the complete immediately-pre-v2 population and those same records checked after activation. Do not claim expected outcomes as measured results. On failure leave an honest failure artifact, close owned resources, and attempt a bounded, inspected recovery to v2 without masking the original failure.

## Remaining implementation/proof contracts

- Refactor disposable acceptance onto `startDev` and `host.devAccounts(plan)` with real password sign-in and clock controls. Keep all inherited business/refusal cases and add the new audience/backfill/catch-up cases. Production helpers remain separate.
- Extend `frontend:proof`: typecheck, fresh Expo web export, real Chromium (`CHROME`, `--no-sandbox`), sign in, open a fresh restoration, observe the negative summary, sign in as its owner, accept and record written consent through the UI, then observe the positive summary after reload. Include a technician UI check with no summary text. Never substitute API-only writes for the new browser write.
- Update `client:calls` to v2's actual UI calls and summary assertions. Continue after each failure and emit structured expected-refusal outcomes. It still takes only `BACKEND_URL` and `CALLS_USERS` and uses ordinary accounts.
- `probe:serve`: ensure v2 using `prod:forward` without reset; build from source with public production URL configuration; serve production plus the web export; reuse the pinned roster; print exactly one required JSON line with backend/frontend URLs, ordinary sessions/sign-in details and API notes. Hold with `serveUntilSignal`, clean up in finally, and stay live beyond 30 seconds. Do not use the old helper that redeploys implicitly.
- `prod:serve` serves any active release without changing it or building a frontend. Stage scripts leave no server running. `harness:snapshot` prints one JSON object containing all app records, no auth/session bookkeeping, and works while serve is live.

Later verification sequence (not executed here):

```sh
npm run check
npm run acceptance
npm run acceptance
npm run frontend:proof
npm run frontend:proof
npm run day2:proof
npm run day2:proof
npx snapback4 serve-check --deployment ./deploy --script prod:serve
npm run prod:rollback
npm run prod:forward
npm run prod:rollback
npm run prod:forward
npm run --silent harness:snapshot
npx snapback4 serve-check --deployment ./deploy --script probe:serve --up-ms 30000 --timeout-ms 360000
```

Wrap replay and data checks around each stage move, not just at the end. Use `withServeScript` to exercise frozen v1 at baseline/v2/rollback and v2 replay twice after forward. Write a small replay adapter for the runner: it provides readiness via `SNAPBACK4_SERVE_JSON`, whereas inherited `client:calls` expects a credentials **file path** in `CALLS_USERS`; passing the runner directly to the old script without this adapter will fail. Logs stay here; scratch scripts importing project packages stay under `.scratch/`. Stop only recorded child handles/process groups.

## Unresolved limits and discovery friction

1. **Installed-version mismatch:** only 0.4.44 docs/CLI were available for this discovery; required 0.4.43 behavior and helper exports are unqualified. Correction requires a later authorized install, followed by rereading changed signatures. The missing Expo adapter prevents assuming current typecheck/build readiness.
2. **Migration syntax and reverse catch-up are planned, not tested.** In particular, prove a v1 consent write updates a previously retained negative summary after forward. A backfill conflict is a real stop condition to investigate; do not remove its declaration/name to evade history.
3. **Production identity/history and relocation are unverified.** File existence is established; row counts, current release IDs, storage format compatibility, roster plan, asset readability, and absence of a live external owner were not inspected. One-time relocation must preserve the entire deployment and refuse an existing destination. No scripts may perform it on reruns.
4. **Rollback may serve a registered view.** The additive route predicts representable v1 rows, but only preview/live metadata plus frozen replay establish actual source and shape. If a view retains the v2 summary, its current privacy rule must still hold. Report deviations rather than equating release selection with exact-source rollback.
5. **Summary privacy is a field-access boundary.** Existing consent documents/timestamps and approval evidence have broader inherited visibility. This plan preserves them and prevents technicians seeing/rendering the new summary; it does not claim that someone reading old evidence cannot infer consent. If independent security analysis treats those derivations as a disclosure of the new field, evaluate grouped consent-field privacy and document the resulting v1 field-visibility change before shipping. Do not silently weaken the new intent to make check pass.
6. **CLI discovery friction:** `guide day2` does not resolve; the actual entry is `guide testing --section 'Day-two proofs with immutable sources'`. The init preview does not print that link. The generic fresh-destination proof is not a persistent-production proof, so custom conservation/account assertions remain necessary.
7. **No proof result is available from this session.** Check/typecheck, business acceptance, browser work, release previews, production migration, roster reuse, reruns, stage liveness and cleanup remain future work. Do not create a passing `day2-proof.json` or an experience rating from this reading phase.

During implementation keep new diary/friction entries timestamped, preserve all `PREVIOUS-*` files, and write a final report only after real results exist. Compare day two with the inherited reports, clearly distinguishing observed behavior from inherited claims. Keep all credentials and privileged configuration out of those documents.
