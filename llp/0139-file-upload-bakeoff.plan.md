# LLP 0139: File-upload bakeoff — three apps across the storage field

**Type:** Plan
**Status:** Active
**Systems:** Assets, Storage, Client integration, Testing, Research
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-01
**Revised:** 2026-08-01, later same day (synthesis landed: §Findings
filled from diaries 0048/0048-clip-locker/0049 and the per-arm receipts;
summary at `demos/upload-bakeoff/reports/summary.md`; steal-and-fix
tickets filed; program ticket closed). Initial same day (commissioned by Charlie: "do a bakeoff
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

Synthesis landed 2026-08-01; the full evidence-cited version is
`demos/upload-bakeoff/reports/summary.md`, over diaries 0048 (Faceplate),
0049 (Party Wall), and 0048-clip-locker, with per-arm receipts committed
beside each arm.

**Headline thesis.** Most of the field runs file bytes under a different
authority system than the application data that justifies them, and the
two systems disagree exactly when it matters — after replacement,
revocation, and deletion. Snapback and (by the opposite mechanism)
PocketBase are the two arms without that split: Snapback because one
declared sharing system gates feed and bytes per-request, PocketBase
because the file *is* the record field — though its bytes ignore its
rule system entirely (public-by-URL default).

**Per-axis best-in-class calls** (never averaged; details and rankings
in the summary): ceremony/time-to-first-byte — PocketBase, decisively;
upload robustness (resumability truth, measured in re-transmitted
bytes) — Snapback (0 bytes; Supabase 0-with-custody-homework at 40 MB,
Firebase in-process-only re-sent all, Convex/PocketBase no protocol);
privacy defaults — Snapback alone in the field (only arm whose served
media provably lost GPS, images and video; two competitors serve
uploader coordinates to anonymous URL holders); authorization
integration depth — Snapback; realtime integration — Snapback (with
PocketBase's per-delivery SSE rules and Supabase's per-delivery RLS the
strongest competitors; nobody else pushes thumbnail readiness);
media pipeline — Snapback on capability, PocketBase on DX
(`?thumb=` beats pre-declared variants ergonomically); delivery
ergonomics — PocketBase (Convex's suffix-range 500 is the axis's one
outright bug); deletion truth — Snapback and PocketBase by different
guarantees; local story — Snapback and Firebase's emulator are the only
high-fidelity local stories; operational surface — Snapback (Convex's
queryable sha256 the one strictly-better competitor idea); diagnostics
quality — Snapback (Supabase's RLS-recursion-as-storage-503 the worst
distance-from-cause measured).

**Snapback's own report card:** one real product defect (the policy
gate's 2 MiB inspection ceiling 413'd the client's own default 4 MiB
TUS chunk — default config could not upload a 120 MB video; ticketed at
discovery, fixed in a parallel landing) and three deficits ticketed
from the steal list: canonical-digest opacity (vs. Convex),
ceremony floor and thumbs-on-demand (vs. PocketBase — the ticket
proposes reopening 0044's deferred dynamic-transform non-goal with this
evidence), and limits discoverability ergonomics (vs. the field's
discover-by-failure norm, which Snapback's manifest beats server-side
but the client does not yet consume as preflight).

**Method findings:** Convex deploys are deployment-global — parallel
arms interfered (ticketed as a standing bakeoff hazard); Firebase
hosted Storage has a billing cliff before the first byte (access-gapped
here, emulator posture used); Cloudflare R2 needs interactive account
enablement (arm code complete, recorded access-gapped); Supabase's
120 MB refusal is a project-plan fact. Untested contenders named in the
summary: Uploadthing, Mux, Appwrite, R2-hosted, Firebase-hosted.

## Status

Active; commissioned 2026-08-01; all three apps built and landed same
day (16 working arms + 3 access-gapped postures recorded); synthesis
landed 2026-08-01 (`demos/upload-bakeoff/reports/summary.md` +
§Findings above). Remaining live value: the access-gapped arms are
runnable the moment access exists (R2 enablement, Firebase Blaze, or
Uploadthing/Mux credentials), and the steal-and-fix tickets carry the
program's Snapback follow-ups.
