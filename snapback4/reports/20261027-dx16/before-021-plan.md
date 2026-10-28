# DAY2-PLAN — Cacao Fermentary Lots, v1 → v2 (intake review priority)

Scope: reading/discovery only. No source, deploy, or data change was made in this session.
Handover preview used: `npx snapback4 init --adapt --day2` (preview only, no `--apply`).
Docs path followed: `guide tasks` → `guide deploy` (esp. "Persistent production",
"Keep v1 clients working", "Which migration shape", "What the old release sees",
"Capture a saved version", "Rollback after widening"), `guide evolution`
("Release rollback and hot activation"), `guide production` ("Serve script and
reusable accounts", "Real-account and rollback acceptance"), `guide release-json`
("Clients across rollback"). `npm run check` equivalent (`npx snapback4 check`)
was run once: green (3 tables, 18 ops, 1 non-blocking witnessed question).

## 0. Mode decision (drives the whole proof)

Snapback 4 supplies release rollback (`deploy` / `rollback --to N|latest`,
dormant storage, forward restore — verified in its own docs above). So this lane
is in **rollback mode**, not frozen-v1-client mode: `day2-proof.json` uses real
`rollback: ok|failed` / `rollforward` fields (not null), plus the v1-client
recording fields (`v1ClientAfterV2`, `v1ClientAfterRollback`,
`v1ClientAfterChange`, `migrationPreservesV1Rows`, `migrationFiles`,
`v1ClientNotes`). The harness replays its own frozen day-one `client:calls`
against production with v2 live, after rollback, etc.; our `day2-proof.json`
records what happened (assert everything except the works/degraded/broken
labels).

## 1. Upgrade / baseline (exact commands)

```sh
node -e "console.log(require('./node_modules/snapback4/package.json').version)"
npx snapback4 --version
npm install snapback4@0.4.43 --save-exact   # package.json already says 0.4.43; see skew note
node -e "console.log(require('./node_modules/snapback4/package.json').version)"
npx snapback4 --version                     # both must read 0.4.43
npm run check          # snapback4 check + tsc; must exit 0
npm run acceptance     # twice in a row
npm run frontend:proof # twice in a row (rebuilds dist each run)
```

Skew found during reading: `package.json`/`package-lock.json` pin `0.4.43`,
but the installed binary reports `0.4.44` (`node -e` → `0.4.44`,
`npx snapback4 --version` → `0.4.44`, `check` stderr advertises 0.4.44
behaviors). So step 1 is a real downgrade/re-pin, then re-verify. Record each
break it causes in `friction.jsonl` (area `upgrade`/`install`).

## 2. v1 production + saved v1 (exact commands)

```sh
npx snapback4 deploy ./deploy --save-version versions/v1
npx snapback4 serve ./deploy --port 21210   # production server, Bearer only, no dev doors
```

`--save-version versions/v1` captures `versions/v1/schema.q` (+ any other `.q`
modules under original names), `versions/v1/fixtures/`, regenerated
`versions/v1/generated/api.ts`, and `versions/v1/release.json` (immutable
release id, source hash, CLI version). Keep the working tree as the v1 source
until v2 is written. Production layout: `releases/N/` source, `store.sqlite`
data/sessions/queues, `assets/`, `current` convenience copy. Never
`--staging` for `./deploy`; never delete/reset the store to make adoption pass.
Apply the adapt scaffold separately (its preview lists exactly this):
`npx snapback4 init --adapt --day2 --apply` → creates `versions/v1, versions/v2`
placeholders, `scripts/day2-proof.mjs`, `snapback4.starter.day2: true`. Authored
files (`src/App.tsx`, `src/client.ts`, `README.md`) are left untouched by adapt.

## 3. v2 source-shape choice (additive column + backfill + head-only mutation)

No rename, no extract, no table change. One additive nullable-free enum column
with a declarative backfill, one new mutation, zero changed operations:

```quarry
table lots:
  ...
  priority: enum('standard', 'needs attention') default 'standard'
  ...

backfill lots priority(lateFerment: bool):
  {priority: 'needs attention' if lateFerment else 'standard'}

mutation setPriority(lot: lots, priority: enum('standard', 'needs attention')):
  require exists roles[viewer, role = 'head'] else NOT_HEAD
  l = lots[lot] ! else NOT_FOUND
  update lots[lot] {priority}
```

Rules that make this the right shape (from `guide deploy`):

- "Required new fields need a literal default or a declarative `backfill`."
  History must be computed from `lateFerment` (late → `needs attention`, else
  `standard`), so a `backfill` is required; a literal default alone would lie
  about history. `default 'standard'` still covers new rows.
- "Which migration shape" checklist: no spelling change → no `renamed from`;
  no old representation needed beyond the same enum → no `down` block; no
  media/list move → no `extract`. Keep the declaration across later releases.
- Write-path confinement: all writes go through declared mutations (no generic
  row update). `logLot` inserts with explicit `priority: 'standard'`; lifecycle
  mutations (`startFerment`, `startDrying`, `bagLot`, `markSold`, `rejectLot`)
  name only their own fields, so they can never write `priority`. Only
  `setPriority` writes it, guarded `NOT_HEAD` — clerk/farmer/worker refusals
  are enforced server-side. No table-level rule change needed.
- Reads: `priority` rides on existing row results (`myLots`, `lotDetail`,
  `yardBoard`, …); no new query strictly required. Add
  `snapback/client-compatibility.json` = `{"baseline":"versions/v1","since_release":2}`
  so `check`/`dev` emit the added field as optional ("Since release 2") and warn
  on real old-client breaks. UI fallback: `row.priority ?? "standard"`.
- `logLot` keeps certificate/price behavior byte-identical; payments, rejection
  approvals, and yard stages untouched.

Previews before activation (all read-only):

```sh
npx snapback4 deploy ./deploy --schema versions/v2 --check --restore-dormant --verbose
npx snapback4 check --store ./deploy/store.sqlite --release 1
npx snapback4 rollback ./deploy --to 1 --check            # default view selection
npx snapback4 rollback ./deploy --to 1 --check --bridge ./bridge  # only if preview demands it
npx snapback4 deploy ./deploy --schema ./bridge --restore-dormant --check  # only if bridged
```

Activate: `npx snapback4 deploy ./deploy --save-version versions/v2`
(`--restore-dormant` on the activating command if names are reused; rollback
selection already implies restoration). Serve stays running — hot adoption,
no restart. Receipt must show the backfill count (`lots.priority ← … on N rows`).

## 4. Rollback / forward predictions (to verify live, not assumed)

- Additive enum column + additive mutation is the compatible-widening case:
  default rollback keeps v2-native rows visible through the registered view
  (current guards retained); `--exact` would restore original v1 reads and hide
  the new column/operation. Plan: use default `rollback ./deploy --to 1` in
  proofs; exercise `--exact` once deliberately (as the packed recipe does) and
  record the difference, never as the proof path.
- Expected frozen-v1-client behavior (record, don't assert): all 36 day-one
  calls keep working with v2 live and after rollback (added field ignored by
  the old release; its cells stay dormant); the new `setPriority` answers
  `E_OP` on v1; reads simply omit `priority`. If the live replay differs
  (e.g. a result-shape strictness), record `degraded`/`broken` with the exact
  failing call — that is the comparison data, not a failure to hide.
- Forward: `npx snapback4 rollback ./deploy --to latest` (== forward to v2);
  dormant cells restore exactly, including v2-native `needs attention` rows and
  v1-era edits made while rolled back (backfill inputs recompute with
  agreement; conflicts refuse rather than silently merge).

## 5. Production proof pseudocode (scripts to write, not written)

Shared helpers (all scripts): ports from `portRange()` (`snapback4/proof`,
`scripts/launch.mjs` pattern; fallback `21210` backend / `21211` frontend —
never hard-code; this shell had `PORT_LO/HI` empty, so fallback matters);
Chromium via `process.env.CHROME` + `--no-sandbox`; every server started via
`startServe`/`startStatic` with its handle + PID recorded and stopped in
`finally`; SIGTERM-held serving via `serveUntilSignal`; logs to files/stderr,
never the JSON stdout line.

`scripts/prod-serve.mjs` (`npm run prod:serve`): serve `./deploy` **as-is**
(no deploy/mutate); ensure ≥2 users × {farmer, clerk, worker, head} via real
`/auth/signup` (+ operator `provision`), reusing `production/proof-accounts/default.json`
roster (0600, `plan`/`entries`/`done` flags; `roster:"name"` only for a
deliberate new batch); print exactly one stdout JSON line
`{backendUrl, users: {role: [{email, password, …}], …}}`; hold until SIGTERM.

`scripts/prod-rollback.mjs` / `scripts/prod-forward.mjs`: `rollback ./deploy
--to 1` resp. `rollback ./deploy --to latest` over whatever production holds
(including v2-native rows); no delete/reset/recreate of data or deployment;
idempotent from either state; exit 0 when the target release is current; stop
everything started; no server left running.

`scripts/day2-proof.mjs` (`node scripts/day2-proof.mjs versions/v1 versions/v2`,
wired as `npm run day2:proof`): never deletes/resets/recreates production or
its deployment; starts from whatever production holds; puts v1 live; signs in
real users (create-if-missing with fresh unique names per run —
`Date.now().toString(36)` + random, cf. `client-calls.mjs` `uniq`); writes v1
data through app operations (cover `lateFerment=true` and `false` lots so the
backfill has both cases); full-table snapshot via admin `sql`/`data --release`
paginated over **all** rows (counts, not first page); deploys v2; asserts every
pre-existing record survived with `priority = needs-attention iff lateFerment`
+ all other cells identical; asserts v2 feature (head `setPriority` ok, new
lots default `standard`) and v2 rule (`NOT_HEAD` for clerk/farmer/worker);
replays the saved v1 client vs v2 and records the label; rolls back to v1 and
asserts full preservation including v2-written rows; replays v1 client again;
forwards to latest and asserts again; leaves **v2 live**; overwrites
`day2-proof.json` (schema from the brief, `migrationFiles:
["versions/v2/schema.q", "snapback/client-compatibility.json"]` or the actual
list, `v1ClientAfterChange` filled, `notes` explaining the labels). Exit 0 only
if every assertion held. Re-runnable: harness runs it twice; production only
grows between runs.

`scripts/probe-serve.mjs` (existing, retargeted): ensure v2 live in `./deploy`
**without resetting data**, rebuild frontend with `VITE_SNAPBACK_URL=<prod
backend>`, serve both, ≥2 real users × 4 roles with `{email, password,
principal, token, headers}`, one JSON stdout line
`{backendUrl, frontendUrl, sessions, apiNotes}`, hold until SIGTERM.

`client:calls` (v2): same `BACKEND_URL`/`CALLS_USERS` contract, plus v2 calls
(head `setPriority` success, clerk/farmer `setPriority` → `expected NOT_HEAD`,
`priority` visible on reads); one JSON line per call; carry on after failures;
exit 0 only if every line is ok-or-expected-refusal (compatibility matches
`CODE` + `expected` count as ok).

`harness:snapshot`: extend `TABLES` output to the exact v2 app columns
(including `lots.priority`), still `{tables: {roles, lots, payments}}`, no
credentials/sessions; `backend-choice.json`: add the production database file
(`deploy/store.sqlite`, relative; keep `.snapback4/store.sqlite`; exclude
throwaway proof DBs).
`acceptance.mjs` additions: backfill both branches, new-row default, head-only
`setPriority` + three refusal roles, time-rule interplay unchanged (clock
advances, no real waiting). Frontend: priority badge on yard + farmer rows,
head-only raise/lower control gated on `api.setPriority.available(release)`
with `?? "standard"` fallback, success text disjoint from row text
(strict-mode lesson from day one).

## 6. Unresolved limits (stated, not hidden)

1. Default-vs-`--exact` rollback selection for this exact additive-enum schema
   is a live-preview outcome (`rollback --to 1 --check` output); the plan
   assumes the default registered view, with `--exact` as a deliberate exercise.
2. The true frozen-v1-client label (works/degraded/broken) can only come from
   replaying the harness's frozen copy against the live backend, not from docs.
3. Installed-binary skew (`0.4.44` binary vs pinned `0.4.43` package) — cause
   unknown from reading alone; the re-pin step must be executed and observed.
4. `PORT_LO`/`PORT_HI`, `CHROME`, `TMPDIR` were empty in this reading shell;
   scripts must use the `portRange()` + fallback pattern and `$CHROME`.
5. No `.harness-env.json` exists in this copy; if the harness provides one at
   proof time, load it without printing and keep privileged values server-side
   only (public sign-in config goes in `apiNotes`/user objects).
6. No implementation, deploy, account, or end-to-end proof was run in this
   session per the reading-scope override; every behavior above the `check`
   baseline is a documented prediction awaiting execution.
