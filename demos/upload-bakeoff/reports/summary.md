# Upload bakeoff — synthesis summary

**Program:** LLP 0139 (three upload-centric apps × the storage field),
built 2026-08-01. Evidence: `diaries/0048-upload-bakeoff-faceplate.diary.md`
(App A), `diaries/0049-upload-bakeoff-party-wall.diary.md` (App B),
`diaries/0048-upload-bakeoff-clip-locker.diary.md` (App C), plus per-arm
receipts under `demos/upload-bakeoff/*/<backend>/results.json`. Method:
LLP 0102's target-access amendment (namespaced shared targets, cleanup
proofs, emulator postures as disclosed confidence downgrades). Author
bias disclosed in every diary: the arms were built by the session that
built Snapback's asset pipeline; the mitigation is that every comparative
claim below is scripted, byte-level, and receipted rather than tasted.

## The headline thesis: bytes and metadata are two authorities everywhere but twice

The recurring structural fact across all three apps: **most of the field
runs file bytes under a different authority system than the application
data that justifies them, and the two systems disagree exactly when it
matters** — after replacement, after revocation, after deletion.

Each provider's position, precisely:

- **Snapback** — one authority system. The sharing declaration that
  gates the feed gates the bytes; revocation pushed a blank feed in
  18 ms AND the next byte request 403'd; replacing an avatar killed the
  old asset's authority transactionally; referenced deletion refuses
  (409) until references clear, then cascades. No measured surface where
  bytes outlive the membership that justified them.
- **PocketBase** — bytes are outside the rule system entirely. Record
  rules gate metadata and are re-checked per realtime delivery (1 ms SSE,
  genuinely excellent), but file URLs served the outsider, the revoked
  member, and the anonymous fetcher alike (public-by-URL default;
  `protected` is per-field opt-in). Deletion is the mirror image:
  the file *is* the record field, so record deletion deletes bytes
  structurally — the field's cleanest delete-fate.
- **Supabase** — two systems with a lag surface. RLS is enforced per
  realtime delivery (revoked subscriptions provably receive nothing
  new — better than its reputation), but a byte fetch served 200
  immediately after membership removal, and row deletion leaves the
  object for a second, separate delete.
- **Convex** — capability URLs by documented design: app authorization
  gates *learning* a URL, never *fetching* it. Leaving the party pushed
  `[]` in 120 ms, and already-learned photo URLs kept serving.
  Replacement orphans the old file until app code sweeps `_storage`.
- **Firebase** — two products (Firestore, Cloud Storage) with two rule
  languages, plus a billing-plan gate: new projects cannot store a byte
  on the free tier. Download URLs are long-lived public-by-token
  (claims-posture; hosted storage was access-gapped here).

## Resumability truth (App C, measured in re-transmitted bytes)

120 MB deterministic MP4, transfer killed mid-flight, then resumed:

| Arm | Interrupted at | Bytes re-transmitted | Mechanism | Custody |
| --- | --- | --- | --- | --- |
| **Snapback** | 58.7 MB / 120 MB | **0** | TUS 1.0.0 HEAD→offset→PATCH | client ships `resumePersisted` |
| **Supabase** | 18.9 MB / 40 MB¹ | **0** | TUS 1.0.0, 6 MiB chunks | app must persist `upload.url`; the naive path re-sent 100 % |
| **Firebase** | 66.8 MB / 120 MB | **120.2 MB (all)** | `uploadBytesResumable` | in-process only; session handle not exposed |
| **Convex** | 59.8 MB / 120 MB | **59.8 MB (all sent)** | none — single-shot POST | — |
| **PocketBase** | ~0 (no partial) | **120.2 MB (all)** | none — one multipart POST | — |
| **R2** | not run (access gap) | — | ListParts (untested) | app persists `UploadId` |

¹ Supabase's shared project refused the 120 MB file at TUS create
(413, project-level cap); its resumability leg ran at 40 MB.

## Revocation truth (App B)

| Arm | Push mechanism | Burst push | Feed after revoke | Bytes after revoke |
| --- | --- | --- | --- | --- |
| snapback | WS + witnessed auth lane | 20–22 ms local | pushed blank, 18 ms | **403 next request** |
| convex | WS query re-run | ~140 ms cloud | pushed `[]`, 120 ms | **200 — learned URLs live on** |
| supabase | WS postgres_changes | ~330 ms cloud | new frames withheld (per-delivery RLS) | **200 immediately after leave** |
| pocketbase | SSE | 1 ms local | new frames withheld (per-delivery rules) | **200 — public by URL** |
| firebase | (access gap) | — | — | — |

Local and cloud latencies are not like-for-like and are never ranked
against each other; the mechanisms and the revocation outcomes are the
comparison.

## Per-axis rankings and best-in-class calls

Ranked per LLP 0139's axes; never averaged. Citations are to the
diaries.

1. **Ceremony / time-to-first-byte — PocketBase, decisively.** Zero
   authored backend files for the avatar app (the built-in `users`
   collection has an `avatar` file field); binary → superuser → serving
   in ~25 min including the download; 740 ms for 120 MB on loopback.
   Convex is the simplest managed path (three obvious steps). Snapback
   sits mid-field: 6 concepts, 3 authored files + codegen. Supabase is
   the heaviest (SQL RLS, two API-key classes, folder-name-equals-uid
   conventions enforced only by runtime 403s). Firebase's free-tier
   time-to-first-photo is unmeasurable — the Blaze billing cliff
   precedes the first byte.
2. **Upload robustness — Snapback.** The only arm with protocolized
   resume AND shipped custody (0 bytes re-sent through a process kill).
   Supabase matches the protocol but makes continuation custody the
   app's homework. Firebase's "resumable" is in-process marketing.
   Convex and PocketBase simply re-send. (Caveat in the same breath:
   Snapback's default config couldn't upload the file at all until the
   chunk ceiling was worked around — see "Snapback's own report card.")
3. **Privacy defaults — Snapback, alone in the field.** The only arm
   whose served media provably lost GPS location, for images (App A/B)
   and video (App C) — enforced at intent declaration, where the
   platform refuses to let the author not decide. Every other working
   arm served uploader coordinates back byte-identical; PocketBase and
   Convex serve them to *anonymous* URL holders. Supabase has the best
   non-Snapback default (nothing serves anonymously) while still
   passing GPS through originals. Where competitors drop EXIF it is a
   re-encode side effect on derivatives, undocumented, with originals
   untouched.
4. **Authorization integration depth — Snapback.** One declared system
   from schema to bytes, per-request. Supabase's RLS is the deepest
   competitor model (and per-delivery realtime RLS is genuinely strong)
   but the storage lag surface breaks the promise at the byte layer.
   PocketBase's rules integrate beautifully with realtime and not at
   all with files. Convex's capability-URL model is coherent and
   documented — and means URL possession is authority. Firebase splits
   authorization across two products.
5. **Realtime integration — Snapback**, with an honorable mention that
   matters: 20 ms pushes plus readiness (ThumbHash → thumb) arriving
   over the same socket via the reserved projection, and revocation as
   a *pushed* event. PocketBase's per-delivery rule checks at 1 ms SSE
   embarrassed two cloud arms; Supabase's per-delivery RLS is the
   strongest cloud showing. Convex's re-run-and-push model is clean at
   ~140 ms. None of the others push readiness — polling or refetching
   is the field's default answer to "when is my thumbnail ready."
6. **Media pipeline — Snapback on capability, PocketBase on DX.**
   Snapback: server ThumbHash, declared variants, required-variant
   gating, GPS strip for images and video. PocketBase: `?thumb=100x100`
   with zero declaration — the single best media-DX moment in the
   bakeoff, with no placeholders and no video story. Supabase transforms
   are plan-gated; Firebase resizing is a paid extension; Convex has no
   media pipeline at all.
7. **Delivery ergonomics — PocketBase.** CDN-grade cache headers
   (`max-age` + `stale-while-revalidate`) on public files and
   URL-parameter thumbs. Convex is cache-safe by identity change
   (new storageId per upload, 30-day max-age). Snapback's strict lane
   is deliberately non-pasteable (a 400 demanding the protocol header)
   with the pasteable public/signed lanes as separate profiles —
   coherent, but the ergonomic price of privacy-by-default is visible
   here, and Convex's suffix-range 500 (`bytes=-1024`, which video
   scrubbers issue routinely) is the axis's one outright bug.
8. **Deletion truth — Snapback and PocketBase, by different guarantees.**
   PocketBase structurally cannot dangle (file is the record field;
   delete removes bytes, URL 404s). Snapback refuses referenced deletes
   (409) then cascades, and — uniquely — kills *authority* on replace
   before GC touches bytes. Everyone else leaves orphans or dangling
   references to app code: Convex by documented design, Supabase as a
   second manual system, Firebase likewise.
9. **Local / offline development story — Snapback and Firebase's
   emulator** are the only high-fidelity local stories: same engine,
   same rules/authorization evaluation, no cloud. It is telling that
   the bakeoff's two full-fidelity local stories belong to the
   local-first product and to the emulator Google had to build.
   PocketBase is local-*native* (the product is the binary — but there
   is no managed cloud to graduate to). Supabase has a local CLI stack
   (unexercised here); Convex development ran against the cloud.
10. **Operational surface — Snapback.** Server-declared capability
    manifest (limits, profiles, integrity grades, nonclaims-as-Missing),
    receipts on every lifecycle event, and `snapback assets inspect`.
    Convex's `_storage` system table (size + sha256 as ordinary
    queryable data) is the one competitor idea strictly better than our
    equivalent — stolen via ticket. Supabase was the opposite pole:
    three size ceilings with three error shapes, discoverable only by
    failure, and a TUS OPTIONS response advertising no capabilities at
    all.
11. **Diagnostics quality — Snapback**, measured by distance-from-cause
    when the author held it wrong: uniform `diagnostic.code` objects,
    validation problems that made driver bugs one-look fixes, and a
    decoder refusal naming the exact parser error. The field's worst:
    Supabase's RLS self-recursion surfacing as a storage-service 503
    three services from the mistake, and its key-class confusion
    (`sb_secret_` in the wrong header → "Invalid Compact JWS").
    Firebase's unprovisioned bucket is a bare 404. Two honest Snapback
    demerits recorded: the chunk-ceiling failure sometimes surfaced as a
    raw `fetch failed` instead of its clean 413, and the
    protocol-header-before-auth ordering surprises first contact.

## Snapback's own report card (the credible part)

The bakeoff found one real Snapback product defect and three deficits:

- **Defect: default config could not upload a 120 MB video** — the
  policy gate's 2 MiB body-inspection ceiling 413s the client's own
  4 MiB default TUS chunk; the declared 8 MiB chunk fact was
  unreachable. Found by the first real large upload; masked by the
  64-byte-chunk conformance suite. Ticketed at discovery
  (`issues/20260801-0044-policy-gate-caps-tus-chunks.md`) and fixed in
  a parallel landing.
- **Ceremony gap:** PocketBase's zero-file floor and Convex's
  three-obvious-steps path both beat 3-files-plus-codegen for the
  simplest cases (investigation ticket filed).
- **Thumbs-on-demand gap:** `?thumb=100x100` with no declaration has no
  Snapback equivalent; variants are pre-declared by design (same
  ticket — proposes reopening the deferred dynamic-transform non-goal
  with this evidence, not silently reversing it).
- **Digest opacity:** Snapback verifies end-to-end but does not expose
  the canonical sha256 as app-queryable data the way Convex's system
  table does (steal ticket filed).

## What each competitor does that is worth stealing

- **Convex:** the queryable `sha256`/size on a system row; file ids as
  first-class schema values (`v.id("_storage")` — the ergonomic shape
  our AssetRef live-query fix now matches); documentation quality.
- **PocketBase:** the ceremony floor (file-field-on-a-collection); thumbs
  by URL parameter; `stale-while-revalidate` cache posture; deletion
  structurally tied to the record.
- **Supabase:** per-delivery RLS on realtime frames (our witnessed lane
  is the same instinct — the field should converge here); TUS interop
  as an open-protocol stance.
- **Firebase:** the emulator as a first-class product surface; readable
  colocated rules files.

## Caveats, stated plainly

- **Author bias:** all arms were built by the Snapback pipeline's
  author. Mitigations: frozen checklists before any arm, scripted
  byte-level evidence, receipts committed per arm, frictions recorded
  against Snapback wherever hit (including a product defect and two
  DX losses).
- **Maturity asymmetry:** Snapback's asset pipeline is days old and its
  wins land exactly on the axes it was designed for; the competitors are
  mature products serving constraints this bakeoff does not measure
  (scale, billing, fleets of SDKs, years of compatibility).
- **Shared-target confounds:** Supabase and Convex ran on shared
  targets (namespaced, cleanup-proven, disclosed); Convex deploys are
  deployment-global and interfered across lanes
  (`issues/20260801-bakeoff-convex-deployment-is-not-namespaceable.md`);
  Supabase's 120 MB refusal is a project/plan fact, not a universal one.
- **Postures:** Firebase ran emulator-posture with hosted Storage
  access-gapped (billing cliff) — its protocol facts are solid, its
  operational facts are claims. Cloudflare R2 was access-gapped
  entirely (account-level enablement required); its arm code is
  complete and runnable.
- **Latencies:** local arms (Snapback, PocketBase) and cloud arms
  (Supabase, Convex) are never latency-ranked against each other.
- **Single measurement:** one author, one day, one run per leg — the
  numbers are honest but not statistics.

## Untested contenders

Named, not judged: **Uploadthing** and **Mux** (no credentials — the
upload-DX specialist and the video specialist remain the two most
interesting absent arms), **Appwrite** (no Docker on the build machine),
**Cloudflare R2 hosted** (account enablement required), and hosted
Firebase Storage (billing). InstantDB's `$files` was probed in earlier
work (diary 0030: upload, outsider denial, metadata) and was not rebuilt
here.
