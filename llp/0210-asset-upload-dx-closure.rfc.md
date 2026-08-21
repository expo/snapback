# LLP 0210: Asset upload and delivery DX closure

**Type:** RFC
**Status:** Implemented
**Systems:** Assets, Client integration, React/Expo, Server, Diagnostics,
Code generation, Guide
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-09
**Revised:** 2026-08-21 (`useSnapbackAssetUrl` and its neutral issued-URL
store gain the nullable absence spelling and inert `empty` state; empty string
remains a named argument-contract error). 2026-08-16 (dated author amendment: omitted
`defineAssetUpload.delivery` now takes the `public-immutable` performance
default with a source-attributed advisory; the three-tier choice is made
explicit below). Prior: 2026-08-09, sixth same-day entry (D5(b) implemented on the
local target: admission-frozen grant opt-in, `agr_` system records,
commit-atomic lifecycle, read/invalidation/GC integration, 1,024-edge quota,
consistent-cut custody, typed diagnostics, and the primary guide recipe).
Prior, same day: fifth entry (**Accepted by the author**
— Charlie Cheever, in-session, after D1–D4 and the D5(a) recipe landed
on main; the acceptance covers the r4 revision with its unreviewed
delta disclosed, and green-lights D5(b) grant-ops implementation under
`issues/20260809-asset-recipient-grant-authority-g4.md`). Prior, same
day: (post-budget fix
revision, r4 — **UNREVIEWED delta**: applied codex round-3's 2 IN-DELTA
MATERIALs (authority-handoff disposal defined outside the state union +
full denied-exit/eviction fixture coverage; quota semantics with a
complete acceptance oracle) and both rounds' remaining DETAILs
(0114-linger eviction wording, snapshot-freeze scoping, typed
not-retryable refusal, admission-time frozen-generation wording,
revoke-vs-issuance oracle, migration-op routing to the G4 ticket). The
loop converged at r3 by the delta rule — no family reported a
PRE-EXISTING MATERIAL in rounds 2 or 3 — with round budget exhausted;
final verdicts bind to r3
(`21e33e4b87982317f06fc6f2a9436a2914f9bcb5a7781c8cfe1dcb3dd37e3d96`):
claude READY, gpt-5.6-sol NOT READY on in-delta completeness only. This
r4 delta is label-unreviewed per LLP 0010 §2; see the run journal's
final report). Prior, same day: (round-2 revision, r3 —
applied codex round-2's 5 IN-DELTA MATERIALs and claude round-2's 7
DETAILs: `issuing` defined + `denied` re-entry paths (D1), last-
unsubscribe fences in-flight issuance (D1), frozen terminal snapshots +
retry-successor semantics (D3), grant-transition commit atomicity and
frozen-generation `grants: true` capture (D5b), revoke-removes-edge,
quota/GC/sole-authority-composition constraints and recipe-fate notes
(D5); no family reported a PRE-EXISTING MATERIAL in round 2). Prior,
same day: (round-1 revision, r2 — applied
8 MATERIAL concerns from the dual-family round-1 reviews: neutral
issued-URL controller + complete hook state algebra (D1), authorization
precedes variant enumeration (D2), frozen raw-task terminal table (D3),
admit-where-safe mapping ruling (D4, adjudicating the round-1
cross-family contradiction), and grant identity/lifecycle/authorization
semantics with named G4 obligations (D5); see §Status and the run
journal). Prior, same day: (Draft → Review at super-refine loop start —
the loop's one authorized transition; author invoked /llp-super-refine
this session)
**Related:** LLP 0044 (asset pipeline — owns the pipeline; its 2026-08-09
dated addition commissions this design), LLP 0180 (asset-bearing commands
— its 2026-08-09 dated note commissions D4), LLP 0208 (Clique pilot gap
register — G11 + G4 asset slice), LLP 0193 (refusals-as-docs posture),
LLP 0107 (optimistic lifecycle), LLP 0114 (React projections), LLP 0012
(headless contract), LLP 0061 (guide),
`issues/20260809-asset-upload-dx-papercuts-g11.md`,
`issues/20260809-asset-recipient-grant-authority-g4.md`,
`issues/20260816-signed-delivery-cdn-posture.md`,
`issues/20260816-media-placeholder-projection.md`

## Summary

The LLP 0201 P2 pilot (Clique) proved the upload happy path — "three
lines; trusted finalization + variants just happened" — and priced the
edges: B5 = 62/100, with every point lost to surfaces the builder had to
discover by probing. This RFC specifies the closure as five design
items:

- **D1** — a client-arm signed-URL issuance method and a React
  TTL-refresh projection (implementing what LLP 0044 already promises);
- **D2** — issuance-body defaulting (`variant` → `primary`) and typed
  refusals replacing bare framework 422s on the issuance route;
- **D3** — a one-call `assets.upload()` convenience with a
  settle-or-reject contract, and `task.done` legibility;
- **D4** — the required-child → optional-argument command mapping is
  admitted (a command may narrow its mutation), and the remaining
  genuinely unsafe refusal teaches its fixes at the point of denial;
- **D5** — recipient-scoped asset authority: bless the grant-rows
  recipe now, adopt `ctx.assets.grant`/`ctx.assets.revoke` as the paved
  spelling (author ruling), defer app-bound sharing to the LLP 0208 G4
  membership program.

Acceptance of this RFC constitutes the author ruling LLP 0044's dated
addition leaves open (the D5 ladder); the corresponding dated
amendments in LLP 0044/0180 record the outcome, and implementation
proceeds under the G11 ticket.

### Dated amendment: public-immutable delivery default (2026-08-16)

**Author ruling (Charlie Cheever, 2026-08-16).** Most applications should take
the fast, no-issuance path for ordinary public media. On the explicit
`defineAssetUpload` surface, omitted `delivery` therefore defaults to
`{ kind: 'public-immutable' }`. This supersedes the earlier
`defineAssetUpload` omission default described by LLP 0044 while preserving
all three profiles' existing authorization, caching, and revocation semantics.
The separate bare-`v.assetRef()` derived intent remains private-strict; this
amendment does not silently change that convenience's security posture.

The choice is a guidance triad:

- **`public-immutable` — performance default.** Immutable bytes use
  unguessable, CDN-shaped URLs with no issuance round trip. It fits public feed
  media, avatars, product images, and other bytes that never require
  authorization or revocation after delivery.
- **`private-signed` — authorized per-user issuance.** Use it when reads must
  be authorized and a native renderer cannot attach bearer headers. Revocation
  stops new issuance; already-issued URLs retain their bounded TTL semantics.
- **`private-strict` — bearer-only, no signed URLs.** Every byte request
  reauthorizes, making it the tier for next-request revocation when the client
  can attach the bearer.

Omission stays non-fatal but visible. Codegen emits the source-attributed
`SNAPBACK_ASSET_DELIVERY_IMPLICIT_PUBLIC_IMMUTABLE` advisory with this text:
"delivery omitted; defaulting to public-immutable (performance default,
author ruling 2026-08-16) — declare `delivery` explicitly; use
private-signed/private-strict when reads must be authorized and revocable."
The closed delivery-kind assertion remains unchanged, and codegen still writes
an explicit delivery kind into every manifest. Consequently the Rust
`AssetUploadIntentDefinition.delivery` field remains required and has no
omission default of its own.

Two follow-ups bound what this default does not solve. Private signed delivery
still needs a hosted CDN/edge posture before scale claims
(`issues/20260816-signed-delivery-cdn-posture.md`), and projecting admission-time
placeholders could hide private-tier issuance latency without weakening
authorization (`issues/20260816-media-placeholder-projection.md`).

## Evidence

All five items trace to the pilot record
(`/Users/ccheever/clique-runs/p2-pilot/snapback-lane/`; lands under
`benchmarks/records/` at P2 close-out) and are registered in LLP 0208.
The concrete moments:

- The builder hand-rolled `POST /assets/records/{id}/signed-url` with
  bearer + `x-snapback-auth-client-protocol: 1` (discovered by probing;
  no SDK method exists — the shipped client has only `deliveryUrl()`
  URL construction) and then hand-built a 30-second URL cache.
- The issuance body `{}` died as an undiagnosed framework 422 because
  `AssetSignedUrlIssueRequestV1.variant` is a required field; the
  builder guessed `{"variant":"primary"}`.
- Every app-side upload flowed through a hand-written
  `uploadPicked()`: picker URI → `fetch` → blob → `new File` →
  `assets.start` → await `task.done` → a defensive status maze
  (`ready`/`finalized`/`failed`/`rejected`) because the settle contract
  was not legible at the call site.
- A non-optional command asset child over an optional mutation argument
  refused with a message naming the rule but not the
  `optional: true` escape LLP 0180 already admits; the builder derived
  the escape unaided.
- Per-recipient media authority (chat attachments, view-once) was
  composed by hand as owner-principal grant rows; `ctx.assets.attach`'s
  owner-only rule (`SNAPBACK_ASSET_FORBIDDEN`) forced view-once to
  transfer authority by patching the grant row's viewer principal at
  open. It survived every hostile probe (403 before open, 200 during,
  403 after close) in ~80 lines — sound composition, unpaved spelling.

## Design

### D1 — Client-arm signed issuance and TTL-refresh projection

LLP 0044 §Delivery profiles (`private-signed`) states "the generated
client refreshes it before expiry"; §Client upload surface promises
renderer-level "automatic refresh of bounded signed delivery URLs
before expiry." Neither shipped. This item is owed implementation with
one new surface decision: the method shape.

**Framework-neutral client.** `SnapbackAssetClient` (which already owns
custody-correct headers for both AuthCoordinator and external-bearer
custody) gains:

```ts
const issued = await assets.signedUrl(assetId, {
  variant?: string,   // default: 'primary' (D2)
  widthPx?: number,   // supersedes variant, exactly as the route does today
  ttlMs?: number,     // bounded by the declared maximum
})
// → { url: string, expiresAt: number, variant: string }
```

- The returned `url` is absolute (the client resolves a relative
  issuance response against its own base URL — the pilot had to do this
  by hand).
- Issuance rides the client's existing transport/custody posture: the
  auth-client protocol offer and bearer exactly as every other asset
  route. The *issued* URL remains the pasteable lane (LLP 0044's
  2026-07-31 dated note); the issuance route keeps protocol
  discipline. No new authority semantics.
- The client does not silently cache issued URLs. Caching/refresh
  policy belongs to the projection layer (below); the neutral method is
  a pure authorized issuance. Rationale: a hidden cache would make
  revocation-latency reasoning depend on client internals, and
  `expiresAt` gives callers everything a cache needs.

**Framework-neutral issued-URL store.** Refresh is not React-owned: per
LLP 0044 ("projections over the framework-neutral asset client and live
store, not a React-specific transport, cache, or auth model") and LLP
0114's external-store discipline, the neutral asset client gains an
**issued-URL controller**: a keyed store (`assetId` + issuance options,
partitioned by the same app and authority identity as the persisted
task facts — covering both custody modes) that owns the issued URL, its
`expiresAt` timer, refresh-before-expiry, bounded retry, and diagnostic
state. Equal keys share one entry — N consumers of one asset drive one
issuance loop, not N (the pilot's resubscribe-storm lesson). Authority
replacement or logout synchronously blanks every entry of the old
authority and generation-fences late issuance responses. **Final
unsubscribe** cancels the timer *and* generation-fences any issuance
already in flight — a late response neither publishes nor schedules
further work — and the entry is then evicted per LLP 0114's
linger/eviction discipline (the fence is synchronous; eviction timing
is 0114's, so a Strict-Mode remount reattaches instead of restarting
the issuance). Fixtures: unsubscribe before an in-flight issuance
resolves proves zero residual work *and* asserts the entry's absence
from the registry after eviction; resubscription after eviction gets a
fresh generation.

**React/Expo projection.** `useSnapbackAssetUrl(assetIdOrNull, { variant?,
widthPx? })`, where `assetIdOrNull` is `string | null | undefined`, subscribes
to that store — a named LLP 0114 projection
(ledger entry recorded on acceptance):

```ts
const { url, status, diagnostic } = useSnapbackAssetUrl(assetIdOrNull, opts)
// status: 'empty' | 'issuing' | 'ready' | 'refreshing' | 'unavailable' | 'denied'
```

State algebra (normative; fixtures pin each transition):

- `empty` — `assetIdOrNull` is `null` or `undefined`. The neutral client
  returns one inert singleton synchronously: `url`, `diagnostic`, `expiresAt`,
  and `rendition` are `null`; subscribe and `refresh()` perform no issuance,
  authority capture, timer, retry, or registry work. Empty string is not this
  state; it throws an argument-contract error naming the nullable spelling.
- `issuing` — an issuance is in flight and no valid URL is held: the
  initial issuance and the expired-URL re-issuance case alike.
- `ready` — `url` is issued and unexpired. A failed refresh attempt
  does **not** leave `ready` while the held URL is still valid; retry
  continues and `diagnostic` carries the last failure.
- `refreshing` — re-issuance in flight with the held URL still valid.
- `unavailable` — no valid URL is held and the last issuance failed
  for a **non-authorization** reason (transport, server error); `url`
  is `null`, `diagnostic` is the last failure, bounded retry continues
  (re-entering `issuing` per attempt). Offline blips land here, never
  in `denied`.
- `denied` — entered **only** on a structured authorization refusal;
  `url` blanks immediately (authority loss does not wait for TTL) and
  timer-driven retry stops.

Every reachable **entry** condition maps to exactly one state. The `empty`
singleton is outside authority partitions, so authority replacement leaves its
snapshot stable; changing absent → present creates ordinary demand, and changing
present → absent detaches that demand and returns to the same inert state.
Authority replacement and logout are not states: they **dispose** the
old authority's entries (LLP 0114's handoff discipline — the blanked
entry is removed, never republished), and the successor authority's
first demand creates a fresh entry entering `issuing`. **Exit from
`denied`:** timer retry stops, but authorization can return under the
same authority (a D5 grant activated, a member re-added), so the
controller re-enters `issuing` on either **guaranteed** trigger — a
fresh subscription to the key, or an explicit `refresh()` affordance —
and, best-effort, on a witnessed authorization-invalidation signal when
the controller composes with the asset-record live store (a denied
viewer may hold no live subscription, so the signal is never the only
exit). Fixtures pin the full loop both ways and both guaranteed
triggers: pending-grant `denied` → activation → `refresh()` → `ready`;
the same recovery via unsubscribe + fresh subscription; and `ready` →
revocation → next refresh `denied`.

The existing asset renderer surface (LLP 0044 §Client upload surface)
composes the same store rather than duplicating refresh logic.

**Headless contract.** The method is part of the LLP 0012 language-
neutral protocol surface: the issuance request/response DTO shapes are
already normative; this adds the client obligation (custody headers,
absolute-URL resolution, `expiresAt` propagation) to the contract so
non-JS arms implement the same method, not a lookalike.

### D2 — Issuance defaults and typed refusals

`AssetSignedUrlIssueRequestV1.variant` becomes optional:

- Absent `variant`, absent `widthPx` → `primary`.
- `widthPx` present → ladder issuance, superseding `variant` (unchanged).
- Unknown `variant` → `SNAPBACK_ASSET_VARIANT_UNKNOWN` (or the
  registry-reconciled equivalent), whose details enumerate the intent's
  declared variant keys plus `primary`. Refusals-as-docs (LLP 0193): the
  denial is the documentation.
- A body that fails to parse refuses with a typed
  `SNAPBACK_ASSET_REQUEST_INVALID`-class diagnostic naming the field,
  never a bare framework 422. An absent/empty body is a valid request
  meaning "primary, default TTL."
- **Authorization precedes enumeration.** Order: parse generically →
  authorize the caller for issuance under the asset's declared read
  policy → only then validate the variant. An unauthorized caller
  receives the ordinary access denial with no variant details, for an
  existing and a nonexistent asset indistinguishably — variant sets are
  asset metadata and LLP 0044 grants no metadata authority to bare
  possession of an id.

`ttlMs` validation is unchanged (`SNAPBACK_ASSET_TTL_INVALID`). No
change to signing, aliasing, or authorization semantics — D2 is
strictly the request-shape contract.

### D3 — `assets.upload()` and the `task.done` contract

`assets.start()` remains the task-level surface and the only place
pause/resume/retry/progress live. Above it, one convenience:

```ts
const assetId = await assets.upload(uploadRef, source, { args? })
```

- `source` accepts what the platform adapters already normalize (LLP
  0180 §Input and platform adapters): `File`, `Blob`, or picker-shaped
  `{ uri, mimeType?, fileName? }`. On native, URI normalization uses the
  existing adapter seam — the helper adds no new platform surface.
- Resolves with the `assetId` when the asset task reaches `ready`.
- Rejects on **every** other terminal status, carrying the task's
  structured diagnostic (and the terminal status) on the error.
- No partial-success lane: callers who need pause/resume/progress use
  `start()`.

**The raw asset-task terminal table, frozen.** The shipped client's
terminal set is `ready | rejected | cancelled | failed` — nothing else;
in particular there is **no** `finalized` status (the pilot's defensive
`finalized` branch guarded a state that does not exist, which is itself
the legibility finding). This RFC freezes that table as the raw
`AssetTask` settlement contract, distinct from `CommandTask.done`
(which settles a `CommandOutcome`, LLP 0180 §Command task — the two
`done`s are documented side by side): `task.done` resolves with the
snapshot at the **first** terminal status; `ready` is the only success;
`rejected`/`cancelled`/`failed` each carry their structured diagnostic.

**Terminal snapshots are frozen and `retry()` returns a successor.**
The settled snapshot and the `.done` value never mutate
(post-settlement asset and rendition facts — optional renditions
publishing after `ready` — belong to the live store and renderer
surface, not the settled task). An **eligible** `retry()` follows LLP
0044's successor-attempt rule (a new upload attempt for the **same
asset id**) and yields a new task generation with its own independent
`.done`; the predecessor's settled snapshot and promise are unchanged.
Retry eligibility per terminal row: `ready` — never (a published asset
admits no further attempts); `rejected` — never (durably rejected);
`failed` / `cancelled` — eligible while the underlying asset remains
`pending`-eligible. An **ineligible** `retry()` creates no successor
and refuses with a typed not-retryable diagnostic (registry-reconciled
spelling, OQ2) — never a bare error a caller could read as an ordinary
failure. Predecessor/successor settlement and the ineligible refusal
are fixture-tested alongside the table rows.

`upload()` is defined mechanically over this table (resolve on `ready`,
reject on each of the other three; it never retries) and is the
recommended spelling wherever an app only wants the id; every row is
fixture-tested.

### D4 — The mapping is admitted where safe; the remaining refusal teaches

Two halves (commissioned by LLP 0180's 2026-08-09 dated note, which
left teach-or-admit open):

1. **Admit.** The required-child → optional-`v.assetRef`-argument
   pairing is **admitted** when intent compatibility holds. The
   generated command derives a *required* command input and always
   populates the optional mutation argument — a command is a narrower
   client entry point over a more general mutation, and narrowing is
   ordinary: the mutation's own contract is untouched (other callers
   keep the text-only branch; the handler still cannot rely on
   presence — descriptor requiredness is a client-authoring guarantee
   enforced by generation and client-side validation, never a server
   contract). This is the shape the pilot actually wanted (a dedicated
   `sendPhoto` command guaranteeing its asset over a shared
   image-or-video mutation) and what the pilot's `optional: true` +
   handler-validation workaround approximated with a weaker authored
   contract. Fixtures: the mutation remains directly callable without
   the argument; the command is not.
2. **Teach.** The genuinely unsafe inverse — an `optional: true` child
   over a *required* mutation argument (the text-only branch would call
   a mutation missing a required input) — stays refused, and
   `SNAPBACK_COMMAND_ASSET_MAPPING_INCOMPATIBLE`'s message/details name
   the two fixes at the point of refusal: make the child required, or
   the argument optional. Generate-time refusals with file/line/column
   are the platform's best surface (both pilot sessions said so); this
   refusal joins that standard.

### D5 — Recipient-scoped authority: recipe now, grant ops as the paved spelling

The ladder from LLP 0044's dated addition, resolved:

- **(a) — adopted, immediate.** The grant-rows + transfer-at-open
  pattern becomes a CI-verified guide recipe (with the view-once
  variant), credited as the pilot-proven composition. This lands with
  the G11 guide work regardless of (b)'s implementation timing. When
  (b) ships, the recipe page makes the grant-ops spelling primary and
  keeps the row composition as the portable fallback.
- **(b) — adopted as design.** First-class grant edges with explicit
  lifecycle, identity, and authorization:

  ```ts
  const { grantId } = await ctx.assets.grant(assetId, principal, {
    state?: 'active' | 'pending',   // default 'active'
  })
  await ctx.assets.activate(grantId)   // pending → active
  await ctx.assets.revoke(grantId)     // one edge, by identity
  ```

  A grant is a **system record** (not an app row): `{ grantId, assetId,
  principal, state: 'pending' | 'active', provenance: { mintedBy,
  mutation, at } }`. Only `active` edges confer read authority; effective
  read authority is the asset's declared policy **or** an active
  eligible grant. `revoke` **removes** the edge — there is no `revoked`
  terminal state; the transition receipts are the durable audit
  evidence, and a later `activate`/`revoke` on the removed `grantId`
  refuses with a typed unknown-grant diagnostic. Grant edges are
  admitted only for assets whose upload intent opts in (`grants: true`
  on the intent declaration; exact spelling reconciled with LLP 0007's
  vocabulary at implementation), and **grant eligibility is captured at
  asset admission** in the frozen intent-policy generation the asset
  records (LLP 0044 §Internal model); finalization and every later
  grant operation read that stored generation. An asset admitted before
  the opt-in refuses mint after a redeploy — existing `owner-only` and
  `via-references` assets gain no authority path retroactively; a
  migration op for old assets, if ever wanted, is G4-ticket-owned
  operator work under LLP 0044's generation vocabulary, not part of
  this design.

  **Atomicity.** `grant`/`activate`/`revoke` are staged in the calling
  mutation and commit atomically with its app-row writes, with their
  authorization and state preconditions revalidated under the final
  write lock — mirroring LLP 0044 §Typed references and atomic
  attachment. An aborted `send()` leaves no pending edge, an aborted
  `open()` activates nothing, and activate-versus-owner-revoke and
  revoke-versus-issuance races settle under the same commit discipline;
  each is fixture-tested, along with rollback and idempotent re-run.
  The revoke-versus-issuance oracle is exact: revoke committed first
  denies issuance; issuance committed first may return a TTL-bounded
  URL (unchanged `private-signed` semantics); no execution authorizes
  from a stale post-revoke edge.

  **Quota semantics.** Grant-count ceilings (per app, charged to the
  minting owner — the only principal who can create the records) count
  `pending` and `active` edges together; the ceiling is checked
  atomically with mint and refuses with a typed quota diagnostic
  (registry-reconciled, OQ2); revoke releases the count atomically with
  its commit. Fixtures: at-limit mint succeeds, over-limit refuses
  typed, concurrent mints at the boundary admit exactly one, and
  revoke-then-remint succeeds.

  Authorization rules (closed, v1): **mint** requires caller = asset
  owner (the same rule `attach` enforces); **activate** requires
  caller = the grant's principal and state `pending`; **revoke**
  requires caller = owner or caller = the grant's principal
  (self-revoke). Every `active` edge therefore traces to an owner mint
  — the honest no-ambient-widening statement (a viewer can *accept and
  relinquish* authority the owner minted, never originate it).

  View-once becomes fully expressible with no field-patch idiom: mint
  `pending` per recipient at send (confers nothing), the viewer's
  `open()` activates its own grant, `close()` self-revokes — exactly
  the pilot's 403 / 200 / 403 probe sequence. The 403-before-open
  guarantee holds only when the grant edge is the **sole** authority
  path: view-once composes `grants: true` with an `owner-only` policy
  (a `via-references` policy reachable from a recipient-visible row
  would admit the viewer regardless), and because `pending` edges do
  not protect the asset from reference GC, the view-once shape keeps a
  typed reverse reference (the message row's `assetRef`) or another
  declared retention basis alive through the pending window — the
  recipe pins both constraints, with a fixture activating after the GC
  grace boundary. Revoke-by-identity keeps overlapping authority
  independent: two grants on one asset, revoking one, leaves the
  other's access intact. Delivery consequences are unchanged
  (`private-strict` denies on the next request; `private-signed` stops
  new issuance, TTL semantics unchanged).

  Grant edges join the read-authorization witness as declared edges
  (LLP 0044 §Asset read authorization), and the G4 ticket carries four
  named obligations the dated 0044 amendment must record: the LLP 0053
  invalidation projection for grant edges (revoke blanks live asset
  metadata); the storage locus (system records, exported/imported with
  the asset component of a consistent cut); reference-GC interaction
  (an `active` grant edge protects the asset like a typed
  reverse-reference; `pending` edges do not); and per-app/per-principal
  grant-count ceilings under LLP 0044's quota regime (per-recipient
  minting at send is exactly the unbounded-record-class workload the
  quota rules exist for). Implementation is commissioned under the G4
  ticket after this RFC's acceptance; the recipe (a) is the supported
  path until it ships.
- **(c) — deferred.** `assetSharing` binding to app-declared
  tables/predicates moves with the LLP 0208 G4 membership program
  (roster projection and friends), so asset sharing and product rosters
  evolve together rather than forking two app-binding designs.

### Guide obligations (cross-cutting)

One page-section per LLP 0061 conventions, CI-verified: issuance body +
custody headers by mode; variant selection and `widthPx`; TTL/refresh
guidance pointing at the D1 store/hook; `assets.upload()` and the frozen
`task.done` settlement table (a snippet showing both the resolve and
reject paths); the command child-optionality patterns (both D4
directions); the D5(a) recipe; and the assets capability-index rows
updated (the "deliver access-controlled media" row stops being a GAP
when D1 lands; the helper and settlement table get their own row).

## Non-goals

- New delivery profiles, signing mechanics, or revocation semantics
  (D1/D2 change request shape and client surface only).
- Reopening the 2026-07-31 bounded-array withdrawal (multi-image
  steering is `issues/20260809-multi-image-authoring-revisit-g8.md`).
- Background/process-death upload custody (LLP 0180 deferred
  extensions).
- Viewer-*originated* authority — (b)'s closed rules let a principal
  accept (`activate`) or relinquish (`revoke`) authority the owner
  minted, never originate it; widening the granter set is a future
  intent-policy decision (OQ3).

## Acceptance

- D1: `assets.signedUrl` on the framework-neutral client, custody
  matrix covered (AuthCoordinator + external bearer); issued-URL store
  fixtures: refresh-before-expiry, same-key subscriber sharing (one
  loop for N consumers), authority A→B synchronous blanking with
  late-response fencing, final-unsubscribe timer cleanup; state-algebra
  negatives: transient issuance failure ≠ `denied`, expiry without
  refresh → `unavailable`, `denied` only on structured authorization
  refusal; `denied` re-entry via **both** guaranteed triggers
  (`refresh()`, and unsubscribe + fresh subscription) and its inverse
  (`ready` → revocation → `denied`); authority A→B and logout dispose
  the old entries (asserted absent) and the successor authority's
  demand starts a fresh `issuing` entry; unsubscribe before an
  in-flight issuance resolves proves zero residual work and the entry
  is absent post-eviction, with resubscription getting a fresh
  generation; headless-contract fixtures for the DTO obligations; the
  LLP 0114 named-projection ledger entry recorded.
- D2: empty-body issuance returns a primary-variant URL; unknown
  variant returns the typed enumeration refusal; no issuance-route
  request shape can produce a bare framework 422; authorization
  precedence negatives — unauthorized caller × {existing, nonexistent
  asset} × unknown variant all yield the indistinguishable ordinary
  denial with no variant details.
- D3: every row of the frozen terminal table fixture-tested through
  both `task.done` and `upload()` (resolve on `ready`; reject with the
  structured diagnostic on `rejected`/`cancelled`/`failed`); retry
  successor fixtures (settled predecessor `.done` unchanged, successor
  generation independent, per-terminal eligibility rows);
  picker-shaped source accepted on the Expo fixture.
- D4: codegen fixtures — required child over optional argument
  generates the required command input and the mutation stays directly
  callable without it; optional child over required argument refuses
  with the teaching message (both fix pointers pinned).
- D5: recipe lands CI-verified; grant ops (when implemented) reproduce
  the pilot's hostile-probe sequence (403 pending, 200 active, 403
  after self-revoke), plus: unauthorized mint/activate/revoke refuse;
  activate by a non-principal refuses; two independent grants on one
  asset survive one revoke; strict delivery denies on the request after
  the final revoke; signed issuance stops post-revoke within TTL
  semantics; transitions commit-atomically (aborted mutation leaves no
  edge; activate-vs-owner-revoke and revoke-vs-issuance races;
  idempotent re-run); a pre-opt-in asset refuses mint after redeploy;
  operations on a removed `grantId` refuse with the typed
  unknown-grant diagnostic; quota rows (at-limit success, over-limit
  typed refusal, concurrent-mint boundary admits exactly one,
  revoke-then-remint); view-once pending-window retention
  (activation after the GC grace boundary).
- Each landing carries scoped evidence per LLP 0189; no claim binds to
  a complete proof at an exact commit.

## Open questions

1. **D1 caching** — *resolved by the round-1 revision:* the issued-URL
   controller **is** the framework-neutral cache/refresh surface;
   non-React consumers use it directly, and bare `signedUrl()` stays
   pure for callers who want no caching.
2. **D2 code names:** reconcile `SNAPBACK_ASSET_VARIANT_UNKNOWN` /
   `SNAPBACK_ASSET_REQUEST_INVALID` against the diagnostics registry at
   implementation time (registry owns final spellings).
3. **D5(b) granter set:** v1 is closed at owner-mint +
   principal-self-activate/self-revoke; should the intent policy later
   name additional granter rules (e.g. "any current grantee may
   re-grant")? Deferred, but `grantId`-shaped ops do not preclude it.
4. **D1 retry policy:** the store's bounded-retry parameters (backoff,
   cap) — implementation-owned, but the fixtures should pin that retry
   *continues* in `unavailable` and stops in `denied`.

## Status

Implemented (2026-08-09). D1–D4 and the D5(a) recipe landed before author
acceptance; D5(b) now ships on the local target with the grant lifecycle,
frozen opt-in, commit discipline, read/invalidation/GC behavior, quota, cut
custody, diagnostics, and guide obligations specified above. Draft → Review at
super-refine loop start, 2026-08-09.
Authored from the LLP 0208 register (G11 + G4 asset slice) at author
direction. Round-1 revision (same day) applied both families' MATERIAL
concerns: the issued-URL controller replaces hook-owned refresh with a
complete state algebra; D2 gains authorization-precedes-enumeration;
D3 freezes the raw terminal table (`ready | rejected | cancelled |
failed`, no `finalized`); D4 flips to admit-where-safe (the round-1
cross-family contradiction, adjudicated by the reviser — the run
journal records both positions); D5(b) gains grant identity, lifecycle
(`pending`/`active`), closed authorization rules, and named G4-ticket
obligations. On acceptance: LLP 0044/0180 receive dated amendments
recording the rulings (D4, D5) and LLP 0114 gains the
`useSnapbackAssetUrl` named-projection ledger entry; implementation
proceeds under `issues/20260809-asset-upload-dx-papercuts-g11.md` and
`issues/20260809-asset-recipient-grant-authority-g4.md`.
