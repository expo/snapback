# DAY2-PLAN — Heat Pump Installs v2 (reading/discovery; no implementation)

Scope: plan only. No backend/UI sources changed, no deploys, no users
provisioned, no proof scripts run, no builds. Discovery sources: the installed
CLI handover (`npx snapback4 init --adapt --day2`, preview only), `guide deploy`
sections 9/5/6/11/12/10/13–15, `guide production` (Serve script and reusable
accounts), `guide api proof` signature digest, `guide security` N_PRESENCE_LOOSENING,
plus minimal inspection of `snapback/schema.q`, `App.tsx` audit spots,
`scripts/client-calls.mjs`, `scripts/probe-serve.mjs`, `scripts/harness-snapshot.mjs`.

## 1. Verified starting state

- `package.json` declares `snapback4 0.4.43` / `snapback4-expo 0.4.43`, but the
  installed tree reports `snapback4 0.4.44` and `snapback4-expo` is absent from
  `node_modules`. `npx snapback4 --version` prints `0.4.44`.
- `npm run check` passes (2 tables, 12 operations, 0 gates pending,
  1 witnessed question N_ARGUMENT_GRANT already acked, advisories only).
- No `versions/`, `v1/` or `deploy/` directories exist yet. No `.harness-env.json`.
- `PORT_LO`/`PORT_HI` are empty in this shell; scripts already read ports via
  `portRange()` from `snapback4/proof` (keep that; never hard-code 21110–21119).
- Current schema (`snapback/schema.q`): `installs.audit` is a **required**
  `file <=5000000 (pdf/png/jpeg)`, listed in `immutable`, and required by
  `openInstall`. There is no set/clear-audit mutation. Table update rule
  (`update <- .homeowner = viewer or exists roles[viewer]`) is only exercised
  through the named mutations.
- UI audit touchpoints (`App.tsx`): `OpenInstallForm` requires an upload before
  Open (line 238) with `Audit scan: uploaded/required` (line 253); `InstallCard`
  (lines 86–104) shows **no audit line at all** today.
- `scripts/harness-snapshot.mjs` already prints `{tables:{roles,installs}}` via
  `sql --json-objects`, but targets `staging`; retarget to `./deploy`.
- Change route (per handover table): **"Loosen a required field, allow null"**
  → `guide deploy --section 'Bridge a safety gate'` (+ `N_PRESENCE_LOOSENING`
  if `check` asks). No backfill, no rename, no extract: existing rows keep
  their scans, so no historical computation is needed.

## 2. Step 0 — reconcile versions, freeze v1 (exact commands, in order)

```sh
npm ls snapback4 snapback4-expo; npx snapback4 --version
npm install --save-exact snapback4@0.4.43 snapback4-expo@0.4.43
npm run check && npm run acceptance   # must be green before any edit
npx snapback4 init --adapt --day2 --apply
npx snapback4 check
npx snapback4 deploy ./deploy --save-version versions/v1
npx snapback4 releases ./deploy --json   # record the v1 release id -> $V1
```

`--apply` creates `versions/v1` (+`versions/v2` snapshot), the frozen `v1/` ESM
client and generated API. Never recapture v1 from edited sources. If the
downgrade 0.4.44→0.4.43 breaks anything, fix, record each break in
`friction.jsonl`, and re-green `check`/`acceptance`/`frontend:proof`.

## 3. V2 schema change (source-shape choice)

Loosen, don't reshape: keep table, op names, arg spellings and row audience;
make `audit` nullable and add two coordinator-only mutations.

```quarry
table installs:
  audit: file <=5000000 ('application/pdf', 'image/png', 'image/jpeg') ?
  immutable homeowner, coordinator, address, price, quotedAt, bedroomWindow
  # audit removed from immutable; read/insert/update/delete clauses unchanged

mutation openInstall(homeowner: principal, address: text 5..200,
    audit: file <=5000000 ('application/pdf', 'image/png', 'image/jpeg') ?,
    price: int 1..100000000, bedroomWindow: bool):
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  return insert installs { homeowner, coordinator: viewer, address, audit,
    price, quotedAt: now, stage: 'survey', status: 'quoted',
    bedroomWindow, windowApproved: false }

mutation setAudit(install: installs,
    audit: file <=5000000 ('application/pdf', 'image/png', 'image/jpeg')):
  i = installs[install] ! else NOT_FOUND
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  update installs[install] { audit }
  return null

mutation clearAudit(install: installs):
  i = installs[install] ! else NOT_FOUND
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  update installs[install] { audit: null }
  return null

invariant installs.setAudit only exists roles[viewer, role = 'coordinator']
invariant installs.clearAudit only exists roles[viewer, role = 'coordinator']
invariant evidence always .audit = null or .audit != null
```

Why this shape: old `openInstall` callers that pass `audit` keep working
(identical op/arg spelling → v1 client stays compatible); new callers omit it.
No `backfill` (loosening needs none; existing cells keep their scans). The
`evidence` invariant is the N_PRESENCE_LOOSENING presence intent; if `check`
still gates, follow its concrete refusal text, not more docs. The `audit: null`
clear spelling and optional-`file`-arg syntax are check-confirmed (see §8).

## 4. Frontend + client changes

- `InstallCard`: add `audit: string | null` to the row type; render
  `install.audit == null ? "Energy audit to follow" : "Audit scan attached"`
  (exact asset-link rendering follows the existing `AuditUpload`/`uploadBlob`
  pattern; asset ids stay opaque).
- `OpenInstallForm`: make upload optional; enable Open without `auditId`;
  label becomes `Audit scan: uploaded/optional`; pass `audit` only when set.
- Coordinator attach/replace/remove control on board cards reusing
  `AuditUpload` + `setAudit`/`clearAudit` mutations.
- `scripts/client-calls.mjs` (v2): add open-without-audit, coordinator
  set/replace/clear, homeowner + installer set/clear expecting `NOT_COORDINATOR`;
  keep every v1 call. `scripts/acceptance.mjs`: same assertions plus v2 rule
  matrix (run twice).

## 5. Preview → deploy v2 → rollback → forward (exact commands)

```sh
npx snapback4 check
npx snapback4 test --source versions/v2
npx snapback4 deploy ./deploy --schema versions/v2 --check --restore-dormant --verbose
npx snapback4 deploy ./deploy --schema versions/v2 --restore-dormant
npx snapback4 releases ./deploy --json   # inspect live source/view + rowShape
npx snapback4 rollback ./deploy --to $V1 --check
npx snapback4 rollback ./deploy --to $V1
npx snapback4 rollback ./deploy --to latest --check
npx snapback4 rollback ./deploy --to latest
```

`--exact` only after deliberate review of the old source's broader policy; if a
preview demands a bridge or `--restore-dormant`, follow its concrete
instruction and preview again. Default rollback is expected to select a
registered compatible view (current guards retained); a null-audit row under
exact v1 would go dormant (readable via `data --all`, invisible to v1 queries)
— the previews decide which the plan's rollback step uses (see §8).

## 6. Frozen v1 client matrix

```sh
BACKEND_URL=<live-url> CALLS_USERS=<users-file> npm --prefix v1 run client:calls
```

Run on v2-live, after rollback-to-v1, and after forward-to-v2. Expected:
v1 `openInstall` **with** scan keeps working on v2 (same spelling); v1 reads of
null-audit rows depend on the registered view (§5 preview); v1 has no
set/clear-audit op (`E_OP` if attempted — record, don't invent a compat op
unless the preview names one). Record `works|degraded|broken` per stage with
what was tried; new-guard denials are recorded separately from transport
failures. No `.harness-env.json` exists, so public client config goes in
`apiNotes`/test-user objects only.

## 7. Production proof automation (compact pseudocode)

- `scripts/prod-serve.mjs` (`prod:serve`): `startServe("./deploy",
  {provisionUsers:{roles:{coordinator:2,homeowner:2,installer:2,owner:2},
  provision:api.provision}})` → `startStatic("dist")` (built with the live
  backend URL) → print ONE stdout JSON line
  `{backendUrl, frontendUrl, sessions:{role:[{email,password,principal,token,
  headers}]}, apiNotes}` → `serveUntilSignal([backend, frontend])`;
  `finally { cleanup(...) }`. Roster persists in
  `production/proof-accounts/default.json` (0600); reruns log in, provision
  unfinished entries only. Must not deploy or mutate data.
- `prod:rollback`: `rollback("./deploy", $V1)` over whatever production holds;
  `prod:forward`: `deploy("./deploy", "versions/v2")`; both idempotent, from
  either state, stop everything they start, leave no server running.
- `day2:proof` (re-runnable, never deletes/resets production):
  ```
  before = snapshotAll ids+values (roles, installs; exhaustPages over all rows)
  startServe(./deploy) -> ensure v1 live (rollback --to $V1 only if live != v1)
  freshUser x8 (uniqueName per run); provision via api.provision
  v1 writes through app ops (open WITH scan, accept, advance, inspect, approve)
  deploy v2; after = snapshot; assert id-set(before) ⊆ id-set(after) AND
    every pre-v2 row's scan/price/fields byte-identical (migratedValuesCorrect)
  v2 feature: open WITHOUT scan (coordinator) -> reads "Energy audit to follow"
    shape; setAudit/clearAudit work; old rows' scans intact
  v2 rule: homeowner setAudit -> NOT_COORDINATOR; installer setAudit -> NOT_COORDINATOR
  frozen v1 client:calls vs v2 -> record v1ClientAfterV2
  rollback --to $V1; snapshot; assert no id lost incl. v2-native rows (dormant
    rows count via data --all); v1 client again -> v1ClientAfterRollback
  forward to v2; snapshot; assert preserved; leave v2 live; stop all; write day2:proof.json
  ```
  `migrationFiles: ["snapback/schema.q"]` (+ any bridge dir if the preview
  requires one); `migrationPreservesV1Rows: true` iff the id-superset + value
  assertions hold over the FULL population each run (not first page).
- `probe:serve`: existing script retargeted from `staging` to `./deploy`
  (production release, real roster, no seed shortcuts); stays up under SIGTERM.
- `harness:snapshot`: existing script retargeted to `--release ./deploy`;
  keep `--json-objects`, stable ids, no credentials.
- `backend-choice.json`: add `databaseFiles: ["deploy/store.sqlite"]` after
  confirming the filename post-deploy; no secrets.

## 8. Unresolved limits (for check/preview to settle, not assumed)

1. Optional-`file`-arg and `audit: null` clear syntax — `check` is the oracle.
2. N_PRESENCE_LOOSENING gate wording — answer with the §3 evidence invariant;
   keep the exact ack if `check --review` asks more.
3. Rollback view selection for null-audit rows (default view vs dormant vs
   authored bridge) — decided by the §5 previews + `releases --json`
   `rowShape.matchesTarget`, not by this plan.
4. Version skew (tree 0.4.44 + missing `snapback4-expo` vs pinned 0.4.43) —
   step-0 reconcile may surface upgrade breaks; all go in `friction.jsonl`.
5. `npx` vs local binary resolution (which `snapback4` served `--version`
  0.4.44) — pin verification to `npm ls` + in-repo `check`.
6. Time rules in production proofs use the real clock; `advance`/`drain` exist
   only for dev acceptance — day2:proof must not fake time.
