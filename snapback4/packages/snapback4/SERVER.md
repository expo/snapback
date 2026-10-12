# TypeScript server handlers

One `use server` in any module (`schema.q` is usual) enables the whole
project; repeating it is harmless. Actions, routes and schedules naming an
action require it. Effects (including secrets, retry, backoff, deadline and
cancellation), jobs, schedules naming a job and service seats need no directive.

## Release lifecycle

`deploy <dir>` stages immutable source, validates the live data and selects a release.
`rollback <dir>` selects the preceding immutable release; `rollback <dir> --to N`
selects any existing release, including a deliberate roll forward. Both activate
inside a running `serve` process without restarting it. A stopped deployment uses
the same transaction offline.

### Retained storage and roll forward

Removed durable tables, columns and index definitions become **dormant**. They
stay in separate private storage, invisible to the older programs, rules, sync and
clients. Forward activation restores their data and rebuilds indexes against the
current rows. Rollback selects source; it does not rewind application writes.

- Updating a row under the older release preserves its dormant column values.
- Deleting an active row removes its dormant values. Reusing its id cannot
  resurrect those values. Deleting a parent invalidates dormant references to
  its lifetime, including when an identical parent id/value is recreated.
- A new row written under the older release receives the forward schema's literal
  default or optional null when its newer field is reactivated. Existing dormant
  values restore verbatim, including the defaults they previously represented.
- A required column without a literal default refuses when older-release rows
  lack it. Deploy a bridge with that field optional or defaulted using
  `--restore-dormant`, backfill through a bridge mutation, then deploy the required
  definition. `default now` and `default viewer` never invent historical values.
- An enum value in use refuses rollback with `E_ADOPT`: table/column, affected
  count, up to five ids and values, and a repair/inspection command. Repair those
  rows through the current release, then retry. A flag never coerces or hides them.
- A newly introduced unique index can refuse forward if older writes created
  duplicate keys. Restored references also refuse deleted/reused parents or changed
  read-through audience captures. Authoritative storage cannot become derived
  storage implicitly. Refusals preserve the current release and dormant data.

Reusing dormant names in **new source** requires `deploy <dir> --restore-dormant`.
Selecting an immutable release with `rollback --to N` explicitly selects restoration.
A partial table restoration preserves omitted newer columns as dormant; another
forward can recover them. A rename has two independent names.

`prune <dir>` previews dormant tables, columns and indexes, row counts, logical
serialized bytes, retained asset bytes and sample ids. `prune <dir> --allow-destructive`
permanently removes **all** currently dormant storage and records the exact set in
history. Active rows/programs stay active; later restoration gets empty tables and
ordinary default/backfill behavior. There is no automatic age/size pruning.
`--allow-destructive` on deploy/rollback does not prune or bypass validation.
To convert durable to ephemeral, first deploy without that table, explicitly
prune its dormant storage, then deploy the ephemeral definition.

Dormant asset homes remain retained but cannot be fetched, even by id; pruning
or deleting their active row releases them for the ordinary collector. Dormant
rows run no old jobs/expiry sweeps; candidate liveness applies on reactivation.
The release-store format fences older binaries with `E_STORE`. This cannot recover
storage already deleted by releases before this retention implementation.

### Hot activation, devices and failure

An executing writer completes before activation acquires the server's writer.
A query already pinned to a SQLite snapshot can finish on its old generation.
Unpinned old readers retry through the new factory; queued writes recheck generation
and authority. Validation can pause writes; no process restart is required.
A refused adoption keeps the old backend serving. Native module compilation and
worker source/environment validation happen before commit. A post-commit worker
spawn failure reports degraded availability and retries; it does not undo activation.
Named workers switch their immutable release root and declaration set. An external
`serve --worker` remains an operator-provided entry.

Every changed execution identity gets a fresh monotone generation, including
rollback/forward and native-only wasm changes. Equal schema/program/module content
retains its generation while the activation revision advances. Existing clients
learn the new backend, replace obsolete partitions and reacquire; old watermarks,
late pages and late native module fetches cannot mix with the new generation.
Queued intents follow the existing operation/authority rejudgment rules. Store id
stays the same, so ordinary rollback is not a replaced-store recovery.

The local control socket lives in the private deployment directory (0700), is
0600 and checks same-UID peer credentials. It accepts only numeric immutable
release ids bound to content and database identity; no public HTTP/admin door is
added. Keep the directory and its sidecars private. If the local owner is an older,
unreachable server or another CLI, `E_STORE_BUSY` names the stop/retry sequence.
Never delete the owner sidecar to bypass exclusion.

Serving now joins the private control transport during SIGTERM, SIGINT and SIGHUP shutdown and returns `128 + signal`; fatal signals retain their OS signal status.

The database owns current release, generation, activation revision and history.
Required source/native/worker artifacts are flushed before selecting them. A crash
or convenience-file error can leave `current` or `releases.jsonl` stale; startup
attaches to database authority. A socket timeout after admission is **ambiguous**:
the server continues the operation. Inspect `releases <dir>` before any retry;
do not automatically deploy another release.

### Inspecting history

`releases <dir>` reports authoritative identity, worker status, activation/prune
events and dormant storage. Follow `--after <event-id>` for history and
`--items-after <key>` for inventory pages, using the returned `items_after` value.
Item keys distinguish tables, columns and indexes even when names coincide. `--event <id>` inspects the exact
items recorded by an activation/prune. Continuation fields are explicit; history
is never rewound. This inspection is read-only and works while `serve` is live.

## Declaring actions

```quarry
use server
action invite(email: text <=200) returns { invitation: id } secrets [MAIL_API_KEY]
action refreshModel() <- viewer = 'service:ranker'
```

An action has typed arguments and no Quarry body: the application's
TypeScript handler performs it and returns a declared object. `<- allow` is
the default (any signed-in principal); `deny` pauses it, and a rule over
`viewer` can admit a named service. It cannot read tables or arguments.
`check` generates `Action<A, R>` and `snapback/generated/server.ts` handler
signatures; omitting `returns` preserves `unknown`. Invalid results fail
terminally. See the context below and `guide actions` for
durable steps, secrets, retry/deadline/cancellation policies and service schedules.

Admission binds the session family and principal generation. Refresh preserves
the family; revocation, logout-all or expiry before claim records terminal
`E_ACTION_AUTHORITY` and mints no session. Service callers follow the same rule.
The lease is capped by the family's live expiry. Collecting a result requires
that original authority to stand, or returns `E_ACTION_UNKNOWN` without it.
A fresh sign-in does not restore authority for old requests. An action id binds
its operation and canonical raw wire arguments before validation; changed input refuses
`E_ID_REUSED`. Mutation ids bind the sent operation and canonical raw wire
arguments too. Identical retries replay; legacy unbound records keep their
prior behavior. Object key order does not matter.

`serve <release-dir> --worker <path>` supervises Node 24 with restart backoff
and shutdown. The worker receives only `PATH`, `HOME`, `TMPDIR`, `LANG`,
`LC_ALL`, `TZ`, `SNAPBACK_URL`, `SNAPBACK_WORKER_LEDGER`, declared secrets, an
internal supervision marker and a fresh, unprinted `SNAPBACK_SERVICE_TOKEN`
for `service:worker`. `dev` constructs the same explicit environment; parent
`NODE_OPTIONS` is not copied. `doctor --release <dir>` reports worker counts;
`why <id> [--release dir]` reports work and step metadata and payload
sizes/digests, with actual payloads only under `--values`.
Mutation arguments and results are not recorded. Supervised child sessions
last at most one day; the host replaces the child within that window and
revokes the previous child's family at startup, including after SIGKILL.
`dev` prefers `snapback/server.ts`, `.mts` or `.mjs`, then legacy `worker.*`;
`dev --worker` is refused. `serve --worker` needs an explicitly deployed entry.

Mint with `snapback4 token --service operator --release <dir>` on the server
host, as the store owner, while `serve <dir>` is running or stopped. For dev,
omit `--release`. A live server mints through its writer after checking the
loopback peer and exchanging mutual nonce proofs of its per-run secret in the
0600 `<database>-token` file. The secret never crosses the wire; proofs bind
the service, days and store, expire quickly, and cannot be reused. The token
reply is encrypted for that exchange. A public bind never grants remote
minting. Keep the file private. If the server is older
or unreachable, `E_STORE_BUSY` names it: restore local access, or stop it,
mint offline, and restart. The token plus one newline is all of stdout,
including with `--json`; capture it with
`TOKEN=$(snapback4 token --service operator --release ./release)`.
Prose and the owning store go to stderr.

Service tokens are trusted application-worker credentials for the whole deployment.
A named `service:<seat>` is the principal used by direct queries and mutations;
it is not an isolation boundary for the worker and identity-administration
endpoints. Any service token can claim named actions/effects, verify declared
provider routes, cancel effects, and mint or revoke account sessions. The
supervised `service:worker` intentionally serves handlers for different declared
seats. Provision these tokens only to fully trusted application workers;
provider secrets and service names do not create a per-worker allowlist.

## OIDC identity actions and trusted profile recipe (B1d.1; qualification pending)

`snapback4/identity` supplies `oidcHandlers(config)`, two ordinary generated
action handlers for Authorization Code + S256 PKCE. Provider protocol remains
in the supervised Node server; there is no second backend, callback listener,
provider protocol in the engine, or public service/root capability. The
browser owns the exact frontend callback and POSTs its callback values to the
complete action under the original guest session.

This is deliberately **not yet a qualified ready identity baseline**. The B1c
TypeScript source bridge targets B1b's bound-session contract, but only a
protocol double has exercised the combined source in this checkout. The
initial mint sends the current invocation id, intent `identity-session/v1`
and the exact current claim token; it sends no recovery flag and performs no
local HTTP retry. An unfinished `oidc.mint` step reconciles only through an
explicit `replaceLostDelivery: true` request. A completed mint receipt whose
plaintext token left the live handler also uses that explicit recovery, then
checks the replacement against the recorded principal, kind and original
expiry. No token is added to a step receipt or managed transaction row.

The core contract permits recovery to create the first binding if the
original request never committed. Otherwise it atomically replaces the token
inside the same still-live family, preserving the original expiry. Changed
input or intent, a stale/cancelled/settled/expired claim, revoked admitting,
service or target authority, and a closed or expired issued family refuse;
the helper propagates that refusal without an unbound or new-family fallback.
Public logout of a current token closes its live family; a stale replaced
token receives 401 and cannot close the replacement. These are contract facts,
not evidence that the TypeScript double qualified an actual engine.

The published 0.2.26 engine predates this bound wire and must not be used for a
B1c identity run: it can take the legacy unbound path instead. Actual repaired-
engine HTTP, lost-response/crash and Keycloak qualification remains pending in
the parent integration lane. The unpublished B1a/B1c prototype's unbound
`oidc.mint` receipts are deliberately unsupported: the durable mint input now
includes protocol `oidc-mint-bound/v1`, so both started and completed old-input
receipts refuse with the step input mismatch before any initial or recovery
mint. The helper does not migrate or clear those receipts and does not revoke
an existing legacy token. Start a fresh login under a fresh action invocation
to use the bound protocol; already-parked old work stays parked.
The published 0.2.26 engine also does not preserve `E_OIDC_*` codes through
real core settlement: its action-failure allowlist turns them into the public
`E_ACTION_FAILED` collection result. Protocol-double assertions of helper
failure bodies are not proof otherwise. A separately qualified combined core
repair is required before relying on the more specific public codes.

The helper is configured for one fixed trusted issuer, client id and exact
redirect URI per application/server. It has no provider registry or
multi-provider mix-up claim. Production issuer, discovery endpoints and
redirect URI must use HTTPS. Literal `127.0.0.1` or `[::1]` HTTP is accepted
only with the explicit development option. Google OIDC is the first supported
production configuration; use its exact issuer `https://accounts.google.com`
and a redirect URI registered for the client. That configuration path is
provided, but actual Google qualification is credentials-pending and has not
been run.

The application's managed transaction recipe is server-only. Names are
adaptable; pass their generated operation handles to the helper:

```quarry
use server
use identity guests

table oidcTransactions:
  beginInvocation: text <=128
  admittingPrincipal: principal
  configFingerprint: text <=64
  bindingHash: text <=64
  state: text <=256
  nonce: text <=256
  pkceVerifier: text <=128
  createdAt: time
  expiresAt: time
  loginOrder: int
  proofStartedAt: time
  completionInvocation: text <=128 ?
  verifiedPrincipal: principal ?
  verifiedIssuer: text <=2048 format url ?
  verifiedSubject: text <=1024 ?
  email: text <=320 ?
  emailVerified: bool ?
  unique beginInvocation
  unique state
  expire at .expiresAt
  read <- viewer = 'service:worker'
  insert <- viewer = 'service:worker'
  update <- viewer = 'service:worker'
  delete <- viewer = 'service:worker'

table identityCounters:
  name: text <=64
  value: int
  unique name
  read <- viewer = 'service:worker'
  insert <- viewer = 'service:worker'
  update <- viewer = 'service:worker'
  delete <- deny

table oidcTrustedProfiles:
  principal: principal
  issuer: text <=2048 format url
  subject: text <=1024
  email: text <=320 ?
  emailVerified: bool ?
  evidenceSource: enum('login')
  sourceLogin: oidcTransactions
  proofStartedAt: time
  proofExpiresAt: time
  loginOrder: int
  unique principal
  read <- .principal = viewer or viewer = 'service:worker'
  insert <- viewer = 'service:worker'
  update <- viewer = 'service:worker'
  delete <- viewer = 'service:worker'

query identityByInvocation(invocation: text <=128):
  return oidcTransactions[beginInvocation = invocation]

query identityByState(state: text <=256):
  return oidcTransactions[state = state]

query identityOwnProfile():
  return oidcTrustedProfiles[principal = viewer]

query identityOwnProfileEligibility():
  profile = oidcTrustedProfiles[principal = viewer]
  eligible = profile != null and profile.email != null and profile.emailVerified = true and profile.proofExpiresAt > now
  return { profile, eligible }

query identityProfileFor(principal: principal):
  require viewer = 'service:worker' else OIDC_SERVICE_REQUIRED
  return oidcTrustedProfiles[principal = principal]

mutation identityBegin(id: id, beginInvocation: text <=128, admittingPrincipal: principal, configFingerprint: text <=64, bindingHash: text <=64, state: text <=256, nonce: text <=256, pkceVerifier: text <=128, createdAt: time, expiresAt: time, completionInvocation: text <=128 ?, verifiedIssuer: text <=2048 format url ?, verifiedSubject: text <=1024 ?, email: text <=320 ?, emailVerified: bool ?):
  require viewer = 'service:worker' else OIDC_SERVICE_REQUIRED
  counter = identityCounters[name = 'oidc-login']
  loginOrder = counter.value + 1 if counter != null else 1
  upsert identityCounters[name = 'oidc-login'] { value: loginOrder }
  insert oidcTransactions { id, beginInvocation, admittingPrincipal, configFingerprint, bindingHash, state, nonce, pkceVerifier, createdAt, expiresAt, loginOrder, proofStartedAt: now, completionInvocation, verifiedPrincipal: null, verifiedIssuer, verifiedSubject, email, emailVerified }
  return null

mutation identityClaim(id: oidcTransactions, completionInvocation: text <=128):
  require viewer = 'service:worker' else OIDC_SERVICE_REQUIRED
  tx = oidcTransactions[id = id] ! else OIDC_TRANSACTION_EXPIRED
  if tx.completionInvocation != null:
    require tx.completionInvocation = completionInvocation else OIDC_TRANSACTION_CLAIMED
  else:
    update oidcTransactions[id = tx.id] { completionInvocation }
  return null

mutation identityVerified(id: oidcTransactions, completionInvocation: text <=128, principal: principal, issuer: text <=2048 format url, subject: text <=1024, email: text <=320 ?, emailVerified: bool ?):
  require viewer = 'service:worker' else OIDC_SERVICE_REQUIRED
  tx = oidcTransactions[id = id] ! else OIDC_TRANSACTION_EXPIRED
  require tx.completionInvocation = completionInvocation else OIDC_TRANSACTION_CLAIMED
  if tx.verifiedPrincipal != null:
    require tx.verifiedPrincipal = principal and tx.verifiedIssuer = issuer and tx.verifiedSubject = subject else OIDC_VERIFIED_MISMATCH
  update oidcTransactions[id = tx.id] { verifiedPrincipal: principal, verifiedIssuer: issuer, verifiedSubject: subject, email, emailVerified }
  profile = oidcTrustedProfiles[principal = principal]
  if profile != null:
    require profile.issuer = issuer and profile.subject = subject else OIDC_PROFILE_BINDING
  if profile = null or tx.loginOrder > profile.loginOrder:
    -- Five minutes from the managed begin stamp is the fixed recipe policy.
    upsert oidcTrustedProfiles[principal = principal] { issuer, subject, email, emailVerified, evidenceSource: 'login', sourceLogin: tx.id, proofStartedAt: tx.proofStartedAt, proofExpiresAt: tx.proofStartedAt + 300000, loginOrder: tx.loginOrder }
  else if tx.loginOrder = profile.loginOrder:
    require profile.sourceLogin = tx.id and profile.proofStartedAt = tx.proofStartedAt and profile.proofExpiresAt = tx.proofStartedAt + 300000 and profile.email = email and profile.emailVerified = emailVerified else OIDC_PROFILE_REPLAY_MISMATCH
  return null

action beginOidc(bindingHash: text <=64) returns { authorizationUrl: text <=4096 format url } secrets [OIDC_CLIENT_SECRET] retry 3 deadline 10m
action completeOidc(code: text <=4096 ?, state: text <=256, binding: text <=1024, error: text <=200 ?, iss: text <=2048 format url ?) returns { principal: principal, kind: text <=64, token: text <=2048, expiresAt: time } secrets [OIDC_CLIENT_SECRET] retry 3 deadline 10m
```

Register the helper in the normal generated server. The secret value is a
supervised environment value; the configuration carries only its declared
name. For Google, omit `development` and use HTTPS values:

```ts
import { oidcHandlers } from "snapback4/identity";
import { api } from "./generated/api.ts";
import { server } from "./generated/server.ts";

const oidc = oidcHandlers({
  issuer: "https://accounts.google.com",
  clientId: "the-fixed-google-client-id",
  clientSecret: "OIDC_CLIENT_SECRET",
  redirectURI: "https://app.example/auth/callback",
  transactions: {
    byInvocation: api.identityByInvocation,
    byState: api.identityByState,
    begin: api.identityBegin,
    claim: api.identityClaim,
    verified: api.identityVerified,
  },
});

export default server({
  actions: { beginOidc: oidc.begin, completeOidc: oidc.complete },
});
```

The client first obtains a real session from `guest()`. Generate at least 32
random bytes and encode them as a base64url browser-binding string. Keep that
string and the original guest session only in same-origin `sessionStorage` or
the application's normal secure client store across the redirect. SHA-256 the
UTF-8 bytes of that binding string, base64url-encode the digest, and send only
the digest to `beginOidc`; the server hashes the submitted string, not the
pre-encoding random bytes. Navigate only to the returned fixed-provider
`authorizationUrl`; do not accept an application-supplied redirect target. At
the exact frontend callback, restore the same guest session and submit
`{ code, state, binding, error, iss }` to `completeOidc`, preserving the RFC
9207 `iss` parameter when the provider supplies it. Remove the sensitive
callback query from browser history promptly, and do not load third-party
resources or place the callback URL in access/analytics logs. A3 strips
`Cookie` before durable route handlers, and this flow does not depend on Cookie
access or a separate HTTP backend. Only the original standing session family
can collect the protected final action result; a stale, revoked or unrelated
session cannot.

Discovery is against the fixed issuer. `openid-client` 6.8.8 performs the
code grant with expected state, nonce and PKCE verifier, and non-repudiation
checks require a JWKS-verified ID-token signature. An HS256 token is refused
even when signed with the configured client secret; this adapter requires the
provider's asymmetric signature and does not duplicate the library's JWS
verification. The principal is a fixed
`oidc:` namespace derived from issuer plus `sub`; email is never an automatic
linking key. The helper derives that principal once from the validated exchange
claims and supplies it to the private `identityVerified` mutation; it never
uses the admitting guest, callback claims, email or application-supplied
provider values as the profile key.

The recipe above atomically settles the matching transaction and writes a
trusted provider-evidence profile. `identityBegin` assigns a service-only
logical login order and stamps `proofStartedAt` with managed `now`; callers do
not supply either value. The fixed recipe policy admits verified-email evidence
for five minutes from that stamp. `identityOwnProfileEligibility` evaluates the
strict `proofExpiresAt > now` boundary at query time, not in a read rule. Only a
present bounded email paired with `email_verified: true` is eligible. A newer
login with false or absent verification replaces the former evidence and makes
it ineligible; a delayed older completion cannot replace a newer profile.
Equal email across principals never links them. Profile rows are readable only
by their principal and `service:worker`, and writable only by that service;
the verified mutation grants no membership and exposes no display/email edit.

This order is the managed login-start order, not the provider's email-change
chronology. The recipe does not synchronize provider revocation or email
changes until another login. It is evidence, not account linking, recovery,
organization membership or invitations. Those remain application work, so
this slice is not full Identity/B. A pre-B1d `identityVerified` receipt lacks
the now-required derived `principal`; reusing its write id fails input binding.
There is no receipt migration or backfill: start a fresh login and invocation.

The outer `oidc.exchange` input and validated-claims result remain the replay
boundary, including for completed receipts written by the earlier helper. New
executions first durably complete a non-secret v2 admission marker. Only an
already-completed valid marker permits reconciliation into a separately
reconcilable discovery phase, whose result contains whitelisted public
provider metadata. A discovery timeout, 503 or unreadable response before the
token request can therefore retry under the same invocation and a new claim
without posting the code. A crash before marker completion is conservative:
an unfinished legacy outer exchange, an absent marker, or a marker whose
admission reply was lost parks rather than risking a repeated code request.

The subsequent token phase has no reconcile callback. A provider's definitive
`invalid_grant` and known state, claim, timestamp, algorithm, key-selection or
signature validation refusal settle terminally as `E_OIDC_EXCHANGE`. A lost
or unreadable token response, bare 5xx, `server_error`,
`temporarily_unavailable`, unknown OAuth error, malformed token-response shape,
or JWKS outage after the code POST is uncertain after the one-time code may
have been consumed: it parks and never automatically POSTs that code again.
Completed old or new outer receipts replay validated minimal claims without
discovery, token or JWKS reachability. The local signed-provider tests are
protocol doubles; only the credentials-gated recipe is actual-provider
evidence, and no repaired-engine B1c qualification is claimed here.

Provider discovery, token and JWKS fetches and their response-body reads share
the invocation lifetime with private recipe reads/writes. Cancellation,
deadline, lost authority and handler completion therefore release the handler
promptly even when an injected transport ignores `AbortSignal`. This is a
settlement guard, not a claim that aborting HTTP reverses a provider effect or
a committed server write; an already uncertain step or write stays uncertain.

Access tokens, refresh tokens and ID tokens are neither returned nor stored.
The PKCE verifier lives only in the private expiring transaction row. Default
worker logs, errors and `why` output omit the authorization code, binding,
verifier, declared secret, provider tokens and final Session token. Operator
inspection is privileged: `why --values` intentionally prints stored action
arguments/results (including callback values and a successful final Session),
and `data`/`sql` can inspect private transaction rows. Restrict that access and
do not paste its output into logs or bug reports.

### Managed organizations and invitation policy (B1d.2a)

The identity fixture's sibling `snapback/organizations.q` demonstrates the
managed organization and invitation policy layered on trusted profiles. It
keeps the owner principal immutable, bootstraps the owner's admin membership in
the organization-creation transaction, reserves pending invitation seats with
an expiring unique `(organization, recipientEmail)` row, retains accepted and
revoked invitation history, and appends audit rows in the same transaction as
every membership or invitation transition. Capacity changes and the recipe's
nonsecret lifetime/default-seat policy are service-written; owner/admin status
does not stand in for billing entitlement.

`organizationRecordInvitation` accepts an exact recipient email and a digest.
It is the ordinary managed transaction a later action will call, and an admin
may call it directly. It therefore proves neither entropy nor server-random
issuance. B1d.2b owns the action that generates 32 random bytes, returns or
delivers the raw token, and calls this seam with only its digest. No action or
handler is added in B1d.2a. The accepted staging shape is any 64-character
value already equal to its lowercase form; this does not validate that every
character is hexadecimal. Directly staged non-hex garbage cannot redeem
against the hex result of `sha256(rawToken)`, though it may reserve
admin-owned capacity until revocation or expiry. The later issuance action
always supplies a crypto-derived digest.

`organizationAcceptInvitation` takes the exact raw-token text, computes
`sha256(rawToken)` in the managed interpreter, compares the lowercase hex
digest, and checks pending status, strict invitation expiry, exact verified
profile email and strict proof freshness. A new recipient tentatively consumes
the invitation and reservation and inserts their own member row, then reads
the live member count through that new membership and enforces the current
seat limit. Any refusal rolls the whole transaction back. An existing member
consumes a valid pending invitation without duplicating or changing their
membership and without needing a free seat. A new intent against any consumed
invitation refuses. Record, successful acceptance (new or existing member),
and revoke (first or idempotent repeat) return only the identical public field
set `id`, `organization`, `recipientEmail`, `issuer`, `issuedAt`, `expiresAt`,
`status`, `acceptedBy`, `acceptedAt`, with the current accepted/revoked values;
neither `tokenHash`, raw-token text nor future table fields are exposed.

Email comparison is exact, case-sensitive UTF-8 equality with surrounding
whitespace rejected at recording. There is no normalization, global email
uniqueness or identity linking. Invitation/reservation rules admit admins or an
exact currently verified profile, without time comparisons; consequently a
stale-but-still-verified profile may read the bounded metadata. Preview and
accept separately require fresh proof. Audit is admin-only and has no token or
digest field. Trusted profiles remain own/service, while their five-minute
proof policy, OIDC tables and counters are unchanged.

`adminInvitations` is a bounded, intentionally non-uniform page because the
underlying read rule is the union of admin membership and exact recipient
profile access. Its `complete: false` describes that rule class; callers must
not treat the returned page length as a complete inventory or count.
`invitationMetadata` provides exact-ID point reads, while
`adminOrganizationSummary` gives an authorized owner/admin a uniform point
read of the seat limit and maintained member/live-reservation counts.

This managed recipe has focused operator-driven interpreter qualification,
not complete Identity qualification. The exact hash
primitive contract is UTF-8 text to lowercase hex64 from the shared metered
RustCrypto interpreter. The published 0.2.26 engine predates it; the focused
CLI test refuses an implicit binary, requires an executable plus expected
SHA-256 pin and reports a named skip without the parent lane's hash-capable
binary. It also rejects a canonical scratch parent beneath either a repository
`.git` directory or linked-worktree `.git` file before creating the child.
Frozen base `06171ed` passed 3/3 (two synthetic, one actual), with 49
source-bound refusal probes and 15 recorded invitation IDs; all three earlier
failed runs remain retained. The explicit mutation-output correction
`e1536df94` then passed 4/4 (three synthetic, one actual), retaining those
refusals and IDs and checking all affected success-result projections. Both
independent own-thread delta reviews are READY. No issuance/send, action-result
plaintext boundary, email-provider,
HTTP write-ID/lost-ack, concurrent admission, restart, crash-cut, Google,
full Identity/B or billing-plan claim follows. Hash-only invitation storage
also does not imply that a later action result, step or delivery payload lacks
the raw token, and is not a global erasure claim. The test's `--as` and `--now`
values are operator inputs, not authentication, provider, HTTP or restart
evidence. Its successful frozen helper removed the raw-response journal;
retained stdout and source hashes do not create a retrospective raw-response
audit. These observations qualify only the policy and result projections
described here; they do not qualify invitation delivery or a provider adapter.

### Optional invitation issuance source (B1d.3)

The identity fixture's `invitation-issuance/` sibling stays outside active
`snapback/`. When staged, root `issueInvitation` preserves the OIDC handlers
and uses ordinary generated `organizations.*` operations. Preparation freezes
a 32-byte token, digest, nonsecret config/template and hash-only config/key
fingerprints before a stable record step confirms the same managed write and
exact-ID query. Only then may one fixed-body, fixed-key Resend POST run;
redirects are refused.

Mail run/reconciliation requires a fresh complete point read, current admin,
matching immutable identity, pending state, strict expiry, a ten-minute horizon
and unchanged fingerprints. Historical unknown parks without another POST and
never becomes `not-sent`. This is source/double evidence—not generated-
registry, engine, auth, process-crash, actual Resend, inbox or full Identity/B
qualification. `why --values` can reveal retained step plaintext, and
cancellation cannot retract accepted provider work.

## Handler context

`check` and `dev` generate `snapback/generated/server.ts` from declared
actions and routes. Import its `server` function in the application's server entry:

```ts
import { server } from "./generated/server.ts";
import { api } from "./generated/api.ts";
import { GiveUp } from "snapback4/worker";

declare const model: {
  summarize(text: string, options: { idempotencyKey: string }): Promise<string>;
  lookupResult(key: string): Promise<string>;
};

export default server({
  actions: {
    async summarize({ doc, revision }, ctx) {
      const source = await ctx.query(api.documentAt, { doc, revision });
      if (!("data" in source)) throw new GiveUp("the document is unavailable");
      const text = await ctx.step("model", { doc, revision }, key =>
        model.summarize(source.data.text, { idempotencyKey: key }), {
          reconcile: key => model.lookupResult(key),
        });
      const saved = await ctx.mutate(api.saveSummary, { doc, revision, text },
        { id: ctx.writeIdFor("save") });
      if (saved.state !== "sent") throw new GiveUp("the summary was not saved");
      return { saved: true };
    },
  },
});
```

Here `model` is the application's provider SDK. The generated action arguments,
return type and secret names come from Quarry. Runtime registration requires
exactly the declared action handlers, with flat qualified names such as
`"mail.send"`. A mismatched generated contract fails the invocation before its
handler runs. Optional generated `effects` must name declared effects and use
`(payload: unknown, ctx: EffectContext<the effect's secret names>)`. Low-level
`runWorker` retains its `(payload, EffectMeta)` signature.

Install `typescript` and `@types/node` in the application
(`bun add --dev typescript@5.9.3 @types/node@24`): the checker drives the
TypeScript 5 or 6 compiler API, and TypeScript 7 (the native compiler, the
unpinned `latest`) is refused with `E_SERVER_TOOLCHAIN`. `check` and `dev`
typecheck the conventional server entry and its imports without executing it;
UI files outside that graph are not checked. Handler checks remain strict even
with a permissive application tsconfig. Node 24 runs erasable TypeScript;
relative imports need their `.ts` extension. `dev` rechecks changed server
sources before adopting the schema and restarting the supervised child.
Successful adoption fences that child's service session before new work can
be claimed, including its already-waiting polls; stopping the process is not
the authorization boundary. Manually provisioned service seats are unaffected.

Both `dev` and `serve --worker <entry>` construct an explicit environment from
runtime variables and declared secrets, and redact their values in child
stdout/stderr, including across chunks. A missing secret refuses startup.
`deploy` does not yet package the server's TypeScript import graph: provision
that entry and its dependencies explicitly for `serve --worker`. This is not
a bundled-release or publication claim.

Deploying a backend that uses maintained columns, recorded attribution or declared timelines requires
0.3 devices. Its schema carries engine-derived capability requirements: published
0.2.33 devices refuse installation, adoption and kept-backend reopening with an
unknown `Capabilities` enum variant, and 0.2.33 engines refuse to open or serve
its persisted schema. Upgrade devices before deploying these forms. Current
engines and devices refuse unknown requirements with `E_SCHEMA_CAPABILITY`,
including when an explicit backend would replace an unsupported kept backend.
Downgrading a device below the store's version is unsupported.
Schemas without these forms retain their 0.2.33 encoding.

`server()` returns a `Worker` with `done` and `principal()`. It reads
`SNAPBACK_URL` and `SNAPBACK_SERVICE_TOKEN`; `ServerOptions` can supply explicit
`url`, `token`, `env`, `fetch` and `signal` for a host or test.

`ctx.query` and `ctx.mutate` use the claim's delegated session. They return the
ordinary `Read` and `Write` states, including capped/denied reads, pending
writes and `replayed: true` receipts without historical results. Each call is
its own transaction. Return protected content by managed row id when later
reads should obey current rules.

`ctx.principal` is the invocation's principal. `ctx.invocation` exposes `id`,
`attempt`, an absolute epoch-millisecond `deadline` or `null`, `cancelled`,
and an `AbortSignal`. Cancellation, deadline, lost authority and handler
completion abort that signal and close database access. Cancellation is
cooperative: pass the signal to provider SDKs that accept one. Status polling
runs only while the handler runs; the core remains authoritative on each
request.
An unsuccessful status poll fails closed and permits a later attempt; if a
provider step was already begun, that attempt still requires reconciliation
or parks. A network interruption does not prove the provider did nothing.

Cancel an action with `POST /actions/<id>/cancel` under its originating
principal's standing authority. Cancellation never rolls back committed
writes or provider effects. A `pending` write stays uncertain after cancellation;
reconcile it with the same write id instead of treating it as a failed write.

`ctx.secrets` is a frozen own-property map containing only the action's
declared names. Missing or empty values fail with `E_SECRET_MISSING` before
the handler. Worker error callbacks and failure records redact the runtime's
declared secret values. This runs trusted application TypeScript in Node;
the context does not sandbox access to the process or network.

`ctx.writeIdFor(label)` derives a 128-bit Crockford ID from the invocation id
and label. It is independent of time and attempt. Labels are 1–128 printable
ASCII characters. Reuse a label only for the same mutation and arguments;
the core refuses conflicting intent.

`ctx.step(name, input, fn, { reconcile? })` durably begins a named external
step before calling `fn(key)`. Inputs and outcomes must be plain JSON, at
most 1 MiB: undefined values, non-finite numbers, cycles, sparse arrays,
accessors, class instances and coercing `toJSON` objects are refused.
Names have the same 1–128 printable-ASCII bound as write labels. Equal inputs
join one in-flight call; changed input for an existing name refuses. A
completed step returns its recorded outcome on subsequent attempts.

An unfinished step is uncertain. A later attempt calls `reconcile(key)`
using the same provider key, or parks if no reconciliation was supplied.
Reconciliation must look up or safely deduplicate the provider request.
Throw `ParkStep` from `snapback4/server` when its outcome cannot be established;
`GiveUp` during reconciliation also parks. A transient reconciliation error
can retry. The runtime never automatically repeats the original provider
callback for an uncertain step. A lost begin or completion acknowledgement
is also uncertain, and begin is never retried inside the same claim.

Action results are validated as JSON before settlement; the core validates
the declared shape and bounds. Invalid results fail terminally because
external effects may already have happened. An image/video/file result must name
a recorded asset of the declared kind and byte bound (and, for a file, a type
its allow-list accepts); any supplied metadata
must equal its recorded facts, without extra fields. Validation does not add
metadata to the result or grant permission to read its bytes.
`runWorker` remains available for existing hand-written workers.
Even an action without a `returns` declaration must return plain JSON from
the generated handler: use explicit `null` for no value. Its TypeScript result
is `unknown`, so an implicit `undefined` can typecheck but fails at runtime.
Legacy `runWorker` retains its historical undefined-to-null normalization.

Work ids and step outcomes are retained for the lifetime of the store; there
is no automatic retention expiry or id reuse. `why <id>` prints step state,
input/outcome digests and the provider key, not values unless `--values` is set.
Parked work is not retried automatically; this increment has no operator
resume command. Reconcile externally before deliberately issuing new intent.

### Recording a supported parked-work disposition

This application-owned workflow reconciles parked work through provider
evidence. The example responses below describe a durable local test double;
a production provider adapter needs its own qualified evidence path:

1. Run `snapback4 why operator-parked-action` without `--values`. Confirm the
   action and step are `parked`, record the unchanged attempt count, and take
   the original step's `provider key` from this privileged local inspection.
2. Query authoritative provider-owned evidence with that exact key. The
   fixture uses `GET <provider-double>/lookup?key=<provider-key>` and proceeds
   only on its persisted `200 {"value":"accepted-1"}` receipt. A timeout,
   5xx response or unreadable body is still unknown, not “missing,” and must
   not cause a new provider POST. Even a structured missing response permits a
   deduplicating POST only when that provider's contract makes the same key
   safe. A real adapter needs its own qualified evidence path.
3. Define an ordinary managed application table plus a mutation such as
   `recordDisposition`, guarded by `viewer = 'service:operator'`. Mint that
   seat with `snapback4 token --service operator`, then use normal authenticated
   writes—never `sql`, `data` or direct store edits—to call:

   ```text
   POST /m/recordDisposition
   Authorization: Bearer <operator-token>
   Content-Type: application/json

   {"id":"operator-disposition-v1","args":{"id":"00000000000000000000000001","originalActionId":"operator-parked-action","providerKey":"<provider-key>","providerReceipt":"accepted-1","disposition":"known-accepted"}}
   ```

   The fixture proves an ordinary viewer is refused this mutation.
4. If the first acknowledgement is lost or ignored, repeat the identical
   mutation id and arguments. The managed write returns `replayed: true` and
   the application table contains one row linking the original action, exact
   provider key, receipt and disposition. A second `why` still reports the
   original action and step as parked with the same attempts; no provider
   resend, new key, changed action arguments or core repair occurred.

This row is an application-level operator disposition. It does not turn the
old action's result into `done`, resume it or create a general administration
subsystem. An unknown or unqueryable outcome remains unresolved; never issue a
blind replacement send. Recovery and compensation are application-specific,
The core evaluates action and effect step transitions in one work-kind-aware
policy. Effects use `_effect_steps` and the provider-key domain
`snapback4:effect-step:v1`; `_action_steps`, action keys and action behavior are
unchanged. Generated effects receive only frozen `ctx.effect` metadata (`id`,
`effect`, `attempt`, `seq`, `at`, `worker`), live `ctx.invocation` (`id`,
`attempt`, `deadline`, `cancelled`, `signal`), their declared `ctx.secrets`, and `ctx.step`; they do not gain
the action context's principal, query, mutation or write-id authority.

Current `runWorker` requests fenced effect claims; hand-written wire workers
request `fenced: true` and return the `leaseToken` as
`x-snapback-effect-lease`. A fenced worker can call
`POST /effects/<id>/steps/<name>/begin` with `{ input, reconcile? }`, `/done`
with `{ result }`, and `/park` with `{ error? }`. These routes mirror action
step JSON and require exactly one nonempty lease header. Completion replays;
changed input refuses; an uncertain provider outcome reconciles under the
same key or parks the effect. Oversized outcomes park with E_STEP_RESULT and
unknown outcomes park with E_STEP_PARKED. Parked effects are excluded from
lease expiry and reclaim. Policy-allowed cancellation may move parked work to
failed/E_EFFECT_CANCELLED but never resumes it.

`POST /effects/claim` also accepts optional `declarationContract`, but only
with one nonempty `effect` and `fenced: true`. The digest uses the literal
generic-payload validator identity, exact effect name and full current
`WorkSpec`; payload and release do not enter it. After BEGIN the strict claim
samples time and supervisor revision once, authenticates the current service,
and compares this digest before expiry, selection, leasing or other work
mutation. A missing current declaration or mismatch returns
E_EFFECT_GENERATION with rows, attempts and steps unchanged. Claim JSON carries
the server-derived `declarationContract`; omission preserves low-level
`runWorker` behavior. Generated TypeScript embeds the Rust-computed digest for
each exact effect name and full `WorkSpec`; it never recomputes the digest.
Generated polls include `fenced: true` and that name's digest. A generation
refusal, missing digest or mismatch stops and rejects the generated worker
before handler execution or settlement.

`POST /effects/<percent-encoded-id>/status` requires exactly one nonempty
`x-snapback-effect-lease` before entering the engine. Its immediate writer
transaction takes one post-BEGIN authority/time sample, authenticates the
current service, loads that exact row and enforces its admitted contract.
Running status requires the claiming service and exact current lease; an
expired or lost lease reports E_EFFECT_LEASE without requeue, reclaim, unpark
or successor authority. A current deployment-trusted service may read terminal
safe metadata. Only the target row's deadline or recorded cancellation may be
finalized. The response contains only `id`, `attempt`, `state`, `deadline`,
`cancelled` and `errorCode`.

The generated effect context polls that exact status route under the service
bearer and private effect lease. Current matching running status continues;
cancellation, deadline, terminal state, lease/generation/auth loss or transport
uncertainty aborts the context and suppresses top-level settlement. `ctx.step`
uses `/effects/<encoded-id>/steps/<encoded-name>/{begin,done,park}` under the
same private lease. Service/effect tokens and declared secret names and values
are redacted from failures. The signal is cooperative and does not imply that
aborting it cancels an already committed provider call.

New emits retain the current release as admission provenance and store a
contract over the exact generic `Value` payload, effect name and full admitted
work policy. Release is excluded from declaration and row-compatibility digests,
so changing only the current release does not park older work. Effect payloads
have no typed declaration yet, so this makes no same-name typed-change safety
claim; a future typed surface must replace the generic validator tag with its
schema identity. A persisted NULL contract is the explicit legacy bypass. A
legacy effect represented only in `schema.effects` recomputes the implicit
admission policy, including its 4s initial backoff, rather than becoming an
absent declaration. Strict HTTP claim, step and settlement open an immediate
transaction, sample time and supervisor revision once, authenticate the current
service, and compare that contract. A mismatch returns E_EFFECT_GENERATION.
Queued or running work parks before lease validity is considered, clearing
claim, lease and scheduling fields; sent, satisfied, failed, cancelled and
already parked evidence is not rewritten. Legacy unfenced claim/settle wire
remains compatible. Existing direct core claim/settle methods retain their
historical compatibility behavior and do not provide the strict HTTP authority boundary.
Only a service may call `POST /effects/<id>/cancel`; cancellation cannot stop
provider I/O already in flight.

This checkpoint is the generated server effect-context slice over the existing
claim/status/step substrate. It adds no typed effect payload, query/mutate/data/
admin authority, PostgreSQL effect work, provider qualification, process-crash
proof or complete B claim.

## Routes and webhooks

```quarry
use server
route reportDownload: post "/report-download" wait 5s
route billingHook: post "/hooks/provider-billing" as service:billing secrets [BILLING_KEY] retry 8 backoff 2s wait 5s
```

The generated `Routes` map requires every declared handler, with the same flat
qualified names as actions. A route and action may share a name. Routes never
appear in the client API or public action registry. Empty action/route maps may
be omitted; a supplied empty map accepts no undeclared handler.

```ts
import { server } from "./generated/server.ts";
import { api } from "./generated/api.ts";
import { GiveUp, Retry } from "snapback4/worker";

declare const reports: { export(body: Uint8Array, ctx: unknown): Promise<BodyInit> };
declare const billing: {
  verify(body: Uint8Array, headers: Headers, key: string, options: { signal: AbortSignal }): Promise<boolean>;
  decode(body: Uint8Array): unknown;
};

export default server({ routes: {
  async reportDownload(req, ctx) {
    // Runs under the caller's live session and ordinary read rules.
    return new Response(await reports.export(await req.rawBody(), ctx));
  },
  billingHook: {
    async verify(req, { secrets, signal }) {
      return billing.verify(await req.rawBody(), req.headers,
        secrets.BILLING_KEY, { signal });
    },
    async handle(req, ctx) {
      const event = billing.decode(await req.rawBody());
      const saved = await ctx.mutate(api.applyBillingEvent, event,
        { id: ctx.writeIdFor("apply") });
      if (saved.state === "pending") throw new Retry("the write is uncertain");
      if (saved.state !== "sent") throw new GiveUp("the event was refused");
      return new Response(null, { status: 204 });
    },
  },
} });
```

Here `billing` and `reports` are application adapters, not built-in services.
The application mutation deduplicates provider event IDs and checks revisions
to handle out-of-order deliveries. Body deduplication does not order distinct
events. Use `ctx.step` for external side effects, including reconciliation after
an uncertain outcome; no database transaction spans the handler.

A default route requires a live bearer session. Only an explicit
`as service:<seat>` route uses a provider verifier. Its `verify` callback has
declared secrets and an abort signal, **no delegated database context**. Return
exactly `true` or `false`; false answers 403 (`E_ROUTE_VERIFY`) with no durable
admission. An exception, missing verifier or unavailable core answers 503.
Verify exact raw bytes before parsing. Each call to `rawBody()` returns a fresh
copy, and every delivery verifies anew, including retries of completed work.

After verification the core durably admits one private action under the
declared service seat, before `handle` runs. Retries with identical body bytes
join that invocation despite fresh signature headers. Session-route IDs are
also scoped to the principal and originating session family. Revocation or
changed declarations cannot rebind old work to fresh authority. The handler
does not treat changed headers alone as new intent. Include an explicit nonce
or revision in the body when requesting a new operation (for example a new
report export); repeat the same bytes when retrying. Route IDs and responses
have the work-record lifetime, not an automatic deduplication expiry. The handler
receives the first verified envelope with Authorization, Proxy-Authorization,
Cookie and x-snapback-persona removed; other headers and body bytes are stored
as work payloads. Only the body, not header spelling, is byte-exact.

The request waits up to declared `wait` (default 5s, maximum 25s), including
verification. A settled response is returned; otherwise 503 (`E_ROUTE_PENDING`)
asks for the same-body retry. A 503 alone does not prove admission. Disconnects
and worker crashes do not undo admitted work. Plain `GiveUp` records a redacted
application refusal and acknowledges it with bare 204; `ParkStep` and typed
runtime errors are not acknowledgements. Exceptions and explicit 5xx handler
responses follow the retry policy, never a cached successful 5xx completion.

This increment supports static POST paths only, without query strings,
captures, GET routes or streaming forwarding. Request/response bodies are at
most 64 KiB, headers 64 fields/16 KiB. A `Response` is fully buffered, with a
10s bound (or earlier invocation cancellation), before settlement. Invalid or
oversized responses fail terminally with `E_ROUTE_RESULT`, because effects may
already have occurred. `Set-Cookie` fields stay separate; transport framing
headers cannot be supplied. HTTP 204, 205 and 304 must have empty bodies.

`dev` still binds loopback by default. Explicit
`dev --bind 0.0.0.0 --i-understand-cleartext` permits provider ingress through a
trusted TLS proxy. Only an exact declared POST path bypasses the development
loopback gate. Development binding accepts only loopback or wildcard IPs
(`0.0.0.0`/`::`), preserving a loopback path for the supervised worker.
Personas, seed, schema, queries, worker doors, unknown paths,
query variants and mismatched methods remain gated. Route waits have 16 slots
separate from 4 verification polls, 4 generated-registry polls, 32 legacy
worker/long-poll slots and 32 short requests. Generated handlers share one
action poll loop, grouping names by session lifetime and rotating through
chunks of at most 128; verification uses its own rotating loop. Multiple
chunks use at most 1s waits, so idle handlers cannot monopolize claim capacity.
Legacy `runWorker` keeps its per-name polling unless `actionRegistry: true`.
Unverified
tickets are ephemeral, bounded and fenced: a verifier/core crash before
admission yields a retry, not an unauthorized durable invocation.

## Action-bound session minting

An action performing identity verification may bind that same `POST
/auth/session` mint to its current claim by also sending
`x-snapback-action-lease: <claim session.token>` and `binding: {
invocationId, intent: "identity-session/v1" }`. The first call atomically
records the intent and new session. An ordinary repeat refuses because token
delivery is ambiguous. After a lost committed response, repeat from the
current live claim with `replaceLostDelivery: true`; this invalidates the
whole recorded family and returns one replacement capped at the original
expiry. Changed inputs, stale or settled claims, revoked authority, and a
logged-out or expired target family refuse. The record stores no raw token.
The handler must return the delivered Session in its eventual protected result.
Bound mode begins when either the `binding` key or any action-lease header is
present; its object and single nonempty lease must be exact, so neither signal
can fall back to an unbound mint. With both absent, the legacy route still
defaults an absent or non-string `kind` to `account`, an absent or non-integer
`days` to seven, and clamps integer days to 1–3,650. Bound integer days use the
same clamp; missing bound optionals use the same `account` and seven-day defaults.

## Identity refusal reference

### Browser binding

E_OIDC_BINDING means begin did not receive a 43-character base64url SHA-256
binding hash. Hash the browser's fresh binding secret and supply that hash
to begin; keep the secret in that browser for completion. This is not the
provider client secret. Do not log either secret or substitute a fixed value.

### Refused provider callback

E_OIDC_CALLBACK means the provider returned an error, required callback values
are missing, or state, browser binding or transaction admission did not match.
Complete using the original browser's state and binding under the admitting
session. Do not bypass these checks or automatically reuse an uncertain
authorization code; start a fresh login when that context has been lost.

### Invalid identity configuration

E_OIDC_CONFIG means a fixed issuer, redirect URL, client secret-name, scope,
transaction TTL or session setting is invalid. Check the identity helper's
declared configuration and the matching provider registration. Keep issuer
and redirect selection server-controlled, and supply secrets through the
configured secret lookup rather than callback arguments or logs.

### Refused code exchange

E_OIDC_EXCHANGE means authorization-code exchange or ID-token verification
failed. Check the fixed provider registration and the bounded refusal detail
without logging codes, tokens or secrets. A one-time code is not a retryable
write: do not turn an uncertain exchange into another token request. Begin a
fresh login when the original exchange cannot safely complete.

### Lost session handoff

E_OIDC_HANDOFF means the live handler cannot deliver the minted session, or
its recovered session disagrees with recorded completion metadata. Do not
fall back to an unbound mint, clear durable receipts or create another family
to force completion. Inspect the bound handoff and original invocation; a
fresh login is the supported path for incompatible unpublished mint receipts.

### Invalid mint response

E_OIDC_MINT means the private session endpoint returned an invalid session
shape or value. Check that the worker and backend implement the same bound
identity contract; do not accept a partial response or treat an older unbound
endpoint as compatible. Keep returned bearer material out of diagnostics.

### Refused provider metadata

E_OIDC_PROVIDER means discovered or durable provider metadata does not match
the fixed secure configuration. Check the configured issuer and the provider's
advertised endpoints. Do not relax issuer or endpoint validation to accept a
callback-selected provider. Transient discovery before a token request is a
separate retry path; this refusal does not authorize repeating a code exchange.

### Invalid identity recipe

E_OIDC_RECIPE means a configured generated query or mutation handle is invalid,
the identity query returned no data, or a private transaction row has an
invalid shape. Regenerate the API from the declared identity schema and check
the recipe's exact operation mapping and returned fields. Do not replace the
managed operations with unchecked callback data or expose private rows.

### Refused completion replay

E_OIDC_REPLAY means the transaction is already completing elsewhere or cannot
be completed by this invocation. Collect the original invocation's outcome
instead of racing another completion. Lost or expired admission is not
permission to reset transaction state or repeat the provider's one-time code;
use a fresh login when the original transaction can no longer complete.

### Invalid identity transaction

E_OIDC_TRANSACTION means the stored transaction is invalid or mismatched, or
the verified transaction did not settle as expected. Check its admitting
session, state and generated transition operations without exposing private
transaction contents. Do not force a successful state or issue an unbound
session to bypass failed settlement.

## Ephemeral tables and change polls

`ephemeral 1s` through `ephemeral 60s` tables live in one server process's
memory. They are empty after restart, adoption, generation change or store
replacement. `POST /m/<name>` for an ephemeral operation executes against a
consistent durable read snapshot and the shared memory hub. It makes no
SQLite commit, replay record or durable sequence increment. A correlation
`id` is echoed; repeating it executes again. Client-supplied row ids are ignored.

The successful reply is `{ state: "sent", id, result, ephemeral: { epoch,
incarnation, tables }, store_id, head }`, with no `seq`. Every refusal is
HTTP 200 `{ state: "failed", id, why, store_id, head }`, including rule,
generation, rate and capacity refusals. `E_RATE_LIMIT` remains in the `auth`
family: a separate session bucket allows 20 ephemeral writes per second,
burst 40, under both `dev` and `serve`. `E_EPHEMERAL_FULL` is retryable:
one principal may own 1,000 live rows or 4 MiB of declared image/index size;
the global backstop is 100,000 rows or 512 MiB. Capacity charges schema bounds,
never private payload lengths. Table caps and ordinary work meters also apply.

A query with generated `ephemeralReads` returns `ephemeral: { epoch,
incarnation }` along with its normal answer and `nextExpiry`. Its memory
rows and epoch share the same lock. Deadlines are hidden from row images;
clients re-read at `nextExpiry`. Expiry reclaims memory without incrementing
the epoch. `dev clock advance` uses the same clock as ephemeral deadlines.

`GET /changes` accepts three additional parameters:

- `eph=<epoch>`: the client's earliest watched answer in this incarnation.
- `ephi=<incarnation>`: the memory store incarnation the client observed.
- `ephTables=<comma-separated names>`: absent means all ephemeral tables;
  present and empty means no ephemeral table interest.

Clients send all three parameters only when the backend declares an ephemeral
table, including an empty `ephTables` when no watch reads one. Durable-only
clients omit all three. Ephemeral backends advertise `X-Snapback-Ephemeral: 1`
on timed responses and poll heartbeats, exposed to browser JavaScript. This lets
the online tier discover `/schema` facts without extra durable-only requests;
a legacy discovery poll is immediately reissued when support is learned.
Adoption publishes the new store identity, generation
and ephemeral incarnation together and wakes held polls for the new generation.

The response adds `ephemeral: { epoch, incarnation, tables }` when any of
those parameters is present. With none, its existing body shape is unchanged.
A matching write wakes the poll; an unrelated write keeps it waiting without
resetting its heartbeat or deadline. An ephemeral-only answer waits until
100 ms after poll entry. An incarnation change wakes every poll; a ring gap
invalidates every table in the interest set. These versions are independent
of durable `seq`. Durable invalidation continues unchanged.

Use one serving process: memory rows and epochs are not shared across hosts.
`data` and `sql` cannot inspect these process-local rows. Seed and load refuse
them; PostgreSQL does not support ephemeral schemas.

## Long-wait capacity

A held wait (`GET /changes?wait=N`, `POST /a/<action>`, a worker's
`POST /effects/claim` or `/actions/claim`) costs one connection thread and
one pool worker for its duration. Three bounds size them:

| knob (`dev` and `serve`) | environment | default | range | bounds |
|---|---|---|---|---|
| `--long-waits N` | `SNAPBACK4_LONG_WAITS` | 1,024 | 1–4,096 | viewers' held change polls and action calls |
| `--long-waits-per-principal N` | `SNAPBACK4_LONG_WAITS_PER_PRINCIPAL` | 16 | 1–`--long-waits` | held change polls one principal may hold (tabs, devices) |
| `--claim-waits N` | `SNAPBACK4_CLAIM_WAITS` | 32 | 1–1,024 | service workers' claim polls, a separate pool |

A flag wins over its variable. The HTTP connection cap is derived: 128 for
everything else plus `--long-waits` plus `--claim-waits` (1,184 by default).
Startup prints both on one line, for example
`snapback4 host: long waits: 1024 viewer (≤16 change polls per principal),
32 worker claim; HTTP connections=1184; descriptors needed ≈5248`. Against
a running `dev`, `doctor` repeats the connection cap and `GET /dev/status`
carries the sizes under `fileDescriptors.longWaits`.

The upper bound is descriptors and threads. Each connection holds four
descriptors (512 more for the process), so startup refuses explicit sizes
the raised soft NOFILE limit cannot carry (`E_HTTP_LIMIT`, naming the
arithmetic). A default that does not fit is lowered to fit (never below 32)
and the startup line says so. Each held wait is two OS threads: 4,096 viewer
waits are about 8,200 threads, inside Darwin's 16,384 per process; under
systemd, raise `TasksMax` (default about 4,900) before going past 2,048.

A full bound is refused at once, never queued, with `E_STREAMS` (family
`limit`, retryable, `guide wire`):

- HTTP 503 with `Retry-After: 2` when every viewer long wait or every claim
  poll is held. The body names the pool and its size.
- HTTP 429 with `Retry-After: 5` when this principal already holds its share
  of held change polls. A poll without `wait` (`GET /changes?since=<seq>`)
  is never counted against the share or the pool.

Nothing was admitted by a refused request. The published client treats
`E_STREAMS` on `/changes` as a pause, not an outage: its link stays online,
it waits Retry-After, then polls without `wait` at the Retry-After pace for
30 seconds before holding again, so live queries keep learning of commits. A
worker should retry its claim after Retry-After. Viewers cannot exhaust the
claim pool, and workers cannot exhaust the viewers'.

One commit wakes every held poll. Polls woken by the same publication at
the same cursor share one answer, read once on a pooled reader; a new or
unheld poll always reads the store itself, and a parked poll holds no SQLite
connection. Measured on the M5 MacBook (36 cores, release build, `snapback4
dev --fresh`, the repository's long-wait measurement script, held
`/changes?wait=25&heartbeat=1` from one principal, 2026-10-08):

| held polls | RSS | threads | descriptors | `/q` p50 / p99 while held | one commit answers all (persona / bearer) | all re-poll at once (persona / bearer) |
|---|---|---|---|---|---|---|
| 256 | 36 MiB | 521 | 1,042 | 0.20 / 0.58 ms | 6 / 58 ms | 74 / 21 ms |
| 1,024 | 98 MiB | 2,057 | 4,136 | 0.21 / 0.76 ms | 21 / 237 ms | 38 / 82 ms |
| 2,048 | 196 MiB | 4,105 | 8,373 | 0.33 / 1.20 ms | 58 / 497 ms | 94 / 224 ms |
| 4,096 | 339 MiB | 8,201 | 16,412 | 0.61 / 1.76 ms | 334 / 1,525 ms | 416 / 811 ms |

Each held poll costs about 85 KiB of RSS, two threads and four descriptors.
A bearer poll rechecks its session before answering; that recheck is most of
the bearer column. Opening thousands of new connections at once overflows
Darwin's listen backlog (`kern.ipc.somaxconn`, 128): the 4,096 run saw about
300 connection resets, which clients retry. Tens of thousands of idle
streams need evented parking, a later step.
