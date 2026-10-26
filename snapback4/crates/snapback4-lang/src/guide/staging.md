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
and shutdown. Set `"probe:serve": "node staging.mjs"` in package.json and run
`npm run --silent probe:serve` for a single JSON readiness line.
Verify that process with `npx snapback4 serve-check --deployment staging --script probe:serve`;
password starters provide `npm run --silent probe:check` with a fresh deployment.
The verifier keeps readiness credentials out of its output and tests startup,
30 seconds alive, SIGTERM reaping and store release. SIGTERM stops
and reaps the backend and exits successfully. The deployment and private credentials file remain for inspection;
choose fresh names for each independent run. Add both to .gitignore. PORT_LO and
PORT_HI optionally choose a port range. The printed URL belongs to `serve`.

```js
import { openSync, writeFileSync, closeSync } from "node:fs";
import { deploy, startServe, serveUntilSignal } from "snapback4/proof";
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
  // Derive supplied event times from the staging clock, including reused stores.
  const before = await host.now();
  const advanced = await host.advance("1h");
  if (advanced.now < before + 3600000) throw Error("clock did not advance");
  console.log(JSON.stringify({ backendUrl: host.url, credentialsFile: "staging-users.json" }));
  // A pending promise alone does not keep Node alive. The helper owns shutdown.
  if (!process.argv.includes("--once")) await serveUntilSignal([host]);
} finally { await host.stop(); }
```

`host.seedAccounts({roles, provision, args?})` performs additional batches; an
optional `args(account)` merges over `{principal, role}` (explicit keys win).
Use `service: "ops"` for a provisioning mutation authorized as `service:ops`.
Each call creates new random email/password pairs and returns role arrays of
`{kind:"user",role,email,password,principal,token,expiresAt}`. These complete
sessions can be passed directly to createClient. Ordinary sessions last seven
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
refuse production or dev before minting a token or creating any account.
`host.provisionAccounts(plan)` (or startServe's `provisionUsers`) accepts the
same roles/provision/args/service plan in production. It reuses the named
`roster` (default `default`) under `<deployment>/proof-accounts/`, logs in again
for fresh sessions, and provisions only unfinished entries. Repeated serve
starts do not add another roster. Files contain passwords, are private (0600),
and must stay with the deployment and out of source control. Preserve them when
copying/backing up a store; deleting them or choosing a new name requests new
accounts. A standalone helper host must supply `rosterDir` explicitly.
`args(account)` must return stable wire arguments (object key order may change).
Changing a saved plan or provisioning arguments refuses; inspect the existing
roster rather than silently reassigning roles. An interrupted call retains each
email/password and mutation ID before sending, so retrying resumes that entry.
A stale `.lock` refuses concurrent setup; after verifying the old driver is gone,
inspect partial production accounts/grants and remove only that roster lock.
Completed entries are not re-provisioned and existing grants are not repaired
silently. Account/session revocation or password changes require operator review.
It warns when the served schema reports no explicit positive authorization
mention for the minted service seat; rules still decide every operation and the
token gains no implicit grant. Partial failure can leave real accounts/grants.

### E_STAGING

E_STAGING refuses production relabelling or bulk account setup on a non-staging
host. Choose a separate fresh `deploy --staging` store; use the explicit
first-admin recipe below for intended production users. Source edits and a
directory named staging never change a production store's classification.


### Account setup refusals

E_STAGING_INPUT means the account plan is invalid. Provide 1..100 accounts,
named roles, a declared mutation handle and a positive timeoutMs before setup.

E_STAGING_TIMEOUT means the setup deadline expired. Partial accounts/grants
may exist; inspect or discard the disposable deployment before retrying.

E_STAGING_SIGNUP means password signup refused or returned an invalid session.
Inspect the underlying refusal; partial accounts/grants may exist, so inspect
or discard the disposable deployment before retrying.

E_STAGING_PROVISION means the operator mutation refused or returned an invalid reply.
It names the operator mutation, supplied argument names and
refusal code. The default arguments are `{principal, role}`: for a mutation
using different names, provide `args(account)` mapping those names. Repair its
arguments and operator-only rules; partial accounts/grants
may exist, so inspect or discard the disposable deployment before retrying.

### Identity request deadline

E_IDENTITY_TIMEOUT is the internal sign-in deadline cause (SDK E_OFFLINE).
Signup outcome may be unknown: inspect before retrying. Increase timeoutMs to
allow server retryAfterMs waits. seedAccounts maps it to E_STAGING_TIMEOUT
with the partial-account recovery guidance above.

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

## Time and reused stores

`await host.advance("49h")` returns `{now, fired, held, maintenancePaused}`;
`await host.now()` returns a timestamp. Numeric coercion of the report returns
now, so arithmetic and `new Date(report)` still work; typed callers use report.now.
The CLI `clock advance 49h --release staging` reports the same outcomes. Fired
means enqueued: inspect the run state for parked work. Missed periods coalesce
unless eachBoundary is explicit. Each held schedule explains its next boundary.

Staging jumps preserve the remaining lifetime of live password/guest/full/read
sessions by default. Expired or revoked authority stays expired or revoked.
Use `await host.advance("8d", {sessions:"expire"})` to test session expiry
explicitly (CLI --expire-sessions). Dev keeps its existing expiry behavior.
Unplaced uploads and application deadlines still age; upload bytes after the jump.

To exercise a mutation's own deadline check before due sweeps, use
`await host.advance("22d", {drain:false})`, run the mutation, then
`await host.drain()`. All background maintenance stays paused until drain,
a draining advance, or restart; logical expiry and ordinary authorization still
apply. CLI: `clock advance 22d --release staging --no-drain`, then
`clock drain --release staging`. eachBoundary requires draining.

Saved boundaries survive restart and never rewind. A blocked draining advance
refuses E_CLOCK_HELD before moving time, naming the schedule and next window.
Advance beyond that window, keep the cumulative --clock-offset when continuing
across restarts, or deploy a fresh staging directory for an independent test.
`allowHeld:true` (CLI --allow-held) explicitly accepts an already-processed
boundary. Never repeat an ambiguous advance; inspect clock and queued work first.

A staging clock offset belongs to its deployment store. Every CLI advance and
redeploy prints the retained offset; rerunning against that directory keeps
advanced business time. Use a fresh directory for an independent run, and sample
`host.now()` rather than Date.now() for business timestamps after an advance.
