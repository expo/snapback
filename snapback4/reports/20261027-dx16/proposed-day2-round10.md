# Day two: change, prove, release, return

Start here with an existing app. Keep its store and saved sources. Before editing:

```sh
npx snapback4 init --adapt --day2 --apply
npx snapback4 deploy ./deploy --save-version versions/v1
```

Adapt saves absent versions/v1 and versions/v2 source/fixture snapshots plus a frozen v1/ ESM client and generated API. Existing snapshots
and authored proofs stay untouched. Capture BEFORE the edit. If v1 is already deployed/saved, inspect `releases ./deploy --json` and reuse
its saved source; never recapture it from v2. If these are starter drafts, choose unused versions/vN and versions/vM: save vN, copy it to vM for edits, and run
`npm run day2:proof -- versions/vN versions/vM`. Preserve existing snapshots.

Read this card, ONE change route, and `guide api proof` for proofs. Do not read deploy/production/evolution --full next:
those commands list reference sections. Do not read dist/proof.js or the full declarations. Use the signature digest and a specific section
only when a refusal needs it. After the selected route, edit the schema (or write the discovery plan). Lookup more only for a concrete refusal.

## Choose one change route

| Change | Read at most these sections |
|---|---|
| Rename a field/table/operation or argument | `guide rename --section opening`; `guide deploy --section 'Keep v1 clients working'` |
| Loosen a required field, allow null or an empty album | `guide deploy --section 'Bridge a safety gate'`; `guide security --section 'N_PRESENCE_LOOSENING'` if the check asks for presence intent |
| Add a required field computed from old values | `guide deploy --section 'Migrations and adoption'`; `guide deploy --section 'Which migration shape'` |
| Change record kind, move media into children, split a list | `guide evolution --section 'Move media'`; `guide deploy --section 'Keep v1 clients working'` |

For a rename use `renamed from`; keep old operation/argument aliases and result wrappers. For private added fields use `read (field) <-
policy`, intersected with row access; whole rows omit hidden fields, scalar selections return null and SDK properties are optional. Keep the
existing row audience. For example:

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

Backfill computes historical values, not later maintenance: update the summary on EVERY consent-changing path. New required fields need a
literal default or named backfill; contextual defaults cannot invent history. Media/reference moves use extract, not a scalar transform.
Loosening a field still needs independent presence intent at the transitions that require it. Only an intentional policy choice can use a
presence tautology; it does not prove workflow safety. Rename + stricter edits belongs in ONE release: `charge: TYPE renamed from price`;
retain `charge: TYPE alias price` on the old create call. Preserve old result fields with an explicit projection such as `return row
{id:.id, price:.charge}`. For an allowed creator but narrower editor, combine the existing update rule with `old.charge = next.charge or
OWNER_POLICY` in `update (old, next) <- ...`. A column `write <- POLICY` also restricts non-default creation: use it only when that matches
the requested creator too. A require never grants a denied write. Preserve existing guards. These forms are enough to plan the change; leave
security/language/rule-recipes closed until check names a concrete refusal. Reuse the inherited client:calls as the frozen business probe;
keep its handles.

## Preview, deploy v2, rollback and forward

Update your working snapback/*.q and versions/v2 (source and contemporary fixtures); keep versions/v1 frozen. With production v1 already in
./deploy:

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

Replace 1 with the saved v1 release ID. Preview writes nothing; later writes can change its result. Await activation; no sleep. Default rollback may use a registered compatible view retaining current guards. Inspect `releases ./deploy --json` for live
source/view and row shape; a successful rollback alone does not establish frozen-v1 result compatibility. Use --exact only after
deliberately reviewing the old source's broader policy. If preview requires a bridge or --restore-dormant, follow its concrete instruction
and preview again. Never prune/reset/delete storage to make a proof pass.

Run `npm run day2:proof` twice. The generated proof owns a fresh temporary store, checks persisted IDs/values across two rollback/forward
cycles and cleans up. Its default business hook proves storage conservation only: add authenticated v1/v2 business calls, refusals and reads
of v2-native rows. Return explicit changed-field/deletion declarations for intentional old-client writes. A custom proof must also preserve
data and stop every host it starts.

## Frozen v1 calls and repeatable users

```sh
BACKEND_URL=http://127.0.0.1:4400 CALLS_USERS='{"member":[{"email":"...","password":"..."}]}' npm --prefix v1 run client:calls
```

The frozen runner accepts inline JSON or a JSON file path. Inline users become a private temporary file, removed after exit. Keep its
handles; run it on v1, v2, rollback and forward using your bounded host's BACKEND_URL. A missing day-one client:calls is a coverage gap:
author a business client before claiming it. Record intended new guard denials separately from transport failures. Keep v1's API.

```js
import { uniqueName, freshUser } from "snapback4/proof";
const title = uniqueName("proof");
const member = await freshUser(host, {role:"member", provision:api.provision});
// Real signup + ordinary operator provision; customize args for your schema.
```

Use one freshUser per role per run; reuse sessions through release cycles. uniqueName changes names, not cap owners. A capacity refusal
needs a fresh owner/group or authorized cleanup. Never raise caps/reset shared production or retry a refused write to make a proof green.

## Production roster and complete inspection

`guide api proof` includes startServe, provisionAccounts, account/roster shapes and exact options. For a persistent production driver use
`guide production --section 'Serve script and reusable accounts'` only. Signup creates an account; an authorized provisioning mutation
grants its role.

```js
import { startServe } from "snapback4/proof";
const host = await startServe("./deploy", {
  provisionUsers:{roles:{member:2, admin:2}, provision:api.provision}
});
const users = host.sessions; // {member:[account,account], admin:[account,account]}
// Private harness readiness: {backendUrl:host.url, users}; do not log elsewhere.
// Stop host in finally, or use your existing serve-check bounded driver.
```

Production provisioning logs in to its persistent roster on rerun. Keep production/proof-accounts/default.json (0600) with its store:
credentials, provision IDs and partial completion. Use freshUser for isolated proof batches. Neither helper bypasses rules.

`data TABLE --release ./deploy --all --json` and `snapshotAll("TABLE", {release:"./deploy"})` merge active and retained rows/cells once per
ID. Active values win; deleted rows stay absent. This bypasses app read rules: it is admin inspection, not frozen-client compatibility
evidence. Ephemeral rows need a serving-memory read. `releases ./deploy --json` shows history.
