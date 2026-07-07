# LLP 0044: Asset storage pipeline

**Type:** RFC
**Status:** Draft
**Systems:** Assets, Storage, API, Security, Auth, Runtime, Deployment, Client integration, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-07
**Revised:** 2026-07-07 (cross-family review revisions, ratified by Charlie — see
`reviews/0044-asset-storage-pipeline.claude.md`: processing grounded in 0028's
cron machinery instead of a phantom background-work model, upload-session
lifecycle and size/quota facts added; initial same day)
**Related:** LLP 0000, LLP 0004, LLP 0007, LLP 0009, LLP 0010, LLP 0011, LLP 0014, LLP 0018, LLP 0028, LLP 0036, LLP 0038, LLP 0039

## Summary

This RFC defines Snapback's first asset subsystem: uploading files, storing
bytes outside document rows, keeping metadata in app data, and running a small
processing pipeline for image/video-oriented apps.

The first slice should support:

- local filesystem asset store;
- S3/R2-shaped object-store seam;
- asset metadata rows in Snapback storage;
- upload sessions with authorization checks and a bounded lifecycle;
- signed local/download URLs;
- image metadata extraction and thumbnail generation driven by the existing
  cron machinery;
- capability gaps for processing steps not implemented on a target.

## Motivation

Assets are table stakes for many reference apps: product media, blogs, social
feeds, party photos, and rich collaborative apps. Snapback's root design already
says asset bytes do not belong inline in documents; metadata, ownership,
permissions, references, and processing state belong with app data.

Without a first asset subsystem, every demo either avoids real media or invents
a one-off file path that will not port to hosted targets.

## Design

### Data model

Snapback owns system metadata for each asset:

- asset id;
- app id;
- owner principal;
- byte store key;
- content type;
- size;
- checksum;
- upload state;
- processing state;
- created/updated timestamps.

Apps may reference asset ids from ordinary rows. Generated clients should treat
asset ids as references, not inline binary fields.

### Upload session

The client asks Snapback to create an upload session. The server:

1. checks auth/permission;
2. reserves an asset id;
3. returns a target-specific upload endpoint or signed instruction;
4. records pending state with an expiry.

After upload, the server verifies size/checksum/content type where the target
allows it, marks the asset uploaded, and schedules processing if configured.

Abandoned sessions are first-class: a pending upload that never completes
expires, its reserved id and any partial bytes are garbage-collected by the
same sweep that drives processing (below), and a client retrying an expired
session receives a structured diagnostic telling it to request a fresh one.

### Byte stores

The first stores:

- local filesystem under the instance directory;
- object-store interface matching S3/R2 semantics.

The store interface must make target differences explicit: direct upload,
server-proxied upload, signed URL, object immutability, delete semantics, and
read-back availability.

Per-asset size limits and per-app storage quota are capability-manifest facts
reported as `Enforced`, `Advisory`, or `Missing` per target — the invocation
limits in [LLP 0047](./0047-hosted-execution-limits.rfc.md) do not cover
storage, so assets must report its own.

### Processing

There is no on-demand durable job queue in Snapback today, and this RFC does
not invent one implicitly. The first processing implementation (ratified by
Charlie, 2026-07-07) is a **cron sweep over pending-state asset rows**, built
entirely from
[LLP 0028](./0028-cron-scheduled-execution.rfc.md)'s existing machinery:
`WhileLive` demand activation, `NoOverlap`, at-least-once with claim — the
sweep picks up assets in pending processing states and drives them forward. If
a real durable work-queue subsystem is designed later, it needs its own LLP
and this pipeline becomes its consumer; until then the sweep is the model.

The first pipeline is modest:

- image dimension detection;
- thumbnail generation where local tools are available;
- duration/metadata hooks for video, initially advisory if no processor exists;
- durable processing status and error diagnostics.

A target that cannot process media reports the gap but may still store bytes.

### Authorization

Asset upload, read, delete, and metadata visibility are authorized through the
same auth model as app data ([LLP 0039](./0039-auth-vertical-slice.rfc.md) /
LLP 0011). A signed URL is a transport artifact, not the source of permission
truth. The URL-signing key is instance-owned system material — it is not an
app-declared LLP 0036 entry (0036's grant unit is the function); it lives in
the instance's system store with a documented rotation path, and rotation
invalidates outstanding signed URLs by design.

## Non-goals

- CDN product design.
- Full video transcoding in the first slice.
- A general durable background-work subsystem (the cron sweep is the v1
  model; a real queue is future, separately-owned work).
- Virus scanning or compliance guarantees.
- Public gallery or social sharing policy.
- Offline asset sync.
- Payments or storage billing.

## Acceptance

- A local app can upload an image, store bytes on disk, create metadata, and
  reference the asset id from an app row.
- An abandoned upload session expires and is garbage-collected; retrying it
  yields a structured diagnostic.
- Unauthorized clients cannot fetch or mutate private asset metadata.
- A generated client can request a download URL for an authorized asset.
- A thumbnail or explicit "processing unsupported" diagnostic is recorded, with
  processing driven by the 0028 cron sweep.
- The capability manifest distinguishes asset metadata support, byte store
  support, processing support, and size/quota limit status.

## Open Questions

- Should asset metadata live in Snapback-owned system tables, generated app
  tables, or both? (The acceptance criteria above imply the default —
  system-owned metadata with app-visible references; open is only whether apps
  can also project metadata into their own tables.)
- Which image processor is acceptable for local dev without making bootstrap
  heavy?
- How should delete/retention interact with backups and object-store lifecycle
  policies?

## Status

Draft. This RFC gives asset storage its own owner instead of leaving it as a
root-document promise.
