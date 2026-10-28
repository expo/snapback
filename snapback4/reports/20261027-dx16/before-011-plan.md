# DAY2-PLAN.md — Heat Pump Installs, v2 (reading/discovery; no implementation done)

Scope of this session: plan only. No backend/UI source changed, no deploy,
no users provisioned, no proof scripts run, no installs/builds.
Baseline inspected: `snapback/schema.q` (141 lines), `App.tsx` (309 lines),
`scripts/{acceptance,client-calls,probe-serve,harness-snapshot}.mjs`, CLI
handover below, guides `deploy` (full), `evolution`, `rename`, `staging`
(full), `assets` §§Files/Placement-replay, `changes` 0.4.43/0.4.44 entries.

## 1. Baseline facts (verified this session)

- `package.json` already pins `snapback4@0.4.43` + `snapback4-expo@0.4.43`
  (exact, no caret). Upgrade step = confirm + move on; still run
  `npm install` (local mirror, first run slow/stays silent) in the build
  phase because `node_modules/.bin/` currently holds only `snapback4`
  (`tsc` missing → `npm run check` fails today at `typecheck`, backend
  `npx snapback4 check` alone is green: "check: ok — 2 tables, 12
  operations, 0 gates pending, 1 witnessed N_ARGUMENT_GRANT question").
- CLI handover (preview only, nothing written):
  `npx snapback4 init --adapt --day2` plans: rewrite `.gitignore`; add
  `versions/v1/{schema.q,fixtures/.gitkeep}` + `versions/v2/...` (captures
  of current sources); add `scripts/staging.mjs`, `scripts/day2-proof.mjs`;
  extend `package.json` (`day2:proof: node scripts/day2-proof.mjs
  versions/v1 versions/v2`, `snapback4.starter.day2: false→true`).
  Apply command it prints: `snapback4 init --adapt --day2 --apply`.
  It leaves `App.tsx`, `src/client.ts`, `README.md` untouched.
- No `./deploy` exists yet (`releases ./deploy` → "no current release").
  No `.harness-env.json` at root (only `.harness/` metadata). `$PORT_LO`,
  `$PORT_HI`, `$CHROME`, `$TMPDIR` are empty in this shell; scripts must
  read them with fallback to 21110–21119 and fail loud if `$CHROME` is
  unset at proof time (previous scripts already do).
- Current v1 shape (the change route hinges on this):
  `installs.audit: file <=5000000 (pdf/png/jpeg)` REQUIRED;
  `immutable ... audit ...`; `update <- .homeowner = viewer or exists
  roles[viewer]`; `openInstall(... audit: file ..., ...)` coordinator-only;
  no other mutation writes `audit`. UI: `OpenInstallForm` requires an
  upload before submit; `InstallCard` never renders the audit (no audit
  text anywhere) — so v2 must ADD the audit line to the card.

## 2. V1 production (first)

1. `npx snapback4 init --adapt --day2 --apply` (then `npm install`,
   `npm run check`, `npm run acceptance` green twice).
2. `cp -r snapback v1-snapback` (saved v1 backend copy; `v1/` also fine —
   keep OUTSIDE `snapback/`, and keep generated client for frozen replay).
3. `npx snapback4 deploy ./deploy --save-version versions/v1`
   (captures immutable release id + `versions/v1/generated/api.ts`).
4. Serve production: `npx snapback4 serve ./deploy --port <PORT_LO-HI>`
   (stdout first line = URL; wait for `SNAPBACK4_READY` on stderr).
   Use `snapback4/proof` `startServe("deploy", …)` in scripts, never a
   hand-rolled driver; `stop()` in `finally`; `serve-check` for validation.
5. Roster: `host.provisionAccounts({roles:{coordinator:2,homeowner:2,
   installer:2,owner:2}, provision: api.provision})` — persistent roster
   under `./deploy/proof-accounts/` (default roster name); reruns REUSE,
   never re-mint. NEVER `seedAccounts`/`--staging` on this store
   (E_STAGING; production refuses bulk setup). First bootstrap via the
   local operator token (`host.operatorToken()` → `/m/provision`).
6. Write v1 business rows through app ops as those users (coordinator
   `openInstall` WITH audit via `client.upload(bytes,{file:{name,type}})`,
   homeowner `acceptQuote`, installer `advanceStage`, `recordInspection`,
   owner `approveWindow`). Unique `tag = randomUUID()` per run in
   address/body so reruns never collide.

## 3. V2 source-shape choice (additive widening, no backfill)

Required→optional file is additive (`guide evolution`: "new optional
columns adopt without ceremony"; extraction recipe: required asset may
widen to optional). No `backfill`, no `down`, no table rename. Exact
Quarry delta in `snapback/schema.q`:

```quarry
table installs:
  ...
  audit: file <=5000000 ('application/pdf','image/png','image/jpeg') ?
  ...
  immutable homeowner, coordinator, address, price, quotedAt, bedroomWindow
  # ^-- audit REMOVED from immutable so the coordinator can add/replace/remove

mutation openInstall(homeowner: principal, address: text 5..200,
    audit: file <=5000000 ('application/pdf','image/png','image/jpeg') ?,
    price: int 1..100000000, bedroomWindow: bool):
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  return insert installs { homeowner, coordinator: viewer, address, audit,
    price, quotedAt: now, stage: 'survey', status: 'quoted',
    bedroomWindow, windowApproved: false }

# the ONLY writer of audit after create; table update rule already admits
# coordinators, and no other mutation touches audit, so homeowners/
# installers/owners have no path to it (client has no generic update op)
mutation setAuditScan(install: installs,
    audit: file <=5000000 ('application/pdf','image/png','image/jpeg') ?):
  i = installs[install] ! else NOT_FOUND
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  update installs[install] { audit }
  return null

invariant installs.setAuditScan only exists roles[viewer, role = 'coordinator']
```

- Keep op/arg names (`openInstall.audit` stays, now optional) → frozen v1
  `openInstall`-with-audit calls still validate on v2 (expand, not
  contract). No arg alias needed. Do NOT add `audit write <- …` column
  authority unless `check --review` demands it (0.4.40 column-write gates
  add security questions; mutation-gate matches existing style).
- `check` preview risks: a loosening note on dropping `audit` from
  immutable; possibly a new witnessed question on the coordinator-only
  setter. Resolve via `check --review` + ack with spec rationale (same
  flow as the v1 N_ARGUMENT_GRANT ack).
- Frontend (`App.tsx`): `OpenInstallForm` — audit optional (label
  "optional", submit without `auditId` sends `audit: null`); `InstallCard`
  — add `audit` to row type + render `{audit ? <download/save button> :
  'Energy audit to follow'}` on EVERY card (homeowner list + board);
  coordinator-only `AuditUpload` + `setAuditScan` edit control on board
  rows (reuse `client.upload` + `saveAsset`/`useSaveAsset` patterns).
  Regenerate client via `npx snapback4 check` (writes
  `snapback/generated/api.ts`).

## 4. V2 deploy + previews (exact commands)

```sh
npx snapback4 deploy ./deploy --schema versions/v2 --check --restore-dormant --verbose  # read-only preview; store untouched
npx snapback4 deploy ./deploy --schema versions/v2 --save-version versions/v2           # or deploy working tree after check
npx snapback4 rollback ./deploy --to 1 --check        # default-view rollback preview (expect: keeps current guards)
npx snapback4 rollback ./deploy --to 1 --check --exact # original-source preview (expect: null-audit rows named dormant)
npx snapback4 rollback ./deploy --to 1 --check --bridge ./bridge  # ONLY if exact preview demands repair source
```

- Forward adoption of old rows: trivially green (all v1 audits non-null
  fit optional). Assert full-population snapshot equality.
- Rollback semantics (from `guide deploy`): default `--to 1` selects the
  registered compiled view retaining current guards → null-audit v2 rows
  stay visible (nullable old results = client compat change; old UI must
  render them as pending, never zero — v1 UI ignores audit entirely, so
  safe). `--exact` original source CANNOT hold null audits → those rows go
  dormant (point reads null / guard code; counts exclude them; compatible
  forward restores exact values). day2-proof + stage scripts use DEFAULT
  rollback (dormant-free); `--exact` is preview/record-only. If default
  preview instead names hidden rows, generate the bridge, deploy it as a
  new release with `--restore-dormant`, repair, re-preview — do not force
  `--exact` live.

## 5. Frozen v1 client after the change (expected: works)

- V1 `client:calls` (frozen copy) sends: `openInstall` WITH audit (valid
  on v2 — optional accepts provided values), `acceptQuote`,
  `advanceStage`, `recordInspection`, `approveWindow`, `board/myInstalls/
  installDetail` reads. All op names/args retained → expect `works`.
  Only risk: v2 rows with `audit: null` decoded by the v1 generated type
  (non-null file). Mitigation: v1 UI never renders `audit`, but the typed
  client may still decode the cell — verify by replaying frozen
  `client:calls` against v2 with a null-audit row present; if it breaks,
  record `degraded` + exact op/field in `v1ClientNotes` (do not hide it),
  keep the widening (no truthful scalar `down` can manufacture file
  bytes). `rowShape.matchesTarget` in release JSON is the second check.
- `day2-proof.json`: `migrationFiles: ["versions/v2/schema.q"]` (+ app
  file if an inline migration is added — none planned), `migrationPreservesV1Rows: true`
  with row-preservation assertions = full-population id-keyed snapshot
  compare (`sql --release ./deploy --json-objects` over installs+roles,
  `exhaustPages` on `board`/`myInstalls`, not first page).

## 6. Proof pseudocode (compact; starter `day2-proof.mjs` + hooks)

```
deployDir = ./deploy; serve = startServe(deployDir)  # never deploy/reset inside proof except the named moves
users = provisionAccounts(reuse roster; create iff missing)  # 2 per role, login for fresh sessions
tag = unique per run
PHASE v1-live: rollback(deployDir, 1)            # idempotent from either state
  write v1 rows (openInstall WITH audit) as coordinator; snapshot ALL rows -> S1
PHASE v2: deploy(deployDir, versions/v2)
  assert snapshot == S1 + new (ids stable; every pre-row keeps scan, price, all fields)
  v2 feature: openInstall WITHOUT audit -> card shows 'Energy audit to follow';
    setAuditScan attaches scan (visible); replace; remove (back to placeholder)
  v2 rule: setAuditScan as homeowner AND installer -> refused NOT_COORDINATOR (exit-0 expected-refusal lines)
  replay FROZEN v1 client:calls -> record v1ClientAfterV2 (works|degraded|broken), no assert
PHASE rollback: rollback(deployDir, 1)  # default view
  assert full snapshot == pre-rollback incl. v2-native rows (null-audit rows visible via view)
  replay frozen v1 client -> record v1ClientAfterRollback
PHASE forward: rollback(deployDir, latest)
  assert full snapshot preserved; null-audit rows back with exact values; privacy/rules intact
write day2-proof.json (all fields incl. counts, migrationFiles, v1ClientNotes, notes); stop(); leave v2 live; exit 0 iff all asserts held
```

- Stage scripts: `prod:serve` = serve as-is (no deploy/mutate), print ONE
  stdout JSON line `{backendUrl, users:{coordinator:[{email,password,
  principal}...], homeowner:..., installer:..., owner:...}}`, serve until
  SIGTERM; `prod:rollback` = `rollback ./deploy --to 1`, exit 0 when v1
  live, from either state, stops what it starts; `prod:forward` =
  `rollback ./deploy --to latest` (== v2), same contract. All three stop
  everything they start except `prod:serve`'s held server; production data
  and deployment never deleted/reset/recreated.
- `probe:serve` (v2): same one-line shape as v1
  `{backendUrl, frontendUrl, sessions, apiNotes}` but production-backed:
  ensure v2 live (no reset), `provisionAccounts`-reuse 2 users/role,
  `expo export -p web` with production URL baked + `?api=` override,
  serve build + backend on 21110–21119. `client:calls` (v2): BACKEND_URL +
  CALLS_USERS only, per-role calls incl. openInstall-without-audit +
  setAuditScan + expected NOT_COORDINATOR refusals, one line per call,
  continue-after-failure, exit 0 on match.
- `harness:snapshot`: extend current script to dump `./deploy` store
  (`sql --release ./deploy --json-objects`, tables roles+installs,
  stable ids, named fields, no credentials/sessions); keep staging path
  working. `backend-choice.json`: keep stack text, add `databaseFiles:
  ["deploy/store.sqlite"]` (staging/proof stores excluded).
- Time rules stay real-clock in production (21-day accept, 30-day flag
  derived in UI); dev acceptance uses `advance(22d,{drain:false})`+`drain()`
  as in v1 — no production clock advances (refused).

## 7. Unresolved limits (stated, not solved here)

1. `node_modules/.bin` lacks `tsc` (only `snapback4`); `npm run check`
   and any expo/playwright path unverified — build phase needs
   `npm install` via local mirror first (forbidden in this reading phase).
2. New `check --review` gates on optional-audit + `setAuditScan` unknown
   until the schema is actually compiled against a store.
3. Default-vs-`--exact` rollback behavior for null-audit rows is predicted
   from docs, not previewed (no store exists yet); `--check` previews in
   §4 are the decision gate, bridge only if they demand it.
4. Port env (`PORT_LO/HI`), `$CHROME`, `$TMPDIR` empty in this shell —
   assumed provided at harness/proof runtime; scripts must not hard-code.
5. `deploy --save-version versions/v1` requires green check+cases first;
   exact save contents (fixtures marker, generated api) taken from guide,
   not observed.
