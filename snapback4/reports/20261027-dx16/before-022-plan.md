# Day-two discovery plan: Custom Corset Fittings

Recorded 2026-10-27T20:36:53Z. This is a reading/discovery deliverable, not an implementation or proof result. All paths below are relative to `/tmp/dx16-replay/before-022`. Commands in the implementation sections are **future commands, not executed in this session**.

## What was established

- Began with `npx snapback4 init --adapt --day2`. It was preview-only: proposed saved sources in `versions/v1` and `versions/v2`, contemporary fixture directories, a day-two proof scaffold, and package script changes. It preserved the authored React/client files. Did not apply it.
- Read `PREVIOUS-DIARY.md`, `PREVIOUS-REPORT.md`, and `PREVIOUS-friction.jsonl`. Day one reports green checks, 219-assertion acceptance twice, browser proof twice, and persistent password accounts. These are inherited reports, not rerun results.
- `package.json` and `package-lock.json` specify exactly `snapback4@0.4.43`, but the installed package and `npx snapback4 --version` report **0.4.44**. Node is v24.13.1. Do not treat the package manifest as evidence of the runtime version.
- The app has two tables, `roles` and `fittings`, password identity, operator-only role provisioning, four roles, and twelve exported operations. Commercial fields are visible only to assistants/owners. The frozen replay uses `price` in `openFitting` and receives rows through queries and mutations.
- `scripts/staging.mjs` deploys with `--staging`, including the persistent probe at `data/studio`. Its private ordinary-user roster is `data/studio/studio-users.json`. No credentials or stored business rows were opened during discovery.
- V1 declares `price: int 1..1000000`, requires `deposit <= price` at opening, and has no price-edit operation. V2 needs a nonnegative charge domain, preserving exact integer cents and the deposit independently.
- Existing acceptance uses disposable **staging serve**, although the task requires a development backend. `scripts/snapshot.mjs` assumes a fixed million-row limit and the staging location. Both need deliberate changes later.

Only this app and its installed package documentation were inspected. No backend/UI sources were changed; no install, build, deployment, account provisioning, servers, or proof scripts were run. No check was run, since it regenerates types. CLI guide reads may update the CLI's local reading cursor.

## Documentation path and findings

Used the installed CLI's `--help`, `init --help`, guide index, and `guide start`, then opened these task-specific sections:

```sh
npx snapback4 guide deploy --section 'Which migration shape survives edits and rollback?'
npx snapback4 guide deploy --section 'Capture a saved version'
npx snapback4 guide deploy --section 'Keep v1 clients working'
npx snapback4 guide deploy --section 'Persistent production'
npx snapback4 guide rename --full
npx snapback4 guide production --section 'Serve script and reusable accounts'
npx snapback4 guide staging --section 'Production refuses bulk setup'
npx snapback4 guide staging --section 'Development acceptance accounts'
npx snapback4 guide testing --section 'Day-two proofs with immutable sources'
npx snapback4 guide testing --section 'Production moves in a stage script'
npx snapback4 guide testing --section 'Day-two proof with production accounts'
npx snapback4 guide release-json --section 'Fields and automatic workers'
npx snapback4 guide release-json --section 'Clients across rollback'
npx snapback4 guide shapes --section Details
npx snapback4 guide rules --section 'Column write and freeze capabilities'
npx snapback4 guide security --find 'update only'
npx snapback4 guide api proof
npx snapback4 guide changes --section 1
npx snapback4 guide changes --section 2
```

`renamed from` is the appropriate stored-cell migration; an argument `alias` accepts an old input name. Neither an operation alias nor an argument alias translates returned field names. Saved releases capture source, fixtures, generated API and actual immutable release identity. Default rollback may select a registered guarded view rather than historical source: inspect `live`, `rowShape.matchesTarget`, and operation differences. Exact rollback can hide rows outside v1's domain. The generated day-two scaffold expects a fresh destination and needs replacement for this task's persistent reruns.

Important version boundary: the 0.4.44 change card says `data --all` and `snapshotAll` were added there. **Do not use either in a 0.4.43 proof.** Recheck the relevant documentation/help after restoring 0.4.43; the signatures read today belong to the installed 0.4.44 package.

## Source custody and implementation order

1. Preserve the inherited sources and frozen client before any type generation. The frozen client must retain its own generated v1 handles and relative import graph, not import the eventual working v2 API. Snapshot `snapback/*.q` with contemporary fixtures into `versions/v1`; preserve `scripts/client-calls.mjs`, `scripts/domain.mjs`, `src/backend-client.ts`, and the complete `snapback/generated/` tree under `frozen/v1-client/` with the same relative layout. Also save the inherited `src/` tree for v1 frontend evidence. Record hashes and the observed runtime version without credentials. Never overwrite these on a rerun.
2. Restore exactly the requested package, then repeat the small relevant docs/help checks and establish v1 validation. This is a runtime downgrade from what is installed, despite the manifest already being pinned.
3. Optionally apply the reviewed day-two adaptation after verifying it still touches only missing/unmodified scaffold files. Replace its generic proof with the persistent business proof below. Do not let a later adaptation recapture v1 from v2.
4. Establish production v1 in `./deploy`, save its actual release ID, run its frozen replay, and take a complete baseline before changing the app. Preserve v1 API evidence separately from generated v2 output.
5. Implement the selected v2 shape, preview adoption, run development checks, and save v2 only when its source is final. Never reuse a saved version directory for different source bytes.

Exact implementation commands, after the source-preservation step:

```sh
npm install snapback4@0.4.43 --save-exact
node -p "require('./node_modules/snapback4/package.json').version"
npx snapback4 --version
npx snapback4 init --adapt --day2
# Only after reviewing the new preview, during implementation:
npx snapback4 init --adapt --day2 --apply
npm run check
npx snapback4 test --source versions/v1
npx snapback4 deploy ./deploy --schema versions/v1 --save-version versions/v1 --json
npx snapback4 releases ./deploy current --json
```

Both version checks must report 0.4.43. Capture a real v1 business campaign; absent authored fixtures mean the query sweep is not business evidence. A first deployment is initialization only; later invocations must reuse the deployment and recorded release IDs. The save operation accepts an already populated source directory only when its complete source bytes match.

## V2 source shape

Edit `snapback/schema.q`, then maintain the same final source and its fixtures in `versions/v2/`. Keep all IDs, references, asset homes, timestamps, roles, stages, and unrelated operations unchanged.

Preferred declaration and input:

```quarry
charge: int 0..1000000 renamed from price
# Keep the existing commercial read audience, replacing price with charge.
# openFitting retains its name and all other arguments:
charge: int 0..1000000 alias price
# Existing opening guard becomes: require deposit <= charge else BAD_DEPOSIT
# Insert charge directly; never charge + deposit or charge || <default>.

mutation setCharge(fitting: fittings, charge: int 0..1000000):
  require exists roles[viewer, role = 'owner'] else OWNER_ONLY
  row = fittings[fitting] ! else NOT_FOUND
  update fittings[fitting] { charge }
  return fittings[fitting] commercialCompatible

invariant fittings.charge update only exists roles[viewer, role = 'owner']
invariant fittings.charge read only exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner']
```

These are proposed source fragments, not compiler-validated code. `commercialCompatible` denotes the result projection described next. No lifecycle restriction is added to `setCharge`: the brief allows the owner to edit after opening. Do not add a new deposit comparison to edits; that would change an existing deposit arrangement. Keep the opening deposit constraint unchanged in meaning.

Enforce the edit boundary in the owner-only exported mutation; every other mutation continues to patch a fixed list that excludes charge. Add the update-only independent invariant above. Do **not** use an owner-only column `write <-` rule: it also checks non-null inserts and would reject assistant creation. Additional defense, only if 0.4.43 compiles it without affecting cutter/client updates, is a named `update (old,next)` combining the existing audience with `(old.charge = next.charge or <owner role>)`. Verify private-column comparison semantics before adding that rule. The invariant is intent checked by the campaign, not runtime authorization by itself.

Use a named commercial response shape `{ *, price: .charge }` for assistant/owner callers, and the ordinary privacy-filtered row for cutters/clients. Apply it consistently to `board` pages, `fitting`, `openFitting`, and all row-returning mutations. Branch on the actual role before applying the compatibility shape; never derive a hidden commercial amount into a cutter/client result. Preserve null point-read behavior. Compatibility `price` is a wire-only projection of the same cell, not a second persisted amount. Keep all original operation names and refusal codes. V2 UI/code uses `charge`; the old wire spelling remains solely for frozen clients.

If the joint rename/domain widening refuses, first preview a same-domain rename followed by a separately saved widening release; preserve v1 unchanged and record both actual release IDs. Do not substitute a default/backfill that discards zero or an unmaintained second money column. If 0.4.43 cannot represent this route safely, leave a named blocker with the refusal rather than claim success.

Update `src/App.tsx`, `scripts/domain.mjs`, `scripts/client-calls.mjs`, browser assertions, and public API notes: labels and v2 arguments become fitting charge; creation accepts zero; detail editing appears only for owners. Keep the deposit controls separate. Render zero with explicit null/undefined handling, not a truthiness check. Regenerate `snapback/generated/` with check; never hand-edit it. V2 replay adds owner edits and matching `OWNER_ONLY` refusals from both assistants/cutters, continues after every failed call, and preserves the one-JSON-line-per-call contract. The frozen copy stays unchanged.

## Persistent production and roster

Use `./deploy`, ordinary `serve`, and a fixed production roster plan:

```js
const plan = {
  roles: {assistant: 2, owner: 2, cutter: 2, client: 2},
  provision: api.provision,
  roster: 'corset-production'
};
host = await startServe('deploy', {provisionUsers: plan});
// Production helper performs real signup/login and operator-only enrollment.
// Reuse deploy/proof-accounts/corset-production.json; never delete/rotate it.
```

Keep the roster, store, immutable releases and service material together across reruns/backups. Keep credentials private (0600). Ordinary accounts cannot provision themselves; no seed/persona/public operator endpoint enters production. Load `.harness-env.json` only if present, privately, and pass only public sign-in configuration to clients. Never print privileged values.

The inherited `data/studio` store is classified staging. Docs explicitly say **there is no promotion flag**. Do not point `./deploy` at that database expecting production classification, relabel it, or erase it. Preserve it and its roster unchanged while creating the required first genuine production deployment. Record both `data/studio/store.sqlite` and `deploy/store.sqlite` in `backend-choice.json` while both remain persistent, and have the audit adapter export both with distinct table namespaces. Moving inherited staging rows/accounts/assets into production with original identities is not established by the documentation read; see limits below.

Planned npm script mappings:

```json
{
  "day2:proof": "node scripts/day2-proof.mjs",
  "prod:serve": "node scripts/prod-serve.mjs",
  "prod:rollback": "node scripts/prod-stage.mjs rollback",
  "prod:forward": "node scripts/prod-stage.mjs forward",
  "probe:serve": "node scripts/probe-serve.mjs",
  "harness:snapshot": "node scripts/snapshot.mjs"
}
```

`prod:serve` only serves the current release and reauthenticates/resumes its roster. It must not deploy. Print exactly `{backendUrl,users}` with two ordinary sign-in users per role, then await `serveUntilSignal([host])` and cleanup in `finally`. `probe:serve` first ensures v2 through the idempotent forward stage, starts production, builds and serves the frontend using its actual backend URL, signs in the roster, prints exactly `{backendUrl,frontendUrl,sessions,apiNotes}`, and awaits signal cleanup. Set the public backend via `VITE_SNAPBACK_URL` and/or the existing `?api=` URL; never expose the operator token.

## Release commands and rollback choice

After v2 source, validation and fixture preparation:

```sh
npx snapback4 test --source versions/v2
npx snapback4 deploy ./deploy --schema versions/v2 --check --restore-dormant --json
npx snapback4 check --store ./deploy/store.sqlite
npx snapback4 deploy ./deploy --schema versions/v2 --restore-dormant --save-version versions/v2 --json
npx snapback4 releases ./deploy current --json
```

Read `versions/v1/release.json` and `versions/v2/release.json`; extract their actual immutable `release` IDs in the stage script instead of assuming 1/2. With `$V1_RELEASE` and `$V2_RELEASE` set to those validated IDs, the underlying stage commands are:

```sh
npx snapback4 rollback ./deploy --to "$V1_RELEASE" --check --json
npx snapback4 rollback ./deploy --to "$V1_RELEASE" --json
npx snapback4 rollback ./deploy --to "$V2_RELEASE" --check --json
npx snapback4 rollback ./deploy --to "$V2_RELEASE" --json
```

Default guarded rollback is the selected route, because exact v1 cannot hold zero and must not hide v2-native zero-charge fittings. Before and after switching, inspect `live.source`, `live.target`, `live.exact`, `rowShape`, all row IDs, and real account calls. Do not describe a current guarded view as byte-identical historical v1. If automatic mapping refuses, `rollback --to "$V1_RELEASE" --check --bridge ./bridge` can draft a guarded bridge/checklist during implementation; review it, preview it, and preserve zero/current authorization rather than activate exact v1 or round amounts. An authored bridge is a separately recorded release, not a silent replacement of the saved v1 source.

Stage scripts work from either state, await committed activation, inspect ambiguous outcomes before retrying, and start no server when cold CLI activation suffices. If a host they started is necessary, retain its PID/handle and stop only that host in `finally`. Never use `latest` as a substitute for the recorded v2 ID if another ordinary release could be newer. Never reset, prune, recreate deployment, or use destructive flags. SQLite release rollback is supported, so the frozen-client-only compatibility mode does not replace this release exercise.

## Complete snapshots and compact proof pseudocode

For 0.4.43, use private CLI inspection: `sql 'SELECT COUNT(*) FROM fittings' --release ./deploy --json`, followed by `data fittings --release ./deploy --limit <count+1> --json`. Require `more === false`; if it reports more, grow the limit and retry with a bounded deadline. Repeat for roles. Never silently accept a fixed cap or a first page. Capture stdout in memory with `secret:true`; do not write raw production rows/credentials to reports. `harness:snapshot` prints one `{tables:{...}}` object, including all persistent business records with stable IDs, excluding auth/session bookkeeping. Use the same complete exporter for the preserved staging store, under distinct table keys.

Canonical fitting comparison: take charge when that key is present, otherwise price; require an integer including zero, and if both exist require equality. Remove only the wire spelling difference, retain all other business fields, and key by stable ID. Require every prior ID in the new snapshot, every unchanged field exactly equal, and deposit unchanged. Inspect dormant storage separately if reported, but do not count a dormant/invisible fitting as successful active-row preservation. Check asset IDs and authenticated photo access as well as scalar fields.

```text
day2Proof():
  load immutable v1/v2 identities, private config; attach failure-report writer
  start from existing deploy; never discard any store/release/roster
  snapshot all existing production tables
  select guarded v1; prove all prior rows still visible and canonical values equal
  start prod:serve via packaged withServeScript / serve-check lifecycle
  login same two users per role; use fresh UUID fitting names this run
  run frozen v1 replay; capture every per-call JSON result and exit status
  write extra v1 fitting through assistant operation; baseline = complete snapshot
  preview v2; assert preview did not alter baseline
  activate saved v2; verify live identity and complete baseline preservation
  verify charge equals each old price exactly; all other fields/deposits unchanged
  assistant opens zero-charge/deposit-zero fitting; owner changes charge
  both assistants, both cutters, clients, roleless and anonymous callers refuse edits
  owner2 edits owner1's fitting; assistant opening still succeeds
  update expected map for only successful authorized edits
  check cutter/client commercial privacy and unrelated workflows
  run frozen v1 replay against v2; record actual per-call/row-shape outcome
  snapshot after replay; assert earlier rows unchanged; add replay-created rows
  preview/default rollback to v1; inspect rowShape/live identity
  assert all expected rows including zero/native rows remain visible and equal
  run frozen v1 replay again; record actual result; extend expected map
  forward to recorded v2; assert complete expected map, charge values and privacy
  write day2-proof.json from measured results, not predictions
  finally stop every owned browser/static/backend process; leave active release v2
```

Use the packaged serve driver, not a custom readiness/PID driver: `withServeScript('prod:serve', callback, {deployment:'deploy'})`, or `npx snapback4 serve-check --deployment ./deploy --script prod:serve --then 'npm run day2:business'`. Credentials are read privately from the helper's readiness environment. Frozen replay subprocess receives only `BACKEND_URL` and `CALLS_USERS`, the latter a private local JSON credential file. Example invocation once that file exists:

```sh
BACKEND_URL="$BACKEND_URL" CALLS_USERS="$CALLS_USERS" node frozen/v1-client/scripts/client-calls.mjs
```

Keep a separate call/result-shape comparison: `works` means all attempted contracts behave correctly; `degraded` means a mix; `broken` means none work. The inherited replay's success lines do not print returned rows, so supplement its execution with assertions using frozen API handles and compare returned fields/privacy. Preserve refusal codes exactly; print `ok:false`, `expected:'OWNER_ONLY'`, and an error beginning `OWNER_ONLY:` for expected edit refusals. Never abort the replay after the first failed call. Refresh the full baseline after replay additions; do not exclude a whole table or all fields of a modified fitting.

`day2-proof.json` must fill every requested field from observations, including both rollback/forward preservation outcomes, both frozen-client results, counts over every touched fitting, and notes naming any guarded view/result differences. Set `migrationFiles` to `["versions/v2/schema.q"]` (plus any staged rename/widen/bridge sources actually used); explain identity, exact amount, independent deposit and complete-row assertions. `v1ClientAfterChange` is null in release mode; still report `migrationPreservesV1Rows` truthfully. Write `ok:false` plus actionable failure notes on errors and exit nonzero; never leave a stale successful proof file.

## Verification order for the implementation session

Convert acceptance to `startDev` plus real `devAccounts(plan)` and disposable local storage. Keep private operator enrollment and all inherited operation/privacy/live-update tests; refresh login sessions if dev clock advancement expires them. Exercise the 30-day boundary using development time, not production waits. Production uses wall time: create, advance work stages, pick up, and immediately request the adjustment. Never require a calendar-time window or reuse an aged fitting for the positive deadline test.

Extend browser proof to create a zero charge as assistant, see it persist, sign in as owner and change it, observe/reload the changed amount; verify assistant has no edit control. Keep real image upload and existing workflow coverage. Each run rebuilds what it serves. Use `$CHROME` with `--no-sandbox`, and only `$PORT_LO`–`$PORT_HI` for every server. Keep process handles, logs in this directory, and stop owned children in `finally`/SIGTERM handlers.

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
npm run harness:snapshot
npx snapback4 serve-check --deployment ./deploy --script prod:serve --up-ms 30000
npx snapback4 serve-check --deployment ./deploy --script probe:serve --up-ms 30000
```

The stage sequence also needs frozen replay and complete snapshots between moves, and v2 `client:calls` twice after the first forward, using the same packaged serve lifecycle. Those checks belong in the business callback; standalone stage commands alone do not prove them. Verify signal shutdown and store-lock release. Active v2 remains selected with no server left running.

During implementation keep UTC-stamped `DIARY.md` and append each actual break to `friction.jsonl`; never log credentials. End with `REPORT.md`, measured commands/results, v1-client limitations, ranked friction, “Compared with day one”, and `Rating: N/10`. No rating or green claim is justified by this discovery session.

## Unresolved limits / required evidence

1. **Version mismatch:** no installation was authorized for this session. All package documentation above was read from 0.4.44. Reconfirm 0.4.43 availability, exact executable version, APIs, stored-format admission and diagnostics before implementation. In particular, do not import 0.4.44-only snapshot helpers.
2. **Rename plus widening:** guides demonstrate identical-type rename and wider-domain rollback, but this exact bounded-int combination has not been compiled or adopted. The staged route is a fallback to preview, not a tested guarantee.
3. **Guarded rollback and result projection:** zero cannot fit exact v1. Automatic view selection, preserved owner edit authority, old `price` response projection, branch-shape compilation and privacy must be measured with actual 0.4.43 release previews and two-user calls. A successful rollback exit code alone is insufficient.
4. **Inherited staging data:** promotion is explicitly unsupported. This plan preserves that store untouched and creates separate true production as the task's production-v1 step. It does not claim that inherited staging records/accounts have moved into production or adopted the new shape. If the evaluator requires that continuity too, a documented identity/asset-preserving import path remains unresolved; copying/reclassifying SQLite is not an acceptable invented migration.
5. **Observed state:** no full store audit, production existence check, credential inspection, port/browser launch, or proof execution occurred. Existing row populations, package downgrade behavior, and time/session edge cases are unverified. Prior green results are day-one claims only.

Stop at this file. Implementation, deployments and proof execution require a subsequent session with that scope.
