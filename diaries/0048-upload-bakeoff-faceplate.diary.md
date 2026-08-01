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

## 2026-08-01 — supabase, arm 3, PASS (shared project, cleanup proven)

Shared project under the 0102 amendment: namespace `ub-a-supabase-1`,
baseline recorded (counts only), scoped cleanup with absence proof
(`cleanup.mjs` printed bucketAbsent:true, nsUsersRemaining:0; the three
RLS policies dropped by `cleanup.sql`). Wall-clock ~50 min including one
cleanup-discipline detour of my own making.

Evidence highlights (`supabase/run.mjs`):
- **check 7: nothing serves anonymously** — private bucket + RLS means
  both the authenticated route without a JWT and the public route on a
  private bucket 400. Best privacy *default* of the non-Snapback arms.
- **check 4: the original serves with GPS intact** to any authenticated
  reader; the `render/image?width=100` transform endpoint (available on
  this project) re-encodes and drops it. Same shape as PocketBase: the
  derivative loses EXIF as a side effect, the original keeps it, and no
  doc surface I touched mentions location data.
- **check 5/6:** the paved avatar path is same-path upsert — same URL,
  `cache-control: no-cache` on the authenticated route, no orphan
  object. Their own docs warn about CDN staleness for public-bucket
  upserts; the distinct-path alternative leaves orphans you sweep
  yourself.
- **check 2:** 2.6 s to first served byte (real cloud RTT from here).
- **Ceremony: heaviest measured.** Six concepts including two API-key
  classes and RLS-in-SQL; the folder-name-equals-auth-uid convention is
  load-bearing for the owner-write policy and nothing enforces you got
  it right until a 403 at runtime. The policy language is genuinely
  powerful — and genuinely SQL, authored out-of-band from the app code.

Frictions, as hit: assert-message body-consumption bit me twice in my
own driver (undici single-read responses — my bug, recorded for
fairness since wall-clocks include it); the storage list API returns
folders as null-id entries you must recurse (cleanup code grew 20 lines
for the proof).

## 2026-08-01 — convex, arm 4, PASS (shared dev deployment, cleanup proven)

Shared dev deployment (the standing probe target) via the HTTP function
API; convex-cli 1.43.0. Shared-target caveat, disclosed per the 0102
amendment: a Convex deploy **replaces** the deployment's function set and
schema — my push removed two earlier probes' indexes (deploy output
archived redacted; tables/data untouched). Function replacement cannot
be namespace-scoped; this deployment exists for exactly these probes.
Identity posture, recorded honestly: no auth provider is configured, so
"two users" are application rows and every access statement is Convex's
documented file-URL model, not a JWT check. Wall-clock ~45 min.

Evidence highlights (`convex/run.mjs`):
- **checks 3 + 7: file URLs are unauthenticated capability URLs by
  documented design** — the signed-out fetch and the "other user" fetch
  are the same 200. App-level authorization gates *learning* the URL
  (queries), never *fetching* it. With **check 4 (GPS served = true)**,
  the posture compounds the same way PocketBase's does: any URL holder
  reads the uploader's location from the original bytes.
- **check 6: the replaced file stays stored and fetchable (200)** until
  app code deletes it — my own arm proved the burden by leaving an
  orphan on the first cleanup pass and needing a `_storage`
  system-table sweep mutation to finish the job (sweep proof:
  scanned 1, deleted 1). `setAvatar` returning the prior storageId is
  the API nudging you to handle it; nothing does it for you.
- **check 5:** replacement mints a new storageId → new URL
  (`cache-control: private, max-age=2592000` — cache-safe by identity
  change, the same design instinct as Snapback's rendition-id ETags).
- The three-step dance (mutation → POST → mutation) is more ceremony
  than Snapback's one-await task but each step is obvious and the
  storageId-in-document model is refreshingly plain. 1.8 s to first
  served byte.

## 2026-08-01 — firebase, arm 5, ACCESS GAP (posture recorded)

Hosted probe project: **auth works** (email-password and anonymous both
enabled; two identities created and later deleted — cleanup proof in the
driver output). **Cloud Storage is not provisioned**: the bucket 404s at
the REST root, `uploadBytes` fails `storage/unknown`, and provisioning
requires console + billing action (since late 2024, Cloud Storage for
Firebase requires the Blaze paid plan for new projects) that no agent
credential here can take. The Local Emulator Suite alternative needs
Java, absent on this machine. Per the 0102 amendment this is recorded as
environment/credential evidence, not a product failure — but one real
product finding stands regardless: **the free-tier avatar has a billing
cliff on Firebase** that none of the other four arms has, and the
checklist's time-to-first-photo is unmeasurable without a credit card.
What the docs promise for the unmeasured checks (recorded as *claims*,
not evidence): download URLs are public-by-token; originals serve as
stored (EXIF passthrough); resize/EXIF-strip requires the paid Resize
Images extension.

## App A wrap — the comparative picture (evidence-backed)

| Axis | snapback | pocketbase | supabase | convex | firebase |
| --- | --- | --- | --- | --- | --- |
| Ceremony (concepts) | 6 | **5, zero files** | 6 + SQL | 6 | gap |
| Anonymous fetch of avatar URL | 400 (strict) | **200** | 400 | **200** | (claims 200) |
| GPS in served original | **stripped** | served | served | served | gap |
| Old avatar after replace | 403 next request | 404 (deleted) | overwritten | 200 (orphan) | gap |
| First-serve latency measured | 199 ms local | 335 ms local | 2.6 s cloud | 1.8 s cloud | gap |

The single sharpest cross-field fact: **Snapback is the only arm where
the served avatar provably lost its GPS location** — every other
working arm serves the uploader's coordinates in the original bytes,
and two of them serve it to anyone holding the URL. The single
sharpest Snapback deficit: ceremony — PocketBase needed *zero authored
backend files* against our three plus codegen, and its on-the-fly
thumb parameter has no Snapback equivalent (variants are pre-declared).
Both findings go to the synthesis.
