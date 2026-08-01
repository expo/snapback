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
