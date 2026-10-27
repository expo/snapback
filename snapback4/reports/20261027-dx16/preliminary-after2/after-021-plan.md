# Day-two plan — Cacao Fermentary Lots (v2: intake review priority)

Scope of this session: reading/discovery only. No backend/UI sources were
changed, nothing was deployed, no users were provisioned, no proof was run.
Unresolved limits are listed at the end.

## 1. Starting point (observed, not changed)

- Workdir `/tmp/dx16-replay/after-021`; app from day one: `snapback/schema.q`
  (176 lines), `src/App.tsx` + `src/client.ts`, `scripts/acceptance.mjs`,
  `scripts/client-calls.mjs` (36 reported calls), `scripts/frontend-proof.mjs`,
  `scripts/probe-serve.mjs`, `scripts/harness-snapshot.mjs`,
  `scripts/staging.mjs`, `scripts/launch.mjs`.
- Schema: `use identity password`; tables `roles` (operator-provisioned roster
  `farmer/clerk/worker/head`), `lots` (lifecycle
  `received→fermenting→drying→bagged→sold` plus `rejected`, flags
  `lateFerment`/`oldStock`, `moldCount`/`rejectReason`), `payments`; 18 ops;
  tables are `online only`. Privacy: farmers read only own rows (predicate +
  hidden-row semantics); yard/flag boards and `farmerList` require staff.
- Version skew (do first): `package.json` pins `snapback4@0.4.43`, but
  `node_modules/snapback4/package.json` and `npx snapback4 --version` report
  **0.4.44**. Day-two step 1 is therefore a downgrade-then-confirm:
  `npm install --save-exact snapback4@0.4.43`, then `npm run check`,
  `npm run acceptance`, `npm run frontend:proof` (each green twice where the
  contract requires repetition). Record each break in `friction.jsonl`.
- Missing state: no `versions/` and no `deploy/` exist yet — v1 has never been
  saved or deployed in this copy. The v1 capture below is mandatory and must
  happen BEFORE any v2 edit.
- Ports/env: `$PORT_LO/$PORT_HI/$CHROME/$TMPDIR` are unset in this shell; the
  harness sets them at proof time. Existing scripts already do the right thing
  (`snapback4/proof` `portRange()` in `scripts/launch.mjs`, `VITE_SNAPBACK_URL`
  propagation, `executablePath: process.env.CHROME` pattern in proof helpers).
  Keep that pattern; never hard-code ports (range 21210–21219).

## 2. Handover path (installed CLI preview, already run read-only)

`npx snapback4 init --adapt --day2 --dry-run` (exit 0) prescribes exactly:

```sh
npx snapback4 init --adapt --day2 --apply
npx snapback4 deploy ./deploy --save-version versions/v1
```

- Adapt saves absent `versions/v1` and `versions/v2` source/fixture snapshots
  plus a frozen `v1/` ESM client and generated API; existing snapshots and
  authored proofs stay untouched. Capture BEFORE the edit.
- If v1 is already deployed/saved, inspect `releases ./deploy --json` and
  reuse its saved source; never recapture v1 from v2.
- Documentation budget per the handover: this card + ONE change route
  (below) + `guide api proof` at proof-writing time. No `--full` reads, no
  CLI-help tours, no `dist/proof.js` reads.

## 3. Change route (chosen): required field computed from old values

Docs read: `guide deploy --section 'Migrations and adoption'` and
`guide deploy --section 'Which migration shape'`; v1-compat:
`--section 'Keep v1 clients working'`; roster/reruns:
`guide api proof` digest + `guide production
--section 'Serve script and reusable accounts'`.

Source-shape choice (Quarry, in working `snapback/*.q` + `versions/v2`):

```quarry
table lots:
  ... (all existing columns unchanged) ...
  priority: enum('standard', 'needs attention') default 'standard'
  read <- <existing lots read audience, unchanged>
  insert <- <existing lots insert rule, unchanged>
  update <- <existing lots update rule, unchanged; NO column-level write narrowing>
  online only

backfill lots priority(lateFerment: bool):
  {priority: 'needs attention' if lateFerment else 'standard'}
```

- Why `backfill`, not a literal default: every pre-existing row with
  `lateFerment = true` must become `'needs attention'`, all others
  `'standard'`. A literal default cannot invent that history; the named
  backfill reads the assembled pre-patch row (`lateFerment`) before
  simultaneous patches (per 'Which migration shape').
- New rows: `default 'standard'` on the column (contextual `now`/`viewer`
  defaults are forbidden as history; a literal enum default is the real
  default choice here). No `logLot` signature change.
- Raising priority: new mutation, head-only, preserving all existing guards:

```quarry
mutation setPriority(lot: lots, priority: enum('standard', 'needs attention')):
  require exists roles[viewer, role = 'head'] else NOT_HEAD
  l = lots[lot] ! else NOT_FOUND
  update lots[lot] { priority }
  return null
```

- Tightening, not loosening: clerk/farmer/worker calls to `setPriority`
  refuse `NOT_HEAD`. `logLot`/`startFerment`/`startDrying`/`bagLot`/`markSold`/
  `rejectLot`/`recordPayment` and all queries keep their names, args, guards
  and result shapes (certificate scans, prices, payments, rejection approvals,
  yard stages unchanged). No renames, so no `renamed from`/alias work; no
  media moves, so no `extract`.
- Frontend (React/Vite/TS, `snapback4/react` bindings): staff yard board shows
  `priority` per lot; a head-only control calls `setPriority` (buttons hidden
  unless `myRole = head` AND server still refuses non-heads); log form shows
  new lots starting at `standard`. No change to sign-in, routing, upload flow,
  or farmer views except displaying the value.

## 4. Exact command sequence (implementation session)

```sh
npm install --save-exact snapback4@0.4.43
npm run check                                   # schema compile + tsc; fix, record friction
npx snapback4 init --adapt --day2 --apply       # saves versions/v1(+v2 skeleton), frozen v1/ client
cp snapback/schema.q <saved-v1-copy>/           # extra v1 backend copy in-dir (e.g. v1/) for rollback/day2:proof
npx snapback4 deploy ./deploy --save-version versions/v1   # capture v1 release BEFORE editing
# --- production v1: real signup/login (no dev doors), 2 users x 4 roles ---
npx snapback4 serve ./deploy --port $PORT_LO   # production server, Bearer only behind TLS proxy
# build frontend with VITE_SNAPBACK_URL=<prod url>, serve dist, sign up 8 users,
# provision via app's own provision op as operator, write business rows via app ops
# --- v2 edit ---
# edit snapback/schema.q (+ versions/v2 sources/fixtures), add setPriority, backfill
npx snapback4 check
npx snapback4 test --source versions/v2
npx snapback4 deploy ./deploy --schema versions/v2 --check   # preview; follow any bridge/--restore-dormant instruction, preview again
npx snapback4 deploy ./deploy --schema versions/v2           # activate v2 over v1 data
npx snapback4 releases ./deploy --json                       # confirm live source/view + row shape
# --- rollback/forward rehearsal (replace 1 with saved v1 release ID) ---
npx snapback4 rollback ./deploy --to 1 --check
npx snapback4 rollback ./deploy --to 1
npx snapback4 rollback ./deploy --to latest --check
npx snapback4 rollback ./deploy --to latest
# --- proofs ---
npm run acceptance && npm run acceptance       # dev backend, incl. v2 feature + NOT_HEAD rule
npm run frontend:proof && npm run frontend:proof
npm run day2:proof && npm run day2:proof       # must pass twice in a row
```

Rollback-shape decision: default rollback keeps a registered compatible view
retaining current guards; use `--exact` only after deliberately reviewing the
old source's broader policy. After edits, preview rollback (from v2) AND
forward (from v1), plus v2-native rows with no v1 preimage. If preview demands
`--bridge <dir>` or `--restore-dormant`, follow its concrete instruction and
preview again. Never `prune`/reset/delete storage to make a proof pass
(`prune` discards preimages and can make re-entry refuse).

## 5. Proof pseudocode (production; real clock; no waiting windows)

Shared helpers (`snapback4/proof`): `deploy(dir, schema, opts)`,
`startServe(dir, {provisionUsers:{roles:{farmer:2,clerk:2,worker:2,head:2},
provision: api.provision}})`, `provisionAccounts` (persistent roster
`production`-adjacent `proof-accounts/default.json`, mode 0600, reused across
reruns; `uniqueName`/`freshUser` for per-run records), `exhaustPages` (page
over ALL rows via cursors — never first-page checks), `snapshotAll`,
`serveCheck`, `serveUntilSignal` + `cleanup` (stop every started host in
`finally`; leave v2 live at the end of day2:proof, nothing running after
stage scripts).

`day2:proof` (idempotent, additive only — never delete/reset/recreate data
or the deployment; rerun-safe via unique names):

```js
// 0. open production as-is (expect v2 live after first run)
before = snapshotAll(lots) via prod admin inspection  // every persistent row, stable IDs
// 1. v1 live: deploy saved v1 source over current store (no reset)
await deploy('./deploy', 'versions/v1'); host = await startServe('./deploy', {provisionUsers...})
users = await provisionAccounts(host, {roles:{farmer:2,clerk:2,worker:2,head:2}, provision: api.provision}) // reuses roster, tops up unfinished only
login each user; write v1 rows via logLot/startFerment/.../recordPayment as matching roles (uniqueName per run)
// 2. v2 live over the same store
await deploy('./deploy', 'versions/v2'); host2 = await startServe(...)
after = exhaustPages(yardBoard/head) + snapshotAll
assert after ⊇ before by id (count recordsBeforeV2/recordsCheckedAfterV2)
assert migratedValuesCorrect: every before-row with lateFerment=true now priority='needs attention', else 'standard'
// 3. v2 feature + rule over existing accounts
as head: setPriority(lot,'needs attention') succeeds; read back via lotDetail/yardBoard
as clerk + farmer: setPriority refuses NOT_HEAD (v2RuleEnforced)
farmer myLots still own-rows-only; payments unchanged
// 4. frozen v1 client (inherited v1/ copy, BACKEND_URL + CALLS_USERS file) against v2 → record works/degraded/broken + notes (assert nothing, record)
// 5. rollback to v1: rollback ./deploy --to <v1id>; assert all ids still present (incl. v2-written rows); run v1 client again → record
// 6. forward to v2 (latest): assert all ids + migrated values again
// 7. stop everything; leave v2 live; write day2-proof.json (schema below)
```

`prod:serve` (no deploy/change; stays up until SIGTERM):

```js
host = await startServe('./deploy', {provisionUsers...}); // whatever release is live
users = await provisionAccounts(...)  // create-via-signup only if missing
console.log(JSON.stringify({backendUrl: host.url, users: {farmer:[{email,password}...], clerk:..., worker:..., head:...}}))
await serveUntilSignal([host])  // logs to stderr/file; the ONE stdout line is the JSON
```

`prod:rollback` / `prod:forward` (repeatable, either starting state, no data
loss, no leftover servers):

```js
// rollback: cli(['rollback','./deploy','--to','<v1id>']) — or --to 1 per handover; forward: cli(['rollback','./deploy','--to','latest'])
// await activation; verify with releases --json; stop; exit 0 with release live
```

`probe:serve` (production v2): ensure v2 live WITHOUT resetting data
(`releases --json`; deploy v2 only if a previous stage left v1 live — never
wipe rows), build frontend with `VITE_SNAPBACK_URL=<prod>`, `startStatic dist`,
sign in 2×4 real users (create if missing), print ONE stdout line
`{backendUrl, frontendUrl, sessions, apiNotes}` (apiNotes: HTTP verbs
`POST <backend>/q/<op>` / `POST <backend>/m/<op>`, `/auth/signup|/login`
8+ char passwords, `Bearer` header, `{id}` certificate placement,
`?api=` override), hold until SIGTERM.

`client:calls` (v2): same contract as inherited (BACKEND_URL + CALLS_USERS,
one JSON line per call, `ok:false + expected:CODE + error starting with CODE`
for guard refusals, carry on after failures, exit 0 iff all ok/expected) plus:
`setPriority` as head (ok), as clerk/worker/farmer (`NOT_HEAD`), and a read
showing `priority` on the touched lot.

`harness:snapshot`: extend TABLES to `["roles","lots","payments"]` (plus the
new column automatically — prints exact app columns), still read-only admin
`data --json`, no server/auth, no credentials; update `backend-choice.json`
(`databaseFiles: [".snapback4/store.sqlite"]` stays; proof stores excluded).

`day2-proof.json` (overwrite each run): `{ok, recordsBeforeV2,
recordsCheckedAfterV2, dataPreservedAfterV2, migratedValuesCorrect,
v2FeatureWorks, v2RuleEnforced, rollback, dataPreservedAfterRollback,
rollforward, dataPreservedAfterRollforward, v1ClientAfterV2,
v1ClientAfterRollback, migrationFiles: ["snapback/schema.q",
"versions/v2/..."], v1ClientAfterChange: null (release-rollback mode —
rollback/forward are real moves, not frozen-client checks),
migrationPreservesV1Rows, v1ClientNotes, notes}`.

## 6. Frozen-v1-client expectation (to verify, not to assert blindly)

- v2 is strictly additive (one enum column + one mutation; no renames, no
  removed/reshaped fields), so the frozen v1 client should keep working
  (`works`, else `degraded` with exact failing calls recorded). Old result
  rows omit/are missing the new field per the private-field rule; v1 writes
  go through unchanged ops and adopt the column default on write.
- Risk: reverse-projection of v2-native `priority` values under v1. The deploy
  preflight reports reverse-projection risks; a green snapshot never freezes
  later writes — re-run `rollback --to N --check` against the LIVE population
  after v2 writes exist, and keep the default compatible view unless a
  deliberate review justifies `--exact`.

## 7. Unresolved limits (stated, not worked around)

1. CLI-vs-package skew: `npx snapback4` resolved to 0.4.44 while the app pins
   0.4.43; the plan assumes `npm install --save-exact snapback4@0.4.43` makes
   the local binary 0.4.43. If `check`/proofs behave differently under 0.4.44,
   that is day-two friction to record, not a silent upgrade.
2. Exact `versions/v2` file layout and any `--adapt --apply`-generated proof
   skeleton are unknown until `--apply` runs; migration-file paths above are
   the handover's prescribed locations, to confirm after apply.
3. Whether `deploy --check` demands a bridge/`--restore-dormant` for the new
   enum column is unknown until the preview runs against real v1 data — the
   plan's branch (follow the concrete instruction, preview again) covers it.
4. `$PORT_LO/$PORT_HI/$CHROME` were unset in this discovery shell; all
   scripts must keep reading them at run time (as they already do).
