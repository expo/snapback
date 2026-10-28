# DAY2-PLAN.md — Heat Pump Installs (v2: optional energy-audit scan)

Discovery-only plan. No backend/UI sources changed, no deploy, no users
provisioned, no proof scripts run, no installs built. Basis: installed-CLI
handover (`npx snapback4 init --adapt --day2`, preview only, full text in
§1), day-one app as inherited, docs read on demand (§2). Ports 21110–21119
via `$PORT_LO`/`$PORT_HI` (empty in this discovery shell — scripts must read
`process.env`, never hard-code); Chromium at `$CHROME`.

## 0. Starting state (observed, not changed)

- `package.json`: `snapback4@0.4.43` + `snapback4-expo@0.4.43` already exact.
  Day-two step 1 is confirm-only: `npm ls snapback4 snapback4-expo`,
  then `npm run check`, `npm run acceptance`, `npm run frontend:proof`.
- No `deploy/`, `versions/`, `v1/` directories yet; no `.harness-env.json`
  (server-side config absent — plan loads it without printing if the harness
  provides it later; never into the frozen client or `apiNotes` credentials).
- `check` (run once, read-only) is green on v1 schema: 2 tables, 12 ops,
  0 gates pending, 1 witnessed question (N_ARGUMENT_GRANT, nonblocking).
  Installed runtime notes `0.4.43 → 0.4.44` diagnostics-only changes; no
  action unless `check`/`acceptance` redden.
- V1 data shape that matters (`snapback/schema.q`): `installs.audit` is
  **required** `file <=5000000 (pdf/png/jpeg)` + in `immutable` list;
  `openInstall(..., audit: file (required), ...)` is the only writer;
  `update <- .homeowner = viewer or exists roles[viewer]` (too broad for the
  v2 rule — must be narrowed for the audit column only, everything else
  unchanged).

## 1. Installed-CLI handover (verbatim gist)

`npx snapback4 init --adapt --day2` (preview only, nothing written) says:

```sh
npx snapback4 init --adapt --day2 --apply
npx snapback4 deploy ./deploy --save-version versions/v1
```

- Adapt saves absent `versions/v1` + `versions/v2` source/fixture snapshots
  plus a frozen `v1/` ESM client and generated API; existing snapshots/proofs
  untouched. Capture BEFORE editing; if v1 already deployed/saved, reuse its
  saved source via `releases ./deploy --json`, never recapture from v2.
- Read only: this card + ONE change route + `guide api proof` for proofs.
  No `deploy/production/evolution --full` tour, no `dist/proof.js`, no
  declaration greps (signature digest only, section on demand).
- Release cycle once v1 is in `./deploy` (replace `1` with saved v1 release ID):

```sh
npx snapback4 check
npx snapback4 test --source versions/v2
npx snapback4 deploy ./deploy --schema versions/v2 --check
npx snapback4 deploy ./deploy --schema versions/v2
npx snapback4 rollback ./deploy --to 1 --check
npx snapback4 rollback ./deploy --to 1
npx snapback4 rollback ./deploy --to latest --check
npx snapback4 rollback ./deploy --to latest
```

- Default rollback may use a registered compatible view retaining current
  guards; `--exact` only after deliberately reviewing old source's broader
  policy. If preview demands a bridge or `--restore-dormant`, follow its
  concrete instruction and preview again. Never prune/reset/delete storage.
- Frozen v1 probe (bounded host's `BACKEND_URL`):

```sh
BACKEND_URL=http://127.0.0.1:4400 CALLS_USERS='{"member":[{"email":"...","password":"..."}]}' npm --prefix v1 run client:calls
```

  Reuse inherited `client:calls` as the frozen business probe; missing
  day-one `client:calls` would be a coverage gap (not the case here — it
  exists at `scripts/client-calls.mjs`, 27 successes + 16 expected refusals).
- Repeatable users: `uniqueName` + `freshUser(host, {role, provision:
  api.provision})` (real signup + operator provision); one freshUser per role
  per run; never raise caps/reset shared production.
- Production roster: `guide api proof` + only
  `guide production --section 'Serve script and reusable accounts'`.
  `startServe("./deploy", {provisionUsers:{roles, provision:api.provision}})`
  → `host.sessions`; roster file `production/proof-accounts/default.json`
  (0600) stays with its store.

## 2. Documentation path actually followed (on demand only)

| Question | Card/section read | Outcome |
|---|---|---|
| Change route for required→optional file | `guide deploy --section 'Bridge a safety gate'` | Rollback recipe: widened-domain bridge + authorized repair before `--exact`; default rollback keeps compatible view with current guards |
| Old-client compat | `guide deploy --section 'Keep v1 clients working'` | Keep callable/argument names via `alias`/argument-alias; literal defaults only for real defaults; deploy reports reverse-projection risks; run named `rollback --to N --check --bridge` after writes |
| Migration shape for optional-izing | `guide deploy --section 'Migrations and adoption'` | Optional/defaulted columns are additive; narrowing retains un-fittable rows; expand→migrate→contract preferred |
| Which shape survives edits+rollback | `guide deploy --section 'Which migration shape'` | Loosening needs no `backfill`/`down` for old rows (null was unrepresentable, values stay); v2-null rows are the reverse-projection risk; `prune` forbidden |
| Child-table alternative | `guide evolution --section 'Move media'` | Rejected: `extract` is for media moving into children; here the file stays a scalar column, just optional |
| Presence gate | `guide security --section 'N_PRESENCE_LOOSENING'` | Required→optional needs declared presence intent in source; prose cannot close the gate; expect a `check` question, answer with schema invariant/allowance, not prose |
| Proof/host API surface | `guide api proof` (digest only) | `startDev/startServe/deploy/cli/command/startStatic/serveUntilSignal/probeServeGuard/serveCheck/provisionAccounts/uniqueName/freshUser/snapshotAll/exhaustPages`; fingerprint `b27b2a97…e0251`; never read `dist/proof.js` |
| Serve + reusable accounts | `guide production --section 'Serve script and reusable accounts'` | `scripts/prod-serve.mjs` recipe (`startServe` + `startStatic` + `serveUntilSignal`, `finally` cleanup); roster reuse, plan-mismatch, `.lock`, login-before-signup rules |
| CLI flags | `deploy --help`, `rollback --help`, `init --help` | Flags recorded in §4–§5 |

NOT read (per handover): security/language/rule-recipes/testing full cards,
`guide --list`, declaration bodies.

## 3. Source-shape choice for v2

Chosen route: **loosen a required field** (`audit: required file` →
`audit: optional file`), same table, same column name (no rename, no
`extract`, no new table). All other columns, quote/stage/inspection/window
logic byte-identical.

```quarry
# v2 sketch (exact syntax confirmed by `check`, not by this plan):
table installs:
  ...
  audit: file <=5000000 ('application/pdf', 'image/png', 'image/jpeg') ?
  immutable homeowner, coordinator, address, price, quotedAt, bedroomWindow
  # ^ audit LEAVES the immutable list so the coordinator can add it later
```

- `openInstall`: `audit` argument becomes optional/nullable (argument-alias
  keeps old callers working; e.g. `audit: file ? default null`
  or optional-arg form per `check`'s accepted spelling — `check` refusal
  decides the spelling at implementation time). Coordinator may open with or
  without scan; every other arg/guard unchanged.
- Audit-lifecycle writes (new, coordinator-only). Prefer dedicated
  mutations over opening the generic table update (keeps homeowner/installer
  paths provably untouched):

```quarry
mutation setAudit(install: installs, audit: file <=5000000 (...)):
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  update installs[install] { audit }          # add (null → value) or replace
  return null
mutation clearAudit(install: installs):
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  update installs[install] { audit: null }    # remove
  return null
```

  Plus a column-level guard so no other path (generic update, homeowner
  accept, installer advance, staff inspection, owner approval) can move the
  audit: `update (old, next) <- old.audit = next.audit or exists
  roles[viewer, role = 'coordinator']` (exact predicate spelling per
  `check`; homeowner accept etc. already don't touch audit — the guard is
  defense in depth for the new v2 rule: homeowner/installer attempts refuse
  `NOT_COORDINATOR` or the table-update denial).
- Presence intent for `N_PRESENCE_LOOSENING`: declare in source (e.g.
  `invariant evidence always .audit = null or .audit != null`-style
  deliberate-optional evidence, or the `check`-prompted answer template —
  follow the concrete `check` question text at implementation time).
- Read rules unchanged (existing audience already covers null audit; whole
  rows keep showing, no new hidden fields). No `backfill` (old rows keep
  their bytes; null was unrepresentable in v1 so no historical computation).
  No `down` authored up front — default rollback's registered compatible
  view is the first attempt; `--bridge`/`--exact` only per preview output.
- Frontend (`App.tsx` + `src/UploadPicker.tsx`): audit prop becomes nullable;
  every audit render site shows `'Energy audit to follow'` when null;
  coordinator screens gain add/replace/remove upload controls calling the new
  mutations; homeowner/installer screens gain no audit-write affordance.
  `formatPrice`/`flagState`/board/detail queries unchanged.

Rejected alternative: `extract audits from installs via install` child table.
Costs a new table + reference lifetime + id-mapping + exact-reversal
validation for zero product benefit (single optional scan, not a list or a
shared-asset move). Revisit only if `deploy --check` refuses scalar
loosening for file columns.

## 4. Release / rollback / forward commands (exact)

```sh
# one-time: freeze v1 BEFORE editing
npx snapback4 init --adapt --day2 --apply
npx snapback4 deploy ./deploy --save-version versions/v1
npx snapback4 releases ./deploy --json        # note saved v1 release ID (=V1)

# v2 evolution (working schema.q + versions/v2 kept in sync, versions/v1 frozen)
npx snapback4 check
npx snapback4 test --source versions/v2
npx snapback4 deploy ./deploy --schema versions/v2 --check
npx snapback4 deploy ./deploy --schema versions/v2

# rollback / forward previews then activations (V1 = saved v1 release ID)
npx snapback4 rollback ./deploy --to V1 --check
npx snapback4 rollback ./deploy --to V1
npx snapback4 rollback ./deploy --to latest --check
npx snapback4 rollback ./deploy --to latest
npx snapback4 releases ./deploy --json        # confirm live source/view + row shape
```

- Reverse-projection risk to watch in preview output: v2 rows with
  `audit = null` cannot fit v1's required `audit`. Expect either a
  registered compatible view (default rollback keeps them visible under
  current guards) or a named `--bridge <new-dir>` / `--restore-dormant`
  instruction — follow it literally, preview again, and record the chosen
  coping in `day2-proof.json` notes + REPORT.md. `--exact` only after
  deliberate review (hides null-audit rows — likely wrong for this change).
- `prod:rollback` / `prod:forward` scripts wrap the two activation lines
  (no `--check`), idempotent from either state, stop everything they start,
  leave no server running, exit 0 when the target release is live.
  `prod:serve` never deploys — serves whatever release is live.

## 5. Frozen-client + production-proof pseudocode

Frozen v1 client: `v1/` copy from adapt (own `package.json`,
`client:calls` = inherited `scripts/client-calls.mjs` unmodified, own
`node_modules`, own generated API rebuilt via its `check`). Only inputs
`BACKEND_URL` + `CALLS_USERS` (inline JSON → private temp file, removed
after exit). Run on v1-live, v2-live, rollback-live, forward-live:

```sh
BACKEND_URL=<host.url> CALLS_USERS=<roster.json> npm --prefix v1 run client:calls
```

Expected v1-client-after-v2 reads (to verify, not to assume): reads keep
working (same row audience; audit now nullable — old UI must tolerate null,
record exact breakage if it doesn't); `openInstall` without audit refuses
under v1 validation (new capability, expected gap); `openInstall` with audit
still sends. Record `works|degraded|broken` from harness measurements, never
from assumption.

`day2:proof` (against production `./deploy`, real clock, rerunnable, unique
names per run via `uniqueName`, full-table checks via `exhaustPages`/
`snapshotAll`, never delete/reset/recreate store or deployment):

```js
import { startServe, deploy, cli, uniqueName, freshUser } from "snapback4/proof";
import { api } from "../snapback/generated/api.ts"; // v2 api; v1 runner via npm --prefix v1
// 1. snapshot ALL installs (exhaustPages over board/myInstalls + sql --json-objects cross-check)
// 2. ensure v1 live (prod:forward/rollback helpers), provisionUsers {coordinator:2, homeowner:2, installer:2, owner:2} via provisionAccounts (roster reuse), write v1 rows (openInstall WITH audit) through app ops as coordinator
// 3. re-snapshot (recordsBeforeV2), deploy v2 (deploy("./deploy","versions/v2")), assert every pre-row survives with identical scan/price/rest (recordsCheckedAfterV2, dataPreservedAfterV2, migratedValuesCorrect)
// 4. v2 feature: openInstall WITHOUT audit → row readable, audit null; setAudit as coordinator → bytes present; clearAudit → null again; (v2FeatureWorks)
// 5. v2 rule: homeowner + installer setAudit/clearAudit → NOT_COORDINATOR (v2RuleEnforced); run frozen v1 client:calls vs v2 → record v1ClientAfterV2 + notes
// 6. rollback --to V1 → assert all rows incl. v2-written preserved (null-audit rows per preview coping), run v1 client → v1ClientAfterRollback
// 7. forward --to latest → assert again; leave v2 live; stop all hosts in finally
// 8. overwrite day2-proof.json (schema per brief §4 incl. migrationFiles, v1ClientAfterChange=null in rollback mode w/ migrationPreservesV1Rows)
// exit 0 iff every assertion held (v1-client outcomes recorded, not asserted)
```

`prod:serve` (stays up until SIGTERM to process group; stdout = ONE JSON
line, everything else to stderr/file):

```js
// startServe("./deploy",{provisionUsers:{roles:{coordinator:2,homeowner:2,installer:2,owner:2},provision:api.provision}})
// → {backendUrl:url, users:{coordinator:[{email,password}…], homeowner:[…], installer:[…], owner:[…]}}
// serveUntilSignal([backend)] in try; cleanup in finally
```

`probe:serve` (production v2): ensure v2 live without resetting data,
`startServe("./deploy")` + provision-if-missing, `expo export -p web` with
`EXPO_PUBLIC_SNAPBACK_URL=<backend>`, `startStatic("dist")`, print one JSON
line `{backendUrl, frontendUrl, sessions:{role:[{email,password,token,…}…]},
apiNotes}` (Bearer [REDACTED] + `?api=` override + upload-hint documented; no admin/deploy
keys), `serveUntilSignal([backend, web])`.
`harness:snapshot`: existing `scripts/harness-snapshot.mjs` retargeted at
`./deploy` (`sql --release deploy --json-objects`, all `roles`+`installs`
rows, stable IDs, no credentials) — audit adapter only, proof contracts
unchanged. `client:calls` (v2): same envelope as v1 + openInstall-without-
audit, setAudit/clearAudit success + homeowner/installer refusal lines.

## 6. Unresolved limits (stated, not hidden)

1. `$PORT_LO`/`$PORT_HI` and `$CHROME` were empty in this discovery shell —
   implementation must read them at runtime; no port numbers are pinned here.
2. Optional-arg vs default-null spelling for `openInstall.audit`, the exact
   update-guard predicate, and the `N_PRESENCE_LOOSENING` answer template are
   decided by the concrete `check` refusal at implementation time (handover
   forbids pre-validating via further guide tours).
3. Rollback coping for null-audit rows (compatible view vs `--bridge` vs
   `--restore-dormant`) is decided by the real `rollback --to V1 --check`
   output after v2 edits + v2-native writes — this plan records the decision
   point, not the outcome.
4. No `.harness-env.json` present at discovery — if provided later, load
   without printing; privileged values never reach the client/frozen client.
5. Compatibility mode (release rollback vs frozen-v1-client-after-change) is
   the backend's call per the brief; this plan implements the rollback lane
   (`rollback`/`rollforward` fields real, `v1ClientAfterChange=null`) and
   adapts if the harness declares the frozen-client mode.
