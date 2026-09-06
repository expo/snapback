# LLP 1006: Assets — a column type

**Type:** RFC
**Status:** Accepted (author, 2026-09-03 — implementer and date assigned, §15)
**Systems:** `snapback2-core` (the `_assets` ledger, the asset columns, entry
and write-time validation, the lifecycle reconciler, the certified delivery
primitive, reclamation), `snapback2` (upload, delivery, and session-carrier
routes, the finalize worker, the container walker), `snapback2-media` (the
decode helper executable, §14a), `packages/compiler` (the column types),
`packages/quarry` (the notation), `packages/snapback2` (client + React)
**Author:** Claude Opus 5 (design), commissioned by Charlie Cheever 2026-08-31;
revisions (f)–(j) by Claude Fable 5.1 at the author's rulings, in session,
2026-09-03
**Date:** 2026-08-31
**Revised:** 2026-09-06 (r — explicit upload recovery and definitive-refusal cleanup);
2026-09-05 (q — image once, server one-use delivery, lane L11);
2026-09-04 (p/o — two-phase typed upload and descriptor fence; n — device
byte cache; m/l — finalized-byte reservation, reclamation, helper safety);
2026-09-03 (k — static decoder publication; j — second panel and author
rulings; i — effect-minted assets deferred; h/g — subprocess decode, codec
builds, original resolution, WebP/HEIC and blob storage; f — video and carriers);
2026-09-01 (e/d/c — unconditional types, affine custody, width snapping,
validation instead of stamping); 2026-08-31 (b/a — simplification and draft).
The verbatim log, panel record, confidence, and rulings ledger: LLP 1006.001.
**Related:** LLP 1000 (decisions 5, 6), LLP 1001 (§1 engine-owned tables, §3
states, §9 schema additions), LLP 1002 (§4 the wire), LLP 1003 (effects),
LLP 1004 (Quarry is the default surface), **LLP 1005** (the Snapback 1
evidence this answers), LLP 0005 (the review loop the panel ran),
LLP 0329.014.004, LLP 0305 (retired for Snapback 2 by §3), LLP 1007 §4a
(the two bars), `rules/RULES.md`, `rules/NOT-DOING.md`,
`benchmarks/briefs/social-messenger.md` (the formats the capability bar
needs), `crates/snapback-services/src/assets_video.rs` (the walker §9
ports), `llp/reviews/1006-assets.panel.codex.md`,
`llp/reviews/1006-assets.panel.grok.md`,
`llp/reviews/1006-assets.panel.claude.md`,
`llp/reviews/1006-assets.panel.synthesis.md` (the second panel, on (f)–(i))

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
`video <=50000000` — the same shape with a different record (§1) — so there
is no second pipeline. Uploads settle before the write, so there is no media
command.

The whole feature is two column kinds, three HTTP routes, one new engine
primitive, and reclamation. A third kind, `file`, is designed and deferred
(§13a).

**This is a proposal.** `rules/RULES.md`: only implemented specs bind, and a
spec needs an implementer and a date. §15 proposes both; nothing here binds
until code runs it. It was commissioned in-session, which is the explicit
approval the agent rule requires for adding a design document.

The author's rulings of 2026-09-01 are folded in: an asset has one home
(§2), any width may be requested (§8), and the stripped original is kept
(§4). The rulings of 2026-09-03 are folded in: video is slice-1 work (§1,
§13) and non-media files are designed and deferred (§13a); there is no
resolution ceiling (§4); WebP and HEIC are both admitted (§4); bytes live
beside the store locally and in an S3-compatible bucket when hosted, behind
one trait (§9a); decode runs in a subprocess and the codecs are chosen at
build time (§14a). The second panel's findings are folded (§16). No open
question remains.

## 1. The move

Snapback 1's asset id was a string the rest of the system had to be taught
about, one seam at a time: the result contract did not know it (LLP 1005 §5a —
the flagship "feed with photos" shape was inexpressible and needed two separate
repairs), the live-query planner did not know it, the generated types did not
know it, and LLP 0244 spent 809 lines building the projection seam that finally
reconciled them.

Snapback 2 makes the asset a **column type whose value is one closed record**.
Slice 1 has two column kinds, each with its own record; a third, `file`, is
designed in §13a and deferred:

```ts
type ImageAsset = Readonly<{ id: string; width: number; height: number }>
type VideoAsset = Readonly<{ id: string; width: number; height: number; duration: number }>
```

`width` and `height` are display pixels — after orientation, never sensor
pixels (§4); `duration` is integer milliseconds. Every field is a fact the
ledger holds, so every field is validated against the ledger — at mutation
entry for arguments and at write for columns (§6). Each record is closed: no
optional field, and no field that varies by build or by target.

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

- **The certificate value model does not move.** The record is a closed map
  of scalars, which the value model already has; the column is a new
  `ColumnType` variant with an arm in `valid_column_value` (`engine/index.rs`),
  beside `Json`, which already accepts an arbitrary `Value` under a byte
  bound. One detail the twin and the server must share: the wire maps a JSON
  object to `Value::Map` (`protocol.rs`, `json_to_value`), so the closed-shape
  check accepts the record as the wire delivers it, at the same point on both
  twins. Adding `Bytes`
  bumped the model from `i53-codepoint-v1` to `i53-codepoint-bytes-v2`
  (LLP 1001 §9); assets bump nothing, because they add no value kind.
- **There is no read path at all.** Reading an asset column costs what reading
  a `json` column costs. Snapback 1's projection ran on both the read and the
  write path; this runs on neither — validation happens once, at write.
- **An asset column is not indexable** (`E_SCHEMA_INDEX_COLUMN`, the refusal
  `List` already uses).

`_assets` remains an engine-owned table (LLP 1001 §1 — `E_SCHEMA_RESERVED`
already forbids declaring it): `id`, `state` (`receiving | ready | failed`),
`kind` (`image | video`), `type` (the detected essence), `bytes`, `width`,
`height`, `duration`, `created_by`, `created_at`, nullable `released_at`, and
the `locator` of §2a; a field a kind does not have is null. The blob key is the id (§9a), so there is
no key column. It is a staging and ownership ledger. After validation it is
not the source of truth for anything a program reads.

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

**That point read is one new core primitive, and this document says so.**
The second panel found that the engine has no such operation today: the
runtime's reusable rule probe scans every row of a table, and indexed read
plus certified rule evaluation exists only inside the program runner.
Revisions (a)–(i) called this "no new machinery"; it is machinery, and it is
named here so nobody ships delivery on the table scan. The primitive: in one
read transaction, resolve `_assets`, follow the locator to a point read of
the row, verify the cell (or list) still contains the exact id, and evaluate
the table's read rule under its stored certificate — exposed through the
owner's action channel, the same sole-writer path every read takes.

Consequences:

- **Revocation is exact and immediate for every request that reaches
  Snapback.** A rule that stops admitting the viewer stops admitting the bytes
  on the next request. Bytes a shared cache already holds for a `public` row,
  or a download already in flight, are outside that sentence, and this
  document says so rather than implying more.
- **Replacement and deletion are exact.** Patch the column or delete the row and
  the old path fails on its next request. Authority never waits on reclamation.
- **Pasteability is derived, not declared.** Except for `once` (§2a.1), public paths
  need no credential and are `Cache-Control: public, immutable` — the id is in
  the path and the bytes never change. Anything else is authorized per request
  and answered `Cache-Control: private, no-cache` with an `ETag`: the viewer's
  own browser keeps a copy but must ask before showing it, and the server
  evaluates the rule before answering `304`, so a revoked viewer's cache goes
  dark on the next render at the cost of one bodiless round trip. (Revisions
  (c)–(i) said `no-store`, which re-downloaded a private feed on every scroll;
  `private, immutable` was considered and rejected, §12.) LLP 1005 §5c is the
  most repeated friction in the v1 corpus — four builds burned choosing a
  delivery profile — and there is no profile here to choose.
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
GET /api/asset/<assetId>?w=<width>  a derived width — image only; ignored for video
```

Every delivery advertises `Accept-Ranges: bytes`: a plain request is `200`,
one satisfiable `Range` is `206` with `Content-Range`, and anything else is
`416` — native players will not start without it, and v1's closed range
parser is reused rather than rewritten. Every delivery carries
`X-Content-Type-Options: nosniff` and the *detected* `Content-Type`. Image and
video render inline; SVG, HTML, XML, and JavaScript are not images and never
reach delivery (§4). Attachment disposition arrives with `file` (§13a).

```tsx
<AssetImage asset={photo} />
<AssetVideo asset={clip} />
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
  edits, deletion, schema successors, `reset`, and `fork` — not a background
  concern. Revisions (c)–(i) stated the claim rule as "unclaimed, else
  `E_ASSET_IN_USE`", which refuses every list append and reorder, because the
  photos already in the list are claimed by the same cell. The second panel's
  fix: **one old-row/new-row reconciler** runs on insert, replace, delete, and
  every destructive schema successor — an asset in the new value and not the
  old is claimed (unclaimed, or already claimed *by this cell*); an asset in
  the old value and not the new is released; dropping a table or column
  releases what it held. Two schema refusals keep the invariant honest:
  asset types are refused in `maintain.by`, because a maintained projection
  copies a grouping value into another row, which would give an asset two
  homes silently; and asset values are refused in seeds, because no seed path
  mints a ledger row. Both are `E_SCHEMA_*` refusals at `check`, not runtime
  surprises.

If an app later needs one asset in several rows, the change is mechanical and
reversible: delete the locator, put the row coordinates back in the URL, and
move reclamation to a sweep. It is not a migration trap. §12 keeps the rejected
shape and its arguments so the choice is not re-litigated from scratch.

### 2a.1. One-use image delivery (Clique F3, 2026-09-05)

Implementer: GPT-6 Astra, lane L11, 2026-09-05. A column may say
`photo: image <=10000000 once` (also optional or in a bounded image list).
`video … once` refuses at `check`: range semantics are unspecified; use an
ordinary video column or an image with `once`. This is a column modifier,
not an argument constraint. Custody stays affine: one owning cell, whose
row read rule authorizes delivery to each principal.

Delivery reserves each `(assetId, principal)` while streaming off the owner;
the owner durably records `(assetId, principal, at)`
in the ledger after authorization, when the full-body 200 is committed
(the bytes written). The completion byte is held until the ledger commit,
so a completed response proves durable consumption. Admission alone never
consumes. A failure before the body starts does not burn the use; an abort
may. Concurrent requests by one principal have one winner. An authenticated
principal is required even for a public row. Anonymous: 404 `E_ASSET_NOT_READY` (existence is not probeable). `HEAD` does not consume.
Widths (`?w=`), conditionals (`If-None-Match`), and `Range` cannot yield a
second delivery: once images ignore these selectors and deliver their full
original body as 200 with `Cache-Control: private, no-store`. A consumed
request refuses HTTP 410, `E_ASSET_VIEWED`, family `assets`, at the delivery
site with a rewrite to render the image once and request a new image.

The manifest and program schema carry the column modifier. The client
`viewOnce` option is deleted; the chat template uses one message row with
its own once image and per-member visibility through its read rule. The
row byte cache refuses once rows. The twin never predicts a once fetch;
offline, their media reads `null`. Adding `once` to an existing image column
is an admitted successor; prior views are unrecorded. Removing `once` is
destructive and refuses (`E_SUCCESSOR_DESTRUCTIVE`): a delivered-once image
cannot become re-deliverable by a schema change.

### 2b. The session carrier (author ruling, 2026-09-03)

Revision (c) said "there are no signed query tokens": a private image is
fetched with the session's credential in a header and painted from a blob
URL. That holds for an image and fails for a `<video>` element, a native
player, or a download, none of which can send a header; a blob URL for a
50 MB clip means downloading all of it before the first frame. The client
keeps its session as a bearer token in a token store, not a cookie, and a
cookie would not survive the ordinary development topology — the app on one
origin, `SNAPBACK_URL` on another (§12). The loop's *ordinary* identity is not
a bearer at all: it is a persona (`--as`, `snapback2 test`), carried in an
`X-Snapback-As` header, which is exactly as unsendable from a `<video>` tag.

So the asset route accepts one additional credential, **a session carrier in
the query string**, minted for whichever identity the client holds:

```
POST /api/auth/asset-session            → { "token": "…", "expiresAt": … }
GET  /api/asset/<assetId>?s=<token>
```

The carrier is minted from the request's `Identity` — a bearer session or a
development persona — and bound to it exactly: to the session's epoch for a
bearer, so logout kills it; to the owner incarnation plus persona for a
persona, so it dies when the persona header would have. It authenticates
**the same viewer, for the asset route only**; the row's read rule is still
evaluated on every request, exactly as with the header. It is a *credential*,
not a *grant*: it names no asset, carries no authority of its own, and does
not reopen §13's share-link deferral. It is transferable for its lifetime,
which is the honest cost of any bearer credential in a URL, and it is why the
scope below is narrow. A carrier combined with a bearer or persona header on
the same request is refused. A missing, expired, or invalid carrier is the
same as no credential, so a copied URL on a `public` row still serves after
the token dies — pasteability is unchanged.

**Scope: only where a header is impossible.** `<AssetVideo>`, native players,
and downloads use the carrier. `<AssetImage>` does not: it fetches with the
header (the bearer or the persona) and relies on `private, no-cache` plus the
`ETag` (§2) for repeats, so no image URL ever carries a token, and a signed-in
user's public avatars keep one cache key. The second panel found that
revision (f)'s "attach the carrier whenever the client is authenticated" made
every public image per-viewer and minutes-lived, which defeated the
`public, immutable` path §9a sells; that sentence is withdrawn. A carrier URL
that lands on a `public` row is answered with a redirect to the canonical,
tokenless URL, so shared caches key on one address.

**Lifetime and rotation.** The carrier lives long enough to cover a paused clip
— tens of minutes at least, and never past the session — and the SDK
refreshes it before expiry for *new* URLs only. It never rewrites a mounted
player's `src`, because that restarts playback; a mounted element keeps the
token it was given until unmount.

Three rules for the server: the carrier is never written to the request log
(`serve.rs` copies the full URL, query included, into its handler — scrub
there, and test it); a response to a request that carried one is
`Cache-Control: no-store` and never `public`; every asset response carries
`Referrer-Policy: no-referrer`. The token's mechanism (opaque and stored, or
keyed and stateless) is the implementer's; the contract is the properties
above.

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
    /* … */
  },
  // …
})
```

`avatar` and `photos` both keep their full resolution (§4). `clip` is the same
shape with a different word. All are one type and a bound, read the same way
as `text <=40`.

That is the entire authoring surface. `image` and `video` read exactly like
`text`, because they are exactly as complicated: a type with a bound. Widen
`profiles` read to `public` and the same bytes become pasteable — privacy is
the table's read rule, and that is the whole privacy API. A DM image is
`photo: image <=10000000 ?` under
`read r <- r.sender = viewer or r.recipient = viewer`. A DM attachment is
`doc: file <=25000000 ?` under the same rule when `file` lands (§13a).

**Policy beyond bytes is rule code, not grammar.** The record carries
`duration` as a validated fact, so a rule the schema cannot spell is one line
in the mutation: `require clip.duration <= 60000 else TOO_LONG`. It is a fact
and not a claim because every asset-typed argument is checked against the
ledger at mutation entry, before the body runs (§6) — the second panel found
that revisions (f)–(i) checked only at column write, which let a mutation act
on a forged duration without ever storing the clip. Snapback 1 could not
express Coterie's sixty-second rule at all
(`issues/20260817-upload-intent-codec-duration-admission-facts.md`) and
LLP 0305 proposed a declared-admission grammar for it; both are retired for
Snapback 2 by putting the fact in the value. Lane C must let a `require` read a
field off an asset-typed argument — the parser already has member access, and
`image` and `video` lower as closed object types so field selection is
ordinary.

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
- **Strip keeps exactly one thing: orientation** (author decision, 2026-09-03,
  on the second panel's finding). Nearly every phone JPEG stores its pixels
  sideways and carries an EXIF orientation tag that says how to turn them.
  Revision (g)'s strip dropped every tag, which would have rendered every M1
  avatar rotated and recorded sensor pixels as `width` and `height`. So strip
  is a walk over segments or chunks that removes every metadata container —
  EXIF, XMP, IPTC, PNG text chunks, WebP's `EXIF` and `XMP ` chunks — and
  then **synthesizes a fresh, minimal orientation-only tag** from the value it
  read; nothing from the original container survives. The record's `width`
  and `height` are computed *after* orientation; derived widths (§8) bake the
  transform when they decode. A JPEG also retains only the fixed 12-byte
  `Adobe` APP14 segment whose transform selector is required to render
  CMYK/YCCK pixels correctly. The pixel data and color profile are untouched,
  so the stored original is the uploader's image, oriented, and admission
  stays a walk rather than a decode — the upload clock the paved call blocks
  on never waits for a 12 MP re-encode. **Gated by an acceptance matrix:**
  orientations 2 through 8 must render correctly on web, iOS, and Android in
  §15's acceptance. If any platform fails it, the fallback is the path
  Snapback 1 took — decode, orient, re-encode in the helper for every image —
  and the record's dimensions do not change meaning. The panel split on this
  and the author decided for speed on the paved path; the trigger is written
  down.
- **The type is the accept list.** `image` admits JPEG, PNG, WebP, and HEIC
  (author ruling, 2026-09-03: WebP and HEIC are both handled, not one or the
  other — the brief names WebP, and phones hand back HEIC; ruling 7 was held
  over the second panel's 2–1 recommendation to defer HEIC, and the trigger
  that would have reopened it — the first real-phone acceptance that produces
  HEIC — is the reason it stays). `video` admits MP4 and QuickTime MOV — what
  phones hand back — and inspects the container only: no decode, no
  transcode, no codec refusal (§13). The *detected* type governs, never the
  declared one and never the filename; anything else is `E_ASSET_TYPE`. The
  kind is whichever accept list the bytes match, so the upload names nothing
  (§5). SVG, HTML, XML, and JavaScript are not images and are refused. What
  the container walker cannot prove location-free it refuses (`E_ASSET_TYPE`,
  as v1 did).
- **HEIC normalizes to JPEG at admission.** iOS libraries are HEIC-first and
  pickers hand back HEIC even in compatible mode (LLP 1005 §6); Snapback 1 still
  cannot decode it (`issues/20260819-heic-image-normalization.md`, open).
  Accepting HEIC and storing an unservable original would reproduce the bug.
  This is a **server-side** decode, ruled so on 2026-09-03: the Expo SDK may
  transcode on the device as a courtesy, but a browser hands over HEIC too —
  dragged from Photos, or picked in Safari — and only the server covers every
  path. The decoder ships in the one published helper (§14a). WebP is stored
  as WebP — its bitstream kept, its metadata chunks dropped — and decoded, in
  pure Rust, only for derived widths. `tmap` primaries refuse until libheif
  supports them upstream.
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
- **There is one fixed internal decode-safety ceiling, and it is not `max`.**
  The helper's memory cap is already a ceiling; without a stated one it fails
  by out-of-memory at a size nobody chose. So the helper probes v1's bounds
  before allocating — pixels, longest edge, decompression ratio, output bytes
  — and refuses over them as `E_ASSET_TOO_LARGE`. No admitted image is ever
  downscaled; an author sees nothing of this. It narrows ruling 6 by exactly
  the width of a decompression bomb.
- **The bound is bytes**, enforced at admission and re-checked at write; over is
  `E_ASSET_TOO_LARGE`. All refusals ride the existing `input` family.

**Upload authority is "an authenticated principal," with no knob.** An asset
nobody references is undeliverable and reclaimed, so an upload on its own grants
nothing; the authorization that matters is the `insert`/`update` rule on the
mutation that references it. The residual exposure is disk, bounded by a
per-principal staging cap *and* a global one (§14) — numbers, not rules. The
global cap exists because `/api/auth/guest` mints principals for free, so a
per-principal cap alone bounds nothing on a public development URL.

## 5. Upload: one POST

```
POST /api/upload
Authorization: Bearer …            (or X-Snapback-As: <persona> in development)
Content-Length: …
<body = bytes>
→ 200 ImageAsset | VideoAsset          (by the accept list the bytes match — §4)
  | 422 { "code": "E_ASSET_TYPE" | "E_ASSET_TOO_LARGE", "family": "input", … }
```

**The upload names nothing.** Detection decides the kind: JPEG, PNG, WebP, or
HEIC is an image; MP4 or MOV is a video; anything else is `E_ASSET_TYPE`.
Revisions (f)–(i) carried an `as=` parameter because a JPEG could legitimately
be a `file`; with `file` deferred (§13a) the parameter goes with it and comes
back with it. `Content-Length` is required; a body over the generation's
largest bound for that kind is refused before it is read. The route branches
**before** the server's JSON body reader — which today takes 1 MiB of UTF-8 —
and runs in its own bounded worker class, so four parallel photo uploads
waiting through finalize never sit in the pool that serves queries (§14).

The response arrives **after finalize**, so there is no author-visible
`receiving` state and no readiness race. `E_ASSET_NOT_READY` survives only as a
forged-id refusal, never a happy-path state. Image finalize answers within the
request: strip is a walk (§4), HEIC decode is the only pixel work on the
upload clock, and rungs are lazy (§8). Video finalize is a linear pass over
box headers with no decode (§9) and is expected to answer within the request
too; if the phone
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
   Snapback 2 has no supervised bundler and no relay to hide behind. The
   upload adds no header to the allow-list: bytes in the body, the credential
   in the header the client already sends.

## 6. The write: validated, not stamped

Snapback 1 required `ctx.assets.attach(...)` inside the mutation, and a write
storing an asset id without it was refused `SNAPBACK_ASSET_REF_UNVERIFIED`. The
refusal is correct — a forged string must not become an authorized reference —
and LLP 1005 §5b records that essentially every author discovered it by hitting
it rather than by reading.

Here there is no call. Validation happens at two points, and the second panel
moved the important one earlier:

- **The twin** (pure, and the server repeats it): closed-shape check for the
  argument's or column's kind — an `id` of valid syntax; positive bounded
  integer `width` and `height`, plus `duration` for a video; no missing or
  extra fields; unique ids within a list — accepting the record as the wire
  delivers it (§1). It stores the value unchanged.
- **The server, at mutation entry**, after the authoritative transaction opens
  and before the body runs: every asset-typed argument, recursively through
  optionals and lists, is checked against the ledger — the row exists, is
  `ready`, and is of the argument's kind; `created_by` is the caller; **every
  field of the record equals the ledger**; bytes are within the argument's
  bound. This is what makes `require clip.duration` a fact (§3). Revisions
  (f)–(i) ran this check only when a column was written, so a mutation could
  read a forged fact, act on it, and never store the asset.
- **The server, at the write**: the column's byte bound, and the claim through
  the lifecycle reconciler of §2a — unclaimed or already claimed by this cell,
  else `E_ASSET_IN_USE`; released when it leaves the cell.

`created_by` is the writer, full stop. Revisions (c)–(i) allowed `system` so
an effect's `then` mutation could place an asset the service principal
produced; nothing mints such a row, and a grant whose issuer does not exist is
a hole, not a placeholder. It returns with the effect-side `put` that §13
records.

Then it stores the argument unchanged. A forged id, an altered dimension, or
someone else's upload is refused in the `input` family; the optimistic frame
rolls back exactly as it does for a unique-index collision.

There is nothing to remember to call, so there is nothing to forget, and the
forged-string property is preserved.

## 7. Reading

```json
{ "id": "as_…", "width": 1290, "height": 1720 }
{ "id": "as_…", "width": 1920, "height": 1080, "duration": 12400 }
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
  which, and delivery supplies the real type in `Content-Type`. `duration` is
  on a video because a badge, a scrubber, and a `require` (§3) all need it
  before playback. (`file`'s record carries `size`, `type`, and `name` for the
  opposite reason — §13a.)

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

**Widths are an image concern.** `?w=` on a video is ignored — the stored
bytes are served — and video has no poster frame or thumbnail (§13). A
derived width is encoded as JPEG, or PNG when the source has alpha, with the
orientation baked in (§4); the stored original keeps its own format.
The macOS RSS watchdog samples only the direct helper; this is accepted because
the helper is our own static binary and does not fork.

**Any width is a valid request.** The server snaps it up to the next internal
rung and serves that, so the delivered image is as large as asked and looks
right. The effective width is `min(requested, source width)`: nothing is ever
upscaled, and a request wider than the source gets the original — "always at
least as large as asked" was impossible above the source and is withdrawn.
The rungs are an implementation detail: there is no closed list to memorize,
and **no width refusal exists** — revision (c)'s `E_ASSET_WIDTH` is deleted
along with the ladder that needed it.

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

**Eager or lazy is invisible, and slice 1 is lazy.** Because widths snap, an
attacker can force at most one render per rung per asset, which makes lazy
rendering safe rather than a liability. Slice 1 renders a rung on its first
request and keeps it; revisions (c)–(i) rendered the common rungs at
admission, which put resize work on the upload clock that `run({ photos })`
blocks on, for renders nobody may ask for. If the first-request latency later
measures badly, rendering at admission is **a server change with no API
change**: same URLs, same client code. Naming sizes (`/thumb`) instead of
measuring them would have foreclosed that, which is why revision (c)'s
spelling is gone.

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

**Two finalizers, one lifecycle.** Image finalize is strip with the
synthesized orientation tag, in-process (§4), then HEIC decode in the helper
subprocess when the bytes are HEIC (§14a); rungs are lazy (§8). **Video
finalize is the v1 container walker, ported, not rebuilt** (author ruling,
2026-09-03): `crates/snapback-services/src/assets_video.rs` is 894 lines with
its tests. It blanks every location-bearing box by renaming it to `free` and
zeroing its payload, so no `stco`/`co64` chunk offset moves; bounds metadata
payload and box depth against bombs; handles the QuickTime
`meta`-is-not-a-fullbox case LLP 1005 §6 records; and reads `width`, `height`,
and `duration` from `tkhd` and `mvhd` on the way past. It is pure Rust and
needs no cargo feature. What it cannot prove location-free it refuses. Three
things the port changes, all found by the second panel: the v1 function takes
a slice and returns a `Vec` — LLP 1005 §9's `read → Vec → put`, verbatim — so
the port **blanks in place on the staging file** instead; the v1 facts are
`Option` while `VideoAsset` is closed, so finalize **refuses when duration or
display size is missing** (`E_ASSET_TYPE`, like an unclassifiable box); and
the v1 `tkhd` handling ignores the transform matrix, so the port **applies
it**, or every portrait phone clip would report landscape dimensions and size
its tile wrong. Both finalizers stream to staging and run off the writer;
neither decodes video, and neither makes a poster frame.

**`_assets` owns its own lifecycle.** Revision (b) proposed hanging finalize on
LLP 1003's `_outbox`; both panelists rejected it, and they are right — the
ledger already has the states, and borrowing the effect runner drags in
`sent_unknown`, manual requeue, and effect tracing that image finalize does not
want. The outbox stays for effects. A transcode, if one is ever added, is the
reason to revisit it; the walker is not one.

**Reclamation is `locator IS NULL` over `_assets`** (§2a) — it never scans
application tables. An asset whose row was deleted, whose column was patched,
or that was never referenced has a null locator and is collected after a grace
period, along with its derived widths. The reconciler sets nullable
`released_at` when it clears a locator and clears it on a later claim; grace is
measured from `max(created_at, released_at)`, with `created_at` alone governing
uploads that were never referenced. An asset held for a year therefore still
gets the full grace after replacement. **Liveness buys space and never
authority** — an unreferenced asset is already
undeliverable (§2), so a reclamation pass that lags or crashes is a disk cost,
not a disclosure. `GET /api/uploads` lists only the authenticated creator's unclaimed
receiving/ready uploads (100 per page with `after`/`next`), usage and limits;
`POST /api/uploads/discard { id }` atomically tombstones only that creator's unclaimed
id, refuses claimed ids, and treats missing/foreign ids identically. It frees quota
immediately and reuses the fork-aware sweep for bytes; restart preserves discovery.

### 9a. Where bytes live (author ruling, 2026-09-03)

**Locally, beside the store; hosted, in an S3-compatible bucket; delivered
through the server in both cases.** One trait, streaming-first, three
publication operations — put a stream and get back a key, get a key with an
optional byte range as a stream, delete a key — plus the sweep's deliberate
fourth operation, bounded callback `enumerate(prefix, visitor)`. Enumeration
never returns an unbounded key vector: the sweep builds the live/fork referrer
set once and visits the directory once for reclaims, orphans, and stale publish
temporaries. This is revision (m), 2026-09-04, and is the enumeration primitive
already implied by "a key in the directory and in no ledger is garbage by
definition." No whole-object buffer appears anywhere in the trait, so v1's
`read → Vec → put` debt (LLP 1005 §9) cannot be written against it.

- **Keys are asset ids** (author decision, 2026-09-03, on the second panel's
  split). The ledger row is written first, in `receiving`; finalize then
  durably records its byte size on that receiving row (including any
  normalization growth), the blob is put under the asset's id, and only then
  does the row flip to `ready` — so every key and its full quota charge are
  known to the ledger before the blob exists, and a crash can never orphan a
  key or undercount surviving bytes. A derived width is keyed by id and rung. Blobs
  are immutable. Revision (g) chose content addresses for deduplication and
  cheap forks; the panel showed that immutable ids give the same fork sharing,
  that a content address cannot be known until the stored bytes are hashed
  (so orphans need a directory listing the trait does not offer), and that
  the derived reference count was machinery. What is lost is silent sharing
  between two identical uploads, which affine already charged twice. **One
  invariant travels with this choice:** ids are `s2id-<namespace>-<sequence>`
  with a per-store namespace held in the database, so any operation that
  opens a fork as a *writable* store rotates the namespace first — otherwise
  a restored fork re-mints ids that already name blobs. No such operation
  exists today; the rule is recorded so the first one honors it. (Content
  addressing with the digest written to the `receiving` row before publish is
  the recorded alternative if a shared-namespace restore is ever wanted.)
- **Local** — development, and any single machine: `.snapback/blobs/` and
  `.snapback/staging/` beside `.snapback/store.sqlite`, inside the owner-only
  directory the owner already enforces. Staging is always local disk: the
  request streams into it and finalize reads from it. The staging caps (§14)
  are enforced there. The single blob enumeration skips active/fresh publish
  temporaries and deletes untracked publish temporaries older than five minutes;
  startup may delete all of them because no put is then in flight.
- **Hosted**: an S3-compatible bucket — S3, R2, Tigris — with the same keys,
  landing with the hosted target (LLP 1002), which does not exist yet. Slice 1
  ships the filesystem implementation only; the trait is what makes the
  second an addition rather than a change.
- **Delivery is always `GET /api/asset/<id>`** (§2), and the bytes always pass
  through Snapback. Locally the server streams the file; hosted, it streams
  from the bucket. Revision (g) allowed a seconds-lived presigned redirect
  after authorization; the second panel deleted it, because a bucket answers
  every later `Range` request without the row rule, which makes "every
  request evaluates the rule" false for the token's lifetime. A CDN is a
  deployment choice in front of the public path — `public, immutable`
  responses are already shaped for one — and never a place authority lives.
- **Reclamation** keeps its trigger — `locator IS NULL` over `_assets` (§9) —
  and deletes a blob when the ledger row that names it is deleted, provided
  no fork ledger names it too (below).
- **`reset`** clears the live `_assets` and empties `.snapback/staging/` in
  the same operation that clears the rows, then runs the ordinary sweep. It
  does **not** empty `.snapback/blobs/`: revision (g) said it did, and the
  second panel found that this deleted every blob a fork still referenced.
  v1's orphan-after-reset bug is still a leak the sweep can see — a key in the
  directory and in no ledger is garbage by definition — without breaking a
  fork.
- **`fork`** is a snapshot of the store into `.snapback/forks/<name>.sqlite`,
  not a copy of the blobs. Blobs are immutable, so a fork shares them; the
  sweep treats every ledger under `.snapback/` — live or fork — as a referrer,
  so restoring a fork never restores a row whose bytes are gone.

### 9b. Bytes on the device (author ruling, 2026-09-04)

**Cached under the owning row's lease, or not at all.** LLP 1012 (local-first
v1) gives the client a durable per-principal range store; the asset client
gets a `ByteCache` in the same partition. It stores the bytes a component
actually fetched — the widths `<AssetImage>` and `<AssetVideo>` asked for
under §8, never the stripped original — keyed `(assetId, width)`, and only
for assets whose reference arrived in a receipt the store holds. A row's
bytes leave the cache in the same generation swap that removes the row
(eviction, a receipt absence, a `denied` range under `until-revoked`,
sign-out; LLP 1012 §5), so the purge receipt covers bytes for free, and the
fence does not touch them, exactly as it does not touch rows. One ceiling,
`maxAssetBytes` (client option, default 256 MB), evicts least-recently-read
by the owning row's recency; it is the only budget in v1, because bytes are
large and rows are not. Rows whose delivery must be evaluated on every
request — one-use image delivery (§2a.1), anything under a fenced audit —
refuse the cache at the row, and `<AssetImage>` on such a row renders from
the network or not at all. This narrows LLP 0329.014.008 §4's
`retain({ assets: { renditions } })` in one way: there is no declared
rendition list, because ruling 2 says any width may be requested; the cache
keeps what was fetched. What it keeps from that candidate is the whole point:
Snapback 1's guide had to tell agents that its image cache was neither
privacy- nor revocation-aware and not to call it retention; this one is
both, by construction, and is retention. Lane O4 of LLP 1012 builds it with
the Expo carrier; §10's components need no change beyond reading the cache
before the network.

## 10. Clients

React web first, Expo second (LLP 1000 decision 5); Exact 2 follows.

The paved call assigns a `File` directly, and the SDK uploads it and
substitutes the record before the mutation is sent:

```tsx
setAvatar.run({ avatar: file })
publish.run({ space, body, photos: files })   // 1–4 Files
sendClip.run({ recipient, clip: file })
```

Generated client argument types accept `File | ImageAsset` (or `VideoAsset`,
by column); handlers, the engine, and the twin only ever see the record (§6),
so this is a client convenience and not an engine concept. **The SDK learns
which arguments are asset-typed from the manifest, not from `.d.ts`:** the
second panel found that runtime operation objects carry only their name —
type parameters are erased — while `/api/manifest` already carries the
descriptors. Substitution is therefore manifest-driven and
descriptor-fenced, recursive through optionals and lists, and it preflights
every source's length against the bound before any upload starts. A source is
a browser `File` or an Expo native URI — the brief's picker hands over a URI,
not a `File` — streamed, never buffered. The descriptor fence guarantees that
substitution uses the descriptors of the generation the SDK read; it does not
atomically bind the later mutation send to that generation. The owner validates
every asset-typed argument against the live generation on request entry (§6);
an atomic expected-generation request field is deferred in
`issues/20260904-snapback2-mutation-expected-generation.md`. The two-phase form remains available
for progress UIs:

```ts
const avatar = await client.upload(file, { kind: "image", onProgress })
await setAvatar.run({ avatar })
```

`kind` names the nominal record the caller expects back (`ImageAsset` here); the
server still decides by sniffing the bytes, and the client refuses `E_ASSET_TYPE`
when the two disagree, so the two-phase form types as tightly as the one-call
form. Without `kind`, `upload()` returns the `ImageAsset | VideoAsset` union.

**This was a live panel disagreement and is settled by the v1 evidence rather
than by preference.** Codex argued for the explicit two-phase call as the only
paved form, on the grounds that `File` is not a Quarry value and that hiding
the upload implies a false atomicity. Grok's counter is the one that decides
it: *"requiring `upload()` then `mutate()` is `attach()` renamed"* — and
LLP 1005 §5b is a whole section on what a mandatory second call cost Snapback 1.
An agent that must call two functions will eventually call one. Codex's
atomicity objection is answered by the failure shape: before mutation submission,
sibling uploads are discarded on failure; a definitive rejection also discards only
this call's uploads. Queued intents and ambiguous responses retain bytes; a transport
failure after submission may have committed. Cleanup failures preserve the original
outcome. `client.listUploads()` and `client.discardUpload(id)` recover abandoned ids.

Rendering is one component per kind (§2a). `<AssetImage asset={photo} />`
measures its own box and requests a matching width (§8) — the author names no
size — and fetches with the session's header (bearer or persona), painting
from a blob URL on the web and passing headers to the native image on Expo;
`private, no-cache` plus the `ETag` (§2) keeps repeats cheap. `<AssetVideo
asset={clip} />` is the platform's native player with `controls`, sized from
the record's `width` and `height` so a tile never collapses (Diary 0087),
streaming by `Range`, and it is the component that carries the session
carrier of §2b — so a private clip plays in a plain `<video>` element and in
Expo's native player alike. Both take their URLs from `useAssetUrl`, which
resolves a scalar or a list and is exported for anything custom; the carrier
is attached only when the caller asks for a URL an element will load
directly. Expo's arm lands with the Expo package (LLP 1000 decision 5).

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
| `private-signed` delivery profile, per-asset signed URLs, signing-key rotation | the session carrier (§2b), for video and downloads only | a credential for the same viewer, not a grant on an asset |
| Pre-declared renditions | any width, snapped (§8) | nothing to name wrongly, no ladder to learn |
| TUS in the first slice | one POST (§5), with the return trigger written down | the measurement was 120 MB on a killed process |
| `accept.video` sibling block + LLP 0305 declared codec/duration admission | `video <=N`; `duration` in the record; policy is a `require` (§3) | the fact is in the value, so the rule language already covers it |
| Video transcoding, poster frames, thumbnails | — | the brief says played as uploaded (§13) |
| `forces_attachment_disposition` | kept, for `file` when it lands (§13a) | a steal, not a deletion — the same-origin script lane stays closed |
| Decode → orient → re-encode at admission (v1's image strip) | a synthesized orientation tag over a chunk walk (§4), with re-encode as the gated fallback | admission stays a walk; the upload clock never waits for a 12 MP re-encode |
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
(Revision (d)'s optional `max` covered the apps that wanted less; it was
withdrawn in (g).)

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
the *kind* at upload was revision (f)'s `as=` parameter, which existed only
because a JPEG can legitimately be a `file`; it left with `file` (§13a) and
returns with it.

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
none of that — when `file` lands (§13a).

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
trusted; delivery is authorized by the server on every request, and revision
(j) deleted even the seconds-lived presigned redirect revision (g) allowed,
because a bucket answers later `Range` requests without the rule (§9a).

**Content-addressed blob keys** (revision (g)). Replaced in (j) by asset-id
keys with namespace rotation on any writable fork (§9a): the ledger row can
name the key before the blob exists, which makes crash safety a consequence
of write order, and the dedupe it bought was for a case no app has. Recorded
as the alternative if a shared-namespace restore is ever wanted.

**`private, immutable` for private bytes.** Considered in the second panel as
the fix for `no-store` re-downloading a feed on every scroll. Rejected: a
revoked viewer's own browser would keep serving the image from its cache,
which makes "revocation is exact" false on that device. `private, no-cache`
with an `ETag` and authorization before `304` keeps the promise for one
bodiless round trip (§2).

**Eager rung rendering at admission** (revisions (c)–(i)). Moved to the
recorded server-only switch (§8): it put resize work on the upload clock the
paved call blocks on, for renders nobody may request.

**A security-boundary claim for the helper** (revision (h)). Withdrawn (§14a):
a same-UID child can open the store by its well-known path, so "no store
handle" is a convention, not confinement, until an OS sandbox enforces it.

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
  `then` mutation to place; revisions (c)–(i) kept a `created_by = system`
  escape in §6 for that case, nothing filled it, and (j) deleted it until this
  lands. Neither named app needs it, so it waits for one
  that does. **Verified additive:** the shape is one call on the effect context
  — put a byte stream with a kind, get back the same closed record an upload
  returns — through the same finalize (§9) and the same helper (§14a), with
  `created_by = system`. It touches no column type, no value, no schema, no
  twin, no route, and no rule. It is not a media command: the effect's `then`
  is Quarry's existing "do this after that" (LLP 1003), and the record it
  places is validated exactly as a client's would be (§6).
- **Non-media files, in slice 1.** Designed and deferred — §13a.
- **An OS sandbox for the helper.** The helper is crash, hang, and memory
  isolation (§14a); making it a security boundary means seatbelt on macOS and
  seccomp plus namespaces on Linux, which is the follow-up, not a slice-1
  claim.
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

### 13a. `file`: designed, deferred (author decision, 2026-09-03)

Revision (f) put non-media files in slice 1 at the author's ruling. The
second panel, unanimously after cross-read, recommended deferring them: no
app on the capability bar has an attachment, and `file` was the sole reason
for an `as=` parameter on upload, a filename, a third record, attachment
delivery, strip-by-type inside a column, and a partial privacy contract. The
author deferred it. The design is recorded here in full so the addition is
mechanical, and **verified additive**: one kind word, one record, one
query-parameter pair on the upload, one delivery header, one component — and
nothing in slice 1 changes meaning when it lands.

- **The word and the record.** `doc: file <=25000000 ?`, and
  `type FileAsset = Readonly<{ id: string; size: number; type: string; name: string }>`:
  `size` is stored bytes, `type` the detected media type essence
  (`application/octet-stream` when detection cannot name it), `name` the
  uploader's filename. The record carries `type` for the opposite reason
  `kind` was cut from an image: the column says nothing, and a message list
  needs an icon and a label before anyone fetches the bytes.
- **The upload names its kind.** `POST /api/upload?as=image|video|file[&name=]`.
  `as` exists because a JPEG is a legitimate attachment and detection alone
  cannot tell which record the caller wants back; the SDK passes it from the
  manifest, and it is one of three schema words, not a destination column.
  `name` is the one client-supplied fact in any record: sanitized to a single
  path segment, control characters removed, bounded at 255 bytes, defaulted to
  `file` when empty, stored on the ledger and validated like a dimension. Both
  ride the query string so the upload adds no CORS header.
- **Delivery is always an attachment.** `Content-Disposition: attachment;
  filename="<name>"` on every `file`, with `nosniff`: user bytes served from
  the app's own origin must never be invited to render inline, which is the
  same-origin script lane Snapback 1's `forces_attachment_disposition` closed.
  `<AssetFile asset={doc} />` is a download link showing `name` and a
  formatted `size`, and it carries the session carrier (§2b), because a
  download cannot send a header.
- **Strip or refuse, by detected type, in every column.** A format Snapback
  claims to strip — JPEG, PNG, WebP, MP4, MOV — is stripped or refused
  wherever it lands, including inside a `file` column, so an attachments
  field is never the escape hatch §4 promises does not exist. HEIC in a
  `file` column is refused with a hint naming `image`, where it is decoded,
  until an in-process HEIF `Exif`-item blank exists (a chunk walk, not a
  decode). Everything else is stored byte for byte and **carries no privacy
  claim**: a PDF keeps its author field, a DOCX its revision history. The
  guarantee Snapback 1 measured is scoped to the formats Snapback can walk,
  and the document says so rather than implying more.
- **Not in it, ever, without a new trade:** per-column accept lists
  (PDF-only, no executables) — the first such list is the add that puts a
  destination column back on the upload (§12); inline preview — an in-app
  viewer fetches the bytes itself; metadata stripping for formats the walker
  does not know.
- **Trigger:** the first app that needs an attachment column. The cost of the
  deferral is that it waits one slice; the cost of keeping it would have been
  roughly a fifth of lanes B, C, and D before the capability bar.

## 14. What it costs

- **No new blocking check.** `rules/RULES.md` allows five; assets add none.
- **No certificate version bump and no new `Value` variant** (§1).
- **`check` stays under 1 s.** Two schema node kinds in slice 1, and the
  inventory is honest: `ColumnType` and argument types, static typing, the
  retention bound, JSON conversion, the index refusal, the compiler's
  lowering, and the twin all gain an arm — "three validation arms" understated
  lanes A and C, and §15 now says so.
- **One new engine primitive** — the certified delivery point-read (§2) — and
  one lifecycle reconciler (§2a). Both are named machinery, not "none".
- **Two executables.** The engine and the media helper ship together; the
  helper is where image size lives (§14a). Video needs no helper: the walker
  decodes nothing.
- **A spawn per HEIC upload and per first rung** — milliseconds, against a
  decode of hundreds (§14a).
- **One bodiless round trip per private image render** (§2): the price of
  keeping revocation exact on the viewer's own device.
- **Fifty-megabyte bodies through the HTTP layer.** `snapback2` reads request
  bodies into a 1 MiB JSON buffer today; uploads branch before it into their
  own worker class with a streaming body path to staging (§5), so lane B is
  larger than "two routes" suggests.
- **About 900 lines of walker**, ported with its tests and three corrections
  (§9), and a real iPhone MOV — portrait — in the corpus.
- **One credential in a URL.** The session carrier (§2b) is the only secret
  this design puts in a query string; it is scoped to video and downloads,
  bound to an identity epoch, and kept out of logs.
- **An orientation acceptance matrix** (§4) before the strip mechanism is
  trusted, and a re-encode fallback if it fails.
- **Full-resolution originals, always** (§4), under one fixed internal
  safety ceiling. An app that wants smaller originals downscales on the
  device.
- **The C decoders in the one published helper** (§14a), for HEIC.
- **Two blob-store implementations over time, one now** (§9a), and one
  namespace-rotation invariant the first writable fork must honor.
- **A dropped upload retries in full** (§5), now including a 50 MB clip; the
  return trigger for resume is recorded there.
- **An empty first paint** until bytes arrive (§7).
- **Staging disk**: a per-principal cap (e.g. 256 MB or 20 objects) and a
  global cap bound what can be staged before reclamation. Both panels asked
  for these numbers; they are internal, not authored.
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
file as its only input, a cleared environment, a wall-clock timeout, a memory
ceiling, bounded output, and process-group termination. A crash, a hang, or a
decompression bomb kills the child and refuses the upload in the `input`
family; the engine and the store are untouched by the *crash*. The parsers —
the image chunk strip with its synthesized orientation tag (§4), the video
container walker (§9), type detection — are bounded walks in safe Rust and
stay in-process. Spawn is milliseconds against a decode of hundreds, which is
why this was ruled rather than measured; the measurement OQ1 asked for
becomes a post-landing check on the helper's spawn cost, not a gate.

**What the helper is, honestly: resource isolation, not a security boundary.**
Revision (h) said "no store handle, no network" as if that were confinement.
The second panel pointed out that a same-UID child can open
`.snapback/store.sqlite` by its well-known path; the API convention keeps an
honest helper away from the store, and it keeps a compromised one away from
nothing. What the subprocess *does* buy is real and enough for slice 1: a
decoder crash, hang, or memory blow-up cannot take the engine with it, and the
C decoders never link into the engine binary. Turning it into a boundary means
an OS sandbox — seatbelt on macOS, seccomp plus namespaces on Linux — and that
is the named follow-up (§13), not a claim this revision makes. LLP 1002
decision 1 says "Nothing else is ever spawned"; it is amended in the same
landing to name this child.

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

**The codecs are chosen at build time; there is one published helper.**
Revision (h) published a default and a slim variant. The second panel,
unanimously, called the second artifact a packaging matrix and a support
question with no named user, and the author narrowed ruling 10: the published
package ships **one** helper carrying every codec §4 admits, and publish
refuses to ship it without them — a helper that cannot finalize what the
schema admits is the v1 HEIC bug in a new coat. The build flag stays for the
development loop. `publish.mjs` reports the helper's size beside the
engine's, and that number is the trigger for a slim package if it ever
measures badly.

**Publication source-builds one decoder-only static closure.** The publish
path builds pinned, checksummed libde265 and libheif sources under `target/`,
with libde265's encoder disabled and libheif's libde265 decoder enabled while
every encoder and other decoder is disabled. It derives the macOS deployment
target from a codec-free production build of the helper and uses that same
target for both C libraries and the final Rust link; Linux uses the same
source/static path. The shipped helper has no codec-library load commands.
Publish refuses non-system Mach-O/ELF dependencies, refuses any shipped Mach-O
whose minimum OS exceeds the helper's, and caches the source build by versions,
hashes, platform, architecture, flags, and deployment target. There is no
dylib-bundling fallback.

**A missing codec refuses loudly; nothing degrades.** An installation with no
helper at all whose schema declares an `image` column refuses at boot, exactly
as the engine-less build does for effects; `video` columns need no helper and
boot without one. A developer's build without the `heic` feature refuses a
HEIC upload with `E_ASSET_TYPE` and a hint naming the feature. There is no
serve-the-original-only mode and no silent fallback — LLP 1005 §6's lesson is
that a capability the binary cannot honor must fail where the author can see
it.

**The `image` and `video` column types are unconditional in every build.**
The Rust engine and the TypeScript twin must agree on every corpus case, so a
schema vocabulary that varies with a build flag breaks the agreement — the
same class of defect the panel caught in revision (c)'s stamp. A codec-less
installation still parses, certifies, and type-checks a schema containing
`image` columns; it just cannot finalize one.

## 15. Implementation shape

`rules/RULES.md`: a spec needs an implementer and a date. **Assigned by the
author on 2026-09-03, in session:** implementer codex gpt-5.6-sol under the
`sbs-orchestrate` roster (Claude orchestrates, reviews with codex and grok,
and lands); commissioned 2026-09-03, revision (j), starting immediately.

| lane | scope |
|---|---|
| A | `_assets` ledger + lifecycle; the `image`/`video` column and argument types through `ColumnType`, `ArgType`, static typing, retention, JSON conversion, and the index refusal; entry-time ledger validation of asset-typed arguments (§6); the old-row/new-row lifecycle reconciler on insert/replace/delete/successor with same-cell carry-forward, and the `maintain.by`/seed refusals (§2a); the certified delivery point-read primitive on the owner's action channel (§2); reclamation with fork-aware referrers; `reset` = clear ledger + staging + sweep (§9a) — `snapback2-core` |
| B | the blob-store trait with its filesystem implementation, asset-id keys, and the namespace-rotation invariant (§9a); the upload route branching before the JSON reader into its own worker class, streaming staging, per-principal and global caps (§5, §14); delivery with `200`/`206`/`416`, `nosniff`, `public, immutable` / `private, no-cache` + `ETag` (§2); the image chunk strip with the synthesized orientation tag (§4); lazy width snapping with `min(requested, source)` (§8); the session-carrier mint for persona or bearer, epoch-bound, the public-row redirect, log scrubbing (§2b); the helper spawn protocol and the no-helper boot refusal (§14a) — `snapback2` |
| B2 | the container walker port from `crates/snapback-services/src/assets_video.rs` with its tests, blanking in place on the staging file, applying the `tkhd` matrix, refusing missing facts, and a real portrait iPhone MOV fixture (§9) — `snapback2` |
| B3 | the `snapback2-media` helper crate: decode, resize, encode, HEIC normalization behind the `images`/`heic` features, the fixed decode-safety ceiling (§4), one published artifact and the publish-time refusal (§14a) |
| C | `image`/`video` in Quarry (replacing both the `asset` refusal at `parser.ts:340` and the `use assets` refusal at `parser.ts:87`), lowered as closed object types; the builders in the lowering target; member access on asset-typed arguments in `require` (§3); `api.d.ts` types incl. `File \| ImageAsset` client args by kind; manifest descriptors for asset-typed arguments (§10) |
| D | manifest-driven, descriptor-fenced `run()` substitution with preflight, for browser `File` and Expo native URI sources (§10); `client.upload`; `useAssetUrl` for scalars and lists; `AssetImage` on the header path, `AssetVideo` on the carrier, carrier refresh without `src` rotation; `MutationRejected` semantics; React; one template with a photo and a clip |
| E | the amendments this revision requires in the same landing: LLP 1002 decision 1 (the helper child) and `rules/NOT-DOING.md` (HEIC and MOV named, `file` deferred) — landed with (j) |

Fix loops get three rounds. The acceptance that matters is not a unit suite:
per LLP 1005 §6, this slice is not done until a real multi-megabyte photo in
every EXIF orientation from 2 to 8 renders upright on web, iOS, and Android
(§4's matrix); a real *portrait* iPhone MOV of at least 50 MB reports its
display dimensions, seeks in a real browser, and plays on a phone; a private
clip plays in a persona journey under `snapback2 test` and in a bearer
session, is paused past the carrier's lifetime, and resumes and seeks without
a reload; a real browser bundle with no relay in front of it works; and a real
phone has been through all of it — the original three found every serious
asset bug in Snapback 1, and none was reachable from a harness.

## 16. The panel record

Revision (c) was panel-reviewed under LLP 0005 (codex gpt-5.6-sol at `ultra`,
grok-4.6 at `xhigh`, two rounds) and revisions (f)–(i) by a second panel on
2026-09-03 whose fourteen findings and six author-decided splits revision (j)
folds; the author kept HEIC against a 2–1 recommendation. The verbatim record
is LLP 1006.001 §16; transcripts are `llp/reviews/1006-assets.panel.*.md`.

## Confidence

The confidence judgments recorded with each revision are in LLP 1006.001.

## Rulings settled (author)

The author settled 1–4 on 2026-09-01, 5–11 on 2026-09-03, and 12 on
2026-09-04. The governing details and qualifications remain in these sections:

1. Affine custody, one home (§2a).
2. Arbitrary requested widths, snapped internally (§8).
3. Keep the stripped full-resolution original (§4); ruling 6 removed `max`.
4. Defer share links, with additive design recorded (§13).
5. Ship video in slice 1, port the walker, include ranges/carriers, defer
   resume; design and defer non-media `file` (§1, §2b, §5, §9, §13a).
6. No resolution ceiling; the device may downscale (§4, §12).
7. WebP and HEIC included in the published helper; HEIC kept over the panel's
   2–1 recommendation, with its reopening trigger (§4, §14a).
8. Local filesystem or hosted S3-compatible bytes, one streaming-first
   asset-id trait, server delivery and no presigned redirect (§9a).
9. Pixel decode in the bounded helper subprocess; walkers in-process (§14a).
10. Build-time codecs, one complete published helper, loud missing-codec
    refusals (§14a).
11. Second-panel decisions: defer `file`, keep HEIC, rotate blob namespaces
    on writable forks, revalidate private HTTP caches, preserve orientation
    via the matrix-gated synthesized tag with re-encode fallback (§2, §4, §9a).
12. Device bytes leased to owning rows; fetched widths only, atomic purge,
    one ceiling, no cache where every delivery requires authorization (§9b).

## What promotion to a Spec requires

`rules/RULES.md`: *"A spec needs an implementer and a date, or it isn't
written,"* and *"only implemented specs bind."* On 2026-09-03 the author
assigned both (§15): implementer codex gpt-5.6-sol under the standing
arrangement, date 2026-09-03. The document is **Accepted**; it binds lane by
lane as each lane's code lands, and the file keeps its RFC type and number,
which never change.
