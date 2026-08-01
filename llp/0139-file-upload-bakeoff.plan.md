# LLP 0139: File-upload bakeoff — three apps across the storage field

**Type:** Plan
**Status:** Active
**Systems:** Assets, Storage, Client integration, Testing, Research
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-01
**Revised:** 2026-08-01 (initial; commissioned by Charlie: "do a bakeoff
focused on a few different apps that work out file upload in various ways
vs. convex, supabase, firebase, anything else you think might be a
compelling option that could be best in class in certain ways. keep
diaries. write a summary.")
**Related:** LLP 0044, LLP 0074, LLP 0101, LLP 0102, LLP 0124, LLP 0137, LLP 0138

## Summary

A focused bakeoff of file-upload experiences: the same three
upload-centric applications built on Snapback's newly shipped asset
pipeline and on the leading alternatives, with per-arm diaries and a
synthesis ranking the field per axis. The purpose is double-edged by
design: locate Snapback's asset pipeline honestly against best-in-class
competition one day after it shipped, and harvest the losers' lessons as
tickets.

## Method

This bakeoff inherits [LLP 0102](./0102-seven-backend-five-app-bakeoff.plan.md)'s
ratified method wholesale: the 2026-07-28 target-access amendment
(shared targets under unique arm namespaces with redacted baseline
inventory, namespace-scoped cleanup with post-cleanup proof, emulator
postures as honest evidence-confidence downgrades, no
lowest-common-denominator gateway), the common implementation rule
(each provider's recommended complete path), and the diary protocol.
Arms live under `demos/upload-bakeoff/<app>/<backend>/`; the synthesis
is `demos/upload-bakeoff/reports/summary.md`; diaries are ordinary
`diaries/NNNN-*.diary.md` entries, one per application, with dated
per-backend sections written as built.

## Providers

| Backend | Posture | Access basis |
| --- | --- | --- |
| Snapback | local packaged target, the LLP 0044 pipeline as shipped | this repository |
| Convex | official path (`generateUploadUrl` → POST → storageId); shared/free target | existing credentials |
| Supabase | Storage buckets + RLS + resumable (TUS) + transformations; shared project, arm-namespaced | existing credentials |
| Firebase | Cloud Storage + security rules + Firestore; Local Emulator Suite unless the probe project admits hosted use | probe file / emulator |
| PocketBase | single binary, file fields on records, on-the-fly thumbs — the single-binary peer | none needed |
| Cloudflare R2 | Workers + R2 multipart/presigned (App C only — the infra-style large-file contender) | existing credentials |

Access gaps are recorded, not judged: Uploadthing and Mux (no
credentials) and Appwrite (no Docker on the build machine) are named as
untested contenders in the summary rather than silently omitted.
InstantDB's `$files` surface was already probed in the diary 0030 work
and its facts may be cited from there rather than rebuilt.

## The three applications

**App A — "Faceplate" (avatar & profile).** The smallest real upload
flow: pick an image, crop-agnostic upload, replace the old avatar,
display everywhere immediately, private by default. Stresses: ceremony
(steps and concepts from zero to first pixel), replace semantics and
orphan cleanup, privacy defaults (who can fetch the URL; what happens
to EXIF/GPS), cache behavior on replacement.

**App B — "Party Wall" (photo feed).** The Snapback demo's shape
rebuilt per provider: members upload photos to a shared event; a live
feed renders placeholders then thumbnails; leaving revokes access;
deletion propagates. Stresses: upload↔database↔realtime integration,
authorization models (membership vs RLS vs rules), placeholder/thumbnail
pipelines, live propagation of readiness, bulk upload behavior.

**App C — "Clip Locker" (large video).** Upload a 100 MB+ video over an
unreliable connection, resume after interruption, play back with
seeking, mint a bounded share link, delete for real. Stresses:
resumability truth (protocolized vs marketing), range playback,
large-file limits and pricing cliffs, share-link semantics (TTL,
revocation), metadata privacy for video.

Per app, every arm implements the same acceptance checklist (frozen in
the app's README before the first arm is built) and the diary records
wall-clock, ceremony counts, diagnostics quality, and surprises as hit.

## Measurement axes

Ranked per axis in the summary, never averaged into one number:
time-to-first-byte-served (ceremony); upload robustness (resumability,
interruption recovery); privacy defaults (EXIF/GPS handling, default
visibility, signed-URL semantics); authorization integration depth
(how the storage ACL composes with app auth); realtime integration
(readiness propagation without polling); media pipeline (placeholders,
variants/transforms, video); delivery ergonomics (pasteability, CDN,
range support); deletion truth (what actually disappears, when);
local/offline story; operational surface (limits, quotas, observability,
export); diagnostics quality when the author holds it wrong.

## Stages

1. **Freeze** — per-app acceptance checklists committed before arms.
2. **Build** — Lane α builds App A then App B across arms; Lane β
   builds App C. Diaries written as built; every Snapback friction files
   a ticket per LLP 0061 §5.
3. **Synthesis** — `reports/summary.md` + this document's findings
   section: per-axis rankings, best-in-class calls, Snapback gap
   tickets, and what each competitor does that is worth stealing.

## Findings

Recorded at synthesis; empty at freeze.

## Status

Active; commissioned 2026-08-01. Arms and diaries land as built; the
summary lands with the synthesis.
