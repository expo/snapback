# Staging with real users

Staging runs real password users and application rules under serve. Use it for shared previews and probe:serve, with roles provisioned by a local operator.

```quarry
use identity password
table roles:
  principal: principal
  role: enum('admin', 'member')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only
mutation provision(principal: principal, role: enum('admin', 'member')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }
query myRole():
  return roles[viewer]
table notes:
  owner: principal
  body: text 1..200
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
mutation add(body: text 1..200):
  return insert notes { owner: viewer, body }
query myNotes(c: cursor ?):
  return notes where .owner = viewer first 20 by .id after c
```

Use `serve` for staging, shared previews and `probe:serve`. It enforces the same
password identity and rules as production. `dev` always advertises
`development:true` in `/auth/config`, even with closed doors; probes should
refuse it. `guide deploy` covers release evolution; PROD2 owns starter adaptation.

## Password roles and operator provisioning

Save this complete source as `snapback/schema.q` in an app with snapback4 installed.
Signup creates an account without a role. Only the local filesystem operator can
bootstrap this roster. The insert rule enforces the boundary independently of
the mutation. SEC owns self-promotion diagnostics and invariant proofs.

## Stand up staging

Run `npx snapback4 check` to generate the API. Save this as `staging.mjs` next to
snapback/, then run `node staging.mjs`. Use `node staging.mjs --once` for CI setup
and shutdown. The deployment and private credentials file remain for inspection;
choose fresh names for each independent run. Add both to .gitignore. PORT_LO and
PORT_HI optionally choose a port range. The printed URL belongs to `serve`.

```js
import { openSync, writeFileSync, closeSync } from "node:fs";
import { deploy, startServe } from "snapback4/proof";
import { api } from "./snapback/generated/api.ts";

await deploy("staging", "snapback", { args: ["--staging"] });
const host = await startServe("staging", { seedUsers: {
  roles: { admin: 2, member: 2 }, provision: api.provision,
} });
try {
  // This file contains real passwords and bearer tokens. Never commit it.
  const fd = openSync("staging-users.json", "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify(host.sessions)); } finally { closeSync(fd); }
  for (const accounts of Object.values(host.sessions)) {
    for (const account of accounts) {
      const response = await fetch(host.url + "/m/add", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${account.token}` },
        body: JSON.stringify({ args: { body: `Welcome ${account.role}` } }),
        signal: AbortSignal.timeout(10000),
      });
      if ((await response.json()).state !== "sent") throw Error("staging data write refused");
    }
  }
  console.log(JSON.stringify({ backendUrl: host.url, credentialsFile: "staging-users.json" }));
  if (!process.argv.includes("--once")) await new Promise(resolve => {
    process.once("SIGTERM", resolve); process.once("SIGINT", resolve);
  });
} finally { await host.stop(); }
```

`host.seedAccounts({roles, provision, args?})` performs additional batches; an
optional `args(account)` merges over `{principal, role}` (explicit keys win).
Use `service: "ops"` for a provisioning mutation authorized as `service:ops`.
Each call creates new random email/password pairs and returns role arrays of
`{role,email,password,principal,token,expiresAt}`. Ordinary sessions last seven
days; sign in again with `login` from snapback4/auth when needed. Setup is
sequential and bounded (default five minutes, timeoutMs overrides it, max 100
accounts). Identity 429 refusals wait for retryAfterMs (Retry-After on older
servers), at most four attempts per account within the remaining setup budget.
SDK guest/signup/login share this policy (timeoutMs defaults to three minutes;
signal cancels a request or wait). Ambiguous writes never retry. Partial failure can leave accounts/grants: inspect or discard this
disposable deployment before retrying. Returned credentials never enter helper
logs. Print them only to a private operator destination, as above.

## Production refuses bulk setup

`deploy --staging` can classify only a new store. Existing unmarked stores are
production, and refuse relabelling. Classification stays with the store across
hot deploys, rollbacks and restarts; copying production into a directory named
staging does not change it. `deploy --check --staging` does not mark a store.
There is no promotion flag: deploy real production into its own fresh directory
and provision only intended users. `seedAccounts` and startServe's seedUsers
refuse production or dev before minting a token or creating any account. A
normal production startServe still supports operatorToken for explicit grants.

### E_STAGING

E_STAGING refuses production relabelling or bulk account setup on a non-staging
host. Choose a separate fresh `deploy --staging` store; use the explicit
first-admin recipe below for intended production users. Source edits and a
directory named staging never change a production store's classification.


### Identity request deadline

E_IDENTITY_TIMEOUT is the internal sign-in deadline cause (SDK E_OFFLINE).
Signup outcome may be unknown: inspect before retrying. Increase timeoutMs to
allow server retryAfterMs waits. seedAccounts maps it to E_STAGING_TIMEOUT
with the partial-account recovery guidance below.

### Account setup refusals

E_STAGING_INPUT means the account plan is invalid. Provide 1..100 accounts,
named roles, a declared mutation handle and a positive timeoutMs before setup.

E_STAGING_TIMEOUT means the setup deadline expired. Partial accounts/grants
may exist; inspect or discard the disposable deployment before retrying.

E_STAGING_SIGNUP means password signup refused or returned an invalid session.
Inspect the underlying refusal; partial accounts/grants may exist, so inspect
or discard the disposable deployment before retrying.

E_STAGING_PROVISION means the operator mutation refused or returned an invalid
reply. Repair its arguments and operator-only rules; partial accounts/grants
may exist, so inspect or discard the disposable deployment before retrying.

## First admin on production

Deploy the same schema with `npx snapback4 deploy production` (omit --staging).
Save the following as `first-admin.mjs`. Set FIRST_ADMIN_EMAIL and
FIRST_ADMIN_PASSWORD privately, then run `node first-admin.mjs` as the store
owner while no other serve owns its port. This script starts and stops serve;
restart it normally afterwards. For an already running deployment use
`snapback4 token --service operator --days 1 --release production` locally and
the same authenticated mutation. Keep the service token out of the frontend.

```js
import { signup, login } from "snapback4/auth";
import { startServe } from "snapback4/proof";
const email = process.env.FIRST_ADMIN_EMAIL, password = process.env.FIRST_ADMIN_PASSWORD;
if (!email || !password) throw Error("Set FIRST_ADMIN_EMAIL and FIRST_ADMIN_PASSWORD privately");
const host = await startServe("production");
try {
  // Login first so rerunning this script preserves the existing account and grant.
  let account = await login(host.url, email, password);
  if (!account.ok) account = await signup(host.url, email, password);
  if (!account.ok) throw Error(account.why.message);
  const token = await host.operatorToken();
  const response = await fetch(host.url + "/m/provision", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ args: { principal: account.session.principal, role: "admin" } }),
    signal: AbortSignal.timeout(10000),
  });
  if ((await response.json()).state !== "sent") throw Error("operator grant refused");
  console.log("First admin provisioned; sign in with the chosen email and password");
} finally { await host.stop(); }
```

Reruns authenticate the same email/password and upsert the same roster row.
A wrong password refuses without changing an existing grant. No first-user race or self-promotion mutation is needed. Subsequent grants use
the same operator process or an explicitly authorized admin policy. Invite codes
must be server-validated, single-use grants issued by an authorized operator;
an arbitrary caller-supplied code or role is not authority.

## Local fixture tools are explicit

Password-only dev closes /seed, /dev/* and persona headers by default.
`dev --unsafe-dev-doors` explicitly opens local fixture and clock tools and
prints a warning; it still requires loopback Host/Origin, and personas must be
declared with `use personas`. The local token-mint protocol keeps its existing
private store-owner proof. Serve never opens these development tools.
`/auth/config` reports `environment`, `development`, and `devDoors` separately.
`startDev()` persists by default, matching native dev; pass args:["--memory"]
for disposable storage. now() needs the explicit clock door on password-only
dev. A proof for real users uses the serve recipe above.
