# LLP 0247: Ordinary client normalization and recovery

**Type:** RFC
**Status:** Accepted
**Systems:** Client integration, JS headless client, React, Expo, Auth, Live
Queries, Ephemeral state, Diagnostics, Code generation, Guide, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-12
**Revised:** 2026-08-12 (author acceptance: Charlie Cheever accepted this RFC at
the exact revision bound by the final GPT-5.6 Sol round-3 READY artifacts,
SHA-256 `9afb001a67438dfed3fe7ba94ec861c9e9b30ed9720d4b7d48aa15ea08e35ef9`; see
`llp/reviews/0245-0249-single-family-super-refine.md`). 2026-08-12 (round-2 revision: fenced same-authority withdrawal by
acknowledged room/entry generation; added delayed/ambiguous republish vectors).
2026-08-12 (round-1 revision: replaced impossible Proxy detection
with observable descriptor admission, separated one-shot auth refusal from
continuing blocked resources, and returned authority-loss withdrawal to the
server barrier). 2026-08-12 (entered an author-invoked, single-family GPT-5.6 Sol
xhigh refinement loop; initial Draft came from later Sonnet/Kimi Clique
evidence and composed with accepted LLP 0238 without changing its ownership
model)
**Related:** LLP 0043, LLP 0059, LLP 0061, LLP 0101, LLP 0107, LLP 0114,
LLP 0144, LLP 0178, LLP 0198, LLP 0218, LLP 0219, LLP 0236, LLP 0238,
LLP 0241

## Summary

Snapback's generated client should accept ordinary TypeScript object
construction where intent is unambiguous, keep protected continuing reads stable
while authority is anonymous, reject one-shot reads locally, withdraw presence
promptly, and expose one public way to catch typed one-shot refusals.

This RFC adds four narrowly bounded behaviors:

1. strip own properties whose value is `undefined` only where the generated
   contract marks that property optional;
2. model protected reads as authority-blocked resources that wake on authority
   transition without poisoning the client;
3. make published-to-`skip` a withdrawal transition; and
4. make every one-shot verb throw the same public `SnapbackDiagnosticError`,
   while result/task state retains truthful non-error outcome unions.

## Motivation

Later Clique builders reproduced behaviors that documentation alone did not
prevent. A natural send payload—`{ replyToId: quoting?.id }`—failed because an
explicit optional `undefined` is not canonical. A protected query attempted
before sign-in could oscillate in React and leave the same client unable to
complete a later valid auth exchange. `skip` stopped presence renewal but left
the previously published member visible until separate deletion. Action and
mutation refusal access differed enough that a builder probed raw envelopes.

These are not arguments for permissive values or weaker authority fences. The
generated client already knows which omissions are unambiguous, the auth
coordinator already owns transitions, and ephemeral publication already has a
delete operation. The common path should compose those facts.

## Constraints

- The canonical value grammar does not admit `undefined` as a transmitted or
  stored value.
- Required properties, array elements/holes, untyped string-name calls, and
  unknown/extra fields remain fail-closed.
- An anonymous or blocked protected read cannot reveal predecessor/successor
  data and cannot license retry under a new authority without a fresh barrier.
- Presence remains ephemeral latest-state data, not durable settlement.
- Queued mutation dispatch and command/task state are truthful outcomes, not
  exceptions (LLP 0218; LLP 0238).

## Decision

### D1. Contract-directed optional omission

Before canonicalization, a generated reference normalizes input objects against
its exact argument contract. At an object property declared optional, an own
property with value `undefined` is treated exactly as absence and removed. The
rule recurses only through closed object contracts.

Captured intrinsic prototype/key/descriptor operations snapshot only enumerable
string data properties on ordinary/null prototypes into an internal null-
prototype tree; Snapback invokes no accessor. These still refuse before its
resource or network work:

- `undefined` for a required property;
- `undefined` or a hole in an array/tuple position;
- `undefined` inside an open JSON value;
- an unknown/symbol property, accessor descriptor, disallowed observable
  prototype, cycle, or otherwise non-plain observable shape; and
- any call without a generated exact contract.

JavaScript cannot portably detect a `Proxy`; inspection may invoke its traps and
it may present an ordinary shape. V1 promises neither Proxy detection nor trap-
free inspection of arbitrary inputs. Only the captured data snapshot may
proceed, after closed canonicalization. A no-trap boundary would require a
separately branded generated carrier.

Defaults apply after omission using the existing declared default semantics.
Normalization emits no warning on the admitted path; generated types/JSDoc say
that optional own-property `undefined` is equivalent to omission.

### D2. Protected continuing reads wait; one-shot reads refuse locally

When a generated live reference requires authenticated authority and
`currentPrincipal` is `loading`, `anonymous`, `refreshing`, or `blocked`, a
`watch`/live hook does not issue an application request under the wrong state:

- `loading` and `refreshing` produce one stable pending/refreshing resource;
- `anonymous` produces a stable `blocked` snapshot with public reason
  `authentication-required`, not an error/pending retry oscillator;
- protocol/custody `blocked` preserves the typed diagnostic and remediation;
  and
- a transition to authenticated crosses LLP 0059's authority barrier, creates
  a fresh query instance, and only then performs the request.

A server-side unauthenticated refusal caused by a race is scoped to that
request/resource. It cannot mark the whole client permanently stale. A valid
later `authExchange` on the same client succeeds unless its own captured
authority/generation facts are genuinely stale. Predecessor callbacks are
discarded without clearing or poisoning the successor.

`client.read` remains a one-shot promise, never a snapshot. A protected read
rejects before application I/O with `SnapbackDiagnosticError`: retryable auth-
not-settled for `loading`/`refreshing`, `authentication-required` for anonymous,
or the custody/protocol diagnostic for `blocked`. The caller retries after auth;
only continuing handles wake and construct a fresh authority-fenced instance.

### D3. Presence has explicit active and withdrawn states

The owner retains its acknowledged `(scopeEpoch, entryVersion)`. Published →
`skip` or disposal while authority is current stops keepalives and sends an
idempotent withdrawal bound also to connection/authority generation. Under the
room lock, the server deletes only the exact current pair; mismatch settles
`superseded`. Republish proceeds immediately: delayed/ambiguous retries keep
the predecessor predicate and cannot delete its successor. Stale authority
cancels application withdrawal and yields to the barrier.

On authority loss, the client stops keepalives and blanks/quiesces without a
predecessor application delete. LLP 0059/0107 server-barrier cleanup owns
remote removal, with TTL backstop; explicit transition removal is server
control, never predecessor app work.

`skip` retains the read room; never-published sends none. Current ambiguous
withdrawal is surfaced and bounded-retried; `superseded` cannot change successor
state. The target's `withdrawalVisibilityDeadlineMs`, at most half its TTL,
drives tests and diagnostics.

### D4. One public typed refusal exception

`client.read`, `client.run`, and the immediate settled/refused paths of
`client.dispatch` reject application/protocol refusal with
`SnapbackDiagnosticError`. It exposes stable `code`, public `diagnostic`,
operation/ref kind, retry/effect facts, and `cause` where safe. Generated
helpers provide one `isSnapbackDiagnosticError` guard.

Low-level transport envelopes remain available from the advanced protocol
entry point, but primary APIs do not require callers to know whether an action
once returned `{ ok: false }` while a mutation threw. Successful results remain
plain typed results. A queued dispatch remains a resolved queued union, and a
command/task reports lifecycle failures in its observable state/done contract;
this RFC does not convert nonterminal or ambiguous outcomes into exceptions.

### D5. Generated lifecycle metadata owns normalization and failure tables

LLP 0238's client-lifecycle manifest gains:

- argument normalization version and optional paths;
- authority admission/outcome per verb and operation kind;
- presence stop/dispose action plus authority-loss barrier owner;
- primary failure carrier and public error type; and
- guide/diagnostic anchors.

Headless, React/Expo, generated reference-bound helpers, and examples are gated
against the same table.

## Compatibility and migration

Optional-`undefined` acceptance is an additive success path but changes a
previous local refusal; it ships behind the generated-reference capability and
is not applied to legacy string calls. Presence withdrawal adds network work on
a published-to-skip edge but matches the visible meaning builders expected.

The primary action failure carrier is a compatibility migration. For one
release, raw-envelope behavior remains under the low-level import and the old
primary method emits a dev deprecation pointing to `client.run` and the error
guard. Package versions remain lockstep.

## Rollout

1. Fix client-wide authority poisoning and add same-client anonymous-read →
   valid-auth-exchange regressions under existing LLP 0059 semantics.
2. Add stable auth-blocked query resources and React no-oscillation tests.
3. Add contract-directed optional omission with cross-client golden vectors.
4. Add conditional presence withdrawal on skip/dispose and barrier cleanup.
5. Normalize one-shot refusal access and publish generated failure tables.
6. Rerun Clique messaging/auth choreography from a fresh npm app.

## Acceptance

- `{ replyToId: maybeUndefined }` and conditional omission produce identical
  canonical bytes when `replyToId` is optional; required, array, open-JSON, and
  legacy-string cases still refuse before I/O.
- Attempting a protected one-shot read while anonymous rejects once with the
  common error guard and no transport request; a protected live handle renders
  one stable auth-required state across 1,000 retry intervals/renders; a later
  valid sign-in plus fresh read/automatically rebuilt live instance succeeds on
  the same client.
- A raced server refusal cannot make an unrelated later auth exchange stale;
  real predecessor completions still fail closed under LLP 0059.
- Published typing → `skip` disappears from another client within the
  generated target's `withdrawalVisibilityDeadlineMs` rather than waiting for
  TTL; the room remains active. Delayed/lost-response withdrawal → republish
  cannot delete the successor. Authority loss starts no predecessor app delete;
  server/barrier cleanup removes the member.
- Query/action/mutation application refusals are caught with the same public
  error guard, while queued dispatch remains a resolved queued outcome.
- All normalization and failure-carrier behavior occurs identically in
  headless and React/Expo paths and is generated in reference JSDoc.

## Risks

- Stripping `undefined` can hide a mistake. It is limited to exact optional
  properties where TypeScript already models omission and undefined together.
- Auth gating can mask server regressions if applied too broadly. Only generated
  authenticated requirements gate locally; optional-user/public requests still
  reach the server normally.
- Immediate presence withdrawal adds traffic. It occurs once per semantic
  active→withdrawn edge and composes with LLP 0238's canonical-value dedupe.
- Normalizing exceptions must preserve effect ambiguity. The error always
  carries effect/retry facts and never converts an ambiguous action into a safe
  retry.

## Open questions

1. Should optional nested properties inside `v.json()` remain strictly opaque
   forever, as proposed, or can a future schema-bearing JSON contract admit
   recursive omission?
2. What compatibility epoch removes the primary raw action envelope?

## Status

Accepted. Accepted by the author on 2026-08-12 at the revision bound by the
final single-family GPT-5.6 Sol READY review. The authority-poisoning
correction is a defect fix against LLP 0059/0238 semantics and may land first;
optional omission, presence withdrawal, and the public failure-carrier
migration follow this RFC's compatibility staging.
