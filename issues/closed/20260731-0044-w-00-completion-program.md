# LLP 0044 completion program — all remaining planned asset work

**Status:** OPEN — program index (directed by Charlie 2026-07-31: "do
all of the planned things, orchestrate/sequence however most efficient")

Two parallel lanes, sequential fork chains within each, landings at
phase boundaries. Excluded by standing direction: portable array fields
(author-reserved), HEIC/native image library (deferred "down the line"),
LLP 0070 runner generation (another session owns the jobs lane).

**Lane 1 — client (worktree snapback-0044-client, branch 0044-client-v1):**
- W1a React/Expo projection (`useSnapbackAssetUpload` + renderer) +
  provider-replacement blanking
- W1b real-server JS conformance vectors (incl. membership fixture,
  attach-handler snippet flip) + sessions-custody client transport

**Lane 2 — core (worktree snapback-0044-l1, branch 0044-wave2):**
- W2a quick fixes: blob record_json refcount staleness; frozen-
  generation authorizer retention
- W2b `private-signed` + `public-immutable` delivery profiles
- W2c `asset-reference-gc-v1` + lifecycle callbacks
- W2d video finalization (MP4/QuickTime location-atom strip,
  `asset_video_finalization_v1`)
- W2e sessions-mode live-projection LLP 0053 classification + enable
- W2f seed binary fixtures (LLP 0109 amendment + implementation)
- W2g S3-compatible store lane (adapter + multipart + direct upload,
  qualified against MinIO locally; real-R2 drill ticketed separately —
  needs shared-deployment coordination)
- W2h asset backup/export consistent-cut (design-first; implement the
  local slice if proportionate, else land design + tickets)

**Wave 3 (after both lanes land):** demo app + diary exercising the
full surface (party-photos shape), absorbing what it teaches into
guide/tickets.

Definition of done per item: green gates, honest capability facts,
acceptance rows, tickets resolved with evidence, docs in the same
landing.

---

**CLOSED 2026-08-01 (fix-wave α1): program complete.** Every child
ticket is resolved in issues/closed/ with commit-stamped evidence; the
landings are recorded in llp/0044 §Status and the session memory
(lifecycle a4e1e987..b5fd3ee0; image pipeline e2b7e49e..d93fd99f;
completion waves through f9679cf4/5cba02cf/60a83597).
