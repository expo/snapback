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