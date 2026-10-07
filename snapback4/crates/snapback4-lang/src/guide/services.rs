//! The services card. Quarry examples are compiled by tests/guide.rs.
pub(super) const CARD: &str = r##"# Services: a worker's seat, and accounts the application authenticates

A service seat gives a worker its own principal for rule-checked operations.
A service can also mint sessions for accounts the application authenticates.

```quarry
table rankings:
  postId: id
  score: int
  unique postId
  read <- allow
  insert <- viewer = 'service:ranker'     -- a text literal beside viewer names a principal
  update <- viewer = 'service:ranker'

mutation rank(postId: id, score: int):
  upsert rankings[postId = postId] { postId, score }
```

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
For this unbound application mint, an absent or non-string `kind` defaults to
`account`; an absent or non-integer `days` defaults to 7; integer days clamp to 1–3,650.

## Operations

`snapback4 token --service ranker [--days 365] [--release <dir>]` prints,
once, a bearer session for the principal `service:ranker`.
The token and one newline are the whole of stdout (even with `--json`), with prose on stderr, so capture it with `TOKEN=$(npx snapback4 token --service ranker)`.
The owning store is printed on stderr: the project's `.snapback4/store.sqlite`,
or `<dir>/store.sqlite` with `--release <dir>`. A token belongs only to that
store; mint one for each isolated audit or proof store after starting its dev
server. While dev or serve owns the store, the CLI asks that server to mint
through its loopback listener. Run it on the server host as the store owner;
`serve` uses `snapback4 token --service ranker --release <dir>`.
The server requires a loopback peer and mutual proof of the per-run secret in
the 0600 `<database>-token` file. The secret never crosses the wire; nonce
proofs bind the service, days and store, and the returned token is encrypted
for this exchange. Public listeners still refuse remote minting. Keep that file private. With the server stopped, the same command mints offline.
`--fresh` (also `--memory`) has no disk store for this CLI to mint into.
Readiness for dev and serve is the first stdout line: the listening URL,
emitted after store and native-module setup. Wait for that line before sending
requests; lifecycle logs and the store banner use stderr.
Declared `snapback/workers/<service>.mjs` entries receive their own service
token through the environment in both dev and serve (guide effects).
Automatically injected tokens are never printed; child logs redact them.
Rules name it
like any principal, so the ranker is admitted and nobody else is; with
its token a worker claims effects (guide effects) and runs any operation
a rule admits it to.
An audience read rule may add `or viewer = 'service:ranker'`; sync ignores
service grants, and `check --residency --verbose` lists them without changing any device's partition.

## Refusals

E_STORE_BUSY from `token` names the owner when its loopback listener or private
proof is unavailable. Restore local access and rerun token, or stop the named
server, mint offline, then restart it. An older server needs that offline path
or an upgrade. Another CLI owner must finish first. Leave `<database>-owner`
in place. A lost reply can leave an unused session until expiry; the CLI does
not automatically retry minting.

E_AUTH means the request has no live principal or uses the wrong authority
for its endpoint. For example, a user's bearer token cannot claim effects:
mint a service token with `snapback4 token --service pusher` against the
same store and supply it to the worker. Application requests use a live
user session; loopback `dev` may instead use `x-snapback-persona: alice`
for a declared persona. `serve` never accepts that persona header. Renew
or sign in again for an expired session, and check that the token belongs
to the backend the URL actually reaches.
Dev distinguishes sessions unknown to this store (often saved before replacing it or issued by another
instance), expired on its clock, and signed out, revoked or replaced by refresh. Sign in again;
discard saved tokens from an earlier store. SDK local/online clients and the app online arm preserve
that message after terminal refusal. Ordinary signed-out clients still ask you to sign in.
Dev remembers at most 4,096 retired-token digests: older/prior-version evidence may be unknown;
expiry takes precedence once the recorded deadline passes. Serve uses identical text for all three:
"this session is not live; sign in again", without disclosing whether a token was issued here.
E_AUTH and family `auth` stay unchanged; no new field is needed. Do not branch on diagnostic prose.


E_OIDC_BINDING means begin did not receive a 43-character base64url SHA-256
binding hash. Hash the browser's fresh binding secret and supply that hash
to begin; keep the secret in that browser for completion. This is not the
provider client secret. Do not log either secret or substitute a fixed value.

E_OIDC_CALLBACK means the provider returned an error, required callback values
are missing, or state, browser binding or transaction admission did not match.
Complete using the original browser's state and binding under the admitting
session. Do not bypass these checks or automatically reuse an uncertain
authorization code; start a fresh login when that context has been lost.

E_OIDC_CONFIG means a fixed issuer, redirect URL, client secret-name, scope,
transaction TTL or session setting is invalid. Check the identity helper's
declared configuration and the matching provider registration. Keep issuer
and redirect selection server-controlled, and supply secrets through the
configured secret lookup rather than callback arguments or logs.

E_OIDC_EXCHANGE means authorization-code exchange or ID-token verification
failed. Check the fixed provider registration and the bounded refusal detail
without logging codes, tokens or secrets. A one-time code is not a retryable
write: do not turn an uncertain exchange into another token request. Begin a
fresh login when the original exchange cannot safely complete.

E_OIDC_HANDOFF means the live handler cannot deliver the minted session, or
its recovered session disagrees with recorded completion metadata. Do not
fall back to an unbound mint, clear durable receipts or create another family
to force completion. Inspect the bound handoff and original invocation; a
fresh login is the supported path for incompatible unpublished mint receipts.

E_OIDC_MINT means the private session endpoint returned an invalid session
shape or value. Check that the worker and backend implement the same bound
identity contract; do not accept a partial response or treat an older unbound
endpoint as compatible. Keep returned bearer material out of diagnostics.

E_OIDC_PROVIDER means discovered or durable provider metadata does not match
the fixed secure configuration. Check the configured issuer and the provider's
advertised endpoints. Do not relax issuer or endpoint validation to accept a
callback-selected provider. Transient discovery before a token request is a
separate retry path; this refusal does not authorize repeating a code exchange.

E_OIDC_RECIPE means a configured generated query or mutation handle is invalid,
the identity query returned no data, or a private transaction row has an
invalid shape. Regenerate the API from the declared identity schema and check
the recipe's exact operation mapping and returned fields. Do not replace the
managed operations with unchecked callback data or expose private rows.

E_OIDC_REPLAY means the transaction is already completing elsewhere or cannot
be completed by this invocation. Collect the original invocation's outcome
instead of racing another completion. Lost or expired admission is not
permission to reset transaction state or repeat the provider's one-time code;
use a fresh login when the original transaction can no longer complete.

E_OIDC_TRANSACTION means the stored transaction is invalid or mismatched, or
the verified transaction did not settle as expected. Check its admitting
session, state and generated transition operations without exposing private
transaction contents. Do not force a successful state or issue an unbound
session to bypass failed settlement.

Action-bound session minting and OIDC: see the package’s [SERVER.md](./SERVER.md).
For E_OIDC_BINDING, E_OIDC_CALLBACK, E_OIDC_CONFIG, E_OIDC_EXCHANGE,
E_OIDC_HANDOFF, E_OIDC_MINT, E_OIDC_PROVIDER, E_OIDC_RECIPE, E_OIDC_REPLAY
and E_OIDC_TRANSACTION, see its Identity refusal reference."##;
