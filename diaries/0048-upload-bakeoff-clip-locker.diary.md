# Diary 0048 — Clip Locker backend bakeoff (LLP 0139 App C)

Large-video upload across six arms against the frozen checklist in
`demos/upload-bakeoff/clip-locker/README.md`. Author context, disclosed:
this session's forks built Snapback's asset pipeline this week — bias
runs toward Snapback; the frictions below are therefore the credible
part. Fixtures: 120,212,515-byte deterministic MP4 (testsrc2/x264,
faststart), 549 KB playable clip, and a GPS-tagged clip
(`location=+37.7749-122.4194/`, verified present via ffprobe).

## 2026-08-01 — snapback, round 1, PASS (with one real defect found)

### Environment
- This repo at the LLP 0139 freeze; sessions-mode server via the
  `cargo run` rung (dirty-worktree identity), official JS workspace
  packages; driver `snapback/run.mjs` with an instrumented fetch
  (PATCH byte accounting + one injected connection drop at ~50%).

### Milestones
- Boot (codegen → server → session mint): 26.3 s wall. Ceremony: one
  schema table, one `defineAssetUpload` intent, two mutations — the
  intent declaration reads like config and carries the whole policy
  (accept list, byte bound, delivery profile, location strip).
- 120 MB upload with kill at 58.7 MB → resume → ready: 17.4 s
  transfer wall total, 58 PATCHes.

### The headline numbers
- **Bytes re-transmitted after the drop: 0.** `patchBytesTotal` equals
  the file size exactly; TUS HEAD → offset → continue is byte-exact.
- Integrity: `end-to-end-verified` (per-chunk SHA-256 + whole-upload
  digest at finalize); downloaded digest == source digest.
- Range: real `206` with correct `content-range` (`bytes 100-4099/…`),
  suffix ranges honored, `cache-control: no-store, private` on the
  signed lane.
- Share link: headerless (pasteable) GET 200; after a 1.5 s TTL → 401;
  after delete: outstanding URL 404, new issuance 404.
- Deletion truth: referenced delete → 409 while the clip row held the
  reference; after clearing, delete 200 and everything dies at origin.
- **GPS: gone.** The strip-declared intent rewrote the geo clip
  (digest changed); ffprobe on the served bytes shows no location tags
  where the source carried `©xyz`-style `+37.7749-122.4194/`.

### What felt bad or frustrating (the real findings)
1. **Default-config uploads fail on the sessions lane** — the policy
   gate's 2 MiB body-inspection ceiling 413s the client's own 4 MiB
   default chunk (`SNAPBACK_VALUE_TOO_LARGE`, "request body exceeded
   the policy-gate inspection limit"), and the declared 8 MiB chunk
   fact is unreachable. First real 120 MB upload found what the
   64-byte-chunk conformance suite could not. Workaround: 2 MiB
   chunks. Filed: `issues/20260801-0044-policy-gate-caps-tus-chunks.md`.
2. **The failure shape was intermittently misleading**: same defect
   surfaced once as bare `fetch failed` (connection cut mid-stream) and
   once as the clean 413 diagnostic — racing the stream decides which
   you get.
3. Handler-surface guessability: `ctx.db.update` does not exist
   (`undefined is not a function` at runtime, not codegen); the
   spelling is `ctx.db.patch`. Cost five minutes; a codegen-time
   unknown-member check or a guide table would have cost zero.
4. The `saveClip`/`clearClip` ceremony (declared `writes:`, separate
   `handlers.mjs`, `source`/`exportName` indirection) is heavier than
   the intent declaration it sits next to; fine once known, opaque
   the first time.

### What felt good
- The intent-declaration model: privacy (`location: 'strip'`), delivery
  profile, and byte bounds are one visible declaration — nothing else
  in this bakeoff will put GPS stripping one line from the schema.
- `resumePersisted` is a real contract: kill the process state, hand
  back `{assetId, file}`, and it re-derives the offset from the server
  and finishes with the whole-upload digest still spanning every byte.
- Signed URLs dying at origin on delete (generation recomputation)
  gives revocation semantics the "signed URL" name usually lies about.

### Outcome
All nine checklist items pass; `snapback/results.json` carries the
receipts; limits recorded from the server-declared capability manifest
(4 GiB app quota, 8 MiB chunk fact — see finding 1, 6 h attempt TTL,
three delivery profiles, sha256, export facts).

## 2026-08-01 — supabase, round 1, PASS-with-gaps (shared project, namespaced)

### Environment
- Shared project `snapback-partiful-matrix` (plan unknown to the arm;
  disclosed per the 0102 amendment), `@supabase/supabase-js` +
  `tus-js-client` (their documented resumable path), namespace
  `ub-c-supabase-1`, baseline recorded, cleanup proven absent at exit.

### Milestones and headline numbers
- Bucket + first object: sub-second ceremony once auth worked — the
  storage API is genuinely small.
- **120 MB refused up front**: TUS create → 413 "Maximum size exceeded"
  (project-level cap governs; our 150 MB `fileSizeLimit` at bucket
  creation was itself refused as "The object exceeded the maximum
  allowed size"). Shared-target/plan evidence, not universal truth —
  but the pricing-cliff shape is real: the cap is a project setting,
  and the failure arrives only at upload time.
- **Resumability truth, 40 MB leg (under the cap): 0 bytes
  re-transmitted** with the sanctioned `uploadUrl` continuation —
  their TUS is byte-exact, 6 MiB fixed chunks, resume leg 17.0 s.
  **But the naive path re-sent 100 % of the file**: with in-memory
  sources, `findPreviousUploads()` finds nothing (no fingerprint), so
  continuation custody — storing `upload.url` yourself — is entirely
  the app's job. Snapback's client ships that custody
  (`resumePersisted`); here it is homework the docs don't emphasize.
- Range: real 206 with correct `content-range`; `cache-control` absent
  on the signed lane.
- Share: signed URL serves headerless; after 2 s TTL → 400; after
  object delete an outstanding URL → 400 (dies at origin — good);
  **no revocation API** for outstanding URLs short of deletion.
- **GPS: served back verbatim** (digest unchanged). No server-side
  metadata surface exists; location privacy is entirely the client's
  problem.
- Integrity: no server-declared digest surface on this path; the TUS
  OPTIONS response exposes **no** `Tus-Extension`/`Tus-Max-Size`/
  checksum headers at all — capability transparency is poor; you learn
  limits by hitting them.

### What felt bad or frustrating
1. **New-style key vs. their own TUS endpoint**: `sb_secret_…` as
   `authorization: Bearer` → 400 "Invalid Compact JWS"; the same key in
   the `apikey` header works. tus-js-client sends `authorization`, so
   the documented client + current keys fail out of the box; nothing in
   the error says "use apikey".
2. Limits opacity: three different size ceilings (global project cap,
   bucket `fileSizeLimit`, TUS max) with three different error shapes,
   none discoverable before the attempt.
3. `emptyBucket()` left objects the delete then tripped on;
   list-and-remove was needed for a provable cleanup.

### What felt good
- The API surface is small and orthogonal; RLS-era muscle memory
  transfers; signed-URL death-at-origin after delete is better than the
  bearer-forever many CDNs give you.
- TUS interop at all is real: any TUS client works, which is more open
  than a bespoke protocol.

### Outcome
Checklist: big-file leg capped by plan (recorded), all other items
measured; `supabase/results.json` carries receipts including the TUS
capability-header nulls and the cleanup absence proof.

## 2026-08-01 — convex, round 1, PASS (with the field's clearest resumability gap)

### Environment
- Shared dev deployment `acoustic-alpaca-401`, `convex` npm CLI +
  `ConvexHttpClient`, official three-step storage path
  (`generateUploadUrl` mutation → single POST → `storageId` in a
  mutation). **Method hazard found and filed**
  (`issues/20260801-bakeoff-convex-deployment-is-not-namespaceable.md`):
  `convex deploy` is deployment-global — my push printed
  `Deleted table indexes: [-] ub_a_profiles.by_handle`, i.e. it dropped
  a concurrently-running Lane α arm's index. Convex arms must be
  serialized on a shared deployment; Lane α's Convex numbers need a
  re-run if they raced this.

### Headline numbers
- 120 MB uploads fine (200), 88.1 s for the clean leg; the whole
  drop-then-retry sequence cost 130.5 s.
- **Bytes re-transmitted after a mid-transfer drop: 59,768,832 —
  100 % of what had already been sent.** There is no resumable
  protocol on the official path: the upload URL is single-shot POST, so
  interruption means starting over. This is the sharpest contrast in
  the bakeoff (Snapback 0 bytes, Supabase 0 bytes with app-held custody,
  Convex full re-send).
- Integrity is a genuine strength: the system table exposes a
  **provider-declared sha256** (base64) plus size for every file —
  neither Snapback nor Supabase hands you the digest as ordinary
  queryable data. Downloaded digest matched the source.
- Range: 206 with correct `content-range` on a normal range, but a
  **suffix range (`bytes=-1024`) returned 500** — a real edge-case bug
  in their delivery path; `cache-control: private, max-age=2592000`
  (30 days) on a URL with no TTL.
- Share/deletion: `getUrl()` is a long-lived unguessable URL with no
  TTL and no per-issuance authorization; deletion does kill it (404)
  and the system row disappears. No reference tracking: a `clips` row
  holding a deleted `storageId` dangles by design (documented as the
  app's job).
- **GPS: served back verbatim.** No server-side media surface.

### What felt good
- The three-step path is genuinely simple and the docs are excellent;
  `_storage` as a system table you can `db.system.get()` is elegant —
  size and sha256 come free as data.
- File ids are first-class `v.id("_storage")` values, so the schema
  says what it means (this is the shape Snapback's live-query
  AssetRef gap is currently missing, per diary 0041 finding 1).

### What felt bad or frustrating
1. No resumability, and the docs don't lead with it: for a 100 MB+ clip
   on mobile the recommended path is "retry the whole thing".
2. The suffix-range 500 is silent damage: video scrubbing libraries
   issue suffix ranges routinely.
3. Deployment-global deploys make parallel experimentation hazardous
   (the collision above).

### Outcome
All checklist items measured; `convex/results.json` carries receipts,
including the provider sha256 and the suffix-range 500.

## 2026-08-01 — firebase, round 1, PASS (emulator posture, confidence lowered)

### Environment
- **Hosted Storage is not provisioned** on the `snapback-probe` project:
  both `snapback-probe.firebasestorage.app` and `…appspot.com` return
  404 to the REST API, and resumable session creation 404s. Per LLP
  0102's target-access amendment this is environment/credential
  evidence, not a product fact; the arm ran the official local path —
  Local Emulator Suite (`firebase-tools emulators:start --only storage`,
  Java 21 via Homebrew, port 9299 because Lane α's emulator already held
  9199). Target-identity, deployment, operations, and cost confidence
  are lowered; protocol/API-shape facts are unaffected.

### Headline numbers
- 120 MB uploads fine; the SDK chunks it (24 requests observed).
- **Interruption cost the whole file.** `uploadBytesResumable` is a real
  resumable session *within one task object*, but the second attempt
  re-sent 120,212,582 bytes — 187 MB total across both attempts. The
  session handle is not exposed, so a new process (or a reloaded page
  with a fresh `Blob`) cannot continue the old session: the resumability
  is in-process only. That is a materially weaker guarantee than TUS,
  and it is not what "resumable uploads" suggests.
- Integrity: provider-declared **md5** in metadata (weaker than
  Convex's sha256, still better than nothing); downloaded digest matched.
- Range: 206 with correct `content-range`, suffix ranges honored
  (Convex's suffix bug is absent here), empty `cache-control`.
- Share: `getDownloadURL()` is a long-lived tokened URL — **no TTL**;
  expiring signed URLs exist only through the Admin SDK/GCS path, not
  the client SDK. Deletion kills the URL (404). No reference tracking.
- **GPS: served back verbatim.** Image resizing exists as an Extension;
  video metadata has no surface.

### What felt good
- The emulator is genuinely good: one command, real rules evaluation,
  and it made the "hosted not provisioned" blocker a non-event for
  API-shape evidence. No competitor in this bakeoff matched that
  local-fidelity story (Snapback's local target is the same idea, and
  it is telling that these two are the ones with one).
- Rules files are readable and colocated; the mental model (path
  patterns + conditions) is easy to teach.

### What felt bad or frustrating
1. The resumable-in-name-only ceiling above — the single most
   surprising finding of the arm.
2. Two emulator instances on one machine collide on fixed default ports;
   Lane α's run forced mine to 9299 (a bakeoff-method note, not a
   product defect, but it would bite two developers on one laptop too).
3. Storage must be explicitly enabled per project; the failure mode for
   a not-yet-enabled bucket is a bare 404 with no hint.

### Outcome
All checklist items measured under the emulator posture;
`firebase/results.json` carries receipts including the md5 metadata and
the 187 MB two-attempt total.

## 2026-08-01 — cloudflare-r2, round 1, ACCESS-GAPPED (not a product judgment)

R2 is **not enabled on the credentialed account**: the Cloudflare API
answers `{"code":10042,"message":"Please enable R2 through the
Cloudflare Dashboard."}`, and the S3 endpoint refuses the TLS handshake
(alert 40) from both Node and `curl` while DNS resolves — the shape of
an unprovisioned endpoint. Enabling requires an interactive dashboard
action outside an autonomous run, so per LLP 0102's amendment this is
environment/credential evidence and the arm is recorded as gapped
rather than substituted or faked.

The arm code is complete and runnable the moment R2 is enabled:
`cloudflare-r2/run.mjs` drives CreateMultipartUpload →
UploadPart(×N with an injected drop) → **ListParts** →
upload-missing-parts → Complete, plus presigned GET, TTL expiry, delete,
and bucket cleanup with an absence proof. Its expected shape, stated
before evidence: byte-exact resume (ListParts is the sanctioned
mechanism) at the price of hand-building the entire lifecycle —
UploadId custody, a presign service, a Worker for authorization, and
the database linkage. That "you assemble it" cost is exactly what the
integrated arms exist to avoid; recording it as untested keeps the
ranking honest.

## 2026-08-01 — pocketbase, round 1, PASS (the single-binary peer)

### Environment
- `pocketbase 0.23.4` (darwin/arm64) as its own server on :8291, a
  superuser, and one `ub_c_clips` collection with a `file` field
  (`maxSize` 200 MB, `mimeTypes: ['video/mp4']`). Hosting posture: you
  run the binary — there is no managed cloud, which is the honest
  peer-comparison to Snapback's packaged local target.

### Headline numbers
- **Fastest big upload in the bakeoff by an order of magnitude**: 740 ms
  for 120 MB on loopback (no chunking, no session, no round trips) —
  the local-disk baseline the network arms are measured against.
- **No resumability at all**: a record create is one multipart POST; an
  interrupted transfer leaves *no* partial record (`totalItems: 0`) and
  the retry re-sends the entire file. Same class as Convex, without the
  upload-URL indirection.
- Range: 206, correct `content-range`, suffix ranges honored, and the
  friendliest cache posture observed (`max-age=2592000,
  stale-while-revalidate=86400`).
- Share: `POST /api/files/token` mints a short-lived file token
  (~3 min default) for protected collections; no per-URL revocation.
- **Deletion truth is the best in the field, structurally**: the file
  *is* the record field, so deleting the record deletes the bytes and
  dangling references cannot exist by construction. Snapback reaches
  the same guarantee through typed references and reverse edges; every
  other arm leaves it to the app.
- **GPS: served verbatim.** Image thumbs exist; video metadata has no
  surface.
- Integrity: no digest exposed anywhere.

### What felt good
- Zero-to-uploading was the shortest of any arm: download a binary,
  `serve`, create a superuser, POST a collection with a `file` field.
  No SDK, no project, no keys, no plan.
- File-as-field is a genuinely good idea: the schema says a clip has a
  video, and the storage/reference/deletion story falls out of it.

### What felt bad or frustrating
1. No resumability and no digest — for 100 MB+ media over real networks
   this is the weakest transfer story here.
2. Everything above the file field (authorization beyond collection
   rules, variants, privacy) is yours to build.

### Outcome
All checklist items measured; `pocketbase/results.json` carries
receipts. Binary and `pb_data/` are gitignored.

## 2026-08-01 — App C synthesis (Clip Locker, round 1)

### Resumability truth (the axis this app exists to measure)

| Arm | Interrupted at | Bytes re-transmitted | Mechanism | Custody |
| --- | --- | --- | --- | --- |
| **Snapback** | 58.7 MB / 120 MB | **0** | TUS 1.0.0 HEAD→offset→PATCH | client ships `resumePersisted` |
| **Supabase** | 18.9 MB / 40 MB¹ | **0** | TUS 1.0.0, 6 MiB fixed chunks | **app must persist `upload.url`** — naive path re-sent 100 % |
| **Firebase** | 66.8 MB / 120 MB | **120.2 MB (all)** | `uploadBytesResumable` session | in-process only; handle not exposed → new process restarts |
| **Convex** | 59.8 MB / 120 MB | **59.8 MB (all sent)** | none | single-shot POST upload URL |
| **PocketBase** | ~0 (no partial) | **120.2 MB (all)** | none | one multipart POST |
| **R2** | not run | — | ListParts (untested) | app persists `UploadId` |

¹ Supabase refused the 120 MB file outright (project cap → TUS create
413); the resumability leg ran at 40 MB under the cap.

### Per-axis outcomes

- **Resumability:** Snapback best (protocol + shipped custody);
  Supabase equal on protocol, worse on ergonomics; Firebase misleading;
  Convex and PocketBase absent.
- **Integrity:** Convex best (queryable sha256 as system data);
  Firebase md5; Snapback verifies end-to-end but does not expose the
  digest as app-queryable data — worth stealing; PocketBase/R2 nothing
  comparable (R2's multipart ETag is not a byte digest).
- **Range/playback:** Snapback, Firebase, PocketBase, Supabase all
  correct; **Convex 500s on suffix ranges** — a real bug for scrubbing.
- **Share links:** Snapback only arm with issuance-time authorization +
  TTL + origin death on delete/revocation; Supabase/R2 have TTL without
  revocation; Convex/Firebase/PocketBase hand out long-lived tokened
  URLs (PocketBase's file token is the shortest-lived).
- **Deletion truth:** PocketBase structurally best (file is the field);
  Snapback equally strong via typed references (referenced-delete 409
  → cascade); everyone else leaves dangling references to the app.
- **Metadata privacy:** **Snapback is alone.** Every other arm served
  the GPS-tagged clip back byte-identical. This is the sharpest product
  differentiator found in the bakeoff, and it costs the competitor apps
  a hand-rolled ffmpeg pipeline to match.
- **Ceremony/local story:** PocketBase fastest to first byte; Firebase's
  emulator and Snapback's local target are the two credible offline
  development stories; Convex simplest managed path.

### What Snapback should steal (tickets filed/owed)
1. Expose the canonical digest as queryable asset metadata (Convex's
   `sha256` on the system row is strictly better DX than "we verified
   it, trust us").
2. Fix the policy-gate chunk ceiling before anyone uploads a real video
   (`issues/20260801-0044-policy-gate-caps-tus-chunks.md`) — our own
   default config cannot upload a 120 MB file today.
3. Consider a documented "storage limits" surface: three of five arms
   made me discover limits by failing.

## 2026-08-01 — Round 2, Snapback arm (fresh-context rebuild)

Verified independently: the round-2 driver reran 9/9 in the
coordinator's own hands (resume re-transmitted 57,297,955 bytes —
exactly the unacknowledged remainder of 120,212,515 after the kill at
62,914,560; retain-GPS source and served digests byte-identical;
signed URL served bare → 401 after TTL → 404 after deletion).

**The flagship answer: round 1's defect class is gone at untouched
defaults.** Round 1's Snapback arm could not upload the 120 MB file at
default configuration — the policy gate's 2 MiB inspection ceiling
413'd the client's own 4 MiB chunks, and the arm shipped only after
manual chunk tuning. Round 2's fresh builder, forbidden from tuning,
went 9/9 in 13m08s from an empty directory: the fix (`60a83597`) plus
the limits preflight held in the wild — 29 checksummed PATCHes at the
4 MiB default under the server's advertised 8 MiB ceiling, preflighted
in the attempt-create response and on every TUS response header.

Frictions vs round 1: **F1 GONE** (the chunk-ceiling defect — fix
`60a83597`, verified by this rebuild's untouched defaults); **F2 GONE**
(the stream-race `fetch failed` noise died with the 413 surface);
**F3 not exercised** (the fresh builder never reached for
`ctx.db.update`; the underlying gap — no validation of unknown
`ctx.db` members — remains real by inspection and is now ticketed:
`issues/20260801-codegen-ctx-db-member-validation.md`); **F4 persists
by design** (handler ceremony unchanged; the builder's ledger records
it without complaint).

New round-2 stumbles and their dispositions: the video location policy
living under a block named `image` → author-facing naming ticket
(`20260801-0044-video-location-policy-under-image-block.md`); the
client's string-intent form, which could never satisfy the server's
admission DTO → removed from the client (typing + a structured
client-side refusal naming the generated reference; the host-op
name-by-string surface is unaffected and correct); the guide's stale
claim that video strip "refuses at generation everywhere" → corrected
(the manifest has declared `asset_video_finalization_v1` since the
completion wave; the builder's probe was right and the page was
wrong); tombstone-after-delete semantics → documented on the assets
page (bytes die immediately, metadata tombstones through retention —
deliberate, now stated); the dirty-checkout boot tax → documented on
the diagnostics page (provenance skip working as designed, with the
recorded `SNAPBACK_SERVER_BINARY` acceptance path).

Confounds, disclosed: workspace packages + the `cargo run` rung (same
surface as round 1 — like-for-like), fresh-vs-experienced authorship
cutting the strong way (round 2's builder knew nothing and still beat
round 1's wall-clock), and ~29 s per boot of dirty-checkout tax in
every timing that includes a server start.
