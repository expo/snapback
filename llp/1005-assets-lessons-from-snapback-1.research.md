# LLP 1005: What Snapback 1 learned about assets and media

**Type:** Research
**Status:** Draft
**Systems:** Assets, Storage, Authoring surface, Client integration, Delivery,
Authorization, Diagnostics, Guide
**Author:** Claude Opus 5 (corpus synthesis), commissioned by Charlie Cheever
**Date:** 2026-08-31
**Revised:** 2026-08-31 (initial synthesis)
**Related:** LLP 1000 (decision 6, "from scratch, building up"), LLP 1004,
LLP 0044, LLP 0139, LLP 0180, LLP 0210, LLP 0220, LLP 0239, LLP 0244,
LLP 0329.014, LLP 0329.014.004,
`rules/NOT-DOING.md`, `demos/upload-bakeoff/reports/summary.md`,
Diaries 0041, 0043, 0048 (Faceplate), 0048 (Clip Locker), 0049, 0051, 0065,
0070, 0086, 0087, 0097, 0100, 0101

## Summary

Snapback 1 shipped an asset pipeline, benchmarked it against five competitors
in a scripted bakeoff one day later (LLP 0139), then spent five more LLPs and
about four weeks building an author-facing media surface on top of it. The
evidence separates cleanly into three piles:

1. **One structural idea that beat the entire field and is cheap to keep** —
   rows and bytes under one authority, checked per request.
2. **One declaration that every diary praised** — `defineAssetUpload`, which
   carries admission, privacy, renditions, delivery, and authorization in a
   single visible place.
3. **Everything built above that line**, which consumed roughly 3,100 LLP
   lines and 199 diagnostic codes, is still `experimental` behind an expired
   GAP row, and produced the corpus's densest concentration of author friction.

`rules/NOT-DOING.md` already rules media collections out of Snapback 2 and
names "Assets (typed intent)" as the whole feature. This document is the
evidence behind that ruling, plus the specific things Snapback 2 should do
differently on the first commit rather than discover on the fortieth.

This is a Research document. It proposes no Snapback 2 surface and binds
nothing; the recommendations in §8 are inputs to whoever writes the assets
spec.

## 1. Where the evidence is

| Source | What it measures |
| --- | --- |
| LLP 0139 + `demos/upload-bakeoff/reports/summary.md` | Three upload apps × six backends, scripted and byte-level, 2026-08-01, with a same-day round-2 rerun by fresh-context builders |
| Diaries 0048 (Faceplate), 0049 (Party Wall), 0048 (Clip Locker) | Per-arm build logs for avatar, photo feed, and 120 MB video |
| Diary 0041 | The first real consumer of LLP 0044, written by the session that built it (bias disclosed at the time) |
| Diary 0051, Diary 0087 | The React/Vite doorway; the Expo + physical-iPhone pass |
| Diaries 0043, 0065, 0086, 0097, 0100, 0101 | Assets encountered incidentally by apps built for other reasons — the least biased sample in the corpus |
| ~50 closed + 8 open `issues/` tickets | What actually broke, and what is still broken |

Bias note, inherited from the diaries themselves: the bakeoff arms were built
by the session that had just built the pipeline. The mitigation the program
chose — every comparative claim scripted, receipted, and byte-level — holds up,
and the round-2 rerun used fresh-context builders with no repository access,
which cuts the opposite way.

## 2. Finding 1: one authority over rows and bytes is the whole moat

Party Wall (App B) built the same photo feed on five backends and then revoked
a member. The measurement:

| Arm | Feed after revoke | Bytes after revoke |
| --- | --- | --- |
| **Snapback** | blank pushed, 18 ms | **403 on the next request** |
| Convex | `[]` pushed, 120 ms | 200 — already-learned URLs keep serving |
| Supabase | RLS blocks new frames per delivery | 200 immediately after removal |
| PocketBase | rules re-checked per delivery (1 ms SSE) | 200 — public by URL |
| Firebase | (access-gapped) | two products, two rule languages, billing gate |

The synthesis states the thesis directly: *most of the field runs file bytes
under a different authority system than the application data that justifies
them, and the two systems disagree exactly when it matters* — after
replacement, after revocation, after deletion. Faceplate found the same shape
on a smaller flow: a replaced avatar returned 403 to another user on the *very
next request*, with no cache purge and no CDN wait, because the reference edge
died inside the `patch`.

Two competitors are worth studying rather than dismissing. **PocketBase**
reaches the deletion half of the guarantee by a completely different and much
cheaper route: the file *is* the record field, so dangling references cannot
exist by construction. **Supabase and PocketBase both re-check authorization
per realtime delivery**, which is stronger than their reputations suggest;
their gap is bytes, not frames.

This finding is the one that survives every methodological objection in the
program, and it costs Snapback 2 nothing extra if it is designed in from the
start: it is a consequence of the asset reference being an ordinary authorized
field, not of any machinery above it.

## 3. Finding 2: the intent declaration earned its keep

`defineAssetUpload` holds the accept list, byte ceiling, location policy,
required renditions, delivery profile, and authorizer in one declaration, and
`ctx.assets.attach` is one line inside an ordinary mutation. Every diary that
touched it said so independently:

- Diary 0051 (Codex, a different model family): "the app wrote no EXIF
  scrubber, content sniffer, hash verifier, thumbnail worker, or retry state."
- Diary 0086 (Coterie): "the asset path was cohesive. One `defineAssetUpload`,
  one typed `v.assetRef`, one `ctx.assets.attach`."
- Diary 0048 (Faceplate): GPS stripping "required zero thought:
  `image: { location: 'strip' }` was already mandatory at intent declaration —
  the platform refused to let me not decide."

That refusal-to-let-you-not-decide produced the bakeoff's sharpest single
product differentiator: **Snapback was the only arm in the field whose served
bytes provably lost their GPS coordinates**, images and video alike. Every
other working arm served the uploader's location back verbatim in the
original, and two of them served it to anonymous URL holders. Competitors can
only match this with a hand-rolled ffmpeg pipeline.

The upload task itself was also consistently preferred to the field's norm:
`assets.start({upload, file})` awaited to `ready` beats Convex's
`generateUploadUrl` → POST → `storageId` choreography in every diary that
compared them.

## 4. Finding 3: resumability is only real if the client ships the custody

App C killed a 120 MB transfer mid-flight and counted re-transmitted bytes:

| Arm | Bytes re-transmitted | Why |
| --- | --- | --- |
| **Snapback** | **0** | TUS 1.0.0 + the client ships `resumePersisted` |
| Supabase | 0 (at 40 MB, under a project cap that refused 120 MB outright) | TUS 1.0.0 — but the naive path re-sent 100 %; persisting `upload.url` is the app's job |
| Firebase | 120.2 MB (all) | `uploadBytesResumable` is in-process only; the session handle is not exposed, so a new process restarts |
| Convex | 59.8 MB (all sent) | no resumable protocol; single-shot POST |
| PocketBase | 120.2 MB (all) | one multipart POST; an interruption leaves no partial record |

The differentiating half is not the protocol — Supabase has the same protocol.
It is that Snapback's client owns the offset custody, so `resumePersisted`
works across a process death. Firebase is the cautionary case: a feature named
"resumable uploads" whose guarantee evaporates when the page reloads.

## 5. Finding 4: the failures, and what they have in common

### 5a. The flagship shape was inexpressible, and the cause was a type leak

*A feed of posts with photos* — the single most common media application in
existence — could not be written. `defineLiveQuery` over a table containing a
`v.assetRef` field failed codegen: the result-contract vocabulary had no
AssetRef leaf (Diary 0041 finding 1). The workaround was a split table with a
plain-string copy of the id. Diary 0043 rediscovered it independently a day
later on the published package: "an `assetRef` field makes its table
unqueryable." It was patched by adding an AssetRef leaf, then re-solved
properly a month later by LLP 0244's entire MediaRef projection seam (809
lines).

Convex's equivalent is a non-event: file ids are `v.id("_storage")`, ordinary
values in documents, and feeds just work. Diary 0048's Clip Locker arm names
this explicitly as the shape to steal.

**The lesson generalizes past assets.** A reference kind that the result
contract, the live-query planner, and the client type generator do not all
know about on day one will cost a retrofit later, and the retrofit will be
larger than the original feature.

### 5b. The attach ceremony is correct and is still a trap

`SNAPBACK_ASSET_REF_UNVERIFIED` — a write storing an asset id that did not go
through `ctx.assets.attach` — appears in Diaries 0043, 0086, 0097, and the
Clique matrix runs. The refusal is right (a forged string must not become an
authorized reference), and every author discovered it by hitting it rather
than by reading. Diary 0097 (grok, fresh context): "assets are stricter than
Convex file storage: an upload authorizer is not enough."

### 5c. Delivery profiles were the single most repeated friction

`private-strict` demands the `x-snapback-auth-client-protocol: 1` header
*before* auth is considered, which means a plain `<img src>` cannot fetch it,
React Native's `Image` cannot fetch it, and a share link is not pasteable.
This burned:

- Faceplate check 7 (a 400 where a 401 was expected)
- Party Wall finding 7 (public covers and signed bearer links both 400 —
  "that breaks the pasteability that is these profiles' whole story")
- Diary 0065 finding 3 (`useSnapbackAssetImage.src` defaulted to the strict
  URL → empty image bubbles on a sessions server)
- Diary 0087 device finding 2 (RN `Image` attaches no bearer; device rendering
  needs `private-signed`)

The resolution is the load-bearing lesson: the author ruled on 2026-08-16 that
**omitted `delivery` takes the `public-immutable` default** with a
source-attributed advisory (LLP 0210 header amendment). Snapback 1 defaulted
to maximum strictness and paid for it in four separate builds before
inverting. Snapback 2 should ship inverted: the pasteable path is the default
and privacy is the explicit, reviewed opt-in.

### 5d. Ceremony is the standing structural deficit

PocketBase built the avatar app with **zero authored backend files** — its
built-in `users` collection already has an `avatar` file field — and offers
`?thumb=100x100` on-the-fly with no declaration anywhere. Snapback needed
three authored files plus codegen and six coarse concepts (18 by round 2's
finer ledger).

Documentation closed most of the *time* gap: fresh-context round-2 rebuilds
went from ~40 min to ~10.5 min on Faceplate and 13m08s from an empty directory
on Clip Locker, first-attempt-clean. It did not close the *concept* gap, which
is structural. Notably, this evidence is what forced LLP 0044 to supersede its
own dynamic-transform non-goal with "ladder-bounded on-demand widths."

### 5e. The layered surface above the intent is where the cost went

| Document | Lines | What it adds |
| --- | --- | --- |
| LLP 0044 | 2,588 | the pipeline itself |
| LLP 0180 | 754 | asset-bearing client commands |
| LLP 0210 | 612 | upload/delivery DX closure |
| LLP 0220 | 342 | recipient-bound grants |
| LLP 0239 | 589 | asset collections + the media field |
| LLP 0244 | 809 | the MediaRef projection seam |
| **Total** | **5,694** | |

The diagnostics registry currently carries **111 `SNAPBACK_ASSET*`, 69
`SNAPBACK_MEDIA*`, and 19 `SNAPBACK_COMMAND*` codes** — 199 of 3,758 total, or
5.3 % of the entire product's diagnostic surface, for one feature area.

And the result: `assets.media-collection.v1` and `assets.media-command.v1` are
**still `experimental` with open GAP rows** (`guide/capabilities.md`), whose
review dates expired and produced
`issues/shelved/20260828-guide-gap-review-expired-assets-media-collection-v1.md`. The
two capabilities that cost the most shipped the least.

This is the clearest single argument for `rules/NOT-DOING.md`'s existing
ruling, and it is worth restating as a general shape: **the part authors liked
was the smallest part, and every layer added above it was reviewed harder,
diagnosed heavier, and graduated slower than the layer below.**

## 6. Finding 5: only real bytes, a real bundler, and a real phone found the real bugs

This is the strongest process lesson in the corpus, and it transfers to any
Snapback 2 subsystem that touches the outside world.

| What was tested | What it found |
| --- | --- |
| A real 120 MB file | **Default configuration could not upload.** The policy gate's 2 MiB body-inspection ceiling 413'd the client's own 4 MiB default TUS chunk. Five waves of conformance tests at 64-byte chunks never saw it. |
| The first `vite build` of any demo | `createHash is not exported` — per-chunk checksums used `node:crypto`. Diary 0041: "five waves of Node-side tests never opened a bundler. Demos are the integration test Node suites cannot be." |
| A physical iPhone, one session (Diary 0087) | HEIC-first photo libraries; pickers hand you `.mov` even in compatible mode; RN/Yoga `aspectRatio` + percent width collapses tiles to zero height ("uploads worked then vanished"); a media-command preview identity hole (`identity: None` hard-coded in the authorization dry run — *every* real-server JS-handler media command failed); a JS query-path double projection that bricked re-projected stored media. None were reachable by unit or harness tests. |
| The first Expo-web app to upload (Diary 0065) | Browser TUS `PATCH` blocked by CORS — `access-control-allow-headers` omitted `upload-offset` and `tus-resumable`. The paved browser answer was the Vite relay, which an Expo-web app does not have, so a cold agent hand-wrote an 80-line relay to finish the brief. Fixed and published in 0.1.11 (`issues/closed/20260806-tus-cors-headers-expo-web.md`). |
| The author's real MOV | QuickTime `meta` atoms are **not** ISO fullboxes — fullbox parsing walked the strip walker 4 bytes into garbage. |
| A hand-typed base64 PNG | Correctly refused at CRC admission — which incidentally proved the typed 422 refusal and the per-item residue path. |

The pattern: the asset path is the subsystem most exposed to hostile,
device-shaped, network-shaped reality, and its bugs live exactly where the
synthetic fixture stops. A Snapback 2 assets slice is not done when its tests
pass; it is done when a large file, a bundler, and a phone have each been
through it.

## 7. Finding 6: the steal list, still unclaimed

Recorded by LLP 0139 as tickets, and mostly still open:

1. **Convex's queryable `sha256`.** The `_storage` system row exposes a
   provider-declared digest and size as ordinary queryable data. Snapback
   verifies end to end and does not hand you the digest — "we checked it,
   trust us" is strictly worse DX. Diary 0048 calls this the one strictly
   better competitor idea on the operational axis.
2. **PocketBase's file-as-field**, for deletion truth by construction.
3. **PocketBase's on-demand thumbs**, which beat pre-declared variants
   ergonomically even where Snapback wins on capability.
4. **Limits discoverability.** Three of five arms made the author discover
   ceilings by failing (Supabase has three different size caps with three
   different error shapes). Snapback's server-declared manifest beats the
   field; the client did not consume it as preflight until the round-2 fix.
5. **The high-fidelity local target is already a moat.** The bakeoff found
   only two credible offline development stories: Firebase's emulator and
   Snapback's local target.

## 8. What this suggests for Snapback 2 (input, not proposal)

Framed against `rules/NOT-DOING.md`'s existing scope — "Assets (typed
intent)" and nothing above it.

**Keep, essentially unchanged:**

- One authority over rows and bytes, checked per request rather than by
  capability URL. This is the moat, it is measured, and it is free if designed
  in.
- The single typed intent declaration carrying admission, byte ceiling,
  location policy, delivery, and authorization.
- Strip-by-declaration with no opt-out, which is the only reason the GPS
  finding exists.
- TUS plus **client-side offset custody**. The protocol alone is not the
  feature.
- The high-fidelity local target.

**Change on the first commit rather than discover later:**

- The media reference is an ordinary value in the result contract, the query
  planner, and the generated types from day one. §5a is Snapback 1's largest
  self-inflicted wound and it cost two separate repairs.
- Default delivery is the pasteable one; privacy is the explicit opt-in
  (§5c, already the ruling in v1 — start there).
- Expose the canonical digest as ordinary queryable data.
- Admit HEIC and `video/quicktime` in the accept vocabulary at birth. Both are
  what real phones hand you, and both were retrofits in v1
  (`issues/shelved/20260819-heic-image-normalization.md` is still open).
- Project the placeholder with the media read. v1 already computes thumbhash
  and dominant color at admission and simply does not project them, so tiles
  paint empty during issuance
  (`issues/shelved/20260816-media-placeholder-projection.md`). Cheapest perceived
  latency win available.
- Stream finalize, and run media CPU outside the writer lock — see §9.

**Do not build until an application forces it:** collections, media commands,
recipient grants. §5e is the evidence.

## 9. Debts Snapback 2 would inherit by copying v1's store

Stealing code from `crates/` under LLP 1000 decision 6 means reading these
first:

| Ticket | What it is |
| --- | --- |
| `20260808-assets-finalize-memory-and-cpu-under-global-lock.md` | **P2, open.** Finalize reads whole objects into `Vec<u8>` three times (strip/inspect, publish, each variant render) and runs media CPU **inside the single global writer lock** — one large upload stalls the instance, with ~2× RSS spikes. Local FS now streams; the S3 path's trait default is still `read` → `Vec` → `put`. Design the Snapback 2 store streaming-first. |
| `20260821-orphan-blob-reclamation-after-reset.md` | A partial reset wipe leaves objects behind, and the partial wipe is undetectable. Staging objects are reconciled; published blobs are not. |
| `20260817-upload-intent-codec-duration-admission-facts.md` | Intents bound media type and byte size but cannot express codec or duration, so Coterie's video rules (H.264/AAC, 60 s) were honestly unenforceable. Client checks are not authority. |
| `20260819-heic-image-normalization.md` | The trusted image pipeline admits JPEG/PNG; iOS libraries are HEIC-first. |
| `20260816-media-placeholder-projection.md` | Placeholder computed, not projected. |
| Diary 0086 (ticketed) | No paved path for installing fixture media in a sessions-mode app — the versioned-seed page says principal ids cannot be seeded, and the assets page teaches no seed-fixture path. |

One inherited debt is *closed* and worth keeping in view anyway: the browser
TUS CORS gap (§6) shipped a fix in 0.1.11, but only after a cold agent had
already hand-written a relay around it. The class — a protocol header set that
the dev relay masks and a bare browser does not — recurs wherever Snapback 2
paves one client path and assumes the others inherit it.

## 10. Relationship to the rest of the corpus

The 0329.014 line answers *where* asset bytes belong: a blob is a distinct
data kind — durable bytes plus metadata, where the store sees the metadata and
the bytes may be opaque — and it earns physical separation from the row store
on byte shape and size alone, while its reference stays an ordinary certified
field in the program. This document is the empirical companion. That line says
where the bytes go; this one says what happened the last time we put them
there, and which parts of the surface above them were worth their price.

The concrete handoff is §8: it is written to be read next to whatever
Snapback 2 assets spec gets authored, not to constrain it.

## Confidence

**0.9** on §2 (one authority) and §3 (the intent declaration): both are
scripted, byte-level, receipted, and independently corroborated by diaries
written by three model families for other purposes.

**0.85** on §5a (the type leak) and §5e (the layer cost): the line counts,
diagnostic counts, and capability statuses are mechanical facts; the causal
reading is the author's.

**0.8** on §6 (only reality found the real bugs): the individual findings are
all documented, but "the synthetic fixture stops exactly here" is an inference
from a sample of one subsystem.

**0.6** on §8's specific recommendations. They are the corpus's implications,
not a design, and the Snapback 2 assets spec should feel free to reject any of
them for reasons this document has no access to.

## Open questions

1. Does Snapback 2's certificate model change §5a? If the asset reference is
   an ordinary certified value from the start, the retrofit that cost v1 two
   repairs may be structurally impossible here — worth confirming rather than
   assuming.
2. Is PocketBase's file-as-field reachable in Snapback 2's grammar? It gets
   deletion truth for free where v1 needed typed references, reverse edges,
   GC grace, and a `409` refusal path.
3. Should on-demand widths replace pre-declared renditions entirely, or sit
   beside them? The bakeoff ranked Snapback ahead on capability and PocketBase
   ahead on DX for the same axis, which usually means the two are separable.
4. What is the smallest honest asset surface that still supports the Clique
   and Coterie briefs? Both needed avatars and post media; neither needed
   collections, commands, or grants.
