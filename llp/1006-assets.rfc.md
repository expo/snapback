# LLP 1006: Assets — bytes as an ordinary reference

**Type:** RFC
**Status:** Draft
**Systems:** `snapback2-core` (the `_assets` table, the asset column, projection,
refcount), `snapback2` (the upload and delivery routes, the finalize worker),
`packages/compiler` (the `asset()` declaration and column lowering),
`packages/quarry` (the notation), `packages/snapback2` (client + React)
**Author:** Claude Opus 5 (design), commissioned by Charlie Cheever 2026-08-31
**Date:** 2026-08-31
**Revised:** 2026-08-31 (initial draft)
**Related:** LLP 1000 (decisions 5, 6), LLP 1001 (§1 engine-owned tables, §2
touched keys, §3 states, §8 outbox, §9 schema additions), LLP 1002 (§4 the
wire), LLP 1003 (the outbox lifecycle this reuses), LLP 1004 (Quarry is the
default surface), **LLP 1005** (the Snapback 1 evidence this is answering),
LLP 0329.014.004, `rules/RULES.md`, `rules/NOT-DOING.md`

## Summary

`rules/NOT-DOING.md` puts "Assets (typed intent)" on the doing-list and
everything Snapback 1 built above it — collections, media commands, grants —
off it. LLP 1005 says why: the typed intent was the part every diary praised,
and the 3,106 LLP lines above it shipped two capabilities that are still
experimental.

This RFC is the design for that doing-list item. It rests on one move:

> **An asset is a row in an engine-owned table, and an asset reference is an
> ordinary `Ref` in the existing value model.**

Everything else falls out. Delivery authority is the referencing row's read
rule, evaluated at the reference site — so bytes and rows are one authority
with no sharing declaration. Attachment is a write-time column check, not a
call. A post with four photos is `t.list(t.asset(...), { max: 4 })`, not a
capability. There is no new value kind, no new certificate version, no
projection seam, no delivery-profile knob, and no second authorization system.

The result is roughly one tenth of Snapback 1's asset surface, and it keeps
both things LLP 1005 identifies as the moat: one authority over rows and
bytes, and a declaration the author cannot decline to make.

**This is a proposal.** `rules/RULES.md`: only implemented specs bind, and a
spec needs an implementer and a date. §14 proposes both; nothing here binds
until code runs it. It was commissioned in-session, which is the "explicit
human approval" the agent rule requires for adding a design document.

## 1. The move

Snapback 1's asset id was a string that the rest of the system had to be
taught about, one seam at a time: the result contract did not know it
(LLP 1005 §5a — the flagship "feed with photos" shape was inexpressible and
needed two separate repairs), the live-query planner did not know it, the
generated types did not know it, and LLP 0244 spent 809 lines building the
projection seam that finally reconciled them.

Snapback 2 already has the right vocabulary. `ColumnType::Ref { table }` is a
typed reference to a row; `Value::Id` is its value; the trace, the certificate,
invalidation, and the client twin all handle it today. Engine-owned tables
(`_meta`, `_commits`, `_outbox`, `_principals`, `_credentials`, `_sessions`)
are an established category with an established fence (LLP 1001 §1).

So:

- **`_assets` is a new engine-owned table.** Columns: `id`, `intent`,
  `state` (`staging | ready | failed`), `kind`, `bytes`, `w`, `h`, `hash`
  (thumbhash), `digest` (sha256), `created_by`, `created_at`, `refs`
  (the reference count, §9). The schema may not declare it
  (`E_SCHEMA_RESERVED`, existing).
- **`t.asset(intent)` is a column type that lowers to `Ref { table: "_assets" }`
  carrying an intent tag.** In Quarry: `avatar: asset avatars`.
- **The value stored is a `Value::Id`.** Nothing about storage, ordering,
  indexing, arithmetic, or the evaluator twin changes.

**The certificate value model does not move.** Adding `Bytes` bumped it from
`i53-codepoint-v1` to `i53-codepoint-bytes-v2` (LLP 1001 §9). Assets bump
nothing, because they introduce no value. That is the cheapest available
evidence that this design is native rather than bolted on.

## 2. Authority: delivery is by reference site

This is the load-bearing decision, and it is where Snapback 2 can beat
Snapback 1 rather than merely re-implement it.

Snapback 1 delivered bytes by asset id (`/assets/<id>/<variant>`) and needed a
separate `assetSharing` declaration, reverse-reference edges, a 1,024-edge
per-app quota, and transactional edge death to make byte authority agree with
row authority. It worked — LLP 1005 §2 measures it as the only arm in the
field where revocation kills the feed *and* the bytes — and it cost a great
deal of machinery.

Snapback 2 delivers bytes by **reference site**:

```
GET /api/asset/<table>/<rowId>/<column>[/<index>]?w=<width>
```

The engine resolves it as one certified point read:

1. read row `rowId` of `table` under the viewer's `read` rule — the ordinary
   rule, the ordinary refusal, the ordinary trace;
2. read the named column (or list element `<index>`) and require it to be an
   asset reference;
3. serve the bytes of that asset.

Consequences, none of which needs new machinery:

- **Bytes and rows are one authority by construction.** There is nothing to
  declare, and no way for the two to disagree, because there is only one rule
  evaluation and it is the table's.
- **Revocation is exact and immediate.** A rule that stops admitting the
  viewer stops admitting the bytes on the next request. No edge to kill.
- **Replacement is exact.** Patch the column and the old asset is no longer at
  that path. Snapback 1 needed transactional reverse-edge death for the same
  guarantee (LLP 1005 §2).
- **Deletion is exact.** Delete the row and the path 404s, whether or not the
  bytes have been swept yet. Authority never waits on GC.
- **Pasteability is derived, not declared.** If the table's read rule is
  `rule.public`, the path needs no credential and carries long cache headers;
  otherwise it is authorized per request and `no-store`. LLP 1005 §5c is the
  single most repeated friction in the v1 corpus — four builds burned on
  choosing a delivery profile — and this design has no profile to choose.
- **It is bounded.** One point read and one rule evaluation, statically
  known. Snapback 1's reverse-edge model needed a quota because its
  authorization question was unbounded; this one is a `db.get`.

The honest cost: **an asset has no identity of its own on the wire.** You
cannot hand someone a link to bytes independent of a row they may read. That
is exactly the recipient-grant/signed-link feature, and it is a non-goal
(§12). An app that wants a public image makes the row public.

## 3. Authoring surface

Quarry is the default surface (LLP 1004); the TS twin is what `quarryc`
emits.

```
asset avatars:
  accept image/jpeg, image/png, image/heic
  max 5mb
  strip location

asset postPhotos:
  accept image/jpeg, image/png, image/heic
  max 12mb
  strip location
  upload <- viewer

table profiles:
  handle: text <=40
  avatar: asset avatars ?
  unique handle
  public
  insert r <- r.id = viewer
  update r <- r.id = viewer

table posts:
  author: profiles
  body: text <=500
  photos: [asset postPhotos] <=4
  at: time
  by byAuthorAt: author, at
  public
  insert r <- r.author = viewer
```

The TS twin:

```ts
export const avatars = asset({
  accept: ['image/jpeg', 'image/png', 'image/heic'],
  max: 5_000_000,
  strip: 'location',
})

export const profiles = table({
  columns: { handle: t.text(40), avatar: t.optional(t.asset(avatars)) },
  // …
})
```

Two things to notice.

**A post with four photos is a list column.** Snapback 1 explicitly withdrew
`v.array(v.assetRef(...))` and routed multi-asset relationships onto a bounded
children path, which became `assetCollection` — 589 RFC lines plus generated
operations, stable item identity, sharing ceilings, GC/quota/cut custody, and a
React hook, and it is still `experimental` behind an expired GAP row. Snapback 2
gets the same shape from `ColumnType::List { of, max }`, which already exists
and is already bounded, indexed-excluded, and twin-supported.

**There is no media command.** Snapback 1 needed `defineMediaCommand` — a
bounded multi-upload task with ambiguity, retry, and per-item residue
provenance — because the uploads and the row write had to be coordinated.
Here they are not: uploads complete first and produce ids, and the mutation
that references them is one ordinary transaction, which is already atomic. A
failed upload produces an unreferenced asset that the sweep reclaims (§9) and
a client that retries one file. That is a materially weaker product story
than v1's per-item residue honesty, and a materially smaller one; §12 records
the trade rather than hiding it.

## 4. Admission: the intent

The intent is the declaration LLP 1005 §3 identifies as the part that earned
its keep, and it keeps its defining property: **the author cannot decline to
make the privacy decision.** A declaration with no `strip` is
`E_ASSET_STRIP_REQUIRED` at check, with the rewrite naming both spellings.
That refusal is why Snapback 1 was the only arm in the bakeoff whose served
bytes provably lost their GPS.

| field | required | meaning |
|---|---|---|
| `accept` | yes | closed list of media types; the *detected* type must match, never the declared one |
| `max` | yes | byte ceiling, enforced at admission and re-checked at finalize |
| `strip` | yes | `location` or `none`; `none` must be written out |
| `upload` | no | a `RuleExpr` over the viewer; default `viewer` (any authenticated principal). `rule.public` admits anonymous uploads |

Admission is trusted and server-side: the detected type governs, a type outside
`accept` is `E_ASSET_TYPE`, and bytes over `max` are `E_ASSET_TOO_LARGE`. Both
ride the existing `input` family.

**HEIC normalizes to JPEG at admission.** iOS photo libraries are HEIC-first
and pickers hand back HEIC even in compatible mode (LLP 1005 §6); Snapback 1
still cannot decode it (`issues/20260819-heic-image-normalization.md`, open).
Accepting HEIC and storing an un-servable original would reproduce the bug, so
the admission pipeline decodes HEIC and stores a JPEG primary. The stored
`kind` is the normalized one.

**Duration is expressible; codec is not.** `max duration 60s` is a
container-level fact the admission walker already reads. Codec identification
is deferred with its reason: Snapback 1 could not express it either
(`issues/20260817-upload-intent-codec-duration-admission-facts.md`), and it is
only useful once video ships (§12).

## 5. Upload: the wire

Two routes, added to LLP 1002 §4:

| route | body → response |
|---|---|
| `POST /api/upload` | `{ intent }` → `{ assetId, url, chunkMax, accept, max }` |
| `PATCH /api/upload/<assetId>` | TUS-shaped: `Upload-Offset`, `Tus-Resumable`; `HEAD` returns the current offset |

Three requirements are stated as requirements because Snapback 1 paid for each
of them:

1. **The create response carries the limits.** `chunkMax`, `accept`, and `max`
   come back before the first byte moves. Snapback 1's default configuration
   could not upload a 120 MB video because the client's 4 MiB default chunk
   exceeded a 2 MiB server ceiling neither side had stated (LLP 1005 §6), and
   three of five bakeoff arms made the author discover limits by failing.
2. **`Access-Control-Allow-Headers` includes `upload-offset` and
   `tus-resumable` from the first commit.** Snapback 1 shipped without them, so
   browser TUS worked only behind the dev relay and a cold agent hand-wrote an
   80-line CORS proxy to finish a brief (Diary 0065; fixed in 0.1.11). Snapback
   2 has no supervised bundler and no relay to hide behind
   (`rules/NOT-DOING.md`), so this is load-bearing, not hygiene.
3. **The client owns the offset.** The protocol is not the feature; the custody
   is. Snapback 1 re-transmitted 0 bytes across a process death because its
   client shipped `resumePersisted`; Supabase has the identical protocol and
   re-sent 100 % on the naive path, and Firebase's "resumable" upload is
   in-process only (LLP 1005 §4). `client.upload()` persists
   `{ assetId, offset }` and resumes from `HEAD`.

## 6. Attachment is a column check, not a call

Snapback 1 required `ctx.assets.attach(...)` inside the mutation, and a write
that stored an asset id without it was refused `SNAPBACK_ASSET_REF_UNVERIFIED`.
The refusal is correct — a forged string must not become an authorized
reference — and LLP 1005 §5b records that essentially every author discovered
it by hitting it rather than by reading.

In Snapback 2 the check moves into the column. Writing a value to a
`t.asset(intent)` cell requires, in the writing transaction:

- the asset exists in `_assets` and is `state = ready` (`E_ASSET_NOT_READY`);
- its `intent` equals the column's declared intent (`E_ASSET_INTENT`);
- its `created_by` is the writing principal, or the principal is `system`
  (`E_ASSET_NOT_OWNED`).

All three ride the existing `input` family, alongside every other column-bound
refusal, and they are checked in the same place as `max` on a `text` column.
There is nothing to remember to call, so there is nothing to forget. The
forged-string property is preserved exactly.

The ownership check is what makes a bare id useless to an attacker; it is also
what makes the third bullet's `system` escape necessary, so an effect's `then`
mutation can move an asset the service principal produced.

## 7. Reading: what an asset column projects

A `t.asset()` cell reads as a small fixed record, projected by the engine from
the `_assets` row inside the same pinned read transaction:

```json
{ "id": "as_…", "kind": "image/jpeg", "w": 1290, "h": 1720, "hash": "…", "ready": true }
```

Four properties keep this cheap, and they are exactly the properties LLP 0244
had to work to establish in Snapback 1:

- **It does not vary with the viewer.** Authority was already decided by the
  row's read rule; there is no denial state, no four-valued kind, no read-policy
  interaction, and no disclosure question.
- **It is one point read per asset-valued cell**, on a fixed engine table at a
  fixed key. With `take: N` over a row carrying `k` asset columns the
  projection cost is `N × k`, statically known — so the certificate counts it
  like any other site and the bounded model is undisturbed.
- **It touches the trace.** Finalize records a `TouchedKey` on the `_assets`
  row; the projection records the matching point read. Readiness therefore
  invalidates and re-delivers through the existing subscription machinery —
  a thumbnail becoming ready pushes to a live feed for free, which is the
  behavior Snapback 1's Party Wall arm measured and no competitor matched.
- **The placeholder ships with the reference.** `hash` is a thumbhash computed
  at admission. Snapback 1 computes the same value and does not project it, so
  every tile paints empty during issuance
  (`issues/20260816-media-placeholder-projection.md`, open). Projecting it is
  free here and removes perceived latency without a byte of client cache.

`ready: false` is reachable only if a mutation could reference a non-ready
asset, which §6 forbids — so it exists for the reference that was ready at
write time and whose row is being read while a re-render is in flight, and for
honesty about the `failed` terminal.

## 8. Renditions: one bounded width ladder, on demand

No pre-declared variants. `?w=<width>` selects from a closed ladder — 64, 128,
256, 384, 512, 768, 1024, 1536 — and any other value is `E_ASSET_WIDTH`. The
requested width is rendered on first request, cached by
`(asset, width, generation)`, and served thereafter.

Snapback 1 pre-declared renditions in the intent, and the bakeoff ranked it
ahead of the field on media-pipeline *capability* while ranking PocketBase
ahead on *DX* for the same axis, on the strength of one URL parameter
(LLP 1005 §7). It also produced a specific recurring bug: a helper that
composes a rendition name the intent did not declare yields a URL for bytes
that do not exist (Diary 0086). A closed ladder cannot express that bug, and
LLP 0044 had already superseded its own dynamic-transform non-goal with
"ladder-bounded on-demand widths" under exactly this evidence.

Omitting `?w=` serves the primary. Height follows aspect; there is no crop, no
format negotiation, and no arbitrary transform (§12).

## 9. Lifecycle: finalize off the writer, refcount in the commit

**Finalize never runs inside the store transaction.** Snapback 1 reads whole
objects into memory three times and runs media CPU inside the single global
writer lock, so one large upload stalls the instance with ~2× RSS spikes; the
ticket is P2 and still open, and the S3 path still does `read → Vec → put`
(LLP 1005 §9). This is the clearest inherited-debt warning in the v1 record and
the design answer is to make it structurally impossible:

- bytes stream to staging; nothing buffers a whole object;
- validation, strip, HEIC decode, thumbhash, and width rendering run on a Rust
  worker thread, outside any store transaction;
- success is one small engine write flipping `_assets.state` to `ready` and
  filling `kind/w/h/hash/digest`.

**The job lifecycle is the outbox's, not a second one.** LLP 1003's `_outbox`
already has claim-once semantics, bounded attempts with backoff, restart
honesty, and a `trace` surface. Finalize reuses that machinery with a
platform-owned job kind rather than introducing a parallel scheduler —
`rules/RULES.md` says agents remove apparatus and add none. It is not an
authored `job` kind (still deferred, LLP 1001) and no application JavaScript
runs: this is Rust, not Ibex 2.

**Liveness is a refcount, maintained in the commit.** The engine already
records writes and touched keys per commit; asset cells add a `refs` delta on
the `_assets` row in that same transaction — `+1` when a cell starts referencing
an asset, `-1` when it stops, including row deletion and list edits. An asset
at `refs = 0` past a grace period is swept.

The refcount buys space reclamation only — **never authority.** Because
delivery is by reference site (§2), an unreferenced asset is already
undeliverable, so a sweep that lags, crashes, or partially completes is a disk
cost and not a disclosure. Snapback 1's equivalent bug is open today: a partial
reset wipe leaves orphans that are never reclaimed *and* undetectable
(`issues/20260821-orphan-blob-reclamation-after-reset.md`). Here the same
failure is a number that is too high, discoverable by a full scan, and
correctable.

**The digest is queryable.** `digest` is a sha256 on the projected record. LLP
1005 §7 names Convex's queryable digest as the one strictly-better competitor
idea the bakeoff found, and Snapback 1 still does not expose it: "we verified
it end to end, trust us" is worse DX than handing it over.

## 10. Clients

React web first, Expo second (LLP 1000 decision 5); Exact 2 follows.

```tsx
const { data } = useQuery(api.posts.feed, {})
// post.photos[0] is { id, kind, w, h, hash, ready }
<AssetImage of={post} column="photos" index={0} width={512} />
```

`AssetImage` composes the §2 path and paints `hash` while the bytes load. The
upload primitive is `client.upload(api.assets.postPhotos, file)` returning
`{ assetId, progress, done }` with the §5 offset custody. That is the whole
client surface: one component, one call.

Snapback 1's client-side friction was concentrated in exactly what this
removes — hooks with different nullability conventions for the same concept, a
`src` that defaulted to a URL a plain `<img>` cannot fetch, and hand-composed
delivery URLs (LLP 1005 §5c, Diary 0100). There is no URL to hand-compose here
because the path is derived from the reference the caller already holds.

## 11. What this deletes

| Snapback 1 | Snapback 2 | Why it goes |
|---|---|---|
| `assetSharing` declaration | — | the reference edge is the declaration (§2) |
| Three delivery profiles | — | derived from the table's read rule (§2) |
| Reverse-reference edges + 1,024-edge quota | — | authority is a point read, not a reverse query (§2) |
| `ctx.assets.attach` | — | a column check (§6) |
| `MediaRef` projection seam (LLP 0244, 809 lines) | ~a fixed record (§7) | no viewer-varying authority to reconcile |
| `assetCollection` (LLP 0239) | `t.list(t.asset(…), { max })` | the engine already has bounded lists (§3) |
| `defineMediaCommand` (LLP 0180) | the mutation | uploads settle before the write, so there is nothing to coordinate (§3) |
| Recipient grants (LLP 0220) | — | non-goal (§12) |
| Pre-declared renditions | `?w=` ladder (§8) | closed ladder cannot name a nonexistent variant |
| 199 `SNAPBACK_ASSET*`/`MEDIA*`/`COMMAND*` codes | ~12 `E_ASSET_*` | most of them described machinery that no longer exists |

## 12. Non-goals, with reasons

- **Video, in the first slice.** Not because it is unimportant — Clique and
  Coterie both need it — but because we cannot strip video metadata without the
  container walker Snapback 1 spent weeks on, including the finding that
  QuickTime `meta` atoms are not ISO fullboxes (LLP 1005 §6). Shipping video
  without stripping would surrender the single differentiator the bakeoff
  measured. `E_ASSET_KIND_UNSUPPORTED` names the deferral. The second slice
  ports the walker *with* its fix and a real iPhone MOV in the corpus.
- **Recipient grants and signed share links.** `rules/NOT-DOING.md`; LLP 1005
  §8. The honest consequence is stated in §2 rather than hidden.
- **Ordered-collection operations** (insert-at, reorder, stable item ids
  surviving reorder). A list column replaces the collection; it does not
  replace collection *operations*. An app needing reorder writes the list.
- **Per-item residue and multi-upload ambiguity semantics** (LLP 0180). The
  trade is recorded in §3: this design's partial-failure story is "retry that
  one file," which is weaker and much smaller.
- **Arbitrary transforms**: crop, format negotiation, effects, cross-app
  deduplication, byte export/import.
- **A second authorization system for bytes.** The whole point.

## 13. What it costs

- **No new blocking check.** `rules/RULES.md` allows five; assets add none.
  Asset cases join the existing corpus and `scripts/test.sh`.
- **No certificate version bump** (§1) and no evaluator-twin value change. The
  twin treats an asset projection as a point read it already models.
- **`check` stays under 1 s.** The declaration adds one schema node kind and
  three column-check rules; nothing walks bytes at check time.
- **Binary size.** An image decoder, a HEIC decoder, and a resizer are real
  dependencies on a binary whose published size is a measured number (2.18 MB
  without the engine, 5.06 MB with). This is the largest honest cost in the
  design and OQ3 asks the author about it.
- **Finalize concurrency** is bounded by a worker pool, and a single large
  upload must not delay unrelated commits — the measured property, and the
  regression test, that §9 exists for.

## 14. Implementation shape

`rules/RULES.md`: a spec needs an implementer and a date. Proposed, subject to
the author's scheduling:

| lane | scope |
|---|---|
| A | `_assets` table, `t.asset()` column + `Ref` lowering, write-time checks (§6), projection (§7), refcount (§9) — `snapback2-core` |
| B | upload + delivery routes, streaming staging, the finalize worker on the outbox lifecycle, the width ladder — `snapback2` |
| C | `asset()` in the compiler, `asset` in Quarry, `api.d.ts` types |
| D | `client.upload`, `AssetImage`, React; one template using it |

Fix loops get three rounds (`rules/RULES.md`). The acceptance that matters is
not a unit suite: per LLP 1005 §6, this slice is not done until a real
multi-megabyte file, a real browser bundle with no relay in front of it, and a
real phone have each been through it — those three found every serious asset
bug in Snapback 1 and none of them was reachable from a harness.

## Confidence

**0.85** on §1 and §2 (asset-as-`Ref`, delivery-by-reference-site). They follow
from the existing value model and the existing rule evaluation, and they
reproduce the one property LLP 1005 measures as the moat with strictly less
machinery. The residual risk is §2's honest cost — no row-independent link —
being more load-bearing for real apps than I judge.

**0.8** on §3's claim that a list column replaces `assetCollection` for the
apps we actually have. Clique and Coterie need ordered post media and do not
need reorder; an app that needs reorder is not served.

**0.75** on §7's projection being as cheap as claimed. It is one point read per
cell in the same transaction, but it interacts with paging and the capped-site
rules of LLP 1001 §3 in ways only the implementation will settle.

**0.6** on §8's ladder edges and §4's HEIC-normalizes-to-JPEG ruling. Both are
defensible defaults rather than derived results.

**0.5** on §13's binary-size cost being acceptable. That is the author's call,
not a design conclusion.

## Open questions (author)

1. **Video in slice 1 or slice 2?** §12 recommends slice 2 and states the
   reason. Slice 1 means no video for Clique's brief.
2. **Does anything need a row-independent link before promotion?** §2 trades it
   away deliberately. If a benchmark app needs "share this photo by URL," the
   trade must be revisited before the design lands, not after.
3. **Is an image/HEIC decoder acceptable in the published binary?** §13. The
   alternative is an effect-shaped out-of-process renderer, which is more
   machinery and slower, or shipping originals only, which gives up the width
   ladder.
4. **Should `strip: none` exist at all?** It is the escape hatch that makes the
   mandatory decision honest, and it is also the hole through which a
   thoughtless author leaks location. Snapback 1 kept it.
