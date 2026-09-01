# Panel: LLP 1006 — the ideal media/asset API for Snapback 2 (grok-4.6)

**Reviewed:** `llp/1006-assets.rfc.md` revision (b) at `cc7eb764f`, with
`llp/1005-assets-lessons-from-snapback-1.research.md`, `rules/RULES.md`,
`rules/NOT-DOING.md`, LLP 1000–1003, and the `snapback2/` sources
(`schema.rs`, `value.rs`, `engine/index.rs`, the Quarry fixtures, the
`t.*` builders) available read-only in a clean worktree.
**Family:** grok-4.6
**Provider/runtime:** Grok CLI 1.0.13 (`grok -p`), model grok-4.6, reasoning effort **xhigh**
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

The core move is right and should survive: an asset is a column type, the engine stamps a closed record at write, and bytes are served through the row that holds them. That is PocketBase’s file-as-field plus Snapback 1’s measured moat (one authority, checked per request), and it deletes the entire v1 stack above the intent — attach, sharing, delivery profiles, collections, grants, the projection seam — without losing Avatar, the feed, four photos, or a DM. Revision (b) already did the expensive simplifications. What is still wrong is that slice 1 still carries an async upload machine the named image apps do not need, and the slot URL (`…/avatar` with no asset id) reintroduces the replacement/cache bug the authority model claimed to close. Shrink the upload to one POST that returns a ready id; put the id in the delivery path; drop two stamp fields authors will confuse. Do not go back to a named intent, a `Ref` onto `_assets`, a width ladder, a refcount, or an upload rule.

## 2. The API

Five things to hold. Policy is the column. You send an id (or a `File`; the client sends the id). You read `{ id, kind, w, h }`. Bytes live at a path derived from the row plus that id. There is no attach, no intent, no profile, no `ready` bit, no digest/hash pair.

**Admission, not declared:** JPEG/PNG/HEIC; HEIC becomes JPEG; GPS always stripped; a primary (max edge 2048) and a 256px thumb, both at admission; original discarded. `image` is the accept list. Bound is bytes. Upload authority is “logged in”; an unreferenced blob is undeliverable and then swept.

**Engine write:** input to an `image` column is `Value::Id` only. Stored/read value is `Value::Row` `{ id, kind, w, h }`. Callers cannot supply `w`/`h`. Stamp checks: ledger row exists and is `ready`; `created_by` is the writer or `system`; byte size ≤ this column’s bound. Then replace the id. Same three facts, no `E_ASSET_COLUMN` — the bound is a column constraint, like `text <=40`.

### Avatar

```
use identity

table profiles:
  handle: text <=40
  avatar: image <=5mb ?
  unique handle
  read r <- r.id = viewer
  insert r <- r.id = viewer
  update r <- r.id = viewer
  delete r <- deny

query me():
  profiles[viewer] { handle, avatar }

mutation setAvatar(avatar: image <=5mb):
  ~profiles[viewer] { avatar }

mutation clearAvatar():
  ~profiles[viewer] { avatar: null }
```

```ts
export const profiles = table({
  columns: {
    handle: t.text(40),
    avatar: t.optional(t.image(5_000_000)),
  },
  indexes: { byHandle: { columns: ["handle"], unique: true } },
  rules: {
    read: rule.viewerIs("id"),
    insert: rule.viewerIs("id"),
    update: rule.viewerIs("id"),
    delete: rule.deny(),
  },
})

export const me = query({}, ({ db, ctx }) => {
  const row = db.get(profiles, ctx.viewer)
  return row && { handle: row.handle, avatar: row.avatar }
})

export const setAvatar = mutation(
  { avatar: t.image(5_000_000) },
  ({ db, ctx, args }) => {
    db.update(profiles, ctx.viewer, () => ({ avatar: args.avatar }))
  },
)
```

Widen `read` to `public` and the same bytes become pasteable. Privacy is the table’s read rule. That is the whole privacy API.

```tsx
const profile = useQuery(api.profiles.me, {})
const setAvatar = useMutation(api.profiles.setAvatar)

<input
  type="file"
  accept="image/*"
  onChange={(e) => {
    const file = e.target.files?.[0]
    if (file) setAvatar.run({ avatar: file })
  }}
/>
{profile.data?.avatar && (
  <AssetImage of={profile.data} column="avatar" />
)}
```

`run({ avatar: file })` is the client doing `POST /api/upload` then the JSON mutation. Authors of this app never call `upload`. Replacement is an update; the old id is no longer in the row; the old path 404s on the next GET; the sweep takes the bytes.

### Photo feed, four photos, leave-revokes

```
table spaces:
  name: text <=40
  public
  insert r <- allow

table members:
  space: spaces
  user: id
  unique space, user
  read r <- r.user = viewer
  insert r <- r.user = viewer
  delete r <- r.user = viewer

table posts:
  space: spaces
  author: id
  body: text <=500
  photos: [image <=12mb] <=4
  at: time
  by bySpaceAt: space, at
  read r <- exists members[space, viewer]
  insert r <- r.author = viewer and exists members[space, viewer]
  delete r <- r.author = viewer

query feed(space: spaces):
  posts[space] first 50 by bySpaceAt {
    id, body, at, photos,
    author: profiles[.author] { handle, avatar },
  }

mutation publish(space: spaces, body: text <=500, photos: [image <=12mb] <=4) -> posts:
  require exists members[space, viewer] else NOT_MEMBER
  post = +posts { space, author: viewer, body, photos, at: now }
  post { id, photos }
```

```ts
export const posts = table({
  columns: {
    space: t.ref(spaces),
    author: t.id(),
    body: t.text(500),
    photos: t.list(t.image(12_000_000), { max: 4 }),
    at: t.time(),
  },
  indexes: { bySpaceAt: { columns: ["space", "at"] } },
  rules: {
    read: rule.exists(members, "bySpaceUser", [rule.field("space"), rule.viewer]),
    insert: rule.and(
      rule.viewerIs("author"),
      rule.exists(members, "bySpaceUser", [rule.field("space"), rule.viewer]),
    ),
    update: rule.deny(),
    delete: rule.viewerIs("author"),
  },
})

export const publish = mutation(
  {
    space: t.ref(spaces),
    body: t.text(500),
    photos: t.list(t.image(12_000_000), { max: 4 }),
  },
  ({ db, ctx, args }) => {
    db.require(
      db.exists(members.bySpaceUser, [args.space, ctx.viewer]),
      "NOT_MEMBER",
    )
    const id = ctx.newId()
    db.insert(posts, {
      id,
      space: args.space,
      author: ctx.viewer,
      body: args.body,
      photos: args.photos,
      at: ctx.now(),
    })
    return db.get(posts, id)
  },
)
```

```tsx
const feed = useQuery(api.posts.feed, { space })
const publish = useMutation(api.posts.publish)

async function onPublish(files: File[]) {
  if (files.length < 1 || files.length > 4) return
  await publish.run({ space, body, photos: files })
}

{feed.data?.map((post) =>
  post.photos.map((photo, i) => (
    <AssetImage key={photo.id} of={post} column="photos" index={i} thumb />
  )),
)}
```

If file 3 fails, `run` throws and no row is written. Staging ids from 1–2 are unmarked; the sweep deletes them. The post is not half-created. Leaving is `-members[…]`; the next `feed` frame is empty and the next byte GET is the table’s read refusal. Deleting the post 404s every path under that `rowId`.

DM is the same column on a tighter table: `photo: image <=12mb ?` with `read r <- r.from = viewer or r.to = viewer`. No grants.

### Wire

```
POST /api/upload
Authorization: Bearer …
Content-Type: image/jpeg   (detected type wins; this is a hint)
<body = bytes>
→ { "id": "as_…" }         // ready. not staging.
   | 422 { code: "E_ASSET_TYPE"|"E_ASSET_TOO_LARGE", family: "input", … }

POST /api/mutation
{ "op": "posts.publish", "args": { "space": "…", "body": "…", "photos": ["as_1","as_2"] } }

GET /api/asset/<table>/<rowId>/<column>/<assetId>
GET /api/asset/<table>/<rowId>/<column>/<assetId>/thumb
GET /api/asset/<table>/<rowId>/<column>/<index>/<assetId>
GET /api/asset/<table>/<rowId>/<column>/<index>/<assetId>/thumb
```

One point read of the row under the table’s `read` rule; the cell (or list slot) must be a stamp whose `id` equals the path. Mismatch is 404 — replacement, not “maybe cached.” Public read rule: no credential, `Cache-Control: public, immutable` (the id is the cache key). Anything else: Bearer, `no-store`. `<img src>` works on public tables; private tables go through `AssetImage`, which `fetch`es with the session and paints a blob URL. Do not add signed query tokens.

`POST /api/upload` admits up to the max `image` bound in this generation. The column bound is re-checked at stamp, so a 8 MB file destined for a 5 MB avatar fails at the mutation, the same way an overlong string does. Limits are the schema; they are already in `api.d.ts`. Do not add a create-round-trip that restates them.

`client.upload(file)` exists for progress UIs. Avatar and four-photo do not need it. It is the same POST.

Read shape:

```json
{ "id": "as_…", "kind": "image/jpeg", "w": 1290, "h": 1720 }
```

`kind` is the stored type after HEIC-normalize. `w`/`h` are the primary — Diary 0087’s Expo tiles collapse without them. No `hash`, no `digest`, no `src`, no `ready`.

## 3. Cut list (from 1006 b)

| Cut | Consequence |
|---|---|
| TUS (`PATCH`, `HEAD`, offset custody, `chunkMax`, tus CORS headers) | Slice 1 is one POST. A 12 MB photo on a dropped connection retries in full. Video brings TUS back as the reason it exists. |
| `{ column: "posts.photos" }` on upload, and `E_ASSET_COLUMN` | Policy is the column bound at stamp. One upload id may be stamped onto any `image` column the writer owns and that can hold it. |
| `hash` (thumbhash) on the stamp | Tiles are empty until bytes arrive. Deletes the `hash`/`digest` pair agents will swap. |
| `digest` on the stamp | Authors cannot query sha256. The ledger may still keep it for `snapback2 data`. Clique and Coterie do not need it. This is Convex-envy; the ranking forbids that. |
| Slot URL without asset id | Gone. Public long-cache of `/avatar` would keep serving a replaced face; id in the path makes the cache key the bytes, and the old paste 404s. |
| Create-then-PATCH, author-visible `staging`/`ready` | POST returns only after finalize. `E_ASSET_NOT_READY` remains as a forged-id refusal, not a happy-path state. |
| Finalize as an `_outbox` job in slice 1 | Request thread waits on a worker that does not hold the writer lock, then one small ready-write, then 200. Outbox stays for effects. Video’s long finalize is the reason to put jobs back on it. |
| `client.upload(api.posts.photos, file)` as the paved call | Paved call is `mutate({ photos: files })`. `upload` is the escape hatch. |
| Stamped `src` | Would freeze the route in every row. Client composes; `AssetImage` is the composition. |

Keep, explicitly: column type; stamp; bytes-through-row; `[image] <=4`; no intent; no attach; no delivery profiles; no collections; no grants; always-strip; HEIC; two fixed renditions; mark-and-sweep; `created_by`; `system` for `then`; CORS on the upload route (ordinary headers, not TUS).

## 4. Add list

**Asset id as a path segment.** Named apps cannot keep “old bytes stop being served” *and* cache public images if the URL is the slot. Paid for by deleting the slot URL and the long-TTL replacement leak.

**`File` in image-typed mutation args, client-side.** Not a new engine capability. Paid for by deleting `upload` from the avatar and four-photo happy paths.

**A staging-disk number** (e.g. 256 MB or 20 objects per principal). Paid for by deleting “authenticated users can fill the disk until the sweep.” A number, not a rule.

Nothing else. No ladder, no codec facts, no residue protocol, no seed-media syntax (tests upload as a persona), no cookie auth, no third rendition.

## 5. Most likely wrong here

Dropping TUS and column-at-upload together. A 12 MB phone photo on a flaky radio is a real Clique path, and v1’s 0-byte resume was measured. Putting TUS under the client with no author-facing surface would keep the guarantee and still leave the Quarry/TS API as small as this — I cut it as apparatus, and that may be the wrong layer. Column-less upload also has no place to hang a later per-column accept list (`avatar` PNG-only, `video` H.264/AAC); the first such policy reintroduces a destination at POST. If that policy arrives, naming the column at upload is the add, and it deletes the “max of any image column” admission bound.

Second risk: `{ id, kind, w, h }` without thumbhash. The feed will flash empty. That is not a build-blocker; it is the cheapest later field, and it must be named `thumbhash` if it returns, never `hash`.

## 6. Video: slice 2

Slice 2. Clique’s short clip and the 100 MB resume/seek app need a `video` column that is the same shape — `clip: video <=100mb ?`, same stamp, same path, same mutate-with-File — plus three things image POST cannot fake: the QuickTime walker (with the `meta`-is-not-a-fullbox fix and a real iPhone MOV in the corpus), TUS with client offset custody, and `Range` on GET. Shipping video in slice 1 either serves unstripped GPS (giving up the one bakeoff differentiator that is already in the image path) or pulls the walker, the decoder, and the resume machine into the first binary. The authoring API does not change when it lands; it gains one word. `E_ASSET_TYPE` on `video/mp4` and `video/quicktime` is the deferral. Seeking is a delivery header, not a schema concept. Codec/duration admission waits for that slice too — Coterie’s 60 s H.264 rule is unenforceable until then, and client-side checks are not authority.

---

## Round 2 (cross-read)

D1 — I change my position.** The orchestrator is right. ID-in / record-out is a twin bug I missed.

The 7.8 KB evaluator is pure, mutation returns keep the authored value, and the twin cannot read `_assets`. A stamp that *replaces* an id with `{id, width, height}` makes an optimistic `setAvatar` predict an id while the next query returns a record. That is illegal in this engine.

Do not replace. Validate. Input equals output.

- `POST /api/upload` / `client.upload(file)` returns **after finalize**, the canonical value `{ id, width, height }`. Ready. Not an id. Not staging.
- A mutation takes **that same record**. The wire is the record, never a bare id. `valid_column_value` (twin and server) checks shape only: a row with `id: string`, `width: int`, `height: int`. Unique ids inside a list.
- In the writing transaction the server additionally checks the ledger: the row exists and is `ready`; `created_by` is the writer; locator is null; `{id, width, height}` **equals** the ledger; bytes ≤ this column’s bound. Then it **stores the argument unchanged** and claims the locator.
- Forged dimensions, someone else’s id, a made-up id, or a claimed id are `input` refusals, same family as an overlong string. The twin does not need `_assets` to predict; a forge rolls back like a unique-handle collision.

`File` is not an engine type. The SDK uploads, substitutes `File → record`, then the twin runs. That is why File-in-mutate does not reintroduce the asymmetry.

Their design was this shape. Mine was the bug. The orchestrator is the precise statement of the check.

**D2 — I change my position: affine.** `GET /api/asset/<assetId>`.

Id-as-a-path-segment looks like the smaller patch. It is the worse one, because of what a URL is *for*. Byte authority is the row’s read rule. If one asset can live in two rows, `GET /api/asset/<id>` is not well-defined — the server would have to pick a row, and the public copy wins. So a multi-home asset **must** name the row in the URL, which means `<AssetImage of={row} column index>` on every tile. That is the high-frequency thing an agent holds wrong. Index in the path 404s a still-live photo on reorder. Mark-and-sweep walks every application table.

Affine is the smaller *authoring* surface. One nullable locator `(table, row, column)` on `_assets`, **no index**. A list of four is one cell and four separately owned assets. Delivery: look up the id, follow the locator, point-read that row under the ordinary `read` rule, verify the cell (or list) still contains the id, serve. Stale locator fails closed. Replacement clears the old locator and claims the new one in the same transaction. Delete does the same. GC is `locator IS NULL` — scan `_assets`, not application rows. `<AssetImage asset={photo} />`. Reorder does not change identity. Public: `Cache-Control: public, immutable` (the id *is* the cache key). Private: Bearer, `no-store`. A replaced avatar’s old URL 404s.

The TypeScript-can’t-enforce objection does not win. Linear ownership is a runtime refusal on a path the paved API never takes: `run({ avatar: file })` uploads a fresh asset each time. Reuse is a feature the five apps do not need; keeping it is a scoreboard. The first app that needs “this DM image is also a post” is the moment to add multi-home, and it would put the row back in the URL and **delete the locator**.

Path-segment keeps the bad rendering API and row-scan GC, and either forbids reuse anyway (you paid the constraint without the deletions) or allows reuse and makes GET-by-id incorrect.

**D3 — No. Slice 1 does not need resume.** I hold this, and I withdraw the round-1 apology.

Hidden TUS fails the ranking: hiding the algebra does not delete `PATCH`, `HEAD`, offset custody, fingerprint persistence, or the TUS CORS headers. That is still apparatus. LLP 1005 §4 measured 0-bytes-retransmitted on a **120 MB video**. Clique’s photo is 12 MB; a dropped POST retries in full. TUS returns with `video`, which is why it exists. `Content-Length` may still refuse oversize before the body ends. That is not resume.

**D4 — Hold: `mutate({ photos: files })` is the pavement.**

Their two-phase is honesty about HTTP, not about the authoring model. A column type means the field takes an image. Requiring `upload()` then `mutate()` is `attach()` renamed. An agent that must call two functions will forget one; an agent that assigns a `File` to an `image` field is holding it right.

The engine never sees `File` (D1). Client generated types accept `File | ImageAsset`; server handlers receive `ImageAsset`. Progress is `onProgress` on `run`, or the unpaved `upload()` for a progress UI that is not yet committing. If file 3 of 4 fails, `run` throws, no row is written, unclaimed siblings are swept.

**D5 — Hold: upload is column-less.**

`api.assets.<table>.<column>` *is* the per-column upload rule, already settled deleted. If the handle is not enforced at claim, it is a lie. If it is enforced, it is the rule. It also adds a generated namespace to avoid a collision that only exists because of the namespace.

The bound is already on the mutation argument (`t.image(5_000_000)`). File-in-mutate can fail the POST from that number. Bare `upload(file)` admits up to this generation’s max `image` bound; the column bound is re-checked at claim, like `text <=40`. A future PNG-only column is the add that puts the destination back, and it deletes the max-of-any-image admission cap. Do not prepay.

## 7. Steal

- The twin diagnosis (D1).
- Affine locator, `GET /api/asset/<id>`, `<AssetImage asset={…}>`, locator without index (D2).
- Quarry integer bounds (`<=5000000`). `5mb` is not grammar; `this.number()` is.
- Public stamp `{ id, width, height }`. Cut `kind` (HTTP `Content-Type` carries it). Spell `width`/`height`, never `w`/`h`.
- `_assets` is its own receiving/ready/failed lifecycle. Do not hang image finalize on the generic outbox.
- Cut the `system` ownership escape. Slice 1 effects do not mint assets.

Do not steal: hidden TUS, `api.assets` handles, the session carrier (that is video’s native-element problem).

## 8. Slice-1 API (the implementer sketch)

**Policy, not declared.** JPEG/PNG/HEIC; detect bytes, never trust MIME; HEIC → JPEG; GPS always stripped; primary max-edge 2048 plus one 256px thumb, both at admission; original discarded. Bound is bytes. Upload authority is “logged in.” An unclaimed blob is undeliverable, then swept. Staging cap is a number per principal (e.g. 256 MB / 20 objects), not a rule. CORS is ordinary headers, not TUS.

**Value.** One closed record, every layer:

```ts
type ImageAsset = { id: string; width: number; height: number }
```

**Quarry** (real grammar: integer bounds):

```
use identity

table profiles:
  handle: text <=40
  avatar: image <=5000000 ?
  unique handle
  read r <- r.id = viewer
  insert r <- r.id = viewer
  update r <- r.id = viewer
  delete r <- deny

table members:
  space: spaces
  user: id
  unique space, user
  read r <- r.user = viewer
  insert r <- r.user = viewer
  delete r <- r.user = viewer

table posts:
  space: spaces
  author: id
  body: text <=500
  photos: [image <=12000000] <=4
  at: time
  by bySpaceAt: space, at
  read r <- exists members[space, viewer]
  insert r <- r.author = viewer and exists members[space, viewer]
  delete r <- r.author = viewer

mutation setAvatar(avatar: image <=5000000):
  ~profiles[viewer] { avatar }

mutation publish(space: spaces, body: text <=500, photos: [image <=12000000] <=4) -> posts:
  require exists members[space, viewer] else NOT_MEMBER
  post = +posts { space, author: viewer, body, photos, at: now }
  post { id, photos }
```

Widen `profiles` read to `public` and the same bytes become pasteable. Privacy is the table’s read rule. Leave is `-members[…]`; the next feed frame is empty and the next byte GET is the table’s read refusal. DM is `photo: image <=12000000 ?` with `read r <- r.from = viewer or r.to = viewer`. No grants.

**TypeScript twin** — same types; handlers see records, never `File`:

```ts
export const setAvatar = mutation(
  { avatar: t.image(5_000_000) },
  ({ db, ctx, args }) => {
    db.update(profiles, ctx.viewer, () => ({ avatar: args.avatar }))
  },
)

export const publish = mutation(
  {
    space: t.ref(spaces),
    body: t.text(500),
    photos: t.list(t.image(12_000_000), { max: 4 }),
  },
  ({ db, ctx, args }) => {
    db.require(db.exists(members.bySpaceUser, [args.space, ctx.viewer]), "NOT_MEMBER")
    const id = ctx.newId()
    db.insert(posts, {
      id, space: args.space, author: ctx.viewer,
      body: args.body, photos: args.photos, at: ctx.now(),
    })
    return db.get(posts, id)
  },
)
```

**Client call** (paved). Generated client args accept `File | ImageAsset`. The SDK POSTs, waits for ready, then mutates with the record.

```tsx
setAvatar.run({ avatar: file })
publish.run({ space, body, photos: files })   // 1–4 Files

{profile.avatar && <AssetImage asset={profile.avatar} alt="" />}
{post.photos.map((photo) => (
  <AssetImage key={photo.id} asset={photo} thumb alt="" />
))}
```

Escape hatch: `const a = await client.upload(file, { onProgress })` — column-less, same POST, same record — then `setAvatar.run({ avatar: a })`.

**Wire.**

```
POST /api/upload
Authorization: Bearer …
Content-Type: image/jpeg          (hint; detected type wins)
Content-Length: …
<body = bytes>
→ { "id": "as_…", "width": 1290, "height": 1720 }
   | 422 { code: "E_ASSET_TYPE"|"E_ASSET_TOO_LARGE", family: "input" }

POST /api/mutation
{ "op": "posts.publish",
  "args": { "space": "…", "body": "…",
            "photos": [{ "id": "as_1", "width": 1290, "height": 1720 }] } }

GET /api/asset/<assetId>
GET /api/asset/<assetId>/thumb
```

Claim checks: ready, writer, unclaimed, record equals ledger, bytes ≤ column bound. Already-claimed is `E_ASSET_IN_USE`. `E_ASSET_NOT_READY` is a forged-id refusal, not a happy-path state. No `E_ASSET_COLUMN`.

**Read shape** — stored, returned, predicted, identical:

```json
{ "id": "as_…", "width": 1290, "height": 1720 }
```

No `kind`, `hash`, `digest`, `src`, `ready`. Private `<img>`: `AssetImage` fetches with the session and paints a blob URL. No signed query tokens.

## 9. One more cut

The author-visible `client.upload()`. Preview is the local `File`. Progress is `onProgress` on `run()`. That deletes the second verb so the two-phase cannot be held wrong.
