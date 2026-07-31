# 0044 L1-14: headless client task and React/Expo projection

**Status:** RESOLVED (2026-07-31). **Authority:** LLP 0044 §Client upload surface,
§Language-neutral protocol; LLP 0114 (React rules); LLP 0107
(optimistic lifecycle).

Framework-neutral client task: client.assets.start(...) with the closed
snapshot (stable assetId/assetRef, previewUrl, progress, pause/resume/
cancel/retry, attempt id/expiry, readiness), minimal persisted resume
facts (no bearer URLs/signing material; app+authority partitioned),
authority-change blanking + generation fencing. TUS per-PATCH checksum.
React/Expo: useSnapbackAssetUpload + asset renderers as projections
(preview → placeholder → rendition; strict-delivery aware). JS SDK runs
the conformance vectors; Swift and others follow 0064 staging in their
own programs.

Done when: the client acceptance rows pass (stable id across successor
attempts, optimistic preview, authority blanking, persisted-state
hygiene) and the JS conformance vectors are green against the local
target.

---

**PROGRESS 2026-07-31** (commits d10f6c49, 9e289e78 on the branch): the WS
live projection (see issues/closed/20260731-0044-live-projection-follow-up.md)
and the framework-neutral headless task landed —
`packages/snapback-client/assets.mjs`: create → per-chunk-SHA-256 TUS →
finalize with the whole-upload digest, closed snapshot,
pause/resume/cancel/retry with the asset id stable across successors,
persisted resume facts with the closed member set (hygiene-tested),
resume-after-refresh, `watch()` over the reserved projection, `record()`.
Suite: `assets.test.mjs` (in the package test chain).

**Remainder:** the React/Expo projection (`useSnapbackAssetUpload` + the
asset renderer over the client's live store, consuming the projection's
`live_replace` frames); the real-server JS conformance vectors (upload,
resume, attachment via a real `ctx.assets.attach` handler — which also
flips the guide's attach fragment to transcluded-verified — live-ready,
authorized-range, deletion, negative-auth, plus the membership-sharing
fixture); sessions-custody transport for the asset routes (mirrors the
server's sessions-mode projection admission, both fail closed today).

---

**RESOLVED 2026-07-31** (Lane 1, branch 0044-client-v1): W1a landed the
React/Expo projection (`useSnapbackAssetUpload`, `useSnapbackAssetImage` +
renderer, ThumbHash decode, authority blanking barrier) and W1b landed
sessions-custody transport (bearer + auth-client protocol offer on every
asset request, dev header as no-credential fallback) plus the real-server
JS conformance vectors (`tests/acceptance/asset-conformance-v1.mjs`, all
checks green). Evidence: the acceptance map's client rows are Covered.
Boundaries recorded as their own tickets rather than absorbed: the served
handler-attach admission defect
(20260731-0044-handler-attach-admissions-dropped.md), the record-surface
media-facts gap (20260731-0044-record-surface-media-facts.md); sessions-
mode live establishment stays with W2e.
