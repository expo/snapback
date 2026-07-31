# LLP 0044: Asset storage pipeline

**Type:** RFC
**Status:** Draft
**Systems:** Assets, Storage, API, Security, Auth, Runtime, Deployment, Client integration, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-07
**Revised:** 2026-07-31 (v2 revival revision, direction set by Charlie —
answers LLP 0127 open question 8's revive-versus-supersede arm as *revive in
place*. Adds: derivatives as first-class assets, content-addressed byte keys,
live asset lifecycle over the LLP 0013 channel, optimistic local display,
baked-in pure-code processing core plus ibex-scriptable steps, resumable
upload sessions, reference-tracked opt-in GC, range-request delivery,
lifecycle receipts, the single-S3-compatible-seam framing with R2/Tigris as
first hosted targets, and the heavy-step routing to the LLP 0099 executor
lane. Prior: 2026-07-07 cross-family review revisions, ratified by Charlie —
see `reviews/0044-asset-storage-pipeline.claude.md`: processing grounded in
0028's cron machinery instead of a phantom background-work model,
upload-session lifecycle and size/quota facts added; initial same day)
**Related:** LLP 0000, LLP 0004, LLP 0007, LLP 0009, LLP 0010, LLP 0011, LLP 0013, LLP 0014, LLP 0018, LLP 0028, LLP 0036, LLP 0038, LLP 0039, LLP 0047, LLP 0074, LLP 0099, LLP 0107, LLP 0108, LLP 0109, LLP 0111, LLP 0114, LLP 0124, LLP 0126, LLP 0127, LLP 0129

## Summary

This RFC defines Snapback's asset subsystem: uploading files (photos and
video especially), storing bytes outside document rows, keeping metadata in
app data, and running a processing pipeline for media-oriented apps. The
design goal is not a generic object-store wrapper; it is assets that behave
like the rest of Snapback — live, receipted, capability-honest, and
agent-legible.

The subsystem supports:

- a local filesystem byte store and **one** S3-compatible object-store seam
  (R2, Tigris, S3, B2, MinIO, GCS-interop all speak it);
- content-addressed byte keys, so dedup, integrity verification, and
  store-to-store migration fall out of the data model;
- asset metadata rows in Snapback storage, with derivatives (thumbnails,
  posters, transcodes) as first-class assets linked to their parents;
- upload sessions with authorization checks, a bounded lifecycle, and
  resumable/chunked transfer for large media;
- asset lifecycle state (`uploading → processing → ready`) streamed over the
  existing live-query/ephemeral channel, so clients react to it like any
  other live data;
- a baked-in pure-code processing core (dimensions, EXIF with GPS stripping
  by default, blurhash/thumbhash, dominant color) plus app-declared
  processing steps written as ibex handlers, driven by the existing cron
  machinery;
- capability-manifest facts for every store, step, and limit a target does or
  does not provide, and receipts for every lifecycle transition.

## Motivation

Assets are table stakes for many reference apps: product media, blogs, social
feeds, party photos, and rich collaborative apps. Snapback's root design
already says asset bytes do not belong inline in documents; metadata,
ownership, permissions, references, and processing state belong with app
data.

Without a first asset subsystem, every demo either avoids real media or
invents a one-off file path that will not port to hosted targets.

The parity research sharpened this. [LLP
0124](./0124-product-breadth-storage-and-vector-search.research.md) found the
manifest hard-codes `assetUpload: false` with `assets` in the capability-gap
list on every target, and identified the blocked app classes — the
consumer-app genre where the blob *is* the content. Its option space
concluded the right shape is this RFC, revised: capability-declared upload
sessions, authority-checked upload/delivery/deletion, receipts on lifecycle
transitions, and TTL/budget on upload sessions. [LLP
0127](./0127-parity-and-local-first-synthesis.rfc.md) routes the work as
startable now, in parallel with the parity tranches, under [LLP
0074](./0074-convex-competitive-strategy.rfc.md)'s umbrella — the local store
first, the object-store seam designed alongside it.

## Design

### Data model

Snapback owns system metadata for each asset:

- asset id;
- app id;
- owner principal;
- byte store key (content-addressed — see below);
- content type;
- size;
- checksum;
- upload state;
- processing state;
- parent asset id and variant key, when the asset is a derivative;
- created/updated timestamps.

Apps may reference asset ids from ordinary rows. Generated clients should
treat asset ids as references, not inline binary fields.

**Byte keys are content-addressed.** The byte store key is derived from a
cryptographic digest of the bytes (BLAKE3 is the working choice; the digest
algorithm is a manifest fact so it can evolve). Consequences, all
intentional:

- re-uploading identical bytes dedups to the same object; the second asset
  row references the existing key;
- every read-back is integrity-verifiable against the key;
- store-to-store migration (local filesystem to R2, say) is reconciliation,
  not surgery: copy objects, verify digests, flip the store pointer, with a
  receipt per object. The local-first program ([LLP
  0129](./0129-local-first-program.plan.md)) inherits this property for
  local-to-hosted asset movement.

Because keys are content-addressed, byte deletion is reference-counted at
the store layer: an object is removed only when the last asset row
referencing its key is gone.

### Derivatives as first-class assets

A processing output — thumbnail, poster frame, converted format, transcode —
is its own asset row, linked to its parent by parent asset id plus a variant
key (`thumb@512`, `poster`, `webp`, and so on). Derivative rows carry the
producing step and its version in metadata, so regeneration is cache-correct:
re-running a step replaces its derivatives and touches nothing else.

Clients query variants declaratively — "best image variant with width ≤ N" —
rather than string-building keys. Deleting a parent cascades to its
derivatives (byte removal still respects content-address reference counts).

### Upload sessions

The client asks Snapback to create an upload session. The server:

1. checks auth/permission;
2. reserves an asset id;
3. returns a target-specific upload endpoint or signed instruction;
4. records pending state with an expiry.

After upload, the server verifies size/checksum/content type where the target
allows it, marks the asset uploaded, and schedules processing if configured.

**Resumable transfer lives inside the session.** The session is already a
stateful, expiring object; for large media it also holds chunked-transfer
progress. On the S3-compatible seam this maps to native multipart upload; the
local store implements a small append protocol. A client that loses
connectivity resumes the same session from the last acknowledged chunk
instead of restarting a multi-gigabyte transfer.

**Optimistic local display.** The reserved asset id is returned before any
byte moves, so a client can render the just-picked photo from its local file
immediately, tagged with the real id, and swap to the served URL when the
asset reaches `ready`. This is the [LLP
0107](./0107-react-presence-and-optimistic-lifecycle.spec.md) optimistic
lifecycle applied to media; the React arm should make it the default path,
not an advanced recipe.

Abandoned sessions are first-class: a pending upload that never completes
expires, its reserved id and any partial bytes are garbage-collected by the
same sweep that drives processing (below), and a client retrying an expired
session receives a structured diagnostic telling it to request a fresh one.

### Byte stores

There are exactly two store implementations:

- local filesystem under the instance directory;
- **one S3-compatible object-store seam**, speaking presigned-URL and
  multipart semantics.

The seam is deliberately singular: R2, Tigris, S3 itself, Backblaze B2,
MinIO, and GCS via its interop mode are configurations of the same store,
not separate adapters. The first hosted target is R2, per the Cloudflare
strategy ([LLP 0014](./0014-cloudflare-strategy.rfc.md)); Tigris is the Fly
lane's sibling ([LLP
0111](./0111-fly-completion-and-hosted-ephemeral.plan.md)) and exercises the
same seam.

The store interface must make target differences explicit: direct upload,
server-proxied upload, signed URL, object immutability, delete semantics, and
read-back availability. On the S3 seam, direct-to-store upload via presigned
PUT is the preferred path — bytes never transit the Snapback server — with a
completion step verifying size and digest. The local store's natural mode is
server-proxied upload; the seam names both rather than pretending they are
one behavior.

Per-asset size limits and per-app storage quota are capability-manifest facts
reported as `Enforced`, `Advisory`, or `Missing` per target — the invocation
limits in [LLP 0047](./0047-hosted-execution-limits.rfc.md) do not cover
storage, so assets must report its own.

### Processing

There is no on-demand durable job queue in Snapback today, and this RFC does
not invent one implicitly. The processing implementation (ratified by
Charlie, 2026-07-07) is a **cron sweep over pending-state asset rows**, built
entirely from
[LLP 0028](./0028-cron-scheduled-execution.rfc.md)'s existing machinery:
`WhileLive` demand activation, `NoOverlap`, at-least-once with claim — the
sweep picks up assets in pending processing states and drives them forward.
If a real durable work-queue subsystem is designed later, it needs its own
LLP and this pipeline becomes its consumer; until then the sweep is the
model.

The pipeline has two tiers.

**The baked-in core** runs everywhere, because it is pure code with no
external tool dependency:

- image dimension and orientation detection;
- EXIF extraction, with **GPS location stripped from stored/served bytes by
  default** (privacy by default; captured-at and orientation are kept; an
  app must opt in explicitly to retain location, and the choice is a
  declared policy, not a code path);
- blurhash/thumbhash placeholder generation;
- dominant-color extraction;
- durable processing status and error diagnostics.

**Declared steps** are app-authored processing stages written as ibex
handlers in the [LLP
0108](./0108-inline-handlers-and-result-contracts.spec.md) idiom: a step
takes the asset row and a bytes handle and produces derivatives and metadata
updates. Thumbnail generation is the canonical declared step shipped as a
default. Each step's availability on each target is a capability-manifest
fact.

Heavy steps — video transcoding, poster-frame extraction, HLS packaging —
need ffmpeg-class tooling that the local binary can carry but a hosted
Worker cannot run in-process. Such steps route to the container executor
lane ([LLP
0099](./0099-container-vm-migration-executor-profile.spec.md)) where it is
available, and otherwise declare a capability gap. A target that cannot
process media reports the gap but may still store bytes. The asymmetry is
reported honestly, never papered over.

### Live asset lifecycle

Upload progress, processing state, and derivative availability are published
over the same live-query/ephemeral machinery as everything else ([LLP
0013](./0013-ephemeral-realtime-state.rfc.md)): transfer progress is
ephemeral state; the `uploading → processing → ready` transitions and
derivative arrivals are durable row changes that live queries observe. The
React arm ([LLP
0114](./0114-first-class-react-and-query-groups.spec.md)) exposes this as
`useAsset(id)`-shaped hooks — a feed re-renders the moment a thumbnail
lands, with no polling and no app-built status channel. This is the
distinctive move of the design: assets are live data, not a storage
sidecar.

### Delivery

A generated client requests a download URL for an authorized asset. Both
stores serve **HTTP range requests**, so `<video>` seek and scrub work
against either; without ranges, video support is nominal.

Two delivery-authorization models exist and the choice between them is a
deliberately open axis (LLP 0124's OQ7): per-request-authorized delivery
proxied by the Snapback server (the local store's natural model, permission
checked on every fetch) versus signed URLs handed to the client (the object
store's natural model, bearer-style within a TTL). This RFC specifies the
mechanics of both and does not pre-decide the default posture per target.

A signed URL is a transport artifact, not the source of permission truth.
The URL-signing key is instance-owned system material — it is not an
app-declared LLP 0036 entry (0036's grant unit is the function); it lives in
the instance's system store with a documented rotation path, and rotation
invalidates outstanding signed URLs by design.

### Authorization

Asset upload, read, delete, and metadata visibility are authorized through
the same auth model as app data ([LLP
0039](./0039-auth-vertical-slice.rfc.md) / LLP 0011). Derivatives inherit
their parent's authorization; a variant is never more visible than its
original.

### Garbage collection

Two sweeps, both riding the 0028 cron machinery:

- **Session GC** (mandatory): expired upload sessions release their reserved
  ids and partial bytes, as described above.
- **Reference-tracked asset GC** (opt-in policy): an app may enable a sweep
  that finds assets no longer referenced from any app row and reclaims them
  after a declared grace period — so deleting a post eventually frees its
  photos. This is opt-in because silent deletion is the one way a storage
  system permanently loses trust; when enabled, every reclamation emits a
  receipt naming the asset, the policy, and the grace window it survived.

### Receipts and capability facts

Every lifecycle transition yields a receipt: session created, bytes
verified, processing step completed or failed, derivative produced, store
migration verified, asset deleted, GC reclamation. Receipts make the
pipeline auditable by agents and acceptance suites the same way the rest of
Snapback's evidence surface does, and they are the substrate the acceptance
criteria below check.

The capability manifest distinguishes: asset metadata support, each byte
store, direct-versus-proxied upload, resumable transfer, each processing
step (core and declared), delivery ranges, size/quota limit status, and GC
policy support — per target, with `Enforced`/`Advisory`/`Missing` grades
where limits are concerned.

### Seeds and agent DX

Versioned seeds ([LLP
0109](./0109-versioned-seed-evolution.spec.md)) may carry small binary
fixtures so demo apps and acceptance suites ship with real images instead of
gray boxes, and the CLI grows `snapback assets put <file>` so an agent can
populate media without a browser. This slice is small and may land as a
follow-on ticket rather than gating the first implementation.

## Non-goals

- CDN product design.
- A dynamic transform endpoint (`?w=400&fmt=webp`-style on-demand
  derivation). Named and deliberately deferred: it is a cache/CDN product in
  disguise. v2 stays on pre-materialized named variants, which are portable
  to every target.
- Transcoding preset/ladder product design (HLS ladders, codec matrices).
  The heavy-step seam to LLP 0099 exists; the product surface above it does
  not belong to this RFC.
- A general durable background-work subsystem (the cron sweep is the model;
  a real queue is future, separately-owned work).
- Per-asset encryption at rest — a byte-store property, not a pipeline
  property; it belongs to the store's own configuration surface.
- Virus scanning or compliance guarantees.
- Public gallery or social sharing policy.
- Offline asset sync — belongs to the local-first program ([LLP
  0129](./0129-local-first-program.plan.md)), which inherits the
  content-addressed migration substrate from this design rather than
  re-deciding it.
- Payments or storage billing.

## Acceptance

- A local app can upload an image, store bytes on disk under a
  content-addressed key, create metadata, and reference the asset id from an
  app row.
- Uploading the same bytes twice produces two asset rows and one stored
  object.
- An interrupted large upload resumes from the last acknowledged chunk
  within the same session; an abandoned session expires and is
  garbage-collected, and retrying it yields a structured diagnostic.
- A client observes `uploading → processing → ready` reactively over the
  live channel, with no polling, and a feed query re-renders when a
  thumbnail derivative lands.
- Stored and served bytes for a GPS-tagged photo contain no location EXIF
  unless the app declared the retention policy.
- A derivative query ("best image variant with width ≤ N") returns the
  correct variant, and re-running a processing step replaces only its own
  derivatives.
- Unauthorized clients cannot fetch or mutate private asset metadata, and a
  derivative is never fetchable by a principal denied its parent.
- A generated client can request a download URL for an authorized asset, and
  a range request against a stored video returns the requested byte range.
- A thumbnail or explicit "processing unsupported" diagnostic is recorded,
  with processing driven by the 0028 cron sweep, and an app-declared ibex
  step runs with its availability reported as a capability fact.
- With reference-tracked GC enabled, an unreferenced asset survives the
  grace period, is then reclaimed, and the reclamation receipt names the
  policy; with GC disabled, nothing is reclaimed.
- Every lifecycle transition above has a corresponding receipt.
- The capability manifest distinguishes asset metadata support, byte store
  support, per-step processing support, resumable transfer, delivery
  ranges, and size/quota limit status.

## Open Questions

- Delivery-authorization posture per target (LLP 0124 OQ7): when is
  per-request-authorized proxying the default and when are signed URLs, and
  does the answer differ between local and hosted targets?
- Should asset metadata live in Snapback-owned system tables, generated app
  tables, or both? (The acceptance criteria above imply the default —
  system-owned metadata with app-visible references; open is only whether
  apps can also project metadata into their own tables.)
- Which image processor is acceptable for local dev without making bootstrap
  heavy? (The baked-in core is chosen to be pure-code precisely so this
  question gates only the thumbnail step, not the pipeline.)
- Blurhash versus thumbhash for the placeholder step, or both behind one
  metadata field.
- The exact chunk/append protocol for resumable upload on the local store
  (the S3 seam uses native multipart).
- How should delete/retention interact with backups and object-store
  lifecycle policies, now complicated by content-address reference counting?

## Status

Draft, revised 2026-07-31. Charlie directed revision-in-place, which answers
[LLP 0127](./0127-parity-and-local-first-synthesis.rfc.md) open question 8's
revive-versus-supersede arm for file storage: LLP 0044 remains the owner.
This RFC gives asset storage its own owner instead of leaving it as a
root-document promise; the v2 revision aligns it with the parity findings
([LLP 0124](./0124-product-breadth-storage-and-vector-search.research.md))
and the live/receipted/capability-honest shape the rest of the platform
converged on.
