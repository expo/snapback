# DAY2-PLAN.md — Heat Pump Installs, v2 (audit scan optional)

Discovery-only plan. No source, deployment, or proof was changed in this
session. Workspace: `/tmp/dx16-replay/after-011`.

## 1. Baseline facts (observed read-only)

- `package.json` already pins `snapback4@0.4.43` + `snapback4-expo@0.4.43`.
  Upgrade step is confirm-only. (A 0.4.43→0.4.44 notice prints; do NOT
  upgrade — the brief pins 0.4.43.)
- `npx snapback4 check`: green — 2 tables, 12 operations, 0 gates pending,
  1 witnessed question (pre-existing N_ARGUMENT_GRANT), 12 non-blocking
  advisories.
- `npm run check`: RED — `tsc: not found` (`node_modules/.bin` holds only
  `snapback4`). Toolchain needs a reinstall from the local mirror before
  anything else.
- Schema (`snapback/schema.q`): `installs.audit` is a required typed
  `file <=5000000 (pdf/png/jpeg)`; `audit` is in the `immutable` list;
  `openInstall` takes a required `audit` arg. Table `update` rule is broad
  (homeowner-self or any role holder); per-op `require`s do the real gating.
- UI gap found: `InstallCard` (`App.tsx`) never displays the audit at all;
  `OpenInstallForm` blocks submit until a scan uploads (`!auditId` gate,
  "required" label).
- `scripts/client-calls.mjs` always uploads + passes `audit` to
  `openInstall`; that is the frozen v1 client shape.
- Absent now: `versions/`, `v1/`, `./deploy`, `production/`,
  `.harness-env.json`. `fixtures/` is empty. `PORT_LO/PORT_HI/CHROME/TMPDIR`
  are empty in this shell (harness sets them at run time).

## 2. Handover path (installed CLI, preview only)

`npx snapback4 init --adapt --day2` (preview, no writes yet) prescribes:

```sh
npx snapback4 init --adapt --day2 --apply
npx snapback4 deploy ./deploy --save-version versions/v1
```

This freezes working sources + fixtures to `versions/v1` (+`versions/v2`
skeleton) and a runnable frozen client in `v1/`, and adds
`scripts/day2-proof.mjs` + `day2:proof` infrastructure. Run BEFORE any v2
edit. Production dir is `./deploy` (brief), not `production/`.
Recommended docs path used: this card → ONE change route below →
`guide api proof` for proofs (+ `guide production --section 2` for serve).

## 3. Change route: loosen a required field

Per the handover table, this change is **"Loosen a required field"**:

- `guide deploy --section 'Bridge a safety gate'`
- `guide security --section 'N_PRESENCE_LOOSENING'` (full text: required→
  optional column change; "Declare presence intent in source; prose cannot
  close this gate"; deliberately-optional evidence may state
  `invariant evidence always .photo = null or .photo != null`).
- No backfill: loosening is additive; existing non-null cells are untouched.
  New required columns / literal defaults / `down` do NOT apply.
- Rollback note: null media has no truthful old-domain value, so expect the
  default rollback to select a registered compatible view (current guards
  retained); `--exact` only after deliberate review
  (`guide deploy --sections 10,12`; `guide release-json` for
  `rowShape.matchesTarget`).

## 4. Exact v2 source-shape choices

Edit working `snapback/*.q` AND mirror into `versions/v2/` (frozen
`versions/v1` stays untouched):

```quarry
table installs:
  audit: file <=5000000 ('application/pdf', 'image/png', 'image/jpeg') ?   # was required
  immutable homeowner, coordinator, address, price, quotedAt, bedroomWindow  # audit REMOVED (else later add/replace/remove is impossible)
```

Presence intent (exact qualifier resolved from the first `check` gate
message; candidate):

```quarry
invariant evidence always installs.audit = null or installs.audit != null
```

`openInstall`: `audit` arg becomes optional (`audit: file ... ?`); insert
passes it through (null when omitted). Coordinator-only `require` unchanged.

New rule — one nullable-arg mutation (fallback: split into set + clear if
a null arg does not clear the cell; verify in dev acceptance):

```quarry
mutation setAudit(install: installs, audit: file <=5000000 ('application/pdf', 'image/png', 'image/jpeg') ?):
  i = installs[install] ! else NOT_FOUND
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  update installs[install] { audit }
  return null
```

Why this is sufficient: no other mutation writes `audit`
(`acceptQuote`/`advanceStage`/`recordInspection`/`approveWindow` untouched);
the table-level `update` rule stays as-is so homeowner accept and staff
writes keep working — the mutation `require` is the enforcement point.
Quote/stage/inspection/window logic: unchanged.

Frontend (`App.tsx`):

- `InstallCard`: add audit line — scan affordance when `audit != null`,
  else literal text `Energy audit to follow`. Extend its prop type with
  `audit: { id: string } | null`.
- `OpenInstallForm`: drop the `!auditId` submit gate, relabel upload
  "optional", pass `audit: auditId ? { id: auditId } : null`.
- Coordinator per-install add/replace/remove UI reusing `AuditUpload` +
  `api.setAudit` (and clear control).

## 5. Check / test / preview (exact commands)

```sh
npx snapback4 check
npx snapback4 test --source versions/v2
npx snapback4 deploy ./deploy --schema versions/v2 --check
npx snapback4 deploy ./deploy --schema versions/v2
npx snapback4 rollback ./deploy --to 1 --check    # 1 = saved v1 release id from releases --json
npx snapback4 rollback ./deploy --to 1
npx snapback4 rollback ./deploy --to latest --check
npx snapback4 rollback ./deploy --to latest
```

After each preview inspect `npx snapback4 releases ./deploy --json`
(`live.source/view/exact`, row shape, dormant counts); preview changes no
live state. Never prune/reset/delete storage.

## 6. Production scripts (pseudocode, `snapback4/proof` API)

Common shape (per `guide production --section 2`): `startServe("./deploy",
{ provisionUsers: { roles: { coordinator:2, homeowner:2, installer:2,
owner:2 }, provision: api.provision } })` — persistent roster at
`production/proof-accounts/default.json` (0600), reused across reruns
(login-first, provision unfinished only). `startStatic("dist")` for the
exported web UI. Readiness JSON on stdout only; `serveUntilSignal` for
held servers; stop every started host in `finally`; ports from env with
21110–21119 fallback; `executablePath: process.env.CHROME`.

- `prod:serve`: serve AS-IS (no deploy/mutate); ensure roster; print
  `{"backendUrl","users":{role:[{email,password},…]}}`; hold till SIGTERM.
- `prod:rollback` / `prod:forward`: `rollback("./deploy", 1)` /
  `rollback("./deploy", "latest")` (idempotent, either starting state),
  exit 0 when target live, stop everything, leave no server.
- `probe:serve`: ensure v2 live (forward if needed, never reset); export +
  serve web build; print `{"backendUrl","frontendUrl","sessions","apiNotes"}`.
- `client:calls` (v2): sign in `BACKEND_URL`+`CALLS_USERS` users; replay
  every UI op incl. open-without-audit + `setAudit` success and
  homeowner/installer `setAudit` → `ok:false, expected:"NOT_COORDINATOR"`.
- `harness:snapshot`: extend to `./deploy` release (today it reads only
  `staging`); `sql --release ./deploy --json-objects`, all `roles` +
  `installs` rows, stable IDs, no credentials. Update `backend-choice.json`
  `databaseFiles` to the production DB paths.
- `day2:proof` (re-runnable, unique names via `uniqueName`, full
  populations via `exhaustPages`, never delete/reset):
  `rollback→1` → ensure users → write v1 rows → `snapshotAll` (before) →
  `deploy v2` → assert id-complete preservation + scans intact →
  v2-feature works + rule holds (two users) → frozen `v1/` client vs v2
  (record) → `rollback→1` → assert all incl. v2-native rows → v1 client
  again → `rollback→latest` → assert → leave v2 live → write
  `day2-proof.json` (all fields incl. `migrationFiles`
  `["versions/v2/schema.q"]`, `v1ClientAfterChange`,
  `migrationPreservesV1Rows`; rollback fields real — this backend supplies
  release rollback).

## 7. Expected v1-client outcomes (to verify, not assume)

- v1 `openInstall` (with scan) vs v2 backend: should still send (additive
  loosening). v1 reads of null-audit rows: unknown until the frozen client
  runs — under a default view it may read `audit: null`; under `--exact`
  the row is dormant → `NOT_FOUND` guard. Record `works|degraded|broken`,
  never assert.

## 8. Unresolved limits

1. Exact `evidence always` scoping syntax (table-qualified or bare) — take
   from the first post-edit `check` gate message.
2. Null-arg clear vs split set/clear mutations — decided by dev acceptance.
3. Default-view vs `--exact` rollback selection — decided by `--check`
   previews + `releases --json`.
4. v1-client-on-null-audit behavior — observed via frozen `v1/` client.
5. Harness scoring mode (rollback vs frozen-client-only) — fill every
   `day2-proof.json` field either way.
6. `npm run check` red (`tsc` missing) until toolchain reinstall; `fixtures/`
   empty — `test --source versions/v2` needs may surface then.
7. No `.harness-env.json` at discovery time; load-if-present without printing.
