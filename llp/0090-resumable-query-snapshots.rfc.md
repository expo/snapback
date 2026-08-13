# LLP 0090: Resumable query snapshots

**Type:** RFC
**Status:** Accepted
**Systems:** Sync, Realtime, API, Client integration, Deployment, Auth
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-24
**Revised:** 2026-08-12 (D3 Node file carrier hardening: owner-only creation
modes plus best-effort permission tightening on open; Q4 application-level
encryption remains open). 2026-08-04 (mixed-route v2 successor amendment promoted to
normative by Charlie Cheever's explicit author direction; capability maturity
and publication claims remain gated as specified); 2026-08-03
(`single_table_v1@1` owner amendment: Channel B's
`rqsEligible` authority travels as
`rqs-authority-independent-snapshot-v1`; prove-or-fresh adoption leaves
token/digest/admission bytes unchanged and keeps QMK resume separate through
LLP 0166 OQ2; semantic only.) 2026-08-03 (mixed-route v2 successor amendment — one pinned snapshot,
binding-derived per-child registration, and an honestly read-only weakest
aggregate; see Revision history and D1.2); 2026-08-03 (Accepted LLP
0166 boundary: LLP 0166 is the
Channel-B store's declared domain/lifecycle successor; this RFC's
machinery and the legacy population's lifecycle and budget envelope are
grandfathered byte-exact; the qmk1 proof-backed resume credential stays
a future dated amendment here.); 2026-08-02 (non-normative mixed-route
register-gradient amendment proposal — now resolved by the 2026-08-03
amendment); 2026-08-01 (D3 default-store lifecycle and outbox rendering
notes — see Revision history);
2026-07-31 (LLP 0129 Phase 0 amendment — see Revision
history); 2026-07-25 (step-5 native implementation amendment — see
Revision history); 2026-07-24 (v0.6 — see Revision history)
**Related:** LLP 0008, LLP 0011, LLP 0022, LLP 0031, LLP 0034, LLP 0039, LLP 0043, LLP 0051, LLP 0053, LLP 0060, LLP 0063, LLP 0074, LLP 0076, LLP 0077, LLP 0082, LLP 0083, LLP 0086

## Revision history

- **v0.1** (2026-07-24) — round-1 multi-family review revision (Fable NOT READY, Codex NOT READY): v1 resume scoped to authority-independent queries so LLP 0053's mandatory fresh-snapshot-on-resume rule is respected rather than contradicted; Channel A scoped anonymous-only under the LLP 0060/0077 credential model, authenticated web boot re-shaped as shell + Channel C bundle; resume cursor specified as a structured token with incarnation/generation binding; replay admission specified as a graduated ladder honest about DK-3 coverage and the prior-membership problem; bundle consistency, limits, and atomic-failure semantics pinned; HTML-injection-safe serializer required; Cloudflare read-path, dynamic-evaluation, React boot-seam, and health/ensure piggyback characterizations corrected; scalability claims made conditional with measurement gates; rollout gains a prerequisite step and adversarial acceptance; LLP 0043 outbox rule added; Related extended with 0022, 0034, 0043, 0051, 0053, 0083
- **v0.2** (2026-07-24) — round-2 revision (Fable READY, Codex NOT READY): resume token made server-authenticated and content-binding with client-side integrity checks; atomic answer-and-register rule extended to all three ladder rungs and `CurrentAsOf` pinned as a version-advancing `LiveEnvelope` variant; authenticated Channel C defined as atomic snapshot-plus-register so no duplicate fresh snapshot follows; the serializer escape sentence — which an HTML-entity transport mangling had reduced to a no-op, exactly the bug class it guards — restated with explicit \u003c-form escapes; coexistence with the existing `POST /live/{name}/resume` reattach route specified; `generation` defined as a deployment-identity digest tuple with enumerated rotation events; rung 1 restricted to certified dependency summaries with a global no-commit proof for all classes; authority-independence bound to LLP 0053's declared `authorityIndependent` manifest fact with the Channel A amplification acknowledged; multi-tab persistence ownership via the Web-Lock store discipline; resume resource limits added to step 0; rollout re-staged; 0008 reconciling amendment added to step 0; `AuthorizationInvalidation` frame naming corrected
- **v0.3** (2026-07-24) — round-3 revision (Fable NOT READY, Codex NOT READY, converging on the token-lifecycle gap v0.2 introduced): token refresh specified — every result-changing durable envelope carries a fresh per-query token, with an incrementally maintainable multiset content digest making refresh O(changed rows); `CurrentAsOf` carries the fresh token it advances to; public-inline eligibility split from `authorityIndependent` into a distinct fail-closed `publicInline` declaration granting anonymous invocation authority under LLP 0031 classification; register mode given a connection-ownership contract (atomic grant mint, idempotency key, attach grace window, GC); token stream identity renamed to the existing LLP 0043/0053 `versionStream` with a crosswalk to the LLP 0039 authorization incarnation; rung-1 table-set proof now requires the journal floor and a named per-generation static dependency-summary artifact; rung-2 membership input renamed to an exact recoverable membership witness that can never suppress a removal; `contentDigest` threat model narrowed to corruption detection + server ratification prevention (not client-side authenticity against coherent tampering); serializer rule extended to all JSON string tokens including object keys, duplication fixed; reattach-route facts corrected (schemas already drift-gated; route local-arm-only today, Cloudflare forwarding added to coexistence work); generation rotation stated as one digest rule; per-query-token wording unified; persistence cadence tied to token refresh; Channel A v1 pinned `Cache-Control: no-store` with anonymous-minted authority-neutral tokens; retained/pending freshness status surfaced until first authoritative answer; provisional bundle endpoint shape added; metrics split into first-rows-visible / proved-current / live-attached
- **v0.4** (2026-07-24) — round-4 revision (Fable READY, Codex NOT READY): digest semantics split by query shape — the commutative multiset digest is reserved for DK-3 unordered results and ordered/limited/replace-only results take a sequence-sensitive digest over the full replacement, with the construction pinned to an adversarially collision-resistant incremental class; the rung-2 witness upgraded from identity-only to exact (rowId, oldRowHash) pairs jointly verifiable against the MAC-bound digest root, with client post-replay digest verification before authority; register mode now explicitly requires a dated LLP 0031 amendment (bounded pending-registration owner distinct from a socket session, atomic handoff on attach, preserving the socketless-HTTP-cannot-arm-demand invariant outside this closed operation) merged with the publicInline response-sensitivity class amendment Channel A needs; auth-scoped entries carry no resumable token in either bundle mode and v1 does not persist auth-scoped snapshots at all (deferred to the v2 door, shrinking Q4's surface); token minting suppressed for auth-scoped subscriptions and shared across fan-out per (queryArtifact, argsHash, version, contentDigest); authority-alias rule added so anonymously minted preloads are consumable under authenticated store identity; Channel A failure posture pinned to degrade-to-unhydrated-shell with a bounded anonymous evaluation budget; local-arm generation minting defined; waterfall evidence split between cursors-web (handshake) and graffiti (durable leg); token-never-widens-invocation-authority and MAC-key-id-vs-generation diagnostics pinned; CurrentAsOf capability implied by resume-capable subscribe; step 0 clustered into named contract artifacts; Related extended with 0039, 0060, 0077
- **v0.5** (2026-07-24) — round-5 revision (Fable NOT READY, Codex NOT READY): resume/persist/rung-1/rung-2 eligibility bound to LLP 0053's closed-inputs proof — Channel B persistence places a query in 0053's retainable class, and non-closed queries (RuntimeNow/opaque time or randomness reads) refuse to rung 3, with a time-dependent-query relaunch fixture; auth-scoped persistence wording corrected to "no RQS resume state" so the implemented LLP 0043/0053 lease-backed retention continues unchanged, with a preservation test; publicInline redefined under the existing codegen invariant (authorityIndependent is only accepted on public queries) as a disclosure/HTML-embedding permission on an already-public query rather than an invocation grant, the impossible authenticated-only fixture replaced and the re-check grounded in codegen-derived served-manifest facts; witness digest leaves changed to H(canonicalRowId || rowHash) so the root binds the identity-to-hash mapping, with duplicate-ID rejection and a hash-permutation fixture; rung-2 admission complexity restated as O(held + changed rows) with witness bytes/CPU added to the gates; the local-arm Channel A seam defined as the managed dev loop's Vite transformIndexHtml integration (LLP 0030) with Cloudflare-first recorded as the fallback; the register idempotency key minted per boot attempt with sender-key identity and credential incarnation in scope, nonce/grant-secret retry semantics, and a two-concurrent-boots fixture; v1 socketless Channel C limited to public bundles pending an extension credential/custody contract; Channel B given a bounded persisted-store budget with eviction; MAC key custody per arm and key-loss-is-availability-only pinned; token expiry pinned as a staleness backstop plus key hygiene; offline retained display tied to 0043's never-presented-as-current rule; 0F extended with a dated LLP 0034 amendment; the old-decoder tolerance case added to the 0B transition table; ordered-query digests pinned as carried from mint (global proof only); revision history moved to this section
- **v0.6** (2026-07-24) — round-6 revision, closing the loop under the convergence stopping rule (targeted delta reviews: Fable CLEAN, Codex NOT CLEAN with delta-confined findings; both report **no Major/Moderate in pre-existing text**; plus an implementer-lens review of the 0A contract, UNDERDETERMINED): the rung-2 accumulator-update rule corrected to touch only journal-affected row ids so untouched witness leaves remain (the v0.5 wording would have dropped unchanged rows), with a strict-subset fixture; eligibility unified under one named served-manifest predicate `rqsEligible` (authorityIndependent + closed-inputs) keyed by minting, bundle `resume` presence, Channel B persistence, and admission alike; `tokenBody` gains `digestKind` + `issuedAt` (the expiry anchor), the token pinned as a self-describing envelope with `meta` never an admission input and widened to carry every D3-arbitration identity field; expiry narrowed to a server-admission staleness backstop (offline display stays under 0043's never-current rule); canonical row encoding named (RFC 8785 JCS), leaves domain-separated and length-framed, published digest pinned as a compressed root over server-held state, 0A constructions to be pinned by name and parameters with a proposed LtHash-16-class default; keyring verification-overlap window and the `SNAPBACK_RESUME_*` refusal namespace pinned; register mode scoped to credentialed callers (anonymous → read mode) with the 0F amendment mapping sender-key identity/credential incarnation to LLP 0077's thumbprint and replay epoch; local-arm `generation` pinned content-derived (no-op ensure preserves it) and resume-relevant config enumerated; local seam named as `packages/snapback-vite` with graffiti's plugin adoption and public/`authorityIndependent`/`publicInline` declarations stated as step-3 work; ordered-query global-proof-only restated as a deliberate v1 simplification; least-recently-resumed defined as last successful authoritative resume with atomic bookkeeping; the false-`publicInline` stakes reworded to distribution/caching; D3/Q4 wording qualified to the RQS store so the 0043/0053 lease store is unambiguously untouched; `publicInline` added to the re-check fact list and Q1 clarified (authoring surface open, fact always codegen-compiled); LLP 0034 amendment citation corrected to §2.4

- **Accepted** (2026-07-24) — accepted by Charlie Cheever after the six-round super-refine loop (see `llp/reviews/0090-*`), with Q1/Q2/Q4/Q6 recorded open and owned by rollout clusters 0C/0E and the D5 follow-on, and with the v0.6 delta-confined edits' unreviewed status disclosed at acceptance.
- **Implementation amendment** (2026-07-24, ENG-25455/commit 04b8828e) — three step-4 findings reconciled without design change: (1) D2/0C are silent on where the deploy-time-compiled Cloudflare arm's eligibility facts come from — that arm has no codegen/ensure lane and its pre-existing handlers are opaque JS, so eligibility there derives from compiled HostPlan facts evaluated natively (single-table, closed-inputs subset), per the dated LLP 0092 amendment; a literal reading of this RFC would have made the step-4 eligible set empty. (2) D1.2's "the single coordinator DO serializes reads naturally" is precise only under the invocation mutex — handler queries await across the isolate seam, so DO single-threading alone is not the serialization cut; step 4 held the invariant by evaluating eligible entries natively without awaits. (3) D2's response-mechanics phrasing assumes the serving seam controls compression; on Workers the runtime owns content-encoding, satisfied by handing identity bytes to the runtime. Registered here so the RFC's next revision absorbs them; normative details live in the LLP 0091/0092 dated amendments.
- **Implementation amendment** (2026-07-25, ENG-25456, step-5 native half) — Channel B's native arm landed as the DK-9 file-backed store (`packages/snapback-client/rqs-store-file.mjs`), with three findings registered without design change. (1) **What DK-9's surface actually is:** LLP 0008 DK-9's implemented code surface is the LLP 0043 contract-layer store's `{read, write, withExclusive}` adapter seam (`packages/snapback-contract/client-store.mjs`, memory + localStorage) — there was no pre-existing native/SQLite implementation, and the RQS store is a separate bounded artifact with its own entry contract consumed store-agnostically by the client. "Rides DK-9" therefore lands as riding DK-9's *discipline* (store-agnostic interface, single-connection mutex serialization, atomic transactions, corrupt-bytes-preserved fail-closed posture, in-memory-degradation honesty) on the RQS entry contract, not as literally stacking on the 0043 lease store — which D3 already requires to remain a separate, untouched artifact. D3's "SQLite or files" is exercised on the files side; a SQLite backing swaps in behind the same injected files/adapter seam without observable change. (2) **Single-writer without Web Locks:** the D3 web multi-tab ownership role is replaced by an exclusively created on-disk lock file plus same-process registry with liveness-based (never lease-based) staleness; normative detail in LLP 0091's step-5 native amendment, which also pins the OQ2 cadence/budget values (web numbers unchanged; host-lifecycle flush; constrained processes never persist). (3) **Q4 baseline noted:** the v1 at-rest posture for the native store is OS-level protection (app-container isolation plus platform disk encryption); the store adds no encryption of its own and Q4 stays open. The step-5 acceptance list runs identically on both arms from one store-parameterized suite (`rqs-resume-suite.mjs`, 18 tests per arm) plus 11 native store-unit obligations; the on-device (React Native/Hermes files-adapter injection and device-harness proof) remainder is tracked in `issues/20260725-rqs-native-ondevice-adapter.md`.
- **Implementation amendment** (2026-07-31, LLP 0129 Phase 0, wave-1 lane C5) — three deltas registered without design change. (1) **Default-on Channel B:** the opt-in `rqsStore` seam becomes the client default (`resolveDefaultRqsStore`: IndexedDB on web, the step-5 file store on node, in-memory fallback; `client.rqsStoreInfo` reports the DK-9 degradation fact; `rqsStore: null` / `SNAPBACK_CLIENT_RQS_STORE=off` opt out). (2) **The outbox rule gains a real subject and wider enforcement:** the RQS store arms now carry the LLP 0043 M2 queued-intent outbox (`outbox-shared.mjs`; store format v2 with fail-closed v1 migration and IndexedDB database version 2), `outboxEmpty()` answers from the store's own pending queue, and the D3 rule — a non-empty outbox never resumes — is enforced on **every** fresh subscribe, not only relaunch seeding: an in-session reconnect holding a token but pending intent drops the token, takes the full snapshot, and only then replays (delta-resume-with-pending stays the deferred milestone). (3) **Cold-boot offline survival:** a relaunch that seeded a verified persisted entry and then loses the fresh subscribe to a *connectivity* refusal keeps the handle alive rendering retained rows (connection `'stale'`, bounded-backoff re-entry) instead of failing the boot — retained display stays under 0043's never-presented-as-current rule; every non-connectivity refusal still fails loudly. Proof: `demos/public-dashboard/tests/acceptance/offline-local-first.mjs`.
- **Implementation amendment (D3 outbox rendering note)** (2026-08-01, sweep finding 0137-a1-f6) — the D3 outbox rule is clarified as a protocol rule, not a display rule: a relaunch with pending queued intent now renders the verified persisted rows marked `retained` (pre-intent, no fabricated overlay, `handle.pendingIntentsAtSeed` naming the queued count) while the resume token is withheld entirely, so `resumeFromToken` is still never sent with a non-empty outbox and reconnect still takes the 0043 full-resync-then-ordered-replay path. The prior implementation's blank-on-pending-outbox posture is retired as an over-application that made offline capture and retained render mutually exclusive. Normative text in the D3 dated note; proof in `rqs-resume-suite.mjs` (both arms) and the offline acceptance. In the same landing, the LLP 0114 React arm gained its projection of the existing client facts (per-query `freshness`/`retention` on the hook result, `useSnapbackOutbox`/`observeSnapbackOutbox` over `client.outboxStatus()`/`subscribeOutbox`) — surfacing only, no new claims (sweep finding 0137-a1-f5).
- **Implementation amendment (D3 default-store lifecycle)** (2026-08-01) — a `SnapbackClient` owns a store selected by the default ladder and `closeAuth()` releases that store's single-writer role after unregistering auth participants; a store explicitly passed through `rqsStore` remains caller-owned. Sequential short-lived clients can therefore hand the per-origin writer role over deliberately instead of silently leaving every successor as a non-persisting reader. The one-client-per-app recommendation remains the ordinary shape. Proof: `packages/snapback-client/outbox-store.test.mjs` constructs, closes, and replaces default clients in one process and pins injected-store non-ownership.
- **Amendment proposal (2026-08-02, non-normative — mixed-route register
  gradient)** — reproduction on current main found that the LLP 0112/codegen
  all-`LiveQuery` rule is the cliff: `[LiveQuery, LiveQuery]` and
  `[LiveQuery, defineJsLiveQuery]` routes receive one generated register
  group, while `[LiveQuery, Query]` remains a valid read-bundle route but
  receives no generated group. This does not degrade the sibling's matcher
  or `live_delta` class; it removes the route-level registered-boot artifact.
  A local codegen relaxation is insufficient because D1.2's `mode` applies
  to the whole bundle request and LLP 0112 format 1 admits only registered
  live children. A successor amendment should specify a versioned mixed
  profile that (1) evaluates all children at one pinned snapshot, (2) creates
  pending registrations only for children carrying the existing live
  capability, (3) returns ordinary children as read-only rows without a
  liveness claim, (4) projects per-child boot/delivery provenance plus the
  group's weakest aggregate state, and (5) pins partial failure, authority,
  idempotency, attach cleanup, and width/resource bounds. It must use a new
  artifact/wire version rather than reinterpret LLP 0112 format 1, and must
  cross-check LLP 0157 plan/materialization identity without making plan
  shape imply liveness. Until author review accepts such a profile, D1.2 and
  LLP 0112's all-live contract remain unchanged.
- **Accepted implementation amendment (2026-08-03 — mixed-route v2;
  author-promoted 2026-08-04).** The proposal's successor is specified as
  generated artifact/wire format 2 and LLP 0157 profile `mixed-route.v2`.
  Every child is evaluated in one pinned read transaction; only children
  whose admitted `NodeCapabilityBindingV1.live.kind` is `admitted` become
  pending registrations, while `live.kind:"none"` children return explicit
  read-only snapshots. The response carries per-child delivery provenance and
  the group's weakest `read-only` aggregate. LLP 0112 format 1 is byte-
  compatible and unchanged. The exact contract, failure/authority/cleanup
  rules, bounds, nonclaim boundary, and executable evidence are recorded in
  D1.2. This entry became document law through Charlie Cheever's explicit
  2026-08-04 author promotion; implementation witnesses do not independently
  alter capability maturity or publication claims.

## Summary

Snapback's live-query wire protocol already models every query result as a
snapshot with a durable cursor: `LiveEnvelope::LiveReplace { version, rows }`,
version-stamped `LiveDelta` ops, and `ResyncRequired` as the level-triggered
escape hatch (`src/live_wire.rs`). Today that primitive has exactly one
delivery channel — a live WebSocket subscription — so every client boots
against an empty store and pays a multi-round-trip waterfall before first
useful paint.

This RFC proposes promoting **resumable query snapshots** to a first-class
capability: the ability to obtain a query snapshot plus a server-minted,
continuously refreshed resume token through channels *other than* an open
subscription, and to later open a subscription that resumes from that token —
receiving deltas, a cheap "unchanged" acknowledgment, or a fresh snapshot,
per the admission ladder in D1.3. One primitive, three delivery channels:

- **A. Inlined into the initial web response** (v1: `publicInline` routes
  only) — the served `index.html` carries the snapshots a route needs; the
  client renders immediately and subscribes from the embedded tokens ("data
  SSR", no server-side view rendering).
- **B. Persisted on device** — clients durably store the latest snapshot +
  token per subscription; on relaunch they render the first frame from disk
  (v1: for authority-independent queries only; see Authorization scope) and
  resume.
- **C. Fetched as a bundle** — one request returns all snapshots a manifest
  entry needs, each with its token, minted at one shared commit — for
  authenticated web boot (in register mode, D4), deep-link cold starts, and
  socket-less surfaces (widgets, watch complications, notification/share
  extensions, App Clips).

Full server-side HTML rendering is deliberately scoped as a *consumer* of this
primitive (a later, optional layer for public/SEO pages), not the feature
itself.

### Authorization scope (v1)

LLP 0053 (Accepted; echoed in LLP 0008 §Authorization) mandates that every
auth-scoped resumption from a non-live state fresh-snapshots — explicitly
including page reloads, process restarts, and any resume-from-retained path —
and LLP 0043/0053 define the signed-lease machinery that governs when retained
auth-scoped rows may be *displayed* at all. This RFC does not renegotiate any
of that. In v1:

- `resumeFromToken` and render-before-resume apply only to
  **authority-independent** subscriptions. Authority-independence is not a
  property this RFC re-derives: it is exactly LLP 0053's declared, trusted
  `authorityIndependent: true` fact as carried in the served functions
  manifest, with 0053's fail-closed default — undeclared means auth-scoped,
  and a manifest entry (D1.4) naming an undeclared query is **refused at
  admission**.
- **Eligibility additionally requires input closure.** Authority-independence
  asserts invariance across *callers*, not purity: a query reading time or
  randomness (declarative `RuntimeNow`, or `Date.now()` in an opaque plan) is
  not a pure function of `(database state, args)`, and no journal-based proof
  or replay is sound for it. Channel B persistence places a query in LLP
  0053's **retainable** class, so v1 resume/persist/rung-1/rung-2 eligibility
  is conditioned on 0053's **closed-inputs proof** for retainable queries;
  queries without it refuse to rung 3 (fresh execution — exactly today's
  behavior) and are not persisted for render-before-resume. Acceptance
  includes a fixture proving a time-dependent query re-executes on relaunch
  rather than receiving `CurrentAsOf`. The conjunction gets one name used
  everywhere downstream: a query is **`rqsEligible`** iff it carries the
  declared `authorityIndependent` fact (which per the codegen invariant
  entails `public`) *and* the LLP 0053 closed-inputs/retainable proof — this
  served-manifest predicate is what token minting, bundle `resume` presence,
  Channel B persistence, and D1.1 admission all key on; non-eligible entries
  return rows with `resume: null` and are never persisted for
  render-before-resume.
- **Public inline delivery is a second, separate gate.** `authorityIndependent`
  asserts only that results are identical for every *authorized* caller — per
  LLP 0053 it is not inferred from anonymous invocation and does not make a
  function publicly invocable, and LLP 0031 classifies live-query rows as
  caller-scoped application data that no tokenless route may emit. The
  existing codegen invariant is kept: `authorityIndependent: true` is only
  accepted on a query whose auth requirement is already `public`
  (`packages/snapback-codegen`), so anonymous *invocation* already follows
  from the query's own auth requirement and `publicInline` grants no new
  invocation authority. **`publicInline` is a disclosure permission**: an
  explicit, fail-closed declaration that this already-public query's rows may
  be embedded in a tokenless HTML response (and served as read-mode public
  bundles), refused when absent. The server-side re-check is grounded in the
  codegen-derived served-manifest facts (auth requirement +
  `authorityIndependent` + closed-inputs + `publicInline` itself, which
  compiles into the functions manifest like the others), not in the
  route-manifest author's
  own declaration — checking one author-controlled declaration against
  another would not carry the raised disclosure stakes. No existing LLP 0031
  `ResponseSensitivity` class fits declared-public arbitrary query rows in a
  tokenless response, so the step-0 **LLP 0031 amendment** (shared with
  register mode's pending-registration owner, D1.2) introduces a
  declared-public-application-data sensitivity class — the same class
  governing the Channel A HTML lane and read-mode public bundles — with its
  logging rules and the anonymous-caller rate/budget posture for both lanes. Note the raised stakes: since `publicInline` applies only to
  already-public queries, a false declaration broadens *distribution and
  caching* — rows land in served (and, if Q6 ever lands, CDN-cached) HTML
  rather than behind an explicit anonymous invocation — which is why
  Channel A admission re-checks both
  facts server-side rather than trusting the manifest author. Acceptance
  includes the negative fixtures: a public query lacking `publicInline` is
  refused for Channel A regardless of authority independence, and an entry
  naming a non-public or undeclared query is refused at admission.
- Auth-scoped subscriptions keep today's behavior — fresh snapshot on every
  non-live resume — and auth-scoped *retained display* remains governed
  exclusively by the LLP 0043/0053 lease machinery. **v1 persists no
  auth-scoped *RQS resume state*** — no tokens, no resumable metadata (that
  extension is the v2 door, which keeps Q4's new at-rest surface to
  authority-independent data). The *implemented* LLP 0043/0053 lease-backed
  retention (`AuthorizedLease`, per-identity isolation, user-switch deletion)
  **continues unchanged** — this RFC neither removes nor widens it; those
  retained rows remain ineligible for render-before-reauthorization and for
  token resume, and rollout step 5 includes a test proving the existing
  retained-display path is preserved. Bundle entries for auth-scoped queries
  carry **no resumable token in either mode** (`resume: null`; read mode
  returns rows-without-token, register mode returns registration state).
  Token minting on the live path is likewise suppressed for auth-scoped
  subscriptions in v1.
- Extending resume semantics to auth-scoped subscriptions is a **v2 door**
  that requires amending LLP 0053 through its own review process, integrating
  the authorization descriptor / lease / quarantine / user-switch-wipe
  machinery, and an authorization-partition field in the resume token
  (reserved in D1.1 for that purpose). It is out of scope here.

## Motivation

### The waterfall today

Every web arm serves a bare static shell — an empty mount node plus a module
script (`demos/cursors-web/surfaces/react/index.html`,
`demos/graffiti/surfaces/contract/index.html`); nothing is inlined. Boot is
entirely client-side: `main.tsx` constructs the client, awaits
`client.health()`, awaits `ensureApp(...)`, mounts, and each
`useSnapbackQuery` starts from empty rows and subscribes
(`packages/snapback-react/index.mjs`;
`packages/snapback-client/external-store.mjs` accepts `initialRows` but
nothing feeds it at boot, and its `getServerSnapshot` just returns the current
client snapshot — there is no SSR/preload pipeline). The evidence splits by
demo: cursors-web proves the handshake waterfall (its React surface opens an
ephemeral room), while a durable-query demo like graffiti exhibits the final
subscribe → `LiveReplace` leg. First useful paint waits on HTML → bundle →
health → ensureApp → subscribe → first snapshot: three-plus network round
trips after the document arrives. The
Cloudflare arm serves the same static shell via `env.ASSETS.fetch`
(`cloudflare/src/gateway.js`); query execution happens in the coordinator
Durable Object, to which the gateway forwards requests.

Native/embedded arms have the same shape plus worse constraints: a cold start
into a deep link mounts the screen and lets each query do its own subscribe
round trip, and iOS surfaces that cannot hold a socket at all (WidgetKit
timelines, notification content extensions, App Intents, share extensions)
currently have no sanctioned way to get current query results.

### Why now

The protocol work is tractable because much of the hard part already exists.
The per-app commit-version counter is durable (`snapshotVersion` already
appears in receipts in `src/live_wire.rs`), deltas are version-stamped, the
`_snapback_changes` journal retains post-images with a pruning floor and a
`journal_resume_requires_resnapshot` check, and `ResyncRequired` plus the
`AuthorizationInvalidation` frame already define what happens when a snapshot
can no longer be trusted. LLP 0008's L3 status note explicitly names the
missing piece — a delta-resume consumer — as future work; this RFC is that
consumer, plus the channels that make it valuable. What does not exist yet:
any code path that produces a snapshot at page-serve/bundle-fetch time, any
subscribe path that accepts a resume token, token issuance/refresh, and the
replay machinery of D1.3.

Competitively (see Prior art), every neighboring system surveyed ships half of
this and none was found to ship the unified primitive. Being early to unify
it is a differentiated story that also closes the single biggest
perceived-quality gap versus sync-engine-native apps: instant first paint
without a refetch flash.

## Prior art

Verified against public docs and announcements 2026-07-24; external claims
were not independently reproduced and all "none/every" statements below are
bounded by that dated survey. The corpus's own earlier research on Electric
and PowerSync is in LLP 0022; the 2026-07 competitive passes are LLPs
0082–0085. The landscape splits into "has the SSR half" and "has the resume
half"; the groups barely overlap.

| System | SSR → hydrate into live sub | Persisted snapshot + delta resume |
|---|---|---|
| Convex | Yes — `preloadQuery`/`usePreloadedQuery` (Next.js), the most polished mainstream story | No. After hydration the client **re-executes the full query**; finer-grained deltas are stated as planned, not shipped. Docs warn two `preloadQuery` calls are not mutually consistent. |
| InstantDB | Experimental — `@instantdb/react/nextjs` `useSuspenseQuery` (shipped after LLP 0082's 2026-07-23 pass) | Query cache persists (IndexedDB; pluggable store on RN). Whether resume is delta-from-cursor or full refetch is **not documented** (unconfirmed). |
| Zero (Rocicorp) | No — 1.0 (June 2026) still recommends disabling SSR; roadmap "Beyond" | Yes — core strength. Server-side CVRs (client view records) diff exactly what each client holds; IndexedDB / expo-sqlite stores. |
| PowerSync | Explicitly none ("not much benefit to SSR") | Yes — local SQLite replica, checkpoint/bucket delta resume; 2026 added query-driven sync. |
| LiveStore | None found | Yes — persisted eventlog + materialized SQLite, resume via sequence cursor. |
| ElectricSQL / Electric | Experimental only (SSR store PR; Next.js example removed 2026-04) | Not in the base client; via PGlite / TanStack DB. Protocol is offset-resumable HTTP with CDN-cacheable shape logs. |

Directional signals: Electric's **Durable Streams** (announced 2025-12,
hosted 2026-01) markets offset-resumable catch-up-then-tail streams as a
headline primitive; **TanStack DB** 0.6 added persistence and has an open call
for SSR design partners. The convergence point the field is drifting toward is
exactly this RFC's primitive. Zero's CVR design is directly relevant prior
art for D1.3's membership problem. Adjacent-but-different: Phoenix LiveView
(server-rendered-then-live, but state lives on the server — nothing to
resume), Linear's internal bootstrap-plus-`lastSyncId` engine (the full
pattern, not a product), CloudKit `CKSyncEngine` change tokens (the cursor
idea, without queries).

Within this survey, no system was found that delivers server-computed
snapshots to socket-less native surfaces as a product feature, and none
surfaces an authorization-scoped invalidation frame on the wire; Snapback
already has the latter (`LiveEnvelope::AuthorizationInvalidation`).

## Design

### D1. The primitive

A **resumable snapshot** is a `LiveReplace`-shaped result plus a
server-minted **resume token** and client-visible metadata:

```
snapshot   = { function, args, rows, version }
tokenBody  = { app, generation, versionStream, version,
               queryArtifact, argsHash, digestKind, contentDigest,
               issuedAt, authPartition? }
resume     = { token, meta }
token      = opaque self-describing envelope: keyId + tokenBody + MAC
meta       = { version, contentDigest, generation, versionStream,
               queryArtifact, argsHash }        // clear, client-advisory
```

The token is **self-describing**: the server decodes `tokenBody` from the
token envelope itself and `meta` is *never* an admission input — it exists
so the client can run its own checks (digest verification, the D3
channel-arbitration comparison) without being able to open the opaque
token; `meta` therefore repeats every identity field D3's arbitration
compares. `issuedAt` is the expiry anchor.

The token is **opaque and server-authenticated** (MAC'd with a server key;
key rotation, expiry, and size limits are step-0 contract items). The client
never edits it; it stores the blob plus the clear `meta` copy. Fields:

- `app` — the app identity the snapshot was evaluated in.
- `generation` — a digest of the resume-relevant deployment artifacts:
  executable bundle/deployment identity + schema identity + function-artifact
  identity + resume-relevant configuration. **One rotation rule:** the digest
  changes exactly when any bound component changes (in practice, nearly every
  deploy). On the local arm — which has no deploy — the served instance
  recomputes the content-derived digest at every schema/functions ensure; a
  no-op ensure preserves it (the "changes exactly when a bound component
  changes" rule is authoritative, so dev-loop ensures do not needlessly
  refuse tokens). The resume-relevant configuration components are
  enumerated: journal prune-policy identity, auth mode, the route→query
  manifest hash, and the 0A digest-contract version. The same digest
  appears in tokens, embedded attestation facts (D2), and bundle responses,
  and is checked at admission.
- `versionStream` — the existing opaque data-stream identity from LLP
  0043/0053 (which already reject bare version numbers and pair versions with
  a stream identity); this RFC introduces no new identity. It rotates on
  reset, import, and declared restore. Crosswalk: it is **distinct from** the
  LLP 0039 authorization-stream incarnation inside
  `AuthorizationVersion { incarnation, epoch }`; the authorization identity
  becomes relevant only behind the `authPartition` v2 door. Commit versions
  are only meaningful within one `versionStream` — an offline client holding
  version 10 must not resume against a post-reset stream that happens to
  reach 10.
- `version` — the commit version of the snapshot state the token binds.
- `queryArtifact` + `argsHash` — canonical query identity: the generated
  function artifact plus canonicalized args within a generation (a function
  *name* alone is too weak across deployments). A token authorizes resume of
  exactly the query it was minted for; bundles mint **one token per query**,
  all at one shared commit version.
- `contentDigest` — a digest of the snapshot's canonical serialization,
  **with semantics split by query shape** (`digestKind` names which). The
  canonical row encoding shared across Rust/JS/native is **RFC 8785 JCS**
  (with mint-time refusal of values that cannot round-trip through JS
  clients), and leaves are domain-separated and length-framed:
  `H(tag || len(canonicalRowId) || canonicalRowId || rowHash)`.
  The published digest is a **fixed-size compression of the incremental
  state**: the full accumulator state is held server-side per live result
  (and recomputed client-side from persisted rows at verification time);
  tokens, `meta`, and envelopes carry only the compressed root.
  DK-3-analyzable unordered results use an **incrementally maintainable
  multiset digest** (commutative combination of leaves), so applying a
  delta updates the digest in O(changed rows); ordered/limited/replace-only results use a
  **sequence-sensitive digest** computed over the full replacement — coherent
  because those results only ever arrive as `LiveReplace`, and necessary
  because a multiset digest cannot distinguish `[A, B]` from `[B, A]`, so a
  permuted persisted ordered result would otherwise pass the check and be
  ratified by `CurrentAsOf`. The incremental construction is pinned to an
  **adversarially collision-resistant class** (LtHash-class with a stated
  security margin, not XOR/narrow-sum — step-0 item); permutation and
  cursor-window corruption fixtures are part of acceptance.
  **Threat model (narrowed):**
  the client-side check of persisted rows against `meta.contentDigest`
  detects *accidental or partial corruption* and the server-side MAC prevents
  *ratification* of tampered state at resume; neither is a client-side
  authenticity proof against a coherent local attacker who rewrites rows and
  metadata together (per LLP 0043's client/server verification-locus
  distinction, client-side authenticity would need a platform trust anchor —
  out of scope for v1). On digest mismatch the client discards persisted
  state and subscribes fresh.
- `authPartition` — reserved, empty in v1 (see Authorization scope).

**Token refresh (lifecycle).** A token is not a one-shot artifact: **every
durable envelope that changes a subscription's result state carries a fresh
token** minted at the new `(version, contentDigest)` — the initial
`LiveReplace`, every `LiveDelta`, replay completion, and `CurrentAsOf` (which
exists to advance the token without touching rows). Minting happens **only
for `rqsEligible` subscriptions** (a token for anything else could never
pass admission), and
because authority-independent token bodies contain no subscriber-specific
field, **one mint per `(queryArtifact, argsHash, version, contentDigest)` is
shared across the entire fan-out** — refresh overhead is per result-change,
not per subscriber. The ordinary live subscription path therefore issues and
refreshes tokens too — Channel B's "persist the latest snapshot + token" is
fed by normal subscription traffic, not only by bundles. `CurrentAsOf` needs
no capability negotiation: it is only ever sent to a subscriber that
presented `resumeFromToken` (or subscribed refresh-capable), so the ability
to decode it is implied by the request — stated here so the LLP 0051 schema
work carries it. Token **expiry** (anchored on `issuedAt`) serves two roles:
key hygiene, and a **staleness backstop on server admission** — an expired
token refuses to rung 3 even when every other admission fact matches.
Expiry does *not* bound offline display: a client that cannot reach the
server keeps showing persisted rows as retained/pending under LLP 0043's
never-presented-as-current rule (D3), and the backstop bites at connect
time. The client store commits `{rows, meta, token}`
atomically at its persistence cadence (same knob: the Web-Lock holder
persists on a bounded debounce and on pagehide; an interrupted or partially
applied delta sequence invalidates the persisted entry, falling back to
fresh subscribe). Refresh cost rides the existing envelope (one MAC + the
incremental digest); it is counted in the §Scalability gates. Rows delivered
from preload or persistence surface with a **retained/pending freshness
state** (LLP 0043's retained-data distinction) until the first authoritative
answer (`CurrentAsOf`, replay completion, or fresh `LiveReplace`) arrives.

`ResyncRequired` and `AuthorizationInvalidation` remain the only invalidation
semantics; resume adds a new way to *enter* the existing state machine
partway through, never a new failure mode. All wire additions land through
LLP 0051's schema-governed wire machinery (the `live_wire.rs` schema/drift
gates), and endpoint additions take a route-taxonomy entry per LLP 0031
(credential class, invocation authority, response sensitivity,
cache-control).

**Relationship to the existing reattach route.** The protocol already exposes
`POST /live/{name}/resume`, which reattaches to a *server-retained
subscription* by `subscription_id` — a liveness mechanism, not a cursor; its
request/response schemas are **already exported and drift-gated**, and the
route is **local-arm only today** (the Cloudflare gateway forwards only
`subscribe|unsubscribe` on its live POST path). The new capability is
disjoint: token-based resume establishes a *new* subscription seeded from
client-held state. v1 keeps both, renames nothing, and documents the split
("reattach" = subscription-id continuation; "resume" = token-based entry).
Step 0 *adds the new* token-resume schemas to the drift gates (the reattach
schemas are already there), specifies client dispatch (a client holding a
live retained subscription reattaches; otherwise it resumes or subscribes
fresh), and decides Cloudflare-arm forwarding for both routes with an
acceptance test. Any consolidation is future work under LLP 0051's
deprecation rules.

#### D1.1 Subscribe-from-token

The subscribe request gains an optional `resumeFromToken`. **Admission**: the
server verifies the MAC, then accepts the token only if `app`, `generation`,
and `versionStream` match the served instance, the named `queryArtifact` +
`argsHash` match the subscription being opened, and the query carries both the
declared `authorityIndependent` fact and the closed-inputs proof (v1;
Authorization scope); any mismatch, unknown field state,
or future/implausible version is answered with a fresh `LiveReplace` — the
always-correct fallback (the client's reconnect path already re-enters
through a fresh `subscribe_live` — `packages/snapback-client/index.mjs` — so
no client state machine distinguishes a served-fresh snapshot from a resync
round trip). Tokens for authority-independent queries are
**authority-neutral**: a token minted under anonymous authority (Channel A)
passes admission on an authenticated connection and vice versa, because
admission checks the declared fact about the query, not the minting
authority. A token **never widens invocation authority**: the subscribe it
accompanies is authorized exactly like an ordinary subscribe under the
caller's own credential; the token only carries resume state. MAC keys are
identified separately from `generation` (a key id in the token envelope), so
an expired/retired signing key and deployment staleness produce distinct
refusal codes for diagnostics; the keyring verifies under the N most recent
keys (a bounded rotation-overlap window, so routine rotation is not a
fleet-wide refusal event), with the retired-key code applying only past the
window. Resume refusal codes live in a stable **`SNAPBACK_RESUME_*`**
namespace, paralleling `SNAPBACK_BUNDLE_*`. Admission also enforces resource limits (step 0): maximum token
bytes, maximum membership-witness bytes (rung 2), maximum journal distance,
replay CPU/time budget, and a per-authority resume rate — each limit answers
with rung 3 or a coded refusal, never partial replay. Refusals carry
distinct codes per cause (stale generation, stream mismatch, journal-floor
miss, non-analyzable query, invalid witness, resource budget, policy
replacement) so observability can separate them.

#### D1.2 Snapshot bundle fetch

A request/response endpoint that evaluates a **manifest entry** (D1.4) — not
an arbitrary caller-supplied query array — and returns each query's snapshot
with its per-query token, all minted at one commit, with the invariant that
every snapshot in a bundle was evaluated at the same commit version (this
single-commit consistency is the differentiator over Convex's documented
cross-`preloadQuery` inconsistency). Provisional shape (step 0 finalizes):

```
POST /app/bundle
{ manifestEntry, routeParams, mode: "read" | "register", idempotencyKey? }
→ { commitVersion, generation, versionStream,
    entries: [ { function, args, rows,
                 resume,            // present iff rqsEligible; null otherwise (both modes)
                 subscriptionId?,   // register mode only
                 authorization? } ],// register mode, auth-scoped entries: LLP 0053 scope/invalidation projections
    connection?: { connectionId, grant, attachDeadline } }
```

Per-entry payloads form a **closed union** with schema parity fixtures:
`rqsEligible` entries carry `resume`; all other entries carry `resume: null`
in both modes (read mode returns their rows without a token); register-mode
entries additionally carry `subscriptionId` and, for auth-scoped queries,
the authorization projections. **Register mode is scoped to credentialed
callers in v1** — the replay-validity tuple's sender-key identity and
credential incarnation have no defined values for an anonymous caller under
LLP 0077's custody model, so anonymous callers use read mode (fixture in
step 2).

Mechanism is per-arm and is a **prerequisite**: on the Cloudflare arm the
single coordinator DO serializes reads naturally; on the local arm the bundle
evaluation must run inside one pinned read transaction (or an equivalent
storage-layer cut) — if the local storage layer cannot yet express that, that
work precedes rollout step 2. Bundle semantics: atomic — any query failure
fails the bundle with a coded error in a stable `SNAPBACK_BUNDLE_*` namespace
(LLP 0010 style); hard limits on query count, rows, bytes, and evaluation
time are part of the endpoint contract; requests run under the requester's
authenticated identity exactly like a subscription (LLP 0011). Modes:

- **read** (default): snapshots + tokens only; no server-side subscription
  state is created. For socket-less surfaces and Channel A assembly.
- **register**: additionally creates the live subscriptions at the same
  commit cut and returns their subscription ids and (for auth-scoped queries)
  the full LLP 0053 authorization scope/invalidation projections — but no
  resumable tokens for the auth-scoped entries (v1). **Connection-ownership
  contract:** durable subscriptions today die with their socket (LLP 0034),
  `/live/*` operations bind to a per-connection grant, and — critically —
  Active LLP 0031 requires a current authenticated socket session before
  HTTP can arm subscription demand ("socketless HTTP cannot arm demand").
  Register mode is therefore **not buildable under 0031 as it stands**: step
  0 includes a **dated LLP 0031 amendment** defining a bounded
  **pending-registration owner** distinct from a socket session — register
  mode atomically mints the connection identity and grant under the existing
  custody rules and returns them with the registration set; the client's
  subsequent socket attach presents that grant and takes **atomic handoff**
  of the pending registrations. The amendment covers grant custody,
  sender-constrained rotation, authority transition, retry after a lost
  response, overlapping sockets, attach/close races, and Cloudflare
  persistence/reaping — and its acceptance proves the
  socketless-HTTP-cannot-arm-demand invariant still holds *outside* this one
  closed operation. (The recorded alternative — authenticate/attach the
  socket first, then run the bundle-register transaction on it — costs the
  extra round trip this mode exists to remove; it remains the fallback if
  the amendment is rejected.) Registrations live in a bounded **attach grace
  window**; if no attach arrives by `attachDeadline` they are reaped. The
  request carries an **idempotency key minted by the client per boot
  attempt** — two concurrent same-user boots of the same route (two tabs)
  hold distinct keys and produce distinct registration sets, composing with
  LLP 0053's second-tab attach rule via the Web-Lock store discipline (D3).
  The tuple (authority, sender-key identity, credential incarnation,
  generation, manifest entry, canonical args) scopes a key's *replay
  validity*: a retry after a lost response returns the same registration set
  (or atomically supersedes it), never a duplicate, while a different sender
  key presenting the same idempotency key is refused. Retry semantics ride
  LLP 0077's sender-constrained model — nonce consumption on first execution
  and on retry, and whether the same connection-grant secret may be returned
  again, are 0F-amendment items with lost-response fixtures for credential
  rotation and authority transition. Partial attach, socket failure before
  attach, client abandonment, and authority transition during evaluation are
  step-0 contract cases with step-2 acceptance fixtures. This is the mechanism that satisfies LLP
  0063's no-duplicate-subscription / no-stale-flash seam for data preload.

##### Mixed-route v2 implementation amendment (2026-08-03)

**Dated normative amendment, author-promoted 2026-08-04** — executes the
wave-3 program's mixed-route assignment, designed against Accepted LLP 0157,
reviewed at landing, and explicitly promoted by Charlie Cheever;
it converts the non-normative 2026-08-02 register-gradient proposal in
the Revised header into this profile's contract.

**Artifact decision.** Use
`artifactKind:"queryGroupReference"` with `formatVersion:2`, not a second
top-level artifact kind. The generated `groups[route]` lookup and route-param
typing remain one authoring surface, while the numeric discriminator, required
`profile:"mixed-route.v2"`, distinct `query-group-v2` id, and v2 definition-
hash domain make the decoder and identity domains disjoint. This is therefore
a new artifact version, never an alternate interpretation of the LLP 0112
format-1 all-live group. A decoder that does not explicitly implement format 2
refuses it; format 1 never gains optional mixed semantics.

Codegen emits the LLP 0157 `PlanHashV1` and, in route order, each child's exact
generated function reference, `NodePlanRecordV1`, `NodePlanHashV1`, and an
explicit `liveness` field byte-equal to that node plan's owner-issued
`capability.live`. All artifact records are closed: an unknown field, missing
field, unsupported liveness member, hash mismatch, repeated child identity, or
disagreement among `ref.kind`, `nodePlan.capability.exportKind`, `liveness`,
and the node hash refuses; no consumer repairs or narrows it. The request
repeats `formatVersion:2`, `profile`, and `planHash`; omission continues to
select the existing format-1 request. Any partial discriminator or unknown
version refuses before evaluation. The v2 response repeats those three facts
and adds:

```ts
type GeneratedFunctionReference = {
  artifactKind: "functionReference",
  schemaVersion: string,
  appId: string,
  id: string,
  name: string,
  kind: "Query" | "LiveQuery",
  implementationHash: `sha256:${string}`,
  argsContractHash: `sha256:${string}`,
  resultContractHash: `sha256:${string}`,
  expectedGeneration: ExpectedGenerationV1
}

type MixedQueryGroupReferenceV2 = {
  artifactKind: "queryGroupReference",
  formatVersion: 2,
  profile: "mixed-route.v2",
  schemaVersion: string,
  appId: string,
  id: `${string}:query-group-v2:${string}`,
  route: string,
  definitionHash: `sha256:${string}`,
  planHash: `sha256:${string}`,
  queries: readonly {
    name: string,
    ref: GeneratedFunctionReference,
    args: Readonly<Record<string, unknown>>,
    nodePlan: NodePlanRecordV1,
    nodePlanHash: `sha256:${string}`,
    liveness: NodeCapabilityBindingV1["live"]
  }[],
  persist?: false
}

type MixedDeliveryV2 =
  | { kind: "registered-live", nodePlanHash: string }
  | { kind: "read-only", nodePlanHash: string }

type MixedAggregateV2 = {
  kind: "mixed",
  weakest: "read-only",
  liveChildren: number,
  readOnlyChildren: number
}
```

The route is eligible only when it contains at least one generated `Query`
and one generated `LiveQuery`. It retains D1.2's 1–32 child, 5,000-row,
4-MiB, two-second, rate, pending-owner, and attach-grace bounds. The host
rebuilds the LLP 0157 `exported_query_v1` nodes and `mixed-route.v2`
composite from the served function and route manifests and exact-compares
every argument contract hash, node hash, merged route/argument hash, and plan
hash before the pinned read begins. `NodeCapabilityBindingV1.live` is the sole
liveness authority: an otherwise byte-identical plan declared `Query` remains
read-only; a declared `LiveQuery` with the admitted whole-result
`live_replace` binding registers. The generated-reference kind is checked for
consistency with the binding but is not itself the classifier. Runtime/plan
shape, table set, cursor presence, reference kind, response shape, and the
presence of `subscriptionId` are never liveness oracles. If the explicit bound
fact is absent or inconsistent, the operation refuses rather than inferring.

Execution is one all-or-nothing pinned read transaction. Every child invokes
under the requester's current authority and observes the same
`commitVersion`. The transaction first obtains every child result; only then
does each admitted-live child install a subscription from that exact result
and dependency capture. A plain child creates no subscription, namespace,
authorization obligation, or attach cleanup work and returns
`subscriptionId` absent with `delivery.kind:"read-only"`. An auth-scoped live
child retains D1.2's namespace and complete LLP 0053 authorization projection;
authority-independent live children retain the existing null-namespace rule.
Every position, including a read-only child, resolves its own LLP 0157
`QueryMaterializationKeyV1` from that child's generated reference, the shared
plan hash, canonical materialized args, exact activation, and owner-issued
authority partition, and installs a distinct read-only materialization record.
The record's boot delivery is not authority evidence: a read-only child is an
ordinary one-shot result with `freshness:"snapshot"`; a live child becomes
`freshness:"current"` only through registered adoption. Absence of the exact
activation/authority inputs refuses QMK installation; no default partition or
parallel route-local key is permitted.

Any admission, argument, authority, query, result-contract, row/byte/time, or
registration failure refuses the entire response and purges every freshly
created connection/subscription/grant fact. Abandonment, attach expiry,
authority replacement, malformed client installation, and retry cleanup act
only on the actual live-child subscription ids; read-only children own
nothing to reap. The idempotency replay tuple gains wire version, profile, and
plan hash, so a format-1 attempt or changed plan cannot replay a v2 owner.
Only explicit live children count against subscription capacity; every child
continues to count against bundle width/rows/bytes/time.

The pre-existing `mixed_bundle_boot_v2` **experimental** registry rows
cover exactly the pinned-read bundle execution surface (the native
fixture below); they are compatible with this amendment and are not
promoted by it. Any maturity promotion beyond experimental — and any
claim that mixed boot installs LLP 0166 store records — additionally
requires the QMK installation gate above, owner-bound and exercised end
to end.

The prepared client exposes each child's `bootDelivery`; live children adopt
their registered subscription, while read-only children install a static
`freshness:"snapshot"` store and never start an ordinary subscription. The
group reports the weakest honest state (`connection:"idle"`, aggregate
`weakest:"read-only"`) while live siblings continue to report `live` and
receive updates. This amendment makes no target capability, maturity,
hosted, or public-package publication claim; an unimplemented profile or unsupported
target refuses explicitly. Executable witnesses support this accepted
amendment but do not independently promote capability maturity: the native
pinned-read fixture, the codegen v2/format-1
goldens, the client liveness near-miss/refusal suite, and the React mixed-group
acceptance. Those are partial implementation witnesses, not evidence that the
QMK installation gate above is satisfied; a target may not advertise this
profile until that installation is owner-bound and exercised end to end.

#### D1.3 Replay admission ladder

Answering a resume is graduated, because delta replay is *not* universally
available: DK-3 `live_delta` covers only analyzable unordered queries
(ordered/limited/opaque plans are replace-only, membership-gated plans are
excluded fail-closed — LLP 0008, LLP 0034), and reconstructing "rows that
left the result" from the post-image journal requires knowing the client's
prior membership, which a bare version does not carry. v1 prefers a
client-supplied membership witness (bounded, in the resume request) over a
Zero-style server-held CVR: it keeps the server stateless per client at the
cost of capping eligible result sizes — the cap is a server policy knob with
a step-0 default, above which rung 2 is refused in favor of rung 3.

**Atomicity rule (all rungs):** whatever rung answers, the response and the
live registration are established under one arm-specific serialization cut —
no commit may fall between proof/replay/snapshot and the subscription going
live. Acceptance includes race tests pausing between proof, registration,
and response publication.

The server answers with the *first* rung that applies:

1. **Unchanged proof → `CurrentAsOf`**: a new `LiveEnvelope` variant (durable
   lane; `version` carries the same schemars range cap as the other
   envelopes) with the subscription id, the **current head version N**, and a
   **fresh token minted at N** — the client adopts the new token without
   touching rows, shrinking future journal distance. All rung-1 proofs
   presuppose the closed-inputs eligibility fact (Authorization scope):
   journal-based proofs are sound only for results that are pure functions
   of `(database state, args)`, so a query without the closed-inputs proof
   takes rung 3 (fresh execution) regardless of proof class. For
   ordered/replace-only queries the sequence-sensitive digest is carried
   from mint (their tokens refresh only at `LiveReplace` boundaries), and —
   as a **deliberate v1 simplification** — only the global proof applies to
   them (the table-set proof would also be sound for ordered closed-inputs
   queries; deferred, not forbidden). Proof obligations by query class:
   the **global** proof (no commits at all since `version` — the common
   idle-relaunch case) applies to every closed-inputs query class; the
   **table-set** proof (no journal rows for the query's read set) applies
   only when *both* hold — `version` is at or above the journal's monotonic retained floor
   (absence of journal rows is evidence only where coverage is complete; a
   pruned journal makes "none found" indistinguishable from "history
   missing"), *and* the server holds a **complete certified dependency
   summary** for the token's exact `generation`. The certifier is named:
   a per-`queryArtifact` **static dependency-summary artifact derived at
   deploy/analysis time** (cacheable per generation; aligned with LLP 0053's
   complete-read-summary machinery), not per-execution capture — which would
   reintroduce per-client server state. Opaque plans, incomplete/unknown
   summaries, summary drift, pruned coverage, and journal-read failure all
   take rung 3. Acceptance includes the boundary tests (`floor - 1`, `floor`,
   concurrent pruning) and a negative fixture where an opaque query's
   undeclared dependency changed.
2. **Delta replay**: only for DK-3-analyzable unordered queries whose held
   rows are exactly at the token's `version` (the binding rule guarantees
   this; the ladder states it to foreclose replaying onto advanced rows),
   with a client-supplied **membership witness** within the size cap. The
   witness is not identity-only: the journal stores post-images for
   inserts/updates but no row body for deletes, so a stateless server cannot
   subtract an old row's hash from the multiset digest without being told
   it. The required semantic is therefore **exact `(rowId, oldRowHash)`
   pairs**, with digest leaves defined as commitments to the *keyed pair* —
   `H(canonicalRowId || rowHash)`, aggregated — so the MAC-bound
   `contentDigest` root binds the exact identity-to-hash mapping, not merely
   the multiset of hashes (an unkeyed aggregate would let a witness permute
   valid hashes among row ids and still match the root). Duplicate row ids
   are rejected. The witness aggregate must equal the root before replay is
   admitted — making token and witness jointly verifiable. **Accumulator
   update rule:** starting from the verified old root state, the server
   updates **only journal-affected row ids** — for each such id, subtract
   its witnessed old leaf where the row was previously present, and add its
   new post-image leaf where the row remains in the result; **untouched
   witness leaves stay in the accumulator**. (Subtracting the entire witness
   would silently drop unchanged rows from the minted root.) A
   well-formed-but-wrong witness fails the root check instead of driving an
   incorrect replay. Total admission work is
   **O(held rows + changed rows)** — the server must parse and aggregate the
   full witness — with request bytes to match; the size cap bounds both, and
   witness bytes and verification CPU are §Scalability gates. The client independently **verifies the post-replay
   digest before treating replay completion as authoritative**. Formats that
   admit uncertainty must reconcile such that decode failure or ambiguity
   falls back to rung 3 and **can never suppress a required removal**. The
   reply is `LiveDelta` frames from the journal under the atomicity rule,
   ending with a fresh token. Acceptance includes negative fixtures for
   omitted, extra, substituted, duplicate, and correct-id/wrong-hash witness
   entries, plus adversarial collision/ambiguity fixtures. (If the witness
   size cap proves too tight in practice, the recorded v2 alternative is
   Zero's server-held CVR — trading per-client server state for unbounded
   result sizes.)
3. **Fresh `LiveReplace`**: always correct, always available; used on journal
   floor miss (`journal_resume_requires_resnapshot`), non-analyzable queries
   without an unchanged proof, token/limit refusal, or whenever replay would
   cost more than replacement (server's choice; see Scalability).

Rung 2 is an optimization stage of the rollout with its own prerequisite
step, not a v1 gate: Channels A–C deliver their latency value with rungs 1
and 3 alone.

#### D1.4 Route → query manifest

A declarative statement of which `(function, args)` pairs a route/screen
needs before app JS runs, so the server can assemble a bundle without
executing view code. Manifest entries declare arg parameterization from
route/URL params (a small validated mapping, not arbitrary code — see Q2;
route matching happens after `basePath`/SPA-fallback normalization), are
versioned with the deployment (`generation`), and each entry is validated
against the served instance's functions-manifest admission machinery (the
surface LLP 0076 just extended) — including, for Channel A eligibility, both
gates of the Authorization scope: `authorityIndependent` *and* `publicInline`.
A manifest entry's presence authorizes *preload selection* only; resumability
and inline-safety are properties the server decides per D1.3 and D2.

### D2. Channel A — inlined web boot ("data SSR"), v1 public-inline-only

**Serving seam per arm.** On the Cloudflare arm the gateway owns the HTML
response. On the local arm it does not — the demo's `index.html` is served
by Vite, and Snapback only answers API calls — so local Channel A requires a
named seam: the **LLP 0030 managed Vite integration
(`packages/snapback-vite`) via a `transformIndexHtml` hook**, which owns
route matching (after `basePath`/SPA-fallback normalization), manifest
lookup, origin handling, the pinned bundle evaluation, failure fallback, and
response headers (cluster 0E). Note the step-3 prerequisite this implies:
graffiti's web surface currently uses the Exact `exactContractWeb` preset,
not `snapback-vite` (only `demos/todo` is on the managed plugin today), so
step 3 includes adopting the plugin in graffiti or teaching the Exact
preset the hook. If the seam slips, the recorded fallback is
Cloudflare-first (swap rollout steps 3 and 4) with local integration as a
separate prerequisite.

When the serving seam produces `index.html` for a route whose manifest
entries all carry `publicInline`, it evaluates the manifest's bundle (one coordinator
subrequest per pageload on the Cloudflare arm — the gateway itself holds no
data; today assets bypass the coordinator entirely, so this composes the two
paths per-request, with the step-0 contract covering the response-mechanics
consequences: recomputed `Content-Length`/`ETag`, compression, CSP,
SPA-fallback interaction, and cache headers when transforming
`env.ASSETS.fetch` output) and embeds the bundle in the document (e.g.
`<script type="application/json" id="__snapback_boot">`). v1 baseline: the
transformed HTML is served `Cache-Control: no-store` — no bundle caching
across pageloads, making the "v1 ships uncached" posture mechanically true;
within-version caching is Q6's territory. Embedded tokens are minted under
anonymous authority and are authority-neutral per D1.1; because the client
store's canonical identity includes an authority component, preloads for
authority-independent queries are stored under a **canonical
authority-independent alias key** with a checked promotion rule, so a
logged-in browser consumes an anonymously minted public-inline snapshot
without creating an empty parallel store or duplicate subscription
(acceptance fixture in step 3). **Failure posture:** on bundle evaluation
failure, timeout, over-limit, or an invalid/non-`publicInline` manifest
entry, the gateway serves the **unhydrated shell** — degrading to today's
waterfall, never failing the pageload, preserving "resume adds no new
failure mode" — and anonymous pageload evaluation runs under a bounded
budget (step-0 Channel A contract).

**Embedding is a security surface.** Row data is attacker-influencable, and a
literal `</script>` inside a JSON string terminates the script element
regardless of MIME type. The serializer MUST apply JSON-string unicode
escaping to **every string token in the completed serialization — object
keys included** (application-controlled property names are as dangerous as
values), and no post-serialization transform may reintroduce the escaped
code points: every literal `<` is emitted as the six-character sequence
`\u003c` (which neutralizes `</script>` and `<!--`), every literal `>` as
`\u003e` where `-->` could otherwise appear, and U+2028/U+2029 as
`\u2028`/`\u2029`. Acceptance pins exact serialized bytes for fixtures
including `</script>` in values *and in property names*, mixed-case variants,
escaped-slash forms, comment-opening sequences, nested objects, and
Unicode-separator payloads.

Client boot changes: a **preload registry** keyed by the canonical
external-store identity (which already includes provider, query, authority,
and canonical args — `external-store.mjs`) is populated from the embedded
bundle *before* `createRoot` — the demo renders client-only, so
`getServerSnapshot` is not the seam; it stays reserved for a future real
hydration path (LLP 0063). The store starts from preloaded rows + token
instead of `EMPTY_ROWS` (surfaced as retained/pending per D1), paints on
first render, and every subscription opens with `resumeFromToken`.

**Handshake elision is arm-dependent.** On arms where the served instance
owns the app identity (the deploy-time-compiled Cloudflare arm — LLP 0076),
the boot payload embeds the instance's attestation facts (the `generation`
digest, instance id) so the client can skip `health()`/`ensureApp()` round
trips when they match; serving a page MUST NOT provision — `ensureApp`
provisioning is privileged (LLP 0031) and remains a dev-loop workflow. On the
local dev loop the client owns the schema manifest and continues to drive
`ensureApp`; there the embedded facts are advisory (a manifest-hash echo) and
the elision does not apply.

**Authenticated routes are out of Channel A in v1.** Under the landed browser
auth architecture (LLP 0060/0077: bearer tokens with sender-constrained
custody in IndexedDB; cookies deliberately unadopted), the initial document
navigation carries no credential the gateway can evaluate, so per-identity
HTML is unimplementable as specified — and adopting a cookie-class navigation
credential requires its own LLP 0060-adjacent security analysis (a v2 door).
Authenticated web boot instead uses **shell + immediate Channel C bundle in
register mode** (D1.2, D4).

Dynamic-evaluation note: the *currently selected* Cloudflare profile is
deploy-time compiled, so the manifest ships inside the deployed Worker
artifact like handlers do. This is a property of the selected profile, not a
platform prohibition — LLP 0083 records that Worker Loader and Durable Object
Facets now exist; manifest delivery under a loader/facet profile is a
topology question for that program (LLP 0087), not this RFC.

### D3. Channel B — persisted device snapshot

Clients durably persist the **latest** `snapshot + resume` (token blob +
clear meta) per subscription, fed by normal live-subscription token refresh
(D1) at the persistence cadence defined there. On relaunch, for
**authority-independent** subscriptions: verify `contentDigest`, render the
first frame from the persisted snapshot (marked retained/pending), subscribe
with `resumeFromToken`, apply the ladder's answer. Auth-scoped persisted data
follows the Authorization scope section: no render-before-reauthorization, no
resume; retained display of auth-scoped rows is exclusively the LLP
0043/0053 lease machinery's decision.

**Outbox rule (LLP 0043).** LLP 0043's landed milestone is
full-resync-before-replay, with delta-resume-with-pending-mutations its
explicitly deferred third milestone. v1 keeps that boundary: a relaunching
client with a non-empty mutation outbox does not send `resumeFromToken`; it
takes the 0043 path (full resync, then replay). Composing resume with a
pending outbox is milestone-3 work co-owned by LLP 0043.

> **Outbox rendering note (2026-08-01, sweep finding 0137-a1-f6).** The
> outbox rule is a *protocol* rule, not a display rule. The first JS-arm
> implementation over-applied it by also blanking the retained render
> whenever the outbox was non-empty, which made offline capture and retained
> render mutually exclusive: queuing a write offline disabled the next
> boot's retained frame — nearly a product contradiction for capture-offline
> shapes, and exactly the combination the frozen Firebase/InstantDB bar
> renders together (Diary 0027). The arm now keeps the render while keeping
> the rule: a relaunch with pending intent renders the verified persisted
> rows marked `retained` — explicitly PRE-intent, with no optimistic overlay
> of the queued writes (this arm has no local execution to derive one) and
> the explicit pending-intent fact `handle.pendingIntentsAtSeed` naming the
> queued count (live queue state is `client.outboxStatus()`) — while the
> resume token is withheld entirely: the handle holds none, `resumeFromToken`
> is never sent, and reconnect takes the unchanged 0043 path (full resync,
> then ordered replay). Every D3 honesty invariant stands: retained is never
> presented as current, no overlay is fabricated, and a non-empty outbox
> still never resumes. Proof: the outbox-rule case in
> `packages/snapback-client/rqs-resume-suite.mjs` (both store arms) and the
> pending-intent relaunch check in
> `demos/public-dashboard/tests/acceptance/offline-local-first.mjs`.

> **Dated successor-expression amendment (2026-08-03,
> `single_table_v1@1` owner acceptance):** the narrow retention value
> `rqs-authority-independent-snapshot-v1` is the successor expression of
> Channel B's existing `rqsEligible` authority. It is issued only for the exact
> host-derived predicate registered as `single_table_v1@1`; it is not a
> general public-data or anonymous-lease class. The legacy digest selector,
> token bytes, admission ladder, persistence verification, outbox rule,
> retained labels, and indefinite offline display remain unchanged during
> connected prove-or-fresh adoption. Legacy entries coexist under their own
> byte-exact identity and budget until one LLP 0166 same-domain transaction
> installs the proof-backed QMK record and removes or terminally retires the
> legacy entry; there is no relabel in place. A legacy token or content digest
> may help the unchanged ladder prove current result bytes, but neither becomes
> a QMK credential or substitutes for `CompletenessProofV1`. Proof-backed QMK
> token resume remains the separate lane reserved by LLP 0166 OQ2 and requires
> its own dated LLP 0090/0093/0094 amendment. This acceptance is semantic only
> and grants no implementation or capability claim.

**Web multi-tab ownership.** Persisted snapshots/tokens live inside the
existing Web-Lock-serialized same-origin store discipline (LLP 0008; LLP
0053's second-tab attach rule): the lock holder is the single writer of
persisted resume state, and a tab attaching to a store it did not populate
adopts the store's persisted token rather than its own stale copy (this is
also how register-mode boots compose: each tab's bundle registrations are
its own, but persisted resume state has one writer).

**Storage lifecycle.** The RQS persisted store is bounded: a per-app budget
with an eviction rule (least-recently-resumed first, where
"recently resumed" means the last *successful authoritative* resume for the
entry, with timestamp and eviction bookkeeping updated atomically with the
entry) and, where finer control is
wanted, a per-manifest-entry persist opt-out — bundle limits bound the wire,
this bounds the disk; parameterized queries (`argsHash` per instance) would
otherwise accumulate unboundedly. Budget, eviction, and a fixture live in
cluster 0A with the persistence cadence. An offline relaunch renders
persisted rows as retained/pending indefinitely — per LLP 0043's rule that
retained data is never presented as current — with `generation` currency
necessarily unchecked until connect, at which point the normal admission
path (including refusal) applies. Where
Channels A and B both supply the same subscription, the higher `version`
within *matching token identity* (`app`/`generation`/`versionStream`/
`queryArtifact`/`argsHash`, digests verified) wins; on any identity mismatch
both are discarded for a fresh subscribe.

Native specifics: the persisted store rides the DK-9 store-agnostic
client-store interface (LLP 0008) rather than a parallel artifact, inheriting
its corruption/fail-closed posture; on-device it must be durable local
storage on the native side of the Hermes/Ibex boundary (SQLite or files).
The v1 RQS resume store holds only `rqsEligible` snapshots (Authorization
scope; the LLP 0043/0053 lease store is a separate, unchanged artifact),
which bounds the new at-rest exposure; the store still keeps per-identity keying and
eviction on user switch (LLP 0053's wipe semantics) so the v2 door inherits a
correct layout, and purges on an `AuthorizationInvalidation` frame or
`ResyncRequired` with `clear_retained` — the persisted copy, not just the
in-memory one. Encryption-at-rest posture is Q4. Persisted state is untrusted
input: corrupt, truncated, or digest-mismatched snapshots fail closed to a
fresh subscribe (with the D1 threat-model caveat: this is corruption
detection, not tamper-proofing).

#### D3 owner-only file permissions amendment (2026-08-12)

The Node file-backed carrier creates its RQS/outbox directory with mode `0700`
and every state blob, atomic-write temporary, and writer lock with mode `0600`.
Opening a pre-existing store best-effort tightens the directory, blob, and lock
to those modes before using them. A filesystem or injected native adapter that
does not implement meaningful POSIX chmod semantics may refuse that tightening
without making the store unavailable; the Node adapter's restrictive creation
modes remain mandatory. This closes accidental same-host readability of resume
tokens and queued mutation payloads. It does not add application-level
encryption or resolve Q4, which remains the owner of stronger shared-device
threat protection.

### D4. Channel C — fetched snapshot bundles

The bundle endpoint (D1.2) used directly:

- **Authenticated web boot** (see D2): shell + one bundle request in
  **register mode** under the existing bearer custody. The bundle *is* the
  LLP 0053-mandated fresh snapshot, taken once, with live subscriptions
  registered at the same commit cut and the connection grant minted in the
  same response — no duplicate fresh snapshot follows, and the handshake
  facts ride along.
- **Deep-link / notification cold start:** one request returns every snapshot
  the target screen's manifest entry needs plus tokens, replacing N
  independent subscribe round trips (register mode when a session follows;
  read mode otherwise).
- **Socket-less surfaces:** WidgetKit timelines, watch complications,
  notification content/share extensions, App Intents fetch a read-mode
  bundle, render, and exit — no subscription at all. Freshness is pull-based.
  **v1 limits socket-less Channel C to public (`publicInline`-class)
  bundles**: those constrained processes' credential story — extension
  access to shared auth state, sender-constrained key usability outside the
  main process, shared-container isolation, and user-switch revocation
  propagation (LLP 0011/0053/0077) — is an unwritten contract, and
  authenticated socket-less bundles wait behind it (a prerequisite for the
  widget rollout surface if it wants non-public data, and otherwise a v2
  item).
- **Push-driven freshness (separate follow-on, not this RFC):** silent pushes
  carrying deltas or resync nudges raise their own protocol concerns
  (unreliable delivery, payload limits, credential binding, ordering,
  sensitive data in push payloads) and are deferred to a dedicated proposal.

### D5. Later layer — HTML SSR for public pages (explicit non-goal here)

Per-request HTML rendering at the edge is feasible (the coordinator answers
request/response reads; app JS runs in the deployed Worker) but is **out of
scope for this RFC**. It is only clearly worth building for anonymous/SEO
pages — LLP 0063's production-web gate and commerce pressure test — where a
live-query system enables the genuinely differentiated form: edge-cached HTML
with push-driven, exact invalidation (the delta stream tells the cache
precisely when a page's inputs changed; LLP 0008's 2026-07-23 note on
bookmarkable versions and a future cacheable read lane is the same thread —
see Q6). For Contract/Exact surfaces this additionally requires the 0063
SSR/hydration authority ("hydration without duplicate subscriptions or stale
flashes"), which must not block channels A–C. If pursued, it becomes its own
LLP consuming this primitive.

## Scalability

Stated as conditional hypotheses with measurement gates, not guarantees.
Metrics separate **first rows visible**, **rows proved current**, and **live
registration attached** — a channel can improve the first while regressing
the others, and the gates must see all three.

- **Channel A** trades one bundle evaluation per pageload (including bots,
  bounces, and JS-disabled visits that today cost only static bytes) against
  the removed round trips, and public-inline-only scope preserves
  shared-cache eligibility of the shell for unmanifested routes. v1 serves
  transformed HTML `no-store` (Q6). Gate: page-query CPU, added HTML bytes,
  static-cache hit-rate change, bot/JS-disabled traffic ratio (those visits
  pay full bundle evaluation for zero hydration benefit), and the three
  timing metrics on a demo route, measured in rollout step 3.
- **Channel B** saves bandwidth only when rung 1 or 2 answers; after a long
  or write-heavy gap, replay can cost more than replacement, so the server
  always may choose rung 3 (a replay-versus-replace threshold is a server
  policy knob). `generation` rotates whenever any bound component changes —
  in practice nearly every deploy — refusing all outstanding tokens: the
  fleet takes rung 3 at once, which matches today's deploy behavior (sockets
  drop, clients resubscribe fresh) and is not a regression, but it is
  counted. Token refresh adds one MAC + incremental digest update per
  result-change (shared across fan-out, D1); that overhead is a measured
  gate, not assumed negligible, with first-row bytes and token bytes
  recorded separately — per-delta token overhead can dominate very small
  updates. Gate: resume-hit rate by rung, refusals by coded reason, journal
  read cost, replay op count versus replacement bytes, witness bytes and
  verification CPU (rung-2 admission is O(held + changed rows)), refresh
  overhead per envelope. The direct competitive benchmark for the step-3
  timing gates is Convex's `preloadQuery` full-re-execution-after-hydration
  cost (Prior art) — the measurable target the differentiator claim rests
  on.
- **Retention**: honoring resumes across relaunch gaps needs journal
  retention beyond live needs only insofar as rung 2 matters; rungs 1 and 3
  keep the floor policy (`journal_resume_requires_resnapshot`) authoritative
  and bound the cost. Token refresh keeping persisted cursors near head
  further shrinks typical journal distance.
- **Observability** (required with step 1): counters for resume
  attempted/admitted/refused with per-cause refusal codes (D1.1), rung
  taken, journal distance, bytes avoided, and the three timing metrics.

## Open questions

- **Q1 — Manifest authoring surface.** Where does the route → query manifest
  live (schema-adjacent declaration, per-surface file, or derived by the
  packaged dev loop of LLP 0041)? Validation home is decided (the served
  instance's functions-manifest admission), authoring is not. For
  `publicInline`, only the *authoring surface* is open here — the fact
  itself always compiles into the codegen-derived functions manifest (it is
  never a route-manifest-authored declaration, per the re-check grounding
  in the Authorization scope).
- **Q2 — Args parameterization.** URL/route params → query args needs a
  declarative validated mapping that runs without app JS. How expressive
  before it becomes a DSL problem? (Route matching, `basePath`, SPA fallback,
  and encoded params are part of this question's acceptance surface; the
  D1.4 admission machinery is the enforcement home for whatever mapping is
  chosen, so the answer cannot drift into client-evaluated code.)
- **Q4 — At-rest posture for persisted snapshots.** The v1 RQS resume store
  holds only `rqsEligible` data (D3; the LLP 0043/0053 lease store is
  unchanged and out of this question's scope), which shrinks the surface;
  per-identity keying and user-switch wipe remain required so the v2 door
  inherits a correct layout. Is OS-level file protection sufficient, or do
  shared-device threats justify app-level encryption — and does the D1
  threat-model narrowing (no client-side tamper-proofing in v1) warrant a
  platform trust anchor later? Needs an LLP 0011/0053-adjacent decision.
- **Q6 — Caching anonymous bundles.** `publicInline` manifests could make the
  inlined HTML (and Channel C bundles) CDN-cacheable with delta-driven
  invalidation — the Electric-style story and LLP 0008's bookmarkable-versions
  thread. Deferred to the D5 follow-on unless a cheap subset falls out of
  step 4; v1 explicitly ships `no-store`.
- **Q7 — Membership witness format.** ~~Rung 2's witness must be an exact,
  bounded, recoverable representation of held row identity (D1.3); raw key
  set vs recoverable encoding, the reconciliation rule, and the default size
  cap are open.~~ **Decided** (2026-07-24, rollout steps 5a+6, ENG-25457)
  in LLP 0091's dated rung-2 membership-witness amendment: raw
  `(rowId, oldRowHash)` pairs in ascending UTF-16 id order with an explicit
  count; caps of 4096 entries / 1 MiB (server policy knobs); a fail-closed
  per-cause reconciliation rule (any ambiguity → rung 3, never suppressing
  a removal); and a replay-vs-replace knob defaulting to
  affected ≤ held-count. The v1 preference for client-supplied witness over
  a server-held CVR was already decided (D1.3).

(Former Q3 — resume-miss policy — is resolved in D1.1: short-circuit with a
fresh `LiveReplace`. Former Q5 — bundle consistency — is a prerequisite in
D1.2.)

**Dated boundary note (2026-08-03, LLP 0166 acceptance):** Accepted
LLP 0166 is the declared successor of the Channel-B persisted store's
*domain and lifecycle* — the physical store family evolves in place to
also hold LLP 0157 materialization records, with this RFC's machinery
consumed unchanged as the sync engine: the D1.3 admission ladder,
token/digest identity, arbitration, the D3 outbox rule, and the legacy
persisted population's exact lifecycle — the shipped eviction
comparator, indefinite retained offline display, and budget envelope —
are **grandfathered byte-exact**, with no cross-section budget
competition and no TTL, grace, or demand semantics applied to legacy
entries. Coexistence under the family's own labels satisfies LLP 0157
§Migration's never-mislabel rule (a legacy entry itself carries no plan
identity); the dated `single_table_v1@1` amendment above permits only the
connected prove-or-fresh adoption it specifies, otherwise migrate-or-discard
still governs. A
proof-backed resume credential for `qmk1` materializations remains a
future dated amendment here (LLP 0166 OQ2). This note changes no
behavior owned by this RFC.

## Rollout sketch

0. **Prerequisite contract clusters** — named so independent clusters can
   land and be reviewed separately; each lands through LLP 0051's wire drift
   gates where it touches the wire:
   - **0A Token & digest cryptography:** MAC scheme, key id + rotation,
     expiry/size, and **key custody per arm** (Worker secret vs DO storage
     vs local store; local-arm restart survival) with key loss pinned as
     availability-only (everything refuses to rung 3); canonical row
     encoding (RFC 8785 JCS with mint-time refusal rules) and the
     domain-separated length-framed leaf; `issuedAt` expiry anchor and
     default max token age; the shape-split `contentDigest` — pinned by
     name and parameters, not class (proposed default: LtHash-16-class
     multiset accumulator with an XOF leaf expansion for unordered, hash
     over the JCS rows array for ordered), published as a fixed-size
     compressed root with the full state server-held — with cross-language
     property-based parity tests (numeric edge cases,
     duplicate rows, Unicode normalization, key ordering); token refresh
     rule + persistence cadence + the persisted-store budget/eviction rule;
     `generation` digest components incl. the local-arm minting rule;
     `versionStream` reuse crosswalk.
   - **0B Wire schemas:** `CurrentAsOf` envelope (fresh-token field, version
     range cap, and a client transition table covering digest verification,
     persistence failure, optimistic layers, duplicate delivery,
     lower/equal/higher versions, and the old-decoder tolerance case —
     refreshed-token fields as ignorable optional additions on
     `LiveReplace`/`LiveDelta`, given `deny_unknown_fields` precedent in the
     codebase); new token-resume schemas (wire-named distinctly from the
     existing reattach operation) + client dispatch; Cloudflare forwarding
     decision for resume/reattach.
   - **0C Manifest & admission:** manifest artifact schema; enforcement of
     `authorityIndependent`, `publicInline`, and the closed-inputs
     eligibility fact — including the codegen and served-manifest schema
     changes this model requires; the per-generation static
     dependency-summary artifact (rung-1 certifier); the
     authority-independent alias key / promotion rule for the client store.
   - **0D Bundle endpoint & connection ownership:** route-taxonomy entry
     with limits, modes, per-entry closed union, idempotency-key semantics,
     attach-grace/GC rules, `SNAPBACK_BUNDLE_*` failure codes; resume
     resource limits (token bytes, witness bytes, journal distance,
     CPU/time, per-authority rate) with per-cause refusal codes; the local
     arm's pinned-read-transaction affordance.
   - **0E Channel A mechanics:** safe HTML serializer (all string tokens
     incl. keys) with pinned fixture bytes; the local-arm serving seam (the
     LLP 0030 managed dev loop's `transformIndexHtml` integration and its
     ownership list, per D2); response-mechanics contract
     (`Content-Length`/`ETag`/compression/CSP/SPA fallback/`no-store`);
     failure posture (degrade to unhydrated shell) and the bounded anonymous
     evaluation budget.
   - **0F Corpus amendments (dated):** LLP 0008 — reconciling its
     online-reconnect-only resume scoping with this RFC's relaunch-from-disk
     widening (the pending-mutation and retention reasons behind 0008's rule
     are preserved by the outbox rule and the journal floor); LLP 0031 —
     the declared-public-application-data response-sensitivity class
     (Channel A HTML + read-mode public bundles, with the anonymous
     rate/budget posture) and the pending-registration owner for register
     mode (incl. the sender-key/nonce/grant-secret retry semantics, with
     "sender-key identity" and "credential incarnation" mapped to LLP
     0077's exact wire identities — the key thumbprint and sender replay
     epoch — rather than a parallel vocabulary), with acceptance proving
     socketless-HTTP-cannot-arm-demand still holds outside that closed
     operation; LLP 0034 — recording that token-resume still enters through
     a fresh `subscribe_live` and the token only seeds it, but that
     "snapshot-with-subscribe" becomes "maybe-`CurrentAsOf`-with-subscribe",
     a revision of the reconnect policy 0034 §2.4 ("Reconnect and
     lifecycle") governs.
1. Protocol: `resumeFromToken` on subscribe with the D1.3 ladder (rungs 1 and
   3 only) + token refresh on the live path + observability counters.
   Acceptance: rung-1 proof classes (global vs certified table-set with
   floor boundary tests; opaque-query negative fixture), atomic
   answer-and-register race tests, limit refusals per-cause coded, tokens
   refresh across `LiveDelta`/`LiveReplace`/`CurrentAsOf`.
2. Bundle endpoint (read + register modes) with single-commit evaluation on
   both arms. Acceptance: register mode produces no duplicate fresh
   snapshot; a mutation racing between bundle queries observes the
   single-commit cut on both arms; lost-response retry with the idempotency
   key returns the same registration set; two concurrent same-user boots of
   the same route produce distinct registration sets; a different sender key
   presenting a known idempotency key is refused; socket failure before
   attach and attach-deadline expiry reap cleanly; partial client
   installation does not strand server state; an anonymous caller
   requesting register mode is refused to read mode.
3. Channel A (public-inline manifest) on the local arm for **graffiti** (it
   has a durable live query; cursors-web is an ephemeral-room demo and only
   qualifies if it first gains one). Two stated prerequisites are part of
   this step's work: adopting the `snapback-vite` seam in graffiti (D2), and
   the demo's declarations themselves — its `listCells` query is currently
   `optional-user` with `authorityIndependent` unset, so declaring it
   public + `authorityIndependent` + `publicInline` is part of the step,
   not an assumed starting point. Acceptance: first paint renders inlined
   rows before any WebSocket frame; resume after no change answers
   `CurrentAsOf` with no full refetch; a manifest entry naming an undeclared
   (non-`authorityIndependent` **or** non-`publicInline`) query is refused at
   admission and the pageload degrades to the unhydrated shell; a logged-in
   browser consumes the anonymously minted preload via the alias key without
   a duplicate store or subscription; adversarial serializer fixtures
   byte-checked (values and property names); §Scalability gates recorded.
4. Channel A on the Cloudflare arm (manifest compiled into the Worker;
   gateway+coordinator composition and response mechanics per D2).
5. Channel B (web IndexedDB first under the Web-Lock store discipline, then
   native via DK-9), authority-independent queries only. Acceptance:
   relaunch renders persisted rows with wire showing only `CurrentAsOf` or
   rung-3 replacement; **relaunch after live deltas (not just after idle)
   resumes from the refreshed token without discarding persisted state**;
   replace-only query fixture takes rung 3 without error; relaunch after a
   permission change renders **no** stale auth-scoped rows; non-empty outbox
   takes the LLP 0043 path; storage reset rotates `versionStream` and the
   stale token is refused; digest-mismatched or corrupt persisted state fails
   closed; token persistence failure falls back to fresh subscribe; two tabs
   racing persistence respect the single-writer lock; a time-dependent
   (non-closed-inputs) query re-executes on relaunch instead of receiving
   `CurrentAsOf`; the existing LLP 0043/0053 lease-backed retained-display
   path is preserved unchanged; the store budget evicts
   least-recently-resumed entries at the cap.
   5a. **Rung-2 prerequisite:** membership witness format, reconciliation
   rule, size cap default, and the replay algorithm (Q7) — decided here, not
   in step 0.
6. Rung 2 (delta replay) per 5a. Acceptance: DK-3-eligible fixture resumes
   via deltas including predicate-exit rows; a multi-row held result where a
   strict subset changes mints a root that still contains the untouched
   rows' leaves (the accumulator-update rule); witness over the cap or with
   decode ambiguity refuses to rung 3; adversarial collision and
   hash-permutation fixtures never suppress a removal or admit a permuted
   witness.
7. Channel C reuse for authenticated web boot (register mode) and a
   widget-shaped demo surface (read mode).
