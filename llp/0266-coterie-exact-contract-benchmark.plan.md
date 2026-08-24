# LLP 0266: Coterie Exact/Contract social-messenger benchmark

**Type:** Plan
**Status:** Draft
**Systems:** Benchmarks, Demos, Exact, Contract, Native clients, Provider adapters, Social messenger
**Author:** Codex / Charlie Cheever
**Date:** 2026-08-15
**Revised:** 2026-08-24 (dated M6 message-envelope recommendation: choose a
versioned `listMessages` cursor over a platform-wide live-window increase,
with a 200-row live page, strict sequence keyset translation, downstream-page
re-anchoring, v8 byte preservation, and claim-gated 10,000-message
qualification; author confirmation is still required before implementation)
**Revised:** 2026-08-16
**Related:** LLP 0000, LLP 0005, LLP 0008, LLP 0064, LLP 0137, LLP 0189,
LLP 0200, LLP 0201, LLP 0278, `benchmarks/briefs/social-messenger.md`,
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

## Dated recommendation for author ruling — M6 message-envelope growth (2026-08-24)

**Recommendation: choose path 2, a versioned cursor-paginated Coterie
surface.** This is a design recommendation, not an accepted declaration or
capability change. Implementation remains gated on author/owner confirmation.
Declaration v8 stays byte-for-byte frozen; no M6 or message-envelope claim
changes merely because this section exists.

### Why path 2 is the qualified direction

The current tree makes a platform-ceiling increase materially broader than a
Coterie change:

- `crates/snapback-types/src/manifest/types.rs` (the current home of the
  former `crates/snapback/src/manifest.rs` surface) sets both
  `QUERY_MAX_LIMIT` and `QUERY_DEFAULT_LIMIT` to 1,024. Raising the maximum
  therefore also changes the implicit default accepted by every application
  query, not only an explicitly enlarged Coterie query.
- The same file independently caps ordinary result arrays and `records`
  bounds at 1,024; `packages/snapback-harness/ctx-bootstrap.js` separately
  defaults query plans to 1,024 and rejects `.take(n)` above it. Path 1 is a
  coordinated platform/runtime/codegen/harness contract change, not one
  constant edit.
- `listMessages` is an authored `defineJsLiveQuery` with an ordered, limited
  `records` result. Such Ibex/ordered/limited results use the honest re-query
  plus `live_replace` lane, not row-delta delivery (LLP 0008, DK-3). A larger
  ceiling authorizes every affected subscription to re-evaluate, validate,
  hydrate, and deliver a correspondingly larger replacement. The blast radius
  is platform-wide even though the motivating history belongs to one demo.

Path 2 leaves every platform ceiling unchanged and bounds each Coterie
evaluation below the existing cap. It also follows code that already works:
`listFeed@3` carries a nullable opaque declaration cursor, validates and
translates it in each provider, applies a strict backend keyset predicate, and
opens a normal live query for each requested cursor. Its memory-provider tests
prove that an older cursor page remains live for mutations affecting rows on
that page. Coterie messages have a stronger key than feed timestamps:
`messages.sequence` is immutable and unique within a conversation, and the
current backend already orders the composite `pageKey` by that sequence.

This recommendation does not ignore pagination's consistency risk. A live
head's boundary moves when a new message enters, so retaining downstream pages
under their old cursors would create a gap; that is a different form of the
stale archive rejected in Diary 0086. The live-chain rule below invalidates
those pages immediately and re-arms them from the new predecessor cursor.
Every displayed older page therefore has a current live subscription; no
snapshot tail is retained or described as live. Independent page
subscriptions still do not claim one atomic cross-page version (LLP 0278
D0.5). Exactness means each page is authoritative for its arguments and the
published chain contains only one fully linked cursor generation.

Path 1 should be reconsidered only if the M6 qualification below proves that
the bounded live-page design cannot meet correctness or the benchmark's
degradation rules within the existing subscription envelope. Correctness
complexity alone is not evidence for a platform-wide ceiling increase; the
cursor-chain cases are finite and acceptance-testable.

### Proposed v9 declaration and compatibility boundary

Implementation creates a new sibling declaration (proposed path
`demos/coterie/src/data/coterie.v9.provider.json`) and versioned generated
artifacts. It does not edit or regenerate
`demos/coterie/src/data/coterie.provider.json`, whose v8 source SHA-256 is
`27895ba105b5aab7f632691d5e865683ae433ac1d5ecd7e589450079ff1fdf6e`
and whose generated binding digest is `e0be7bf6f9f5bc27`. The active app/provider
switch to v9 happens only after qualification; v8 remains a checked fixture
and compatibility target.

V9 keeps the descriptor name and id `listMessages` but changes its contract:

- add nullable parameter `cursor: string`;
- add nullable row field `nextCursor: string` (the same value on every row in
  one page, matching the currently available `listFeed@3` list shape until a
  future Exact typed page envelope is adopted);
- add declared `MessageCursorInvalidError` / `message_cursor_invalid`;
- bump the core query compatibility token and
  `coterie.m3CompatibilityTokens.listMessages` from `4` to `5`;
- bump `coterie.m3CompatibilityTokens.sendMessage` from `4` to `5`, because
  v9 removes the 1,025th-write refusal. Removing that mutation admission
  boundary without a token bump would silently change the frozen M3 behavior.

V9 does not promise unbounded scale. It qualifies the benchmark's named
10,000-message busy conversation. `sendMessage@5` stops using the 1,024-row
query cap as a product-write ceiling, but the public Coterie claim remains
10,000 until a later scoped qualification deliberately raises it. M7's later
message-count migration remains separately owned; this design does not smuggle
that backfilled field into M6 merely to enforce a new count ceiling.

### Cursor, keyset, and page semantics

The v9 page size is **200 messages**. This leaves wide room under the 1,024-row
platform limit and makes the brief's required 10,000-message page-50 probe an
actual terminal-page probe rather than an unreachable metric.

The public cursor is an opaque base64url string over canonical JSON with this
private v1 payload:

```json
{"v":1,"query":"listMessages","chatId":"<external chat id>","beforeSequence":1234}
```

Opaque means consumers store and return the string; it does not promise
confidentiality. Decoding is strict and cause-free: at most 512 wire bytes,
canonical unpadded base64url, exactly the four fields above, `v === 1`, the
fixed query name, exact `chatId` equality with the call, and a non-negative
safe-integer `beforeSequence`. Malformed, cross-chat, or wrong-version input
returns `MessageCursorInvalidError`. Cursor position never grants authority;
every page independently re-runs the normal session, conversation, membership,
and removal-cutoff checks.

Provider-to-backend translation is explicit:

1. The provider decodes the declaration cursor and passes only the validated
   `beforeSequence` to its backend. The backend never parses declaration bytes.
2. Snapback adds/uses an index ordered by `(conversationId, sequence)` and
   filters `conversationId == args.conversationId`, then
   `sequence < effectiveBefore`, ordered by `sequence desc`.
   `effectiveBefore` is the lesser of the cursor boundary and a removed
   member's `removedSequence`; either missing value is treated as infinity.
   This preserves the existing rule that a former member may see history only
   before removal on every page.
3. The live handler reads `.take(201)`, returns at most the first 200 hydrated
   rows, and uses row 201 only as an exact overflow witness. If that witness
   exists, the provider encodes the oldest returned row's immutable sequence
   as the next cursor; otherwise every row carries `nextCursor: null`.
4. The adapter continues exposing rows oldest-to-newest inside a page for the
   chat UI. Cursor traversal is newest-page to older-page; consumers prepend
   older pages and deduplicate by message id.

Each call is one page and each subscription owns exactly one live backend
query. The adapter must not walk further cursors inside that subscription, and
must not retain disposed page rows as an allegedly live archive. Receipt,
reaction, edit/tombstone, quote projection, profile projection, membership,
and authorization changes that affect a subscribed old page re-evaluate and
replace that page through the same live path as the head.

For a combined scrolling view, page `i + 1` is valid only under the current
`nextCursor` emitted by page `i`. If a predecessor cursor changes, the
composition immediately removes all downstream pages from the published
chain, disposes their subscriptions, and opens a new live chain from the new
cursor. It publishes downstream rows again only after the chain is fully
linked; latest boundary changes supersede in-flight older generations. A
temporarily shorter valid prefix is honest. Publishing a mixed generation,
retaining stale rows during re-anchoring, or filling the gap with a one-shot
read is not.

The 10,000-message history is 50 pages. Sequential API traversal needs one
live subscription at a time. A UI may retain only pages it actively displays;
if it chooses to retain all 50, each remains live and the total is within the
platform's 64-per-connection hard ceiling, though above LLP 0278's provisional
16-per-view warning and therefore requires an explicit budget diagnostic in
the evidence. No design may conceal that subscription cost.

### M6 implementation qualification and acceptance

Before implementation may raise any Coterie claim beyond 1,024, the exact
v9 implementation must prove all of the following against both the memory and
Snapback providers where applicable:

1. **Frozen/versioned surface:** v8's source SHA-256 and generated digest stay
   unchanged; v9 generation is deterministic; the fail-closed provider digest
   handshake passes only with matching v9 artifacts; claims report
   `listMessages@5` and `sendMessage@5` and reject the v8/v9 cross-pair.
2. **Boundary and cursor refusal:** 1,024 and 1,025 messages are both writable
   on v9; malformed, oversized, non-canonical, wrong-version, and cross-chat
   cursors fail as `MessageCursorInvalidError` before a backend subscription
   opens; logout/revocation and non-membership still fail closed on every page.
3. **History reachability:** replay the frozen scale corpus, recover all
   10,000 busy-chat messages through 50 200-row pages with strict sequence
   order, no duplicate or missing id, the exact terminal null cursor, and the
   invariant manifest's exact message count. The custom-client API and grader
   path use this same pagination, not a privileged export.
4. **Deep-page cost:** using the brief's k=20-after-3-warm-ups, sequential,
   30-second probe, page 50 p95 is at most 3x page 1 p95; no page times out,
   errors, or grows memory without bound. Record subscription count,
   re-evaluation count, replacement bytes, and peak memory so the result is
   attributable rather than merely green.
5. **Live head and old page:** with polling and manual refetch disabled, hold
   the head and a page containing a message older than row 1,024. A second
   client sends a message and the head updates; then advances receipts and
   performs each M6-prerequisite old-message mutation that changes projection
   (reaction and edit/tombstone where implemented). The already-armed old-page
   subscription must deliver the exact updated projection.
6. **Membership and authority:** remove a member while head and old pages are
   armed; every page converges to the historical removal cutoff with no
   post-removal row or quoted-data leak. Logout/revocation blanks or errors all
   pages through the ordinary authority path. Rejoin behavior must match the
   existing incarnation ruling, not a cursor-specific shortcut.
7. **Moving-boundary composition:** force sends while at least three adjacent
   pages are displayed. The test must observe downstream invalidation and live
   re-subscription, prove that no mixed cursor generation is published, and
   finish with a contiguous, duplicate-free chain. Disposing any page removes
   its rows; no snapshot tail survives disposal.
8. **Settlement and convergence at envelope:** the 50-member busy-group send
   and receipt probe does not visibly stall, no subscription exceeds 200
   returned rows or reads more than the 201-row boundary probe before
   hydration, and concurrent-page use stays within the declared 16-warning /
   64-hard subscription posture. Any red here blocks the v9 scale claim and
   reopens path 1 for author review.
9. **Claim gate:** bind the v9 declaration, both provider implementations,
   generated artifacts, cursor/live acceptance, scale replay, and degradation
   evidence into a scoped LLP 0189 qualification digest. Until that digest is
   green and accepted, Coterie continues to advertise only the v8 1,024-message
   envelope.

### Explicit non-changes in this recommendation lane

- No `QUERY_MAX_LIMIT`, `QUERY_DEFAULT_LIMIT`, harness `.take`, result-contract,
  engine, or delivery ceiling changes.
- No edits, regeneration, or compatibility reinterpretation of declaration
  v8 or its generated artifacts.
- No silent Coterie message-envelope or M6 capability claim.
- No one-shot non-live history tail, retained stale archive, or adapter-owned
  background page walk presented as live data.
- No change to the separate 1,000-chat envelope, M7 message-count migration,
  or a platform-wide pagination declaration in LLP 0278.

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
