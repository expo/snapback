# DAY2-PLAN — Cacao Fermentary Lots, v2 (intake review priority)

Reading/discovery only. No source, deploy, or proof was changed in this session.
Implementation starts from this plan.

## 0. Starting state (observed, not changed)

- App root holds the day-one app: `snapback/schema.q` (3 tables, 18 ops, password
  identity, operator-provisioned `roles` roster), React Vite TS frontend
  (`src/App.tsx`, `src/client.ts`), scripts (`acceptance`, `client-calls`,
  `frontend-proof`, `probe-serve`, `harness-snapshot`, `staging`, `launch`).
- `package.json` pins `"snapback4": "0.4.43"` (exact) but the installed tree is
  **0.4.44** (`node -e "console.log(require('./node_modules/snapback4/package.json').version)"`
  and `npx snapback4 --version` both print `0.4.44`). First implementation step
  reconciles this (see §3).
- `npx snapback4 check` on the untouched tree: **ok** (3 tables, 18 ops; 0 gates
  pending, advisories non-blocking). So the upgrade break, if any, comes from the
  0.4.44→0.4.43 reconcile, not from schema rot.
- No `versions/`, `v1/`, `deploy/` directories yet. No `.harness-env.json`
  (`.harness/` holds only `binaries.jsonl`, `native-binaries.jsonl`, `notes`,
  `verify-serve`). Ports for this lane: 21210–21219 (`$PORT_LO`/`$PORT_HI`).
- Previous builder notes read: `PREVIOUS-DIARY.md`, `PREVIOUS-REPORT.md`,
  `PREVIOUS-friction.jsonl`. Key reuse facts: password starter matches the real-auth
  requirement; `staging.mjs` seeds `{farmer:2, clerk:2, worker:2, head:2}` via
  operator `provision`; `harness-snapshot.mjs` reads the project store with bare
  `data` (plus `--release` for deployments) — `--store-url` is Postgres-only;
  `probe-serve.mjs` prints the one-line `{backendUrl, frontendUrl, sessions,
  apiNotes}` contract and holds both servers until SIGTERM.

## 1. Installed CLI handover (verbatim gist)

`npx snapback4 init --adapt --day2` (preview only, **no `--apply`**) orders:

```sh
npx snapback4 init --adapt --day2 --apply
npx snapback4 deploy ./deploy --save-version versions/v1
```

- Adapt saves absent `versions/v1` and `versions/v2` source/fixture snapshots plus a
  frozen `v1/` ESM client and generated API; existing snapshots/proofs untouched.
  Capture BEFORE editing. If v1 is already deployed/saved, inspect
  `releases ./deploy --json` and reuse its saved source; never recapture from v2.
- Read only this card, ONE change route, and `guide api proof` when writing proofs.
  Do not pre-tour deploy/production/evolution `--full`, `dist/proof.js`, or the full
  declarations. A concrete check/preview refusal is the reason for another lookup.
- Preview/deploy/rollback/forward command set, frozen-v1-client invocation shape,
  and the `snapback4/proof` recipe (`startServe`, `provisionAccounts`,
  `uniqueName`/`freshUser`, persistent roster) are quoted in §§4–5 below.

## 2. Recommended documentation path (followed)

Change request = **required new field computed from old values** (priority derived
from the stored `lateFerment` flag), so the one change route is:

- `guide deploy --section 'Migrations and adoption'`
- `guide deploy --section 'Which migration shape survives edits and rollback?'`

Plus, on demand during implementation only:

- `guide deploy --section 'Keep v1 clients working'` (already skimmed: literal
  defaults for real default choices; old arg spellings via aliases — not needed
  here since no rename occurs).
- `guide deploy --section 10` ('What the old release sees'), `--section 11`
  ('Capture a saved version'), `--section 13/14` (persistent-production recipe,
  read), `--section 7/8/9` (rollback view vs `--exact` vs bridge) **only if a
  preview names them**.
- `guide api proof` digest (read: `startServe`, `startStatic`, `serveUntilSignal`,
  `provisionAccounts`, `snapshotAll`, `serveCheck`, account shapes) and
  `guide production --section 'Serve script and reusable accounts'` (read) when
  writing `prod:serve` / `day2:proof`.
- Rule/表现 lookups (`guide rules`, `guide security`, `guide rename`) stay closed
  unless `check` names a concrete refusal.

## 3. Upgrade (step 1 of the brief)

```sh
npm ls snapback4
npm install --save-exact snapback4@0.4.43
npx snapback4 --version   # must print 0.4.43
npm run check             # schema compile + tsc; expect ok
npm run acceptance        # must pass twice in a row
npm run frontend:proof    # must pass twice in a row (rebuilds dist it serves)
```

- Record every upgrade break in `friction.jsonl` (area `upgrade`).
- Suspected risk is low: schema is `check`-clean under 0.4.44; generated bindings
  may need a regen (`snapback4 types` runs inside `check`).

## 4. v1 production baseline (step 2 of the brief)

```sh
npx snapback4 init --adapt --day2 --apply        # saves versions/v1 (+v1/ frozen client); no-op if present
npx snapback4 deploy ./deploy --save-version versions/v1
npx snapback4 serve ./deploy &  # via script driver on $PORT_LO..$PORT_HI; never bare &
```

- `./deploy` is the production directory (brief-mandated; not `production/`).
- Roster for every production script: `{farmer:2, clerk:2, worker:2, head:2}`
  through the real path — `signup` then ordinary operator `provision`
  (`api.provision`), persisted in `./deploy/proof-accounts/default.json` (0600),
  reused across reruns via `provisionAccounts` (never deleted to rerun).
- v1 business data written through app operations as those users (clerk logs lots
  with certificate bytes + price, worker moves yard stages, head rejects with mold
  count/reason, clerk records payments); include at least one late-ferment lot
  (advance clock 25h before `startFerment`, as acceptance does) so the migration
  has both target values to prove.

## 5. v2 schema change (step 3) — source-shape choice

Chosen shape: **additive required enum + named backfill + head-only setter
mutation + narrowed row-update rule**. No rename, no table split, no media move,
so `renamed from` / `extract` / `down`-media rules do not apply. `down` reverse
projection is Nissan not authored up front; the rollback preview (§6) decides
whether the default registered view suffices or an authored bridge/`--exact` is
needed.

Compact pseudocode (Quarry, exact keywords to be confirmed by `check`):

```quarry
table lots:
  ... unchanged columns ...
  priority: enum('standard', 'needs attention') default 'standard'
  update (old, next) <-
    (old.priority = next.priority or exists roles[viewer, role = 'head'])
    and (exists roles[viewer, role = 'clerk']
      or exists roles[viewer, role = 'worker']
      or exists roles[viewer, role = 'head'])

backfill lots priority(lateFerment: bool):
  {priority: 'needs attention' if lateFerment else 'standard'}

mutation setPriority(lot: lots, priority: enum('standard', 'needs attention')):
  require exists roles[viewer, role = 'head'] else NOT_HEAD
  l = lots[lot] ! else NOT_FOUND
  update lots[lot] { priority }
  return null
```

Why this shape:

- `lateFerment: bool` (non-null) is a complete historical input, so a named
  `backfill` computes every existing row: late→`'needs attention'`, else
  `'standard'`. New rows take the literal default `'standard'` (a real default
  choice, hence also the v1-client compatibility story: old-shaped `logLot`
  calls omit the field and get `'standard'`).
- `logLot` keeps its exact v1 signature (no priority arg: new lots always start
  `'standard'`); raising happens only through `setPriority`, which is head-gated.
- The `update (old, next)` conjunction follows the adapt card's narrowing recipe
  (`old.charge = next.charge or OWNER_POLICY` combined with the existing rule):
  any non-head writer must leave `priority` untouched; head keeps full update
  power. `sweepFlags` job body is unchanged (it writes only flags; system-run
  sweeps already pass the staff update rule in v1 — `check` + acceptance clock
  tests re-prove this).
- Certificate, price, payments, `rejectLot`, yard stages: untouched.

Frontend (`src/App.tsx`, React bindings):

- Yard board rows show a priority badge (`needs attention` highlighted).
- Head-only control calls `setPriority` (raised concern); rendered only for head
  sessions — but enforcement stays server-side (the `update` rule + mutation
  `require`), so forged calls from clerk/farmer/worker sessions must refuse
  `NOT_HEAD` (mutation path) or the table-update refusal on any direct edit path.
- Clerk/farmer views are read-only for priority.

Proof-code additions:

- `acceptance.mjs`: head sets priority ok; clerk/worker/farmer attempts refuse;
  backfill values asserted over **all** lots via paged reads (`exhaustPages`
  pattern, not first page); new `logLot` defaults to `'standard'`.
- `client:calls` (v2): same calls as v1 plus `setPriority` ok-as-head and three
  expected-refusal lines (clerk, worker, farmer), carrying on after failures.
- `frontend-proof.mjs`: head raises a lot to `'needs attention'`, badge appears
  (fresh-row text disjoint from status text — day-one strict-mode lesson).

## 6. Deploy v2, rollback, forward (steps 3–4) — exact commands

```sh
npx snapback4 check
npx snapback4 test --source versions/v2          # after saving v2 sources
npx snapback4 deploy ./deploy --schema versions/v2 --check   # read-only preview; must not change live state
npx snapback4 deploy ./deploy --schema versions/v2          # v2 live; assert every pre-existing row survived with §5 values
npx snapback4 rollback ./deploy --to 1 --check   # replace 1 with saved v1 release id from releases ./deploy --json
npx snapback4 rollback ./deploy --to 1           # v1 live; assert data (incl. v2-written rows) preserved
npx snapback4 rollback ./deploy --to latest --check
npx snapback4 rollback ./deploy --to latest      # v2 live again; assert once more
```

- Keep `versions/v1` frozen; develop in working `snapback/*.q`, snapshot to
  `versions/v2` (source + contemporary fixtures).
- After each move, inspect `releases ./deploy --json` for live source/view and row
  shape; a green rollback alone does not prove frozen-v1 result compatibility.
- `--exact` only after deliberately reviewing the old source's broader policy;
  if preview demands `--bridge`/`--restore-dormant`, follow its concrete
  instruction and preview again. Never prune/reset/delete storage to pass.
- Frozen v1 client checks (using kept handles, bounded host, our `BACKEND_URL`):

```sh
BACKEND_URL=http://127.0.0.1:<port> CALLS_USERS='<sessions-json-or-path>' npm --prefix v1 run client:calls
```

run on v1, on v2, after rollback, after forward. Expected: v1 `logLot` (old shape)
succeeds on v2 via the literal default; v1 reads gain an additive `priority`
field; `setPriority` is absent on v1 → `E_OP`/404 class outcome, recorded not
hidden.

## 7. Automation deliverables (steps 5–6)

- `npm run day2:proof` (`scripts/day2-proof.mjs`): starts from whatever production
  holds (never deletes/resets/recreates data or the deployment); puts v1 live via
  stored release id; signs in real users (creates via roster if missing); writes
  uniquely-named v1 data (`uniqueName`); deploys v2 and asserts over **all**
  production rows (paged reads) that every pre-existing record survived with §5
  values; proves v2 feature + rule between two users; runs frozen v1 client vs v2
  (recorded); rolls back to v1, asserts preservation incl. v2-written rows, runs
  v1 client again; forwards to v2, asserts once more; stops everything it started;
  leaves **v2 live**; exits 0 only if all assertions held. Writes `day2-proof.json`
  (brief's exact shape). Twice-in-a-row runnable: fresh unique names per run,
  `freshUser`-style isolated identities where caps demand, never raise caps or
  reset shared production to go green.
- `npm run prod:serve` (`scripts/prod-serve.mjs`): serves production **as it
  stands** (no deploy/change) on our ports; prints exactly one stdout JSON line
  `{"backendUrl","users":{"farmer":[…],"clerk":[…],"worker":[…],"head":[…]}}`
  with ≥2 real users per role incl. `email`/`password`; stays up until SIGTERM
  (`serveUntilSignal`, SIGTERM reaps servers, ports released).
- `npm run prod:rollback` / `npm run prod:forward`: activate release 1 / latest
  over whatever production holds (idempotent, repeatable from either state, stop
  everything started, no server left running).
- `npm run probe:serve`: v2-from-production variant of the current script
  (production serve + production-built frontend, same one-line contract).
- `day2-proof.json` in release-rollback mode: `rollback`/`rollforward` `"ok"`,
  `v1ClientAfterV2`/`v1ClientAfterRollback` recorded as observed,
  `v1ClientAfterChange: null`, `migrationPreservesV1Rows: true`,
  `migrationFiles: ["versions/v2/schema.q", …]` (final list fixed at
  implementation), `v1ClientNotes` narrating the frozen-client replays.

## 8. Unresolved limits (to settle during implementation, not assumed)

1. Enum spelling `enum('standard', 'needs attention')` — space inside a quoted
   enum value is assumed legal (existing values are single words); `check` is the
   arbiter. Fallback renames the stored token and maps it at read time, which
   would deviate from the request's literal values — prefer the literal.
2. Exact `update (old, next)` conjunction syntax for the priority guard — drafted
   from the adapt card's recipe; `check` refusals plus `guide rules`/`guide
   security` on demand settle it. The `setPriority` mutation's `NOT_HEAD`
   `require` is independent of this and sufficient for the refusal contract.
3. Rollback selection (original v1 source vs registered compatible view) with
   v2-native `'needs attention'` rows present — decided by the
   `rollback --to 1 --check` preview at implementation time; a bridge or
   `--exact` follows only its concrete instruction.
4. Old-shaped `logLot` on v2 (literal-default fill) and additive-field reads —
   expected to work; proven by the frozen v1 client replay, not by reasoning.
5. In rollback mode the brief's `v1ClientAfterChange`/`migrationPreservesV1Rows`
   pair belongs to compatibility mode: plan records `v1ClientAfterChange: null`
   and the frozen-client outcomes in `v1ClientAfterV2`/`v1ClientAfterRollback` +
   `v1ClientNotes`. If the harness's served `day2-proof.json` validation disagrees,
   adjust field usage and note it in the proof `notes`.
6. Environment: ~60 builders share ports 21210–21219 — bind first and confirm the
   answering server is ours before driving it; `$CHROME` needs `--no-sandbox`;
   no `python`, use `node`; `/bin/sh` is dash (no `PIPESTATUS`, no `<()`).
