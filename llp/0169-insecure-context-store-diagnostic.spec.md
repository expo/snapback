# LLP 0169: Insecure-context browser store diagnostic

**Type:** Spec
**Status:** Draft
**Systems:** Client SDK, Browser, Diagnostics, Local sync, Offline sync, Developer experience, Testing
**Author:** Codex (gpt-5.6-sol) / Charlie Cheever
**Date:** 2026-08-04
**Related:** LLP 0008, LLP 0043, LLP 0090, LLP 0129, LLP 0166, LLP 0168, `diaries/0056-warble-local-first-microblog.diary.md`

## Summary

Snapback's default browser persistence arm requires IndexedDB and Web Locks.
Web Locks is exposed only in a secure context. On an ordinary HTTP LAN origin,
a browser can therefore have IndexedDB but not Web Locks; the current resolver
falls through to memory and reports the generic reason `no-durable-backend`.

This Spec gives that exact condition the distinct reason
`insecure-context-no-web-locks` and one deduplicated development warning. It
does not change the fallback, make an insecure origin durable, alter any wire
protocol, or depend on the dev-edge research in LLP 0168.

## Scope and authority

This Spec owns only:

- classification of one default-store fallback condition;
- the observable `rqsStoreInfo.reason` value for that condition;
- the development warning and its deduplication; and
- acceptance coverage proving adjacent resolver arms do not change.

LLP 0008#decision-dk-9--client-local-store-mandate-2026-07-02 owns the
store-agnostic client-store contract and the requirement to report the physical
implementation and degradation mode. LLP 0043 and LLP 0090 own retention,
outbox, and resume semantics. LLP 0166 owns the broader carrier/profile matrix.
This Spec changes none of those contracts.

## Current behavior and causal boundary

As of 2026-08-04,
[`packages/snapback-client/rqs-store-default.mjs`](../packages/snapback-client/rqs-store-default.mjs):

1. detects IndexedDB through `globalThis.indexedDB?.open`;
2. detects Web Locks through `globalThis.navigator?.locks?.request`;
3. constructs the IndexedDB store only when both functions exist;
4. continues through the React Native and Node arms otherwise; and
5. ends at `memoryFallback('no-durable-backend')`.

The [Web Locks specification](https://w3c.github.io/web-locks/) marks the API
`[SecureContext]`. The [Secure Contexts algorithm](https://w3c.github.io/webappsec-secure-contexts/#potentially-trustworthy-origin)
admits HTTPS and standard loopback/`localhost` development origins but not an
ordinary private-LAN HTTP origin. LLP 0168 records the two-axis topology
research; this Spec needs only the browser-observable facts.

## Requirements

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

### S1. Exact classification predicate

The default resolver MUST select the new reason only when all of these are
true:

- the caller did not inject or explicitly disable `rqsStore`;
- `globalThis.indexedDB?.open` is a function;
- `globalThis.navigator?.locks?.request` is not a function;
- `globalThis.isSecureContext === false`; and
- the host reaches the resolver's terminal browser/unknown-host fallback rather
  than the React Native or Node arm.

An absent or non-boolean `isSecureContext` MUST NOT be treated as `false`.
IndexedDB absence MUST NOT be diagnosed as a Web Locks secure-context failure.
Web Locks absence in a secure context may mean browser support or policy and
MUST retain the generic fallback reason until separately classified.

### S2. Store behavior remains unchanged

When S1 matches, the resolver MUST still call the existing memory fallback. If
the memory store is constructed, `rqsStoreInfo` MUST be:

```json
{
  "source": "default",
  "implementation": "memory",
  "durable": false,
  "reason": "insecure-context-no-web-locks"
}
```

If memory-store construction itself cannot obtain secure randomness, the
existing higher-priority `secure-random-unavailable` unavailable result MUST
win. The new reason must not mask a failure to construct the fallback.

### S3. Development warning

When a `SnapbackClient` adopts an S1 result, the package MUST report it through
the shape this package already uses for silent degradations: record the
diagnostic, deliver it to an optional caller-supplied sink, and otherwise
`console.warn` **un-gated**.

Three budgets, deliberately different (the sink contract below is normative;
this sentence is the summary): the default `console.warn` fires **at most once
per realm** for this reason; a supplied sink is called **once per client**; and
recording is **per client, never deduplicated**. A realm containing both
sink-bearing and sink-less clients therefore still emits at most one console
warning, and every client keeps its own record.

**The warning is not gated on a development-build heuristic.** The round-1
review established that a two-signal `__DEV__` / `globalThis.process.env`
predicate is *inert under Vite*, one of the two first-class carriers: Vite
defines neither at runtime, and the `globalThis.` prefix specifically defeats
the `define` substitution that would otherwise rescue it (bundler `define` keys
match `process.env.NODE_ENV`, not `globalThis.process.env.NODE_ENV`). Under
that predicate a Vite app served over LAN HTTP would select the memory store
and emit nothing — the structured reason would survive but the human-visible
half would not, on the exact carrier this Spec exists to serve.

Un-gated reporting also matches in-repo precedent for the same class of event:
the §0B.6 wire-version downgrade is emitted through record → optional injected
sink → `console.warn` with no build-mode gate, on the stated rationale that a
downgrade is never silent. A store downgrade to volatile memory is that same
class, and LLP 0008 DK-9 requires the degradation mode to be reported.

#### The sink and record contract

Round-2 review found "record → sink → warn" underspecified: the package today
has only the wire-specific `onWireVersionDiagnostic` / `wireVersionDiagnostics`
pair, so acceptance had no public API to test. This slice therefore names it:

- **Constructor option** `onRqsStoreDiagnostic?: (diagnostic) => void`, a
  per-client sink. Supplying it suppresses the default `console.warn`.
- **Diagnostic shape**, matching the package's existing diagnostic envelope:
  `{ schemaVersion: 'snapback.client-diagnostic.v1', code:
  'SNAPBACK_RQS_STORE_INSECURE_CONTEXT', severity: 'warning', subsystem:
  'client', message, details: { reason: 'insecure-context-no-web-locks',
  implementation: 'memory', durable: false } }`.
- **Record surface** `client.rqsStoreDiagnostics()` returns the diagnostics
  recorded by *that client*, so a client constructed after the realm-wide
  warning already fired still exposes the fact programmatically.
- **Deduplication scope:** the once-per-realm rule governs **delivery of the
  default `console.warn` only**. Recording is per-client and never deduplicated
  across clients — otherwise a later client would have no retrievable evidence
  of its own degraded store. A supplied sink is called once per client, not
  once per realm.
- **Exception behavior:** a sink that throws MUST NOT fail client construction
  or alter store resolution. The throw is swallowed; the record is still kept.

Callers that need silence in production supply a sink and drop the value; the
package MUST NOT infer build mode to decide whether a durability loss is worth
mentioning.

The warning MUST name all of the following without including the backend URL,
credentials, or environment values:

- `insecure-context-no-web-locks`;
- that Snapback selected volatile memory;
- that retained state cannot survive reload and durable offline queueing is
  unavailable; and
- that a **top-level** trusted HTTPS or standard loopback browser origin
  satisfies the secure-context requirement — an insecure ancestor defeats it —
  and that Web Locks support is still separately required, since HTTPS cannot
  restore an API the browser does not implement; cross-origin routing is a
  separate concern again.

The warning text itself is not a protocol field. Tests SHOULD assert its facts
and deduplication, not punctuation.

### S4. Compatibility boundary

`rqsStoreInfo.reason` is observable application state. This change adds a new
value to that field and replaces `no-durable-backend` only for S1. Consumers
that exhaustively match reason strings must add the new member.

The following remain byte-for-byte or behaviorally unchanged:

- `source`, `implementation`, and `durable` for the S1 fallback;
- explicit injected store and explicit opt-out results;
- `SNAPBACK_CLIENT_RQS_STORE=off`;
- successful IndexedDB, React Native file, and Node file arms;
- `no-native-files-registered`, `no-state-directory`,
  `secure-random-unavailable`, and every other existing reason;
- retention and offline-queue admission rules; and
- HTTP, WebSocket, readiness, and persisted-store formats.

### S5. Application projection

Development surfaces SHOULD render at least `implementation`, `durable`, and
`reason` from `client.rqsStoreInfo`. A console warning is not a substitute for
an in-app fact on a remote device. This is presentation guidance, not a
requirement that client construction fail.

## Acceptance

The client package must exercise the resolver with controlled globals and
prove the following. **Test-listener constraint:** any case needing a
non-trustworthy origin MUST use a loopback-only listener reached through a
non-trustworthy hostname mapped to loopback, never a real LAN bind — a test
suite must not teach binding a dev server to the network.

1. browser-like host, IndexedDB present, Web Locks absent,
   `isSecureContext === false` → memory with
   `insecure-context-no-web-locks`;
2. the same host with `isSecureContext === true` → memory with the existing
   generic `no-durable-backend` reason;
3. the same host with `isSecureContext` absent → no insecure-context
   classification;
4. insecure context with IndexedDB absent → no insecure-context classification;
5. IndexedDB and Web Locks present → the IndexedDB arm remains durable;
6. React Native registered/unregistered and Node directory/no-directory cases
   retain their existing arms and reasons;
7. explicit store injection, explicit opt-out, and the environment kill switch
   bypass the new classification and warning;
8. memory-store secure-random failure reports `secure-random-unavailable`;
9. two clients in one realm produce exactly one report containing the S3
   facts, with no build-mode gating — asserted in a realm where neither
   `__DEV__` nor `process.env.NODE_ENV` is defined (the Vite-browser shape),
   since a build-mode predicate would be inert exactly there;
10. `onRqsStoreDiagnostic` receives the typed diagnostic and suppresses the
   default `console.warn`; a sink that throws neither fails construction nor
   changes store resolution; `client.rqsStoreDiagnostics()` still records for a
   client constructed after the realm warning already fired; and
11. the public `SnapbackClient.rqsStoreInfo` object exposes the new reason, not
    merely the lower-level resolver result.

At least one browser acceptance must load an ordinary HTTP non-loopback origin
and assert the browser facts (`isSecureContext === false`, IndexedDB present,
Web Locks absent) before asserting the reason. A unit test that only mocks those
facts is necessary but not sufficient for the browser claim.

## Non-goals

- Provision TLS, certificates, DNS, tunnels, or a dev edge.
- Change CORS or same-origin routing.
- Treat every missing Web Locks implementation as an insecure-context failure.
- Make memory durable or relax durable offline-queue admission.
- Promote a warning to a thrown startup error.
- Define a general diagnostic-event API for the client package.

## Rollout and status

Implementation belongs in the default resolver and client-construction path,
with focused client-package tests and a browser-carrier acceptance. The guide's
browser persistence page should add the new reason when the implementation
lands. Warble may render the full reason in its existing store diagnostics, but
the demo is evidence, not the contract owner.

This Spec is Draft and unimplemented. It is independently shippable; no answer
to LLP 0168's edge question is a prerequisite.
