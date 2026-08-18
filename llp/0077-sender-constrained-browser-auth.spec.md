# LLP 0077: Sender-constrained browser auth

**Type:** Spec
**Status:** Draft
**Systems:** Auth, Browser client, HTTP, WebSocket, Hosted runtime, Control plane, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-22
**Revised:** 2026-07-27 (decision 4 first layer implemented — sender-bound
issuance mints `sbs2_`, refresh successors of a sender-bound family stay
`sbs2_`, sender-bound connection-open/rotation mint `sct2_`, and the sender
lanes require the v2 spellings (legacy `sbs_` over a bound family refuses at
proof time; migration is deletion-and-re-exchange). The v1-family
activation/rollback matrix is documented under §Credential classes; the
hosted matrix gained prefix assertions on issuance and connection-open.
Closes `issues/20260727-llp0077-v2-prefix-minting.md`.) 2026-07-27 (served-origin matrix run for real, and D-2 fixed — the
first true served-origin run of the LLP 0077 matrix against
`https://snapback-drill.fly.dev` (D-1-fixed binary, sessions staged under
hosted admission) surfaced D-2: a second `/auth/exchange` over an
already-bound custody key answered `500 INTERNAL_AUTH_STATE` because the
issuance transaction hit the sender-nonce table's `(admission_epoch,
jwk_thumbprint)` primary key on client-controllable input. Fixed by the
one-live-family-per-thumbprint rule now normative in §Issuance: the exchange
transaction pre-checks the live nonce cell and refuses with the folded
`SNAPBACK_AUTH_SENDER_PROOF_INVALID` before any session/challenge/nonce write,
consuming only the proof's `jti`; a Rust negative test
(`planned_issuance_refuses_a_second_family_for_a_live_thumbprint`) and a wire
check (`issuance/a-second-exchange-with-a-bound-key-refuses-coded`) pin it. The
matrix instrument gained a served-terminator composition (the real Caddy
terminator replaces `X-Forwarded-For`, so the effective-source rows assert
composed spoof-immunity and the origin-confusion probe binds to the internal
upstream) and now runs 43/43 against the local hosted origin. The served rerun
after the D-2 fix is recorded in the program index. Decision 4's versioned
`sbs2_`/`sct2_` prefixes are annotated reserved-unissued with follow-on
`issues/20260727-llp0077-v2-prefix-minting.md`.) 2026-07-25 (D-1 fixed — the
served-origin matrix's ordering
defect, an unauthenticated caller reaching the JSON parser on
function-authenticated invocation routes, is closed by hoisting the
function-level closed `authRequirement` into the hosted route-policy
decision: the middleware consults the post-commit published function
manifest before the absent-carrier bailout and refuses
`SNAPBACK_AUTH_REQUIRED` before any body poll unless the named function is
statically `public` or `optional-user`; unknown names fail closed,
indistinguishable from `authenticated` (no function-existence oracle), and
anonymous-capable routes are unchanged. §HTTP binding records the
normative rule; the hosted matrix passes 42/42 against the local hosted
origin. The capability gate still requires the served-origin rerun — no
positive claim advances). 2026-07-24 (implementation re-land + defect-fix pass — the full
sender-constrained server/client implementation, previously stranded as
uncommitted work on a ~130-commit-stale base in the primary checkout, was
ported onto current main, adapted to the landed LLP 0076 surface, and
hardened. Ledger defects 1–8 and 11–13 are now fixed in tree with negative
tests (per-item annotations below); the unknown-carrier cover nonce is the
decision-3 keyed HMAC; and the distinct durable `sender_replay_epoch` with
its atomic reset rotation landed. Later the same day the
epoch work completed: defect 10 closed (the decision-1 control-plane floor
delivered through `HostedAdmission.senderReplayEpochFloor` and applied as
`max(durable, floor)` with an atomic table clear at authority install, plus
restart/reset/rollback straddle tests) and the decision-6 grant member
landed (grants record the issuance `sender_replay_epoch` and close, with no
challenge, once the namespace advances past it). Defect 9 closed the same
day: the decision-2 bounded revoked-family tombstone is implemented — a
valid proof over a durable-delete-revoked family's bound key obtains the
terminal `durableDelete` outcome pre-body with no nonce, consumes its proof
id, and the client deletes sender custody; anything less than a valid proof
stays behind the anti-oracle cover challenge. The decision-5 in-band
WebSocket successor-nonce release landed as the final commissioned item: a
sender-proof-gated upgrade's first server frame is the transport-internal
`{"kind":"sender_nonce"}` frame carrying the exact successor the 101 header
carried, the client holds the per-custody flight until that frame commits
into custody, and open-without-frame timeout, error, cancel, and reconnect
resolve as consumed-unknown through the retained bounded-challenge resync —
the decision's own failure-path semantics, no longer the primary release.
Every item the ledger and author decisions commissioned is implemented; the
remaining gate is the hosted drill, and no capability claim advances).
2026-07-23 (author decisions batch — see §Author decisions —
2026-07-23: the sender_replay_epoch ratchet is realized as the LLP 0059
incarnation composed with a control-plane monotone floor stored outside the
rolled-back durable set; logout-lost-response is the bounded revoked-family
tombstone with pinned parameters; unknown carriers get a keyed cover nonce;
v2 tokens gain a legacy-rejecting syntax alongside the LLP 0060 D6 barrier;
the WebSocket serialization queue releases on the first server frame carrying
the successor nonce; `BoundGrantAuthorityV2` = thumbprint + issuance
sender_replay_epoch with exact-tuple equality; the complete closed
`AuthCustodyV3` schema with seven states is commissioned. Decisions only —
the defect ledger and evidence status are unchanged, and no capability claim
advances). 2026-07-23 (eighth model-family review round — Fable NOT READY
(one blocker: an unbacked non-rollbackable ratchet asserted as fact), Codex
NOT READY, artifacts under `llp/reviews/0077-*`. This revision stops asserting
that a non-rollbackable control-plane counter exists: the restore-non-
resurrection guarantee is now honest — declared restore is covered by the LLP
0059 incarnation advance, while the raw-backup-rollback ratchet source is a
stated requirement pending its open realization; unifies epoch terminology
(the verification step and nonce section now say `sender_replay_epoch`, not
"admission epoch"); adds a server-wire scope note (a second client is not yet
buildable — `AuthCustodyV3`/`BoundGrantAuthorityV2` deferred); extends the LLP
0057 Revised note to record the anti-oracle carrier-diagnostic amendment; adds
defect 13 (unknown-carrier `_INVALID`-without-nonce divergence); and notes the
logout tombstone's long-offline limitation. The thirteen-item ledger still
gates any positive capability). 2026-07-23 (seventh model-family review round
— Fable NOT READY (one blocking internal-consistency item), Codex NOT READY,
artifacts under `llp/reviews/0077-*`. This revision resolves the blocker by
narrowing the
`sender_replay_epoch` open question to its storage/realization only while the
observable contract (distinct namespace, rotates only on the LLP 0059
incarnation change, non-rollbackable) is fixed and conformance-binding;
selects the bounded revoked-family tombstone as the default logout-recovery
mechanism so defect 9 gains a negative test; fixes the diagnostic-matrix
contradiction so an absent header uniformly yields `SNAPBACK_AUTH_REQUIRED`;
extends the LLP 0057 Revised note to actually cover the issuance-outcome
accounting this Spec claimed; adds defect 12 (D3 throttle and admission
ordering) and broadens defect 11's URI/canonicality scope; corrects the stale
"LLP 0058 should carry a note" to present tense; and notes the per-rollout
resync-storm consequence of defect 10. The twelve-item ledger still gates any
positive capability). 2026-07-23 (sixth model-family review round — Fable
NOT READY (two narrow items), Codex NOT READY, artifacts under
`llp/reviews/0077-*`.
This revision reconciles the epoch lifecycle with LLP 0060/0059 by making the
replay/nonce namespace a **distinct durable `sender_replay_epoch`** (not the
rollout-churning serving admission epoch), rotated only on the LLP 0059
incarnation change, non-rollbackable, with the straddle seam closed by nonce
epoch-keying — the code's use of `admission_epoch` is now tracked as defect
10; fixes a real doc error (the exchange `senderConstraint.protocol` is
`snapback.sender-issuance.v2`, matching the code, not the resource-proof id);
demotes the under-specified logout recovery mechanism from a hard MUST to a
stated requirement plus an open-question mechanism choice; adds defect 11
(issuance `jti` not consumed on wrong code; client URI resolves instead of
rejects); scopes the conformance list as server-side; and clarifies defect 5
versus the passing redaction test. The eleven-item ledger still gates any
positive capability). 2026-07-23 (fifth model-family review round — Fable
NOT READY (one blocker: the epoch lifecycle), Codex NOT READY, artifacts
under `llp/reviews/0077-*`. This revision resolves the admission-epoch/reset
lifecycle normatively — a monotonic control-plane-bound epoch that rotates
only on reset, whose reset transaction atomically revokes families and clears
the replay/nonce tables, closing the restart-straddle replay seam — and moves
it out of the open questions; adds the atomic issuance outcome table (a valid
proof consumes its `jti` even on a wrong code, so it cannot be reused across
guesses), the LLP 0060 D3 throttle charge point, the WebSocket
subprotocol-echo prohibition and connection-open current-token carve-out, and
a normative logout-lost-response recovery rule (defect 9); tags the target-
contract assertions inline with their blocking defect numbers; notes the
defect 7↔5 coupling; and adds a conformance MUST-list. The nine-item ledger
still gates any positive capability). 2026-07-23 (fourth model-family review
round — Fable NOT READY, Codex NOT READY, artifacts under `llp/reviews/0077-*`.
This revision pins the
exact closed issuance exchange-wire schema (`senderConstraint` =
`{protocol, publicJwk, proof}`, unknown-member-rejecting, hosted-required /
local-absent, JWK-equals-proof-header, atomic no-attempt-no-replay on
verification failure) as normative rather than an open question; rewords the
implementation checkpoint so it no longer claims the generic constructor is
excluded (it is defect 8); records the pre-body sender-admission reorder of
LLP 0058's forbidden-field precedence as an explicit route-scoped amendment
with a matching LLP 0058 Revised note; and aligns the acceptance and
retention wording with the ledger. The eight-item ledger still gates any
positive capability). 2026-07-23 (third model-family review round — Fable
NOT READY, Codex NOT READY, artifacts under `llp/reviews/0077-*`. Both
families found
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

**Implementation checkpoint (2026-07-24):** The implementation lives on main
(worktree re-land of the stranded primary-checkout state, adapted to the
landed LLP 0076 server surface). Server: `crates/snapback/src/auth/sender_proof.rs` (closed
proof codec/verifier, durable replay/nonce/epoch/family-binding authority,
pre-body admission), `crates/snapback/src/auth/throttle.rs` (D3 shared durable limiter,
charge-on-denial), `crates/snapback/src/storage/auth_sender.rs`/`auth_throttle.rs` (storage
lanes), and the route-level admission composition in `crates/snapback/src/server.rs`.
Client: `packages/snapback-client/sender-proof.mjs` (non-extractable P-256
custody + exact proof shapes + reject-not-resolve canonical URIs),
`hosted-browser.mjs` (frozen non-inheriting facade), the sender transport in
`index.mjs`, and the `AuthCustodyV3` sender custody in
`packages/snapback-contract/auth-coordinator.mjs`. Witnesses: the Rust unit
corpus (`sender_proof` tests incl. the final-inclusive-second replay, the
two-OS-process replay race, the grace/connection-open matrix, and the keyed
cover nonce), the served router suites (`hosted_sender_*`: pre-body
challenge, denial-charged throttle, the transactional issuance outcome
matrix, session/refresh/connection-open/grant-matrix composition over all
ten header routes plus the WebSocket subprotocol carrier), the Node
cross-language vector test, and the client suites (`sender-proof`,
`sender-transport`, `hosted-browser`, `auth-sender-custody`). Defects 1–8
and 10–13 are fixed with negative tests (defect 10: the durable epoch, the
decision-1 floor applied at authority install, restart/reset/rollback
straddle witnesses, and the decision-6 grant-epoch member with its served
invalidation test); defect 9 closed the same day (the decision-2
tombstone: server-side terminal outcome at the sender gate plus client
custody deletion, witnessed by
`logout_tombstone_delivers_terminal_outcome_without_touching_nonce_state`,
the served
`committed_logout_with_lost_response_recovers_through_the_sender_tombstone`,
and the client tombstone scenario in `sender-transport.test.mjs`), and the
decision-5 WebSocket in-band successor release landed as well (server: the
first frame on a sender-proof-gated upgrade; client: flight release on that
frame with commit-into-custody, and consumed-unknown fallbacks; witnessed by
the bound-listener first-frame leg of the served issuance test and the
in-band release scenario in `sender-transport.test.mjs`). No positive
capability claim is made.

**Implementation checkpoint (2026-07-22):** The hosted-only browser entrypoint
closes the exported constructor-options and `setBearerToken` direct-bearer
seams. At this checkpoint it subclassed the generic client, so the generic
constructor was still reachable through the prototype chain and inherited
transport fields plus the mutable `senderConstrained` flag remained writable —
recorded as defect 8, since fixed (the entrypoint is now a frozen
non-inheriting facade). Its
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
review rounds; per-item fix status 2026-07-24).** Each open item blocks any
positive capability claim and requires a fix plus a negative test; fixed
items keep their original text for review history with the fix witness
appended:

1. The challenge path rotates the family's durable nonce on unauthenticated
   missing/mismatched-proof requests (`fresh_challenge` → `issue_sender_nonce`
   installs generation+1), contradicting the normative
   challenge-never-rotates rule below and handing a copied-bearer holder a
   nonce-churn lever that can race the legitimate client's single retry into
   lockout.

   *Fixed 2026-07-24:* `fresh_challenge` returns a live installed nonce
   unchanged and mints a generation only when none is installed or the
   installed one expired; rotation happens only inside the verified-proof
   consume/rotate transaction. Witness:
   `pre_body_admission_challenges_then_accepts_and_rotates` (repeated
   missing-proof and wrong-nonce attempts leave value and generation
   unchanged).
2. Connection-token HTTP acts (live, outbox, ephemeral routes) accept the
   bare grant header without sender admission, and WebSocket upgrade accepts
   the grant through the permitted header carrier without a proof — bare-
   bearer paths for sender-bound grants, contradicting the every-use rule in
   "WebSocket and connection binding". Generic HTTP proofs also hash the
   session bearer where a grant is the presented credential.

   *Fixed 2026-07-24 (enforcement):* one carrier-neutral pre-body gate
   covers every connection-grant route and both carriers, and the client
   signs the grant token into `ath`. Witness: the served grant matrix in
   `hosted_sender_issuance_session_and_refresh_compose_through_the_router`
   (ten header routes + the WebSocket subprotocol carrier × missing/
   malformed/wrong-`ath`/replayed/authority-unavailable, refused without
   body polling). The decision-6 member landed with defect 10's fix: the
   grant records the issuance `sender_replay_epoch` and invalidates, with no
   challenge, once the namespace advances past it
   (`sender_bound_grant_invalidates_when_the_sender_replay_epoch_advances`).
3. Sender lookup joins only the current session token hash, refusing
   proof-bearing requests that present an in-grace superseded token and
   breaking LLP 0057's tombstone-grace resolution matrix.

   *Fixed 2026-07-24:* sender lookup honors LLP 0057 tombstone grace at
   the inclusive ten-second boundary for finite requests and takes an
   explicit current-only flag for connection-open. Witness:
   `sender_binding_lookup_honors_finite_grace_but_connection_open_is_current_only`.
4. Replay retention is exactly the accepted window (35 s) with an
   inclusive-boundary purge (`expires_at_seconds <= now`) on both the replay
   and nonce tables, one second short at the final inclusive second; the
   contract requires expiry at `iat + 30 + 1` with an exclusive `< now` purge
   on both tables.

   *Fixed 2026-07-24:* retention is `iat + 30 + 1` with exclusive
   `< now` purges on both tables. Witnesses:
   `production_admission_refuses_replay_at_final_inclusive_second` and the
   true two-OS-process race
   `two_processes_racing_production_transaction_have_one_success_and_one_replay`.
5. The client installs the successor `DPoP-Nonce` without adding it to the
   diagnostic redaction set on the response-processing path, and parses a
   successful response body before failing on a missing successor nonce, so a
   committed effect can be observed as a failure and retried. (The reflected-
   material test that passes covers the *request* nonce on an error path; the
   unredacted successor is the distinct install path this defect names, and it
   is coupled to defect 7.)

   *Fixed 2026-07-24 (with defect 7):* the validated successor enters
   the redaction set before any callback or body parse, and a successful
   response missing its successor is the explicit non-retryable
   `SNAPBACK_AUTH_SENDER_OUTCOME_INDETERMINATE` outcome. Witness:
   `sender-transport.test.mjs` (committed missing-nonce mutation with no
   retry; reflected-material redaction; next-request recovery).
6. `bind_new_session_sender_constraint` can bind any existing session id;
   the binding capability must be restricted to the session-issuance
   transaction so no supported API can bind an extant v1 family.

   *Fixed 2026-07-24:* binding is private to the issuance transaction
   (`SenderIssuanceCommitment::install`); no supported API binds an extant
   family. Witness: `session_binding_is_issuance_atomic_and_v1_has_no_upgrade_api`
   and the served issuance outcome matrix.
7. The per-custody request serialization the Nonce protocol requires is not
   implemented: concurrent client calls each sign under the same generation
   and race the successor-nonce compare-and-set. A per-custody queue must span
   proof creation through nonce-header commit for HTTP, refresh, logout,
   connection open, and WebSocket initiation. Defects 7 and 5 are coupled:
   without the serialization queue, defect 5's successor-nonce handling cannot
   be correct, so neither may be marked done alone.

   *Fixed 2026-07-24 (with defect 5):* a per-custody serialization
   queue spans proof creation through successor-nonce commit for HTTP,
   refresh, logout, connection-open, and WebSocket initiation. Witness:
   `sender-transport.test.mjs` concurrent-query serialization. The
   decision-5 release event landed 2026-07-24: the flight holds until the
   first server frame delivers the successor in band and commits into
   custody; open-without-frame timeout, error, cancel, and reconnect release
   as consumed-unknown through the bounded challenge.
8. The hosted browser entrypoint subclasses the generic client, so its
   constructor (which accepts a bearer) is reachable through the prototype
   chain, and inherited transport fields plus the mutable `senderConstrained`
   flag are writable — the structural-exclusion property LLP 0060 requires is
   not yet structural. It needs a non-inheriting façade (or an intrinsic v3
   custody posture with privatized transport state) plus prototype-graph and
   direct-mutation sentinels.

   *Fixed 2026-07-24:* the hosted entrypoint is a frozen non-inheriting
   composition facade. Witness: `hosted-browser.test.mjs` (prototype-graph
   absence, bearer options/setter refusal, direct-mutation refusal).
9. A committed logout whose response is lost strands custody: the family is
   revoked, sender lookup joins only current sessions, and the client clears
   custody only after the response. A bounded revoked-family sender tombstone
   (or an anonymous-recovery handshake) is required so a post-logout signed
   request can obtain the terminal `durableDelete` outcome.

   *Fixed 2026-07-24:* the decision-2 tombstone is implemented at the sender
   gate: a revoked family whose durable terminal-cause witness is
   durable-delete-class resolves for the 30-day-capped horizon; a fully
   valid proof over its bound key receives the terminal outcome
   (`SNAPBACK_AUTH_SESSION_EXPIRED` + `authorityDisposition: durableDelete`,
   pre-body, no nonce header) and consumes its proof id; missing, malformed,
   or wrong-key proofs and carrier-class endings stay behind the anti-oracle
   cover challenge; nonce state is never touched; the client deletes sender
   custody on the outcome. Witnesses:
   `logout_tombstone_delivers_terminal_outcome_without_touching_nonce_state`,
   `committed_logout_with_lost_response_recovers_through_the_sender_tombstone`,
   and the client tombstone scenario in `sender-transport.test.mjs`.
10. Replay and nonce isolation keys on LLP 0060's serving `admission_epoch`
    rather than a distinct durable `sender_replay_epoch`, and reset neither
    advances a sender epoch nor clears the replay/nonce tables — so the
    normative epoch model above is not yet implemented. This is not merely a
    correctness nit: because live nonces key on the serving admission epoch,
    every rollout that rotates it strands all installed nonces and forces every
    client through the one-shot challenge-retry simultaneously — a per-rollout
    resync storm — so the fix is priority.

    *Fixed 2026-07-24:* the durable `_snapback_sender_replay_epoch` singleton
    is the namespace (preserved across restart/rollout), the LLP 0059
    stream-reset transaction atomically advances it and clears both tables,
    and the decision-1 control-plane floor
    (`HostedAdmission.senderReplayEpochFloor`, stored outside the rolled-back
    durable set) is applied as `max(durable, floor)` with an atomic table
    clear at hosted-authority install — so a raw backup rollback cannot
    resurrect an accepted proof, upgrading the non-resurrection guarantee to
    an implemented property. Witnesses:
    `sender_replay_epoch_floor_advances_clears_and_never_lowers`,
    `sender_replay_epoch_survives_restart_and_rotates_only_on_reset`,
    `sender_bound_grant_invalidates_when_the_sender_replay_epoch_advances`.
11. A cryptographically valid issuance proof paired with a wrong or exhausted
    code does not consume its `jti` (the wrong-code path returns before sender
    commitment), so the issuance outcome table's cross-guess-reuse rule is
    unmet; and the browser client canonicalizes the proof URI with WHATWG
    `new URL()`, which *resolves* dot-segments and does not reject all
    percent-encoded, backslash, or doubled-slash paths, contrary to the
    reject-not-resolve conformance rule; client JWK/nonce checks also use
    character/length regexes rather than decode-and-re-encode canonicality.

   *Fixed 2026-07-24 (both halves):* a cryptographically valid issuance
   proof consumes its `jti` inside correct-code and rejected-code
   transactions alike (served outcome matrix
   `hosted_sender_issuance_outcome_matrix_is_transactional`), and the client
   rejects `%`/backslash/doubled-slash/dot-segment paths without resolution
   with decode-and-re-encode canonicality (`canonicalSenderExternalUri`,
   `sender-proof.test.mjs`).
12. Two admission-order divergences: the LLP 0060 D3 shared-throttle charge is
    not performed before proof processing (the hosted serving authority holds
    only admission and origin, and sender admission proceeds directly into
    proof processing), and the shipped code resolves `SessionAuth` before the
    forbidden-authority-field body check rather than in the specified order.

   *Fixed 2026-07-24:* the target-attested HMAC-keyed durable D3
   limiter charges every applicable bucket atomically, including on denial,
   before proof parsing or body polling, and the forbidden-authority-field
   check runs after sender admission and before credential resolution (the
   rejected-connection-open budget accounting is preserved across the
   reorder). Witnesses: `hosted_sender_shared_throttle_charges_denials_before_proof_and_body`,
   `hosted_shared_throttle_keys_challenge_and_exchange_subjects_before_crypto`,
   `hosted_anonymous_connection_open_consumes_shared_source_admission`, and
   the proof × forbidden-field precedence leg of the served issuance test.
13. An unknown carrier bearing a present proof returns
    `SNAPBACK_AUTH_SENDER_PROOF_INVALID` without the cover nonce, diverging
    from the anti-oracle matrix (which folds unknown carriers into the
    `_REQUIRED` challenge with a cover nonce).


   *Fixed 2026-07-24:* unknown/malformed carriers with or without a
   proof fold into the `_REQUIRED` challenge carrying the decision-3
   deterministic keyed cover nonce (`HMAC(purpose key, epoch ‖ token digest
   ‖ time bucket)`), stable within a bucket and never installed. Witnesses:
   `invalid_bearer_missing_proof_gets_untracked_opaque_challenge`,
   `unknown_carrier_cover_nonce_is_keyed_stable_and_never_installed`.
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

The normative rules below describe the target contract. Several are not yet
met by the shipped code; each such rule is tagged inline with its blocking
ledger defect (for example, "no sender-bound grant acts as a bare bearer"
carries *(defect 2)*), and the ledger gates any positive capability. A reader
must not mistake a tagged rule for implemented reality.

Scope: this document currently pins the complete **server-side wire and
storage contract** (a second server implementation is buildable from the
Conformance list below). The closed client custody schema (`AuthCustodyV3`)
and the versioned sender-bound grant shape (`BoundGrantAuthorityV2`) are
described but not yet fully closed, so a second *client* is not yet buildable
from this Spec alone; both are tracked as open questions and are follow-on
work before this advances past Draft.

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
2. LLP 0060 D3 shared-throttle charge — every challenge, refresh,
   connection-open, and malformed/unresolved-credential attempt charges all
   applicable buckets atomically, including on denial, and stays bounded if
   the limiter fails; this throttle accounting is distinct from LLP 0057's
   provider code-attempt counter and "consumes no code attempt" never means
   "consumes no throttle attempt";
3. bounded single-header and compact-proof shape;
4. exact header/payload decoding and algorithm;
5. token hash and durable family thumbprint;
6. method, URI, `sender_replay_epoch`, time window, and nonce;
7. ES256 signature; and
8. atomic shared replay consumption.

Only after admission succeeds does ordinary post-admission processing run:
the LLP 0058 forbidden-authority-field body check (which retains its LLP 0058
precedence *within* post-admission processing — it wins over credential
resolution), then credential resolution and application body ingestion.

This is a deliberate, narrow amendment to LLP 0058's stated ordering, not
mere composition: LLP 0058 places the forbidden-authority-field check before
bearer consideration, but a sender-constrained route cannot trust its request
body until the sender proof has gated body access, so on these routes sender
admission runs first and the forbidden-field check runs immediately after,
still before credential resolution and before any application handler. The
security rationale is that an unproven sender must never cause body ingestion;
the forbidden-field check keeps its precedence over the bearer. LLP 0058
carries a Revised note recording this route-scoped reorder. (The shipped code
resolves `SessionAuth` before the forbidden-field check rather than in this
order; that divergence is tracked as defect 12.)

Route-level policy alone cannot see a function-level requirement: the
generated invocation routes (`/query/{name}`, its authorized-lease path,
`/mutation/{name}`, `/action/{name}`) share one registration whose
session-mode credential resolution is optional, while the authentication
requirement lives in the function's closed `authRequirement`. The
absent-carrier refusal therefore hoists the published function manifest into
the route-policy decision (fixed 2026-07-25; found as served-matrix defect
D-1): on a hosted origin, an absent credential carrier on an invocation route
refuses `SNAPBACK_AUTH_REQUIRED` before any body poll unless the named
function is statically declared `public` or `optional-user` in the
post-commit manifest snapshot the write lane publishes. The derivation fails
closed — a name the published manifest does not contain, which no caller can
ever invoke successfully, refuses identically to an `authenticated` function,
so the pre-body refusal is not a function-existence oracle. The signal is
deliberately the closed `authRequirement` and not `authUserId` use, which
`optional-user` functions read legitimately; it is exactly the requirement
the post-parse function-authority gate enforces, so the hoist can never
refuse a caller the function itself would have served. The canonical-URI
rejection above (`%`-encoding, backslash, doubled slash, dot segments)
precedes this decision, so the raw path segment cannot name one function for
the middleware and a different one for the handler's decoded path parameter.

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

Nonce is mandatory on every hosted protected surface. Given a present
credential carrier and a well-formed proof, a missing, expired,
wrong-admission, or already-retired *nonce* returns the fixed
`SNAPBACK_AUTH_SENDER_PROOF_REQUIRED` projection and the family's
still-current nonce in the `DPoP-Nonce` response header. This nonce challenge
is distinct from the carrier-diagnostic precedence: a genuinely absent
`Authorization` header still yields `SNAPBACK_AUTH_REQUIRED` per LLP 0057/0059,
enforced at the route middleware before sender admission is reached (it never
reaches the nonce challenge), and only a present-but-malformed or unknown
carrier is folded into the anti-oracle sender-proof challenge. Because folding
malformed/unknown carriers into the sender challenge (rather than
`AUTH_REQUIRED`) departs from LLP 0057's carrier matrix, LLP 0057's Revised
note records this anti-oracle diagnostic amendment as well. That
divergence was tracked as defect 13 and is fixed (2026-07-24): unknown
carriers with or without a proof now receive the `_REQUIRED` challenge with
the decision-3 keyed cover nonce. The
header is cache-forbidden and contains no account, family, token, or proof
fact. A client retries at most once and only when the response is this typed
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
lever over legitimate custody *(defect 1 — fixed 2026-07-24; the negative
test proves repeated unauthenticated attempts leave the generation
unchanged)*.

A challenge to a request with no resolvable family (absent, malformed, or
unknown session carrier) returns an *uninstalled* cover nonce — it is never
written to family state and can never authorize work. This is what lets the
anti-oracle diagnostic hold without an installed generation. Per §Author
decisions item 3 (implemented 2026-07-24) the cover value is the
deterministic keyed `HMAC(purpose key, sender_replay_epoch ‖ token_digest ‖
time_bucket)`, stable within one nonce-TTL bucket, so a live bound family
(stable installed nonce) and an unknown carrier (stable keyed cover nonce)
are indistinguishable and the bound-family existence oracle is closed.

Nonces are random 32-byte base64url values, deployment- and
`sender_replay_epoch`-bound (the same distinct namespace as replay ids, not
the serving admission epoch), short-lived (the initial hosted profile TTL is 120
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

**One live family per thumbprint.** A thumbprint's nonce cell is unique within
the `sender_replay_epoch` (its storage primary key), so a live family already
owns it. A second issuance over an already-bound key — a valid proof plus a
correct code — MUST therefore refuse with the folded
`SNAPBACK_AUTH_SENDER_PROOF_INVALID` diagnostic *inside the same immediate
write transaction*, before any session, identity, challenge-consumption, or
nonce write. The valid proof still consumes its `jti` (the issuance-outcome
rule below); the correct code is not charged an attempt and the challenge stays
live for a retry under a fresh key. The refusal is a committed outcome, not a
storage-constraint surfaced as a state-invariant failure: the pre-check and the
family install serialize on the same write transaction, so a concurrent same-key
exchange is refused deterministically rather than racing the nonce-table
primary key. An expired incumbent nonce cell does not count — issuance
garbage-collects it ahead of the install, so the same thumbprint issues again
once its prior family's nonce lifetime elapses. Only the key holder can reach
this outcome (it requires a valid signature over the challenge), so folding it
into `_INVALID` with no distinguishing detail is not an oracle.

The replay uniqueness namespace is the tuple `(sender_replay_epoch,
proof_id)` within a deployment, and nonces are keyed by the same
`sender_replay_epoch`. The epoch's lifecycle is normative, not an open
question, because a proof's ~35 s acceptance window can straddle a lifecycle
event and a fresh replay space would otherwise let a still-in-window proof be
replayed:

- `sender_replay_epoch` is a **distinct durable counter**, stored
  transactionally alongside the session, replay, and nonce state — it is
  **not** LLP 0060's serving `HostedAdmission.admissionEpoch`, which is
  short-lived and rotates on attestation, health, rollout, and routing
  changes; binding replay isolation to that epoch would orphan every live
  nonce on each rollout. An ordinary process restart or rollout preserves
  `sender_replay_epoch` and its tables, so there is no fresh replay space and
  no straddle seam under normal operation.
- It rotates only on the LLP 0059 authorization-stream incarnation change
  (reset, logical import, declared restore). The single reset transaction
  MUST, atomically: advance `sender_replay_epoch`, revoke every sender-bound
  session family, and clear the replay and nonce tables. The observable
  properties in this section are the fixed normative contract; only the
  epoch's storage/realization is an open author decision (below).
- The straddle seam at a rotation is closed by nonce epoch-keying, not by
  replay retention: a proof issued under the old epoch carries a nonce that is
  orphaned under the new epoch, so it fails the nonce check regardless of the
  now-empty replay space. Family revocation on reset is an additional barrier.
- A declared restore or backup rollback must not resurrect an accepted proof.
  For a **declared restore** (LLP 0059 authorization-stream incarnation
  change) this holds by the same rotation rule: the incarnation advances on
  restore, so `sender_replay_epoch` advances and the restored proofs reference
  a superseded epoch. For a **raw backup rollback** that reverts the durable
  tables wholesale, non-resurrection requires `sender_replay_epoch` to be
  gated by a monotone source the rollback cannot rewind; whether that source
  is the LLP 0060 attestation ratchet, a dedicated control-plane counter, or
  another primitive is the open realization question below. Until that source
  is pinned, the raw-rollback non-resurrection guarantee is a stated
  requirement, not yet a proven property — this Spec does not assert an
  unidentified counter exists.

As of 2026-07-24 this model is implemented (defect 10 closed): the durable
`sender_replay_epoch` is a singleton row in `_snapback_sender_replay_epoch`,
preserved across restart/rollout (the historical SQL column name
`admission_epoch` in the replay/nonce tables stores this durable value); the
LLP 0059 stream-reset transaction atomically advances it and clears the
replay/nonce tables inside the same destructive cut that revokes the auth
catalog; and the decision-1 control-plane floor is delivered through
`HostedAdmission.senderReplayEpochFloor` and applied at hosted-authority
install as `max(durable, floor)` with an atomic table clear, so a raw backup
rollback cannot resurrect an accepted proof or nonce.

This extends LLP 0057's Accepted `/auth/exchange` wire contract, which pinned
the request body to `{challengeId, code}` and reserved sender-binding as a
later-version question. The v2 exchange request body is exactly:

```json
{
  "challengeId": "...",
  "code": "...",
  "senderConstraint": {
    "protocol": "snapback.sender-issuance.v2",
    "publicJwk": { "crv": "P-256", "kty": "EC", "x": "...", "y": "..." },
    "proof": "<compact sender-issuance.v2 JWS>"
  }
}
```

The `senderConstraint.protocol` value is `snapback.sender-issuance.v2` — the
same protocol id the issuance proof carries — not the resource-proof id
`snapback.sender-constrained.v2`; the exchange member and the proof it wraps
agree. The `senderConstraint` object rejects unknown members. It is
**required** on a hosted target and **absent** on a local bearer-v1 exchange;
a hosted request without it, or a local request carrying it, is refused at the
route boundary.
`publicJwk` MUST equal the JWK in the issuance proof's protected header (the
server rejects a mismatch), and its RFC 7638 thumbprint is what the new
session family binds. A response on the hosted path carries `DPoP-Nonce`.

Issuance outcome accounting is atomic and composes with LLP 0057's
code-attempt counter:

- an issuance proof that fails cryptographic verification consumes neither a
  code attempt nor a replay id (the request never reached the exchange);
- a cryptographically valid proof MUST consume its `jti` (replay id) even when
  the paired `code` is wrong or the challenge is exhausted, so a single valid
  proof can never be reused across code guesses just because session binding
  did not commit; a wrong code still increments the LLP 0057 attempt counter;
  and
- only a valid proof plus a correct code binds the thumbprint and publishes
  the credential, all in one transaction; and
- **one live family per thumbprint** (normative as of 2026-07-27, closing
  served-origin defect D-2 below): a valid proof plus a correct code whose
  thumbprint already holds a live (unexpired) nonce cell under the current
  `sender_replay_epoch` refuses issuance with the folded
  `SNAPBACK_AUTH_SENDER_PROOF_INVALID` (the closed diagnostics set admits no
  key-bound distinction; only the key holder can reach this outcome, since it
  requires a valid signature, so the fold is not an oracle). The refusal
  consumes the proof's `jti` (the valid-proof rule above), charges no code
  attempt, and leaves the challenge live — the conforming client (which mints
  a fresh non-extractable key per issuance) retries under a fresh key without
  re-requesting a code. The check runs inside the same immediate write
  transaction as family install, so a concurrent same-key exchange serializes
  into the same coded refusal rather than surfacing the nonce-table
  primary-key conflict as a 500.

**D-2 (found 2026-07-25 era code, surfaced by the first served-origin matrix
run 2026-07-27, fixed the same day):** a second `/auth/exchange` presenting a
valid issuance proof over an already-bound key answered
`500 INTERNAL_AUTH_STATE` — the `(admission_epoch, jwk_thumbprint)` nonce-table
primary-key violation was blanket-mapped to the state-invariant error, an
uncoded 5xx on client-controllable input. Fixed by the pre-insert live-family
check above (`PlannedIssuanceCommit::SenderKeyBound`), with the Rust witness
`planned_issuance_refuses_a_second_family_for_a_live_thumbprint` (including
the expired-cell re-issuance half) and the matrix check


Refresh requires both the current credential and a protected-resource proof.
Every successor remains bound to the same thumbprint. Rotation to another key
is a separately authenticated family-recovery operation that terminates the
old family; there is no bearer-only fallback. Loss of the non-extractable key
therefore means loss of that browser custody installation.

Logout and family alarm remain usable for revocation under their existing
privacy contract. Logout with a live credential requires v2 proof. The opaque
family-alarm secret is explicitly excluded from browser sender constraint
because its only authority is revoke-only.

A committed logout whose response is lost is a special recovery case: because
the logout revoked the family, the generic still-current-nonce recovery cannot
help (the family no longer resolves), and the next signed request could strand
custody indefinitely. The client MUST NOT clear custody until it has the terminal outcome, and the
server MUST provide a bounded, authenticated post-logout recovery path. The
default mechanism is a **bounded revoked-family sender tombstone**: on logout
the family binding is moved to a tombstone retained for the session
refresh/grace horizon (the same bound LLP 0057 uses for superseded-token
grace), a post-logout signed request resolves against that tombstone by
thumbprint, receives the terminal `durableDelete` outcome, and consumes its
proof id without rotating a nonce; a repeat request after the tombstone
expires converges to LLP 0057's `SESSION_EXPIRED`. An anonymous-recovery
handshake is an admissible alternative an author may substitute, but the
tombstone is the default so defect 9 has a concrete negative test. A client
offline longer than the tombstone horizon lands in ordinary
re-authentication; decision 2 (§Author decisions item 2) accepted this as
the eventual-safe-deletion answer because after the retention bound every
credential the tombstone could refuse has itself expired. The mechanism is
implemented as of 2026-07-24 (defect 9 fixed): the tombstone is realized
over the durably retained revoked session row, its intact sender binding,
and the durable-delete-class terminal-cause witness, with the 30-day-capped
horizon enforced at lookup; only a fully valid proof over the bound key
distinguishes the tombstone from an unknown carrier, so the anti-oracle
matrix is preserved.

## WebSocket and connection binding

The browser sends a fresh proof in the HTTP connection-open request before it
receives a connection grant. The grant records the session-family thumbprint
and the durable `sender_replay_epoch` current at issuance for the grant's
lifetime; grants remain process-local and restart-invalidated under LLP 0059. WebSocket upgrade consumes a second fresh
proof, carried in a dedicated subprotocol value of exactly
`snapback.sender-proof.<compact-jws>`, covering `GET`, the canonical external
`wss` URI normalized to the corresponding `https` authority/path, the
grant-token hash, and the server nonce. The upgrade atomically consumes its
proof id before switching protocols. Because browser JavaScript cannot read
the 101 response's `DPoP-Nonce` header, the successor installed by the
upgrade's proof consumption is also delivered in band: the first server
frame on a sender-proof-gated socket is the transport-internal
`{"kind":"sender_nonce","nonce":"..."}` frame carrying the exact header
value, sent before any application-visible frame. That frame is the client's
per-custody flight-release event (§Author decisions item 5): the client
commits the successor into custody exactly like an HTTP `DPoP-Nonce`
install and never surfaces the frame to the application. On
open-without-frame timeout, error, cancel, or reconnect the client treats
its nonce as consumed-unknown and the next protected request resynchronizes
through the bounded one-challenge rule — a nonce is never reused. A
non-sender-gated upgrade sends no such frame.

A grant issued to a sender-bound session requires a valid proof on **every**
subsequent use — each connection-token HTTP act (live, outbox, ephemeral) and
each WebSocket upgrade — regardless of which permitted carrier presents the
grant. There is no carrier or route on which a sender-bound grant acts as a
bare bearer *(defect 2 — enforcement fixed 2026-07-24; the served
route × carrier matrix is the witness)*. On every grant-presenting request, the proof's `ath` covers the
grant token, not the session bearer.

The server MUST NOT select or echo the proof-bearing subprotocol value as the
negotiated WebSocket protocol; it selects only the ordinary live protocol, so
the compact proof never becomes the application-visible subprotocol. A
sender-bound grant is minted or renewed only by a current session token —
never by an in-grace superseded token (preserving LLP 0059's connection-open
carve-out); the in-grace resolution above applies to ordinary finite HTTP
requests, not to connection-open. The sender-bound grant shape is LLP 0059's
`BoundGrantAuthorityV2` (thumbprint + issuance `sender_replay_epoch`,
exact-tuple equality, invalidation on family revocation or epoch advance) —
the dated LLP 0059 amendment landed 2026-07-23 and the implementation
matches it as of 2026-07-24.

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
a stale-authority failure — see defect 5). This serialization is normative
and implemented (2026-07-24, defect 7 fixed with defect 5). A future multi-flight design admitting a bounded lease of
one-use nonce tickets is an open question; the initial sender-constrained v2
implementation serializes.

Multiple tabs coordinate custody generation and nonce replacement through the
existing client authority barrier. Only the current generation may publish a
successor credential or nonce. A stale tab may request a retry but cannot
overwrite current custody.

`AuthCustodyV3` is the closed `AuthCustodyV2` shape plus
`senderConstraint` and `pendingSenderConstraint`. The complete closed schema
follows in the next section; the summary rules are: settled v3 sessions have
only `senderConstraint`; clearing has only `pendingSenderConstraint`;
anonymous and exhausted records have neither. Transition-intent v2 binds the
pending thumbprint (or the explicit delete marker) into its transition id.
Logout settles to anonymous `AuthCustodyV2` after the v3 clearing cut, so no
secret-free v3 shell remains.

### The closed `AuthCustodyV3` schema (landed 2026-07-23)

This section discharges §Author decisions item 7: it is the complete closed
custody schema for an independent client, verified field-for-field against the
reference implementation
(`packages/snapback-contract/auth-coordinator.mjs`,
`validateAuthCustody`/`validateAuthCustodySenderKeys`, in flight 2026-07-23).
Validation is deny-unknown-fields at every level: a record with a missing,
extra, or malformed member is **corrupt** in its entirety, and recovery from
corruption is deletion-only — no partial repair.

**Grammars used below.** `Base64Url32` = 43 characters of
`[A-Za-z0-9_-]` (32 bytes, unpadded). `AuthorityKey` = `sha256:` plus 64
lowercase hex. `UuidV7` = canonical lowercase UUIDv7. `SafeInt` = an integer
in the JS safe range; `SafeInt⁺` additionally ≥ 1. App ids are non-empty,
already-normalized strings (no trimming is performed at validation).

**Top level.** A `formatVersion: 3` record has exactly these thirteen members
(a `formatVersion: 2` record has exactly the first eleven — v2 remains a valid
custody format on non-sender lanes):

| Member | Type |
| --- | --- |
| `formatVersion` | `2` or `3` |
| `appId` | canonical app id; must equal the owning app |
| `authorityEpoch` | `SafeInt` ≥ 0 |
| `revision` | `SafeInt⁺` |
| `phase` | `"settled"` \| `"clearing"` \| `"exhausted"` |
| `authority` | `ClientAuthority` or `null` |
| `pendingAuthority` | `ClientAuthority` or `null` |
| `bearer` | non-empty string or `null` |
| `pendingBearer` | non-empty string or `null` |
| `refreshAfterMs` | `SafeInt` ≥ 0 or `null` |
| `transitionIntent` | `TransitionIntent` or `null` |
| `senderConstraint` | `SenderConstraint` or `null` (v3 only) |
| `pendingSenderConstraint` | `SenderConstraint` or `null` (v3 only) |

**`ClientAuthority`.** Anonymous is exactly
`{kind: "anonymous", authMode, authorizationStreamIncarnation}`; session is
exactly `{kind: "session", authMode: "sessions", authorizationStreamIncarnation,
sessionId, userId}`. `authMode ∈ {"dev", "sessions"}`;
`authorizationStreamIncarnation`, `sessionId`, and `userId` are `UuidV7`. The
canonical authority key is `sha256:` over
`snapback.auth-authority.v1\n` + the JSON of the ordered
`{appId, kind, authMode, authorizationStreamIncarnation[, sessionId, userId]}`
object.

**`TransitionIntent`.** Version 1 is exactly `{formatVersion: 1, transitionId,
expectedEpoch, expectedAuthorityKey, nextEpoch, nextAuthorityKey, reason,
disposition, previousAuthority, nextAuthority}`; version 2 adds exactly
`senderConstraintThumbprint` (`Base64Url32` or `null`, where `null` is the
explicit delete marker). `nextEpoch = expectedEpoch + 1`; both authority keys
match `AuthorityKey` and must equal the canonical keys of the embedded
`previousAuthority`/`nextAuthority`; `reason` is a non-empty string;
`disposition ∈ {"delete", "preserve"}`. The transition id is `sha256:` over
`snapback.auth-transition.v1\n{appId}\n{predecessorRevision}\n{nextEpoch}\n{nextAuthorityKey}`
for v1, and over
`snapback.auth-transition.v2\n…\n{senderConstraintThumbprint ?? "delete"}`
for v2.

**`SenderConstraint`.** Exactly `{formatVersion: 1, protocol:
"snapback.sender-constrained.v2", custodyGeneration, privateKey, publicJwk,
thumbprint, nonce}`. `custodyGeneration` is `SafeInt⁺`. `privateKey` is a
live non-extractable ECDSA P-256 `CryptoKey` with usages exactly `["sign"]`.
`publicJwk` is exactly `{crv: "P-256", kty: "EC", x, y}` with `x`/`y`
`Base64Url32`. `thumbprint` is `Base64Url32`. `nonce` is exactly
`{value, generation, expiresAtMs}` with `value` `Base64Url32` and the numbers
`SafeInt⁺`. On every load, acceptance of a stored private-key handle
additionally requires a live signature binding it to the exact `publicJwk`
and `thumbprint` (see the earlier custody rules); a mismatch is corruption.

**Per-phase invariants.**

- `exhausted`: every nullable member is `null` — no publishable authority or
  credential state survives.
- `settled`: `authority` non-null; `pendingAuthority`, `pendingBearer`, and
  `pendingSenderConstraint` are `null`. Anonymous settled custody has `null`
  `bearer`, `refreshAfterMs`, and `senderConstraint`. Session settled custody
  has non-null `bearer` and `refreshAfterMs`, and in v3 a non-null
  `senderConstraint`. A retained `transitionIntent` must be the one that
  produced this state: `nextEpoch = authorityEpoch`, `nextAuthorityKey` = the
  canonical key of `authority`, same embedded authority; in v3 it must be
  version 2 with `senderConstraintThumbprint = senderConstraint.thumbprint`.
- `clearing`: `authorityEpoch ≥ 1`; `authority`, `bearer`, and
  `senderConstraint` are `null`; `pendingAuthority` non-null (the successor
  credentials may be staged in `pendingBearer`/`pendingSenderConstraint`);
  `transitionIntent` non-null with `nextEpoch = authorityEpoch` and
  `nextAuthorityKey` binding `pendingAuthority`, and its `transitionId` must
  equal the derivation over `predecessorRevision = revision − 1 ≥ 1`.

**Replacement algebra.** Fresh custody begins at exactly
`{authorityEpoch: 0, revision: 1}`. Every replacement is a compare-and-swap
that advances `revision` by exactly one and advances `authorityEpoch` by zero
or one; any regression or skip is corruption. The minimum revision of a
settled record at epoch `e` is `2e + 1`, and at that minimum the retained
transition id is derivable from `revision − 2` — validators check it.

**Storage binding (browser reference).** IndexedDB database
`snapback-auth-custody` version 1 with object stores `custody` and `leases`;
ownership via Web Locks (`snapback-auth-custody:{appId}`, exclusive) or the
transactional lease fallback (`{holderNonce: 22-char base64url,
fencingToken: SafeInt⁺, expiresAtMs: SafeInt}`, 5 s lease, 1 s renew);
custody CAS and lease validation share one transaction domain. A second
client may substitute an equivalent transactional store; the closed record
schema and the replacement algebra are the portable contract.

**The seven client-observable states.** The decided state set
(§Author decisions item 7) is the client-observable machine over this closed
record — the durable encoding needs only the three phases, and the remaining
states are validation and runtime conditions, deliberately not stored:

| State | Definition over the record |
| --- | --- |
| `anonymous` | `settled` ∧ `authority.kind = "anonymous"` |
| `active` | `settled` ∧ `authority.kind = "session"` (v3: with its sender constraint) |
| `pending` | `clearing` ∧ `pendingAuthority.kind = "session"` — a session acquisition cut over, successor issuance staged or in flight |
| `clearing` | `clearing` ∧ `pendingAuthority.kind = "anonymous"` — a logout/downgrade cut |
| `corrupt` | any record failing this schema (including sender-key liveness) — never operated on, deletion-only exit |
| `migrating` | client holds a valid v2 record on a sender-constrained lane — exits only through a fresh v2 exchange producing a v3 record (bearer upgrade-in-place is prohibited) |
| `recovery` | `exhausted`, or the post-`corrupt` deletion path — only ordinary re-authentication exits |

Transitions: `anonymous → pending` (begin session acquisition; epoch +1 cut),
`pending → active` (settle with issued credentials), `active → clearing`
(logout/downgrade; epoch +1 cut), `clearing → anonymous` (settle the cut;
v3 shells settle to anonymous v2), `active → pending` (re-issuance cut for
the same principal), any → `corrupt` (validation failure), `corrupt →
recovery` (delete), `recovery → pending` (re-authenticate), `migrating →
pending` (fresh v2 exchange). Every arrow that touches the durable record is
one CAS replacement obeying the algebra above; no other transition exists.

## Credential classes

V2 covers browser session-family credentials and browser connection grants.
Native clients must provide an equivalent non-exportable key facility before
claiming this profile.

Operator console credentials stay on the separately trusted operator origin
and are outside the app-browser claim. Agent credentials, scoped automation
tokens, pairing secrets, and secret-read leases are non-browser authorities and
remain outside this protocol. An adapter must not broaden `hostedAuthCapable`
to those classes.

### Versioned spellings and the v1-family activation/rollback matrix (landed 2026-07-27)

Decision 4's first layer is implemented: sender-bound issuance mints session
bearers in the structurally distinct `sbs2_` spelling, every refresh successor
of a sender-bound family stays `sbs2_` (selected by the durable family
binding, not the presented spelling), sender-bound connection-open and grant
rotation mint `sct2_`, and the sender lanes require the v2 spellings — the
sender-proof verifier refuses a proof presented over the legacy `sbs_`
spelling of a sender-bound family, and the sender grant lane refuses a
non-`sct2_` token. The proofless path still answers with a challenge, so the
decision-3 anti-oracle posture is unchanged: a bearer-only holder cannot
distinguish a bound family from an unknown carrier by the refusal shape.

The activation/rollback matrix decision 4 requires alongside the syntax
change:

| Server | Credential | Outcome |
| --- | --- | --- |
| pre-sender v1 | `sbs_` plain bearer | honored as today |
| pre-sender v1 | `sbs2_`/`sct2_` | structural parse failure → `SNAPBACK_AUTH_REQUIRED`-class refusal; the v1 server cannot honor a sender-bound credential as a plain bearer (the rollback defense this layer exists for) |
| v2 (this revision) | `sbs_` plain bearer, no binding | honored as today (plain bearer lanes are unchanged) |
| v2 | `sbs_` spelling over a sender-bound family, with proof | refused `SNAPBACK_AUTH_SENDER_PROOF_INVALID`; migration for live pre-change families is deletion-and-re-exchange (never attachment): the custody machine treats the refusal as deletion-only and re-authenticates under a fresh custody key |
| v2 | `sbs2_` over its bound family | admitted through the sender lanes; refuses as a bare bearer on every carrier exactly as before (the binding, not the spelling, carries the constraint) |
| v2 rolled back to v1 | live `sbs2_`/`sct2_` credentials | all fail structurally; clients re-exchange under the v1 flow — bounded re-authentication, never silent downgrade to bearer semantics |

LLP 0060 D6's mixed-version activation barrier remains the deployment-level
defense; this layer removes the sole reliance on it that decision 4 rejects.

## Diagnostics and redaction

The public diagnostics are:

- `SNAPBACK_AUTH_SENDER_PROOF_REQUIRED`;
- `SNAPBACK_AUTH_SENDER_PROOF_INVALID`;
- `SNAPBACK_AUTH_SENDER_PROOF_REPLAYED`; and
- `SNAPBACK_AUTH_SENDER_PROOF_AUTHORITY_UNAVAILABLE`.

Within `SNAPBACK_AUTH_SENDER_PROOF_INVALID`, they expose no distinction
between unknown token, wrong key, bad signature, stale time, wrong target, or
a valid re-issuance over an already-bound key (the one-live-family rule above).
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
- Concurrent connections racing the same proof id produce one success and one
  replay refusal; replay-store failure produces no application execution.
  (Witnessed today by two in-process SQLite connections across threads; a true
  two-process race remains pending, per the checkpoint.)
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

## Author decisions — 2026-07-23

Recorded by the author (Charlie Cheever) against
`issues/20260723-llp0077-rollback-ratchet.md` and
`issues/20260723-llp0077-client-contract.md`. These pin the open forks below;
they do not close any ledger defect, and every positive-capability gate stays
in force. Schema-drafting work the decisions commission remains tracked in the
client-contract ticket.

1. **Ratchet realization (security-MUST-bearing).** `sender_replay_epoch` is
   realized as a composition: it rotates only on the LLP 0059
   authorization-stream incarnation change (declared restores stay covered by
   the incarnation advance), and a dedicated control-plane monotone counter
   stored **outside the rolled-back durable set** provides the anti-rollback
   floor. On boot the effective epoch is `max(incarnation-derived value,
   control-plane floor)`, and the floor only ever advances. Monotonicity
   argument: a raw backup rollback reverts the durable tables but cannot lower
   the external floor, so no epoch value under which a proof was accepted can
   recur, and no accepted proof can resurrect. LLP 0060's serving admission
   epoch remains a distinct namespace and is not reused. The raw-rollback
   non-resurrection guarantee graduates from stated requirement to proven
   property only when `20260723-llp0077-sender-replay-epoch.md` lands the
   implementation with a restore/rollback straddle test; until then it is a
   decided design with a stated argument.
2. **Logout lost response — bounded revoked-family tombstone.** Retention is
   the maximum grant/session TTL plus maximum tolerated clock skew, hard-capped
   at 30 days. Lookup is keyed by custody family id on the refusal path. A
   tombstoned family never rotates or freshly generates a nonce. The client
   converges to LLP 0057's repeat-logout `SESSION_EXPIRED`. Eventual safe
   deletion holds because after the retention bound every credential the
   tombstone could refuse has itself expired; a long-offline client lands in
   ordinary re-authentication. The anonymous-recovery handshake alternative is
   rejected: it would add an unauthenticated protocol surface at the boundary
   this Spec exists to keep closed.
3. **Unknown carriers — keyed cover nonce.** Carriers that resolve to no live
   bound family receive a deterministic cover nonce
   `HMAC(server secret, sender_replay_epoch ‖ token_digest ‖ time_bucket)`,
   indistinguishable from a real challenge and stable within the time bucket.
   This closes the live-bound-family existence oracle at the cost of one HMAC
   on the refusal path; no state is stored for unknown carriers.
4. **Downgrade defense — both layers.** v2 sender-bound session/grant tokens
   and carriers adopt a structurally distinct, legacy-rejecting syntax
   (versioned prefix; v2 verifiers require it, v1 verifiers cannot accept it),
   and LLP 0060 D6's mixed-version activation/rollback barrier remains the
   deployment-level defense. The v1-family activation/rollback matrix is
   documented with the syntax change. Sole reliance on D6 is rejected.
5. **WebSocket successor nonce — release on first server frame.** After a
   WebSocket upgrade (whose 101 response headers JS cannot read), the
   per-custody serialization queue stays held until the first server frame
   delivers the successor nonce in band; that frame is the release event. On
   open-without-frame timeout, error, cancel, or reconnect, the client treats
   the nonce as consumed-unknown and the next request resynchronizes through a
   fresh challenge — a nonce is never reused. This fixes the full
   browser-observable open/error/cancel/reconnect machine in terms of
   observable events only.
6. **`BoundGrantAuthorityV2`.** The sender-bound grant shape extends LLP
   0059's `BoundGrantAuthorityV1` with the custody key's JWK thumbprint and
   the `sender_replay_epoch` at issuance. Equality is exact-tuple; the grant
   invalidates when the family is revoked or the epoch advances past its
   issuance value; the version field keeps V1 grants valid only on
   non-sender-bound lanes. The corresponding dated LLP 0059 amendment rides
   `20260723-llp0077-grant-binding.md`, which this decision unblocks.
7. **`AuthCustodyV3` — complete closed schema commissioned.** The custody
   schema is specified as a complete closed top-level and nested
   `formatVersion` schema (deny-unknown-fields) with exactly seven states —
   `anonymous`, `pending`, `active`, `clearing`, `corrupt`, `migrating`,
   `recovery` — and explicit transitions, replacing the insufficient "V2
   plus" description. LLP 0059's premature "closed" claim is reconciled by its
   amendment pointing here as the owning schema. The schema text landed the same
   day — see §The closed `AuthCustodyV3` schema (landed 2026-07-23); the
   seven states are realized as the client-observable machine over the
   three-phase durable record, exactly as that section defines.

## Open questions

- Whether the first browser implementation keeps signing in the page or behind
  a typed service-worker network broker. Either posture has the same
  off-device-replay claim; a signing-only worker is not an XSS boundary.
- Exact provider selected for the shared nonce and replay authority in the
  first single-instance adapter. SQLite is acceptable only while one process is
  the serialized authority and restart/backup semantics preserve expiry.
- *(Decided 2026-07-23 — bounded revoked-family tombstone, parameters pinned; §Author decisions item 2.)* The exact logout-lost-response recovery mechanism (bounded revoked-family
  tombstone versus anonymous-recovery handshake), its retention bound,
  resolution path, nonce treatment, and composition with LLP 0057's
  repeat-logout `SESSION_EXPIRED`.
- *(Decided 2026-07-23 — composition: 0059 incarnation + control-plane monotone floor; §Author decisions item 1.)* The exact *storage and realization* of `sender_replay_epoch` — a dedicated
  durable column, a value derived from the LLP 0059 authorization-stream
  incarnation, or a composition — and the concrete non-rollbackable ratchet
  source. The *observable* contract is fixed and not reopened here: it is a
  namespace distinct from LLP 0060's serving admission epoch, it rotates only
  on the LLP 0059 incarnation change, and it is non-rollbackable. Only the
  realization behind that observable contract is open.
- *(Decided 2026-07-23 — keyed cover nonce adopted; §Author decisions item 3.)* Whether unknown carriers must receive a stable keyed cover nonce, or the
  residual live-bound-family existence signal is acceptable.
- Whether v2 later admits a bounded multi-flight lease of one-use nonce
  tickets instead of strict per-custody serialization.
- *(Decided 2026-07-23 — queue releases on the first server frame; §Author decisions item 5.)* When a browser cannot read a successful WebSocket upgrade's successor nonce,
  when the serialization queue releases and how the next request resyncs, and
  the full browser-observable open/error/cancel/reconnect state machine.
- *(Decided 2026-07-23 — thumbprint + issuance epoch, exact-tuple equality; §Author decisions item 6.)* The versioned sender-bound grant shape that extends LLP 0059's
  `BoundGrantAuthorityV1` (thumbprint + admission epoch), its equality and
  invalidation rules, and the corresponding LLP 0059 amendment.
- *(Decided 2026-07-23 — closed seven-state schema commissioned; §Author decisions item 7.)* The complete closed `AuthCustodyV3` top-level and nested `formatVersion`
  schema for an independent implementation (the current "V2 plus" description
  is not sufficient).
- *(Decided 2026-07-23 — legacy-rejecting v2 syntax plus the D6 barrier; §Author decisions item 4.)* Whether v2 session/grant tokens gain a legacy-rejecting syntax, or LLP 0060
  D6's mixed-version activation/rollback barrier is the sole downgrade defense.

## Conformance (server-side MUST-level requirements)

This list is the **server/wire-observable** conformance target; the client
custody schema (the complete closed `AuthCustodyV3`) and the sender-bound
grant shape (`BoundGrantAuthorityV2`) are deferred to the open questions, so a
second *client* cannot yet be built from this Spec alone. The client-side
canonical-URI rule (reject `.`/`..`, `%`, backslash, doubled-slash rather than
resolve) is part of this target but is not yet met by the shipped client — see
defect 11. A second server
implementation is tested against, at minimum: the closed ES256/P-256
header and payload with `deny_unknown_fields` and canonical unpadded base64url;
the exact issuance and resource proof payloads and the `senderConstraint`
exchange schema; canonical-URI reconstruction by **rejection** (never
resolution) of `%`, backslash, doubled-slash, and dot-segment paths; the
inclusive time window `iat ∈ [now−30, now+5]`; replay retention to `iat+30+1`
with an exclusive `< now` purge on both replay and nonce tables; challenge never
rotates a live nonce (fresh generation only when absent or expired); rotation
only inside the atomic consume/rotate transaction of a verified proof;
`publicJwk` equals the proof-header JWK; the distinct durable
`sender_replay_epoch` that rotates only on the LLP 0059 incarnation change
(with atomic family revocation and table clear) and is non-rollbackable;
per-custody request serialization; and the every-use grant-bound proof rule on
both carriers.
