//! The services card. Quarry examples are compiled by tests/guide.rs.
pub(super) const CARD: &str = r##"# Services: a worker's seat, and accounts the application authenticates

```quarry
table rankings:
  postId: id
  score: int
  unique byPost: postId
  read <- allow
  insert <- viewer = 'service:ranker'     -- a text literal beside viewer names a principal
  update <- viewer = 'service:ranker'

mutation rank(postId: id, score: int):
  upsert rankings[postId] { postId, score }
```

`snapback4 token --service ranker [--days 365] [--release <dir>]` prints,
once, a bearer session for the principal `service:ranker`.
The token and one newline are the whole of stdout (even with `--json`), with prose on stderr, so capture it with `TOKEN=$(npx snapback4 token --service ranker)`.
The owning store is printed on stderr: the project's `.snapback4/store.sqlite`,
or `<dir>/store.sqlite` with `--release <dir>`. A token belongs only to that
store; mint one for each isolated audit or proof store after starting its dev
server. `--fresh` (also `--memory`) has no disk store for this CLI to mint into.
Readiness for dev and serve is the first stdout line: the listening URL,
emitted after store and native-module setup. Wait for that line before sending
requests; lifecycle logs and the store banner use stderr.
With an application worker, dev also prints its one-time `service:worker`
token on stdout after the URL, labelled "printed once"; it stays out of stderr logs.
Rules name it
like any principal, so the ranker is admitted and nobody else is; with
its token a worker claims effects (guide effects) and runs any operation
a rule admits it to.
An audience read rule may add `or viewer = 'service:ranker'`; sync ignores
service grants, and `check --residency --verbose` lists them without changing any device's partition.

An application that authenticates its own accounts — a phone number it
verified, a member of its own directory — mints their sessions through its
service and hands each token to that account's device, which then talks
to the server directly with `createLocalClient({ url, session })`:

```ts
import { mintSession, revokeSessions } from "snapback4/worker";
const session = await mintSession(url, serviceToken, "member:42", "member", 30);   // POST /auth/session
await revokeSessions(url, serviceToken, "member:42");                              // POST /auth/revoke
```

The principal is the application's own name for the account, outside the
engine's namespaces (`dev:`, `guest:`, `user:`, `service:` and `system`
are refused). `snapback4 dev` and `snapback4 serve` both take these
tokens; the adapter that owned every request becomes an identity provider
and a worker.

## Refused authentication

E_AUTH means the request has no live principal or uses the wrong authority
for its endpoint. For example, a user's bearer token cannot claim effects:
mint a service token with `snapback4 token --service pusher` against the
same store and supply it to the worker. Application requests use a live
user session; loopback `dev` may instead use `x-snapback-persona: alice`
for a declared persona. `serve` never accepts that persona header. Renew
or sign in again for an expired session, and check that the token belongs
to the backend the URL actually reaches.
"##;
