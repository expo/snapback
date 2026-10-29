# Day two: one release recipe

Use this SQLite recipe for upgrade, production, changes and rollback. Before capture, ensure client:calls exercises day-one business calls.

```sh
npx snapback4 upgrade
npm run check && npm run acceptance && npm run frontend:proof
npx snapback4 init --adapt --day2 --apply
npx snapback4 deploy ./deploy --save-version versions/v1
```

## Upgrade and save the actual v1

Refusal lookups only; Postgres: guide release-json.

Use the requested pin; restart old hosts. Adapt preserves authored scripts/snapshots and captures checked source, API and client:calls under v1/ BEFORE editing. Reuse existing immutable v1; never recapture v2 as v1. If v1/v2 are starter drafts, save actual v1 as versions/vN, copy to vM. Keep old snapshots. Substitute the chosen pair in ALL examples below, including both proof runs. The frozen client stays v1/. Record v1 ID once with releases ./deploy --json; 1 below assumes the first release.

## Production v1 with real users

Save scripts/prod-serve.mjs; set prod:serve to `exec node scripts/prod-serve.mjs`. Replace roles/handle/args with your enrollment plan. Serve the current selection; no deploy here.

```js
import {startServe, serveUntilSignal, cleanup} from 'snapback4/proof';
import {api} from '../snapback/generated/api.ts';
const host = await startServe('./deploy', {
  provisionUsers:{roles:{member:2, admin:2}, provision:api.provision}
});
try {
  console.log(JSON.stringify({backendUrl:host.url, users:host.sessions}));
  await serveUntilSignal([host]);
} finally { await cleanup(() => host.stop()); }
```

Signup confers no role; provisioning uses the authorized operator mutation. Accounts are `{kind:'user',role,email,password,principal,token,expiresAt}`. Reruns login/finish partial setup from deploy/proof-accounts/default.json (0600); keep it with the store. Plan mismatch: reuse the plan or choose a new roster name. Readiness is private; other logs go to stderr. Build v1 against this host; write business data as two real users per role BEFORE edits.

## Route the change here

| Change | Paved form and compatibility |
|---|---|
| Rename | `charge: Int renamed from price`; old argument `charge: Int alias price`; `alias oldItem = item`. Preserve old result names with `return row {id:.id, price:.charge}`. Rename and stricter editing belong in one release. |
| Required → optional, empty album | Use `TYPE ?` / the new list minimum; fix nullable UI reads. Preserve independent presence intent where check requests it. Default rollback can register an optional view retaining current guards; prove old callers tolerate null/empty. |
| Required derived field | Literal default or named backfill computes historical values; maintain the value on EVERY later insert/update path. Contextual defaults cannot invent history. Private reads intersect row access; hidden fields are omitted/optional. |
| Asset into children | `extract scans from orders via order: {scan:scan}`; list elements use `each`. Declare the child with `order: orders on delete restrict`, immutable order and `read through .order`. Keep the same audience. Scalar-only splits need backfill/down plus child-writing mutations. |

Derived/private field and alias:

```quarry
use identity password
table records:
  owner: principal
  consent: file <=10000000 ?
  summary: enum('held', 'none') read <- .owner = viewer
  read <- .owner = viewer
  online only
backfill records summary(consent: file <=10000000 ?):
  {summary: 'held' if consent != null else 'none'}
query item(id: records alias oldId):
  return records[id]
alias oldItem = item
```

For allowed creators but narrower editors, combine the existing update rule with `old.charge = next.charge or OWNER_POLICY` in `update (old, next) <- ...`. Column `write <- POLICY` also restricts non-default creation. A require grants no denied write. Preserve existing guards. For extraction, initial child IDs equal parent IDs; each-list children retain receipt order. Default compatible rollback views can retain v2-native parents/multiple children. Selection alone proves neither old shape nor all-row readability. Review hiding/broader policy before --exact. Missing reverse values need a truthful down/bridge, not a misleading default. Follow only the refusal's named section.

## Preview, deploy and thin stage scripts

Update working snapback/*.q and versions/v2 with contemporary fixtures; keep versions/v1 frozen.

```sh
npx snapback4 check
npx snapback4 test --source versions/v2
npx snapback4 deploy ./deploy --schema versions/v2 --check
npx snapback4 deploy ./deploy --schema versions/v2
```

Preview writes no live data; activation revalidates under the writer. Await completion, no sleep. Fix the first red. Repeated previews show deltas/unchanged; full evidence: .snapback4/last/deploy.txt, `deploy --explain`, or deploy --json. Do not repeatedly dump releases/data after a green phase: put the assertion in the proof.

Add these exact package.json scripts (replace 1 with recorded v1 ID):

```json
{
  "day2:rollback": "snapback4 rollback ./deploy --to 1",
  "day2:forward": "snapback4 rollback ./deploy --to latest",
  "day2:check": "snapback4 day2-check --deployment ./deploy"
}
```

Wrappers work from either state on the same store; no host starts. `latest` selects the newest ordinary forward release, not a rollback view. Refused move: `rollback ./deploy --to 1 --check`; follow its bridge/restore instruction and preview again. Never prune, reset or delete storage to make a drill green.

## One assertion-bearing proof and one check

Implement day2:proof against the EXISTING ./deploy, starting from whatever it holds: select v1, write fresh real-user data, deploy v2, run v1 calls, rollback/run v1 again, forward, leave v2 selected. Assert ALL pre-existing IDs and migrated values, the v2 feature, cross-user refusals, and v2-native rows readable through frozen v1 at v2 and rollback. Exhaust pages; compare IDs; account for intentional client writes/deletes. After assertions/cleanup, write `JSON.stringify({ok:true,...results})` to day2-proof.json with node:fs writeFileSync; results holds measured counts, flags and migration filenames. Stop hosts in finally. Use freshUser/uniqueName from snapback4/proof; reuse fresh role sessions per run. Never retry refused writes or raise caps.

The adapted day2:proof is a TEMPORARY-store conservation example: no business assertions; existing destinations refuse. Replace/customize for production above; keep saved-source fixture tests. Missing helper signature: guide api proof.

```sh
npm run day2:check
```

This runs check once; acceptance, frontend:proof and day2:proof twice each; rollback/forward twice each, with bounded prod:serve and frozen calls after EVERY move (v2 calls after forward); finally bounded probe:serve + v1/v2 calls. It deletes dist before each frontend proof and stale day2-proof.json before each day-two proof. Stage hosts span calls; probe is observed for 30s; shutdown/store release is checked. First red stops with its exit code, phase and private .snapback4/last/day2-check.json; read that file without rerunning. --explain/--json rerun the drill. Rerun after a repair/relevant edit, not for reassurance. Authored assertions decide coverage.

Frozen calls use `npm --prefix v1 run client:calls` with BACKEND_URL and CALLS_USERS (a private JSON file). Keep v1 handles/API; distinguish rule refusals from transport failures. prod:serve serves the current selection; probe:serve selects v2, builds the production frontend, prints backendUrl/frontendUrl/sessions and stays up for its caller. Use serveUntilSignal and finally cleanup. The checker holds services and passes users privately. --timeout-ms bounds scripts; --up-ms sets probe observation time.

`data TABLE --release ./deploy --all --json` / snapshotAll merge active/retained rows and cells by ID; admin inspection bypasses app rules and cannot prove frozen-client readability. Never substitute it for the client checks.
