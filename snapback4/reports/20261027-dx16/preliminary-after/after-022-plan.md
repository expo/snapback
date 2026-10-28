# Day-two discovery plan — Custom Corset Fittings

Discovery timestamp: 2026-10-27T20:53:33Z. Workspace: `/tmp/dx16-replay/after-022`.

This is a reading-phase deliverable, not an implementation or proof report. Only this plan is being written. No application sources, generated API, dependencies, accounts, deployment or inherited databases were changed. No servers, builds, acceptance runs or end-to-end proofs were started. Commands below are instructions for a later implementation session unless explicitly identified as discovery commands.

## Evidence and documentation path

Started with the installed CLI's preview, exactly:

```sh
npx snapback4 init --adapt --day2
```

It reported **preview only; no files changed**, proposed `v1/`, `versions/v1`, `versions/v2`, `scripts/day2-proof.mjs` and package-script additions, and left application-owned files alone. Followed its rename route:

```sh
npx snapback4 guide rename --section opening
npx snapback4 guide deploy --section 'Keep v1 clients working'
npx snapback4 guide api proof
npx snapback4 guide production --section 'Serve script and reusable accounts'
```

Read the three `PREVIOUS-*` files. Inspected only this app's relevant schema, React/client modules, proof/lifecycle scripts and package metadata. On-demand sections resolved the remaining design choices:

```sh
npx snapback4 guide deploy --section 'Capture a saved version'
npx snapback4 guide deploy --section 'Rollback after widening'
npx snapback4 guide deploy --section 'Visible rollback by default'
npx snapback4 guide deploy --section 'What the old release sees'
npx snapback4 guide deploy --section 'Bridge a safety gate'
npx snapback4 guide production --section 'Admin inspection'
npx snapback4 guide testing --section 'Production moves in a stage script'
npx snapback4 guide staging --section 'Development acceptance accounts'
npx snapback4 guide staging --section 'Time and reused stores'
npx snapback4 guide security --section Reference
npx snapback4 guide rules --section 'Column write and freeze capabilities'
npx snapback4 guide rule-recipes --section 'Column write audience and approval'
npx snapback4 guide shapes --section Details
npx snapback4 guide language --section 'Helpers, shapes and spreads'
```

Also used bounded guide indexes/searches and CLI help for deploy, rollback, releases, serve, dev, data, check and test. Did not inspect package implementation, other workspaces, transcripts or session logs. `check --help` confirms that check writes the generated API, so no actual check was run in this phase.

## What is inherited

- `package.json` and `package-lock.json` pin `snapback4` to **0.4.43**, but `node_modules/snapback4/package.json` reports **0.4.44**. The documentation read above is from the installed 0.4.44 CLI. Resolve and revalidate this discrepancy before implementation claims.
- `deploy/`, `versions/` and `v1/` do not exist. `data/studio/store.sqlite` exists; `.snapback4/store.sqlite` does not. Leave the inherited persistent staging store intact. A new `./deploy` is the production store required by the task, not a reset or replacement of `data/studio`.
- Schema: password identity, `roles` and `fittings`, four queries and eight mutations including private operator provisioning. Monetary values are integer euro cents. `price` and the `openFitting` argument currently require `1..1000000`; deposit is `0..1000000`, and opening requires `deposit <= price`.
- Assistants/owners can open a fitting. Existing operations do not edit price after opening. Workroom updates enumerate only measurements/notes/stage; cancellation, pickup, adjustment and retention have their own guards. Cutters and clients cannot read commercial fields. Clients can read only their own rows/photos. Preserve these arrangements.
- React uses `snapback4/react`, generated handles and the shared `src/backend-client.ts`. `src/App.tsx` contains the price labels, creation argument/input and detail display. `src/client.ts` accepts a runtime `?api=` URL or `VITE_SNAPBACK_URL`, with a hard-coded fallback that should not drive proofs.
- `scripts/staging.mjs` always deploys with `--staging` and uses `startServe`. Inherited acceptance therefore tests a classified staging serve, **not the development backend required by this brief**. Existing frontend/probe proofs likewise use staging. `probe:serve` currently targets `data/studio`.
- `scripts/client-calls.mjs` expects `CALLS_USERS` to be a private JSON **file path**. It imports `domain.mjs`, which imports `src/backend-client.ts`, which imports the generated API. It signs in all accounts, reads boards/roles, creates uniquely named fittings, uploads/downloads photos, saves work, advances/picks up/requests adjustment, cancels/approves retention, tests `OWNER_ONLY`, and logs out. It has no price-edit call.
- Snapshot currently reads only `data/studio`, uses a finite limit and does not check `more`. Replace this with complete inspection. `backend-choice.json` also names only that staging database.
- Existing `DIARY.md`, `REPORT.md` and `friction.jsonl` contain inherited day-one material too. Do not mistake these for day-two evidence or alter `PREVIOUS-*`. Establish new day-two logs during implementation; preserve inherited material before replacing the non-PREVIOUS duplicates.
- `PORT_LO`, `PORT_HI` and `CHROME` were unset during discovery. Do not use an OS-assigned port outside the task's range. No browser path has been verified.

## Source shape to implement

Use a scalar cell rename, not a copy/recompute migration, new money table or deposit adjustment. Keep the same fitting IDs and all other data.

Canonical v2 declaration and independent intent (Quarry sketch):

```quarry
charge: int 0..1000000 renamed from price
-- Replace price with charge in the existing grouped commercial read rule.
invariant fittings.charge read only exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner']
invariant fittings.charge update only exists roles[viewer, role = 'owner']

mutation setCharge(fitting: fittings, charge: int 0..1000000):
  require exists roles[viewer, role = 'owner'] else OWNER_ONLY
  row = fittings[fitting] ! else NOT_FOUND
  update fittings[fitting] { charge }
  return fittings[fitting]
```

Keep all existing column privacy/invariants, renaming only the price reference. The update-only intent deliberately permits assistant creation. **Do not add `write <- owner` or a write-only-owner invariant on charge**: those also restrict nonzero creation and would break the assistant's opening workflow. Backend enforcement is the owner guard on the only charge-edit mutation, shared guarded write helpers, and an audit of every insert/update/upsert path; the invariant checks intent and does not itself grant permission. No generic ordinary-client table writer is to be added.

`setCharge` changes only charge. It does not change deposit or recompute anything, and has no new stage restriction. Retain `deposit <= charge` on opening as the renamed existing rule; do not introduce that restriction on later owner edits, where it would unnecessarily prevent an independent reduction to zero.

Opening continues to require assistant or owner, a real client, and the same photo/measurement checks. Widen the lower bound to zero explicitly, including UI validation and arguments. No historical backfill/default/down computation is needed for a scalar rename. Keep `renamed from price` in subsequent v2 source; never use `value || fallback`, which would lose zero.

### Preserve frozen v1 wire calls and returned fields

An argument alias or operation alias does **not** rename result fields. Choose explicit compatibility wrappers with common write helpers:

- Canonical `boardV2`, `fittingV2`, `openFittingV2` return canonical rows with `charge`; the v2 UI uses these plus `setCharge`.
- Keep `board`, `fitting`, `openFitting` and all other existing operation names for frozen v1 callers. Keep identical argument names except the opening amount may be declared `charge: int 0..1000000 alias price`, mapping the old wire spelling to the same input. `openFittingV2` can use the same alias. Never deprecate/discard the old amount input.
- Move opening validation/insertion into a common helper and existing mutation bodies into helpers only as necessary to wrap results. Every old mutation returning a fitting must return a legacy-shaped fitting after the shared write, not just legacy queries. New canonical opening returns the canonical fitting after the same helper. Existing workroom UI handlers only consume settlement state, so their legacy result shape is acceptable.
- Define an explicit shared public/core shape containing `id, client, openedBy, name, photo, bust, waist, hip, boning, seams, stage, pickedUpAt, adjustmentAt, adjustmentNote, openedAt`. A staff legacy shape spreads that shape and adds `phone, price: .charge, deposit, retainedBy, retainedAt, retentionReason`. An old point-read helper selects the staff shape only for assistant/owner, otherwise the core shape. Apply the same branch/shape to old board pages. Nullable point reads stay null.
- Native column read rules remain authoritative. Never synthesize `price: 0` for a redacted charge or send `price` to cutters/clients. Query shapes are not a replacement for privacy rules. Verify all legacy mutation responses as well as queries.

Compact pseudocode (helper calls/shape placement to be compiled later):

```text
openRow(args with charge): existing STAFF_ONLY/NOT_CLIENT/BAD_DEPOSIT checks;
                          insert exactly original fields with price renamed charge
openFitting(charge alias price, other unchanged args):
    row = openRow(args); return legacyFitting(row.id)
openFittingV2(charge alias price, other unchanged args):
    row = openRow(args); return canonicalFitting(row.id)
legacyFitting(id): staff ? fittings[id] legacyStaff : fittings[id] core
board(c): original row filter/order/page size, with staff/core legacy shapes
boardV2(c), fittingV2(id): original filters, canonical row results
saveWork/advanceStage/pickup/requestAdjustment/cancel/approveRetention:
    unchanged guards and patches; return legacyFitting(affectedId)
setCharge: owner guard; lookup; patch charge only; return canonical row
```

In `src/App.tsx`, rename visible price text, state/input names, cents conversion and reads to charge; allow zero. Assistants still enter it during creation and see it thereafter. Add an owner-only charge editor in detail using `setCharge`; assistants see a read-only amount and cutters/clients see no commercial section. Keep React bindings and live queries. Update `domain.mjs`, v2 replay, browser labels and privacy assertions. Leave all `v1/` files frozen.

Migration declarations will live in `snapback/schema.q` and its deployed saved copy `versions/v2/schema.q`; list both in `day2-proof.json.migrationFiles`. Assertions: no deleted/rekeyed rows, same amount under the new name including zero, unchanged deposit and every unrelated field, and continued preservation of v1-born and v2-born rows through repeated moves.

## Later command sequence: freeze, pin, validate, save v1

Run from this workspace only. All commands in this and following sections are **not executed in discovery**.

```sh
export PORT_LO="${PORT_LO:-21220}"
export PORT_HI="${PORT_HI:-21229}"
npx snapback4 init --adapt --day2 --apply
npm install --save-exact snapback4@0.4.43
node -e 'const fs=require("node:fs"); for(const f of ["package.json","node_modules/snapback4/package.json"]) { const p=JSON.parse(fs.readFileSync(f,"utf8")); console.log(f, p.dependencies?.snapback4 ?? p.version); }'
npx snapback4 init --adapt --day2
npx snapback4 guide api proof
npx snapback4 guide rename --section opening
npx snapback4 guide deploy --section 'Visible rollback by default'
```

Apply adaptation before any schema/UI edits or API regeneration. Verify the frozen dependency closure includes `scripts/client-calls.mjs`, `scripts/domain.mjs`, `src/backend-client.ts`, the original generated API and package markers, plus any imported local modules. If adaptation misses custom files, copy those original files into `v1/` before editing. Save byte hashes in a nonsecret manifest and verify them before every replay. The frozen package may resolve the same exactly pinned runtime, but must never resolve the root v2 generated API. Preserve complete original backend sources/fixtures in `versions/v1`.

Verify all package metadata/lock/runtime versions agree at 0.4.43. Re-read the narrow signature/rename/rollback sections under that version: do not assume the discovered 0.4.44 APIs are present. Record actual install/upgrade breaks, rather than calling the pin discrepancy a tested backend defect.

Before baseline proofs, implement only the authorized harness/process corrections described here: acceptance uses `startDev({args:['--memory']})` and `await host.devAccounts(plan)` with actual signup and private provisioning; isolated memory dev avoids the inherited database. Retain real sign-in/negative auth tests. Reauthenticate after large dev clock jumps if dev sessions expire; do not relax expiry. Add development-appropriate public-door assertions separately from production assertions; do not retain the staging-only `development:false` assertion for dev.

```sh
npm run check
npm run acceptance
npm run frontend:proof
npx snapback4 deploy ./deploy --schema versions/v1 --save-version versions/v1
npx snapback4 releases ./deploy --json
```

The first production deploy uses no `--staging`. Read the actual v1 immutable release ID from `versions/v1/release.json`, validate its identity against release inspection and persist it for stage scripts. Never assume ID 1. Production data is then written using real users/app operations, with the saved v1 API. `prod:serve`/the production helper starts native **serve**, not dev.

## Preview v2, activate, roll back and forward

After implementing the chosen v2 schema/UI/proofs, update only `versions/v2` to the complete v2 sources and contemporary fixtures. Keep v1 immutable.

```sh
npm run check
npx snapback4 test --source versions/v2
npx snapback4 deploy ./deploy --schema versions/v2 --check
npx snapback4 deploy ./deploy --schema versions/v2 --save-version versions/v2
npx snapback4 releases ./deploy --json
```

Later production scripts resolve `V1_RELEASE` internally from saved metadata. The concrete activation commands they invoke are:

```sh
npx snapback4 rollback ./deploy --to "$V1_RELEASE" --check
npx snapback4 rollback ./deploy --to "$V1_RELEASE"
npx snapback4 deploy ./deploy --schema versions/v2 --check
npx snapback4 deploy ./deploy --schema versions/v2
```

`V1_RELEASE` must be set by the driver, not supplied by the harness. These commands work with a stopped store or the owned live serve via its local activation path. Await completion; no sleep after activation. Read `releases` after each move and inspect `live.source`, `live.view`, `live.exact` and saved identity. A registered compatible rollback view may be the intended logical v1. Report that distinction explicitly.

Default rollback is the choice: v1's minimum amount 1 cannot represent a v2 zero, whereas a compatible view can retain widened domains and current owner guards. Do not use `--exact` to hide zero rows or weaken policy. Preview both directions with actual zero/native-v2 rows and assert their authorized visibility. A green deploy or a raw retained-row count is insufficient.

If the runtime refuses or no safe compatible view exists, request a checklist/source **locally**, not user approval:

```sh
npx snapback4 rollback ./deploy --to "$V1_RELEASE" --check --bridge versions/bridge
```

Review that new directory, retaining charge's zero-capable domain, commercial privacy, legacy wrappers and owner guard; preview the repaired source before any activation. Only add `--restore-dormant` if the concrete diagnostic requires it and the retained declarations match. An authored bridge is a separate release and must be described truthfully, not called exact v1. Do not silently substitute it if the required rollback contract cannot be met. `prod:forward` deploys the saved v2 source rather than trusting `latest`, which could name a later bridge. Never prune, reset, delete or recreate production.

## Production roster, lifecycle and scripts to add

Use `snapback4/proof` exports from the verified pinned API. Shared private helper:

```js
const plan = { roles: { assistant:2, owner:2, cutter:2, client:2 }, provision: api.provision };
const host = await startServe('./deploy', {
  provisionUsers: plan,
  // Explicit port range and local logs through verified ProofOptions.
  args: ['--port', `${process.env.PORT_LO}-${process.env.PORT_HI}`]
});
const users = host.sessions;
```

Signup creates ordinary users; the existing `service:operator`-guarded `provision` assigns roles. The operator credential stays local. Reuse `./deploy/proof-accounts/default.json` (0600) with its store, including stable provision intent IDs and partial progress. Reruns login to the pinned roster and finish only incomplete provisioning. Do not delete roster/locks, switch batch names automatically, retry ambiguous signup blindly or reseed production. Use fresh isolated users only for deliberately isolated proof batches, not instead of the persistent production roster. Freeze the role/count/provision/service plan so it cannot mismatch later.

Every driver validates the numeric range is within 21220–21229, fails clearly for unavailable ports, consumes the URL from its own helper's readiness, and holds/stops only child handles/PIDs it created. Use local logs and `try/finally`; call `serveUntilSignal` for long-running serve scripts. No process discovery/kill by port or name. Startup failures must clean partial hosts too. Load `.harness-env.json` privately if supplied later; it is absent now. Never print its values, operator tokens or credential files in logs/reports.

Planned npm script mapping:

| Script | Implementation and behavior |
|---|---|
| `prod:serve` | `node scripts/prod-serve.mjs`: start `./deploy` as it stands, provision/reuse roster, print exactly `{backendUrl,users}`, await signals and cleanup. No deploy/build/release selection. |
| `prod:rollback` | `node scripts/prod-stage.mjs rollback`: inspect/preview/select saved v1's compatible view, verify live identity, exit without a server. |
| `prod:forward` | `node scripts/prod-stage.mjs forward`: preview/select saved v2, verify identity, exit without a server. Identical-source deploy is idempotent. |
| `day2:proof` | `node scripts/day2-proof.mjs`: custom persistent driver below; do not use adaptation's disposable-store proof unchanged. |
| `probe:serve` | update existing script: ensure saved v2 is live without reset; start production serve/roster; build with actual backend URL; start static server; print exactly `{backendUrl,frontendUrl,sessions,apiNotes}`; hold until signal. |
| `client:calls` | update existing replay to canonical handles/charge, alias/zero tests and owner-edit success/refusals; keep one JSON line per call and continue after failures. |
| `harness:snapshot` | update existing adapter: read every app row from persistent stores, omit identity/session bookkeeping, emit exactly `{tables:{...}}`. |

`probe:serve` must build what it serves with `VITE_SNAPBACK_URL=host.url`; keep the supported runtime `?api=` URL if useful. Send build/helper logs to local files/stderr. `sessions`/`users` contain only ordinary account credentials/session material on the contract's private readiness channel. `apiNotes` describes password login, bearer token, operation/asset protocol, units and new endpoints; no public API key is needed by this app. Use real signup/login for both accounts in every role, never personas, public seeding or role setters. Do not put credentials into frontend source or build constants.

Keep `data/studio/store.sqlite` in `backend-choice.json.databaseFiles` and add `deploy/store.sqlite`; both are persistent app stores. The audit adapter exports `roles` and `fittings` for production and, while the inherited database is retained, distinct keys such as `legacy.roles` and `legacy.fittings` for its app rows. Use `snapshotAll(table,{release:dir})` or `data TABLE --release DIR --all --json`; never treat a finite page as complete. Discovery's CLI card says these include dormant cells/retained rows, merged by stable ID, with deleted rows absent. Prove application visibility separately. Exclude throwaway proof stores and auth tables.

## Custom persistent proof: compact pseudocode

```text
require deploy exists after one-time bootstrap; never rm/reinitialize it
validate env/paths; verify frozen manifest; resolve saved release IDs
snapshot both persistent stores; preserve inherited legacy snapshot unchanged
try:
  snapshot all production roles+fittings (including earlier runs/reviewer writes)
  select saved v1/default compatible view; assert conservation and live identity
  host = startServe(deploy, persistent roster); ordinary login for needed sessions
  assert production auth/config has development=false; test public shortcuts closed
  run frozen v1 replay against v1; record individual calls and new rows
  create extra positive-amount v1 rows with saved v1 API, uniqueName and fresh uploads
  B = all production rows immediately before v2; count all fittings, not first page
  preview and deploy saved v2; await activation; inspect releases
  A = all production rows
  assert every B ID still exists; charge equals B's charge-or-price, including 0
  assert all unrelated columns/deposit/reference/photo IDs unchanged
  authenticate/read with existing roster; exhaust canonical boards for every role
  assert complete authorized fitting population and private field omission
  assistant0 creates charge=0/deposit=0; assistant1 creates another ordinary fitting
  owner0 and owner1 change charges on rows opened by different assistants/clients
  assert deposit and unrelated fields unchanged and second session sees live result
  assistant0/1, cutter0/1, client0/1 cannot setCharge (OWNER_ONLY); anon gets E_AUTH
  assert refusals leave all data unchanged; test negative/too-large amounts E_INPUT
  exercise original pickup/adjustment/cancellation/retention on fresh rows only
  run frozen v1 replay against live v2; retain call-level outcomes and returned shapes
  verify all earlier rows unchanged by replay; include replay's new rows in baseline
  for two cycles:
    B = snapshot all current rows, including v2-zero/native and frozen-client additions
    preview/select saved v1 (default); inspect actual source/view
    assert every B row/value survives; canonicalize price/charge names only
    query known zero/native rows as authorized users; assert visibility and amount
    replay frozen v1; record outcomes, collect additions, check preexisting rows
    B = snapshot all rows after that replay
    preview/select saved v2; inspect ordinary v2 identity
    assert complete conservation, amounts and unrelated columns; rerun rule checks
  write day2-proof.json from actual evidence; leave durable active release v2
finally:
  close clients, stop static/browser/serve handles started here, await store unlock
```

Canonical comparison must use presence checks, not truthiness: if `charge` exists use it, otherwise `price`; missing both is an error for administrative fitting snapshots. If both exist, require equal amounts and understand why. Compare IDs and every business field, not just counts/sums. Role additions and fitting creations are expected insertions, not permission to lose old rows. Before intentional owner edits, record exact allowed `{id,field,before,after}` changes; subsequent migration baselines include those values. The inherited frozen replay writes its own uniquely named rows; inventory them and compare subsequent cycles too. No intentional deletions are needed. Serialize proof activity; external simultaneous edits to the same row need conflict evidence rather than a false migration claim.

For app-level paginated reads, use `exhaustPages(c => client.query(handle,{c}))` from the verified digest, including all client-principal pages when resolving users. Administrative `snapshotAll` is the conservation source, not proof that clients can read a row. Assert role-based visible ID sets and known rows through authenticated calls. Upload a new image for each fitting; placed photos cannot be reused.

Production uses wall time throughout: pick up a fresh fitting and request its adjustment immediately. Never advance a production clock or wait for the 30-day boundary. Development acceptance separately exercises before/at/after the deadline without waiting, with session renewal after clock jumps as needed.

Frozen runner invocation inside the driver (credential file created 0600 under `.scratch/`, removed in finally; values never echoed):

```sh
BACKEND_URL="$BACKEND_URL" CALLS_USERS="$PRIVATE_USERS_FILE" npm --prefix v1 run client:calls
```

The adapted frozen wrapper accepts inline JSON or a file path and normalizes for the inherited path-only script. Verify that contract before relying on it. Keep its old handles and code unchanged after freeze. Record successful calls, expected refusals, transport failures and return-field decoding separately at v1, v2, rollback and forward. Do not assert compatibility must be perfect: report `works`, `degraded` or `broken` from observed calls, with exact codes/fields. Preservation and required v2 rules remain hard assertions. For our v2 replay, expected refusals use `ok:false`, `expected:CODE`, and `error` beginning `CODE:`; unexpected success is a failure.

`day2-proof.json`: write actual counts of all touched fitting rows and all requested fields: `ok`, `recordsBeforeV2`, `recordsCheckedAfterV2`, `dataPreservedAfterV2`, `migratedValuesCorrect`, `v2FeatureWorks`, `v2RuleEnforced`, `rollback`, `dataPreservedAfterRollback`, `rollforward`, `dataPreservedAfterRollforward`, `v1ClientAfterV2`, `v1ClientAfterRollback`, `migrationFiles`, `v1ClientAfterChange`, `migrationPreservesV1Rows`, `v1ClientNotes`, `notes`. This is release-rollback mode, since the backend offers releases; set `v1ClientAfterChange:null`. Do not select the alternate frozen-client-only mode merely to bypass rollback failures. Notes identify actual rollback view/source and all compatibility limits.

## Later verification commands and acceptance criteria

After implementation, with `CHROME` configured to an existing supplied Chromium executable (no browser installation), run sequentially:

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

The production driver/serve-check callback must also run frozen v1 calls at each state and the v2 replay twice after forward; stage commands alone do not establish compatibility. Browser proof builds from scratch, signs an assistant in to create a zero/positive charge fitting, sees it, signs an owner in to change charge and sees the persisted/live result, then verifies no assistant editor. Backend tests cover direct lower-role attempts. All original authorization/privacy/time rules remain tested. Runtime/browser helpers read the assigned range and supplied browser path; no downloads or frontend replacement.

During implementation, start fresh day-two logs after preserving the inherited duplicates: stamp diary entries with `date -u +%FT%TZ` and append friction as it occurs. At the end, write the report with measured command results, the required "Compared with day one" section, ranked actual friction and `Rating: N/10` grounded in implementation. This reading plan makes no pass, compatibility or experience-rating claim.

## Unresolved limits / implementation gates

1. **Pinned-version mismatch:** installed 0.4.44 docs may describe features absent or different in required 0.4.43. Installation and narrow API/docs revalidation are future work. No installation was attempted here.
2. **Compilation is untested:** proposed helper signatures, alias placement, named privacy-safe shapes and update-only intent must compile under the pinned package. No source changes or checks were made. Use specific diagnostics/docs rather than package internals.
3. **Rollback is not yet proven:** zero is outside exact v1's domain. Default view registration, owner guard retention, old result wrappers and visibility of every v2 row require real preview and authenticated tests. If a safe rollback cannot be represented, record the concrete refusal; never hide rows or weaken access to obtain green.
4. **Frozen-client result decoding:** old generated types say price is positive. A zero returned from a compatible view may still fail an old decoder even if storage and query wrappers preserve it. Measure and report this; never round zero upward. No existing v1 replay result has been measured in this phase.
5. **Snapshot/freeze helper fidelity:** confirm adaptation captures the complete custom import closure, saved release metadata shape, and complete retained-row inspection under 0.4.43. No snapshots or production rows were inspected here; inherited zero amounts therefore remain unknown.
6. **Environment:** ports/browser variables were absent. Safe range defaults are known, but an existing Chromium path and availability are unverified. There is no `.harness-env.json` now. Do not install/download a browser or bind outside range to work around this.
7. **Reruns and concurrency:** persistent roster semantics are documented, not exercised. Partial setup, auth budgets, store ownership and concurrent business edits require careful error handling. Never delete data/rosters to retry. The generated temporary-store proof does not meet this harness.

Stop here for this session. The only new deliverable is this discovery plan.
