# 0044 L1-14: headless client task and React/Expo projection

**Status:** OPEN. **Authority:** LLP 0044 §Client upload surface,
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
