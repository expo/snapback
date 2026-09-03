# LLP 1006: Assets — a column type

**Type:** RFC
**Status:** Draft
**Systems:** `snapback2-core` (the `_assets` ledger, the three asset columns,
the write-time validation, reclamation), `snapback2` (upload, delivery, and
session-carrier routes, the finalize worker, the container walker),
`snapback2-media` (the decode helper executable, §14a), `packages/compiler`
(the column types), `packages/quarry` (the notation), `packages/snapback2`
(client + React)
**Author:** Claude Opus 5 (design), commissioned by Charlie Cheever 2026-08-31;
revisions (f), (g), and (h) by Claude Fable 5.1 at the author's rulings, in
session, 2026-09-03
**Date:** 2026-08-31
**Revised:** 2026-09-03 (i — recorded at the author's delegation, no ruling
changed: the "upload this, then do X" question is answered in §12 — the
mutation is the "then", and a dedicated construct would be `defineMediaCommand`
returning — and the one real gap it exposed, assets minted by effects, is named
in §13 with its additive shape.); 2026-09-03 (h — the author's rulings on OQ1, in session:
**decode runs in a subprocess** — anything that produces pixels runs in a
separate media helper executable with no store handle, a timeout, and a memory
ceiling, while anything that walks boxes or chunks stays in-process (§9,
§14a); and **the codecs are chosen at build and install time** — the engine
binary carries none, the helper is built with `images`/`heic` features and
published as a default full variant and a slim one, and a helper that lacks a
codec refuses that format loudly rather than degrading (§14a). Ruling 7's "the
published binary carries the decoder" is narrowed to the default variant. No
open question remains.); 2026-09-03 (g — the author's rulings on the three questions
revision (f) added, in session: **`max` is withdrawn** — full resolution is
the only behavior, and the ceiling could not survive column-less upload (§4,
§12); **WebP and HEIC are both handled** — WebP joins the accept list with
chunk-level strip and pure-Rust decode, HEIC stays a server-side decode because
a browser hands over HEIC too, and the published binary carries the decoder
(§4, §14a); **bytes live beside the store when Snapback runs locally and in an
S3-compatible bucket on the hosted target**, behind one streaming-first,
content-addressed trait, delivered through the server in both cases (§9a).
Decode isolation (OQ1) is the only open question.); 2026-09-03 (f — the
author's ruling: **video and non-media files
ship in slice 1**, not a later one. Three column kinds — `image`, `video`,
`file` — each with its own closed record (§1); the upload names its kind, not
its column (§5); `duration` and `size` ride the record so admission policy
beyond bytes is ordinary rule code, which retires the codec/duration ticket and
LLP 0305 for Snapback 2 (§3); the v1 container walker is ported, not rebuilt
(§9); `Range`/`206` and attachment delivery for every kind (§2); a **session
carrier** so a `<video>` element and a native player can fetch private bytes
(§2b), which retracts revision (c)'s "no signed query tokens" for the *session*
case only and keeps share links deferred (§13); strip is by detected type, and
`file` carries no privacy claim beyond the formats the walker knows (§4);
resume stays out with its return trigger written down (§5). Three open
questions are added and none is ruled: the `max` ceiling against column-less
upload, the brief's formats, and where bytes live. Not panel-reviewed; see
§16.); 2026-09-01 (e — codecs behind cargo features, mirroring
`--features hermes`: the `image` **type** is unconditional in every build
because the engine and the twin must agree on the schema vocabulary, while the
**codecs** are optional and a codec-less binary refuses finalize loudly (§14a).
A runtime plugin API and an external image service are recorded as rejected
(§12). OQ1 is reframed from "is the binary too big" to "in-process or
subprocess," because decoding hostile bytes in the engine's address space is a
blast-radius question, not a size question — and it is settled by two
measurements rather than an argument.); 2026-09-01 (d — the author's rulings, in session: **affine**
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
LLP 0329.014.004, LLP 0305 (retired for Snapback 2 by §3), LLP 1007 §4a
(the two bars), `rules/RULES.md`, `rules/NOT-DOING.md`,
`benchmarks/briefs/social-messenger.md` (the formats the capability bar
needs), `crates/snapback-services/src/assets_video.rs` (the walker §9
ports), `llp/reviews/1006-assets.panel.codex.md`,
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
Four photos is `[image <=12000000] <=4`, so there is no collection. A clip is
`video <=50000000` and an attachment is `file <=25000000` — the same shape with
a different record (§1) — so there is no second pipeline. Uploads settle before
the write, so there is no media command.

The whole feature is three column kinds, three HTTP routes, and reclamation.

**This is a proposal.** `rules/RULES.md`: only implemented specs bind, and a
spec needs an implementer and a date. §15 proposes both; nothing here binds
until code runs it. It was commissioned in-session, which is the explicit
approval the agent rule requires for adding a design document.

The author's rulings of 2026-09-01 are folded in: an asset has one home
(§2), any width may be requested (§8), and the stripped original is kept
(§4). The rulings of 2026-09-03 are folded in: video and non-media files are
slice-1 work, not a later slice (§1, §13); there is no resolution ceiling
(§4); WebP and HEIC are both admitted (§4); and bytes live beside the store
locally and in an S3-compatible bucket when hosted, behind one trait (§9a).
Decode runs in a subprocess and the codecs are chosen at build and install
time (§14a). No open question remains.

## 1. The move

Snapback 1's asset id was a string the rest of the system had to be taught
about, one seam at a time: the result contract did not know it (LLP 1005 §5a —
the flagship "feed with photos" shape was inexpressible and needed two separate
repairs), the live-query planner did not know it, the generated types did not
know it, and LLP 0244 spent 809 lines building the projection seam that finally
reconciled them.

Snapback 2 makes the asset a **column type whose value is one closed record**.
There are three column kinds, and each has its own record:

```ts
type ImageAsset = Readonly<{ id: string; width: number; height: number }>
type VideoAsset = Readonly<{ id: string; width: number; height: number; duration: number }>
type FileAsset  = Readonly<{ id: string; size: number; type: string; name: string }>
```

`width` and `height` are display pixels; `duration` is integer milliseconds;
`size` is stored bytes; `type` is the *detected* media type essence
(`application/pdf`, or `application/octet-stream` when detection cannot name
it); `name` is the uploader's filename, sanitized (§5). Every field is a fact
the ledger holds, so every field is validated at write (§6). Each record is
closed: no optional field, and no field that varies by build or by target.

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
`kind` (`image | video | file`), `type` (the detected essence), `bytes`,
`width`, `height`, `duration`, `name`, `created_by`, `created_at`, and the
`locator` of §2a; a field a kind does not have is null. It is a staging and
ownership ledger. After validation it is not the source of truth
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
GET /api/asset/<assetId>            the stored bytes (for an image, the stripped original — §8)
GET /api/asset/<assetId>?w=<width>  a derived width — image only; ignored for video and file
```

Every delivery honors `Range` and answers `206` with `Content-Range` and
`Accept-Ranges: bytes` — native players will not start without it, and PDF
viewers use it. Every delivery carries `X-Content-Type-Options: nosniff` and
the *detected* `Content-Type`. A `file` is always
`Content-Disposition: attachment; filename="<name>"`: user bytes served from
the app's own origin must never be invited to render inline, which is the
same-origin script lane Snapback 1's `forces_attachment_disposition` closed
for SVG, HTML, XML, and JavaScript. Image and video render inline.

```tsx
<AssetImage asset={photo} />
<AssetVideo asset={clip} />
<AssetFile asset={doc} />
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

### 2b. The session carrier (author ruling, 2026-09-03)

Revision (c) said "there are no signed query tokens": a private image is
fetched with the session's bearer header and painted from a blob URL. That
holds for an image and fails for what video and files bring in. A `<video>`
element, a native player, and a PDF viewer cannot send a header, and a blob
URL for a 50 MB clip means downloading all of it before the first frame. The
client keeps its session as a bearer token in a token store, not a cookie,
and a cookie would not survive the ordinary development topology — the app on
one origin, `SNAPBACK_URL` on another (§12).

So the asset route accepts one additional credential, **a session carrier in
the query string**:

```
POST /api/auth/asset-session            → { "token": "…", "expiresAt": … }
GET  /api/asset/<assetId>?s=<token>
```

The carrier is minted from an authenticated session, bound to it, expires
within minutes, and dies with it — logout revokes it. It authenticates **the
same viewer, for the asset route only**; the row's read rule is still
evaluated on every request, exactly as with the bearer header. It is a
*credential*, not a *grant*: it names no asset, carries no authority of its
own, cannot be handed to another person for longer than its expiry, and does
not reopen §13's share-link deferral. A missing, expired, or invalid carrier
is the same as no credential, so a copied URL on a `public` row still serves
after the token dies — pasteability is unchanged.

The SDK does this invisibly: `<AssetImage>`, `<AssetVideo>`, `<AssetFile>`,
and `useAssetUrl(asset)` attach a live carrier whenever the client is
authenticated and refresh it before it expires (§10). Two rules for the
server: the carrier is never written to the request log, and a response to a
request that carried one is never `Cache-Control: public` — the token makes
the URL per-viewer, and a shared cache must never key on it. The token's
mechanism (opaque and stored, or keyed and stateless) is the implementer's;
the contract is the four properties above.

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
  photos: [image <=12000000] <=4
  at: time
  by bySpaceAt: space, at
  read r <- exists members[space, viewer]
  insert r <- r.author = viewer and exists members[space, viewer]
  delete r <- r.author = viewer

table messages:
  sender: id
  recipient: id
  body: text <=500 ?
  photo: image <=10000000 ?
  clip: video <=50000000 ?
  doc: file <=25000000 ?
  at: time
  by byPairAt: sender, recipient, at
  read r <- r.sender = viewer or r.recipient = viewer
  insert r <- r.sender = viewer

mutation setAvatar(avatar: image <=5000000):
  ~profiles[viewer] { avatar }

mutation publish(space: spaces, body: text <=500, photos: [image <=12000000] <=4) -> posts:
  require exists members[space, viewer] else NOT_MEMBER
  post = +posts { space, author: viewer, body, photos, at: now }
  post { id, photos }

mutation sendClip(recipient: id, clip: video <=50000000):
  require clip.duration <= 60000 else TOO_LONG
  +messages { sender: viewer, recipient, clip, at: now }

mutation sendDoc(recipient: id, doc: file <=25000000):
  +messages { sender: viewer, recipient, doc, at: now }
```

```ts
export const profiles = table({
  columns: { handle: t.text(40), avatar: t.optional(t.image(5_000_000)) },
  // …
})
export const posts = table({
  columns: {
    photos: t.list(t.image(12_000_000), { max: 4 }),
    /* … */
  },
  // …
})
export const messages = table({
  columns: {
    photo: t.optional(t.image(10_000_000)),
    clip: t.optional(t.video(50_000_000)),
    doc: t.optional(t.file(25_000_000)),
    /* … */
  },
  // …
})
```

`avatar` and `photos` both keep their full resolution (§4). `clip` and `doc`
are the same shape with a different word. All are one type and a bound, read
the same way as `text <=40`.

That is the entire authoring surface. `image`, `video`, and `file` read
exactly like `text`, because they are exactly as complicated: a type with a
bound. Widen `profiles` read to `public` and the same bytes become pasteable —
privacy is the table's read rule, and that is the whole privacy API. A DM
image is `photo: image <=10000000 ?` under
`read r <- r.sender = viewer or r.recipient = viewer`, and a DM attachment is
`doc: file <=25000000 ?` under the same rule.

**Policy beyond bytes is rule code, not grammar.** The record carries
`duration` and `size` as validated facts (§6), so a rule the schema cannot
spell is one line in the mutation: `require clip.duration <= 60000 else
TOO_LONG`. Snapback 1 could not express Coterie's sixty-second rule at all
(`issues/20260817-upload-intent-codec-duration-admission-facts.md`) and
LLP 0305 proposed a declared-admission grammar for it; both are retired for
Snapback 2 by putting the fact in the value. Lane C must let a `require` read a
field off an asset-typed argument — the parser already has member access.

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
  outcome with no declaration, no escape hatch, and no diagnostic. Strip is a
  walk over segments or chunks, not a decode: it removes the metadata
  containers — EXIF, XMP, IPTC, PNG text chunks, WebP's `EXIF` and `XMP `
  chunks — and leaves the pixel data and the color profile in place, so the
  stored original is the uploader's pixels exactly. Decode happens only for
  derived widths (§8) and for HEIC.
- **The type is the accept list.** `image` admits JPEG, PNG, WebP, and HEIC
  (author ruling, 2026-09-03: WebP and HEIC are both handled, not one or the
  other — the brief names WebP, and phones hand back HEIC). `video`
  admits MP4 and QuickTime MOV — what phones hand back — and inspects the
  container only: no decode, no transcode, no codec refusal (§13). `file`
  admits anything. The *detected* type governs, never the declared one and
  never the filename; bytes that are not admissible as the requested kind (§5)
  are `E_ASSET_TYPE`. SVG, HTML, XML, and JavaScript are not images and are
  refused under `image`; under `file` they are stored and always delivered as
  an attachment (§2).
- **Strip is by detected type, not by column** (author ruling, 2026-09-03).
  JPEG and PNG are stripped by the image path and MP4 and MOV by the container
  walker (§9) wherever they land — including a photo dropped into a `file`
  column, which is exactly where an "attachments" field would otherwise become
  the escape hatch the previous bullets promise does not exist. What the
  walker cannot prove location-free it refuses under `video` (`E_ASSET_TYPE`,
  as v1 did) and stores byte for byte under `file`. HEIC is decoded only under
  `image`; under `file` it is stored as uploaded and is the one strippable
  format that escapes — recorded here rather than hidden. **Everything else in
  a `file` column carries no privacy claim**: a PDF keeps its author field, a
  DOCX its revision history. The guarantee Snapback 1 measured is scoped to
  the formats Snapback can walk, and this document says so rather than
  implying more.
- **HEIC normalizes to JPEG at admission.** iOS libraries are HEIC-first and
  pickers hand back HEIC even in compatible mode (LLP 1005 §6); Snapback 1 still
  cannot decode it (`issues/20260819-heic-image-normalization.md`, open).
  Accepting HEIC and storing an unservable original would reproduce the bug.
  This is a **server-side** decode, ruled so on 2026-09-03: the Expo SDK may
  transcode on the device as a courtesy, but a browser hands over HEIC too —
  dragged from Photos, or picked in Safari — and only the server covers every
  path. The HEIC decoder therefore ships in the default published variant of
  the media helper, and a slim variant that omits it refuses a HEIC upload
  loudly (§14a). WebP is stored as WebP — its
  bitstream kept, its metadata chunks dropped — and decoded, in pure Rust, only
  for derived widths.
- **The full-resolution image is kept, stripped** (author ruling, 2026-09-01).
  "The original" always means the full-size image *after* metadata removal —
  never the bytes as uploaded. Keeping the literal upload would keep the GPS
  this section promises to remove, and the one property Snapback 1 measurably
  beat the field on would be false the moment anyone fetched full size.
  Derived widths (§8) come from that stripped source.
- **There is no resolution ceiling** (author ruling, 2026-09-03; revision
  (d)'s optional `max` is withdrawn). Full resolution is the only behavior,
  and it is the *reversible* one — a smaller image can always be derived from
  a larger one, never the reverse. The ceiling could not survive column-less
  upload (§5): finalize does not know the column, so it cannot know the
  ceiling, and a record naming the uncapped dimensions would have to be either
  rewritten at write — the stamp the panel rejected (§1) — or left lying about
  the served bytes. An app that wants smaller originals downscales on the
  device, which the brief permits. `image` has no optional field at all, and
  reads exactly as "a type and a bound."
- **The bound is bytes**, enforced at admission and re-checked at write; over is
  `E_ASSET_TOO_LARGE`. Both refusals ride the existing `input` family.

**Upload authority is "an authenticated principal," with no knob.** An asset
nobody references is undeliverable and reclaimed, so an upload on its own grants
nothing; the authorization that matters is the `insert`/`update` rule on the
mutation that references it. The residual exposure is disk, bounded by a
per-principal staging cap (§14) — a number, not a rule.

## 5. Upload: one POST

```
POST /api/upload?as=image|video|file[&name=<filename>]
Authorization: Bearer …
Content-Length: …
<body = bytes>
→ 200 ImageAsset | VideoAsset | FileAsset      (the record for `as`)
  | 422 { "code": "E_ASSET_TYPE" | "E_ASSET_TOO_LARGE", "family": "input", … }
```

**The upload names its kind, not its column** (author ruling, 2026-09-03).
`as` is one of three words — the same three the schema uses — and it is what
finalize needs to know: strip and derive widths, walk a container, or store
bytes. It is not the destination-column handle the panel rejected (§12): it
selects no policy beyond the kind's accept list, records no destination, and is
enforced by nothing at write except the ordinary rule that a `video` column
takes a `VideoAsset`. It exists because a JPEG is a legitimate `file` — an
attachments column takes photos and PDFs alike — and detection alone cannot
tell which record the caller wants back. The SDK always knows: the generated
argument types say which kind a column is, so the paved call passes `as`
without the author seeing it, and the two-phase `client.upload(file, { as })`
makes it a required option rather than a remembered one (§10). A missing or
unknown `as` is `E_ASSET_TYPE`.

`name` is read only for `as=file`. It is the uploader's filename and the one
client-supplied fact in any record: sanitized to a single path segment,
control characters removed, bounded at 255 bytes, defaulted to `file` when
empty, and stored on the ledger, where §6 validates it like a dimension.
`Content-Length` is required; a body over the generation's largest bound for
that kind is refused before it is read.

The response arrives **after finalize**, so there is no author-visible
`receiving` state and no readiness race. `E_ASSET_NOT_READY` survives only as a
forged-id refusal, never a happy-path state. Image and file finalize answer
within the request. Video finalize is a linear pass over box headers with no
decode (§9) and is expected to answer within the request too; if the phone
matrix says otherwise, §9's off-writer worker is where it moves, and the
response shape does not change.

**Resumable upload is still not in slice 1, and revision (f) makes that a
conscious deferral rather than an inherited one.** Revisions (a) and (b)
specified TUS on the strength of LLP 1005 §4, which measures
0-bytes-retransmitted as a real v1 differentiator — but measures it on a
*120 MB video on a killed process*. Both panelists concluded that a 12 MB
photo does not earn the machinery, and that hiding TUS behind one promise
deletes none of it: create/`PATCH`/`HEAD` routes, durable offsets, fingerprint
custody, expiry reconciliation, chunk negotiation, TUS CORS headers, and their
failure tests all remain. A dropped upload retries in full. Revision (e) said
TUS returns with video; video is now in slice 1 and TUS still is not, because
the brief's clip is 50 MB on a fixture path. **The trigger is written down:**
when §15's real-phone acceptance shows a dropped 50 MB upload on a mobile
radio as an ordinary event rather than a rare one, TUS with client offset
custody comes back, and the author-facing call does not change when it does.
This is the item in the design most likely to bite first.

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
   Snapback 2 has no supervised bundler and no relay to hide behind. `as` and
   `name` ride the query string precisely so the upload adds no header to the
   allow-list.

## 6. The write: validated, not stamped

Snapback 1 required `ctx.assets.attach(...)` inside the mutation, and a write
storing an asset id without it was refused `SNAPBACK_ASSET_REF_UNVERIFIED`. The
refusal is correct — a forged string must not become an authorized reference —
and LLP 1005 §5b records that essentially every author discovered it by hitting
it rather than by reading.

Here there is no call. Validation splits cleanly across the two twins:

- **The twin** (pure, and the server repeats it): closed-shape check for the
  column's kind — an `id` of valid syntax; positive bounded integer `width`
  and `height` (image, video), `duration` (video), `size` (file); bounded
  strings `type` and `name` (file); no missing or extra fields; unique ids
  within a list. It stores the value unchanged.
- **The server, additionally**, in the writing transaction: the ledger row
  exists, is `ready`, and is of the column's kind; `created_by` is the writer
  (or `system`, so an effect's `then` mutation can place an asset the service
  principal produced — §13 records how such an asset would be minted, and
  nothing mints one yet); **every field of the record equals the ledger** —
  `width` and `height` for an image, plus `duration` for a video, and `size`,
  `type`, and `name` for a file; bytes are within this column's bound. Under option A it also requires the asset unclaimed and claims it
  (`E_ASSET_IN_USE` otherwise).

Then it stores the argument unchanged. A forged id, an altered dimension, or
someone else's upload is refused in the `input` family; the optimistic frame
rolls back exactly as it does for a unique-index collision.

There is nothing to remember to call, so there is nothing to forget, and the
forged-string property is preserved.

## 7. Reading

```json
{ "id": "as_…", "width": 1290, "height": 1720 }
{ "id": "as_…", "width": 1920, "height": 1080, "duration": 12400 }
{ "id": "as_…", "size": 184211, "type": "application/pdf", "name": "lease.pdf" }
```

That is the whole value, one line per kind. Revision (b) also carried `kind`,
`hash` (a thumbhash) and `digest` (a sha256) on the image; all three are gone,
cut independently by both panelists:

- **`digest`** was in the design because LLP 1005 §7 named Convex's queryable
  digest as the one strictly-better competitor idea in the bakeoff. That is
  precisely a feature adopted because a competitor has it, which this RFC's
  own ranking forbids. The ledger may keep it for `snapback2 data`; no named
  app queries it.
- **`hash` and `digest` together** are a pair authors will swap. If a
  placeholder is ever added it must be spelled `thumbhash`.
- **`kind`** is redundant on an image or a video: the column already says
  which, and delivery supplies the real type in `Content-Type`. A `file`
  carries `type` for the opposite reason — the column says nothing, and a
  message list needs an icon and a label before anyone fetches the bytes;
  `size` and `name` are there for the same reader. `duration` is on a video
  because a badge, a scrubber, and a `require` (§3) all need it before
  playback.

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

**Widths are an image concern.** `?w=` on a video or a file is ignored — the
stored bytes are served — and neither has a poster frame or a thumbnail (§13).
A derived width is encoded as JPEG, or PNG when the source has alpha; the
stored original keeps its own format (§4).

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
validation and strip run on a worker thread outside any store transaction,
and that thread hands anything that produces pixels to the media helper
subprocess (§14a); success is one small write flipping
`_assets.state` to `ready` and answering the POST.

**Three finalizers, one lifecycle.** Image finalize is strip, in-process, then
HEIC decode and the common rungs (§8) in the helper subprocess (§14a). **Video
finalize is the v1 container walker, ported,
not rebuilt** (author ruling, 2026-09-03):
`crates/snapback-services/src/assets_video.rs` is 894 lines with its tests. It
blanks every location-bearing box in place by renaming it to `free` and
zeroing its payload, so no `stco`/`co64` chunk offset moves; bounds metadata
payload and box depth against bombs; handles the QuickTime
`meta`-is-not-a-fullbox case LLP 1005 §6 records; and reads display `width`,
`height`, and `duration` from `tkhd` and `mvhd` on the way past. It is pure
Rust and needs no cargo feature. What it cannot prove location-free it
refuses. File finalize is detection, size, the sanitized name, and — for JPEG,
PNG, MP4, and MOV — the same strip (§4). All three stream to staging and run
off the writer; none decodes video, and none makes a poster frame.

**`_assets` owns its own lifecycle.** Revision (b) proposed hanging finalize on
LLP 1003's `_outbox`; both panelists rejected it, and they are right — the
ledger already has the states, and borrowing the effect runner drags in
`sent_unknown`, manual requeue, and effect tracing that image finalize does not
want. The outbox stays for effects. A transcode, if one is ever added, is the
reason to revisit it; the walker is not one.

**Reclamation is `locator IS NULL` over `_assets`** (§2a) — it never scans
application tables. An asset whose row was deleted, whose column was patched,
or that was never referenced has a null locator and is collected after a grace
period, along with its derived widths. **Liveness buys space and never
authority** — an unreferenced asset is already
undeliverable (§2), so a reclamation pass that lags or crashes is a disk cost,
not a disclosure. Snapback 1's equivalent bug is open today: a partial reset
wipe leaves orphans that are never reclaimed *and* undetectable
(`issues/20260821-orphan-blob-reclamation-after-reset.md`).

### 9a. Where bytes live (author ruling, 2026-09-03)

**Locally, beside the store; hosted, in an S3-compatible bucket; delivered
through the server in both cases.** One trait, streaming-first, three
operations — put a stream and get back a key, get a key with an optional byte
range as a stream, delete a key — and no whole-object buffer anywhere in its
signature, so v1's `read → Vec → put` debt (LLP 1005 §9) cannot be written
against it.

- **Keys are content addresses**: the SHA-256 of the *stored* bytes, after
  strip. A blob is immutable once written. A ledger row holds its key; a
  derived width is keyed by source key and rung. Two uploads of the same photo
  are two ledger rows and one blob — affine (§2a) is a property of rows, not
  of bytes — so the "two copies" cost §2a records is paid once.
- **Local** — development, and any single machine: `.snapback/blobs/` and
  `.snapback/staging/` beside `.snapback/store.sqlite`, inside the owner-only
  directory the owner already enforces. Staging is always local disk: the
  request streams into it and finalize reads from it. The per-principal
  staging cap (§14) is enforced there.
- **Hosted**: an S3-compatible bucket — S3, R2, Tigris — with the same keys,
  landing with the hosted target (LLP 1002), which does not exist yet. Slice 1
  ships the filesystem implementation only; the trait is what makes the
  second an addition rather than a change.
- **Delivery is always `GET /api/asset/<id>`** (§2). The server evaluates the
  row rule on every request, wherever the bytes are. Locally it streams the
  file. Hosted, after authorization, it may stream through or answer `302` to
  a presigned object URL whose expiry is measured in seconds: the bytes then
  leave the single owner's process, `Range` is native to the bucket, and a
  copied presigned URL outlives a downloaded copy by nothing that matters — §2
  already concedes that downloaded bytes cannot be recalled. A CDN is a
  deployment choice in front of the public path — `public, immutable`
  responses are already shaped for one — and never a place authority lives.
- **Reclamation** keeps its trigger — `locator IS NULL` over `_assets` (§9) —
  and adds one step: a blob is deleted when no ledger row references its key.
  The count is derived at sweep time, not maintained.
- **`reset`** clears `_assets` and empties `.snapback/blobs/` and
  `.snapback/staging/` (or the bucket prefix) in the same operation that
  clears the rows. v1's orphan-after-reset bug becomes a leak the sweep can
  see: a key in the directory and in no ledger is garbage by definition.
- **`fork`** is a snapshot of the store into `.snapback/forks/<name>.sqlite`,
  not a copy of the blobs. Blobs are immutable and content-addressed, so a
  fork shares them; the sweep treats every ledger under `.snapback/` — live or
  fork — as a referrer, so restoring a fork never restores a row whose bytes
  are gone.

## 10. Clients

React web first, Expo second (LLP 1000 decision 5); Exact 2 follows.

The paved call assigns a `File` directly, and the SDK uploads it — passing
the column's kind as `as` (§5) — and substitutes the record before the
mutation is sent:

```tsx
setAvatar.run({ avatar: file })
publish.run({ space, body, photos: files })   // 1–4 Files
sendClip.run({ recipient, clip: file })
sendDoc.run({ recipient, doc: file })
```

Generated client argument types accept `File | ImageAsset` (or `VideoAsset`,
`FileAsset`, by column); handlers, the engine, and the twin only ever see the
record (§6), so this is a client convenience and not an engine concept. The
two-phase form remains available for progress UIs and for carriers that are
not the browser's `File`, and there `as` is a required option:

```ts
const avatar = await client.upload(file, { as: "image", onProgress })
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

Rendering is one component per kind (§2a). `<AssetImage asset={photo} />`
measures its own box and requests a matching width (§8) — the author names no
size. `<AssetVideo asset={clip} />` is the platform's native player with
`controls`, sized from the record's `width` and `height` so a tile never
collapses (Diary 0087), streaming by `Range`. `<AssetFile asset={doc} />` is a
download link showing `name` and a formatted `size`. All three take their URL
from `useAssetUrl(asset, { width? })`, which is exported for anything custom,
and all three carry the session carrier of §2b whenever the client is
authenticated — so a private clip plays in a plain `<video>` element, and a
private image no longer needs the fetch-to-blob path revision (c) specified,
though the SDK may keep it where a header is cheaper than a token. Expo's
native players take the same URL; that arm lands with the Expo package
(LLP 1000 decision 5).

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
| `private-signed` delivery profile, per-asset signed URLs, signing-key rotation | the session carrier (§2b) | a credential for the same viewer, not a grant on an asset |
| Pre-declared renditions | any width, snapped (§8) | nothing to name wrongly, no ladder to learn |
| TUS in the first slice | one POST (§5), with the return trigger written down | the measurement was 120 MB on a killed process |
| `accept.video` sibling block + LLP 0305 declared codec/duration admission | `video <=N`; `duration` in the record; policy is a `require` (§3) | the fact is in the value, so the rule language already covers it |
| Video transcoding, poster frames, thumbnails | — | the brief says played as uploaded (§13) |
| `forces_attachment_disposition` | kept, for `file` (§2) | a steal, not a deletion — the same-origin script lane stays closed |
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

**A runtime plugin API for media processors.** A loadable extension point —
third-party thumbnailers, transcoders, new media kinds. Rejected on three
grounds: it is an ABI to version forever in a codebase whose rule is "delete;
don't deprecate"; `rules/RULES.md` says agents remove apparatus and add none,
and an extension point with no users is pure apparatus; and it would put a
plugin boundary through trusted admission, which is the single place this
design's privacy property is enforced. Codecs being *optional at compile time*
(§14a) delivers the buildability benefit a plugin was reaching for, with none of
the surface. The media helper executable (§14a) is not a plugin API either: it
is the same workspace, built with the same features, spoken to over a private
protocol, with no third-party extension point.

**Decoding in the engine's address space.** The field's norm — Snapback 1 did
it for a year, and every backend in the LLP 0139 bakeoff does — and revisions
(c)–(g) kept it open as OQ1 pending two measurements. Ruled out on 2026-09-03
without waiting for them: a process spawn costs milliseconds against a decode
that costs hundreds, so the isolation is nearly free, and a decoder bug
in-process is the application's data, not its images. The measurements become
a post-landing check on the helper's spawn cost rather than a gate.

**Delegating image processing to an external service** (imgproxy, Cloudinary, a
sidecar). Rejected: it breaks the high-fidelity local target, which LLP 1005 §7
records as one of only two credible offline development stories in the entire
bakeoff, and it routes private bytes through a third party, which undercuts the
unconditional stripping guarantee of §4.

**A destination column named at upload** (`api.assets.<table>.<column>`).
Codex argued for it: an 8 MB image should fail before it is normalized and
thumbnailed for a 5 MB avatar column. Grok's counter carries: a per-column
handle enforced at claim *is* the per-column upload rule already deleted, and it
adds a generated namespace to avoid a collision only that namespace creates.
Upload is column-less; the bound is re-checked at write, like `text <=40`. The
wasted work is one image resize on a refusal path. **If a per-column accept list
ever lands** (PNG-only avatars, H.264-only video), that is the add that puts the
destination back, and it deletes the generation-wide admission ceiling. Naming
the *kind* at upload (§5) is not this: it is one of three schema words, it
selects no column policy, and it exists only because a JPEG can legitimately
be a `file`.

**An "upload this, then do X" construct.** Raised on 2026-09-03 — "upload this
file, then set it as the profile photo." That is the paved call:
`setAvatar.run({ avatar: file })` uploads, waits for finalize, substitutes the
record, and runs the mutation, whose body *is* the "then" (§10); if the
mutation refuses, no row is written and the upload is reclaimed. A dedicated
construct would be `defineMediaCommand` returning under a new name (§3, §11),
and it could not live inside a mutation anyway: a mutation is one transaction
in the Rust interpreter, and an upload is I/O. Steps *after* the write are
effects — `emit` in the mutation, a TypeScript body, a `then` mutation
(LLP 1003) — which Quarry already has. The one thing neither covers, an asset
produced by an effect, is a named non-goal (§13).

**One `asset` column type with a union record.** Considered for revision (f)
as the way to make an attachments column take photos and PDFs alike without
naming a kind at upload. Rejected: it makes the twin's closed-shape check a
union, makes "what does delivery do with an image record in a file column" a
question, and breaks the one-record-per-column promise that keeps §6 simple.
Three words, three records, and `as` on the upload build the same app with
none of that.

**A cookie session for the asset route.** The obvious way to let `<video>` and
`<img>` authenticate. Rejected: in the ordinary development topology the app
and `SNAPBACK_URL` are different origins, so the cookie is third-party, which
means `SameSite=None; Secure` and therefore TLS in development. The
query-string carrier (§2b) works on `http://localhost` and on a phone.

**Per-asset signed URLs** (v1's `private-signed`). Still rejected, and the
session carrier is not one: a signed URL names an asset and carries authority
for it, which is a grant; the carrier names a viewer and carries nothing, and
the row rule still decides (§2b).

**Poster frames and video thumbnails.** They need a video decoder —
ffmpeg-class dependencies, the largest binary and blast-radius cost anywhere
in this design. The brief says a poster is optional and the player shows the
first frame. Rejected for slice 1; the client is free to take a frame locally.

**An optional `max` pixel ceiling** (revision (d)). Withdrawn on 2026-09-03
for the conflict §4 records: upload does not know the column, so finalize
cannot apply the ceiling, and every way to make the record agree with the
capped bytes was something this document had already refused. The reversible
default was the only part worth keeping, and it is now the only behavior.

**Client-side HEIC transcoding as the only HEIC path.** Considered on
2026-09-03 as the way to delete the C decoders from the published binary.
Rejected: a browser hands over HEIC too, and a path that only the Expo SDK
covers is the paved-one-client trap LLP 1005 §9 warns about. The SDK may
still transcode as a courtesy; the server is the authority (§4).

**Direct-to-bucket upload, and bucket or CDN URLs for delivery.** The
pattern most of LLP 1005 §2's field uses. Rejected for the reason that field
lost the revocation test: bytes under a different authority than rows disagree
exactly when it matters. Upload goes to the server so admission and strip are
trusted; delivery is authorized by the server on every request; the presigned
redirect of §9a is issued only after that authorization and lives for seconds.

## 13. Non-goals, with reasons

- **Video transcoding, codec refusal, and poster frames.** Video *is* in
  slice 1 (author ruling, 2026-09-03). Revisions (c)–(e) deferred it because
  the walker looked like weeks of work; it is a port (§9), and both panelists'
  reason for deferring — shipping video unstripped would surrender the one
  differentiator the bakeoff measured — is answered by porting it. What stays
  out is everything that needs a decoder. The brief names H.264/AAC and says
  played as uploaded; Snapback does not transcode and does not refuse HEVC, so
  an iPhone in its default "High Efficiency" setting uploads a clip that
  Chrome and Android will not play. **That is the client's problem by
  design:** an app that must guarantee cross-platform playback exports H.264
  on the device, where the picker already offers it. Recorded as the cost of
  not carrying a decoder.
- **Codec admission facts.** `duration` is in the record and needs no
  admission grammar (§3); codec is not, for the reason above. If a codec fact
  is ever wanted it is one more validated field, not a declaration.
- **Assets minted by effects.** An effect that fetches an image from a
  provider or renders a document has no way to produce an asset record for its
  `then` mutation to place; §6's `system` uploader escape exists for that case,
  and nothing fills it yet. Neither named app needs it, so it waits for one
  that does. **Verified additive:** the shape is one call on the effect context
  — put a byte stream with a kind, get back the same closed record an upload
  returns — through the same finalize (§9) and the same helper (§14a), with
  `created_by = system`. It touches no column type, no value, no schema, no
  twin, no route, and no rule. It is not a media command: the effect's `then`
  is Quarry's existing "do this after that" (LLP 1003), and the record it
  places is validated exactly as a client's would be (§6).
- **Per-column accept lists for `file`** (PDF-only, no executables). A `file`
  column admits anything; the first such list is the add that puts a
  destination back on the upload (§12), and no named app asks for one.
- **Inline preview of a `file`.** Always an attachment (§2). An in-app viewer
  fetches the bytes itself.
- **Metadata stripping for formats the walker does not know** (PDF, Office
  documents). §4 scopes the claim.
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
  what revoking it means. The session carrier of §2b is not a step toward
  this: it expires with the session and names no asset. The reason to defer is
  not cost but gravity: TTL,
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
- **`check` stays under 1 s.** Three schema node kinds and three validation
  arms.
- **Two executables.** The engine and the media helper ship together; the
  helper is where image size lives and is chosen at install (§14a). Video and
  file need no helper: the walker decodes nothing.
- **A spawn per finalize** — milliseconds, against a decode of hundreds
  (§14a).
- **Fifty-megabyte bodies through the HTTP layer.** `snapback2` reads request
  bodies into a 1 MiB JSON buffer today; uploads need a streaming body path to
  staging and a bound on concurrent uploads, so lane B is larger than "two
  routes" suggests.
- **About 900 lines of walker**, ported with its tests, and a real iPhone MOV
  in the corpus (§9).
- **One credential in a URL.** The session carrier (§2b) is the only secret
  this design puts in a query string; it is short-lived, session-bound, and
  kept out of logs.
- **A scoped privacy claim.** A `file` column strips what the walker knows and
  nothing else (§4).
- **Full-resolution originals, always** (§4). An app that wants smaller
  originals downscales on the device.
- **The C decoders in the default helper variant** (§14a), for HEIC; the slim
  variant omits them and refuses HEIC loudly.
- **Two blob-store implementations over time, one now** (§9a).
- **A dropped upload retries in full** (§5), now including a 50 MB clip; the
  return trigger for resume is recorded there.
- **An empty first paint** until bytes arrive (§7).
- **Staging disk**: a per-principal cap (e.g. 256 MB or 20 objects) bounds what
  an authenticated principal can stage before reclamation. Both panelists asked
  for this number; it is internal, not authored.
- **Denormalized dimensions**, a few dozen immutable bytes per reference.

### 14a. Codecs live in a separate executable; the type does not

Image decode and resize are heavy dependencies, and HEIC in particular is where
C libraries appear (libheif → libde265), which is what makes cross-compiling
the published platform packages awkward. Decoding is also the one place this
design parses hostile bytes with a decoder: an upload is attacker-controlled
input, and a decoder is a well-known remote attack surface (libwebp's
CVE-2023-4863 was a zero-click RCE). Two rulings of 2026-09-03 answer both
costs with one shape.

**Anything that produces pixels runs in a subprocess; anything that walks
boxes or chunks runs in-process.** Decode, resize, and re-encode — the derived
widths of §8 and the HEIC normalization of §4 — run in a separate executable,
`snapback2-media`, spawned by the finalize worker per job with the staging
file as its only input, no store handle, no network, a wall-clock timeout, and
a memory ceiling. A crash, a hang, or a decompression bomb kills the child and
refuses the upload in the `input` family; the engine and the store are
untouched. The parsers — JPEG/PNG/WebP chunk strip (§4), the video container
walker (§9), type detection — are bounded walks in safe Rust and stay
in-process, as the walker already does. Spawn is milliseconds against a decode
of hundreds, which is why this was ruled rather than measured; the measurement
OQ1 asked for becomes a post-landing check on the helper's spawn cost, not a
gate.

**The engine binary carries no codec.** `snapback2` is unchanged in size by
media, and a snapback2 developer who is not touching media never rebuilds an
image library against `rules/RULES.md`'s 15 s incremental and 5 min full-build
budgets. The helper is its own crate, with the pattern the JS engine already
uses:

```toml
# crates/snapback2-media
[features]
default = ["images"]
images  = [...]              # JPEG/PNG/WebP decode + resize + encode, pure Rust
heic    = ["images", ...]    # libheif → libde265, separable because it is the costly one
```

**The codecs are chosen at build and install time, never at runtime.** The
published package ships the helper in a **default variant** with every codec
§4 admits, and publish refuses to ship the default without them — a default
that cannot finalize what the schema admits is the v1 HEIC bug in a new coat. A
**slim variant** without `heic` is published under that name for installations
that will never see an iPhone photo and want the size back. Choosing it is an
install-time decision; nothing in a schema, a value, or a request depends on
which variant is present. `publish.mjs` reports each variant's size beside the
engine's.

**A missing codec refuses loudly; nothing degrades.** An installation with no
helper at all whose schema declares an `image` column refuses at boot, exactly
as the engine-less build does for effects; `video` and `file` columns need no
helper and boot without one. An installation whose helper lacks HEIC refuses a
HEIC upload with `E_ASSET_TYPE` and a hint naming the default variant. There is
no serve-the-original-only mode and no silent fallback — LLP 1005 §6's lesson
is that a capability the binary cannot honor must fail where the author can
see it.

**The `image`, `video`, and `file` column types are unconditional in every
build.** The Rust engine and the TypeScript twin must agree on every corpus
case, so a schema vocabulary that varies with a build flag or an installed
variant breaks the agreement — the same class of defect the panel caught in
revision (c)'s stamp. A codec-less installation still parses, certifies, and
type-checks a schema containing `image` columns; it just cannot finalize one.

## 15. Implementation shape

`rules/RULES.md`: a spec needs an implementer and a date. Proposed, subject to
the author's scheduling:

| lane | scope |
|---|---|
| A | `_assets` ledger + lifecycle, the `image`/`video`/`file` column types, the three `valid_column_value` arms, write-time validation (§6), reclamation with the derived key count and fork-aware referrers (§9, §9a), `reset` clearing the ledger — `snapback2-core` |
| B | the blob-store trait with its filesystem implementation and content-addressed keys (§9a), upload + delivery routes with streaming staging and `Range`/`206` (§2), the `as`/`name` parameters (§5), the finalize worker, chunk-level strip for JPEG/PNG/WebP, width snapping, the session-carrier mint and check (§2b), attachment/nosniff delivery, the helper spawn protocol (timeout, memory ceiling, no store handle), the no-helper boot refusal and the per-format refusal (§14a) — `snapback2` |
| B3 | the `snapback2-media` helper crate: decode, resize, encode, and HEIC normalization behind the `images`/`heic` features; the default and slim published variants and the publish-time refusal (§14a) |
| B2 | the container walker port from `crates/snapback-services/src/assets_video.rs` with its tests and a real iPhone MOV fixture, plus display-dimension and duration extraction (§9) — `snapback2` |
| C | `image`/`video`/`file` in Quarry (replacing the `asset` refusal at `packages/compiler/src/quarry/parser.ts:340`), the builders in the lowering target, member access on asset-typed arguments in `require` (§3), `api.d.ts` types incl. `File \| ImageAsset` client args by kind |
| D | `run()` file substitution with `as` by column, `client.upload`, `useAssetUrl`, `AssetImage`/`AssetVideo`/`AssetFile`, carrier refresh, React; one template with a photo, a clip, and an attachment |

Fix loops get three rounds. The acceptance that matters is not a unit suite:
per LLP 1005 §6, this slice is not done until a real multi-megabyte photo, a
real iPhone MOV of at least 50 MB that seeks in a real browser and plays on a
phone, a PDF through a real picker that downloads under its own name, a real
browser bundle with no relay in front of it, and a real phone have each been
through it — the original three found every serious asset bug in Snapback 1,
and none was reachable from a harness.

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

**Revisions (f), (g), and (h) were not panel-reviewed.** They fold the
author's rulings of 2026-09-03 — video and files in slice 1, and the answers to
the questions that raised — and the consequences the orchestrator derived from
them: chiefly the session carrier (§2b), the `as` parameter (§5),
strip-by-detected-type (§4), the storage trait (§9a), and the helper executable
(§14a). The Confidence section names the first three as the places a review
round should look first, and the standing arrangement — codex and grok,
mutually blind, then cross-read — is the right shape for it before lane B
starts.

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

**0.8** on video as a column with `duration` in the record (§1, §3). The
walker exists and is tested; the record is the same mechanism as the image's;
the brief's "played as uploaded" is exactly what a walk-and-serve pipeline
does.

**0.75** on the session carrier (§2b). It is the one credential this design
puts in a URL, and it retracts a line the panel endorsed; it is also the
smallest thing that makes a `<video>` element play a private clip, and every
alternative examined is larger (§12).

**0.7** on `as` at upload (§5) and on strip-by-detected-type under `file`
(§4). Both answer questions that video and files raised on 2026-09-03 and the
panel never saw; a review round on revisions (f)–(h) is the right next step
before lane B starts.

**0.8** on §9a. The trait is the shape every blob store ends up with, and
content addressing is what makes affine cheap and `fork` free; the presigned
redirect is the one piece that changes client-visible behavior, and only on a
hosted target that does not exist yet.

**0.85** on the helper subprocess (§14a). It is the standard containment for
decoders, its cost is predictable, and it closes the last open question; the
variant packaging is the one part that touches `publish.mjs`, and that script
already knows how to report a feature's size.

## Rulings settled (author)

Recorded here so a reader knows these are decided, not merely proposed. Items
1–4 are the rulings of 2026-09-01; items 5–10 are 2026-09-03:

1. **Affine** — one asset, one home (§2a).
2. **Any width may be requested**, snapped internally; no closed ladder and no
   width refusal (§8).
3. **The full-resolution stripped original is kept** (§4). Revision (d)
   paired this with an optional `max` ceiling per column; ruling 6 removed it.
4. **Share links are deferred**, with their additivity verified and recorded
   (§13).
5. **Video and non-media files ship in slice 1**: three column kinds and three
   records (§1), the walker ported (§9), `Range` and the session carrier in
   the first delivery route (§2, §2b), strip by detected type with the claim
   scoped (§4), resume still deferred with its trigger recorded (§5).
6. **No resolution ceiling.** Full resolution always; the device downscales if
   the app wants less (§4, §12).
7. **WebP and HEIC are both handled.** WebP joins the accept list with
   chunk-level strip and pure-Rust decode; HEIC stays a server-side decode, and
   the default published variant carries the decoder (§4, §14a; narrowed by
   ruling 10).
8. **Bytes live beside the store locally and in an S3-compatible bucket when
   hosted**, behind one streaming-first, content-addressed trait, delivered
   through the server in both cases (§9a).
9. **Decode runs in a subprocess.** Anything that produces pixels runs in the
   `snapback2-media` helper with no store handle, a timeout, and a memory
   ceiling; walkers stay in-process (§9, §14a).
10. **Codecs are chosen at build and install time.** The engine carries none;
    the helper is built with `images`/`heic` features and published as a
    default full variant and a slim one; a missing codec refuses loudly
    (§14a).

## Open questions (author)

None. OQ1 — in-process or subprocess decode — was ruled on 2026-09-03 and is
ruling 9; the three questions revision (f) added — the `max` ceiling, the
brief's formats, and where bytes live — are rulings 6–8.

## What promotion to a Spec requires

`rules/RULES.md`: *"A spec needs an implementer and a date, or it isn't
written,"* and *"only implemented specs bind."* This document is complete enough
to implement — §15's six lanes are disjoint and no question is open — but it
stays an RFC until the author assigns an implementer and a date. The standing arrangement routes implementation to codex
gpt-5.6-sol; the date is the author's scheduling call, not a number this
document may invent.
