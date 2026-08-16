# Finish the media happy path: bounded collections and atomic media commands

**Filed:** 2026-08-15 · **Status:** Open · **Systems:** Assets, Schema,
Code generation, Runtime, Client integration, React, Expo, Guide, Testing

**Owner:** LLP 0239 rollout R3/R4

**Related:** LLP 0044, LLP 0180, LLP 0210, LLP 0220, LLP 0239, LLP 0244,
LLP 0253; Diary 0079 (Clique Familiar), Diary 0081 (Clique simplified),
Diary 0083 (Clique explicit); `guide/backend/media-happy-paths.md`;
`guide/capabilities.md`

## Problem

Snapback's low-level asset system is already capable: it owns resumable upload,
trusted image/video finalization, typed attachment, signed delivery and refresh,
recipient grants, revocation, GC, and consistent-cut custody. The shipped
`v.media()` / `MediaRef` slice also makes a zero-or-one media field project
truthfully from an authoritative storage snapshot.

The remaining author-facing media surface is incomplete:

1. `assets.media-collection.v1` is still design-only. Authors who need an
   ordered one-to-many relation must build and synchronize an application child
   table, or fall into `image1`...`imageN`, JSON, or data-URL workarounds.
2. `assets.media-command.v1` is still design-only. The existing LLP 0180
   `defineCommand` composes zero or one asset with one ordinary mutation, but it
   does not own bounded multi-upload, generated collection membership, or the
   server-recognized binding that atomically stages the parent, collection
   rows, attachments, and grants.

The Clique 0.1.21 lanes made the cost concrete. Familiar used bounded data URLs
for avatars and split a tiny video fixture across ordinary fields; the explicit
lane kept tiny fixture media as data URLs rather than introducing the full raw
pipeline; the simplified lane used real image/MP4 admission but retained
explicit admission and attachment functions. LLP 0253 has since fixed Familiar
top-level video-intent naming (`media.videoUpload` / `api.media.videoUpload`),
so intent discovery is no longer the blocker. Application-shaped composition
is.

## Governing design

This work does **not** need a new LLP. Implement the already Accepted decisions:

- LLP 0239 D2: `assetCollection` is an ordered, bounded, generated relation;
- LLP 0239 D3: `defineMediaCommand` is the closed multi-upload specialization
  of LLP 0180's command, with the ordinary mutation host as sole application
  commit owner;
- LLP 0239 D4: sharing plans select only already-admitted grant/authority
  operations and are reauthorized at commit time;
- LLP 0239 D5: collection rendering reuses the shared issued-URL controller;
- LLP 0244: every collection item inherits finalized-only `MediaRef` projection
  and exact settlement behavior; and
- LLP 0180: retry, cancellation, ambiguity, successor-task, and residue facts
  remain visible rather than being flattened into a promise.

If implementation requires changing collection identity, bounds, ordering,
duplicate handling, commit ownership, retry identity, or grant authority,
amend/re-review LLP 0239 before shipping the deviation. Do not silently invent
new semantics in code.

## Scope A — `assetCollection` (LLP 0239 R3)

- Add the schema/codegen declaration with required `maxItems` in the accepted
  1-32 range, `manual` or `created` ordering, admitted media kinds, intent, and
  sharing ceiling.
- Lower it to framework-owned bounded child records carrying parent id, asset
  id, stable item id, ordinal, kind, and policy generation. Do not put asset
  references inside opaque JSON.
- Generate `append`, `replace`, `remove`, and `reorder` operations. Enforce the
  count bound, finalized intent/kind compatibility, duplicate refusal, parent
  authority, attachment lifecycle, and selected sharing plan atomically.
- Implement LLP 0239's non-reused stable item identity and retry-deterministic
  allocation rules. Preserve ids for retained/reordered items.
- Return exact ordered `MediaRef` items with stable item metadata and bounded
  paging where required.
- Include the generated records in authorization invalidation, reference GC,
  quota accounting, migration/version identity, and consistent-cut
  export/import.
- Keep raw table insert/patch from becoming an alternate collection writer.

## Scope B — `defineMediaCommand` (LLP 0239 R4)

- Generate the closed `MediaCommandBindingV1` descriptor and install the exact
  binding in the target mutation manifest. No authored mapping callback,
  transform, branch, loop, or arbitrary result processing is admitted.
- Accept a scalar or bounded array of browser `File`/`Blob` and native
  picker-shaped sources. Normalize through the existing platform adapters and
  preserve input order.
- Coordinate zero-to-N existing upload tasks with bounded concurrency and
  per-item progress. Invoke no mutation until every required asset is finalized.
- Have the ordinary mutation host validate the binding, run the authored
  mutation once, resolve the declared parent result, reauthorize every relevant
  policy, and stage collection rows, attachments, and grants in the same
  application storage transaction.
- Make a required media-bound mutation command-only in v1; direct dispatch must
  refuse before handler execution rather than permitting an attachment-skipping
  path.
- Reuse LLP 0180's `CommandTask` contract. Preserve the mutation-attempt
  identity and deterministic item plan across ambiguous settlement and retry;
  never imply that post-invocation cancellation rolled back a commit.
- Report per-asset residue and cleanup provenance after partial upload or
  commit failure. Never silently delete finalized bytes.

The atomicity claim is intentionally narrow: byte transfers finalize first;
the subsequent application record, collection rows, reference attachments, and
grants commit atomically. This is not a distributed transaction over uploaded
bytes and the application database.

## Scope C — client projections and happy-path documentation

- Add the framework-neutral collection controller and
  `useSnapbackMediaCollection`, reusing one issued-URL controller entry per
  asset/authority/rendition selection. One denied or unavailable item must not
  erase authorized siblings or crash the collection.
- Project the command consistently through headless, React, Expo, and generated
  application surfaces without introducing another command or mutation owner.
- Replace Paths 2 and 4's GAP text in
  `guide/backend/media-happy-paths.md` with CI-verified npm-closure examples.
- Update `assets.media-collection.v1` and `assets.media-command.v1` in
  `guide/capabilities.md` only when their witnesses qualify. Point those rows at
  this ticket rather than the completed MediaRef projection ticket while they
  remain open.
- Add/update a demo diary when the published-package rerun materially changes a
  demo, following the repository diary rules.

## Required evidence

- Codegen accepts the exact LLP 0239 declarations and emits portable,
  digest-bound descriptors/types; invalid bounds, paths, kinds, duplicate
  policy, mappings, and sharing plans fail with source-attributed diagnostics.
- Storage/runtime tests cover append/replace/remove/reorder, stable/non-reused
  item ids, retries, OCC conflicts, authorization replacement, revocation, GC,
  quota, and backup/restore.
- Command tests cover text-only, one-item, and N-item success; per-item
  progress; upload refusal; partial transfer failure; commit refusal; response
  loss and same-attempt reconciliation; pre/post-invocation cancellation; and
  explicit residue facts.
- Web and physical Expo acceptance cover optional avatar, a one-to-four
  image/video post, and a multi-media message without raw route calls,
  app-owned attachment tables, `image1`...`imageN`, split media fields, or data
  URLs.
- Rendering covers empty, image, video-without-overclaiming-playability,
  refresh, unavailable, denial, revocation, and one bad collection item beside
  valid siblings.
- Run the affected guide checks, inventories, `./ref-check --verbose`, and the
  affected-scope LLP corpus audit before landing.
- After qualification and publication, rerun the relevant Relay Room, Tandem,
  and Clique media slices from the published npm closure and record the actual
  authoring experience.

## Explicit non-goals

- No transcoding or portable `media.video.playable.v1` claim.
- No hosted-target claim unless independently qualified.
- No offline/restart-safe source-byte custody or background upload claim.
- No unbounded collection, arbitrary per-item metadata, nested collection, or
  general workflow engine.
- No authority-profile-derived sharing until LLP 0239 R5's independent
  capability gate is satisfied.
- No migration auto-apply; the LLP 0239 R6 preview remains a later rollout.

## Definition of done

This ticket closes when the collection and media-command capability rows have
qualified witnesses, Paths 2 and 4 are honest executable guide paths, affected
checks are green, and at least one published-package Expo demo proves the full
picker -> multi-upload -> single parent/collection commit -> authorized render
path without the named workarounds. Record the as-built rollout and evidence in
LLP 0239; leave the LLP `Accepted` until its complete rollout, including any
remaining separately gated phases, is actually implemented.

## Progress record (orchestrator, 2026-08-16)

- **Scope A landed** `26e0ee26c`: full `assetCollection` per D2/D4, with the
  2026-08-15 author rulings (closed sharing grammar; created-order omits
  reorder) recorded as dated LLP 0239 amendments.
  `assets.media-collection.v1` experimental via the LLP 0134 same-commit act.
- **Scope B landed** `d4b14d33b`: `defineMediaCommand` per D3, with the
  2026-08-16 rulings (explicit required `mapping.operation`; closed
  direct-recipient `mapping.principals`). `assets.media-command.v1`
  experimental via its own act. Every production-reachable code carries a
  reviewed HTTP status; the s5_d10 inventory stays at its 11-code inherited
  baseline.
- **Scope C landed** (this landing): neutral `mediaCollectionStore`,
  `useSnapbackMediaCollection` React/Expo projections with sibling
  isolation, command projection completeness, and guide Paths 2/4 as
  CI-transcluded executable paths with the honesty constraints intact. Web
  acceptance covers 1–4-source ordered commits, direct-recipient messaging,
  and the full rendering matrix.

Remaining before close (definition of done):

1. Physical-device Expo acceptance of the picker → multi-upload → single
   commit → authorized render path.
2. The published-package rerun of the Relay Room / Tandem / Clique media
   slices (blocked on the umbrella first-publish gate,
   issues/20260814-umbrella-first-publish-gate.md, as of this record) and
   the as-built rollout/evidence note in LLP 0239.

## Device-pass record (orchestrator + author, 2026-08-16)

Physical-device Expo acceptance COMPLETE for the image path: iPhone (Expo
Go, SDK 57) against `demos/media-happy-post` over loopback snapback +
Tailscale-terminated TLS. Proven end to end on hardware: multi-select
picker → `createPost` media command → 4-item upload with per-item progress
→ one atomic parent/collection commit (stable ids, input order) → signed
issuance → authorized render; typed per-item refusal + residue for a
corrupt source and for a failed video beside ready siblings. Evidence:
Diary 0087 (2026-08-16 entry), the demo's tests/ probes, and the two
product fixes the pass forced (`fix(assets)` preview identity; Phase F
double projection).

Still open before close: the device VIDEO leg
(issues/20260816-video-strip-walker-iphone-mov-box.md — walker fix + a
fixture from the author's device), the media-bearing retained-row staleness
(issues/20260816-media-livequery-retained-row-staleness.md), and the
published-package rerun (unchanged, gated on the umbrella first-publish
ceremony).
