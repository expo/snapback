# DAY2-PLAN — Cacao Fermentary Lots, v1 → v2 (intake review priority)

Scope: reading/discovery only. No backend/UI sources changed, nothing deployed,
no proof scripts run. Baseline facts below were observed 2026-10-27 (UTC);
harness-time ports/env come from `$PORT_LO`/`$PORT_HI`/`$CHROME` at run time.

## 1. Baseline (observed, not assumed)

- App root holds a day-one Snapback 4 + React/Vite/TS app. `snapback/schema.q`
  (176 lines): tables `roles`, `lots`, `payments`; 18 ops; password identity;
  operator-provisioned roster; online-only tables. Roles: farmer, clerk (scale
  clerk), worker, head (head fermenter). `lots.status`:
  received→fermenting→drying→bagged→sold plus rejected; `lateFerment`/`oldStock`
  flags; `moldCount`/`rejectReason` on head-only `rejectLot`.
- `package.json` pins `snapback4@0.4.43` but `node_modules` holds **0.4.44**
  (`npm ls` reports invalid). `npm run check` schema-compile passes on 0.4.44;
  `tsc` is missing (`sh: 1: tsc: not found`) — install is incomplete.
- Missing, to be created on day two: `versions/`, `./deploy`,
  `.harness-env.json` (absent now; load if harness provides it, never print it).
  No `day2:proof` / `prod:*` scripts yet. `scripts/client-calls.mjs` (196 lines)
  is the v1 client to freeze; `scripts/probe-serve.mjs` prints the one-line
  `{backendUrl, frontendUrl, sessions, apiNotes}` contract.
- Change route per `init --adapt --day2` chooser: **"Add a required field
  computed from old values"** → `guide deploy` sections *Migrations and
  adoption* + *Which migration shape survives edits and rollback?*, plus
  `guide api proof` for proof scaffolding. No other guide needed up front.

## 2. Step 0 — pin the backend, green the baseline

```sh
npm install snapback4@0.4.43 --save-exact   # first install may sit silent minutes on local mirror; wait
npm ls snapback4                             # must read 0.4.43, no "invalid"
npm run check                                # schema compile + tsc; exit 0
npm run acceptance && npm run acceptance     # twice in a row, dev backend
npm run frontend:proof                       # twice in a row (harness deletes dist first)
```

Record each upgrade break in `friction.jsonl`. `package.json` already declares
`0.4.43`; confirm rather than skip.

## 3. Step 1 — save v1 before any edit

```sh
npx snapback4 init --adapt --day2 --apply
npx snapback4 deploy ./deploy --save-version versions/v1
npx snapback4 releases ./deploy --json   # note numeric v1 release id, e.g. 1
```

`init --adapt` saves current sources/fixtures to `versions/v1`, `versions/v2`
(if absent) and a frozen `v1/` client with its own ESM package + generated API;
existing snapshots/proofs stay untouched. Keep `versions/v1` and `v1/` frozen
after this. Do the save **before** the v2 edit; a later snapshot is not history.

## 4. Step 2 — v2 source shape (the only schema edit)

New column on `lots` (additive; keep every existing column, name, type, rule):

```quarry
priority: enum('standard', 'needs attention') default 'standard'
  write <- exists roles[viewer, role = 'head']
```

Why this shape:

- `default 'standard'` lets old-shaped v1 inserts (`logLot` without priority)
  keep working and gives new rows the spec'd starting value.
- Column write audience (`guide rules` §14 + `rule-recipes` §25 pattern) is the
  enforcement of "only the head may change a saved lot's priority": clerk,
  worker, farmer and head all keep the row-level `update` rule for their
  lifecycle columns, but only a head principal passes the `priority` column
  grant. Null creation / equal-value updates need no grant (recipe semantics),
  so ordinary lifecycle mutations that don't touch `priority` are unaffected.
- Backfill (named, retained while its meaning holds; inputs read the pre-patch
  snapshot; from the deploy §13–14 + persistent-production example):

```quarry
backfill lots priority(lateFerment: bool):
  {priority: 'needs attention' if lateFerment else 'standard'}
```

No `renamed from`, no `down`: this is a new additive column, not a spelling
move; rollback §10 says added columns are ignored by the old release with cells
dormant, and forward restores them. Preview must confirm no `down` is demanded;
if preview names a reverse-projection risk, add a truthful `down` then, not now.

Mutations:

- `logLot`: add `priority: 'standard'` to the inserted row (explicit, matches
  default; keeps intent visible). Guards unchanged (clerk/head + farmer check).
- New `setIntakePriority(lot: lots, priority: enum('standard','needs attention'))`:
  `require exists roles[viewer, role = 'head'] else NOT_HEAD`; load row with
  `! else NOT_FOUND`; `update lots[lot] { priority }`. Head-only by both the
  mutation guard and the column write rule (defence in depth).
- `startFerment`, `startDrying`, `bagLot`, `markSold`, `rejectLot`,
  `recordPayment`: unchanged; none writes `priority`.
- `sweepFlags` job: unchanged (it sets `lateFerment`/`oldStock`, never priority;
  a row flagged late after v2 keeps its existing priority until the head raises
  it — spec only migrates pre-v2 rows).
- Invariants: add `lots.setIntakePriority only exists roles[viewer, role='head']`
  (spec sentence, same style as existing invariants). Keep all existing
  invariants byte-identical.

Queries: `myLots`, `lotDetail`, `yardBoard`, `flaggedBoard`, `oldStockBoard`,
`farmerList`, `lotPayments` unchanged — rows now carry `priority` in their
shape automatically. No new query required (optionally a staff
`needsAttentionBoard` filtered query; only if preview/acceptance stays green —
otherwise skip, filtered client-side read of `yardBoard` suffices).

Frontend (`src/App.tsx`, `src/client.ts`): show `priority` on yard rows and the
farmer lot list; add a head-only "raise to needs attention" control calling the
new mutation (hide for clerk/worker/farmer; backend still refuses). Clerk log
form unchanged. v2 `scripts/client-calls.mjs`: same calls + `setIntakePriority`
ok-as-head and expected-refusal-as-clerk/farmer lines, same one-line-per-op
contract, carry on after failure.

## 5. Step 3 — preview (reads no live state; rerun after every schema edit)

```sh
npx snapback4 check
npx snapback4 test --source versions/v2
npx snapback4 deploy ./deploy --schema versions/v2 --check
npx snapback4 rollback ./deploy --to 1 --check            # default (view) path
npx snapback4 rollback ./deploy --to 1 --check --bridge ./bridge-check  # only if preview names it
```

Decision tree: green deploy-preview + green default-rollback-preview → proceed,
no `--exact`, no `--restore-dormant` unless the preview names them. If preview
demands a bridge/`--restore-dormant`/truthful `down`, follow its concrete
instruction and preview again. Inspect `releases --json` for live source/view
and row shape; a green rollback alone does not prove frozen-v1 result shape —
that is proved by running the frozen v1 client (next section). Never
prune/reset/delete storage to get green. Expect `check` advisories
(`N_ARGUMENT_GRANT`, lifecycle notes as on day one) — informational only.

## 6. Step 4 — production v1, then v2 over it

```sh
npx snapback4 deploy ./deploy                                   # v1 live (first time)
npx snapback4 serve ./deploy &  # via script-owned startServe on $PORT_LO..$PORT_HI; record PID, stop own PID only
```

- Serve with `npx snapback4 serve` (never dev server), frontend `vite build` +
  `web-shell`, pointed at the production URL.
- Real password sign-up/sign-in only (no identity switch/persona/seeding
  shortcut). Seed test accounts privately; public seeding must not relax rules.
- Reusable roster: `production/proof-accounts/default.json` (0600) via
  `provisionAccounts({roles:{farmer:2, clerk:2, worker:2, head:2}, provision: api.provision})`;
  reruns log into the same accounts, provisioning unfinished entries only.
- As real users write v1 business data: clerk logs lots (with certificate
  image placed via mutation args), worker moves received→fermenting→drying→
  bagged, clerk marks sold / records payments, head rejects one lot with mold
  count + reason, clock advances put one lot `lateFerment=true` and one
  `oldStock=true`. Then: `npx snapback4 deploy ./deploy --schema versions/v2`
  (plus any preview-mandated flags) and assert over the **whole** population:
  every pre-v2 row present with identical old cells; `priority` ==
  `'needs attention'` iff pre-v2 `lateFerment` else `'standard'`; head
  `setIntakePriority` succeeds; clerk + farmer attempts refuse (record code);
  frozen v1 client result recorded (works/degraded/broken, never asserted).

## 7. Rollback / forward and the frozen v1 client

```sh
BACKEND_URL=<prod-url> CALLS_USERS=<sessions-json> npm --prefix v1 run client:calls  # frozen runner
npx snapback4 rollback ./deploy --to 1 --check
npx snapback4 rollback ./deploy --to 1
# v1 client again; assert full-population preservation incl. v2-written rows
npx snapback4 rollback ./deploy --to latest --check
npx snapback4 rollback ./deploy --to latest
# v1 client again; assert full-population preservation
```

Expectations (rollback §7/§10): default rollback keeps a registered compatible
view with current guards (v1 client reads keep working where the backend
allows; absent new op → HTTP 404 `E_OP`; guarded `! else` reads → their codes).
`--exact` is deliberate-only (restores broader v1 reads, hides new cells) and
is **not** the harness path — default rollback is. Data (incl. v2-native rows
and v2 priority edits) must survive both moves as dormant-or-visible cells;
`prune` is never used.

## 8. Scripts to author (package.json entries)

- `day2:proof` — re-runnable end-to-end (pseudocode below); leaves **v2 live**;
  writes `day2-proof.json` with the exact harness schema
  (`ok`, `recordsBeforeV2`, `recordsCheckedAfterV2`, `dataPreservedAfterV2`,
  `migratedValuesCorrect`, `v2FeatureWorks`, `v2RuleEnforced`, `rollback`,
  `dataPreservedAfterRollback`, `rollforward`, `dataPreservedAfterRollforward`,
  `v1ClientAfterV2`, `v1ClientAfterRollback`, `migrationFiles`,
  `v1ClientAfterChange`, `migrationPreservesV1Rows`, `v1ClientNotes`, `notes`).
  `migrationFiles`: `["versions/v2/schema.q"]` (+ app file only if it held an
  inline migration — it won't).
- `prod:serve` — serve production **as-is** (no deploy/change) on assigned
  ports; print exactly one stdout JSON line
  `{"backendUrl","users":{"farmer":[..],"clerk":[..],"worker":[..],"head":[..]}}`
  (≥2 real users/role with email+password); stderr/file for the rest; stay up
  to SIGTERM; start/stop only what it started.
- `prod:rollback` / `prod:forward` — activate saved v1 / v2 over whatever
  production holds (no delete/reset/recreate), exit 0 when live, repeatable
  from either state, stop everything started, leave no server.
- `client:calls` (v2) — `BACKEND_URL`+`CALLS_USERS` in, one JSON line per call,
  incl. v2 feature + expected refusals; exit 0 iff all succeed-or-match.
- `probe:serve` (v2 production) — one JSON line
  `{backendUrl, frontendUrl, sessions, apiNotes}`, ≥2 users/role with sign-in
  details, stays up to SIGTERM.
- `harness:snapshot` — self-contained read-only `{"tables":{"roles","lots",
  "payments"}}` with stable ids, no auth/session bookkeeping or credentials.

```js
// day2:proof pseudocode (production; never delete/reset/recreate store or deployment)
hosts = []
try {
  v1id = releases('./deploy --json').ordinaryV1
  host = startServe('./deploy'); hosts.push(host)          // whatever is live
  users = provisionAccounts(host, {farmer:2, clerk:2, worker:2, head:2}) // reuse roster; freshUser only for isolated extras
  writeV1data(users)                                       // uniqueName() rows; lateFerment + oldStock via clock advance
  snapBefore = snapshotAll('lots'|'payments' via sql/data --release ./deploy, exhaustPages over full population)
  out = deploy('./deploy --schema versions/v2' + preview-mandated flags)
  snapAfter = snapshotAll(...); assert same ids, same old cells
  assert priority == (lateFerment ? 'needs attention' : 'standard') on every pre-v2 lot
  head.setIntakePriority(ok); clerk.setIntakePriority(expect NOT_HEAD/E_RULE); farmer.setIntakePriority(expect refusal)
  v1onV2 = runFrozenV1Client(BACKEND_URL=host.url); record, do not assert
  rollback('./deploy --to v1id'); assert full population incl. v2 rows preserved; v1client again; record
  rollback('./deploy --to latest'); assert full population; v2 reads show restored priorities
  write day2-proof.json (counts over touched kinds; degraded = some v1 calls work, some fail)
  exit 0 iff all assertions held (v1-client outcomes recorded, not asserted)
} finally { stop hosts; assert v2 live (re-serve/forward if a step left v1 live) }
```

Rerun rules: fresh `uniqueName()` rows per run; checks always over the full
population (never first page); second run starts from v2-with-everyone's-data.

## 9. Unresolved limits (stated, not hidden)

1. Column write-audience syntax (`write <- exists roles[viewer, role='head']`
   on an enum column) is inferred from `guide rules` §14 + recipe §25, which
   demo equality probes (`.desk = viewer`), not `exists`-probes on columns —
   `check` is the arbiter; fallback is mutation-guard-only enforcement.
2. Whether deploy preview demands a `down`/bridge/`--restore-dormant` for the
   new enum column is unknown until `deploy --check` runs against real v1 rows.
3. Exact v1-client shape after v2/rollback (works vs degraded) is a measured
   outcome of the frozen-client replays, not predictable from docs; plan
   records, never asserts, it.
4. Harness-time `$PORT_LO/$PORT_HI`, `$CHROME`, and `.harness-env.json` were
   absent in this shell; scripts must read env at run time and bind-first on
   21210–21219. No other builders' dirs, `~/projects`, or session logs were
   inspected (out of scope).
5. `tsc` missing from `node_modules` — full `npm run check` greenness depends
   on a completed `npm install` under the local mirror.
