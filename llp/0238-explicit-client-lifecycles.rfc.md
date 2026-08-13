# LLP 0238: Explicit client lifecycles

**Type:** RFC
**Status:** Accepted
**Systems:** Client integration, JS headless client, React, Expo, Auth,
Live Queries, Offline sync, Ephemeral state, Diagnostics, Code generation,
Guide, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-12
**Revised:** 2026-08-13 (dated familiar-alias exception: LLP 0252/0253 preserve
this RFC as the full canonical lifecycle while authorizing a narrowed,
measured Experimental entrypoint). 2026-08-12 (post-acceptance evidence amendment: records the later
Clique auth-gate, optional-`undefined`, presence-stop, and refusal-carrier
findings and routes new semantics through Draft LLP 0247 rather than silently
widening this accepted v1). 2026-08-12 (entered Review for the author-directed single-family
`llp-super-refine` loop: Codex GPT-5.6-sol xhigh only; Claude intentionally
skipped). 2026-08-12 (mechanically renumbered from LLP 0236 to LLP 0238 after
origin assigned LLPs 0234–0235). 2026-08-12 (author-directed acceptance after
Round-3 same-revision Codex GPT-5.6-sol xhigh convergence). 2026-08-12 (round-1 revision: froze `watch`, in-place refresh,
subscription ordering, the v1 React read boundary, and durable mutation
observation states). 2026-08-12 (round-2 revision: aligned durable mutation
observation exactly with LLP 0218's additive-open disposition union and
non-enumerating authority boundary). 2026-08-12 (initial Draft synthesized from
LLP 0236 P4, P5, P11, and P12)
**Related:** LLP 0012, LLP 0043, LLP 0059, LLP 0061, LLP 0101, LLP 0107,
LLP 0114, LLP 0146, LLP 0155, LLP 0178, LLP 0218, LLP 0219, LLP 0227,
LLP 0236, LLP 0237, LLP 0239, LLP 0240, LLP 0241, LLP 0242, LLP 0243,
LLP 0247,
Diary 0067, Diary 0071, Diary 0073, Diary 0075

## Summary

Snapback should expose one explicit lifecycle vocabulary across generated
references, the headless client, React/Expo hooks, authentication, live
queries, mutations, commands, assets, and presence.

The current APIs are individually defensible but collectively easy to
misread. “Query” sometimes means a one-shot query and sometimes only a live
query. A mutation promise describes dispatch, not necessarily durable
settlement. A live handle looks plausibly iterable but is actually polled and
disposed. Auth has a rigorous coordinator but no obvious current-principal
projection. Inline objects can look semantically stable while churning a hook.

This RFC makes those differences visible in names and types:

- `read` is one-shot;
- `watch` is live and returns a disposable observable handle;
- `dispatch` reports settled-versus-queued truthfully;
- `mutation(id)` observes durable settlement;
- `task` is an owned long-running workflow;
- `currentPrincipal` is the canonical auth projection; and
- `publishPresence` is latest-state ephemeral publication, not a durable
  mutation.

Existing low-level semantics remain. The improvement is a coherent generated
facade, nominal reference kinds, content-keyed inputs, and one handle grammar
that makes misuse difficult before runtime.

## Motivation

LLP 0236 records the same mistakes across isolated builders:

- passing an ordinary query to `useSnapbackQuery`, which accepts live refs;
- treating a headless live handle as an async iterator and omitting connection
  identity or disposal;
- reading a queued mutation dispatch as the server result;
- churning subscriptions or presence publication with per-render object
  identity; and
- enumerating auth-coordinator methods to discover the signed-in principal.

LLP 0218 makes the mutation dispatch union truthful, and LLP 0219 detects the
worst client dark loops. Those fixes should not remain islands. The generated
facade should use their distinctions as its primary vocabulary, and the same
lifecycle should appear in headless, React, Expo, docs, and diagnostics.

### Post-acceptance implementation evidence

Later isolated Clique builders exposed four narrower lifecycle failures after
this RFC's accepted snapshot: an authenticated read attempted while anonymous
could leave the client unable to perform a later valid auth exchange; a
protected React read could oscillate between pending and error while authority
was unchanged; changing a published presence value to `skip` stopped renewal
without promptly withdrawing the old member; and the ordinary TypeScript shape
`{ optionalField: maybeUndefined }` refused even when the generated contract
knew the field was optional. One builder also had to probe whether a failure
would throw or arrive as an action envelope.

The authority poisoning and unchanged-authority retry loop are defects against
D6's typed, settled principal-state model and must receive regression coverage
in this implementation. Contract-directed `undefined` omission, presence-stop
semantics, and one public refusal carrier are new compatibility decisions.
Draft LLP 0247 owns those decisions and composes with this RFC after acceptance;
this evidence note does not silently add them to accepted v1.

## Design constraints

- Queued intent is neither committed success nor an error. Durable settlement
  remains owned by the outbox facts (LLP 0218#decision).
- A React convenience must project the framework-neutral client rather than
  create a second transport, cache, auth, or custody model (LLP 0114).
- Live and retained values must expose freshness; no local or optimistic state
  may be presented as server authority (LLP 0155#p4-prediction-is-never-authority).
- User switch and authority loss keep the existing synchronous clear/fence
  behavior (LLP 0059; LLP 0107).
- Generated reference kind, argument, result, identity, and guide metadata come
  from the codegen authority; facades do not infer them at runtime.
- Diagnostics are bounded, payload-safe, and dev-only by positive environment
  identification (LLP 0219#decision).

## Decision

Publish a new generated `api.client` facade with kind-specific methods and a
shared observable-handle protocol. Existing methods remain as compatibility
aliases through a measured migration window.

### D1. Generated references are nominal by operation kind

Generated references become nominal types with a runtime `kind` discriminant:

```ts
type QueryRef<Args, Result>;
type LiveQueryRef<Args, Result>;
type MutationRef<Args, Result>;
type ActionRef<Args, Result>;
type CommandRef<Args, Result>;
```

They are not structurally interchangeable even when their argument and result
types happen to match. Every reference also carries editor-visible JSDoc
generated from its contracts:

- the legal client verbs;
- authority and capability requirements;
- freshness/retention profile;
- possible dispatch or task states;
- a build-bound guide anchor; and
- the operation’s semantic identity.

A kind mismatch is primarily a TypeScript error. JavaScript and skewed-package
callers receive `SNAPBACK_CLIENT_REFERENCE_KIND_MISMATCH` with the received
kind, accepted kinds, correct verb, and guide anchor before transport work.

### D2. Headless verbs name the lifecycle

The canonical surface is:

```ts
await client.read(api.messages.page, args);

const watch = client.watch(api.messages.livePage, args, {
  connection,
});

const dispatched = await client.dispatch(api.messages.send, args, {
  queue: "auto",
});

const mutation = client.mutation(dispatched.clientMutationId);

const action = await client.run(api.notifications.deliver, args);

const task = client.start(api.media.sendCommand, args);
```

Semantics:

- `read(QueryRef)` performs one authoritative one-shot query and returns its
  versioned result.
- `watch(LiveQueryRef)` returns `WatchHandle`; it never returns a promise of a
  final answer and is not an async iterator.
- `dispatch(MutationRef)` returns LLP 0218’s settled/queued union. The settled
  branch contains the validated result; the queued branch contains accepted
  intent identity and presentation facts.
- `mutation(id)` returns a non-consuming durable observation handle over LLP
  0218’s exact additive-open disposition union: `pending`, `settled`, `failed`,
  `stranded`, `quarantined`, `resultGone`, and `unknown`. It works after process
  relaunch only while that governing store retains the record. Lookup is scoped
  to the current app, client store, user, and authority instance. An absent id,
  an ACK-consumed/collected record, or an id available only in an inaccessible
  predecessor authority partition maps to `unknown`, licensing no existence,
  failure, or settlement inference. `resultGone` remains LLP 0218's distinct
  outcome-known/result-expired state; this facade creates no acknowledgement,
  collection, or predecessor-existence tombstone and no second consumption cut.
- `run(ActionRef)` performs a one-shot action. External effects remain
  non-rollbackable even when result validation fails.
- `start(CommandRef)` returns an owned task for workflows with progress,
  cancellation, retry, or multiple phases.

The verbs are available both as `client.*` and generated reference-bound
helpers where that does not obscure kind, for example
`api.messages.page.read(client, args)`. There is no generic `invoke()` in the
recommended facade.

### D3. One observable handle grammar

Every continuing client object implements the subset of this grammar that its
lifecycle can honestly support:

```ts
interface ObservableHandle<State> {
  snapshot(): State;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

interface WatchHandle<State> extends ObservableHandle<State> {
  refresh(): Promise<WatchRefreshOutcome>;
}

interface TaskHandle<State, Done> extends ObservableHandle<State> {
  done: Promise<Done>;
  cancel(reason?: string): Promise<void>;
}

type WatchRefreshOutcome =
  | { status: "refreshed"; snapshotVersion: string }
  | { status: "refused"; diagnostic: Diagnostic };
```

Rules:

- `snapshot()` is synchronous and never establishes currency by itself.
- `subscribe()` registers the listener and queues exactly one microtask
  notification for the current snapshot; it never calls the listener
  synchronously or re-enters the caller before returning. Subsequent changes
  use the same serialized notification queue.
- the returned unsubscribe and `dispose()` are idempotent;
- disposal generation-fences in-flight work before resource release;
- `WatchHandle.refresh()` is an in-place fresh-snapshot request. It preserves
  handle, connection, and canonical resource identity; concurrent calls
  coalesce onto one request; it crosses the ordinary authority/resnapshot
  barrier, generation-fences predecessor callbacks, and settles only after the
  fresh snapshot applies or a typed refusal is known. Calling it after disposal
  rejects with `SNAPBACK_CLIENT_HANDLE_DISPOSED`; it never creates a successor
  handle implicitly;
- `done` exists only when the lifecycle has a first terminal state;
- durable mutation observation has no `done` promise as its authority because a
  process-local promise cannot survive relaunch; callers subscribe to its
  retained status; and
- no handle is async-iterable unless a later RFC defines buffering, backpressure,
  termination, and restart semantics.

Existing `rows`/`poll()` live handles gain an adapter to `WatchHandle`. Their raw
shape remains available under an explicitly low-level import for one release,
then follows measured deprecation.

### D4. React and Expo hooks are kind-explicit

The recommended hooks become:

```ts
useSnapbackLiveQuery(liveRef, args, options)
useSnapbackMutationDispatch(mutationRef, options)
useSnapbackMutationStatus(clientMutationId)
useSnapbackTask(commandRef, options)
useSnapbackCurrentPrincipal()
useSnapbackPresence(roomRef, options)
```

V1 intentionally has no canonical `useSnapbackRead`. One-shot React/Expo work
uses `client.read` from an event, router loader, or the application’s chosen
cache/suspense owner; Snapback will not introduce a second underspecified cache
lifetime merely to make `read` hook-shaped. A later hook RFC may add one after
cache ownership, suspense, refresh, and eviction are frozen.

`useSnapbackLiveQuery` always exposes:

```ts
{
  data,
  status,
  freshness: "current" | "retained" | "optimistic" | "unknown",
  diagnostic,
  refresh,
}
```

The exact data/result shape continues to come from the generated ref. The
wrapper does not collapse retained or optimistic data into `current`.

`useSnapbackQuery` remains a deprecated compatibility alias for the live hook
only. Its declaration and runtime diagnostic both spell
`useSnapbackLiveQuery`; no generated docs present the ambiguous name as the
primary path.

### D5. Semantically equal inputs do not churn resources

Hooks and framework-neutral stores key inputs by the canonical generated
argument contract, reference identity, authority partition, and options—not
object identity. Therefore an inline `{ roomId }` object does not resubscribe
when its canonical value is unchanged. Invalid or uncanonicalizable inputs
refuse before resource construction.

Defaulted options are normalized before hashing. The normalization grammar and
its version are generated lifecycle-manifest inputs, so adding a default cannot
silently rotate or alias an existing resource key.

Presence publication uses the same principle. The hook publishes only when the
canonical value changes or a declared keepalive is due; render frequency alone
cannot consume the rate budget. Values are compared after contract
normalization, not through deep equality over arbitrary objects.

LLP 0219’s identity-churn detector remains. It now reports an implementation
defect if semantically equal inputs churn a first-party resource and an
application diagnostic if canonical values really are changing too quickly.
The event names ref, hook kind, canonical input hash, construction/disposal
counts, and remediation without carrying raw arguments.

### D6. Current principal is a first-class projection

The headless auth surface gains:

```ts
client.auth.currentPrincipal(): CurrentPrincipalSnapshot
client.auth.subscribeCurrentPrincipal(listener): () => void
```

React/Expo project it through `useSnapbackCurrentPrincipal()`.

The closed state union distinguishes:

- `loading` — custody or refresh has not settled;
- `anonymous` — settled with no principal;
- `authenticated` — principal, session class/provider, authority instance, and
  expiry are current;
- `refreshing` — an authenticated predecessor remains usable only under its
  existing custody rules; and
- `blocked` — typed custody/protocol/authority refusal with safe remediation.

There is no `null` that ambiguously means loading, anonymous, or failure. The
projection is derived from `AuthCoordinator` and LLP 0059 session facts; it is
not a new auth owner. Password methods commissioned by LLP 0227 join the same
typed auth namespace and generated reference page.

### D7. Vocabulary and state tables are generated once

The operation/reference generator emits a client-lifecycle manifest containing:

- reference kind → legal verbs/hooks;
- handle state and terminal tables;
- dispatch/settlement distinctions;
- auth projection states;
- resource key ingredients;
- diagnostics and guide anchors; and
- compatibility aliases with removal epochs.

Headless declarations, React/Expo declarations, code examples, control-catalog
entries, and guide tables are generated or gated against this manifest. Terms
such as `entries`, `members`, `rows`, `current`, `queued`, `settled`, `done`,
and `dispose` cannot drift independently across first-party arms.

### D8. Diagnostics arrive at the misuse site

In positive dev mode:

- a kind mismatch names the correct verb/hook;
- a continuing handle that remains undisposed after owner teardown reports its
  construction site;
- a queued dispatch emits the LLP 0218/0219 event and names
  `useSnapbackMutationStatus`/`client.mutation`;
- a real resubscribe storm reports canonical value changes and rate;
- presence over-publication reports the declared budget and stable-value
  guidance; and
- auth protocol/custody mismatch points to `currentPrincipal` state and the
  exact acquisition path.

Production does not enable the console reporter by default. Structured errors
and types remain available everywhere.

## Compatibility and migration

This RFC is an API migration, not a wire-protocol change. It reuses the query,
live, mutation, settlement, auth, command, asset, and ephemeral carriers.

Migration has three stages:

1. Ship nominal reference types, new verbs/hooks, adapters, and codemods while
   existing names remain supported. Generated examples use only the new names.
2. Emit dev deprecations for ambiguous/low-level names and measure first-party
   and known external call sites. Package minors remain lockstep where a new
   return union is involved, per LLP 0218.
3. Remove aliases only in a declared major compatibility epoch. Raw protocol
   and low-level handles remain available from a separate advanced entry point.

`useSnapbackMutation` follows LLP 0218’s accepted return-type migration and is
not independently redefined here. The new name makes its dispatch semantics
obvious and provides the stable destination for the compatibility period.

## Dated amendment — 2026-08-13: narrowed familiar aliases

This RFC remains the complete canonical client-lifecycle surface. LLP 0252 and
LLP 0253 authorize only the following measured exception in the deletable
Experimental familiar entrypoint: `useQuery` projects familiar-branded live
references to online-current data or `undefined`; `useMutation` projects the
settled-only `queue:false` path; `useAction` projects the one-shot `run` verb;
and `useQueryState` is the canonical full-state hook by identity. The familiar
entry owns no cache, transport, outbox, auth coordinator, or task state.
Retained/offline/queued work, refresh and diagnostic rendering, durable
mutation observation, commands, and every excluded lifecycle remain on this
RFC's full canonical vocabulary. The familiar spellings neither replace the
canonical names nor broaden their semantics; their continuation is governed by
LLP 0252's measurement and stop rule.

## Alternatives considered

### Improve documentation without renaming APIs

Declined as the complete fix. The pilot hit documented traps. Names, nominal
types, and call-site diagnostics carry information at the point an agent makes
the choice.

### One generic `useSnapback(ref)` hook

Declined. It shortens spelling by hiding the exact distinctions the evidence
shows agents miss: one-shot versus live, dispatch versus settlement, and
resource versus task.

### Make every continuing surface an async iterator

Declined. Iterators need buffering, backpressure, termination, restart, and
multi-subscriber semantics; they are a poor fit for external stores and durable
mutation state. The observable-handle grammar is explicit and framework-neutral.

### Make mutation dispatch await final settlement

Declined by LLP 0218 and preserved here. A process-local promise cannot own an
offline lifecycle across termination or relaunch.

## Rollout

1. Generate the lifecycle manifest and nominal refs; add kind-mismatch
   diagnostics and JSDoc.
2. Add the headless facade and handle adapters without changing old behavior.
3. Add current-principal projection and the kind-explicit React/Expo hooks.
4. Move resource keys to canonical contract values and run the churn/presence
   adversarial suite.
5. Update templates, guide snippets, and npm examples; retain cold-agent probes
   for every recurring LLP 0236 mistake.
6. Begin measured alias deprecation only after published-package fixtures and
   all first-party consumers pass under the new vocabulary.

## Acceptance

- TypeScript rejects each wrong reference-kind/verb pair with the correct
  replacement visible in the error or JSDoc.
- JavaScript emits the same correction before network activity.
- An inline argument object with unchanged canonical content creates one live
  resource across 1,000 renders; a genuinely changing value produces a bounded
  diagnostic before main-thread saturation.
- Presence publishes on semantic changes/keepalive only, not renders.
- Offline mutation dispatch is visibly `queued`; final result is recovered
  through mutation status after process relaunch.
- A headless watch is usable without guessing: snapshot, subscribe, refresh,
  and dispose are all typed; async iteration is absent.
- Current-principal state distinguishes loading, anonymous, authenticated,
  refreshing, and blocked without prototype enumeration or raw-route probes.
- Headless, React, and Expo state/vocabulary tables pass a generated parity
  gate.
- A fresh npm-only agent completes one read, one live watch, one queued mutation
  with later settlement, one presence publication, and one auth projection
  without reading package source.

## Risks

- Additional names can feel like more API. The counterweight is a generated
  kind-specific facade, templates that use only it, and one lifecycle grammar.
- Nominal types can frustrate advanced adapters. The low-level entry point
  remains, with explicit conversions that preserve runtime kind checks.
- Canonical input keys may be expensive for large arguments. Argument contracts
  are already bounded; key computation must publish size/time diagnostics and
  share hashing with existing identity machinery.
- Auth state may expose too much metadata. The public projection carries only
  facts already available to the authenticated client and follows schema-driven
  redaction.

## Open questions

1. Which compatibility epoch can remove `useSnapbackQuery` from primary
   exports without stranding published examples?

## Status

Accepted. This RFC requests decisions on the public vocabulary, common handle
grammar, current-principal state union, and compatibility path. V1 chooses
`watch`, an observable durable mutation handle, and no canonical one-shot React
hook. It does not supersede LLP 0218 or LLP 0219; it makes their truthful
semantics the default shape across every first-party client arm.
