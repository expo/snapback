# Day-two discovery plan — Custom Corset Fittings

Discovery timestamp: 2026-10-27T21:12:50Z. Workspace: `/tmp/dx16-replay/after-022`.

This is a plan, not an implementation or an end-to-end result. No backend/UI source was edited, no dependencies installed, no users provisioned, no deployment created, no server started, and no build or full proof run. Commands below are for a later implementation session unless explicitly recorded as executed. Keep every path within this workspace, use only `PORT_LO`–`PORT_HI` (21220–21229), and retain and stop only owned process handles.

## What was read and checked

Started with exactly:

```sh
npx snapback4 init --adapt --day2
```

The preview printed its day-two handover and exited 2 with:

```text
init --adapt proof: frozen client dependency resolution: Cannot find package 'playwright-core' imported from /tmp/dx16-replay/after-022/scripts/frontend-proof.mjs
```

Followed the prescribed rename route, then the proof and persistent-roster references:

```sh
npx snapback4 guide rename --section opening
npx snapback4 guide deploy --section 'Keep v1 clients working'
npx snapback4 guide api proof
npx snapback4 guide production --section 'Serve script and reusable accounts'
```

Read all three `PREVIOUS-*` handover files. Inspected `snapback/schema.q`, the relevant React/client configuration, staging/probe/snapshot/frontend proof helpers, and the beginning and selected matching lines of acceptance. Did not read the inherited `scripts/client-calls.mjs` implementation to reconstruct it; it remains the frozen business probe. Did not inspect other lanes, backend repositories, transcripts, or session logs. No full guide tours or package implementation inspection were needed.

`npm run check` was the only validation executed. Snapback reported `check: ok`, two tables, 12 operations, no gates pending and 14 nonblocking advisories. The complete command exited **127**, with `sh: 1: tsc: not found`. This does not establish a passing project check.

Version evidence differs: `package.json` and `package-lock.json` pin Snapback **0.4.43**, while the installed package reports **0.4.44**. The check also printed `runtime changes: 0.4.43 → 0.4.44`. Installed `playwright-core`, TypeScript and Vite package metadata are absent. Thus the documentation read here describes the installed 0.4.44 CLI, not a verified target-version installation.

`deploy/`, `versions/v1/`, `versions/v2/` and `v1/` are absent. `data/studio/store.sqlite` exists. It is the inherited persistent **staging** store; do not delete, reset, or silently replace it. No private roster, database contents, or harness configuration was printed.

## Product and source decisions

Keep SQLite, password identity, React/Vite/TypeScript and `snapback4/react`. No alternative frontend or backend is needed. Reuse the generated SDK and the ordinary password sign-up/sign-in path.

Current shape:

- `fittings.price` and the `openFitting` price argument are integer cents constrained to `1..1000000`. V1 has no charge-edit mutation. Zero is rejected by the inherited schema and by the UI minimum of €0.01.
- Assistant and owner create fittings. Phone, price, deposit and retention fields are visible only to assistant/owner. Cutters have workroom access; clients see their own rows without commercial fields.
- The broad table update rule currently admits assistant, owner, cutter and the fitting's client. Individual operations supply workflow guards. Retention columns have owner-only write rules.
- Creation checks `deposit <= price`; no migration should add deposit to price, recompute it, or clamp an amount.

Use a **single release** containing the field rename and tighter edit authority. In `snapback/schema.q`, and then its saved `versions/v2` source:

```quarry
charge: int 0..1000000 renamed from price
```

This is the migration declaration, preserving the existing stored cell/identity. Do not use a copied second money column, a default, or a computed backfill. Keep the declaration in the versioned source. Widening the lower bound deliberately supports zero; it also creates a reverse-domain risk for exact v1 rollback.

Rename the protected read-column entry and financial read invariant to `charge`. Preserve the full existing row audience and all unrelated columns, constraints, immutable fields and workflow guards. Replace the table update rule with the existing audience predicate AND the change predicate:

```text
update(old, next) permitted iff
  (assistant(viewer) OR owner(viewer) OR cutter(viewer) OR old.client == viewer)
  AND (old.charge == next.charge OR owner(viewer))
```

Use Quarry's documented `update (old, next) <- ...` form. Do **not** put an owner-only column `write` policy on charge: that would also block the assistant's non-default charge at creation. A mutation `require` cannot override a table denial.

Add `setFittingCharge(fitting, charge: int 0..1000000)` with `OWNER_ONLY` before the lookup/update. Preserve deposit and every other field. Retain the existing deposit/amount relationship on user writes: require the unchanged deposit to be no greater than the proposed charge, reporting `BAD_DEPOSIT`. Zero-charge creation/edit tests therefore use deposit zero. Migration itself never changes either amount, including historical exceptional values. Do not invent a stage restriction on owner charge edits.

### Wire compatibility and v2 UI

Choose separate v2 fitting endpoints so the current UI uses `charge` throughout while frozen v1 receives its original `price` response shape. Do not rely on an operation alias to translate results.

- Preserve original `board`, `fitting`, `openFitting`, `saveWork`, `advanceStage`, `pickup`, `requestAdjustment`, `cancel` and `approveRetention` names as v1 compatibility endpoints.
- Add corresponding `boardV2`, `fittingV2`, `openFittingV2`, `saveWorkV2`, `advanceStageV2`, `pickupV2`, `requestAdjustmentV2`, `cancelV2`, `approveRetentionV2`, returning the charge-shaped row/page. Keep `myRole`, `clients` and private `provision` unchanged.
- The old create endpoint accepts the same input using `charge: int 0..1000000 alias price`; its result explicitly projects `price: row.charge`. The v2 create endpoint accepts `charge`. Both retain every inherited create guard and initialize the same fields.
- Each original fitting-returning mutation applies an explicit legacy projection after its guarded action; new endpoints return the v2 shape. Do not assume Quarry permits calling a mutation from another mutation: share source logic only if supported, otherwise keep equivalent small bodies and verify their guards together.
- A legacy staff projection contains all original fields, substituting only `price: row.charge`. A legacy cutter/client projection omits **all** original hidden columns. Scalar hidden-field selections can return null, so blindly projecting `.charge` for every audience would change omission behavior. Preserve nullable values, asset references, times and IDs exactly. Paginated board projection must retain paging behavior and the SDK continuation contract.

Compact projection pseudocode (not yet compiled Quarry):

```text
legacy(row, viewer):
  if row is absent: return absent
  result = all original noncommercial fields from the authorized row
  if assistant(viewer) OR owner(viewer):
    add phone, price=row.charge, deposit,
        retainedBy, retainedAt, retentionReason
  return result
legacyPage = map authorized page rows through legacy, preserving continuation
```

The exhaustive original noncommercial fields are `id, client, openedBy, name, photo, bust, waist, hip, boning, seams, stage, pickedUpAt, adjustmentAt, adjustmentNote, openedAt`. This avoids losing less obvious data in a compatibility wrapper.

Update `src/App.tsx` to use v2 fitting handles, form input/state `charge`, labels “Fitting charge (€)” / “FITTING CHARGE”, minimum zero, and nullish rather than truthy handling of amounts. Show the new edit control only to owner; assistants still enter a charge on opening. Backend enforcement remains decisive. Update `scripts/domain.mjs`, acceptance, browser proof, current `client:calls`, probe `apiNotes` and current user documentation. Historical snapshots and v1 compatibility wire spellings necessarily keep `price`.

## Implementation sequence and exact CLI commands

These commands are not authorized to run in this discovery session. Run from this directory in the later implementation session.

### 1. Repair the installation, save v1 before edits

```sh
npm install --save-exact snapback4@0.4.43
node -e 'const fs=require("node:fs"); for (const p of ["package.json","package-lock.json","node_modules/snapback4/package.json"]) { const j=JSON.parse(fs.readFileSync(p,"utf8")); console.log(p, p==="package.json"?j.dependencies.snapback4:p==="package-lock.json"?j.packages["node_modules/snapback4"].version:j.version); }'
npx snapback4 init --adapt --day2
```

Use the configured npm mirror and wait for completion. This is necessary despite the existing exact manifest pin because the actual installed version differs. Revalidate the selected documentation/API with the target CLI before depending on 0.4.44 behavior; record any target-version gap rather than changing the requested version.

After preview succeeds, capture before any product edits:

```sh
npx snapback4 init --adapt --day2 --apply
npx snapback4 deploy ./deploy --save-version versions/v1
npx snapback4 releases ./deploy --json
```

Inspect the adapt result: it promises absent `versions/v1`, `versions/v2` source/fixture copies and a frozen `v1/` ESM client plus generated API, preserving authored proofs. Verify that the frozen runner retains its inherited domain imports, not subsequently edited shared files. Store the actual v1 release ID in a local nonsecret stage manifest, e.g. `production-stages.json`; never assume it is 1. Save the v2 ID after its deploy too. On later runs, reuse saved sources and IDs; do not rerun capture from v2 or blindly deploy v1 anew.

Production v1 is a new deployment at `./deploy`, separate from the inherited staging store. Establish the initial production roster and business rows with ordinary authenticated operations. Preserve the inherited staging store as well: before changing its source, snapshot its application rows privately, then use the documented staging adoption path (`deploy data/studio --schema versions/v2 --staging --check`, then the same without `--check`) only after confirming target-version support and validating preservation. Do not copy a SQLite file into production or assume staging credentials are production accounts.

### 2. Edit once, validate and preview v2

Save contemporary schema/fixtures into `versions/v2` while leaving `versions/v1` and `v1/` frozen. Proposed commands:

```sh
npx snapback4 check
npx snapback4 test --source versions/v2
npm run check
npx snapback4 deploy ./deploy --schema versions/v2 --check
```

Check/preview refusals are the trigger for a specific additional documentation lookup. Do not answer security gates with prose or discard existing workflow guards. Zero-domain reversal or compatible-view instructions must be resolved from the concrete preview output.

### 3. Deploy, rollback, forward

With `V1_RELEASE_ID` loaded from the saved local manifest:

```sh
npx snapback4 deploy ./deploy --schema versions/v2
npx snapback4 releases ./deploy --json
npx snapback4 rollback ./deploy --to "$V1_RELEASE_ID" --check
npx snapback4 rollback ./deploy --to "$V1_RELEASE_ID"
npx snapback4 releases ./deploy --json
npx snapback4 rollback ./deploy --to latest --check
npx snapback4 rollback ./deploy --to latest
npx snapback4 releases ./deploy --json
```

Forward uses the already saved v2 release; `latest` is appropriate only while it demonstrably identifies that release. Stage scripts should use its recorded ID to avoid selecting an unrelated future release. Await activation and verify release/source/view metadata; do not use sleeps as activation evidence. Stop a serving host before a stage change if required by the actual CLI/store-lock behavior, then restart it and sign in normally.

Default rollback can select a compatible view retaining current guards. That is preferable to reintroducing broad authority. Do not pass `--exact` casually: v1's domain excludes zero, and its table rule lacks the new charge-change restriction. A successful release selection is not evidence that old client result fields are correct.

If the preview demands a bridge, the documented diagnostic path is:

```sh
npx snapback4 rollback ./deploy --to "$V1_RELEASE_ID" --check --bridge versions/v1-bridge
```

Follow the generated checklist and its exact next command, then preview again. A truthful bridge must preserve zero-valued and v2-born rows, provide legacy `price`, and retain owner-only charge changes. No clamping zero to one, deletion, reset, pruning, or hidden restore is acceptable. Exact bridge activation mechanics and the actual preview outcome remain unverified in this phase.

## Persistent production roster and process contracts

Author `scripts/production.mjs` as the shared driver, using the proof API digest rather than a custom auth shortcut:

```js
const plan = {
  roles: {assistant: 2, owner: 2, cutter: 2, client: 2},
  provision: api.provision,
  args: account => ({principal: account.principal, role: account.role}),
};
const host = await startServe('./deploy', {provisionUsers: plan});
// host.sessions: role -> [{kind, role, email, password, principal, token, expiresAt}]
```

Sign-up establishes identity; the existing operator-only mutation assigns the role. The operator credential is private and never passed to React or to a client replay. Ordinary writes use signed-in accounts. Verify production `/auth/config` is not development and seed/persona shortcuts remain closed.

Keep `deploy/proof-accounts/default.json` and its store across every rerun and backup. The helper's 0600 roster records credentials, stable provision intent IDs and partial completion. Reruns log in again and provision only unfinished entries. Keep its roles/provision/service plan stable; a mismatch or live lock requires inspection, not roster deletion. Reuse sessions during each run to respect real auth budgets. `freshUser` is available for isolated batches, but the production readiness contract uses the persistent roster.

Planned npm mappings (scripts do not yet exist):

| Script | Implementation |
|---|---|
| `day2:proof` | `node scripts/day2-proof.mjs` |
| `prod:serve` | `node scripts/prod-serve.mjs` |
| `prod:rollback` | `node scripts/prod-stage.mjs rollback` |
| `prod:forward` | `node scripts/prod-stage.mjs forward` |

`prod:serve` only starts `startServe('./deploy', {provisionUsers: plan})`; it must not deploy/change releases. Print exactly one readiness JSON line `{backendUrl:host.url, users:host.sessions}` to stdout. Other output goes to stderr/private logs. Call `serveUntilSignal([host])`, and always stop in `finally`, including startup failure. It serves whichever release/view is active.

`prod:rollback` and `prod:forward` load saved IDs, preview and activate the corresponding release, verify selection, and exit with no server left running. They work from either state and never recreate the deployment. They do not need a host unless actual CLI behavior requires one; retain/stop any they start. A repeated forward must not create a new release or rerun a destructive migration.

Replace the staging-based `probe:serve` route: ensure v2 is selected without resetting data; start production; build with the actual host URL in `VITE_SNAPBACK_URL`; start `dist` via `startStatic`; output exactly `{backendUrl,frontendUrl,sessions:host.sessions,apiNotes}` once. Include ordinary sign-in details and public request formats; no operator/private configuration. Await `serveUntilSignal`, stop both hosts in `finally`, and keep it alive until group SIGTERM. Use `$CHROME` with `--no-sandbox` in browser proofs. Never download browsers. Helpers inherit the assigned port range; fail if it is absent/wrong rather than bind outside it.

## Complete data audit and migration assertions

Replace the inherited snapshot's fixed `--limit 1000000` and staging-only path with a complete read-only production adapter. The documented commands are:

```sh
npx snapback4 data roles --release ./deploy --all --json
npx snapback4 data fittings --release ./deploy --all --json
```

Or use `snapshotAll('fittings', {release:'./deploy'})` / the equivalent for roles. They merge active and retained rows/cells once per stable ID, active values winning; deleted rows remain absent. Never log their complete output in the diary. They bypass app read rules and therefore cannot prove client privacy or compatibility. Fittings/roles are online persistent rows, so no ephemeral serving-memory reader is required here.

`harness:snapshot` must print one `{tables:{roles:[...],fittings:[...]}}` object covering all persistent application records, without auth/session bookkeeping. If both the preserved staging store and production remain persistent app databases, expose both with unambiguous table namespaces and list both relative SQLite paths in `backend-choice.json`; confirm the actual deploy database filename after creation instead of guessing it. Check the harness's interpretation of multiple-store table names during implementation. Never silently omit the inherited store to simplify the audit.

Keep snapshots in memory/private storage, normalized by stable ID. For each stage transition capture **all rows immediately before it**, not just this run's fittings:

```text
normalize(row): canonical amount = row.charge if present else row.price
  preserve null and zero by field presence, never `charge || price`
before = complete snapshot of roles and fittings
activate target; after = complete snapshot
for every before ID:
  assert after has ID
  assert normalized non-money fields, deposit and canonical amount unchanged
  assert expected active release field shape through authorized app reads
assert no unexpected deletions; allow genuinely new records
```

Assert `after.charge === before.price` at the first v1→v2 rename for every fitting, using an owner/assistant for app-level visibility. Preserve reference IDs, photos, notes, stages, timestamps, principals and retention facts. Track intended owner charge edits and ordinary frozen-client writes as explicit per-ID changed-field declarations, snapshotting after them before the next release move. Never excuse unrelated differences. For compatibility reads exhaust SDK pages with `exhaustPages` or generated cursors; do not stop at the first 100 rows. Ensure zero-charge and v2-born rows are explicitly read by both generations in both directions.

The inline migration file is `versions/v2/schema.q` (and the working `snapback/schema.q` containing the same declaration); list the actual relative paths in `migrationFiles`. No separate data rewrite script is planned. Receipts/view metadata and preserved values must be checked on reruns, not inferred from a successful process exit.

## Frozen-client and production proof pseudocode

Use the generated frozen inherited business probe; do not replace it with hand-authored approximations or regenerate it from v2. With accounts written to a private 0600 file inside this workspace:

```sh
BACKEND_URL="$BACKEND_URL" CALLS_USERS="$CALLS_USERS_FILE" npm --prefix v1 run client:calls
```

The frozen runner accepts JSON/file input; a file avoids putting passwords in command text. Run with v1, after v2, after rollback and after forward. Retain per-call results privately and summarize `works`, `degraded` or `broken`, including exact refusal codes and any old result-shape mismatch. A client process exit code alone is insufficient. Never edit the harness's frozen copy or claim admin snapshots establish compatibility.

Current `client:calls` becomes the v2 business probe: use supplied `BACKEND_URL` and `CALLS_USERS`, ordinary login, v2 handles, assistant opening with charge, owner edit, assistant/cutter/client `OWNER_ONLY` refusals, and reads of resulting rows. Carry on after failures. Print one JSON line per call; expected refusals use `ok:false`, `expected:<CODE>` and an error starting with that code. Unexpected success/different refusal fails the run. Preserve every inherited UI operation, upload/download and logout coverage.

Custom `scripts/day2-proof.mjs` must use persistent `./deploy`, **not** adapt's default fresh temporary deployment. Compact sequence:

```text
load saved v1/v2 stage IDs; generate uniqueName for all new business records
snapshot all production; select saved v1; assert whole-store conservation
start production + reusable roster; ordinary sign-in for 2 users of every role
run frozen v1 business calls; add unique v1 fittings via assistant, retain IDs
snapshot ALL pre-v2 rows; stop owned host if activation needs it
preview/deploy v2 on first run, otherwise select saved v2 idempotently
restart/reuse ordinary sessions as appropriate
assert ALL pre-v2 IDs/values preserved and renamed correctly
exercise v2 creation (including zero with zero deposit) and owner charge edit
assert both assistants/cutters/clients cannot edit via callable or raw requests
assert owner 2 can edit a row opened by assistant 1; owner 1 can edit another
assert assistant 2 can still save work without changing charge
assert protected charge never reaches either cutter/client; client isolation holds
run frozen v1 against v2, record per-call truth; snapshot again
stop owned host; preview/select v1; assert all rows including v2-born/zero survive
restart production; run frozen v1; record truth and inspect v2-born results
snapshot again; stop host; preview/select saved v2; assert conservation again
repeat rollback/forward conservation cycle, or leave second cycle to stage checks
write day2-proof.json with actual counts, results, migration paths and limitations
finally close clients, files and every owned host, even on assertion failure
```

Leave **v2 selected on disk** on successful completion, with no server running. If a failed assertion occurs, attempt a verified non-destructive forward in cleanup and retain the failure; never report success merely because cleanup worked. Counts are all touched-kind fitting records before and after v2, not just this run's rows. Roles and all other persistent application rows are also conserved.

Production uses the real clock throughout. Only test aftercare on newly picked-up records immediately, using server timestamps; never wait for a clock window, offset production time, or assume old pickups are still eligible. The inherited development test's 29d/30d boundary cases stay in disposable development acceptance. No production-data cleanup or first-run-only assumptions; fresh names and persistent roster make reruns additive.

Populate every requested `day2-proof.json` field honestly. This package advertises release rollback, so the primary plan is release mode: actual rollback/rollforward status and preservation booleans, `v1ClientAfterV2`, `v1ClientAfterRollback`, and `v1ClientAfterChange:null`. Set `migrationPreservesV1Rows` only from observed assertions. If the exact target package instead establishes frozen-client-only mode, document that evidence before changing semantics; in that mode rollback fields are null and `v1ClientAfterChange` carries the measured result. A refused rollback is not automatically permission to switch modes.

## Later verification commands

After authoring the described sources/scripts and repairing dependencies:

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
```

Acceptance currently calls `startStaging()` (temporary staged deployment plus `startServe`), despite the requested **development** backend. Plan to use `startDev` and its documented `devAccounts` real-account helper, retain all inherited operation/privacy/workflow coverage, and add the new charge cases and a zero case. Verify its auth configuration remains the real password path, not persona authentication; target-version behavior is untested. Keep clock advancement confined to that development host. Existing browser proof already reads `CHROME` and uses `--no-sandbox`; extend it to show owner charge editing and reload persistence, rebuilding every run.

Also author bounded lifecycle checks using `serveCheck` rather than invoking long-running serve scripts without a driver:

```js
await serveCheck({script:'prod:serve', deployment:'./deploy', upMs:30000,
  then: /* frozen replay with only readiness URL/users, private output capture */});
await serveCheck({script:'probe:serve', deployment:'./deploy', upMs:30000,
  then: /* verify production readiness and both users per role */});
```

The callback bodies still need implementation. Check real UI/API behavior between stage changes and run the v2 client twice after the first forward, then frozen v1 again after the second rollback as the harness does. Preserve all rows those clients add. Do not mistake the commands listed here for passed checks.

## Unresolved limits and discovery friction

1. **Installed/target mismatch:** all handover guidance came from 0.4.44, while delivery requires 0.4.43. Exact install and target-version revalidation remain necessary. No downgrade/upgrade was performed.
2. **Incomplete copied dependencies:** adapt preview failed on missing Playwright; project check failed on missing TypeScript. No frontend installation/build/proof was attempted. Neither failure establishes a backend defect.
3. **Zero versus exact rollback:** inherited v1 cannot represent zero in its declared domain. Compatible rollback/view behavior after zero writes, and any required bridge, must be proven against the target package. No preview against a real release was allowed this session.
4. **Projection syntax and paging:** the documented single-row projection gives the route, but exhaustive legacy page projection and conditional omission have not been compiled. Resolve any concrete compiler refusal with the smallest named documentation section. Do not weaken privacy to make wrappers compile.
5. **Capture/proof adaptation:** preview could not complete dependency resolution, so no frozen snapshot was created or verified. Authored proofs must remain custom; generated temporary-store proof behavior violates this task's persistent-production requirement.
6. **Existing staging data:** its file exists, but contents were not inspected and production is absent. Preservation, target-supported staging adoption, multi-store audit naming and exact production SQLite paths are not established. Retain the file and declare it until this is resolved.
7. **Persistent production setup/lifecycle:** the roster API and recovery contract are documented, but real signup, provisioning args, lock behavior, port binding, serve stdout and release activation while serving are untested here. Keep secrets private and prove cleanup with owned handles.
8. **Development acceptance:** inherited tests use staging serve. The proposed `startDev` real-auth/clock route must be checked rather than assuming the existing 219-assertion report satisfies the new host contract.

Compared with day one, the handover reports successful local auth/privacy/workflow/browser coverage and an 8/10 experience; it does not establish production deployment, live migration, rollback or frozen-client results. The CLI's narrow rename card supplied a concrete migration and authorization route without a broad documentation tour. Its separation of temporary generated proofs from persistent production proofs is significant: adopting the default proof unchanged would miss the central rerun/data-survival requirement. No day-two rating or end-to-end score is claimed from discovery.

Stop at this plan. Implementation, installs, deployments, users, builds and proof execution remain future work.
