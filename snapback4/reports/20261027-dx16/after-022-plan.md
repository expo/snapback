# Day-two discovery plan: Custom Corset Fittings

Written 2026-10-27, in `/tmp/dx16-replay/after-022`. This is a reading/discovery artifact. Commands below are future implementation commands unless explicitly marked as observed. No backend/UI implementation, dependency installation, build, provisioning, deployment, or end-to-end proof was performed in this session.

## Observed starting point

- Began with `npx snapback4 init --adapt --day2`, without `--apply`. It printed the day-two handover, then exited 2: `init --adapt proof: frozen client dependency resolution: Cannot find package 'playwright-core' imported from /tmp/dx16-replay/after-022/scripts/frontend-proof.mjs`. No `v1/`, `versions/v1`, `versions/v2`, or `deploy/` existed on the later existence check. Preview completion/freeze has **not** been established.
- Read `PREVIOUS-DIARY.md`, `PREVIOUS-REPORT.md`, and `PREVIOUS-friction.jsonl`. Day one reported 219 acceptance assertions, two consecutive frontend proofs, a persistent staging probe, and an 8/10 rating. Those are inherited claims, not results reproduced today.
- `package.json` pins `snapback4` to exactly `0.4.43`; **installed** `node_modules/snapback4/package.json` reports `0.4.44`. `playwright-core`, TypeScript, and Vite package manifests are absent. A lockfile exists. Do not equate the manifest pin with the runtime version.
- `npx snapback4 check` exited 0 on the unchanged app using installed **0.4.44**: two tables, twelve operations, no pending gates, fourteen nonblocking advisories. This does not establish `npm run check` (which also runs TypeScript), or validation under the requested 0.4.43.
- `npx snapback4 releases ./deploy --json` exited 1: `releases: no current release in ./deploy; run \`snapback4 deploy ./deploy\` first`. No production release was created.
- Current source is `snapback/schema.q`. Tables: `roles`, `fittings`. All ordinary users use password identity; operator-only `provision` assigns one of assistant/owner/cutter/client. Commercial columns are hidden from cutters and clients. Existing frontend uses the package's React bindings and shared generated operation handles.
- Inherited `scripts/staging.mjs` deploys with `--staging` to disposable `.scratch` stores or persistent `data/studio`; its persistent roster is a custom staging file. Existing `probe:serve` uses that staging path. Neither is the required production implementation.
- `backend-choice.json` currently lists `data/studio/store.sqlite`. Keep this inherited database and its private roster intact. Do not inspect or print account/password files during discovery.
- `PORT_LO`, `PORT_HI`, and `CHROME` were unset; `.harness-env.json` was absent. No servers were started.

## Documentation path followed

Read only the handover's rename route and proof/roster references:

```sh
npx snapback4 guide rename --section opening
npx snapback4 guide deploy --section 'Keep v1 clients working'
npx snapback4 guide api proof
npx snapback4 guide production --section 'Serve script and reusable accounts'
```

The installed docs specify `renamed from` for a stored-field rename, argument/operation aliases for wire inputs/names, and explicit result projections for old field names. An alias alone does not translate results. They recommend combining rename and tighter edits in one release. Column `write <- owner` would also block assistant creation with a nondefault amount, so use an old/next **update** rule instead. Default rollback may select a compatible view retaining current guards; successful rollback is not evidence that a frozen client receives its original result shape.

The API digest supplies `deploy`, `cli`, `startServe`, `startStatic`, `serveUntilSignal`, `provisionAccounts`, `freshUser`, `uniqueName`, `snapshotAll`, and `exhaustPages`. Do not read package implementation or full declarations to reconstruct these helpers. Read a named section/signature only for a concrete unresolved refusal during implementation.

**Version limit:** these are installed 0.4.44 docs. Recheck the handover and needed sections after restoring exactly 0.4.43. Do not silently retain 0.4.44 to obtain a helper or migration feature. Any unavailable target-version capability must be recorded and handled explicitly.

## Save v1 before editing

Future commands, in order, from this directory:

```sh
# Only in the later implementation phase; use the configured npm mirror.
npm install --save-exact snapback4@0.4.43
node -p 'JSON.parse(require("node:fs").readFileSync("node_modules/snapback4/package.json", "utf8")).version'
npx snapback4 init --adapt --day2
# After reviewing the target-version preview; still before changing schema/UI:
npx snapback4 init --adapt --day2 --apply
npm run check
npm run acceptance
npm run frontend:proof
npx snapback4 releases ./deploy --json
# When ./deploy is still absent:
npx snapback4 deploy ./deploy --save-version versions/v1
npx snapback4 releases ./deploy --json
```

Before execution, set `PORT_LO=21220` and `PORT_HI=21229` only if the harness has not supplied them, and require a valid supplied `CHROME` path for browser work. Never download Chromium. Use `process.env.CHROME` and `--no-sandbox` as the inherited browser proof already does. Do not search outside this directory for a browser.

Inspect adaptation's created file inventory. It should save original source/fixtures in `versions/v1`, a contemporary `versions/v2`, and an ESM frozen client plus generated API in `v1/`. Preserve all existing snapshots; never overwrite a saved v1 with edited source. Retain the original frontend source/build recipe as well, so the v1 production frontend can be built before the v2 edit. Freeze the inherited `client:calls` and its shared modules intact; do not rebuild a replacement by reading its implementation. The harness's own frozen copy remains the independent authority.

Record the actual v1 release ID returned by `releases` in an app-owned, nonsecret release manifest (for example `versions/releases.json`). Later commands use that ID, not an assumption that it is 1. If a v1 deployment already exists on a rerun, reuse its saved source and ID instead of capturing current v2 as v1.

Run baseline proofs only once dependencies and required environment are restored. Record exact failures before fixing them. Current discovery made no full-proof claim.

## Chosen v2 source shape

Use one rename plus authorization release. Keep table/row identity, units, deposit, photo ownership, measurements, stages, client audience, retention, and time rules. Do not add a second stored money column, sum money fields, or recompute amounts.

Compact Quarry intent (not a claim that an edited schema has compiled):

```quarry
table fittings:
  charge: int 0..1000000 renamed from price
  # all other columns, defaults, immutability, row reads/inserts unchanged
  read (phone, charge, deposit, retainedBy, retainedAt, retentionReason) <- ASSISTANT_OR_OWNER
  update (old, next) <-
    (ASSISTANT_OR_OWNER_OR_CUTTER or old.client = viewer)
    and (old.charge = next.charge or OWNER)

mutation setCharge(fitting: fittings, charge: int 0..1000000):
  require OWNER else OWNER_ONLY
  row = fittings[fitting] ! else NOT_FOUND
  update fittings[fitting] {charge}
  return fittings[fitting]
```

Expand role predicates to the existing `exists roles[viewer, role = ...]` expressions in real source. Rename the existing `fittings.price` read invariant to `fittings.charge`. Preserve all remaining invariants. Do not apply an owner-only column write rule that would deny assistant opening. Add no unrelated stage restriction to owner charge edits: the change request permits them after opening. Keep the opening guard `deposit <= charge` as the original `deposit <= price` rule; the setter changes only charge, never recalculates deposit or adds a new charge/deposit coupling.

The inherited field and create argument are `int 1..1000000`. V2 deliberately permits zero (`0..1000000`) to satisfy the explicit zero-charge requirement, and UI `min` changes to `0`. Existing zero rows are not proved to exist; a v1 API fixture cannot create them under today's source. For every row that does exist, including a zero if encountered by private inspection, preserve the exact stored integer. Never use a truthiness fallback to infer a missing value. Test zero creation and a nonzero-to-zero owner edit under v2.

Canonical v2 calls return `charge`. Preserve v1 calls as separate compatibility endpoints returning `price`:

| Existing v1 name to retain | Canonical v2 name |
| --- | --- |
| `board`, `fitting` | `boardV2`, `fittingV2` |
| `openFitting` | `openFittingV2` |
| `saveWork`, `advanceStage`, `pickup` | `saveWorkV2`, `advanceStageV2`, `pickupV2` |
| `requestAdjustment`, `cancel`, `approveRetention` | `requestAdjustmentV2`, `cancelV2`, `approveRetentionV2` |
| `myRole`, `clients`, `provision` | unchanged (no fitting result rename) |
| none | `setCharge` |

In the old `openFitting`, use an internal argument `charge: int 0..1000000 alias price`; insert into the single charge column. The new `openFittingV2` accepts `charge`. Both keep staff-only creation, client validation, deposit comparison, and image placement. All old mutation endpoints retain their original guards and business effects; their result projection alone changes. Do not weaken authorization for compatibility.

Pseudocode for wrappers:

```text
v2 row-returning operation => ordinary visible fittings row, with charge
v1 row-returning operation => same business body, then projectV1(visible row)
projectV1(row) => all original fields, with price := row.charge and no charge key
v1 board => original audience/order/cursor behavior, each row projected to v1 shape
v1 fitting => preserve null-on-inaccessible behavior, otherwise projectV1
```

Use the documented row projection form, e.g. `return row {id:.id, price:.charge, ...explicit original fields...}` (the ellipsis here is pseudocode). Explicitly enumerate the real original fields; do not manufacture hidden fields with null/default values. Verify projection redaction for both cutters and clients, including mutation results, and retain the original pagination protocol. List-projection syntax and the tightened rule's compiler/security acceptance remain to be validated with `check` on edited source; consult only the specific diagnostic if refused.

Frontend changes are confined to the shared client/generated handles, `src/App.tsx`, and proof helpers that encode the renamed field. Use v2 operation handles, charge form names/cents conversion, “Fitting charge” labels and readouts, and an owner-only charge edit control calling `setCharge`. Assistants still enter charge on creation and can view it afterward. Cutters/clients still receive no commercial amounts. Keep old `price` spellings only in saved v1 and explicit compatibility/migration code. Keep existing React live hooks; verify a second signed-in session observes an owner edit.

The declarative migration lives in `snapback/schema.q` and its saved `versions/v2/schema.q` copy; list both relative paths in `migrationFiles`. No ad hoc SQL UPDATE, delete/reinsert migration, or additive deposit transform is needed. Keep the `renamed from price` declaration in the saved release history.

## Preview, activate, rollback, forward

After implementing, copy the changed schema and contemporary fixtures into `versions/v2`, leaving `versions/v1` frozen. Use the target-version CLI commands:

```sh
npx snapback4 check
npx snapback4 test --source versions/v2
npx snapback4 deploy ./deploy --schema versions/v2 --check
npx snapback4 deploy ./deploy --schema versions/v2
npx snapback4 releases ./deploy --json
```

Capture all rows immediately before activation. Await command completion/activation, then inspect actual active release and visible view; do not use a fixed sleep. Stop only owned hosts if a lifecycle command requires a released store lock, then restart through `startServe`. Never interpret an unverified listener as this app.

Read the recorded v1 release ID into a shell variable `V1_RELEASE_ID` or, preferably, construct the argv array directly from `versions/releases.json` in the stage script. Reverse and forward commands are:

```sh
npx snapback4 rollback ./deploy --to "$V1_RELEASE_ID" --check
npx snapback4 rollback ./deploy --to "$V1_RELEASE_ID"
npx snapback4 releases ./deploy --json
npx snapback4 rollback ./deploy --to latest --check
npx snapback4 rollback ./deploy --to latest
npx snapback4 releases ./deploy --json
```

Use default guarded compatibility rollback, **not `--exact`**. Zero is outside the original positive-only v1 domain, and v2 introduces stricter charge updates. Inspect whether the selected v1 view preserves zero-valued and v2-born rows and the current guard. Never broaden the old schema or add a positive-only constraint to make rollback appear successful. If preview names a bridge/retained-cell conflict, follow that exact instruction, author a reviewed bridge within this directory, preview again, and include it in the release manifest and `migrationFiles`. Do not guess that preview passes on future writes; repeat it on every stage movement.

If this release cannot expose zero truthfully to v1, preserve all rows/cells and report the specific compatibility failure. If activation itself cannot preserve data, that proof/stage is failed until a supported bridge exists. No reset, prune, raw store recreation, `--restore-dormant`, or exact policy reactivation as a shortcut. A demanded special flag needs the concrete preview explanation and a preservation assertion first.

The documented stack supports release rollback, so plan the release mode and populate its rollback fields. Do not silently switch to the brief's alternate “v1 clients after change” mode to avoid an unsupported downgrade. If target 0.4.43 concretely defines that alternate mode, document it: rollback fields null, frozen v1 checked against changed backend, and forward idempotently activates v2.

## Persistent production and harness scripts

Add these npm script mappings during implementation:

```json
{
  "day2:proof": "node scripts/day2-proof.mjs",
  "prod:serve": "node scripts/prod-serve.mjs",
  "prod:rollback": "node scripts/prod-stage.mjs rollback",
  "prod:forward": "node scripts/prod-stage.mjs forward"
}
```

`prod:serve` serves `./deploy` **as it stands**. No deploy, rollback, build, or business seed in that script. Production identity setup:

```js
const roles = {assistant:2, owner:2, cutter:2, client:2};
const host = await startServe('./deploy', {
  provisionUsers: {roles, provision: api.provision},
  // env inherits PORT_LO/PORT_HI; private config stays server-side
});
try {
  // assert real production auth, each assigned role, and two accounts per role
  console.log(JSON.stringify({backendUrl:host.url, users:host.sessions}));
  await serveUntilSignal([host]);
} finally { await host.stop(); }
```

The helper uses real signup/login and operator-restricted `provision`; normal users cannot self-assign roles. Do not use `--staging`, `seedUsers`, `seedAccounts`, personas, `/seed`, or an operator token for business calls. Keep `deploy/proof-accounts/default.json` with its store, mode 0600, with its stable plan, intent IDs, completion markers, and canonical args. Reruns log in and complete unfinished setup; no roster deletion, auth-reset loop, or new batch to evade a mismatch/rate budget. Avoid concurrent provisioning; handle lock/partial completion as a diagnosed state.

The JSON readiness line is the sole stdout record; package logs go to stderr or private in-directory logs. Ordinary test credentials belong only in the harness readiness/private roster, never reports. Load `.harness-env.json` if later supplied without printing it or exposing privileged values through Vite, URLs, frozen code, or `apiNotes`.

Stage pseudocode:

```text
rollback: read saved v1 ID; preview that target; activate; assert release/view; exit
forward: if current v2 source/view, verify and no-op;
         otherwise preview/activate saved v2 (latest rollback target after deployment);
         assert source/view matches saved v2; exit
both: preserve deployment/store/roster; run from either state; no serving host left
```

On initial v2 creation, forward uses `deploy --schema versions/v2`; thereafter prefer selecting the recorded release rather than creating duplicate releases. Validate that “latest” is that saved v2 before using it. Save IDs/source identity so later operator releases cannot silently redirect the proof.

`probe:serve` must first ensure v2 through the forward helper, then serve production with the same roster, build its own Vite output against that host URL, start static hosting, and emit exactly the required `{backendUrl,frontendUrl,sessions,apiNotes}` record. `VITE_SNAPBACK_URL` already exists as a public client setting; the inherited `?api=` URL override can also pin this backend. Include password sign-in instructions and cents/millimetres/operation names, with charge terminology, in `apiNotes`; no admin configuration. Hold with `serveUntilSignal` and cleanup in `finally`. Support intentional long lifetime using the installed helper's documented hold mechanism where needed; verify the harness's no-argument command still survives its required 30-second check.

Every process uses the allowed env range, records its child handle/PID, and stops only its own process/group. Keep cleanup coverage when setup fails before readiness. Never kill by port, process name, or directory. Store scratch imports under `.scratch`, logs here, and temporary files here or the supplied `$TMPDIR` only.

## Custom persistent proof, not the generated disposable proof

The handover says adaptation's default proof owns a fresh temporary store and its default hook proves storage conservation only. That does **not** meet this harness's persistent production contract. Author the npm entry above to use existing `./deploy`, never remove/recreate it, and include authenticated business behavior. Any disposable library example is only a reference, not the final proof.

Compact proof pseudocode:

```text
try:
  ensure saved sources/IDs exist; read complete baseline of both app tables
  stage rollback to saved v1 (first setup deploys original v1 once)
  start production serve, reuse private roster, assert real logins and roles
  through ordinary assistant/owner sessions create fresh uniquely named v1 fittings
  run frozen v1 client; classify every call; keep reports without credentials
  close clients/host before activation if necessary

  beforeV2 := snapshotAll roles + snapshotAll fittings (all IDs, not first page)
  preview and deploy/select v2; start production host; re-login same accounts
  afterV2 := complete snapshot; assert preservation and rename values
  assistant creates via openFittingV2(charge); include zero with zero deposit
  owner1 changes an existing charge; owner2 changes another; deposit stays exact
  assistant1/2, cutter1/2, client1/2 cannot call setCharge (OWNER_ONLY)
  validate direct and board reads, privacy, same IDs and live owner update
  create v2-native rows; immediately complete normal pickup/adjustment workflow
  frozen v1 against live v2 => record works/degraded/broken per actual calls
  snapshot again AFTER all deliberate client writes; record their declared deltas

  preview rollback, stop owned host as needed, activate saved v1, restart
  assert all rows/cells (including v2-native, zero, and replay writes) conserved
  frozen v1 against rollback => record actual call/row-shape outcomes
  snapshot AFTER replay so its business mutations are part of next baseline
  preview forward, activate v2, restart; assert all rows/cells again
  repeat rollback/forward preservation cycle when needed for two-cycle coverage
  assert v2 selected; write day2-proof.json with measured results
finally:
  close client observers/sessions and every owned host/browser/static server
```

Production uses real clock exclusively: no `clockOffset`, `advance`, or waiting for a clock window. A newly picked-up fitting is immediately eligible for adjustment regardless of time of day. Expiry/boundary tests stay in disposable development/staging acceptance. Use `uniqueName` or UUID names on every run and frozen replay; do not rename cap owners or reset data. Reuse roster sessions within a run; `freshUser` is available for a genuinely isolated proof group through real signup/provision, not as an auth-budget workaround.

Preservation assertions:

```text
index snapshots by stable table + id; assert no duplicate ID in each snapshot
for every pre-transition role: same ID, principal, role after transition
for every pre-transition fitting:
  same ID; after.charge === before.price on first forward (integer equality)
  otherwise normalizedMoney(after) === normalizedMoney(before)
  normalizedMoney uses own-field presence, never price || charge or default zero
  every other field equal, including deposit, photo reference and metadata,
    client/openedBy, notes, stage, pickup/adjustment/retention/opening timestamps
allow additional legitimately created rows; compare complete population, not only ours
account for only explicitly recorded business-write deltas between checkpoints
repeat after v2 writes and both directions; verify zero and v2-native IDs explicitly
```

Use `snapshotAll(table,{release:'./deploy'})` or `data TABLE --release ./deploy --all --json` for private complete inspection; these merge active/retained cells once per ID, active values win, deleted rows stay absent. These reads bypass row rules and are conservation evidence only. Authenticated old/new SDK calls supply compatibility and privacy evidence. Exhaust ordinary result pagination for UI/client audits; do not assume a 100-row board or a million-row CLI limit is complete.

Frozen-client command, repeated on v1, v2, rollback, and final forward:

```sh
BACKEND_URL="$BACKEND_URL" CALLS_USERS="$PRIVATE_USERS_FILE" npm --prefix v1 run client:calls
```

Generate the users file privately (0600) from the roster/session result; remove temporary copies in `finally`. Keep the original v1 generated API/module resolution. For each call retain actual response/error and classification. New expected charge-set denials in the v2 runner print `ok:false`, `expected:"OWNER_ONLY"`, and an error beginning `OWNER_ONLY`; unexpected success is failure. Continue after individual call errors. Old-client transport errors or missing result fields are not intentional guard refusals. Assert required v2 behaviors and data preservation; **record**, rather than assert away, the frozen v1 compatibility outcome.

Write every required `day2-proof.json` key, with real counts for all pre-v2 fittings and checked survivors, actual rollback/forward outcomes, actual old-client classifications and explanatory notes. In release mode use null for the alternate-mode `v1ClientAfterChange`, and accurately set `migrationPreservesV1Rows`. Include declarative migration/bridge source paths. On failure write `ok:false` and exit nonzero; never prefill success.

## Audit adapter and final validation commands

Change `harness:snapshot` to inspect production completely with `--all`, output only `{tables:{roles:[...],fittings:[...]}}`, and exclude auth/session/credential tables. No public admin endpoint. Update `backend-choice.json` to list `deploy/store.sqlite` plus the inherited persistent `data/studio/store.sqlite` while it remains. The latter is staging data, not an excuse to point production at it or silently lose its rows. Resolve the audit treatment of that inherited staging store before implementation completion: either include its records under distinct source-qualified table keys as well, or use a documented supported preservation/adoption path. Do not copy a live SQLite file, import credentials, or reset it by inference. Discovery did not run a production adoption preview.

Future validation, after the implementation is concrete:

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

A bounded driver must additionally start `npm run prod:serve`, consume its single JSON record privately, run frozen v1 and v2 `client:calls` using only URL/users, snapshot before/after, and stop its recorded group in `finally`. Run v2 calls twice after the first forward, and frozen v1 again after the second rollback as the harness specifies. Validate `probe:serve` with a bounded 30-second `serveCheck` (`deployment:'./deploy'`), readiness/account counts and cleanup. Never launch its persistent npm command in the foreground and wait indefinitely. Frontend proofs must rebuild after output deletion and demonstrate assistant creation plus an owner charge edit visible in UI; include a refused ordinary assistant edit at the backend level.

Keep new `DIARY.md`/`friction.jsonl` entries current during implementation, never edit `PREVIOUS-*`. The implementation report must distinguish inherited results, this discovery's one schema check, and subsequently measured results; compare to day one's staging/React experience, rank actual friction, and supply the requested rating only for work actually performed.

## Unresolved limits at this stopping point

1. Requested 0.4.43 is not the installed CLI; target-version handover/helper/migration availability has not been verified. No install was allowed in this session.
2. Preview exited on missing frontend dependency. No v1 capture, app build, TypeScript check, auth provisioning, production release, or proof was completed.
3. Port/browser environment is absent. Later scripts must honor harness values or permitted local port defaults; browser proof cannot run without a supplied executable.
4. Explicit legacy row/list projection and update-policy compilation, including any narrowed-setter security gate, require an edited-source check later. No new gate was observed today; do not preemptively tour security docs or invent approval requirements.
5. V1 forbids zero, v2 must allow it. Actual reverse preview and selected compatible-view behavior with zero and v2-native rows remain unmeasured. Keep any refusal visible; a green preview before later writes proves only that snapshot.
6. Production is absent; inherited `data/studio` is staging. Its retention/audit/adoption treatment must be made explicit without resetting it. All-production snapshot completeness and roster recovery are planned, not exercised.
7. Frozen v1 calls/return shape and both release directions are **unknown**, not “works.” The docs establish a route to test them, not a successful outcome.

Stop after this plan. Implementation and all commands labeled future are outside this reading replay.
