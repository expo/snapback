# LLP 1006: Assets — a column type

**Type:** RFC
**Status:** Draft
**Systems:** `snapback2-core` (the `_assets` ledger, the asset column, the
write-time validation, reclamation), `snapback2` (upload and delivery routes,
the finalize worker), `packages/compiler` (the column type),
`packages/quarry` (the notation), `packages/snapback2` (client + React)
**Author:** Claude Opus 5 (design), commissioned by Charlie Cheever 2026-08-31
**Date:** 2026-08-31
**Revised:** 2026-09-01 (d — the author's rulings, in session: **affine**
settles OQ1 (§2, §9); **any requested width is accepted and snapped** up to an
internal rung, so there is no closed ladder to memorize and no width refusal
(§8); **the full-resolution stripped original is kept** by default with an
optional `max` pixel ceiling, which removes the invented 2048 primary and keeps
lazy rendering available (§4, §8); **share links are deferred** with their
additivity recorded so the deferral is checkable rather than hopeful (§13).
Two open questions remain, neither blocking: the decoder's binary cost and
video's schedule.); 2026-09-01 (c — the two-model panel pass. **One correctness
defect fixed:** the write-time *stamp* broke the client twin, and is replaced
by write-time *validation* (§1, §6). **One cache defect fixed:** the slot
delivery URL was mutable; the asset id now appears in the path (§2). Resumable
upload leaves slice 1 with video (§5); `kind`, `hash`, and `digest` leave the
value (§7); bounds are integers, not `5mb` (§3). **D1 is now the only open
design fork and is the author's decision** (§2a, OQ1). Panel record:
`llp/reviews/1006-assets.panel.{codex,grok}.md`.); 2026-08-31 (b — the
simplification pass, author-directed: seven deletions from revision (a) — the
named `asset` intent declaration, the `strip` field, the `upload` rule, the
width ladder, the maintained refcount, the `ready` field, and the read-time
projection seam. Revision (a)'s `Ref`-plus-projection design is recorded in
§12.); 2026-08-31 (a — initial draft)
**Related:** LLP 1000 (decisions 5, 6), LLP 1001 (§1 engine-owned tables, §3
states, §9 schema additions), LLP 1002 (§4 the wire), LLP 1003 (effects),
LLP 1004 (Quarry is the default surface), **LLP 1005** (the Snapback 1
evidence this answers), LLP 0005 (the review loop the panel ran),
LLP 0329.014.004, `rules/RULES.md`, `rules/NOT-DOING.md`,
`llp/reviews/1006-assets.panel.codex.md`,
`llp/reviews/1006-assets.panel.grok.md`

## Summary

`rules/NOT-DOING.md` puts "Assets (typed intent)" on the doing-list and
everything Snapback 1 built above it — collections, media commands, grants —
off it. LLP 1005 says why: the typed intent was the part every diary praised,
and the 3,106 LLP lines above it shipped two capabilities that are still
experimental.

This RFC is the design for that doing-list item:

> **An asset is a column type. Its value is one closed record, identical at
> every layer. Its bytes are served through the row that holds it.**

Byte authority is the row's read rule, so there is no sharing declaration and
no delivery profile. The value is the same going in and coming out, so there
is no attach call, no read-time projection, and the client twin stays pure.
Four photos is `[image <=12000000] <=4`, so there is no collection. Uploads
settle before the write, so there is no media command.

The whole feature is a column type, two HTTP routes, two renditions, and
reclamation.

**This is a proposal.** `rules/RULES.md`: only implemented specs bind, and a
spec needs an implementer and a date. §15 proposes both; nothing here binds
until code runs it. It was commissioned in-session, which is the explicit
approval the agent rule requires for adding a design document.

The author's rulings of 2026-09-01 are folded in: an asset has one home
(§2), any width may be requested (§8), and the stripped original is kept
(§4). What remains open is the decoder's cost to the binary and when video
is scheduled — neither blocks the design.

## 1. The move

Snapback 1's asset id was a string the rest of the system had to be taught
about, one seam at a time: the result contract did not know it (LLP 1005 §5a —
the flagship "feed with photos" shape was inexpressible and needed two separate
repairs), the live-query planner did not know it, the generated types did not
know it, and LLP 0244 spent 809 lines building the projection seam that finally
reconciled them.

Snapback 2 makes the asset a **column type whose value is one closed record**:

```ts
type ImageAsset = Readonly<{ id: string; width: number; height: number }>
```

That record is what `upload()` returns, what a mutation takes, what the engine
stores, what the twin predicts, and what a query returns. **The same bytes at
every layer.**

Revision (b) had the engine *stamp* the record — take an id, write a record.
That is a correctness defect, and both panelists rejected it (codex found it;
grok, on reading the finding, called it "a twin bug I missed" and "illegal in
this engine"). The reason: the 7.8 KB TypeScript evaluator is pure, mutation
returns preserve the authored value, and the twin cannot consult `_assets`. An
optimistic `setAvatar` would therefore predict an *id* while the server's next
query returned a *record*, and the two twins must agree on every corpus case.

**The engine validates instead of replacing.** The caller supplies the record;
the engine checks it against the ledger and stores it unchanged (§6). Input
equals output, the twin predicts correctly, and forgery is still refused —
a record whose dimensions do not match the ledger is an ordinary `input`-family
refusal, the same shape as a unique-index collision.

Three consequences worth stating up front:

- **The certificate value model does not move.** The stored value is a
  `Value::Row`, which exists; the column is a new `ColumnType` variant with one
  arm in `valid_column_value` (`engine/index.rs:320`), beside `Json`, which
  already accepts an arbitrary `Value` under a byte bound. Adding `Bytes`
  bumped the model from `i53-codepoint-v1` to `i53-codepoint-bytes-v2`
  (LLP 1001 §9); assets bump nothing, because they add no value kind.
- **There is no read path at all.** Reading an asset column costs what reading
  a `json` column costs. Snapback 1's projection ran on both the read and the
  write path; this runs on neither — validation happens once, at write.
- **An asset column is not indexable** (`E_SCHEMA_INDEX_COLUMN`, the refusal
  `List` already uses).

`_assets` remains an engine-owned table (LLP 1001 §1 — `E_SCHEMA_RESERVED`
already forbids declaring it): `id`, `state` (`receiving | ready | failed`),
`kind`, `bytes`, `width`, `height`, `created_by`, `created_at`. It is a
staging and ownership ledger. After validation it is not the source of truth
for anything a program reads.

## 2. Authority: delivery is by the row that holds it

Snapback 1 delivered bytes by asset id and needed a separate `assetSharing`
declaration, reverse-reference edges, a 1,024-edge per-app quota, and
transactional edge death to make byte authority agree with row authority. It
worked — LLP 1005 §2 measures it as the only arm in the field where revocation
kills the feed *and* the bytes — and it cost a great deal of machinery.

Snapback 2 gets the same property from one certified point read: **serving an
asset's bytes reads the row that holds it, under that row's ordinary read
rule, and verifies the cell still contains that asset id.** Nothing is
declared, and the two cannot disagree, because there is one rule evaluation and
it is the table's.

Consequences, none needing new machinery:

- **Revocation is exact and immediate.** A rule that stops admitting the viewer
  stops admitting the bytes on the next request.
- **Replacement and deletion are exact.** Patch the column or delete the row and
  the old path fails on its next request. Authority never waits on reclamation.
- **Pasteability is derived, not declared.** A `rule.public` table's asset paths
  need no credential; anything else is authorized per request and `no-store`.
  LLP 1005 §5c is the most repeated friction in the v1 corpus — four builds
  burned choosing a delivery profile — and there is no profile here to choose.
- **It is bounded.** One point read and one rule evaluation.

**The asset id is always in the URL.** Revision (b)'s path was a *slot*
(`…/<column>`) whose content changed when the column was patched, so a public
row with a long TTL kept serving a replaced avatar. Both panelists caught it
independently. The id makes the URL identify bytes rather than a position, so
a replaced asset's URL fails instead of going stale.

The honest cost of the whole model: **an asset has no authority of its own.**
You cannot hand someone a link to bytes independent of a row they may read.
That is the recipient-grant/signed-link feature, and it is a non-goal (§13). An
app that wants a public image makes the row public.

### 2a. One asset, one home (author ruling, 2026-09-01)

An asset belongs to exactly one `(table, row, column)` cell, recorded as a
nullable **locator** on `_assets` and claimed in the writing transaction that
references it. Delivery follows the locator:

```
GET /api/asset/<assetId>            the stored original (§8)
GET /api/asset/<assetId>?w=<width>  a derived width
```

```tsx
<AssetImage asset={photo} />
```

This was the panel's one unresolved fork, and it is worth recording why it was
hard: on cross-read **each panelist adopted the other's original position**.
The ruling takes affine for the reason that decides it under this document's
ranking — *the display call is what an app author writes fifty times, and reuse
is what the five named apps write zero times.* What affine buys:

- **The value is self-sufficient.** A component renders a photo without knowing
  which row it came from, so a photo can be passed around like any other value.
- **Reordering a list changes no URL.** Identity is the asset, not a position.
  The rejected alternative put the index in the path, so rearranging four photos
  404'd all four.
- **Reclamation never scans application tables** — it is `locator IS NULL` over
  `_assets` (§9).

What it costs, stated plainly:

- **Reuse is a runtime refusal** (`E_ASSET_IN_USE`). The same uploaded file in
  an avatar and a post is two uploads and two copies of the bytes. Forwarding a
  DM image re-uploads it.
- **TypeScript cannot express the linearity.** An ordinary-looking value is
  secretly affine, so the editor will not warn; the refusal arrives at write
  time, typed and immediate rather than silent.
- **Claim and release are transactional correctness** across replacement, list
  edits, deletion, `reset`, and `fork` — not a background concern.

If an app later needs one asset in several rows, the change is mechanical and
reversible: delete the locator, put the row coordinates back in the URL, and
move reclamation to a sweep. It is not a migration trap. §12 keeps the rejected
shape and its arguments so the choice is not re-litigated from scratch.

## 3. Authoring surface

Quarry is the default surface (LLP 1004); the TS twin is what `quarryc` emits.
Bounds are integers — `5mb` is not Quarry grammar, a factual error in revisions
(a) and (b) that both panelists corrected.

```
use identity

table profiles:
  handle: text <=40
  avatar: image <=5000000 ?
  unique handle
  read r <- r.id = viewer
  insert r <- r.id = viewer
  update r <- r.id = viewer

table posts:
  space: spaces
  author: id
  body: text <=500
  photos: [image <=12000000 max 2048] <=4
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

```ts
export const profiles = table({
  columns: { handle: t.text(40), avatar: t.optional(t.image(5_000_000)) },
  // …
})
export const posts = table({
  columns: {
    photos: t.list(t.image(12_000_000, { max: 2048 }), { max: 4 }),
    /* … */
  },
  // …
})
```

`avatar` keeps its full resolution; `photos` stores nothing over 2048 px
(§4). Both are one type and a bound, read the same way as `text <=40`.

That is the entire authoring surface. `image` reads exactly like `text`,
because it is exactly as complicated: a type with a bound. Widen `profiles`
read to `public` and the same bytes become pasteable — privacy is the table's
read rule, and that is the whole privacy API. A DM image is
`photo: image <=12000000 ?` under `read r <- r.from = viewer or r.to = viewer`.

Three things Snapback 1 needed that are absent, each because the engine already
has the mechanism:

**A post with four photos is a list column.** Snapback 1 explicitly withdrew
`v.array(v.assetRef(...))` and routed multi-asset relationships onto a bounded
children path, which became `assetCollection` — 589 RFC lines plus generated
operations, stable item identity, sharing ceilings, and GC/quota/cut custody,
still `experimental` behind an expired GAP row. `ColumnType::List { of, max }`
already exists, is already bounded, and is already twin-supported.

**There is no media command.** Snapback 1 needed `defineMediaCommand` — a
bounded multi-upload task with ambiguity, retry, and per-item residue
provenance — because uploads and the row write had to be coordinated. Here they
are not: uploads settle first and produce records, and the mutation referencing
them is one ordinary transaction, which is already atomic. If the third of four
uploads fails, the mutation is never sent, no row is written, and the successful
siblings are reclaimed. That is a materially weaker partial-failure story than
v1's per-item residue honesty, and a materially smaller one; §13 records it.

**There is no intent declaration.** Policy is the column.

## 4. Admission

Admission keeps the property LLP 1005 §3 identifies as the reason Snapback 1
was the only arm in the bakeoff whose served bytes provably lost their GPS —
**the author cannot decline the privacy decision** — but gets there by removing
the decision rather than mandating it.

- **Location metadata is always stripped.** There is no `strip` field. The v1
  diaries celebrate the mandatory-decision refusal, but they celebrate it
  because the outcome was stripping; making it unconditional produces the same
  outcome with no declaration, no escape hatch, and no diagnostic.
- **The type is the accept list.** `image` admits JPEG, PNG, and HEIC. The
  *detected* type governs, never the declared one; anything else is
  `E_ASSET_TYPE`.
- **HEIC normalizes to JPEG at admission.** iOS libraries are HEIC-first and
  pickers hand back HEIC even in compatible mode (LLP 1005 §6); Snapback 1 still
  cannot decode it (`issues/20260819-heic-image-normalization.md`, open).
  Accepting HEIC and storing an unservable original would reproduce the bug.
- **The full-resolution image is kept, stripped** (author ruling, 2026-09-01).
  "The original" always means the full-size image *after* metadata removal —
  never the bytes as uploaded. Keeping the literal upload would keep the GPS
  this section promises to remove, and the one property Snapback 1 measurably
  beat the field on would be false the moment anyone fetched full size.
  Derived widths (§8) come from that stripped source.
- **An optional `max` caps stored resolution.** `image <=12000000 max 2048`
  stores nothing larger than 2048 px on the long edge. Omitted, the full
  resolution is kept. The default is the *reversible* choice — a smaller image
  can always be derived from a larger one, never the reverse — so a chat app
  storing thousands of 12 MP images opts into the ceiling, and a photo app does
  not. This is the column's only optional field.
- **The bound is bytes**, enforced at admission and re-checked at write; over is
  `E_ASSET_TOO_LARGE`. Both refusals ride the existing `input` family.

**Upload authority is "an authenticated principal," with no knob.** An asset
nobody references is undeliverable and reclaimed, so an upload on its own grants
nothing; the authorization that matters is the `insert`/`update` rule on the
mutation that references it. The residual exposure is disk, bounded by a
per-principal staging cap (§14) — a number, not a rule.

## 5. Upload: one POST

```
POST /api/upload
Authorization: Bearer …
Content-Length: …
<body = bytes>
→ 200 { "id": "as_…", "width": 1290, "height": 1720 }
  | 422 { "code": "E_ASSET_TYPE" | "E_ASSET_TOO_LARGE", "family": "input", … }
```

The response arrives **after finalize**, so there is no author-visible
`receiving` state and no readiness race. `E_ASSET_NOT_READY` survives only as a
forged-id refusal, never a happy-path state.

**Resumable upload is not in slice 1.** Revisions (a) and (b) specified TUS on
the strength of LLP 1005 §4, which measures 0-bytes-retransmitted as a real v1
differentiator — but measures it on a *120 MB video*. Both panelists concluded
that a 12 MB photo does not earn the machinery, and that hiding TUS behind one
promise deletes none of it: create/`PATCH`/`HEAD` routes, durable offsets,
fingerprint custody, expiry reconciliation, chunk negotiation, TUS CORS
headers, and their failure tests all remain. A dropped photo retries in full.
**TUS returns with video (§13), which is what it exists for**, and the
author-facing call does not change when it does.

Two requirements survive from revision (b) because Snapback 1 paid for them:

1. **Limits are in the schema, not discovered by failing.** The column bound is
   `t.image(5_000_000)` and is already in `api.d.ts`, so the client can refuse
   before sending. Snapback 1's default configuration could not upload a 120 MB
   video because the client's 4 MiB chunk exceeded a 2 MiB server ceiling
   neither side had stated (LLP 1005 §6). No create round trip is needed to
   restate what the generated types already carry.
2. **CORS is ordinary and correct from the first commit.** Snapback 1 shipped
   without the TUS headers, so browser upload worked only behind the dev relay
   and a cold agent hand-wrote an 80-line proxy to finish a brief (Diary 0065).
   Snapback 2 has no supervised bundler and no relay to hide behind.

## 6. The write: validated, not stamped

Snapback 1 required `ctx.assets.attach(...)` inside the mutation, and a write
storing an asset id without it was refused `SNAPBACK_ASSET_REF_UNVERIFIED`. The
refusal is correct — a forged string must not become an authorized reference —
and LLP 1005 §5b records that essentially every author discovered it by hitting
it rather than by reading.

Here there is no call. Validation splits cleanly across the two twins:

- **The twin** (pure, and the server repeats it): closed-shape check — an
  `id` of valid syntax, positive bounded integer `width` and `height`, no
  missing or extra fields, unique ids within a list. It stores the value
  unchanged.
- **The server, additionally**, in the writing transaction: the ledger row
  exists and is `ready`; `created_by` is the writer (or `system`, so an
  effect's `then` mutation can place an asset the service principal produced);
  `width` and `height` **equal** the ledger; bytes are within this column's
  bound. Under option A it also requires the asset unclaimed and claims it
  (`E_ASSET_IN_USE` otherwise).

Then it stores the argument unchanged. A forged id, an altered dimension, or
someone else's upload is refused in the `input` family; the optimistic frame
rolls back exactly as it does for a unique-index collision.

There is nothing to remember to call, so there is nothing to forget, and the
forged-string property is preserved.

## 7. Reading

```json
{ "id": "as_…", "width": 1290, "height": 1720 }
```

That is the whole value. Revision (b) also carried `kind`, `hash` (a thumbhash)
and `digest` (a sha256); all three are gone, cut independently by both
panelists:

- **`digest`** was in the design because LLP 1005 §7 named Convex's queryable
  digest as the one strictly-better competitor idea in the bakeoff. That is
  precisely a feature adopted because a competitor has it, which this RFC's
  own ranking forbids. The ledger may keep it for `snapback2 data`; no named
  app queries it.
- **`hash` and `digest` together** are a pair authors will swap. If a
  placeholder is ever added it must be spelled `thumbhash`.
- **`kind`** is redundant: the column already says `image`, and delivery
  supplies the real type in `Content-Type`.

`width` and `height` stay because Diary 0087 measured what happens without
them — RN/Yoga collapses image tiles to zero height and uploads "work then
vanish." They are spelled in full, never `w`/`h`.

The cost, accepted: a feed paints empty until bytes arrive. That is the
cheapest field to add back later, and it is above the floor today.

## 8. Sizes: ask for any width

```
GET /api/asset/as_123           the stored original
GET /api/asset/as_123?w=847     a derived width
```

**Any width is a valid request.** The server snaps it up to the next internal
rung and serves that, so the delivered image is always at least as large as
asked and looks right. The rungs are an implementation detail: there is no
closed list to memorize, and **no width refusal exists** — revision (c)'s
`E_ASSET_WIDTH` is deleted along with the ladder that needed it.

The client does not usually name a width at all. `<AssetImage>` measures its
own layout box, multiplies by device pixel ratio, and asks for that:

```tsx
<AssetImage asset={photo} />
```

**Why snapping rather than literally arbitrary rendering.** A public image URL
with a free `?w=` is an unauthenticated compute endpoint: `?w=1 … ?w=4000` is
thousands of decode/resize/encode jobs per asset from a URL anyone can loop on,
and every distinct width is a distinct cache entry, so hit rates collapse as
devices vary. The fixes for that are all machinery this document has already
refused — signed URLs with the width in the signature (LLP 0220's territory),
per-asset variant caps, rate limiters. Snapping bounds the work at the rung
count per asset and lands every device on the same few cache keys, at no cost
to the caller, who never learns the rungs exist.

This is what Snapback 1 lost the DX half of the media axis on: PocketBase's
`?thumb=100x100` beat pre-declared variants outright (LLP 1005 §7), and its
author-declared-variant bug — a helper composing a rendition name the intent
never declared, yielding a URL for bytes that do not exist (Diary 0086) — is
unreachable when every width is valid.

**Eager or lazy is invisible.** Because widths snap, an attacker can force at
most one render per rung per asset, which makes lazy rendering safe rather than
a liability. Slice 1 renders the common rungs at admission — no cache, no
eviction, no cold first request, which suits a system whose posture is cheapest
at idle. If bytes or CPU later measure badly, switching to render-on-first-
request is **a server change with no API change**: same URLs, same client code.
Naming sizes (`/thumb`) instead of measuring them would have foreclosed that,
which is why revision (c)'s spelling is gone.

## 9. Lifecycle: finalize off the writer, and reclamation

**Finalize never runs inside the store transaction.** Snapback 1 reads whole
objects into memory three times and runs media CPU inside the single global
writer lock, so one large upload stalls the instance with ~2× RSS spikes; the
ticket is P2 and still open, and the S3 path still does `read → Vec → put`
(LLP 1005 §9). This is the clearest inherited-debt warning in the v1 record, and
the answer is to make it structurally impossible: bytes stream to staging;
validation, strip, HEIC decode, and both renditions run on a worker thread
outside any store transaction; success is one small write flipping
`_assets.state` to `ready` and answering the POST.

**`_assets` owns its own lifecycle.** Revision (b) proposed hanging finalize on
LLP 1003's `_outbox`; both panelists rejected it, and they are right — the
ledger already has the states, and borrowing the effect runner drags in
`sent_unknown`, manual requeue, and effect tracing that image finalize does not
want. The outbox stays for effects. Video's long finalize is the reason to
revisit it.

**Reclamation is `locator IS NULL` over `_assets`** (§2a) — it never scans
application tables. An asset whose row was deleted, whose column was patched,
or that was never referenced has a null locator and is collected after a grace
period, along with its derived widths. **Liveness buys space and never
authority** — an unreferenced asset is already
undeliverable (§2), so a reclamation pass that lags or crashes is a disk cost,
not a disclosure. Snapback 1's equivalent bug is open today: a partial reset
wipe leaves orphans that are never reclaimed *and* undetectable
(`issues/20260821-orphan-blob-reclamation-after-reset.md`).

## 10. Clients

React web first, Expo second (LLP 1000 decision 5); Exact 2 follows.

The paved call assigns a `File` directly, and the SDK uploads it and
substitutes the record before the mutation is sent:

```tsx
setAvatar.run({ avatar: file })
publish.run({ space, body, photos: files })   // 1–4 Files
```

Generated client argument types accept `File | ImageAsset`; handlers, the
engine, and the twin only ever see `ImageAsset` (§6), so this is a client
convenience and not an engine concept. The two-phase form remains available for
progress UIs and for carriers that are not the browser's `File`:

```ts
const avatar = await client.upload(file, { onProgress })
await setAvatar.run({ avatar })
```

**This was a live panel disagreement and is settled by the v1 evidence rather
than by preference.** Codex argued for the explicit two-phase call as the only
paved form, on the grounds that `File` is not a Quarry value and that hiding
the upload implies a false atomicity. Grok's counter is the one that decides
it: *"requiring `upload()` then `mutate()` is `attach()` renamed"* — and
LLP 1005 §5b is a whole section on what a mandatory second call cost Snapback 1.
An agent that must call two functions will eventually call one. Codex's
atomicity objection is answered by the failure shape: `run()` throws, no row is
written, and the siblings are reclaimed — the same shape as any rejected
mutation.

Rendering is `<AssetImage asset={photo} />` (§2a), which measures its own box
and requests a matching width (§8) — the author names no size. A private image
is fetched with the session and painted from a blob URL; there are no signed
query tokens.

## 11. What this deletes

| Snapback 1 | Snapback 2 | Why it goes |
|---|---|---|
| `assetSharing` declaration | — | the reference is the declaration (§2) |
| Three delivery profiles | — | derived from the table's read rule (§2) |
| Reverse-reference edges + 1,024-edge quota | — | authority is a point read (§2) |
| `defineAssetUpload` intent | a column type | policy belongs on the column (§3) |
| `ctx.assets.attach` | validation (§6) | checked where column bounds are checked |
| `MediaRef` projection seam (LLP 0244, 809 lines) | — | the value is already the record (§1) |
| `assetCollection` (LLP 0239, experimental) | `t.list(t.image(…), { max })` | the engine has bounded lists (§3) |
| `defineMediaCommand` (LLP 0180, experimental) | the mutation | uploads settle before the write (§3) |
| Recipient grants (LLP 0220) | — | non-goal (§13) |
| Pre-declared renditions | two fixed renditions (§8) | a fixed pair cannot be named wrongly |
| TUS in the first slice | one POST (§5) | the measurement was a video |
| 199 `SNAPBACK_ASSET*`/`MEDIA*`/`COMMAND*` codes | ~5 `E_ASSET_*` | most described machinery that no longer exists |

## 12. Considered and rejected

Recorded so no reader re-derives them. The first four are from revision (a);
the rest were closed by the panel.

**An asset reference as `Ref { table: "_assets" }`, projected at read time.**
Elegant in the type system and keeps facts normalized. Rejected because it
reinstates a read path: one point read per asset-valued cell per returned row, a
bounds contribution of `take × columns`, an interaction with LLP 1001 §3's
capped-site rules, and a projection seam — precisely what cost Snapback 1 809
lines.

**A named `asset` intent declaration.** The v1 diaries single the intent out as
the good part. The judgment is that they praised *co-located policy*, which
putting policy on the column preserves and tightens. Both panelists endorsed the
deletion independently; it is no longer an open question.

**An on-demand width ladder** and **a maintained refcount** — see revision (b);
both panelists endorsed keeping them deleted.

**A write-time stamp (id in, record out).** Revision (b)'s design. Rejected: it
breaks the client twin (§1). This was the panel's most important finding.

**Finalize as an `_outbox` job.** Rejected: `_assets` already has the states,
and the effect runner's semantics do not fit (§9).

**`kind`, `hash`, `digest` on the value.** Rejected as above the floor (§7);
`digest` specifically as competitor-envy.

**Reference-site delivery** (`/api/asset/<table>/<row>/<column>/<index>/<id>`).
The panel's unresolved fork, ruled against on 2026-09-01 (§2a). Its real
advantages, kept on the record: no hidden linearity, one asset reusable in many
rows, and reclamation that is *deliberately* outside authority — a sweep may lag
or crash without leaking a byte. It loses on the call an author writes fifty
times: every render site must name the row, the column, and the index, and
reordering a list changes every URL beneath it, 404-ing photos whose bytes never
moved. Revisit it if `E_ASSET_IN_USE` starts feeling like an obstacle rather
than a rule.

**A closed width ladder that refuses off-ladder widths** (revision (a), and
revision (c)'s two fixed renditions). Rejected in favor of accepting any width
and snapping (§8): the closed list forced the author to learn the rungs and
needed an `E_ASSET_WIDTH` refusal, and the fixed pair left the most common case
— a full-width photo on a phone — served by an oversized original. Snapping
deletes both the list and the diagnostic.

**Discarding the original after deriving a capped primary.** Revision (c)'s
model. Rejected (§4): it required inventing and defending a 2048 px "primary,"
made full-resolution download and deep zoom impossible, and — because deriving a
new width needs a source — would have locked rendering into being eager forever.
The optional `max` covers the apps that genuinely do not want full resolution.

**A destination column named at upload** (`api.assets.<table>.<column>`).
Codex argued for it: an 8 MB image should fail before it is normalized and
thumbnailed for a 5 MB avatar column. Grok's counter carries: a per-column
handle enforced at claim *is* the per-column upload rule already deleted, and it
adds a generated namespace to avoid a collision only that namespace creates.
Upload is column-less; the bound is re-checked at write, like `text <=40`. The
wasted work is one image resize on a refusal path. **If a per-column accept list
ever lands** (PNG-only avatars, H.264-only video), that is the add that puts the
destination back, and it deletes the generation-wide admission ceiling.

## 13. Non-goals, with reasons

- **Video, in the first slice.** Not because it is unimportant — Clique and
  Coterie both need it — but because we cannot strip video metadata without the
  container walker Snapback 1 spent weeks on, including the finding that
  QuickTime `meta` atoms are not ISO fullboxes (LLP 1005 §6). Shipping video
  unstripped would surrender the single differentiator the bakeoff measured.
  Both panelists endorsed the deferral unprompted in round 1. Slice 2 is
  required work, not an optional tail: a `video <=N` column of the same shape,
  plus the corrected walker with a real iPhone MOV in the corpus, TUS with
  client offset custody, `Range`/`206` delivery, and authenticated native
  playback. **The authoring API gains one word when it lands.**
- **Codec and duration admission facts.** Only useful once video ships;
  Snapback 1 could not express them either
  (`issues/20260817-upload-intent-codec-duration-admission-facts.md`).
- **Recipient grants and signed share links** — deferred, and **verified
  additive** (author ruling, 2026-09-01). There is no link to a photo on its own:
  bytes are fetchable only by someone who may read the row holding them, so
  "copy image address" for a logged-out recipient works exactly when the row is
  public. Adding row-independent links later touches **one route or query
  parameter, a token-minting operation, and a decision about what a deleted row
  does to a live link** — and touches *none* of the column type, the value, the
  schema, the twin, the certificate, the storage layout, or any existing URL's
  meaning. `GET /api/asset/<assetId>` already names the asset, so a token would
  be an alternative authorization for the same request, not a second addressing
  scheme; affine makes "share this asset" unambiguous about what is shared and
  what revoking it means. The reason to defer is not cost but gravity: TTL,
  then revocation, then per-recipient grants, then view-once is LLP 0220's 342
  lines, which LLP 1005 §8 says not to rebuild. **The risk of deferring is
  behavioral, not technical** — an app that needs sharing may make a row public
  that should not be, and that is hard to walk back.
- **Ordered-collection operations** (insert-at, reorder-preserving item ids). A
  list column replaces the collection, not its operations.
- **Per-item residue and multi-upload ambiguity semantics** (LLP 0180). §3
  records the trade.
- **Arbitrary transforms**: crop, format negotiation, effects, cross-app
  deduplication, byte export/import.
- **A second authorization system for bytes.** The whole point.

## 14. What it costs

- **No new blocking check.** `rules/RULES.md` allows five; assets add none.
- **No certificate version bump and no new `Value` variant** (§1).
- **`check` stays under 1 s.** One schema node kind and one validation arm.
- **Binary size.** An image decoder, a HEIC decoder, and a resizer are real
  dependencies on a binary whose published size is a measured number (2.18 MB
  without the engine, 5.06 MB with). The largest honest cost, and the one remaining open question (OQ1).
- **A dropped upload retries in full** (§5) until video brings resume.
- **An empty first paint** until bytes arrive (§7).
- **Staging disk**: a per-principal cap (e.g. 256 MB or 20 objects) bounds what
  an authenticated principal can stage before reclamation. Both panelists asked
  for this number; it is internal, not authored.
- **Denormalized dimensions**, a few dozen immutable bytes per reference.

## 15. Implementation shape

`rules/RULES.md`: a spec needs an implementer and a date. Proposed, subject to
the author's scheduling:

| lane | scope |
|---|---|
| A | `_assets` ledger + lifecycle, the `image` column type, the `valid_column_value` arm, write-time validation (§6), reclamation (§9) — `snapback2-core` |
| B | upload + delivery routes, streaming staging, the finalize worker, both renditions — `snapback2` |
| C | `t.image()` in the compiler, `image` in Quarry, `api.d.ts` types incl. `File \| ImageAsset` client args |
| D | `run()` file substitution, `client.upload`, `AssetImage`, React; one template |

Fix loops get three rounds. The acceptance that matters is not a unit suite:
per LLP 1005 §6, this slice is not done until a real multi-megabyte file, a real
browser bundle with no relay in front of it, and a real phone have each been
through it — those three found every serious asset bug in Snapback 1, and none
was reachable from a harness.

## 16. The panel record

Revision (c) is the output of a two-round, two-family panel run under LLP 0005:
codex gpt-5.6-sol at `ultra` and grok-4.6 at `xhigh`, round 1 mutually blind,
round 2 cross-read. Full transcripts, with provenance and the independence
disclosure, are `llp/reviews/1006-assets.panel.codex.md` and
`llp/reviews/1006-assets.panel.grok.md`. The orchestrator (Claude Opus 5)
authored the document under review, did not vote, and contributed one proposal
in round 2 — validate-not-replace — which both panelists adopted.

The panel's brief made simplicity, elegance, and ergonomics binding over
feature count, and required every addition to name what it deletes. Its net
effect on this document was **six deletions, two defect fixes, and one
correction**, against **one addition** (the asset id in the URL, which pays for
itself by deleting the stale-cache bug).

## Confidence

**0.85** on §2 (byte authority is the row's read rule) — it follows from
existing rule evaluation, reproduces the property LLP 1005 measures as the moat
with strictly less machinery, and both panelists endorsed it in round 1 without
qualification.

**0.85** on §1/§6 (one closed record, validated not stamped). Two families
converged on it after one found the twin defect; the mechanism is checkable
against `engine/index.rs` today.

**0.8** on §3's claim that a list column replaces `assetCollection` for the apps
we have, and on §5 (no resume in slice 1) — the latter unanimous, but resting on
a judgment that photo uploads differ from video uploads in kind.

**0.75** on §10 (`File` in mutate as the paved call). A genuine panel split
decided on v1 evidence; codex's false-atomicity objection is real and answered
rather than dismissed.

**0.7** on §2a (affine). Ruled by the author, and the right call under this
document's ranking — but the confidence stays moderate because two strong
readers swapped sides on it, and because the linearity is the one rule in this
design that an ordinary-looking TypeScript value hides. If a real app trips
`E_ASSET_IN_USE` in a way that feels wrong rather than instructive, that is the
signal to revisit §12's rejected shape.

**0.8** on §8 (snap any width). Snapping is what makes both the ergonomics and
the bounded work possible at once; the residual risk is only in where the rungs
sit, which is a tuning number rather than a design decision.

## Rulings settled (author, 2026-09-01)

Recorded here so a reader knows these are decided, not merely proposed:

1. **Affine** — one asset, one home (§2a).
2. **Any width may be requested**, snapped internally; no closed ladder and no
   width refusal (§8).
3. **The full-resolution stripped original is kept**, with an optional `max`
   pixel ceiling per column (§4).
4. **Share links are deferred**, with their additivity verified and recorded
   (§13).

## Open questions (author)

1. **Is an image/HEIC decoder acceptable in the published binary?** (§14.) The
   alternatives are an out-of-process renderer — more machinery, slower — or
   serving originals only, which makes a feed download full-resolution images.
   This is a number, not an argument: the honest next step is to build with the
   decoders and measure the delta against today's 2.18 MB / 5.06 MB before
   deciding. Not blocking; nothing else in the design depends on the answer.
2. **When does video land?** §13 makes slice 2 required work rather than an
   optional tail — Clique's brief is not complete without it — and the authoring
   API gains exactly one word (`video`) when it does. The question is ordering
   against everything else in `snapback2/`, not design.

## What promotion to a Spec requires

`rules/RULES.md`: *"A spec needs an implementer and a date, or it isn't
written,"* and *"only implemented specs bind."* This document is complete enough
to implement — §15's four lanes are disjoint and the design questions that
gated them are ruled — but it stays an RFC until the author assigns an
implementer and a date. The standing arrangement routes implementation to codex
gpt-5.6-sol; the date is the author's scheduling call, not a number this
document may invent.
