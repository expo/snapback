# Day two: change, prove, release, return

Start here with an existing app. Keep its store and saved sources. Before editing:

```sh
npx snapback4 init --adapt --day2 --apply
npx snapback4 deploy ./deploy --save-version versions/v1
```

Adapt saves the current sources/fixtures in versions/v1 and versions/v2 if absent,
and a frozen v1/ client with its own ESM package and generated API. Existing
snapshots and application-owned proofs stay untouched. Run this before the v2
edit; a snapshot taken afterwards is not historical evidence. If v1 is already
saved/deployed, inspect `releases ./deploy --json`; reuse that saved source.

Read only this card, ONE change route below, and `guide api proof` when writing
proofs. Do not read deploy/production/evolution --full next: those commands list
reference sections. Do not read dist/proof.js or the full declarations. Use the
signature digest and a specific section only when a refusal needs it.

## Choose one change route

| Change | Read at most these sections |
|---|---|
| Rename a field/table/operation or argument | `guide rename --section opening`; `guide deploy --section 'Keep v1 clients working'` |
| Loosen a required field, allow null or an empty album | `guide deploy --section 'Bridge a safety gate'`; `guide security --section 'N_PRESENCE_LOOSENING'` if the check asks for presence intent |
| Add a required field computed from old values | `guide deploy --section 'Migrations and adoption'`; `guide deploy --section 'Which migration shape'` |
| Change record kind, move media into children, split a list | `guide evolution --section 'Move media'`; `guide deploy --section 'Keep v1 clients working'` |

For a spelling change use `renamed from`; retain old endpoint/argument aliases
and result wrappers for v1 callers. Backfill computes historical values; it
isn't maintenance on later edits. Guard every creating/updating path that can
change a derived field. New required columns need a literal default or named
backfill; `default now`/`viewer` cannot invent history. Media/reference moves
need the supported extract shape, not a scalar transform. A loosened type does
not authorize an absent value at every workflow transition: keep independent
presence intent and current guards. Answer the actual check question; a
presence tautology is no safety proof.

## Preview, deploy v2, rollback and forward

Update your working snapback/*.q and versions/v2 (source and contemporary
fixtures); keep versions/v1 frozen. With production v1 already in ./deploy:

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

Replace 1 with the saved v1 release ID. Preview changes no live state and later
writes can change its result. Await activation; no sleep is needed. Default
rollback may use a registered compatible view retaining current guards. Inspect
`releases ./deploy --json` for live source/view and row shape; a successful
rollback alone does not establish frozen-v1 result compatibility. Use --exact
only after deliberately reviewing the old source's broader policy. If preview
requires a bridge or --restore-dormant, follow its concrete instruction and
preview again. Never prune/reset/delete storage to make a proof pass.

Run `npm run day2:proof` twice. The generated proof owns a fresh temporary store,
checks persisted IDs/values across two rollback/forward cycles and cleans up.
Its default business hook proves storage conservation only: add authenticated
v1/v2 business calls, refusals and reads of v2-native rows. Return explicit
changed-field/deletion declarations for intentional old-client writes. A custom
proof must also preserve data and stop every host it starts.

## Frozen v1 calls and repeatable users

```sh
BACKEND_URL=http://127.0.0.1:4400 CALLS_USERS='{"member":[{"email":"...","password":"..."}]}' npm --prefix v1 run client:calls
```

The frozen runner accepts inline JSON or a JSON file path, normalizes inline
users to a private temporary file for inherited clients, and removes it after
exit. It keeps the frozen generated handles. Run it on v1, live v2, rollback
and forward; use BACKEND_URL from your own bounded serve proof. Missing day-one
client:calls is explicit: author that business client before claiming coverage.
The frozen script may intentionally fail a newly forbidden call; record the
code separately from transport failures. Do not replace its API with v2's.

```js
import { uniqueName, freshUser } from "snapback4/proof";
const title = uniqueName("proof");
const member = await freshUser(host, {role:"member", provision:api.provision});
// member has email/password/principal/token; freshUser uses real signup and
// the ordinary operator provision mutation. Customize args for your schema.
```

Use freshUser once per role per proof run and reuse its session across that
run's release cycles. uniqueName supplies fresh row names/intent IDs; it cannot
clear a per-owner cap. A cap refusal on a second run needs a fresh owner/group
or deliberate authorized cleanup. Never raise caps or delete the shared
production store just to get green. Capacity refusals remain failures with a
setup hint, never silently retried writes.

## Production roster and complete inspection

`guide api proof` includes startServe, provisionAccounts, account/roster shapes
and exact options. For a persistent production driver use
`guide production --section 'Serve script and reusable accounts'` only. Signup
creates an account; an authorized provisioning mutation grants its role.

```js
import { startServe } from "snapback4/proof";
const host = await startServe("./deploy", {
  provisionUsers:{roles:{member:2, admin:2}, provision:api.provision}
});
const users = host.sessions; // {member:[account,account], admin:[account,account]}
// Private harness readiness: {backendUrl:host.url, users}; do not log elsewhere.
// Stop host in finally, or use your existing serve-check bounded driver.
```

Production provisioning reuses the named roster and logs in on rerun. Keep
production/proof-accounts/default.json (0600) with its store; it holds credentials,
stable provision IDs and partial completion. Use freshUser for isolated test
batches, the persistent roster for production accounts. Neither bypasses rules.

`data TABLE --release ./deploy --all --json` and
`snapshotAll("TABLE", {release:"./deploy"})` include dormant cells and retained
rows, merged once per ID. Active values win; deleted rows stay absent. This is
administrative inspection, bypassing application read rules, not a client
compatibility proof. Ephemeral rows exist only in serving memory. Inspect
`releases ./deploy --json` separately for retained source history.
