# Panel: LLP 1006 — the ideal media/asset API for Snapback 2 (codex gpt-5.6-sol)

**Reviewed:** `llp/1006-assets.rfc.md` revision (b) at `cc7eb764f`, with
`llp/1005-assets-lessons-from-snapback-1.research.md`, `rules/RULES.md`,
`rules/NOT-DOING.md`, LLP 1000–1003, and the `snapback2/` sources
(`schema.rs`, `value.rs`, `engine/index.rs`, the Quarry fixtures, the
`t.*` builders) available read-only in a clean worktree.
**Family:** codex gpt-5.6-sol
**Provider/runtime:** OpenAI Codex CLI 0.151.0 (`codex exec`), model gpt-5.6-sol, reasoning effort **ultra**
**Date:** 2026-09-01
**Redacted:** No — the panelist read the in-repo documents directly in a
read-only checkout; no content left the local machine beyond the model serving
this CLI.
**Method:** Two rounds. Round 1 mutually blind, both panelists on an identical
brief. Round 2 cross-read: each panelist received the other's round-1 answer
verbatim, the orchestrator's list of settled agreements, and five numbered
disagreements to resolve.

> **Independence (LLP 0005).** Neither panelist authored LLP 1006; it was
> drafted by Claude (Opus 5), which orchestrated this panel and did not vote.
> Both panel families are non-author. The orchestrator contributed one
> substantive proposal during round 2 (the validate-not-replace option in D1),
> which is disclosed in the round-2 brief and was adopted by both panelists.

**Brief constraint, stated to both panelists as binding:** simplicity,
elegance, speed, ease, and ergonomics are priority 1; features are a floor
("can the five named apps be built"), never a scoreboard; every addition must
name what it deletes; deletions are the highest-value contribution.

---

## Round 1 (blind)

## 1. Verdict on LLP 1006

LLP 1006 has the right center and the wrong stamp. Making media a column type, putting admission policy on that column, using ordinary bounded lists, and authorizing every byte request through the containing row are exactly right. But accepting an ID and silently storing `{id,kind,w,h,hash,digest}` is not the tiny engine change the RFC claims: validation is currently pure, mutation returns preserve the authored value, and the client twin cannot consult `_assets`, so mutations would predict and return IDs while later queries returned records. I would keep the column and row-authority model but make uploads affine, file-as-field values: `upload()` returns the canonical value that mutations store unchanged, while `_assets` atomically records its one containing row/column. Delivery by asset ID follows that locator and still rechecks the row rule. This removes the input/output asymmetry, global mark-and-sweep, stringly reference-site rendering, and the mutable-URL cache bug without weakening authority.

## 2. Ideal API

There are four things to remember:

1. Declare `image <=N`; wrap it in an ordinary list for multiple images.
2. `await client.upload(column, file)` returns the exact value accepted by a mutation.
3. The value may occupy one row/column cell. The row’s read rule governs its bytes.
4. Render it with `<AssetImage asset={value}>`.

The canonical image value is only:

```ts
type ImageAsset = Readonly<{
  id: string
  width: number
  height: number
}>
```

MIME, SHA-256, storage key, and rendition facts remain internal or HTTP metadata.

### Quarry

This uses integer byte bounds because that is Quarry’s actual numeric syntax; `5mb` is not currently real grammar.

```q
use identity

table profiles:
  handle: text <=40
  avatar: image <=5000000 ?
  read r <- r.id = viewer
  insert r <- r.id = viewer
  update r <- r.id = viewer
  delete r <- r.id = viewer

table posts:
  author: profiles
  body: text <=500
  photos: [image <=12000000] <=4
  at: time
  by byAuthorAt: author, at
  public
  insert r <- r.author = viewer
  update r <- r.author = viewer
  delete r <- r.author = viewer

mutation setAvatar(avatar: image <=5000000) -> profiles:
  ~profiles[viewer] { avatar }
  profile = profiles[viewer]! else PROFILE_NOT_FOUND
  profile { * }

mutation publish(body: text <=500, photos: [image <=12000000] <=4) -> posts:
  post = +posts { author: viewer, body, photos, at: now }
  post { * }
```

`image` means a fixed platform policy: detect bytes rather than trust MIME, accept JPEG/PNG/HEIC, strip location metadata unconditionally, normalize HEIC, and produce a bounded primary plus one fixed thumbnail. There is no accept-list, strip, rendition, or delivery declaration.

### TypeScript twin

```ts
import { table, t, rule, mutation } from "snapback2"

export const profiles = table({
  columns: {
    handle: t.text(40),
    avatar: t.optional(t.image(5_000_000)),
  },
  indexes: {},
  rules: {
    read: rule.viewerIs("id"),
    insert: rule.viewerIs("id"),
    update: rule.viewerIs("id"),
    delete: rule.viewerIs("id"),
  },
})

export const posts = table({
  columns: {
    author: t.ref(profiles),
    body: t.text(500),
    photos: t.list(t.image(12_000_000), { max: 4 }),
    at: t.time(),
  },
  indexes: {
    byAuthorAt: { columns: ["author", "at"] },
  },
  rules: {
    read: rule.public("published posts"),
    insert: rule.viewerIs("author"),
    update: rule.viewerIs("author"),
    delete: rule.viewerIs("author"),
  },
})

export const setAvatar = mutation(
  { avatar: t.image(5_000_000) },
  ({ db, ctx, args }) => {
    db.update(profiles, ctx.viewer, { avatar: args.avatar })
    return db.get(profiles, ctx.viewer)
  },
)

export const publish = mutation(
  {
    body: t.text(500),
    photos: t.list(t.image(12_000_000), { max: 4 }),
  },
  ({ db, ctx, args }) =>
    db.insert(posts, {
      id: ctx.newId(),
      author: ctx.viewer,
      body: args.body,
      photos: args.photos,
      at: ctx.now(),
    }),
)
```

The generated client API gets one reserved namespace for schema-column handles. This avoids colliding with operation names:

```tsx
const avatar = await client.upload(
  api.assets.profiles.avatar,
  pickedFile,
  { onProgress: ({ sent, total }) => setProgress(sent / total) },
)

await client.mutation(api.profiles.setAvatar, { avatar })

return profile.avatar
  ? <AssetImage asset={profile.avatar} thumb alt="Avatar" />
  : null
```

For four photos:

```tsx
const photos = await Promise.all(
  files.map((file) => client.upload(api.assets.posts.photos, file)),
)

await client.mutation(api.posts.publish, { body, photos })

return post.photos.map((photo) => (
  <AssetImage key={photo.id} asset={photo} thumb alt="" />
))
```

`client.upload()` resolves only after finalization reaches `ready`. It persistently associates the source fingerprint with its upload URL, obtains the authoritative offset and finalization state with `HEAD`, and resumes automatically when the same file is selected again. The create request carries its expected length; browser CORS includes `PATCH` and `HEAD`. There is no public start/pause/resume/status algebra.

If any of the four uploads fails, `Promise.all` rejects and the mutation is never sent. Successful siblings remain unattached and are reclaimed later. If attachment itself fails—wrong owner, stale policy, reused asset, excessive list length—the ordinary SQLite mutation rolls everything back. No partial post exists.

### Attachment and delivery

An unattached upload can be claimed by one `(table,row,column)` cell. A list of four images is one cell with four separately owned assets; the locator does not include an index, so reordering does not change identity.

Replacement performs three actions in the same transaction:

- Clear the old avatar’s locator.
- Claim the new upload for `profiles/<id>/avatar`.
- Patch the row.

Delivery is consequently simpler than 1006’s route:

```text
GET /api/asset/as_123
GET /api/asset/as_123/thumb
```

The server looks up `as_123`’s sole locator, point-reads that row under the viewer’s normal read rule, and verifies that the scalar field equals—or bounded list contains—`as_123`. Only then does it serve bytes. A stale locator fails closed; it never grants authority.

A private response is `no-store`. A public row may use immutable caching because replacement creates a new asset ID and therefore a new URL. No system can revoke bytes someone already downloaded, but after private avatar replacement the old URL fails on its next request.

For the member photo feed, its membership-based row rule governs both the live query and every byte request. Leaving the space denies both. A DM image similarly needs only:

```q
read r <- r.sender = viewer or r.recipient = viewer
```

No recipient asset grant is involved.

## 3. Cut list

Relative to LLP 1006, I would delete:

- The ID-in/record-out asymmetry. Upload, mutation input, mutation return, stored field, prediction, and query result use the same canonical value. Consequence: `upload()` waits through finalization rather than returning an early ID.

- Public `kind`, `hash`, and `digest`. `image` already supplies the kind; “hash” beside “digest” is particularly easy to remember incorrectly. Consequence: no queryable SHA or instant thumbhash blur. Width, height, and the fixed thumbnail cover the named feed’s layout and byte-cost needs.

- Table/row/column/index delivery URLs and `<AssetImage of={row} column="…" index={…}>`. Consequence: assets are affine to one cell. In return, rendering takes one value and list reorder is irrelevant.

- Multi-cell asset reuse and global row mark-and-sweep. Replacement/deletion marks removed assets as garbage transactionally; cleanup scans `_assets`, not every application row. Consequence: placing one image in an avatar and a post requires two uploads. None of the five apps needs reuse.

- The platform-owned outbox finalization job. `_assets` itself is the durable receiving/processing/ready/failed lifecycle, retried idempotently after restart. Consequence: asset finalization does not inherit generic effect tracing, `sent_unknown`, or manual requeue behavior it does not need.

- The `system` ownership escape. Consequence: effects cannot manufacture and attach assets in the first slice. No named app requires that path.

- `{assetId, progress, done}` as a task object. One promise plus an optional progress callback is enough; persistent resumption is library custody.

I would retain 1006’s major deletions: no named intents, attach calls, media commands, collections, grants, delivery profiles, author-declared renditions, or width ladder.

## 4. Add list

- Add one nullable locator to `_assets` and the single-attachment invariant. It pays for itself by deleting multi-edge tracking, refcounts, global row scanning, reference-site URL coordinates, and client route composition.

- Add generated `api.assets.<table>.<column>` handles and complete the existing upload wire with length, `HEAD` state, and proper CORS methods. This deletes string column paths, operation-name collisions, the readiness race, and any need for a separate status route.

- For native private media, add an internal short-lived session carrier understood by `<AssetImage>` and `<AssetVideo>`. It authenticates the existing login only; every request still evaluates the row rule, so it is not an authorable recipient grant. This deletes fetch-to-blob for large media and lets the browser’s native element perform byte-range seeking.

## 5. Most likely to be wrong

The affine one-cell rule is the risky bet. An author may naturally expect to forward a DM image or reuse one upload as both avatar and post media. TypeScript cannot enforce linear ownership, so that attempt becomes a runtime refusal. None of the five briefs requires reuse, and deleting it collapses both authorization routing and lifecycle machinery, so I would not prepay for multi-reference assets—but this is the first decision a real app could overturn.

## 6. Video: slice 2

Video belongs in slice 2, but slice 2 is required work, not an optional long tail. Its authoring API should be only `video <=250000000`, `t.video(250_000_000)`, the same `upload()` call, and `<AssetVideo asset={clip}>`. Honest implementation additionally requires streaming finalization, the corrected QuickTime metadata walker, a playable normalized container, authenticated native playback, and `Range`/`Content-Range`/`206` delivery. Putting it in slice 1 either ships video without the privacy property LLP 1005 actually measured or makes the image slice carry video’s entire proof matrix. Ship images first; then qualify video with a real iPhone MOV, an interrupted 100 MB upload, and seeking in a real browser before calling the five-app surface complete.
---

## Round 2 (cross-read)

Resolved position: D1 validate the canonical record; D2 use the reference-site path with an asset-ID segment; D3 omit resume; D4 keep explicit upload; D5 keep the typed destination-column handle.

## D1 — The client twin

The orchestrator’s third option is right. This sharpens, rather than changes, my round-one position.

```ts
type ImageAsset = Readonly<{
  id: string
  width: number
  height: number
}>
```

`upload()` resolves after admission and finalization and returns exactly that value. A mutation takes exactly that value—not an ID and not a `File`. The stored field, optimistic mutation result, mutation return, and later query all contain the same record.

Validation splits cleanly:

- The twin performs pure closed-shape validation: valid asset-ID syntax, positive bounded integer dimensions, no missing or extra fields. It preserves the value unchanged.
- The server repeats that validation, point-reads `_assets[id]`, requires `ready`, image kind, correct uploader, correct destination column, and bytes within that column’s bound, then verifies `width` and `height` exactly match the ledger.
- Only then does it store the supplied record unchanged.

A forged ID, altered dimension, foreign upload, or stale upload is refused by the server. That server-only refusal is no different from an authorization or database-dependent refusal: the optimistic frame rolls back. The success path no longer diverges.

“Stamping” should therefore mean that the engine ledger-validates and commits a closed canonical record, not that it rewrites an ID into a different value.

I would not expose `kind`. The column already says `image`, and the delivery response supplies the actual MIME type through `Content-Type`.

## D2 — Asset identity in the path

I change my position: choose **(b), the asset ID in the reference-site path**.

```text
GET /api/asset/<table>/<row>/<column>[/<index>]/<assetId>
```

The server evaluates that row’s read rule and verifies that the named scalar or list slot currently contains the same ID. The ID makes replacement produce a new cache key; current renderings cannot accidentally reuse the old avatar response.

Affine ownership looked smaller because it enabled `/api/asset/<id>`, but it replaces the sweep with correctness-critical locator bookkeeping across replacement, list edits, deletion, reset, and migration. More importantly, it makes an ordinary-looking TypeScript value secretly linear. Reusing one’s own image in another row type-checks and then fails because some earlier write claimed it. That is precisely the sort of rule an agent will hold incorrectly.

The dumb mark-and-sweep is preferable because it is outside authority: it may lag without leaking bytes. Affinity makes claim and release part of transactional correctness.

For public rows, an already-cached old URL may remain readable; those bytes were public and downloadable already. The repaired guarantee is that new row state generates a different URL. Private responses remain `no-store`, so an old path reaches the server and 404s.

## D3 — Resume in slice 1

I change my position: slice 1 does **not** need resumability.

Use one streaming `POST` that waits through finalization and returns the ready `ImageAsset`. A dropped 12 MB photo retries in full.

The measurement was a 120 MB video. Keeping TUS “behind one promise” hides none of its implementation apparatus: create/PATCH/HEAD routes, upload fingerprints, durable offsets, expiry reconciliation, chunk negotiation, TUS CORS, and additional failure tests all remain.

Video slice 2 restores TUS with persistent client offset custody. The author-facing call can remain `upload(...)`, so adding the justified wire machinery need not change application code.

## D4 — `File` in mutation args

I hold: keep explicit `upload()`.

A browser `File` is not a Quarry value, JSON mutation argument, or value the twin can evaluate. Expo and Exact also have different byte carriers. Making `mutation.run({ avatar: file })` work requires a client-only recursive preprocessor that discovers files, uploads them, manages partial sibling success, rewrites the arguments, and only then invokes the mutation.

That removes one application line while adding a second meaning to every mutation call. It also implies false atomicity: upload can succeed and the mutation can still reject.

The honest model is two visible phases:

```ts
const avatar = await client.upload(api.assets.profiles.avatar, file)
await client.mutation(api.profiles.setAvatar, { avatar })
```

Progress remains an optional callback on `upload()`. There is no combined platform helper in slice 1.

## D5 — Destination column at upload

I hold: upload names the destination using a generated typed handle.

```ts
client.upload(api.assets.profiles.avatar, file)
```

This is justified by today’s byte bound, not merely a hypothetical accept list. Column-less upload lets an 8 MB image upload, normalize, and thumbnail successfully before a 5 MB avatar mutation rejects it. The declared policy should fail before that work.

The same field handle also gives D2 a typed delivery coordinate, so it deletes three things:

- a generation-wide upload ceiling;
- late post-finalization bound failures;
- stringly table/column composition in `AssetImage`.

This is not a per-column upload authorization rule. Upload authority remains “authenticated principal”; the handle selects admission policy and records the intended destination column.

## 7 — What I would steal

I am stealing three specific parts of the other proposal:

- The asset ID as the final reference-site path segment.
- The one-POST image upload, with TUS deferred to video.
- Its insistence that staging disk have a fixed internal per-principal ceiling. That number deletes “an authenticated user may fill disk until the sweep”; it is not an author-facing rule.

## 8 — Smallest correct slice-1 API

The public image value is exactly:

```ts
type ImageAsset = Readonly<{
  id: string
  width: number
  height: number
}>
```

Quarry:

```q
use identity

table profiles:
  handle: text <=40
  avatar: image <=5000000 ?
  read r <- r.id = viewer
  insert r <- r.id = viewer
  update r <- r.id = viewer

table posts:
  author: id
  body: text <=500
  photos: [image <=12000000] <=4
  at: time
  public
  insert r <- r.author = viewer

query me():
  profiles[viewer] { id, handle, avatar }

mutation setAvatar(avatar: image <=5000000) -> profiles:
  ~profiles[viewer] { avatar }
  profile = profiles[viewer]! else PROFILE_NOT_FOUND
  profile { id, handle, avatar }

mutation publish(body: text <=500, photos: [image <=12000000] <=4) -> posts:
  post = +posts {
    author: viewer,
    body,
    photos,
    at: now
  }
  post { id, body, photos, at }
```

Client upload and mutation:

```tsx
const avatar = await client.upload(
  api.assets.profiles.avatar,
  file,
  { onProgress: ({ sent, total }) => setProgress(sent / total) },
)

await client.mutation(api.profiles.setAvatar, { avatar })
```

Four photos use the same operation:

```ts
const photos = await Promise.all(
  files.map((file) => client.upload(api.assets.posts.photos, file)),
)

await client.mutation(api.posts.publish, { body, photos })
```

Rendering uses the same generated field handle. The containing row’s `id` must therefore be present in the query result:

```tsx
<AssetImage
  of={profile}
  field={api.assets.profiles.avatar}
/>

{post.photos.map((_, index) => (
  <AssetImage
    key={post.photos[index].id}
    of={post}
    field={api.assets.posts.photos}
    index={index}
    thumb
  />
))}
```

The resulting delivery paths are:

```text
GET /api/asset/profiles/<rowId>/avatar/<assetId>
GET /api/asset/posts/<rowId>/photos/<index>/<assetId>
GET /api/asset/posts/<rowId>/photos/<index>/<assetId>/thumb
```

Every request evaluates the containing row’s read rule and verifies the slot’s current ID.

The mutation’s wire argument and the eventual read are identical:

```json
{
  "id": "as_123",
  "width": 1290,
  "height": 1720
}
```

There is no ID-to-record rewrite, `kind`, `ready`, `src`, `hash`, or `digest`.

## 9 — One more cut

If forced, I would cut the fixed thumbnail.

Serve only the bounded primary and remove `/thumb`, the `thumb` prop, the second resize, and the second stored rendition. Photo grids would download more bytes, but all five apps would remain buildable. That is a real ergonomic/performance loss, which is why it survives this round—but it is still a feature above the floor.

---

# Panel 2 (2026-09-03) — revision (i) at `4d67b2a78` (codex gpt-5.6-sol)

**Reviewed:** `llp/1006-assets.rfc.md` revision (i) at `4d67b2a78` — the
unreviewed revisions (f)–(i) — with LLP 1005, 1000–1004, 1007, `rules/`,
`benchmarks/briefs/social-messenger.md`, the previous panel record, and the
`snapback2/` and `crates/` sources available read-only in a detached worktree.
**Family:** codex gpt-5.6-sol
**Provider/runtime:** OpenAI Codex CLI 0.153.0 (`codex exec -s read-only`), model gpt-5.6-sol, reasoning effort **ultra**
**Date:** 2026-09-03
**Redacted:** No — the panelist read in-repo documents directly; no content left the local machine beyond the model serving this CLI.
**Method:** Two rounds, as below.

> **Independence (LLP 0005).** Revisions (f)–(i) of LLP 1006 were written by the
> orchestrating Claude session at the author's rulings. That session is
> disclosed as the author-side voice and is not counted as an independent
> family. Both panel families are non-author. The orchestrator's own round-1
> review was sealed before either family's round-1 output was opened; its
> round-2 positions were sealed before either family's round-2 output was
> opened.

**Brief constraint, stated to all three as binding:** simplicity, elegance,
speed, ease, and ergonomics are priority 1; features are a floor (the
capability bar's apps); every addition names what it deletes; the author's ten
rulings may be challenged only with the reasoning that justifies reopening.
Round 1 mutually blind on `brief-r1`; round 2 cross-read on `brief-r2` (all
three round-1 reviews verbatim, twelve settled agreements A1–A12, twelve
numbered disagreements D-A–D-L). Synthesis: `1006-assets.panel.synthesis.md`.

## Round 1 (blind)

## 1. Verdict

Revision (i) is not ready to implement as written. Its center remains strong: closed asset records, ordinary bounded lists, affine row authority, no attach call, and no asset-specific authorization system. The blockers are in the unreviewed expansion: it contradicts the governing format trim, lets mutations consume unauthenticated asset facts, assumes an engine delivery primitive that does not exist, gives incompatible reset/fork guarantees, misstates the ported media behavior, and omits the Expo/runtime machinery needed by the capability bar. These are repairable without reopening revisions (a)–(e), chiefly by deleting scope.

## 2. Defects

1. **Critical — revision (i) violates the binding trim.** The capability bar requires Expo plus JPEG/PNG/WebP and MP4 H.264/AAC (`benchmarks/briefs/social-messenger.md:19-22,45-49`); `rules/NOT-DOING.md:17-21` and the delegated ruling in `llp/1007-state-of-snapback2-and-the-work.plan.md:177-191` explicitly say LLP 1006 is trimmed to those formats. Generic files, HEIC, MOV, HEVC behavior, and two codec packages exceed that bar. Resolve by retaining only `image` and `video` with the brief’s formats and limits. This deletes the entire `file` branch, `as`, C HEIC codecs, and the full/slim matrix.

2. **Blocker — `duration` is forgeable when policy reads it.** Section 3 presents `require clip.duration <= 60000` as authoritative, but §6 ledger-validates only while writing an asset column (`llp/1006-assets.rfc.md:608-615`). Current execution performs pure argument validation before opening the transaction (`snapback2/crates/snapback2-core/src/engine/mod.rs:429-446,875-964`), then the program can immediately read any record field (`engine/runner.rs:323-345`). A mutation can therefore consume a forged duration and commit other work without ever storing `clip`. Ledger-validate every asset-typed mutation argument after opening the authoritative transaction and before executing the body; destination writes still perform bound and affine-claim checks. That one validator deletes both the forged-policy path and any need to revive declared duration-admission grammar.

3. **Critical — reset, forks, and content addressing are mutually inconsistent.** Reset empties blobs, while forks are SQLite-only snapshots that share and must preserve those same blobs (`llp/1006-assets.rfc.md:788-796`). Current fork and reset boundaries confirm there is no SQLite/filesystem atomic operation (`snapback2/crates/snapback2/src/writer.rs:497-510`; `snapback2-core/src/store.rs:631-647`). The three-operation blob trait also cannot enumerate a crash-orphaned CAS key, and the listed `_assets` schema does not contain the blob key §9a later requires.

   Key blobs by immutable asset ID instead. The existing allocator durably reserves non-reusable IDs (`store.rs:257-330`). Persist `receiving` first, publish `<asset-id>` and its rung keys, then mark `ready`; reset clears authority/locators and staging, after which a fork-aware sweep deletes the blob before deleting its garbage ledger row. This deletes hashing, deduplication races, derived reference counts, bucket listing, `failed` state, and impossible cross-store atomicity.

4. **Blocker — the claimed certified delivery read does not exist.** The reusable runtime method scans every table row and probes it (`snapback2-core/src/registry.rs:771-797`); `Engine::probe_rule` is crate-private and opens its own transaction (`engine/mod.rs:810-843`). Indexed lookup plus certified rule evaluation exists only inside a program runner (`engine/runner.rs:615-653`). Add one core primitive that resolves `_assets`, point-reads the located row, verifies the cell contains the ID, and evaluates the table read rule under a stored rule certificate in one read transaction; expose it through the sole-writer action channel. This deletes the possible O(table) fallback and §2’s false “no new machinery” claim while avoiding a second ACL.

   The hosted presigned `302` must also go: after redirect, bucket range requests no longer re-evaluate the row rule (`llp/1006-assets.rfc.md:776-784`). Likewise, scope “exact and immediate” revocation to requests that reach Snapback: a `public, immutable` shared-cache hit can outlive public→private or deletion. That wording correction respects the prior panel’s settled public-cache tradeoff.

5. **High — affine lifecycle coverage is incomplete.** Normal validation is pure recursive shape checking (`snapback2-core/src/engine/index.rs:402-485`), while destructive successors directly delete or rewrite rows (`successor.rs:472-557`). Dropping a table or asset column would strand claimed locators. Maintained projections copy grouping values into another row (`schema.rs:411-477`; `engine/runner_ops.rs:183-229`), which would automatically violate one-home affinity. Seeds cannot contain real assets after reset because no seed path mints their ledger rows.

   Specify one transaction-aware old-row/new-row asset-set reconciler for insert, replace, delete, and successor operations. Recursively forbid asset types in `maintain.by` and non-null asset seed values. Delete the unused `created_by=system` escape until effects can actually mint assets. These refusals delete unsupported combinations instead of adding special lifecycle paths.

6. **High — the media claims do not match the code being ported.**

   - Removing all EXIF while preserving the encoded pixels removes orientation, so phone JPEGs rotate and reported dimensions cease to be display dimensions. V1 deliberately decodes, applies orientation, and re-encodes (`crates/snapback-services/src/assets_image.rs:558-604`). Use the helper to bake orientation before stripping; delete the segment-only/exact-bitstream claim.
   - The v1 video walker accepts `&[u8]`, returns a full `Vec`, and calls `bytes.to_vec()` (`assets_video.rs:499-531`). It is not streaming. The smaller resolution is to retain the port, explicitly budget its approximately two-object memory, and serialize video finalization; delete “structurally no whole-object buffer.”
   - Its `tkhd` handling ignores the transform matrix (`assets_video.rs:446-467`), so portrait display dimensions are wrong. Add matrix interpretation, paid for by deleting MOV/HEVC scope.
   - A memory-limited helper already imposes a resolution ceiling nondeterministically. Add one fixed internal dimensions/pixels/decompression/output safety ceiling, using v1’s pre-allocation bounds (`assets_image.rs:18-44,83-179`). This deletes decompression-bomb-as-child-crash while preserving full resolution for every admitted image.
   - “Always at least as large as requested” is impossible above the source width. Define the effective width as `min(requested, source width)` and never upscale; no new refusal is needed.

7. **High — the session carrier is not yet a closed credential contract.** It is transferable during its lifetime and authenticates its viewer to every asset route, contrary to “carries no authority of its own.” Logout requires binding to the exact session epoch: current logout deletes one epoch (`snapback2-core/src/identity.rs:322-351`). Development personas have no session fence (`snapback2/src/writer_auth.rs:17-32,88-103`), so the normal `createClient({as})` loop cannot mint the proposed carrier.

   Require exact-epoch validation on every GET; define a dev carrier bound to owner incarnation plus persona; reject carrier combined with bearer/persona; redact it; and use `private, no-store` plus `Referrer-Policy: no-referrer`. Do not proactively replace a mounted media URL. For public rows, redirect a carrier URL to the canonical tokenless Snapback URL, not to a bucket. These rules delete logout-surviving credentials, ambiguous authority, public-cache loss, and the bucket redirect.

8. **High — the paved client and Expo arm are underspecified.** Runtime `Op` objects retain only their name; type parameters are erased (`snapback2/packages/snapback2/src/api.ts:3-8,24-47`), and mutation currently serializes arguments directly (`client.ts:390-397`). Generated declarations also erase numeric bounds (`compiler/src/project.ts:736-764`). Thus `.d.ts` cannot drive hidden upload substitution or runtime size checks. Runtime descriptors do already exist in `/api/manifest` (`snapback2/src/writer_ledger.rs:204-226`).

   Make substitution manifest-driven and generation-fenced, recursively covering optionals and lists and preflighting all source lengths before any upload. Add an Expo native-URI streaming source and an explicit Expo lane; the brief’s picker supplies a URI, not a browser `File` (`benchmarks/briefs/media.md:18-20`). Replace the scalar-only URL hook with a scalar/list resolver suitable for the frozen UI.

   Also correct §10’s failure statement: mutations resolve `MutationRejected`; they do not throw (`snapback2/packages/snapback2/src/types.ts:39-51`; `react.tsx:167-215`). Upload/transport failures throw; server mutation refusals remain typed results.

9. **Medium — the HTTP and helper contracts are inaccurate.** A normal GET is `200`; only one satisfiable range is `206`; an unsatisfiable range is `416`. Reuse the closed v1 parser at `crates/snapback-kernel/src/assets.rs:2810-2874`. Upload must branch before the current 1 MiB UTF-8 JSON reader (`snapback2/src/serve.rs:307-313,584-611`) and receive a separately bounded asset worker class; otherwise long streams/helper processes consume the shared JSON pool (`serve.rs:139-203`). That class deletes unbounded media fan-out and query starvation.

   Finally, a same-UID subprocess with “no store handle” can still open `.snapback/store.sqlite` (`snapback2/src/owner.rs:161-167`). Either specify an actual OS sandbox or, preferably for this slice, delete the security-boundary claim and describe the helper as crash/RSS isolation, with cleared environment, bounded output, and process-group termination.

10. **Medium — “three validation arms” materially understates lane A/C.** New structured types touch `ColumnType`, `ArgType`, rule/static typing, retention bounds, JSON conversion, index refusal, compiler lowering, and the twin (`schema.rs:154-173`; `ir.rs:21-58`; `certificate_policy.rs:1035-1077`). Revise the lane inventory and introduce one shared recursive `is_indexable` predicate; this deletes duplicated List/asset special cases.

## 3. Recommended changes, ranked

1. **Trim to the exact bar:** image and video only; JPEG/PNG/WebP ≤10 MB and MP4 H.264/AAC ≤50 MB/60 s. Delete `file`, HEIC, MOV/HEVC behavior, `as`, filename/disposition logic, and codec variants. This is the governing ruling, not discretionary scope reduction.

2. **Make asset authenticity an engine invariant:** add pre-body authoritative argument validation, the certified delivery primitive, and one row-delta lifecycle reconciler. Delete scattered claim/release hooks, unbounded rule probing, invalid maintain/seed combinations, and `created_by=system`.

3. **Use asset-ID blob keys:** retain the filesystem implementation and streaming interface, but remove CAS/deduplication and presigned delivery. Delete hash/refcount/list/race machinery and make reset/fork recovery derivable.

4. **Repair only the required media:** bake image orientation, impose fixed internal safety limits, parse video transforms and H.264/AAC, and honestly bound the existing whole-buffer walker. Delete C codecs, MOV/HEVC, and the false streaming/no-ceiling claims.

5. **Close the actual client path:** cache manifest descriptors by generation, accept browser `File` and Expo URI sources, add scalar/list URL resolution, and use the existing authority fence. Delete the `.d.ts`-as-runtime fiction, `as`, slice-1 progress callbacks, and any asset-only persona bypass.

6. **Close the wire before implementation:** specify exact session-epoch carrier behavior, full Range status/header semantics, an asset worker budget, and the real `MutationResult` failure shape. Delete proactive URL rotation, bucket redirects, and bespoke Range interpretation.

## 4. Cut list

- The complete non-media `file` branch and `AssetFile`.
- HEIC, MOV, admitted HEVC, libheif/libde265, and full/slim publishing.
- `as=` once file ambiguity is gone.
- CAS deduplication, presigned bucket redirects, and normative hosted/CDN behavior.
- Durable `failed` ledger rows and the future-only `created_by=system` escape.
- Slice-1 upload progress and security claims unsupported by an OS sandbox.

## 5. Add list

- Authoritative asset-argument validation and certified delivery lookup, paid for by deleting special admission grammar and any second byte ACL.
- Expo URI streaming plus scalar/list URL resolution, paid for by deleting generic files, codec variants, and progress.
- Orientation baking, deterministic decode ceilings, video matrix/H.264/AAC inspection, paid for by deleting HEIC/MOV/HEVC breadth.
- Exact-epoch/persona carrier handling and one bounded asset worker pool, paid for by deleting proactive refresh, presigning, and unbounded helper concurrency.
- Central affine row-delta handling plus schema refusals for maintain/seed, paid for by deleting per-write lifecycle implementations and the unused system escape.

## 6. Most likely to be wrong

The session carrier. The reopening trigger should be one real-phone test: play a private clip, background the app past the carrier TTL but not the parent session, resume, and seek. Any reload, lost position, flicker, or `401` reopens carrier lifetime and refresh design.

## 7. Rulings I would ask the author to revisit

- **Ruling 5, non-media half; ruling 7, HEIC half; ruling 10, variants:** the new controlling evidence is the already-delegated exact-format trim in LLP 1007 and `rules/NOT-DOING.md`. Keep video and WebP; delete files, HEIC, MOV, and the package matrix.
- **Ruling 6, narrowly:** keep “no author-configurable downscale ceiling,” but admit one fixed internal decode-safety ceiling. The helper’s memory cap proves a ceiling already exists; making it deterministic is simpler and safer.
- **Ruling 8, narrowly:** keep local filesystem now and an S3-compatible implementation later, but replace content addresses with asset-ID keys and remove presigned redirects. The current allocator and fork/reset model are new engine evidence that CAS adds rather than deletes machinery.

I would not reopen affine ownership, arbitrary-width ergonomics, preservation of admitted full-resolution originals, subprocess execution itself, share-link deferral, or the no-resume decision.

## Round 2 (cross-read)

## 1. Disagreements

**D-A — Hold: cut `file` from slice 1.** The binding trim and both independent reviews justify revisiting ruling 5. Keeping `file` buys future attachments but adds a third type and record across every layer, `as`, filename handling, attachment delivery, `<AssetFile>`, and a confusing partial-privacy contract. Cutting it means the first document-sharing app must add that branch later; none of the capability-bar apps is blocked.

**D-B — Hold: remove HEIC from slice 1.** HEIC is outside the named formats and uniquely introduces the C codec and cross-compilation burden. A named optional package saves default bytes but does not delete implementation, testing, documentation, or support complexity. The honest cost is that raw Photos/Safari HEIC refuses with a conversion hint; reopen when a real-phone acceptance journey actually requires raw HEIC.

**D-C — Hold, refined: publish one fixed-capability helper.** It should support JPEG, PNG, and WebP everywhere, with no full/slim install-time matrix. Claude’s useful principle is that the default installation must honor every advertised format; an internal developer build switch may survive only if loop measurements earn it. This deletes variant naming, duplicated artifacts, and capability-dependent refusal rules.

**D-D — Change: retain content-addressed keys.** I changed my mind because a fork copies the allocator namespace and high-water mark: independently writable descendants can eventually expose the same future asset ID while sharing the blob pool. CAS avoids needing a writable-fork namespace protocol and makes that collision impossible. Add `_assets.blob_key`; record the digest on the durable `receiving` row before an idempotent publish, and retain that row until cleanup succeeds—this avoids maintained refcounts and makes bucket listing unnecessary.

**D-E — Change on caching; hold on carrier scope.** Carriers belong only on `<video>`, native players, and explicit downloads; images use bearer/persona headers and blob URLs. A carrier is bound to the exact bearer epoch or dev persona/owner incarnation, is not rotated under a mounted player, and redirects to the exact tokenless Snapback URL when anonymous evaluation also admits the row. Claude convinced me that unconditional `no-store` needlessly retransfers private images, but `private, immutable` bypasses later authorization; use `private, no-cache` with an ETag and authorization before any `304`, while carrier responses remain `no-store`.

**D-F — Change: use orientation-only chunk surgery.** The explicit alternative convinced me: extract the bounded orientation value, discard all source metadata, and synthesize a fresh Orientation-only payload rather than retaining the original EXIF container. Record dimensions are post-orientation, and derived rungs bake the transform while decoding. This preserves compressed pixels and color fidelity while deleting unconditional decode/re-encode, JPEG generation loss, output expansion, and helper latency at admission; acceptance must cover orientations 2–8 on web and Expo.

**D-G — Hold: add a fixed internal decode-safety ceiling.** The helper’s RSS limit already creates an implicit, platform-dependent ceiling, so ruling 6 should be narrowed. Probe fixed dimension, pixel, decompression, and output bounds before allocation; refuse rather than downscale, so every admitted image still retains full resolution. This deletes OOM or child death as accidental admission policy.

**D-H — Hold: delete `created_by = system`.** A future consumer named in §13 does not justify a live ownership exception today. Add it atomically with effect-side minting, when its provenance and tests exist.

**D-I — Hold: describe resource isolation honestly.** The helper provides dependency/build separation plus crash, timeout, and RSS containment—not a security boundary. A same-UID child can open the known store path, and “no store handle/network” is an API convention unless an OS sandbox enforces it. Keep a cleared environment, bounded protocol/output, resource limits, and process-group termination; delete the decoder-compromise-cannot-touch-store claim.

**D-J — Hold; no dissent.** Recursively ledger-validate every asset-typed mutation argument, including optionals and lists, after opening the authoritative transaction and before executing the body. Entry validation establishes ready state, kind, bounds, and exact facts; the row-delta reconciler separately handles new ownership and same-cell carry-forward. This deletes forged policy facts and duplicated claim logic.

**D-K — Hold: add one core delivery primitive and delete presigning.** In one read transaction it must resolve `_assets`, point-read the locator row, verify the cell still recursively contains the exact ID, and evaluate that table’s read rule under its certificate. Expose only the authorized immutable delivery locator through the owner channel; this deletes table scans and any second ACL. A private presigned `302` turns the bucket URL into temporary asset authority whose later ranges bypass Snapback, so hosted private delivery must remain proxied. “Immediate” means the next request reaching Snapback; public shared-cache and already-started-stream limits should be stated separately.

**D-L — Hold: trim the RFC, not `NOT-DOING.md`.** `NOT-DOING.md` is binding, and LLP 1007 records the author-delegated ruling to trim LLP 1006 to the brief’s formats. The later rulings did not name an unblocked app or remove an offsetting doing-list item. Slice 1 should therefore be `image` and `video`, JPEG/PNG/WebP and MP4 H.264/AAC; keeping `file`, HEIC, MOV, or HEVC requires a formal contrary trade that does not currently exist.

## 2. Final recommended changes, ranked

1. Trim slice 1 to `image`/`video` and the brief’s exact formats; deletes `file`, `FileAsset`, `as`, `name`, attachment UI/privacy, HEIC, MOV, and HEVC behavior.
2. Add transactional argument authenticity plus one old-row/new-row asset reconciler; deletes forged facts, same-cell refusals, scattered claim/release hooks, unsupported maintain/seed combinations, and `created_by=system`.
3. Add the certified transactional delivery point-read; deletes table scans, duplicated authorization logic, and §2’s false “no new machinery” claim.
4. Keep CAS with an explicit blob-key field and receiving→publish→ready recovery; deletes ambiguous crash orphans, maintained refcounts, bucket listing, and destructive reset.
5. Preserve only synthesized orientation metadata and enforce fixed safety bounds; deletes unconditional lossy re-encoding and nondeterministic OOM admission.
6. Restrict carriers to video/download, bind exact identities, canonicalize public requests, and revalidate private image caches; deletes image tokens, public-cache fragmentation, and immutable-private authorization bypass.
7. Port the video walker onto staging in place, apply `tkhd`, require all facts, and verify H.264/AAC; deletes the full `Vec`, optional facts, and unsupported-container promises.
8. Make client substitution manifest-driven and recursive, add Expo URI streaming and scalar/list URL resolution, and preserve `MutationRejected`; deletes `.d.ts` runtime inference, browser-only support, and partial preflight uploads.
9. Branch asset routes before the JSON reader and add bounded upload/delivery workers plus global and per-principal staging caps; deletes JSON-pool starvation and guest-multiplied disk exhaustion.
10. Make rungs lazy, clamp effective width to the source, and never upscale; deletes eager admission work and the impossible “always at least requested” claim.
11. Publish one helper, amend LLP 1002 for its child process, and call it resource isolation; deletes the variant matrix, the spawn contradiction, and the false sandbox claim.
12. Apply exact 200/206/416 Range semantics and remove the stale `option A`, `max`, parser, and line citations; deletes wire ambiguity and copy-paste residue.

## 3. What I would steal

From Grok: in-place video blanking, mandatory video facts, and its mounted-player lifetime analysis. Those improve my round-one whole-buffer recommendation.

From Claude: the same-cell claim exception, the global staging cap, and the measured trigger for ever adding a second helper artifact. Its caching concern also led to the `private, no-cache` compromise, though not to `private, immutable`.

## 4. Verdict after the changes

Ready to implement after these revisions; revision (i) at `4d67b2a78` is not. The only remaining author decision is whether to accept the justified reversals of rulings 5, 7, and 10; rejecting them requires first reconciling `NOT-DOING.md` with an explicit named trade.

The checkout is read-only, so I could not append this cross-read to the repository’s review artifact.
