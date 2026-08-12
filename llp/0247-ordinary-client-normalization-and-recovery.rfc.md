# LLP 0247: Ordinary client normalization and recovery

**Type:** RFC
**Status:** Review
**Systems:** Client integration, JS headless client, React, Expo, Auth, Live
Queries, Ephemeral state, Diagnostics, Code generation, Guide, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-12
**Revised:** 2026-08-12 (entered an author-invoked, single-family GPT-5.6 Sol
xhigh refinement loop; initial Draft came from later Sonnet/Kimi Clique
evidence and composed with accepted LLP 0238 without changing its ownership
model)
**Related:** LLP 0043, LLP 0059, LLP 0061, LLP 0101, LLP 0107, LLP 0114,
LLP 0144, LLP 0178, LLP 0198, LLP 0218, LLP 0219, LLP 0236, LLP 0238,
LLP 0241

## Summary

Snapback's generated client should accept ordinary TypeScript object
construction where the contract makes intent unambiguous, keep protected reads
stable while authority is anonymous, withdraw presence promptly, and expose one
public way to catch typed refusals across one-shot operation kinds.

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

The following still refuse before resource or network work:

- `undefined` for a required property;
- `undefined` or a hole in an array/tuple position;
- `undefined` inside an open JSON value;
- an unknown property, accessor, proxy, exotic prototype, cycle, or getter; and
- any call without a generated exact contract.

Defaults apply after omission using the existing declared default semantics.
Normalization emits no warning on the admitted path; generated types/JSDoc say
that optional own-property `undefined` is equivalent to omission.

### D2. Protected reads wait on authority rather than retrying transport

When a generated query/live reference requires authenticated authority and
`currentPrincipal` is `loading`, `anonymous`, `refreshing`, or `blocked`, the
client does not issue an application request under the wrong state:

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

### D3. Presence has explicit active and withdrawn states

`publishPresence(ref, value)` and its hook owner track whether this owner has a
published member. A transition from a published value to `skip`, hook disposal,
or authenticated-owner loss issues one idempotent delete/withdrawal under the
captured connection/authority generation. It stops keepalives immediately.

The read-side room remains subscribed when the caller uses `skip`. A never-
published owner sends no delete. Failed/ambiguous withdrawal is surfaced in the
presence state and retried only within the existing ephemeral bounded retry
policy; TTL remains a final cleanup backstop, not the ordinary stop mechanism.

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
- authority admission state per operation kind;
- presence stop/dispose action;
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
4. Add presence withdrawal on skip/dispose/authority loss.
5. Normalize one-shot refusal access and publish generated failure tables.
6. Rerun Clique messaging/auth choreography from a fresh npm app.

## Acceptance

- `{ replyToId: maybeUndefined }` and conditional omission produce identical
  canonical bytes when `replyToId` is optional; required, array, open-JSON, and
  legacy-string cases still refuse before I/O.
- Attempting a protected read while anonymous performs no transport request,
  renders one stable auth-required state across 1,000 retry intervals/renders,
  and a later valid sign-in plus fresh read succeeds on the same client.
- A raced server refusal cannot make an unrelated later auth exchange stale;
  real predecessor completions still fail closed under LLP 0059.
- Published typing → `skip` disappears from another client within the ordinary
  withdrawal latency bound rather than waiting for TTL; the read-side room
  remains active.
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
2. Should `authentication-required` be a distinct `status` or a reason inside
   LLP 0238's existing `blocked` state?
3. What compatibility epoch removes the primary raw action envelope?

## Status

Draft. The authority-poisoning correction may land as a defect fix before this
RFC is accepted; optional omission, presence withdrawal, and public failure-
carrier changes require acceptance.
