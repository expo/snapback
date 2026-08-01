# Diary 0048: Upload bakeoff — Faceplate (App A), five arms

**Demo:** `demos/upload-bakeoff/faceplate/` (LLP 0139 App A)
**Author:** Claude (Fable 5), the session that built the LLP 0044 pipeline
— bias disclosed up front; the per-arm evidence is byte-level and scripted
(`_shared/gps-jpeg.mjs`) precisely so the comparison doesn't rest on my
taste. Checklist frozen in the app README before any arm.

## 2026-08-01 — snapback, arm 1, PASS (8/8 checks)

Built from the workspace packages against a sessions-mode server booted
from this repo. Wall-clock ~40 min of authoring (backend: 3 small files;
driver: mostly copied from the conformance harness), of which the honest
frictions below cost maybe half.

Evidence highlights (`snapback/run.mjs` prints the full table):
- **check 4 (GPS):** uploaded avatar carried GPS EXIF; served bytes
  provably do not (`hasGpsExif(served) === false`). This required zero
  thought: `image: { location: 'strip' }` was already mandatory at intent
  declaration — the platform refused to let me not decide.
- **check 6 (replace):** the *old* avatar returns 403 for another user on
  the very next request after replacement — the reference edge died with
  the `patch`, and via-references authority died with it. No cache purge,
  no CDN wait: revocation-on-replace is transactional. I know of no
  competitor arm below that will match this; we'll see.
- **check 2:** 199 ms from two freshly minted sessions to served avatar
  bytes (local server, debug build).
- **check 7:** a signed-out fetch gets 400 — and notably the diagnostic
  is the *protocol-header* demand, not a 401. Strict delivery is
  deliberately not pasteable; the pasteable profiles exist separately.

Frictions, as hit:
1. The delivery route is `deliveryUrl()` on the client — my first two
   guesses at a raw path (`/assets/{id}/{variant}`) 404'd. The client
   builder is the paved path; the guide should say "never hand-build
   delivery URLs" louder. (Not ticketed — guide already shows the
   builder; my error.)
2. Strict delivery under sessions demands
   `x-snapback-auth-client-protocol: 1` *before* auth is considered; a
   bearer-only fetch gets a 400 whose message does name the exact header
   (good diagnostic, surprising order). Recorded as measurement, not
   defect: it is the declared non-pasteable posture.
3. Mutation results arrive enveloped (`{result}`), and the client
   validates args client-side with precise problems — both fine, both
   cost one round of reading the conformance suite to learn. The
   headless client's error objects carry `diagnostic.code` uniformly:
   debugging was pleasant.
4. My first hand-rolled JPEG fixture was refused by the decoder
   (`SNAPBACK_ASSET_IMAGE_DECODE_FAILED`, exact upstream parser error in
   the message) — the hostile-input posture doing its job against my
   own lazy fixture; I switched to a real sips-produced JPEG.

Ceremony count (concepts a newcomer must hold): 6 — table, assetRef
field, assetSharing declaration, upload intent, attach-in-mutation,
sessions auth. Steps: 3 authored files → codegen → server → client task.

## 2026-08-01 — pocketbase, arm 2, PASS (evidence complete; posture findings)

v0.39.10 darwin_arm64 from the official release (binary gitignored, URL +
version recorded). Wall-clock ~25 min including the download. Zero
authored backend files: the built-in `users` auth collection already has
an `avatar` file field — this is the provider's own paved avatar path,
and it shows. Ceremony is the field's floor: download binary → superuser
upsert → serve → four REST calls.

Evidence highlights (`pocketbase/run.mjs`):
- **check 4 (GPS): the original serves with GPS intact** — and combined
  with check 7 (**signed-out fetch = 200**; files are public-by-URL
  unless a field is marked `protected`), the default avatar flow lets an
  anonymous fetcher read the uploader's location from the served bytes.
  The `?thumb=100x100` re-encode drops EXIF (measured), so the leak is
  specifically the original URL — which is exactly the URL the record
  JSON hands out. Neither the field editor nor the docs surface EXIF
  anywhere I hit. This is the sharpest privacy-default contrast with the
  Snapback arm and it costs the user nothing to hit.
- **check 6:** replace deletes the old file from disk — old URL 404s
  immediately. Cleanest orphan story measured so far (Snapback: bytes
  retained under GC policy but *authority* revoked transactionally;
  PocketBase: bytes gone, but note anyone who saved the URL had free
  access until the moment of replacement).
- **check 5:** `cache-control: max-age=2592000, stale-while-revalidate=86400`
  — genuinely CDN/browser-friendly, the pasteability winner so far; the
  new-filename-per-upload scheme makes the cache posture safe.
- On-the-fly thumbs by URL parameter with no declaration anywhere is a
  DX delight (contrast: Snapback pre-declares variants in the intent;
  Supabase gates transforms by plan).

Posture summary: best-in-class ceremony and delivery ergonomics;
weakest measured privacy defaults (public-by-URL + EXIF passthrough).
The `protected` flag + file-token flow exists but is opt-in and
per-field; the default is the measured behavior.
