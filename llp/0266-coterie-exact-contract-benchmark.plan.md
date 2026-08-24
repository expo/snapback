# LLP 0266: Coterie Exact/Contract social-messenger benchmark

**Type:** Plan
**Status:** Draft
**Systems:** Benchmarks, Demos, Exact, Contract, Native clients, Provider adapters, Social messenger
**Author:** Codex / Charlie Cheever
**Date:** 2026-08-15
**Revised:** 2026-08-24 (author ruling for M6 message-envelope growth: use an
explicit scoped 10,000-row result profile, preserve one-version atomic
single-window live replacement, qualify its measurable cost, and refuse the
10,001st message from stored admission state; implementation is the next lane)
**Revised:** 2026-08-16
**Related:** LLP 0000, LLP 0004, LLP 0005, LLP 0007, LLP 0008, LLP 0064,
LLP 0108, LLP 0137, LLP 0189, LLP 0200, LLP 0201, LLP 0267, LLP 0278,
`benchmarks/briefs/social-messenger.md`,
`benchmarks/tools/social-messenger/CONTRACT.md`,
`issues/20260817-coterie-message-envelope-growth.md`

## Summary

Coterie is the Exact/Contract sibling of Clique: a single-source social-
messenger application for web, macOS, and iOS that exercises the same
observable product workload while remaining replaceable at the backend
boundary. Its default backend is a deterministic in-memory provider, so the
client can be built and driven before Snapback or another backend is attached.

Coterie is deliberately a separate product and benchmark lane. LLP 0201 fixes
Clique as the canonical React Native/Expo client, and changing that client
stack in place would make existing Clique evidence incomparable. Coterie may
reuse the social-messenger brief, fixtures, semantic automation IDs, and visual
tokens without inheriting Clique's name or implementation framework.

## Goals

1. Port the frozen Clique presentation contract to Contract components without
   React, React Native, or Expo.
2. Preserve the `sm-*` semantic identifiers and observable screen vocabulary
   in `benchmarks/tools/social-messenger/CONTRACT.md` so the same choreography
   can be adapted without coordinate-based selectors.
3. Run one Contract source tree through Exact's web, macOS, and iOS hosts.
4. Keep all backend-specific behavior behind Exact's public
   `ContractDataProvider` seam and generated bindings.
5. Ship a backendless local provider and deterministic fixture state as the
   baseline for UI work and client-side benchmark measurements.

## Non-goals

- Renaming or replacing Clique, its accepted Expo baseline, or its existing
  evidence.
- Claiming backend parity from the backendless provider. Persistence, auth,
  multi-client reactivity, offline recovery, authority, and scale remain
  provider-specific evidence.
- Introducing a Coterie-private Snapback protocol or a provider API above
  Exact's public data seam.
- Pixel-identical output across web, AppKit, and UIKit. Equivalent structure,
  interactions, semantics, and design tokens are the portable contract.

## Decisions

### D1. Identity and benchmark lineage

The product and repository name is **Coterie**. Benchmark records identify it
as the `social-messenger` family with an `exact-contract` client profile and a
`clique-feature-parity` workload. Reports must say "Coterie" for the client and
"Clique" only for the canonical Expo comparator; "Clique Contract" is not a
name or alias.

### D2. Repository placement

The runnable application lives at `demos/coterie/`. That directory owns its
Contract source, Exact project files, provider declaration, generated provider
artifacts, deterministic backendless provider, and tests. Shared benchmark
authorities remain where they are:

- product workload: `benchmarks/briefs/social-messenger.md`
- semantic interaction IDs: `benchmarks/tools/social-messenger/CONTRACT.md`
- fixture identities and media: `benchmarks/fixtures/social-messenger/`
- Clique React Native reference kit: `benchmarks/tools/social-messenger/ui/`

The Contract port may copy values from the reference kit, but it must not make
the existing React Native package depend on Exact or change the frozen Clique
surface.

### D3. Presentation-port rule

The port preserves meaning, not implementation syntax. Contract components
take plain typed values and callback actions; they do not import provider
clients, query handles, navigation objects, or backend-specific types. The port
preserves the reference kit's spacing, radii, type scale, palette roles,
component states, and `sm-*` identifiers. Platform-native controls and text
metrics may differ.

Coterie receives its own deterministic vector mark and product wordmark. The
Clique raster icon is a visual reference, not a source asset to recolor or
rename.

### D4. Backend boundary

Contract components import only binding functions generated from one
`ProviderNativeDeclaration`. At boot, the application configures those links
with a conforming `ContractDataProvider`:

```text
Contract views -> generated Coterie bindings -> ContractDataProvider
                                             -> in-memory fixtures (default)
                                             -> Snapback adapter (later)
                                             -> another conforming adapter
```

The default provider uses Exact's paved row-level boundary and satisfies the
provider conformance suite. Backend adapters own persistence, live delivery,
mutation authority, connection state, receipts, and ephemeral delivery. UI
code must not infer those facts or build a second offline queue above the seam.

### D5. Backendless semantics

"Backendless" means deterministic local process state, not a fake claim of
durability. The stage-1 shell supports immediate queries and mutations for the
screens and interactions it actually exposes, resets from committed fixtures,
and advertises only capabilities it implements. Screens or controls whose
semantics require unfinished backend behavior stay absent and are staged by D6
rather than rendered as inert or misleading affordances. Restarting the app may
reset data. Multi-client sync, server authority, durable auth, and offline
recovery are explicitly absent until supplied by an adapter.

### D6. Feature and evidence progression

Coterie follows LLP 0201's M1-M8 observable order, but its evidence is a
separate lane:

1. **Shell:** Exact scaffold, Coterie identity, design tokens, reusable Contract
   components, deterministic fixtures, and provider seam.
2. **Backendless feature surface:** all brief screens and user-triggered state
   transitions are present with the frozen semantic IDs.
3. **Host proof:** Contract compilation plus real web, macOS, and iOS semantic
   tree/interaction evidence. Each platform is claimed only from its own run.
4. **Provider lanes:** Snapback and other adapters run the same provider
   conformance suite and adapted social-messenger choreography.
5. **Benchmark comparison:** records distinguish client/runtime measurements
   from backend/provider measurements and bind claims to scoped qualification
   digests under LLP 0189.

### D7. Milestone-frozen provider surfaces (resolves OQ1)

The provider declaration grows milestone by milestone, targeting Clique's
reduced run M1-M3 before any full-declaration claim:

- **M1:** accounts, sessions, profiles, avatars.
- **M2:** posts, feeds, follows, likes, reposts, replies, pagination.
- **M3:** DMs, groups, membership, messages, typing, receipts, quoted replies.
- **M4:** message reactions.
- **M5:** chat search, chat accent, and disappearing-message settings.

Each milestone's operations receive explicit compatibility tokens and are
frozen before a backend adapter implements them; an adapter claims a milestone
only when it conforms to that frozen token set. M4-M8 follow after M1-M3 in
LLP 0201's observable order, with M7 (polls plus a real message-count
migration) run last and in a fresh session so migration evidence is not
contaminated by resident state.

Query tokens live in the core `compatibilityToken` field; mutation tokens are
frozen in the corresponding namespaced milestone compatibility-token
extension until Exact's mutation schema grows a first-class field.

### D8. Provider selection at boot

One boot-time factory selects the active provider from `COTERIE_PROVIDER`
(`memory` is the default; `snapback` is the first backend value). Every
provider implements the same provider-neutral Coterie declaration, exposes the
manifest generated from that exact declaration, and configures the same
generated Contract bindings. An adapter must not generate bindings from its own
provider identity, capability set, or extensions: those bytes intentionally
change Exact's declaration digest and therefore cannot satisfy the shared
binding handshake. The shared declaration records the binding surface's common
guarantees; lane-specific capabilities remain provider qualification evidence.
Unknown provider values fail loudly at boot. No `.contract` component, route,
or generated binding may observe which provider is active. Benchmark records
name the provider lane explicitly: the memory lane measures client/rendering
baselines, the Snapback lane measures end-to-end backend behavior, additional
conforming providers measure portability, and Clique remains the React Native/
Expo comparator.

### D9. Snapback backend placement

The Snapback backend is application-owned under `demos/coterie/snapback/`
(`schema.mjs`, `functions.mjs`, seed fixtures, `generated/`), authored in
sessions mode. Its M1 obligations: email/password signup and login, durable
sessions with logout revocation, server-authorized profile reads and edits,
avatar upload and attachment, and deterministic installation of the M1
fixture identities from `benchmarks/fixtures/social-messenger/`. The adapter
that maps generated Snapback operations onto the frozen declaration lives
with the app, behind Exact's public `ContractDataProvider` seam; no
Coterie-private protocol above that seam (unchanged from D4).

### D10. Acceptance harness (direction for OQ2)

Coterie automation stays one parameterized choreography runner that imports
the frozen `sm-*` ID authority from
`benchmarks/tools/social-messenger/CONTRACT.md`; the IDs are never forked
into a Coterie-specific driver. One repository command runs the Coterie
acceptance flow against the selected provider. Per completed milestone, the
evidence bar is: two simultaneous browser contexts proving multi-client live
behavior, an iOS native bundle plus semantic interaction artifact, a macOS
run through a compatible Exact host, and an unchanged `sm-*` tree relative
to Clique. `bun run verify:coterie` remains the fast client/provider gate.

### D11. Claims-driven affordance visibility

The shared declaration exposes `listProviderClaims`, a provider-neutral query
of claimed operation names, kinds, and compatibility tokens. Presentation code
uses those claims to gate every mutation affordance, including its inputs and
submit controls: an affordance bound to an unclaimed mutation is absent, never
inert or allowed to fail only after a press. Query-driven screens are not
claims-gated; they continue to subscribe and render their typed loading,
error, stale, empty, and ready states. Memory claims every operation it
implements; partial adapters report their qualified allow-list and keep
refusing every unclaimed operation loudly. No route or `.contract` component
may observe provider identity to make this decision. This preserves D8's seam
while permitting milestone-partial adapters to render an honest usable subset
of the common surface.

## Author ruling — M6 scoped result-profile growth (2026-08-24)

**Ruling: choose path 1, narrowly scoped to an explicit result profile.**
Implementation is the next lane. Declaration v8 stays byte-for-byte frozen,
and this design-only revision changes no runtime constant, declaration,
compatibility token, backend envelope, or advertised Coterie capability.

The deciding invariant is exactness, not implementation convenience. Cursor
pagination gives up Snapback's atomic single-window exact-live semantics:
cutoff, insert, and delete races across independently versioned pages are
gap-free only if the client performs an atomic cross-page transition.
“Eventually converges” is not exactness. The scoped profile retains one
authoritative array at one commit version, so the remaining risk is the
measurable cost of evaluating, hydrating, validating, replacing, transporting,
and retaining that larger window. M6 must measure and pass that cost rather
than assume it is free.

### D1 — Explicit scoped result profile

`QUERY_MAX_LIMIT` and `QUERY_DEFAULT_LIMIT` remain 1,024. Absence of an
opt-in continues to mean the current 1,024-row behavior for every existing
application and function. No invocation argument, client declaration, result
contract by itself, or target configuration may enlarge a query.

The implementation lane adds one closed platform profile with stable id
`large-result-window-v1`. The exact authoring shape is:

```js
export const listMessagesV9 = defineJsLiveQuery({
  resultProfile: {
    id: "large-result-window-v1",
    maxItems: 10_000,
  },
  result: results.records(chatMessageRow, {
    minItems: 0,
    maxItems: 10_000,
  }),
  // ...
  handler: async (ctx, args) =>
    ctx.db
      .query("messages")
      // authorization and ordering omitted here
      .take(10_000)
      .collect(),
});
```

The source shape has exactly `id` and `maxItems`. The v1 profile accepts an
integer `maxItems` from 1,025 through 10,000; 10,000 is its hard ceiling, not a
target or an unbounded promise. Codegen normalizes the request into function
manifest metadata containing:

```json
{
  "id": "large-result-window-v1",
  "maxItems": 10000,
  "maxResultBytes": 33554432,
  "maxResultNodes": 524288
}
```

The byte and node ceilings are fixed platform properties of profile v1, not
author-tunable fields. The existing depth, per-string, per-JSON-value, and
nested-array limits remain unchanged; only the function's top-level authored
database/result window receives the larger item bound. A lower qualified
`maxItems` uses the same profile and tighter function bounds.

Admission is deliberately redundant:

1. `packages/snapback-codegen/define.mjs` accepts the new field only on
   `defineJsQuery`, `defineJsLiveQuery`, and `defineJsMutation`; v1 rejects it
   on actions, host plans, and non-JS functions. On queries it bounds both the
   explicit database take and the top-level records result. On mutations it
   can bound an explicit internal database take but does not enlarge a scalar
   mutation result. Codegen includes the normalized profile in the function
   implementation identity and generated references.
2. `crates/snapback-types/src/manifest/types.rs` keeps
   `QUERY_MAX_LIMIT = QUERY_DEFAULT_LIMIT = 1_024`. Its ordinary plan and
   `Records.rows.maxItems` checks remain unchanged when the profile is absent.
   With the supported profile present, it requires every explicit plan limit,
   top-level records `maxItems`, declared `queryCost.maxResultRows` and
   `queryCost.maxResultBytes`, and requested profile maximum to be mutually
   consistent and no larger than the profile's hard caps. An orphan larger
   result contract or plan is invalid.
3. Activation requires the target/runtime generation to advertise support for
   `large-result-window-v1` and an enabled cap at least as large as the
   function's request. An old target, unsupported execution cell, or target
   with a lower cap refuses before traffic switches.
4. The engine resolves the profile from the prepared function definition and
   passes that trusted value through the Ibex and workerd invocation payloads.
   `packages/snapback-harness/ctx-bootstrap.js` retains 1,024 as its implicit
   collection/default limit but permits an explicit `.take(n)` only up to that
   trusted per-invocation cap. The engine revalidates every resulting plan, so
   editing harness JavaScript or passing call arguments cannot widen it.
5. Result-contract validation, the app-result carrier, live publication, and
   client decoding all enforce the profile's 32 MiB/524,288-node complete
   result ceiling before publication. Carrier framing may reserve at most
   64 KiB beyond the declared payload limit; it may not become an unrelated
   second unbounded ceiling.

Coterie v9 applies the profile to `listMessages`. If
`markReceiptsThrough` still materializes more than 1,024 receipt/message rows
inside one atomic mutation, its versioned backend function must opt into the
same trusted profile and its work is part of M6 qualification; a scalar
mutation result does not evade the internal query bound. `sendMessage` does
not need the larger query window because D4 replaces the capped query-as-count
with stored admission state.

This mechanism is a real platform capability, not merely a Coterie plan
detail. Its implementation lane must first create and accept a focused
platform Spec for profile semantics, target admission, and the closed limits,
then amend LLP 0004, LLP 0007, LLP 0108, and LLP 0267 where their current
1,024/4 MiB and pagination rules are governed. In particular, LLP 0267 needs a
narrow, evidence-backed `atomic-single-window` exception to its ordinary
pagination posture; it does not receive a general “large query” exemption.

### D2 — Exact one-version live semantics

`listMessages@5` remains **one query, one subscription, one result array, and
one atomic live window**. It has no cursor, pages, downstream page state
machine, retained snapshot tail, or provider-owned background walk.

The existing ordered/limited live-query semantics from LLP 0008 apply
unchanged at the larger cap:

- the server evaluates all authorized rows against one database commit version,
  orders and hydrates them as one result, validates the complete result, and
  emits one `live_replace` carrying that version;
- the client accepts versions monotonically and atomically replaces the prior
  authoritative array with the complete new array—no consumer can observe a
  mixture of old and new boundaries;
- current-as-of scheduling and latest-value coalescing may discard work or an
  intermediate replacement only when a later complete replacement subsumes
  it; they may never splice partial results or declare an incomplete prefix
  current; and
- removal, logout, and revocation use the existing authority fence. After the
  fence, no stale authorized result may publish; the next allowed state is the
  exact cutoff-scoped complete window (or the ordinary blank/error state) at
  one version.

Thus an insert or tombstone/delete at the 10,000-row edge changes a single
versioned array. There is no cross-page gap, duplicate, mixed cutoff, or
“eventual” repair to reason about.

### D3 — M6 cost qualification

The 10,000 profile is claim-gated, not presumed viable. Qualification uses the
frozen scale corpus's real busy conversation: exactly 10,000 messages and 50
members, with its real profiles, quotes, reactions, edits/tombstones, and
per-member receipt rows. It runs in every execution cell for which support is
claimed. Each isolated probe has three warm-ups followed by 20 measured
observations and a 30-second per-observation timeout, matching the benchmark
protocol. A second 120-second sustained phase starts from the authoritative
9,880-message prefix, sends the final 120 fixture messages at 1 Hz to reach
exactly 10,000, advances delivered/read receipts for every other current
member within two seconds of each send, and performs a membership
removal/cutoff while affected subscriptions are armed. The separate D4 probe
then attempts message 10,001.

The measurement artifact records, per commit/version and per subscription:

- queued, started, completed, canceled, coalesced, and duplicate evaluations,
  including peak concurrently in-flight evaluations;
- database consultations, scanned rows, and hydration host calls/rows split by
  messages, quotes, profiles, reactions, receipts, and memberships;
- validated result rows, nodes, and bytes, plus encoded `live_replace` frame
  bytes and total replacement bytes on each socket;
- logical subscriptions, socket managers, physical sockets, reconnects, and
  budget warnings;
- server RSS, handler-runtime RSS, client heap/local-result-store bytes, and
  post-GC growth; and
- commit acknowledgement/settlement, replacement convergence, authority-fence
  application, and cutoff/restoration convergence.

Ten thousand is qualified only if all of these predeclared thresholds pass:

1. **Evaluation:** at most one real `listMessages` evaluation is in flight per
   subscription. Over a phase, completed evaluations are no more than initial
   establishment plus committed invalidating versions; coalescing may reduce
   that count but duplicate same-version evaluation or delivery fails. Every
   completed evaluation stays below LLP 0267's 1,000 ms live-turn admission
   ceiling, with no timeout, quarantine, resync, or refusal.
2. **Hydration:** one evaluation visits no more than the corpus-required
   10,000 message rows, 10,000 quote references/targets, 50 distinct profile
   rows, 490,000 receipt rows, 50 memberships, and the exact reaction rows
   named by the fixture. Each category also has to be within 1.25× its
   independently computed necessary-row count. The artifact reports both the
   absolute ceiling and amplification ratio so an N+1 implementation cannot
   pass behind a fast machine.
3. **Replacement:** every published array has exactly the expected authorized
   row count and stays at or below 32 MiB and 524,288 nodes. Each invalidating
   version produces at most one complete frame, each frame is at most 32 MiB
   plus 64 KiB framing, and total socket bytes equal the sum of recorded
   frames—no hidden second transfer or one-shot history tail.
4. **Sockets:** message history adds exactly one live subscription and one
   physical socket-manager attachment per observing view. The whole chat view
   remains at or below LLP 0278's 16-subscription warning budget and every
   connection remains below the 64-subscription hard budget, with zero
   reconnect or budget-warning churn during the sustained phase.
5. **Memory:** no server, handler, or client process grows by more than
   256 MiB over its matched armed-view baseline. After warm-up, post-GC
   retained memory may differ by at most 5% between the first and last
   30-second plateaus; any positive unbounded slope, OOM, or result-store
   duplication fails.
6. **Settlement and convergence:** sends and receipt advances settle with
   p50 below 1 second and p95 below 3 seconds; refused mutations settle at p95
   below 250 ms; and sustained throughput is at least 50% of the same run's
   zero-observer settlement throughput. Each ordinary complete replacement
   converges within 5 seconds (p95 at most 2 seconds); the authority fence
   applies at p95 at most 500 ms and cutoff/restoration completes at p95 at
   most 10 seconds. No visible stall, timeout, lost receipt aggregate, or
   post-cutoff row is allowed.

A pass records raw samples, environment, fixture/digest identities, cap values,
and derived verdicts. If 10,000 misses **any** threshold, v9 does not activate
or advertise 10,000. The implementation may qualify a lower cap from the
predeclared sequence 8,192, 4,096, or 2,048, changing `maxItems` and the stored
write bound together and recording a new scoped digest. If no useful raise
passes, the work returns for an author ruling on pagination or a new
server-side atomic aggregate/window primitive. It must never silently ship a
slow 10,000-row window.

### D4 — A real 10,001 admission bound

V9 adds a private, stored `messageEnvelopeCount` to each conversation. It is
the exact count of message rows addressable by `listMessages`: send increments
it; tombstone/edit does not decrement it; any future physical purge or expiry
that removes an addressable row decrements it in the same transaction. It is
not M7's user-visible `messageCount` field and makes no M7 product claim.
Before v9 activation, a deterministic migration backfills it from authoritative
message rows and proves equality for every conversation.

`sendMessage@5` performs authorization and input validation, reads the stored
count, and then, **before allocating or writing a message, receipt, membership,
conversation, notification, or event row**, applies this guard:

```js
if (conversation.messageEnvelopeCount >= 10_000) {
  ctx.refuse("MESSAGE_ENVELOPE_EXCEEDED", {
    limit: 10_000,
    attemptedCount: conversation.messageEnvelopeCount + 1,
    resultProfile: "large-result-window-v1",
  });
}
```

The successful transaction inserts the message and its receipt rows and
increments `messageEnvelopeCount` atomically. The count read participates in
commit conflict detection (or an equivalent atomic compare-and-increment), so
two concurrent attempts at 9,999 cannot both commit: exactly one may become
message 10,000 and the loser is retried to the structured
`MESSAGE_ENVELOPE_EXCEEDED` refusal. A generic conflict must not leak as the
public boundary result.

The public v9 provider maps that refusal to the declared structured
`MessageEnvelopeExceededError` / `message_envelope_exceeded` code. Tests prove
the refusal is pre-write by comparing the conversation, message, receipt,
membership, notification/event counts, and commit version before and after.
`.take(limit).length >= limit` is forbidden as admission state: a 10,000-row
window cannot establish that a hidden 10,001st row does not already exist.

### D5 — V8/v9 compatibility is a cap parameter, not two page runtimes

The existing v8 provider declaration remains byte-frozen at source SHA-256
`27895ba105b5aab7f632691d5e865683ae433ac1d5ecd7e589450079ff1fdf6e`
and generated binding digest
`e0be7bf6f9f5bc27`. Its absent profile means the unchanged default
1,024-row profile; its executable fixture route still calls
`messageHistoryEnvelopeLimit() === 1_024` and loudly refuses message 1,025.
The implementation lane must not globally retarget that helper.

V9 is a sibling declaration and separately generated binding set. It keeps the
external one-array `listMessages` shape—there is no cursor field—and opts its
versioned backend query into `large-result-window-v1` at the qualified cap.
Backend cores receive an immutable version/cap parameter: v8 passes 1,024 and
v9 passes the qualified value. This is parameterized single-window behavior,
not a dual page runtime and not a compatibility reinterpretation of v8.

Compatibility tokens move wherever the observable cap/error behavior moves:

- `listMessages` core token `4 → 5` for the larger one-array contract/profile;
- `sendMessage` core token `4 → 5` for stored-count admission and the
  10,001 structured boundary;
- the namespaced `markReceipt` extension token `1 → 2` because v9 receipts
  must advance coherently across the larger message envelope; and
- every other v9 surface token is audited against its implementation route.
  A token remains unchanged only when its arguments, result/error contract,
  authorization, cap, and mutation effects are unchanged. Edit, tombstone,
  reaction, quote, search, membership, and chat-settings routes may not
  accidentally select a v8 helper merely because their token stays stable.

Matching v8 and v9 declaration/binding/provider/backend sets pass their own
digest handshakes; each cross-pair refuses. V8 is a checked behavioral fixture,
not merely a byte fixture. It remains green at 1,024/1,025 after v9 activates.

### D6 — Acceptance and claim gate

Every claim below is paired with a checker designed to fail a subtly wrong
implementation:

1. **Profile isolation:** manifest/codegen/harness/engine conformance proves
   absent-profile 1,024 behavior, valid requested caps, rejection at 10,001,
   rejection of an orphan larger result contract or plan, unchanged nested
   arrays, unsupported-target refusal, invocation arguments that cannot widen
   the cap, and implementation-identity rotation when profile metadata changes.
2. **Exact reachability:** the public custom-client/grader path receives all
   10,000 expected busy-chat ids in strict sequence as one array from one live
   subscription, with exact hydrated fields and no privileged export, cursor,
   page, silent truncation, or second fetch.
3. **Concurrent live exactness:** a deterministic interleaving test holds old
   evaluations while sends, edits, tombstones/deletes, and receipt writes
   commit. It exercises insert/delete at the 10,000 edge and asserts every
   emitted `live_replace` equals the complete authorized database result at
   the frame's own commit version—order, ids, projections, and count—with no
   gap, duplicate, mixed version, partial splice, or stale frame accepted.
4. **Membership cutoff:** with the 10,000-row window armed, a member removal
   races a held pre-cutoff evaluation and concurrent send. The authority fence
   prevents every stale frame after cutoff; the surviving single replacement
   is exactly the rows below the removal sequence at one version. Logout,
   revocation, and rejoin/incarnation behavior remain fail-closed and exact.
5. **Cost and 50-member settlement:** the D3 isolated and sustained
   measurements run at 10,000/50. They verify evaluation/hydration bounds,
   bytes, sockets, memory, send and receipt settlement, live convergence,
   cutoff behavior, and every numeric threshold. A test that only replays a
   snapshot cannot satisfy this item.
6. **Admission boundary:** sequential and barrier-synchronized concurrent
   tests admit exactly message 10,000, then make message 10,001 return the
   structured envelope code before every write. They corrupt/backfill the
   stored count in a disposable fixture to prove migration validation catches
   disagreement rather than trusting a truncated query.
7. **Compatibility:** the checked v8 route proves its source/generated
   digests, one-array 1,024 reachability, message-1,025 pre-write refusal, and
   receipt behavior. The v9 route proves the qualified cap, message-10,001
   refusal, and `markReceipt@2` behavior. Token manifests are exhaustive and
   both v8/v9 cross-pairs fail closed.
8. **LLP 0189 qualification:** the exact platform Spec revision, profile
   implementation, Coterie v9 declaration/provider/backend artifacts,
   migration, both provider implementations where applicable, concurrent-live
   checkers, and raw D3 evidence form one scoped qualification digest. Support
   is cell-explicit; an unqualified runtime or target does not inherit the
   claim. Until that digest is green and accepted, Coterie advertises only the
   v8 1,024-message envelope.

The implementation lane must also reconcile the social-messenger brief's
currently paging-shaped scale assertions with this author ruling through the
brief's freeze process. The busy-chat count and scale workload remain; the
grader must exercise the same public exact single-window API described here.

### Explicit non-changes in this design lane

- No edit to `QUERY_MAX_LIMIT`, `QUERY_DEFAULT_LIMIT`, result-contract limits,
  harness `.take` behavior, engine carriers, or target capability tables.
- No edit or regeneration of declaration v8 or its generated artifacts.
- No v9 declaration/token/backend implementation, stored-count migration,
  benchmark-brief change, or Coterie capability claim.
- No cursor, cross-page state machine, one-shot tail, retained stale archive,
  or “eventually converges” substitute for exactness.
- No change to the separate 1,000-chat envelope or M7's user-visible
  message-count migration.

## Acceptance criteria

- `demos/coterie` contains no React-authored application UI and no React Native
  or Expo dependency. Exact's current shared web scaffold may retain React and
  React DOM as internal toolchain dependencies until Exact removes that need.
- A backendless run renders and navigates the stage-1 routes enumerated in
  `demos/coterie/README.md` on web and compiles the same Contract route graph
  into Exact's native startup artifact; this is not a claim that every brief
  screen or interaction has landed.
- Reusable presentation components use plain values/callbacks and preserve the
  frozen `sm-*` IDs relevant to their states.
- The Coterie provider declaration deterministically generates its binding
  surface, and generation drift is checked in CI/test scripts.
- The backendless provider passes Exact provider conformance for every
  capability it declares.
- A diary records Contract/Exact ergonomics separately from future Snapback
  adapter observations.
- The affected LLP and guide reference checks pass before landing.

## Open questions

1. ~~Complete M1-M8 domain in the first shell, or milestone growth?~~
   Resolved 2026-08-16 by D7: milestone-frozen surfaces, M1-M3 first.
2. ~~One parameterized runner or a Coterie-specific driver?~~ Direction set
   2026-08-16 by D10: one parameterized runner importing the shared ID
   authority; revisit only if a real-host automation need contradicts it.
3. Which backend follows Snapback as the second provider conformance lane?
   Choose for a meaningfully different delivery model, not brand coverage.

## Revision history

- 2026-08-15: initial Draft; establishes identity, placement, presentation
  portability, provider seam, backendless semantics, and separate evidence.
- 2026-08-16: renumbered this plan to LLP 0266 after the prior number
  collided on main; narrowed D5 to the interactions the stage-1 shell actually
  exposes.
- 2026-08-16 (slice 1): added D7-D10 — milestone-frozen provider surfaces
  targeting M1-M3 (resolves OQ1), `COTERIE_PROVIDER` boot-time selection,
  Snapback backend placement under `demos/coterie/snapback/`, and the
  single parameterized acceptance harness (direction for OQ2).
- 2026-08-16 (slice 1 review): made D8's digest handshake explicit: adapters
  implement one provider-neutral Coterie declaration rather than generating
  provider-specific declarations; clarified D7's mutation-token carrier.
- 2026-08-16 (quoted replies/reactions/avatar slice): added D11; operation
  claims, rather than provider identity, make unqualified affordances absent.
- 2026-08-16 (v7 dual-review fixes): made D11 explicitly cover every mutation
  affordance while preserving typed query states, and recorded the brief's M4
  reaction versus M5 search/chat-settings taxonomy in D7.
- 2026-08-24 (author ruling): replaced the cursor-pagination recommendation
  with a scoped result-profile design. It preserves one-version atomic
  single-window replacement, makes the 10,000-row cost a measured claim gate,
  adds stored-count pre-write refusal at 10,001, and keeps v8's 1,024/1,025
  behavior as a checked fixture. Implementation remains the next lane.
