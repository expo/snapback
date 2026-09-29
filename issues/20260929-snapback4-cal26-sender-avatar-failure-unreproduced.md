# Calibration #26 d-02: obtain the failing sender-avatar state

Status: Open — reported defect not reproduced; not closed by the AV hook fix.
Owner: Snapback 4, lane AV.
Date: 2026-09-29.

The grader reports 0/20 DM and 0/2 group sender images after settling, while
the same avatars render in the feed. `GRADER-TRACE.md#m3-avatar` infers that
`useAsset` remains loading from the DOM; it does not include a hook snapshot,
asset request outcome, server store, or failing browser recording.

AV copied all seven Quarry files unchanged and used the uploaded benchmark
avatar with the published 0.4.8 Linux server/client. Online, process and wasm
all paint 20/20 DM, 20/20 group, 20/20 feed and 2/2 inbox avatars. The supplied
frozen Expo export also paints all DM/group/feed avatars and its instrumented
hook reaches `ready`. Its missing wasm was restored from the published package;
MD5 equals the wasm filename's `a8d025c5f3a6835e5aa89f2c560f6f4a` hash.

The API pattern is valid. There is no evidence for changing asset home-row
authorization or inventing an observation grant. A separate, deterministically
reproduced hook defect (stale ready URL during selection changes and a held
handle after an in-place sign-out) is fixed and covered in AV's local commit.
It does not explain permanent loading and is not a closure of d-02.

Next: recover the grader's failing browser/backend state or a replay including
profile-query outcomes and `useAsset` states, plus asset HTTP responses. Repeat
with both source and frozen export. A React Native Web image may itself have a
DIV root: count loaded descendant images and `data-source-uri`, and inspect the
hook outcome, before classifying it as an initials fallback.

Evidence: [AV report](../snapback4/reports/20260929-av-asset-resolution/REPORT.md).
