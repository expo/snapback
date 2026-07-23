# LLP 0077: Sender-constrained browser auth

**Type:** Spec
**Status:** Draft
**Systems:** Auth, Browser client, HTTP, WebSocket, Hosted runtime, Control plane, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-22
**Revised:** 2026-07-23 (third model-family review round — Fable NOT READY,
Codex NOT READY, artifacts under `llp/reviews/0077-*`. Both families found
that the round-2 additions introduced fresh contradictions; this revision
repositions the LLP 0058 forbidden-field check to post-admission
(pre-body admission is preserved), restricts `SNAPBACK_AUTH_REQUIRED` to a
genuinely absent header and states the malformed-carrier challenge as a
deliberate anti-oracle choice, changes the canonical-URI rule to reject —
not resolve — dot-segments, marks the per-custody serialization as normative
but unimplemented (defect 7), adds the hosted-constructor structural-exclusion
gap (defect 8), corrects the retention wording and ledger item 4, adds the
uninstalled-cover-nonce note, and records the reset/epoch, issuance-wire, and
cover-nonce design decisions as open questions rather than asserting
unproven answers. The eight-item ledger still gates any positive capability).
2026-07-23 (second model-family review round — Fable READY,
Codex NOT READY, artifacts under `llp/reviews/0077-*`. This revision closes
the nonce-expiry deadlock Codex found in the desired design (a challenge
issues a fresh generation only when the current nonce is absent or expired,
never for a live one), pins the replay retention arithmetic to `iat+30+1`
with an exclusive purge boundary, adds the per-custody request-serialization
rule for concurrent protected requests, promotes the bind-only-at-issuance
rule into the normative Issuance section, adds the LLP 0058
forbidden-body-field and `SNAPBACK_AUTH_REQUIRED` precedence steps, the
`(admission_epoch, proof_id)` replay tuple, and the canonical-URI
normalization algorithm, and narrows the bound-server-test checkpoint claim
to what the test exercises. The six-item defect ledger's code fixes still
gate any positive capability).
2026-07-23 (first model-family review round — Fable NOT READY,
Codex NOT READY, artifacts under `llp/reviews/0077-*`. This revision fixes
the nonce-challenge contradiction normatively (challenges return the
still-current nonce and never rotate; rotation only inside verified-proof
consumption), proof-gates every sender-bound grant use regardless of carrier,
records the LLP 0057 exchange-wire amendment explicitly, adds the exact
issuance payload, subprotocol grammar, nonce constants, RFC 9449 deviation
list, and LLP 0057 grace/lost-refresh composition rules, narrows
implementation-checkpoint claims to what the tests prove, and adds a known
implementation defects ledger that blocks any positive capability claim).
2026-07-22 (initial wire, custody, replay, and rollout contract required by LLP 0060 C3)
**Related:** LLP 0039, LLP 0053, LLP 0055, LLP 0057, LLP 0058, LLP 0059, LLP 0060, LLP 0064, LLP 0072, LLP 0074

**Implementation checkpoint (2026-07-22):** The hosted-only browser entrypoint
excludes the generic client constructor and the constructor/setter
direct-bearer seams; inherited transport fields remain writable public
properties, and a direct-mutation sentinel is pending. Its
coordinator-owned transport now generates the non-extractable P-256 key,
performs issuance, installs bearer/key/nonce as one `AuthCustodyV3` transition,
signs protected HTTP requests, rotates each response nonce under the exact
custody revision and sender generation, recovers one typed nonce challenge,
refreshes bearer and nonce atomically, and deletes the key on logout.

The unexported browser primitive
generates a non-extractable P-256 key and exact ES256 proof. Rust validates the
closed header/payload, canonical encodings, method/URI/token/nonce/thumbprint
bindings, time window, signature, and proof id. A Node WebCrypto → Rust
cross-language test passes (all client suites execute in Node with WebCrypto
and an IndexedDB-compatible store, not a real browser). A post-hosted-preflight SQLite authority durably binds new v2 session
families to thumbprints and atomically consumes bounded replay ids; v1 sessions
remain unbound. The same authority now issues bounded admission/family nonce
generations and atomically couples successful proof consumption, replay
retention, nonce retirement, and next-nonce installation. A redacted pre-body
admission function composes canonical session-token classification, family
lookup, challenge issuance, proof verification, and the atomic consume/rotate
cut without resolving a user projection. The registered-route middleware now
invokes that cut before its admitted-body wrapper can be polled. Its proof URI
comes only from a target-authenticated canonical HTTPS origin plus the routed
path; query and forwarding headers cannot retarget it. Challenge and successor
nonces cross a shared response-header cell so later policy/body failures still
return the installed `DPoP-Nonce` with `no-store`. Replay/nonce DDL is
initialized only when a target-authenticated hosted serving authority is
installed, and an executable test proves missing/duplicate proof refusal
without polling an adversarial body. `AuthCustodyV3` extends the existing
single IndexedDB `custody` row with the non-extractable key, exact public
identity, and nonce generation. Live tests prove private/public-key match,
interrupted-transition recovery, cross-reopen structured-clone persistence,
revision-plus-generation-fenced credential/nonce rotation, refusal of a legacy
constraint-attachment transition and of v3-only credentials at legacy startup
(the end-to-end revoke/clear/re-exchange migration flow itself is not yet
implemented or tested), and key deletion on logout. The coordinator and storage record are
integrated. A client integration test covers issuance, authenticated session
projection, ordinary resource work, lost-response challenge recovery, refresh,
the grant-token WebSocket proof shape, and exact empty-204 logout. Logout
commits the response nonce under the captured sender generation, then clears
the bearer, private key, and nonce through the existing transport-resume
barrier before returning.

The connection-open cut copies the verified session-family thumbprint and
hosted admission epoch into the exact grant. Browser WebSocket upgrade carries
a second compact proof in a dedicated subprotocol over `GET`, the canonical
HTTPS-normalized live URI, the grant-token hash, and the current nonce. The
server verifies and atomically consumes it before the existing
connection-token/generation gate and protocol switch. A bound-server test
exercises request-code, key-bound exchange, authenticated projection, refresh,
and protected connection open at the router level (`router.oneshot`); only the
sender-bound WebSocket upgrade crosses a real bound TCP listener. Reconnect
re-enters through a forced protected session projection, so an upgrade nonce
whose response header was inaccessible to browser JavaScript is recovered by
the same one-challenge rule before a new grant proof.

The verifier negative corpus now covers every accepted binding axis and both
inclusive time boundaries, plus closed header/JWK/payload fields, algorithms,
canonical base64url, proof-id length, duplicate fields, compact framing, and
signature tampering. Two independent SQLite connections racing one proof id
produce exactly one success and one replay refusal. Client sentinels prove
sender material does not enter URLs, cross-context wakeups, localStorage
hints, app-visible settled state, or reflected transport errors; the last
check found and closed a gap where ordinary protected requests sanitized the
whole proof but not reflected nonce/JWK/proof segments.

The served route also fails closed before body polling when the replay table is
unavailable, emits the authority-unavailable diagnostic, and accepts the exact
same proof and nonce only after the authority is repaired; the outage consumes
neither half of the atomic cut.

The served reset train now terminalizes the sender-bound connection grant,
deletes its session-family binding in the durable reset transaction, and
refuses a correctly signed stale post-reset request before polling its body.
Declared-restore coverage binds a sender session before the cut and proves the
revoked restored token no longer resolves afterward. Client pressure coverage
proves a carrier-only expiry may rotate the nonce without deleting custody, a
same-stream proof refusal remains non-destructive, and a bounded anonymous
probe clears bearer/key/nonce only after its authenticated handshake proves a
different authorization-stream incarnation. A sender-bound live socket now
accepts the typed `durableDelete` terminal frame through the ordinary
authorization-invalidation protocol, shuts app-visible publication, deletes
the exact `AuthCustodyV3` predecessor, and completes anonymous transport
resumption before the test observes the successor.

A production adapter-authenticated admission producer, served pre-body
coverage for every negative axis, the remaining served expiry/restore,
key-recovery, and broader pressure cases, a true two-process replay race, an
IndexedDB reopen-after-logout check, the end-to-end v1 migration flow,
independent review, and remote acceptance remain unimplemented. No capability
is positive.

**Known implementation defects (2026-07-23, from the `llp/reviews/0077-*`
round-1 reviews).** Each blocks any positive capability claim and requires a
fix plus a negative test:

1. The challenge path rotates the family's durable nonce on unauthenticated
   missing/mismatched-proof requests (`fresh_challenge` → `issue_sender_nonce`
   installs generation+1), contradicting the normative
   challenge-never-rotates rule below and handing a copied-bearer holder a
   nonce-churn lever that can race the legitimate client's single retry into
   lockout.
2. Connection-token HTTP acts (live, outbox, ephemeral routes) accept the
   bare grant header without sender admission, and WebSocket upgrade accepts
   the grant through the permitted header carrier without a proof — bare-
   bearer paths for sender-bound grants, contradicting the every-use rule in
   "WebSocket and connection binding". Generic HTTP proofs also hash the
   session bearer where a grant is the presented credential.
3. Sender lookup joins only the current session token hash, refusing
   proof-bearing requests that present an in-grace superseded token and
   breaking LLP 0057's tombstone-grace resolution matrix.
4. Replay retention is exactly the accepted window (35 s) with
   inclusive-boundary purge (`expires_at_seconds <= now`), one second short at
   the final inclusive second; the contract requires expiry at `iat + 30 + 1`
   with an exclusive purge boundary.
5. The client installs the successor `DPoP-Nonce` without adding it to the
   diagnostic redaction set, and parses a successful response body before
   failing on a missing successor nonce, so a committed effect can be
   observed as a failure and retried.
6. `bind_new_session_sender_constraint` can bind any existing session id;
   the binding capability must be restricted to the session-issuance
   transaction so no supported API can bind an extant v1 family.
7. The per-custody request serialization the Nonce protocol requires is not
   implemented: concurrent client calls each sign under the same generation
   and race the successor-nonce compare-and-set. A per-custody queue must span
   proof creation through nonce-header commit for HTTP, refresh, logout,
   connection open, and WebSocket initiation.
8. The hosted browser entrypoint subclasses the generic client, so its
   constructor (which accepts a bearer) is reachable through the prototype
   chain, and inherited transport fields plus the mutable `senderConstrained`
   flag are writable — the structural-exclusion property LLP 0060 requires is
   not yet structural. It needs a non-inheriting façade (or an intrinsic v3
   custody posture with privatized transport state) plus prototype-graph and
   direct-mutation sentinels.

## Summary

Hosted browser sessions use a versioned sender-constrained v2 protocol. Each
custody installation owns one non-extractable P-256 WebCrypto key. Session and
refresh-family state bind the RFC 7638 JWK thumbprint. Every protected HTTP
request and connection open carries a DPoP-shaped proof over the exact method,
canonical external URI, access-token hash, server nonce, issued-at second, and
unique proof id. The server verifies the proof before resolving the bearer or
reading an application body and consumes the proof id in a shared fail-closed
replay authority.

This constrains copied credentials and off-device replay. It does not prevent
active same-origin code from asking the installed key to sign or using the
client while compromised, and no Snapback surface may call it XSS-resistant.

## Protocol and algorithms

The protocol id is `snapback.sender-constrained.v2`. The only v2 signing
algorithm is `ES256` over P-256. Algorithm agility is closed: unknown `alg`,
`typ`, curve, key use, critical header, or proof version is refused rather than
negotiated.

The protected header is exactly:

```json
{"alg":"ES256","jwk":{"crv":"P-256","kty":"EC","x":"...","y":"..."},"typ":"dpop+jwt"}
```

The payload is exactly:

```json
{
  "ath":"base64url(sha256(access-token-octets))",
  "htm":"POST",
  "htu":"https://app.example/path",
  "iat":1750000000,
  "jti":"128-bit-base64url",
  "nonce":"server-issued-opaque-value",
  "version":2
}
```

JSON objects reject duplicate and unknown members. Base64url is unpadded and
canonical. `x` and `y` decode to exactly 32 bytes; signatures decode to exactly
64-byte IEEE-P1363 `r || s`. `jti` decodes to exactly 16 random bytes.

The JWK thumbprint is base64url SHA-256 over the RFC 7638 canonical object
`{"crv":"P-256","kty":"EC","x":"...","y":"..."}`. Session-family durable state
stores the thumbprint, never the public JWK as an alternate identity.

The proof structure follows RFC 9449 (DPoP); the deliberate deviations are:
the Bearer authentication scheme is retained for the credential itself; a
nonce is mandatory on every protected surface and single-use (stricter than
9449's optional server nonce); the algorithm profile is closed to ES256/P-256
with closed header/payload members and a `version` claim; `jti` is exactly 16
random bytes; upgrade proofs bind `ath` to the grant token rather than an
access token; issuance uses the distinct `challengeId`-instead-of-`ath`
payload above; and WebSocket proofs travel in a dedicated subprotocol value.
Each narrowing removes negotiation surface rather than adding capability.

## HTTP binding

Protected browser requests carry the access token through the existing
credential carrier and one `DPoP` header. The proof covers the uppercase
effective HTTP method and canonical public HTTPS URI. The URI contains scheme,
lowercased IDNA host, non-default port, and normalized absolute path; it omits
fragment and query. The trusted edge supplies the externally observed URI
through the provider-authenticated effective-source boundary. Public forwarding
headers never define it.

Sender admission runs entirely before the request body is polled — the pinned
tests prove admission completes against a body that panics if polled — in this
order:

1. hosted admission and trusted external URI;
2. bounded single-header and compact-proof shape;
3. exact header/payload decoding and algorithm;
4. token hash and durable family thumbprint;
5. method, URI, admission epoch, time window, and nonce;
6. ES256 signature; and
7. atomic shared replay consumption.

Only after admission succeeds does ordinary post-admission processing run:
the LLP 0058 forbidden-authority-field body check (which retains its LLP 0058
precedence *within* post-admission processing — it wins over credential
resolution, not over sender admission), then credential resolution and
application body ingestion. Sender admission thus never overrides the
pre-body admission guarantee; the 0058 field check keeps its precedence over
the bearer exactly where LLP 0058 places it, after the body is available.

Diagnostic precedence composes with LLP 0057 rather than overriding it. A
genuinely absent `Authorization` header yields `SNAPBACK_AUTH_REQUIRED` as
LLP 0057 requires. A present but malformed or unknown session carrier is
deliberately *not* distinguished from a well-formed one: it receives the
`SNAPBACK_AUTH_SENDER_PROOF_REQUIRED` challenge (with a generated,
uninstalled nonce — see the non-enumeration note below), because
distinguishing "no such family" from "wrong nonce" would be a
family-existence oracle. This anti-oracle choice is intentional and is why
the diagnostics section folds unknown-token into the sender-proof bucket.

The canonical external URI is reconstructed as scheme + lowercased IDNA host
+ non-default port + absolute path, over a pre-canonical ASCII origin. The
path is not resolved: any `%`-encoding, backslash, doubled slash, or literal
`.`/`..` segment is *rejected*, and fragment and query are removed. The
trusted edge supplies the origin and forwarding headers never define it. A
second implementation must reject, not resolve, so both compute the same
proof URI for the same wire request.

The accepted time window is server time minus 30 seconds through server time
plus 5 seconds, both endpoints inclusive. A proof id is retained until strictly
after its latest possible acceptance instant: retention expires at
`iat + 30 + 1` seconds (the latest accepted `iat` plus the future window plus
one second) and the purge predicate is `expires_at_seconds < now`, exclusive,
so a `jti` replayed at the final inclusive second of its window still refuses.
Replay-store unavailability refuses protected work.

Sender admission composes with LLP 0057's session-token resolution matrix
rather than replacing it: a proof-bearing request presenting an in-grace
superseded token resolves as the same session under the same durable
thumbprint, exactly as ordinary resolution would. Revoked and
grace-expired tokens refuse as LLP 0057 specifies.

## Nonce protocol

Nonce is mandatory on every hosted protected surface. A missing, expired,
wrong-admission, or already-retired nonce returns the fixed
`SNAPBACK_AUTH_SENDER_PROOF_REQUIRED` projection and the family's
still-current nonce in the `DPoP-Nonce` response header. The header is
cache-forbidden and contains no account, family, token, or proof fact. A
client retries at most once and only when the response is this typed
challenge.

A challenge never rotates a **live** installed nonce: while the current
generation is unexpired it is returned unchanged, and no unauthenticated
request can advance or retire it. A challenge installs a fresh generation only
when the family has none installed or the installed one has expired — expiry
is time-driven, not attacker-controllable, and no valid proof can reference an
expired nonce, so this is the one case where returning "the current nonce"
would deadlock (an expired value can never yield an acceptable next proof).
Rotation of a live nonce happens in exactly one place — inside the atomic
consumption transaction of a fully verified proof. An unauthenticated request
against a live generation therefore cannot advance, retire, or churn a
family's nonce; this is what denies a copied-bearer holder any availability
lever over legitimate custody.

A challenge to a request with no resolvable family (absent, malformed, or
unknown session carrier) returns a freshly generated but *uninstalled* nonce
— it is never written to family state and can never authorize work. This is
what lets the anti-oracle diagnostic hold without an installed generation. It
does leave a residual distinction between a live bound family (which returns
its stable installed nonce) and an unknown carrier (which returns a random
uninstalled one); whether the initial implementation must serve a stable
keyed cover nonce for unknown carriers, or the bound-family existence signal
is acceptable, is an open question below.

Nonces are random 32-byte base64url values, deployment- and
admission-epoch-bound, short-lived (the initial hosted profile TTL is 120
seconds, longer than the proof acceptance window so a client that holds a live
nonce can always form a fresh proof; a change is a revision of this Spec), and
one-current-generation per custody installation. Nonce issuance does not
confirm whether a bearer, subject, or family exists. Nonce state is shared
across every serving process for the deployment.

Every accepted protected HTTP response carries the installed successor in
`DPoP-Nonce`, also cache-forbidden. If that response is lost, the client presents
its retired generation once, receives `SNAPBACK_AUTH_SENDER_PROOF_REQUIRED`
with the still-current nonce, and retries at most once. Proof-id consumption,
retirement of the exact nonce generation, and successor installation are one
transaction; a crash or race may not commit only a subset.

One recovery case is exempt: a committed credential refresh whose successor
response was lost is governed by LLP 0057's lost-refresh rule (the successor
is stranded and the family recovers through that path), never by the generic
nonce challenge — replaying a refresh would mint a second successor.

## Issuance, refresh, and recovery

Request-code remains identity-private. Exchange receives the public JWK and an
issuance proof without `ath`; the proof instead covers the exact challenge id
and exchange endpoint in a distinct `snapback.sender-issuance.v2` payload,
exactly:

```json
{
  "challengeId": "...",
  "htm": "POST",
  "htu": "https://app.example/auth/exchange",
  "iat": 1750000000,
  "jti": "128-bit-base64url",
  "protocol": "snapback.sender-issuance.v2",
  "version": 2
}
```

with the same protected header, codec, and canonicality rules as the resource
proof. Successful exchange atomically binds the derived thumbprint into the
new session family before returning a credential. The capability to bind a
sender constraint to a session exists **only** inside this new-session
issuance transaction: no supported server API may attach a constraint to an
already-existing session id, so a v1 (bearer-only) family can never be
upgraded in place — migration is deletion-and-re-exchange, never attachment.

The replay uniqueness namespace is the tuple `(admission_epoch, proof_id)`
within a deployment; a `jti` is unique per admission epoch, and a new epoch
(deployment restart or reset) starts a fresh replay space.

This extends LLP 0057's Accepted `/auth/exchange` wire contract, which pinned
the request body to `{challengeId, code}` and reserved sender-binding as a
later-version question: the v2 exchange body adds a `senderConstraint` member
carrying the public JWK and issuance proof, and the response carries
`DPoP-Nonce`. LLP 0057 carries a corresponding Revised note; for the extended
members and header, this Spec has precedence.

Refresh requires both the current credential and a protected-resource proof.
Every successor remains bound to the same thumbprint. Rotation to another key
is a separately authenticated family-recovery operation that terminates the
old family; there is no bearer-only fallback. Loss of the non-extractable key
therefore means loss of that browser custody installation.

Logout and family alarm remain usable for revocation under their existing
privacy contract. Logout with a live credential requires v2 proof. The opaque
family-alarm secret is explicitly excluded from browser sender constraint
because its only authority is revoke-only.

## WebSocket and connection binding

The browser sends a fresh proof in the HTTP connection-open request before it
receives a connection grant. The grant records the session-family thumbprint
and admission epoch for the grant's lifetime; grants remain process-local and
restart-invalidated under LLP 0059. WebSocket upgrade consumes a second fresh
proof, carried in a dedicated subprotocol value of exactly
`snapback.sender-proof.<compact-jws>`, covering `GET`, the canonical external
`wss` URI normalized to the corresponding `https` authority/path, the
grant-token hash, and the server nonce. The upgrade atomically consumes its
proof id before switching protocols.

A grant issued to a sender-bound session requires a valid proof on **every**
subsequent use — each connection-token HTTP act (live, outbox, ephemeral) and
each WebSocket upgrade — regardless of which permitted carrier presents the
grant. There is no carrier or route on which a sender-bound grant acts as a
bare bearer. On every grant-presenting request, the proof's `ath` covers the
grant token, not the session bearer.

No proof rides application WebSocket frames. Existing connection generation,
revocation, authorization-invalidation, and user-switch barriers remain
authoritative. Reconnect always obtains a fresh nonce and proof.

## Browser custody

The client generates the key using `crypto.subtle.generateKey` with
`extractable: false`, P-256, and ECDSA. IndexedDB stores the private
`CryptoKey`, public JWK, credential response, thumbprint, nonce metadata,
protocol version, and custody generation in one record. `localStorage`,
sessionStorage, URLs, logs, errors, worker messages, and serialized application
state never receive the private key, bearer, proof, nonce, or full JWK.

Startup rejects a record whose private key is extractable, whose public key
does not match the private handle, whose thumbprint differs, or whose protocol
version is unknown. Migration from bearer v1 is deletion-only: the old family
is logged out/revoked where possible and the user performs a new v2 exchange.
No code upgrades an extant bearer by attaching a new key.

The client adds each validated successor nonce to its diagnostic redaction
set before any response callback or body parsing runs, so no error path can
reflect it. A successful status whose successor `DPoP-Nonce` is missing is an
indeterminate outcome: the client must not report failure for a possibly
committed effect, must not blind-retry a non-idempotent act, and recovers
through the one-challenge rule on its next request.

Because a family has one live nonce generation and every accepted response
retires it, proof-bearing requests from one custody installation MUST be
serialized per installation: the client issues at most one outstanding
protected request per generation and forms the next request's proof from the
installed successor. Concurrent application calls are queued behind that
serialization rather than each signing under the same generation (which would
make all but one challenge-and-retry, and could surface a committed effect as
a stale-authority failure — see defect 5). This serialization is a normative
requirement the current client does not yet implement; it is recorded as
defect 7 below. A future multi-flight design admitting a bounded lease of
one-use nonce tickets is an open question; the initial sender-constrained v2
implementation serializes.

Multiple tabs coordinate custody generation and nonce replacement through the
existing client authority barrier. Only the current generation may publish a
successor credential or nonce. A stale tab may request a retry but cannot
overwrite current custody.

`AuthCustodyV3` is the closed `AuthCustodyV2` shape plus
`senderConstraint` and `pendingSenderConstraint`. Each non-null constraint is
exactly `{formatVersion, protocol, custodyGeneration, privateKey, publicJwk,
thumbprint, nonce}`; nonce is exactly `{value, generation, expiresAtMs}`.
Settled v3 sessions have only `senderConstraint`; clearing has only
`pendingSenderConstraint`; anonymous and exhausted records have neither.
Transition-intent v2 binds the pending thumbprint (or the explicit delete
marker) into its transition id. Logout settles to anonymous `AuthCustodyV2`
after the v3 clearing cut, so no secret-free v3 shell remains.

## Credential classes

V2 covers browser session-family credentials and browser connection grants.
Native clients must provide an equivalent non-exportable key facility before
claiming this profile.

Operator console credentials stay on the separately trusted operator origin
and are outside the app-browser claim. Agent credentials, scoped automation
tokens, pairing secrets, and secret-read leases are non-browser authorities and
remain outside this protocol. An adapter must not broaden `hostedAuthCapable`
to those classes.

## Diagnostics and redaction

The public diagnostics are:

- `SNAPBACK_AUTH_SENDER_PROOF_REQUIRED`;
- `SNAPBACK_AUTH_SENDER_PROOF_INVALID`;
- `SNAPBACK_AUTH_SENDER_PROOF_REPLAYED`; and
- `SNAPBACK_AUTH_SENDER_PROOF_AUTHORITY_UNAVAILABLE`.

Within `SNAPBACK_AUTH_SENDER_PROOF_INVALID`, they expose no distinction
between unknown token, wrong key, bad signature, stale time, or wrong target.
A wrong or retired nonce is the one deliberate distinction: it returns the
`_REQUIRED` challenge with the still-current nonce (the RFC 9449
`use_dpop_nonce` pattern), because the legitimate client must be able to
resynchronize. Logs retain only the diagnostic code,
admission epoch, route class, and a server-generated correlation id. JWKs,
thumbprints, token/proof hashes, nonces, proof ids, signatures, external URIs,
and parser errors are forbidden.

## Acceptance

- WebCrypto generates a non-extractable key, survives IndexedDB structured
  clone, and signs a fixed cross-language vector accepted by Rust.
- Header, payload, JWK, base64url, signature, method, URI, time, nonce, token
  hash, and thumbprint negatives each fail before application body ingestion.
- Two processes racing the same proof id produce one success and one replay
  refusal; replay-store failure produces no application execution.
- Issuance binds the key before credential publication; refresh preserves it;
  key loss has no bearer fallback; v1 migration is deletion-only.
- HTTP, connection-open, WebSocket upgrade, reconnect, logout, rotation,
  expiry, reset/restore, and authorization invalidation compose with existing
  generation barriers.
- Browser bundles have no public direct-bearer constructor, and sentinels prove
  no credential/proof material — including each successor nonce — reaches
  forbidden carriers.
- Every grant-presenting route refuses both permitted carriers without a valid
  grant-bound proof; no sender-bound grant acts as a bare bearer anywhere.
- An in-grace superseded token with a valid proof resolves as the same
  session; an unauthenticated challenge never advances a nonce generation; a
  proof id replayed at the final inclusive second of its window still refuses.
- A forbidden authority field in the request body wins over a valid bearer
  post-admission, while sender admission still completes before the body is
  polled; a genuinely absent Authorization header yields
  `SNAPBACK_AUTH_REQUIRED` while a malformed carrier is challenged.
- Two concurrent protected requests from one custody serialize: neither
  observes a committed effect as a stale-authority failure.
- A complete hosted admission and adapter drill cannot become positive until
  this matrix passes against the served public origin.

## Open questions

- Whether the first browser implementation keeps signing in the page or behind
  a typed service-worker network broker. Either posture has the same
  off-device-replay claim; a signing-only worker is not an XSS boundary.
- Exact provider selected for the shared nonce and replay authority in the
  first single-instance adapter. SQLite is acceptable only while one process is
  the serialized authority and restart/backup semantics preserve expiry.
- Whether unknown carriers must receive a stable keyed cover nonce, or the
  residual live-bound-family existence signal is acceptable.
- The exact reset/restore/restart/rollback/admission-replacement lifecycle for
  the replay and nonce tables and the sender admission epoch: cleared,
  restored-but-unreachable, or retained until expiry — and what authoritatively
  rotates the epoch.
- The exact closed issuance request/response wire schema (`senderConstraint`
  wrapper keys, hosted-required/local-forbidden, JWK equality with the proof
  header, issuance `jti`/replay accounting) and its precedence against LLP
  0057's code-attempt accounting.
- Whether v2 later admits a bounded multi-flight lease of one-use nonce
  tickets instead of strict per-custody serialization.
- When a browser cannot read a successful WebSocket upgrade's successor nonce,
  when the serialization queue releases and how the next request resyncs.
