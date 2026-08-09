# LLP 0210: Asset upload and delivery DX closure

**Type:** RFC
**Status:** Draft
**Systems:** Assets, Client integration, React/Expo, Server, Diagnostics,
Code generation, Guide
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-09
**Revised:** 2026-08-09 (initial draft)
**Related:** LLP 0044 (asset pipeline — owns the pipeline; its 2026-08-09
dated addition commissions this design), LLP 0180 (asset-bearing commands
— its 2026-08-09 dated note commissions D4), LLP 0208 (Clique pilot gap
register — G11 + G4 asset slice), LLP 0193 (refusals-as-docs posture),
LLP 0107 (optimistic lifecycle), LLP 0114 (React projections), LLP 0012
(headless contract), LLP 0061 (guide),
`issues/20260809-asset-upload-dx-papercuts-g11.md`,
`issues/20260809-asset-recipient-grant-authority-g4.md`

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
- **D4** — the `SNAPBACK_COMMAND_ASSET_MAPPING_INCOMPATIBLE` refusal
  teaches the `optional: true` escape, and the required-child →
  optional-argument pairing gets a teach-or-admit resolution;
- **D5** — recipient-scoped asset authority: bless the grant-rows
  recipe now, adopt `ctx.assets.grant`/`ctx.assets.revoke` as the paved
  spelling (author ruling), defer app-bound sharing to the LLP 0208 G4
  membership program.

Acceptance of this RFC constitutes the author ruling LLP 0044's dated
addition leaves open (the D5 ladder); the corresponding dated
amendments in LLP 0044/0180 record the outcome, and implementation
proceeds under the G11 ticket.

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

**React/Expo projection.** A hook owning the refresh loop per LLP 0114's
provider rules:

```ts
const { url, status } = useSnapbackAssetUrl(assetId, {
  variant?, widthPx?,
})
// status: 'issuing' | 'ready' | 'refreshing' | 'denied'
```

- Re-issues before `expiresAt` while mounted; drops to `denied` with the
  structured diagnostic when issuance refuses (revocation surfaces as
  the next refresh failing — apps render the denial state instead of a
  broken `<img>`).
- Provider replacement / logout invalidates held URLs immediately
  (authority-follows-provider, LLP 0114 discipline).
- The existing asset renderer surface (LLP 0044 §Client upload surface)
  composes this hook rather than duplicating refresh logic.

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
- Resolves with the finalized `assetId` when the asset reaches `ready`.
- Rejects on **every** other terminal outcome, carrying the task's
  structured diagnostic (and the terminal status) on the error.
- No partial-success lane: callers who need pause/resume/progress use
  `start()`.

**`task.done` legibility.** The task contract already settles `done` at
terminal status (LLP 0180's terminal-state transitions). What the pilot
shows is that the *call site* cannot tell which statuses are terminal
successes. The docs obligation: the task API reference states the settle
rule in one sentence at `done`'s definition ("resolves at the first
terminal status; `ready` is the only success"), and `upload()` is the
recommended spelling wherever an app only wants the id.

### D4 — The mapping refusal teaches; required-over-optional is ruled

Two halves (commissioned by LLP 0180's 2026-08-09 dated note):

1. **Teach.** `SNAPBACK_COMMAND_ASSET_MAPPING_INCOMPATIBLE`, when the
   incompatibility is a non-optional asset child over an
   `v.optional(v.assetRef(...))` mutation argument, appends the escape
   to its message/details: declare the child `optional: true` (admitted
   by LLP 0180 §Declaration) and validate presence in the handler.
   Generate-time refusals with file/line/column are the platform's best
   surface (both pilot sessions said so); this refusal joins that
   standard.
2. **Rule.** The required-child → optional-argument pairing stays
   **refused** in v1. Rationale: a required child asserts "this command
   always carries the asset," but the optional argument leaves the
   text-only branch open to every *other* caller of the mutation — the
   declared contracts would disagree about whether absence is a
   representable state, and the command descriptor is the wrong place
   to narrow a mutation's argument contract. The refusal's diagnostic
   states this rationale (one sentence) alongside the two fixes:
   make the argument required (if absence is truly impossible) or the
   child optional (if it is not). This is the teach-or-admit
   resolution: teach, with the reason on the refusal.

### D5 — Recipient-scoped authority: recipe now, grant ops as the paved spelling

The ladder from LLP 0044's dated addition, resolved:

- **(a) — adopted, immediate.** The grant-rows + transfer-at-open
  pattern becomes a CI-verified guide recipe (with the view-once
  variant), credited as the pilot-proven composition. This lands with
  the G11 guide work regardless of (b)'s implementation timing.
- **(b) — adopted as design.** Handler ops make authority transfer
  explicit and auditable:

  ```ts
  await ctx.assets.grant(assetId, principal, { via?: intentName })
  await ctx.assets.revoke(assetId, principal)
  ```

  Semantics: a grant is a first-class authority edge from asset to
  principal, created only by a handler whose caller the asset's intent
  policy admits as a granter (v1: the owner — the same rule `attach`
  enforces today, so (b) widens no authority). Revoke removes the edge;
  `private-strict` denies on the next request, `private-signed` stops
  new issuance (TTL semantics unchanged). View-once becomes
  grant-at-open / revoke-at-close with no field-patch idiom. Grants are
  visible to the read-authorization witness (LLP 0044 §Asset read
  authorization) as declared edges, not row-predicate side effects.
  Implementation is commissioned under the G4 ticket after this RFC's
  acceptance; the recipe (a) is the supported path until it ships.
- **(c) — deferred.** `assetSharing` binding to app-declared
  tables/predicates moves with the LLP 0208 G4 membership program
  (roster projection and friends), so asset sharing and product rosters
  evolve together rather than forking two app-binding designs.

### Guide obligations (cross-cutting)

One page-section per LLP 0061 conventions, CI-verified: issuance body +
custody headers by mode; variant selection and `widthPx`; TTL/refresh
guidance pointing at the D1 hook; the `optional: true` command pattern;
the D5(a) recipe; and the assets capability-index rows updated (the
"deliver access-controlled media" row stops being a GAP when D1 lands).

## Non-goals

- New delivery profiles, signing mechanics, or revocation semantics
  (D1/D2 change request shape and client surface only).
- Reopening the 2026-07-31 bounded-array withdrawal (multi-image
  steering is `issues/20260809-multi-image-authoring-revisit-g8.md`).
- Background/process-death upload custody (LLP 0180 deferred
  extensions).
- Anonymous or viewer-minted grants — (b) keeps the owner-as-granter
  rule; widening granters is a future intent-policy decision.

## Acceptance

- D1: `assets.signedUrl` on the framework-neutral client, custody
  matrix covered (AuthCoordinator + external bearer) in acceptance
  tests; `useSnapbackAssetUrl` refresh-before-expiry and denial-state
  fixtures; headless-contract fixtures for the DTO obligations.
- D2: empty-body issuance returns a primary-variant URL; unknown
  variant returns the typed enumeration refusal; no issuance-route
  request shape can produce a bare framework 422 (negative fixture).
- D3: `upload()` resolves `ready` → id; rejects each non-ready terminal
  with the structured diagnostic; picker-shaped source accepted on the
  Expo fixture.
- D4: the optional-argument incompatibility message names
  `optional: true`; the required-over-optional refusal carries its
  rationale sentence; codegen fixtures pin both texts.
- D5: recipe lands CI-verified; grant/revoke ops (when implemented)
  reproduce the pilot's hostile-probe sequence (403 before open, 200
  during, 403 after close) as acceptance fixtures.
- Each landing carries scoped evidence per LLP 0189; no claim binds to
  a complete proof at an exact commit.

## Open questions

1. **D1 caching:** is projection-layer-only caching right, or should the
   neutral client offer an opt-in issued-URL cache (bounded by
   `expiresAt`) for non-React consumers?
2. **D2 code names:** reconcile `SNAPBACK_ASSET_VARIANT_UNKNOWN` /
   `SNAPBACK_ASSET_REQUEST_INVALID` against the diagnostics registry at
   implementation time (registry owns final spellings).
3. **D5(b) granter set:** v1 keeps owner-as-granter; should the intent
   policy later be able to name additional granter roles (e.g. "any
   current grantee may re-grant")? Deferred, but the ops' signature
   should not preclude it.

## Status

Draft. Authored 2026-08-09 from the LLP 0208 register (G11 + G4 asset
slice) at author direction; enters super-refine with the review focus on
D1–D5. On acceptance: LLP 0044/0180 receive dated amendments recording
the rulings (D4.2, D5), and implementation proceeds under
`issues/20260809-asset-upload-dx-papercuts-g11.md` and
`issues/20260809-asset-recipient-grant-authority-g4.md`.
