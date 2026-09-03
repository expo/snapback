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


---

# Panel 2 (2026-09-03) — revision (i) at `4d67b2a78` (grok-4.6)

**Reviewed:** `llp/1006-assets.rfc.md` revision (i) at `4d67b2a78` — the
unreviewed revisions (f)–(i) — with the same corpus and read-only worktree as
the codex panelist.
**Family:** grok-4.6
**Provider/runtime:** Grok CLI 1.0.13 (`grok --prompt-file … --output-format plain`), model grok-4.6, reasoning effort **xhigh**
**Date:** 2026-09-03
**Redacted:** No — as above.
**Method:** Two rounds, as below. The CLI's plain output prefixes a few lines of
tool narration; they are omitted here, and the review body is otherwise verbatim.

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

**Family:** grok-4.6  
**Provider/runtime:** xAI Grok (this session), grok-4.6  
**Date:** 2026-09-03  
**Reviewed:** `llp/1006-assets.rfc.md` revision (i) at `4d67b2a78`  
**Redacted:** No  
**Method:** Round 1, mutually blind. Did not author LLP 1006.

Independence: this session did not write revisions (a)–(i). Settled panel findings on (a)–(c) (validate-not-stamp, id in the path, no TUS in slice 1, no `kind`/`hash`/`digest`, integer bounds, `File` in `run()`, no destination-column handle) are treated as closed.

---

## 1. Verdict

Revision (i) is **not ready to implement as written**. The center that (c) already got right should not move: a column type, one closed record per kind, validate-not-replace, byte authority as the row’s read rule, video as a ported walker plus `Range`/`206`, decode out of the engine process. What (f)–(i) added on top of that is half a slice too wide and three times incorrect against the engine as it exists. Before lane A or B starts, fold the defects in §2 — EXIF orientation, `reset` vs fork-shared blobs, the session carrier on personas and on public image URLs — and cut `file` from slice 1. After that, the remaining surface (image + video, one POST, row-authorized GET, helper subprocess) is the floor the brief actually names, and it can be built.

## 2. Defects

**D1 — High. Stored originals are not display pixels.**  
§4 says strip is a chunk walk that “leaves the pixel data … in place” and that decode happens only for derived widths and HEIC. v1 does the opposite on purpose: `ASSET_CANONICALIZATION_STRIP_IMAGE_V1` is “decode → corrective orientation → re-encode” (`crates/snapback-kernel/src/assets.rs:91–95`), and inspection dimensions are post-orientation (`crates/snapback-services/src/assets_image.rs:465–495`, `apply_orientation` at `:266`). iPhone JPEGs are almost always Orientation 6. Strip the EXIF, keep SOF pixels, and the avatar in M1 is sideways; `width`/`height` on the record are sensor pixels, not the “display pixels” §1 promises; derived `?w=` from that source is also unrotated because the orientation tag is gone. §15’s “real phone” acceptance will catch this on the first fixture.  
**Resolve:** the stored original is stripped *and oriented*. That is pixel production, so it runs in `snapback2-media` for every `image` finalize, not only HEIC and rungs. Delete the claim that JPEG/PNG/WebP admission is decode-free.

**D2 — High. `reset` as written deletes fork bytes.**  
§9a says `fork` is a sqlite snapshot that *shares* content-addressed blobs, and the sweep treats every ledger under `.snapback/` as a referrer. Two sentences later, `reset` “empties `.snapback/blobs/` … in the same operation that clears the rows.” Today `Action::Fork` is `store.snapshot_to` (`snapback2/crates/snapback2/src/writer.rs:497–511`) and `Action::Reset` is `reset_and_seed` (`:1071–1096`) — rows, not a sidecar directory. Emptying the blob dir makes “restoring a fork never restores a row whose bytes are gone” false the first time someone `snapback2 reset`s with a fork present. That is v1’s orphan-after-reset bug inverted.  
**Resolve:** `reset` clears live `_assets` and then runs the same sweep as reclamation. It does not `rm -rf` `.snapback/blobs/`. Staging can still be wiped.

**D3 — High. Session carrier is specified against bearer sessions; the loop’s ordinary identity is a persona.**  
`POST /api/auth/asset-session` is “minted from an authenticated session” and “logout revokes it” (§2b). The owner’s default identity is not a session. `serve.rs:560–568` is `Identity::Persona | Bearer | Anonymous`; persona and bearer are mutually exclusive at the wire (`serve.rs:226–227`) and in React (`react.tsx:50`). Persona clients are forbidden from installing a bearer (`client.ts` “dev persona clients cannot … a bearer session”). `<video>` cannot send `X-Snapback-As`. `snapback2 test` and `--as` — the path §15’s journeys will actually use — therefore cannot play a private clip under the contract as written.  
**Resolve:** mint the carrier from `Identity`, including persona. Logout still kills bearer-bound carriers. Persona carriers die when the persona header would have.

**D4 — High. Carrier on every authenticated URL kills the public cache the same section sells.**  
§2b: the SDK attaches `?s=` “whenever the client is authenticated.” §9a: `public, immutable` responses are shaped for a CDN. Those two sentences cannot both be true. Clique users are signed in; M2 Global avatars would all be per-viewer, minutes-lived cache keys. Revision (c) already had the cheaper image path: fetch with the header, paint a blob. `<video>` and `<a download>` are the elements that cannot send a header.  
**Resolve:** attach the carrier only for video (and `file`, if it survives). Images stay header-or-naked. Unauthenticated public GETs remain pasteable and cacheable. A response that carried `s` is still never `Cache-Control: public`.

**D5 — Medium. Walker port as written reintroduces the Vec debt §9a forbids.**  
`canonicalize_strip_video` takes `&[u8]` and returns `canonical: Vec<u8>` via `bytes.to_vec()` (`crates/snapback-services/src/assets_video.rs:87, 519–531`). That is exactly LLP 1005 §9’s `read → Vec → put` on a 50 MB clip. Porting “not rebuilt” without changing the I/O copies the bug. Facts (`duration_ms`, `width`, `height`) are `Option` (`:77–80`); the closed `VideoAsset` is not. A 0-timescale `mvhd` or audio-only `tkhd` would mint a record the twin cannot hold, or a record that lies.  
**Resolve:** walk and blank in place on the staging file (mmap or seek). Refuse finalize when duration or display size is missing — `E_ASSET_TYPE`, same as an unclassifiable box. Keep the brand/box walk; change only the buffer.

**D6 — Medium. `Value::Row` is not what the wire produces; affine claim is not `valid_column_value`.**  
§1 cites `engine/index.rs:320` as the `valid_column_value` arm beside `Json`. Line 320 is the closing brace of `cursor_value_matches_column` (`List => false` is 319). The real function is `valid_column_value` at `index.rs:456`, called from `validate_column_value` at `:434` — pure shape/bound, no ledger, no locator. Affine claim/release has to sit in `insert`/`replace`/`delete` (`runner_ops.rs:15–146`), the same place constraints already see old vs new. Separately, `json_to_value` maps every JSON object to `Value::Map` (`protocol.rs:210–214`); `json_as_arg` has no asset arm (`writer.rs:1345–1378`). If the server coerces Map→Row and the twin does not, that is the stamp bug again with a different costume.  
**Resolve:** closed-shape check accepts `Row` *or* `Map` with the field set (or coerce at the same point on both twins). Cite `validate_column_value` + `runner_ops` write hooks. Add `ArgType` / `ColumnType` arms so `json_as_arg` does not smuggle the record through `Json`.

**D7 — Medium. Helper spawn is illegal under LLP 1002 as written.**  
Ruling 9 is the right isolation. LLP 1002 decision 1 is also in force: the owner spawns the compiler worker and “Nothing else is ever spawned” (`llp/1002-dev-loop.spec.md:35–39`). §14a adds a per-job executable and does not amend that sentence.  
**Resolve:** one line in LLP 1002: the media helper is the second allowed child, spawned per job, no store handle, timeout, memory ceiling, not long-lived. Do not reopen in-process decode to avoid the edit.

**D8 — Low. Document residue.**  
§6 still says “Under option A it also requires the asset unclaimed.” Affine was ruled; there is no option A. §12 still says “The optional `max` covers the apps that genuinely do not want full resolution” and then records that `max` was withdrawn. `use assets` is still a parser refusal at `parser.ts:87` as well as `asset` at `:340`; lane C names only the latter. None of these are design, all of them will be copy-pasted into an implementation.

**D9 — Low. Carrier TTL vs `<video src>`.**  
“Expires within minutes” plus “refresh it before it expires” does not say what happens to a paused clip. Updating `src` restarts playback; not updating it 401s the next `Range`. Pin a TTL that covers a paused 50 MB clip (session expiry, or a floor of tens of minutes, whichever is sooner), mint a new URL only on remount, and send `Referrer-Policy: no-referrer` on every asset response so `s` is not a Referer. Keep “never written to the request log” as a test, not a hope — `handle` copies `request.url()` including the query (`serve.rs:224`).

## 3. Recommended changes, ranked

1. **Stored image = stripped + oriented display pixels (fixes D1).** What it deletes: “admission is not a decode” for JPEG/PNG/WebP, and the split where rungs decode but the original does not. Why it clears the bar: M1 avatar and M2 feed photos from a phone.

2. **Carrier is a video credential, minted from `Identity` (fixes D3, D4, D9).** What it deletes: `?s=` on `<img>` / `AssetImage`, bearer-only mint, mid-playback src rotation. Why: M4 private clips play under `--as` and under a bearer; M2 public avatars keep one cache key.

3. **`reset` is a sweep; walker blanks the staging file; missing video facts refuse (fixes D2, D5).** What it deletes: `rm -rf blobs/` on reset, `canonical: Vec<u8>`, optional duration/size on a closed record. Why: fork and 50 MB clips remain the invariants §9a already claimed.

4. **Cut `file` from slice 1 (see §4).** What it deletes is the rest of that section. Why: the brief’s apps never mention an attachment.

5. **Tell the truth about the write path (fixes D6, D8).** One closed object on the wire; claim/release in `runner_ops`; lower `image`/`video` as closed object types so `clip.duration` is `emitField` on an object (`program.ts:400–410`), not a new scalar that hits `cannot select .duration from image`. Amend LLP 1002 for the helper (D7). Put `/api/upload` and `/api/asset` outside the JSON worker class (`serve.rs:140–159`) so a 50 MB `Range` does not sit in the 8-reserved JSON pool.

6. **Do not promise eager rungs at admission.** First `?w=` may render. What it deletes: resize work on the upload clock that `run({ file })` blocks on. Lazy is already “a server change with no API change” (§8); make that slice 1 so finalize is strip/orient/HEIC only.

## 4. Cut list

Everything below is in (f)–(i) and above the floor (`benchmarks/briefs/social-messenger.md` M1–M4: avatar, 1–4 images or one video per post, photo/video messages; `rules/NOT-DOING.md`: “when it starts LLP 1006 is trimmed to the brief’s formats”).

- **`file` as a column kind**, and with it: `as=file`, `name`, `FileAsset`, `<AssetFile>`, sendDoc, “strip by detected type including inside `file`,” the HEIC-under-file escape, and the scoped-privacy essay. `as` exists “because a JPEG is a legitimate `file`” (§5). Detection already separates JPEG from MP4. Cut `file`, cut `as`. Upload is one POST of bytes; kind is the accept list the bytes match.
- **Carrier on images.** See D4.
- **Eager common rungs at admission.** See change 6.
- **Default-vs-slim helper variants in slice 1**, if HEIC is not in the default (see rulings). One helper, one publish size line.
- **Hosted presigned 302** as slice-1 prose. Record “hosted delivery is still `GET /api/asset/<id>` after the row rule; a seconds-lived redirect is allowed later.” Do not specify S3 CORS and player-follow behavior before LLP 1002’s hosted target exists.
- **§6 “option A” and §12’s surviving `max` paragraph.** Residue, not design.

Keep: three-is-now-two column kinds, walker, `Range`/`206`, nosniff, session carrier for video, subprocess decode, content-addressed FS, affine, `File` in `run()`, `duration` on the video record, `require clip.duration`.

## 5. Add list

The bar does not need more kinds. It needs three facts (f)–(i) omitted, each paid for by a deletion above:

- **Orientation at admission.** Pays: the decode-free JPEG story. Without it M1 is false on a phone.
- **Persona-minted video carrier.** Pays: “authenticated session” as a bearer-only sentence. Without it M4 is false under `snapback2 test`.
- **Video finalize refuses unknown duration/size.** Pays: `Option` facts from the walker. Without it `require clip.duration <= 60000` is not a fact, and a 60 s brief rule can see `null`.

Do not add: resume, poster frames, codec refusal, view-once (M5), share links, per-column accept lists, destination-column upload, `defineMediaCommand`.

## 6. Most likely to be wrong

**The session carrier as specified in §2b** — one query token, minutes-lived, on every authenticated asset URL, minted from a bearer session.

Watch it first because it is the only (f)–(i) addition that retracts a line the last panel endorsed, the only secret in a URL, and it is specified against an identity the owner does not use on the happy path of `test`/`--as`. Public cache, persona playback, and paused `<video>` `Range` after TTL are three independent ways for it to be the wrong shape.

**Trigger to reopen:** a private clip in a persona journey fails to play, or a paused clip 401s on the next `Range`, or a logged-in Global feed of public avatars is uncacheable. Then either bind the carrier to `Identity` and to video-only as in §3.2, or drop the token and put a first-party cookie on `SNAPBACK_URL` for the `serve` topology only — which is the alternative §12 already rejected for `dev`, so the first repair is the one to try.

Resume remains the operational risk §5 already named; that trigger can stand. It is not the (f)–(i) design bet.

## 7. Rulings to revisit

**Ruling 5, the `file` half only.** Video in slice 1 is right: the brief names it, the walker exists (894 lines, under the 1,500-line rule), and both previous panelists’ reason for deferring — unstripped video — is answered by the port. Non-media files are not in M1–M4, not in NOT-DOING’s capability bar, and are the sole reason for `as`, `name`, a third record, and strip-under-`file`. New evidence is the bar text, not a preference. Keep video; slip `file` to the first app that has an attachment.

**Ruling 7, HEIC in the default published helper.** WebP stays — the brief names it, and the decode is pure Rust. HEIC is the only C stack (`libheif` → `libde265`), the only reason for two helper variants, and not a brief format. NOT-DOING is binding: trim LLP 1006 to the brief’s formats when the capability slice starts. New evidence is that sentence plus §14a’s own admission that HEIC is what makes cross-compile awkward. Reconcile by making the default helper = JPEG/PNG/WebP, HEIC a named extra, refused loudly when absent — which is already ruling 10’s mechanism with the default flipped. Do not drop server-side HEIC as a path; drop it as the default binary’s problem in slice 1. Safari-photos-drag remains `E_ASSET_TYPE` until someone installs the extra, which is worse DX than ruling 7 and cheaper than shipping libde265 in every install.

**Ruling 9, do not reopen isolation; amend LLP 1002.** Subprocess decode is still the right blast radius. The new evidence is only the collision with “nothing else is ever spawned.” Edit the spec; do not pull pixels back into `snapback2`.

Do not reopen 1–4, 6, 8, or 10’s “refuse loudly, nothing degrades.” Affine, any-width, full-resolution originals, deferred share links, no `max`, local-FS-now / bucket-later, and codecs-at-install are still the right calls under this document’s ranking.

## Round 2 (cross-read)

I'll start by reading the full panel brief and the round-1 reviews so I can resolve D-A through D-L against the actual RFC.I have the three round-1 reviews. Next I’ll re-check the RFC and the engine claims the disagreements rest on.I’m at 4d67b2a78. I’ll pull the RFC sections and engine sites that actually decide D-D, D-K, D-I, and D-J.I verified the engine claims behind D-D, D-J, D-K, and D-I. Next I’ll resolve the twelve disagreements against that evidence.I do not dissent from A1–A12. Positions below are **hold** (same as my round 1), **change** (Codex or Claude moved me), or **new** (I did not have it).

---

## 1. D-A … D-L

**D-A — `file` in slice 1. Hold: cut. Ask the author to revisit ruling 5’s non-media half.**

The RFC’s own sentence is the cost accounting: `as` exists “because a JPEG is a legitimate `file`.” Keep `file` and you keep a third closed record, `name`, `<AssetFile>`, always-attachment disposition, strip-under-`file`, and the HEIC-under-`file` escape Claude already had to patch. Cut it and upload is one POST of bytes whose kind is the accept list they match; adding `file` later is the additive column-kind the document already claims.

Honest costs. **Keep:** attachments work on day one; later `file` is a vocabulary bump both twins must learn, which is real. **Cut:** the first PDF app waits; Clique M1–M4 never names one. The floor is the bar’s apps, not a third kind. Video stays — the brief names it and the walker exists.

**D-B — HEIC in the default helper. Change: cut HEIC from slice 1.**

Round 1 I wanted JPEG/PNG/WebP in the default and HEIC as a named extra. Codex is right that a named extra is still the matrix: a cargo feature, a loud refusal, “which helper do I have?”, and `libheif` → `libde265` in the tree. Ruling 7 answered revision (f)’s “brief’s formats” question by widening past the brief; the new evidence is that this widening is the entire reason for ruling 10’s package matrix (D-C) and that it was never reconciled with `NOT-DOING.md` (D-L).

Safari-drag of an iPhone photo becomes `E_ASSET_TYPE` until the client converts. That is worse DX than shipping HEIC and cheaper than a C decoder in every install. Expo’s picker can request JPEG; the fixture pack is JPEG/PNG/WebP. If the author holds ruling 7, implement it as Claude says — one published full helper — and amend `NOT-DOING` in the same change.

**D-C — Published helper variants. Hold on “one helper”; change the extra.**

Delete the published full/slim matrix. One published helper, JPEG/PNG/WebP, no HEIC feature on the accept list. The build-time flag is implementer business for a later slice, not RFC surface. Combined with D-B this is Codex’s cut, not Claude’s “publish full, slim if it measures badly”: measuring a decoder we have already recommended not to ship is how the matrix sneaks back.

**D-D — Blob keys. Change: key by immutable asset id.**

Round 1 I wanted SHA-256 of stored bytes for dedupe and cheap fork. Codex’s engine evidence convinced me: `Store::reserve_new_ids` already makes exposed ids non-reusable (`store.rs:257–330`); the listed `_assets` schema has no blob key; the three-operation trait cannot list a crash-orphaned CAS object; derived refcounts and hash-keyed dedup races are new machinery. Fork sharing does not need CAS — forks already share the blob directory, and ids never reuse.

The protocol is: persist `receiving` first, put `<asset-id>` (and rung keys), then `ready`. Sweep is ledger-driven: a blob exists because a live or fork ledger row names that id. That deletes hashing 50 MB clips, dedup, refcounts, bucket listing, and impossible cross-store atomicity. What you lose is silent identical-byte sharing across two affine uploads, which affine already charged twice.

**D-E — Carrier scope and image delivery. Change: keep video-only carrier; take both of their cache rules.**

Hold the round-1 shape: mint from `Identity` (persona and bearer); attach `?s=` only for `<video>` and downloads; images stay header-or-naked; a URL that carried `s` is never `Cache-Control: public`. Claude is right that private bytes, with the id in the path, should be `Cache-Control: private, immutable` plus `Referrer-Policy: no-referrer` — `no-store` only forces a private feed to re-download on every scroll, and staleness is impossible. Codex is right that a carrier URL on a public row 302s to the canonical tokenless URL, never to a bucket. Do not rotate `src` mid-playback.

**D-F — Image strip. Hold: decode → orient → re-encode in the helper, every image.**

Keeping only the Orientation tag looks cheaper and preserves JPEG quality, but it is a second contract: the file’s SOF is sensor pixels, the record is display pixels, every rung and every client must honor the tag, and Android RN has historically not. v1 baked orientation on purpose (`assets_image.rs` `apply_orientation`). One stored file whose pixels *are* the record deletes that dual protocol. Delete “uploader’s pixels exactly” and “JPEG admission is decode-free.” Re-encode at high quality so this is not a visible downgrade.

**D-G — Internal decode-safety ceiling. Change: yes. Narrow, not a reversal of ruling 6.**

Ruling 6 still stands: no author-facing `max`, full-resolution originals. The helper’s memory cap is already a ceiling; today it is “child OOM.” Port a stated internal bound (v1’s `AssetImageCeilingsV1`: 50 Mpx, 16 384 on a side, decompression ratio, output bytes) and refuse `E_ASSET_TOO_LARGE` / a bounds code. That deletes decompression-bomb-as-crash without giving authors a downscale knob. Also: effective `?w=` is `min(requested, source width)`; never upscale.

**D-H — `created_by = system`. New: delete it.**

Nothing mints a system ledger row. An escape whose issuer does not exist is a grant waiting for a hand-inserted row any writer could then place. §13 can keep the additive shape (effect context puts a stream, gets a record). When that ships, `created_by = system` arrives with it. Claude kept it “because §13 names the user”; naming a future user is not a reason to leave a hole.

**D-I — What the helper is. Change: crash/RSS isolation, not a security boundary.**

I wrote “no store handle” as if that were confinement. Codex is right: a same-UID child can open `.snapback/store.sqlite` (`owner.rs:161`). Either specify an OS sandbox (out of slice 1) or tell the truth: cleared environment, timeout, memory ceiling, bounded output, process-group kill, spawn per job. Amend LLP 1002 decision 1 for that child. Do not reopen in-process decode.

**D-J — Forgeable asset arguments. New: no dissent.**

Verified: `validate_inputs` is shape-only and runs before the transaction (`engine/mod.rs:429–446, 875–964`); `require clip.duration <= 60000` reads the caller’s record; ledger equality runs only when a column is written. `sendClip` is saved by the later write — a mismatch rolls back — but any mutation that uses an asset field for policy without writing the asset, or that does other work on a forged fact, is open. The RFC *advertises* `require clip.duration` as admission policy. Ledger-validate every asset-typed argument, recursively through optionals and lists, after opening the authoritative transaction and before the body. Destination writes still do bounds and affine claim.

**D-K — Delivery primitive and `302`. Change: one new primitive; delete the `302`.**

I deferred hosted `302` as prose. That was wrong. `Runtime::read_rule_verdicts` scans every row (`registry.rs:771–797`); `Engine::probe_rule` is crate-private and opens its own transaction (`mod.rs:810–843`); indexed read plus certified rule evaluation exists only inside the program runner (`runner.rs:615–653`). §2’s “no new machinery” is false.

Specify one sole-writer action, one read transaction: load `_assets`, point-read the locator row, verify the cell still contains the id, evaluate the table read rule under the stored certificate. Absence and non-admission are the same 404. Delete presigned `302`: after the redirect, bucket `Range` requests never re-evaluate the row rule, which contradicts “revocation is exact and immediate.” Hosted streams through the same `GET`. Scope that wording to requests that reach Snapback — a `public, immutable` cache hit can outlive public→private, and that tradeoff is already settled.

**D-L — Trim vs amend `NOT-DOING`. Hold: trim the RFC.**

`NOT-DOING.md:17–21` and LLP 1007 §4a (delegated 2026-09-02) say that when the capability bar starts, LLP 1006 is trimmed to the brief’s formats: JPEG/PNG/WebP and MP4 H.264/AAC. Rulings 5 and 7 (the next day) widen past that and did not write the one line `NOT-DOING` requires to move something off itself. Recommend trim. If the author holds file or HEIC, amend `NOT-DOING` in the same change with one line each naming what it unblocks (attachment columns; iPhone-camera HEIC on the server). Do not leave two binding documents in conflict.

---

## 2. Final recommended changes (ranked)

1. **Trim slice 1 to `image`+`video`, JPEG/PNG/WebP and MP4 H.264/AAC** — deletes `file`/`as`/`name`/`FileAsset`, HEIC, MOV/HEVC accept, and the helper matrix.
2. **Key blobs by asset id; persist `receiving`, put, `ready`** — deletes CAS, dedup races, derived refcounts, and bucket listing.
3. **One sole-writer certified delivery primitive; hosted bytes stream through `GET`** — deletes “no new machinery,” the table-scan probe, and presigned `302`.
4. **Ledger-validate every asset-typed argument at mutation entry** — deletes forged `require clip.duration`.
5. **Helper decode → orient → re-encode every image, with a stated internal pixel/dimension ceiling; `?w=` never upscales** — deletes decode-free JPEG, “uploader’s pixels exactly,” and OOM-as-policy.
6. **Carrier is Identity-minted and video/download only; public `?s=` 302s to the tokenless URL; private responses are `private, immutable`** — deletes `?s=` on images, bearer-only mint, and `no-store` re-downloads.
7. **`reset` = clear live ledger + staging, then the fork-aware sweep; walker blanks in place; missing video facts refuse** — deletes `rm -rf blobs/`, `canonical: Vec<u8>`, and optional duration/size.
8. **One old/new asset-set reconciler on insert/replace/delete/successor; same-cell re-claim allowed; refuse assets in `maintain.by` and seeds** — deletes stranded locators and the list-edit refusal.
9. **Helper is crash/RSS isolation; amend LLP 1002** — deletes the implied OS sandbox.
10. **Delete `created_by = system` until effects mint** — deletes a grant with no issuer.
11. **Asset worker class before the 1 MiB JSON reader; Range is 200 / one 206 / 416; scrub §6 option A, §12’s `max` sentence, `use assets`, `index.rs:320`; lazy first `?w=`** — deletes JSON-pool starvation and residue landmines.
12. **Manifest-driven `File` and Expo-URI substitution; scalar/list URL resolver; mutations return `MutationResult`** — deletes `.d.ts`-as-runtime and the throw fiction. Add a **global** staging cap (guest mint is free) beside the per-principal one.

---

## 3. What I would steal

**From Codex, which I did not have:** the delivery primitive actually missing from the engine; asset-typed arguments being readable before the ledger check; asset-id keys against a 3-op trait that cannot list; the helper as same-UID isolation; the internal decode ceiling as a clarification of ruling 6; affine coverage of successor / `maintain.by` / seeds; Expo URI plus manifest-driven substitution because `Op` erases type parameters; `MutationRejected` not throw; `?w=` never upscales; exact-epoch carrier bind.

**From Claude, which I did not have:** `Cache-Control: private, immutable` for private bytes (I would have left `no-store`); the global staging cap against free guest principals; same-cell re-claim on list edits (A10 — Codex’s reconciler subsumes it, Claude named the bug). If `file` survives, Claude’s strip-or-refuse-everywhere is mandatory.

---

## 4. Verdict

**Not ready as written.** After the twelve changes, **ready to implement.** The center of (c) still holds: a column type, one closed record per kind, validate-not-replace, byte authority as the row’s read rule, video as a ported walker plus `Range`, decode out of the engine process.

What still blocks if skipped: (3) shipping delivery against `read_rule_verdicts`, (4) shipping `require clip.duration` as a fact, (2) CAS against a trait with no list, (5) phone JPEGs, and (1)/(D-L) two documents that disagree about whether `file` and HEIC exist. Those are spec edits, not a new design.
