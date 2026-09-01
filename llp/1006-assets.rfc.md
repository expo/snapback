# LLP 1006: Assets — a column type

**Type:** RFC
**Status:** Draft
**Systems:** `snapback2-core` (the `_assets` ledger, the asset column, the
write-time stamp, the sweep), `snapback2` (upload and delivery routes, the
finalize worker), `packages/compiler` (the column type), `packages/quarry`
(the notation), `packages/snapback2` (client + React)
**Author:** Claude Opus 5 (design), commissioned by Charlie Cheever 2026-08-31
**Date:** 2026-08-31
**Revised:** 2026-08-31 (b — the simplification pass, author-directed: seven
deletions from revision (a). The named `asset` intent declaration, the `strip`
field, the `upload` rule, the on-demand width ladder, the maintained refcount,
the `ready` projection field, and the read-time projection seam are all gone;
assets are now a column type whose stored value is stamped at write time.
Revision (a)'s `Ref`-plus-projection design is recorded in §12 so it is not
re-derived.); 2026-08-31 (a — initial draft)
**Related:** LLP 1000 (decisions 5, 6), LLP 1001 (§1 engine-owned tables, §3
states, §9 schema additions), LLP 1002 (§4 the wire), LLP 1003 (the outbox
lifecycle this reuses), LLP 1004 (Quarry is the default surface), **LLP 1005**
(the Snapback 1 evidence this answers), LLP 0329.014.004, `rules/RULES.md`,
`rules/NOT-DOING.md`

## Summary

`rules/NOT-DOING.md` puts "Assets (typed intent)" on the doing-list and
everything Snapback 1 built above it — collections, media commands, grants —
off it. LLP 1005 says why: the typed intent was the part every diary praised,
and the 3,106 LLP lines above it shipped two capabilities that are still
experimental.

This RFC is the design for that doing-list item, and after the simplification
pass it reduces to one sentence:

> **An asset is a column type. Its value is stamped by the engine at write
> time, and its bytes are served through the row that holds it.**

Everything else is a consequence. Byte authority is the row's read rule, so
there is no sharing declaration and no delivery profile. The value is stamped,
so there is no attach call and no read-time projection. Four photos is
`[image <=12mb] <=4`, so there is no collection. Uploads settle before the
write, so there is no media command. The certificate value model does not move.

The whole feature is a column type, two HTTP routes, two renditions, and a
background sweep.

**This is a proposal.** `rules/RULES.md`: only implemented specs bind, and a
spec needs an implementer and a date. §15 proposes both; nothing here binds
until code runs it. It was commissioned in-session, which is the explicit
approval the agent rule requires for adding a design document.

## 1. The move

Snapback 1's asset id was a string the rest of the system had to be taught
about, one seam at a time: the result contract did not know it (LLP 1005 §5a —
the flagship "feed with photos" shape was inexpressible and needed two separate
repairs), the live-query planner did not know it, the generated types did not
know it, and LLP 0244 spent 809 lines building the projection seam that finally
reconciled them.

Snapback 2 makes the asset a **column type whose stored value is a closed
record the engine writes itself**:

```
declared      photos: [image <=12mb] <=4
assigned      +posts { photos: [a, b, c] }        // a, b, c are upload ids
stored        [{ id, kind, w, h, hash, digest }, …]   // stamped by the engine
read          the same record, at no additional cost
```

The asymmetry — you assign an id, you read a record — is the whole mechanism.
The engine resolves each id against the `_assets` ledger inside the writing
transaction, verifies it (§6), and writes the record. A caller supplies no
facts, so there are no facts to forge and none to validate on read.

Three consequences worth stating up front:

- **The certificate value model does not move.** The stored value is a
  `Value::Row`, which exists; the column is a new `ColumnType` variant with one
  arm in `valid_column_value` (`engine/index.rs:320`), beside `Json`, which
  already accepts arbitrary `Value` under a byte bound. Adding `Bytes` bumped
  the model from `i53-codepoint-v1` to `i53-codepoint-bytes-v2` (LLP 1001 §9);
  assets bump nothing, because they add no value kind. That is the cheapest
  available evidence that this is native rather than bolted on.
- **There is no read path.** Reading an asset column costs what reading a
  `json` column costs. Snapback 1's projection ran "inside the pinned read
  transaction for queries and inside the committing transaction for mutations"
  (LLP 0244); this keeps only the second half.
- **An asset column is not indexable** (`E_SCHEMA_INDEX_COLUMN`, the existing
  refusal `List` already uses).

`_assets` remains as an engine-owned table (LLP 1001 §1 — `E_SCHEMA_RESERVED`
already forbids declaring it), but it is now only a **staging and ownership
ledger**: `id`, `state` (`staging | ready | failed`), `kind`, `bytes`, `w`,
`h`, `hash`, `digest`, `created_by`, `created_at`. After the stamp it is not
the source of truth for anything a program reads.

## 2. Authority: delivery is by reference site

This is the load-bearing decision and the one place Snapback 2 can beat
Snapback 1 rather than re-implement it.

Snapback 1 delivered bytes by asset id (`/assets/<id>/<variant>`) and needed a
separate `assetSharing` declaration, reverse-reference edges, a 1,024-edge
per-app quota, and transactional edge death to make byte authority agree with
row authority. It worked — LLP 1005 §2 measures it as the only arm in the field
where revocation kills the feed *and* the bytes — and it cost a great deal of
machinery.

Snapback 2 delivers bytes by **reference site**:

```
GET /api/asset/<table>/<rowId>/<column>[/<index>][/thumb]
```

The engine resolves it as one certified point read: read the row under the
viewer's ordinary `read` rule, take the named column (or list element), require
it to be a stamped asset record, serve its bytes.

Consequences, none needing new machinery:

- **Bytes and rows are one authority by construction.** There is nothing to
  declare and no way for the two to disagree, because there is one rule
  evaluation and it is the table's.
- **Revocation is exact and immediate.** A rule that stops admitting the viewer
  stops admitting the bytes on the next request. No edge to kill.
- **Replacement and deletion are exact.** Patch the column and the old asset is
  no longer at that path; delete the row and the path 404s, whether or not the
  bytes have been swept. Authority never waits on GC.
- **Pasteability is derived, not declared.** A `rule.public` table's asset
  paths need no credential and carry long cache headers; anything else is
  authorized per request and `no-store`. LLP 1005 §5c is the most repeated
  friction in the v1 corpus — four builds burned choosing a delivery profile —
  and this design has no profile to choose.
- **It is bounded.** One point read and one rule evaluation. Snapback 1's
  reverse-edge model needed a quota because its authorization question was
  unbounded; this one is a `db.get`.

The honest cost: **an asset has no identity of its own on the wire.** You
cannot hand someone a link to bytes independent of a row they may read. That is
the recipient-grant/signed-link feature, and it is a non-goal (§13). An app
that wants a public image makes the row public.

## 3. Authoring surface

Quarry is the default surface (LLP 1004); the TS twin is what `quarryc` emits.

```
table profiles:
  handle: text <=40
  avatar: image <=5mb ?
  unique handle
  public
  insert r <- r.id = viewer
  update r <- r.id = viewer

table posts:
  author: profiles
  body: text <=500
  photos: [image <=12mb] <=4
  at: time
  by byAuthorAt: author, at
  public
  insert r <- r.author = viewer
```

```ts
export const profiles = table({
  columns: { handle: t.text(40), avatar: t.optional(t.image(5_000_000)) },
  // …
})
export const posts = table({
  columns: { photos: t.list(t.image(12_000_000), { max: 4 }), /* … */ },
  // …
})
```

That is the entire authoring surface. `image` reads exactly like `text`,
because it is exactly as complicated: a type with a bound.

Three things Snapback 1 needed that are absent here, each because the engine
already has the mechanism:

**A post with four photos is a list column.** Snapback 1 explicitly withdrew
`v.array(v.assetRef(...))` and routed multi-asset relationships onto a bounded
children path, which became `assetCollection` — 589 RFC lines plus generated
operations, stable item identity, sharing ceilings, and GC/quota/cut custody,
still `experimental` behind an expired GAP row. `ColumnType::List { of, max }`
already exists and is already bounded and twin-supported.

**There is no media command.** Snapback 1 needed `defineMediaCommand` — a
bounded multi-upload task with ambiguity, retry, and per-item residue
provenance — because uploads and the row write had to be coordinated. Here they
are not: uploads complete first and produce ids, and the mutation referencing
them is one ordinary transaction, which is already atomic. A failed upload
leaves an unreferenced asset the sweep reclaims (§9) and a client that retries
one file. That is a materially weaker partial-failure story than v1's per-item
residue honesty, and a materially smaller one; §13 records the trade.

**There is no intent declaration.** Policy lives on the column, so an upload
names the column it is destined for (§5) and the engine checks the match
trivially rather than by comparing intent tags. §12 records why the named
declaration went.

## 4. Admission

Admission keeps the property LLP 1005 §3 identifies as the reason Snapback 1
was the only arm in the bakeoff whose served bytes provably lost their GPS —
**the author cannot decline the privacy decision** — but gets there by removing
the decision rather than mandating it.

- **Location metadata is always stripped.** There is no `strip` field. The v1
  diaries celebrate the mandatory-decision refusal, but they celebrate it
  because the outcome was stripping; making it unconditional produces the same
  outcome with no declaration, no escape hatch, and no diagnostic. A future
  photography app that wants EXIF preserved is the trigger to add the knob back,
  and it does not exist yet.
- **The type is the accept list.** `image` admits JPEG, PNG, and HEIC. The
  *detected* type governs, never the declared one; anything else is
  `E_ASSET_TYPE`.
- **HEIC normalizes to JPEG at admission.** iOS photo libraries are HEIC-first
  and pickers hand back HEIC even in compatible mode (LLP 1005 §6); Snapback 1
  still cannot decode it (`issues/20260819-heic-image-normalization.md`, open).
  Accepting HEIC and storing an unservable original would reproduce the bug.
- **The bound is bytes**, enforced at admission and re-checked at finalize;
  over is `E_ASSET_TOO_LARGE`.

Both refusals ride the existing `input` family.

**Upload authority is "an authenticated principal," with no knob.** Revision
(a) had a per-intent `upload` rule; it is unnecessary under §2. An asset nobody
references is undeliverable and swept, so an upload on its own grants nothing —
the authorization that matters is the `insert`/`update` rule on the mutation
that references it, which the table already declares. The residual exposure is
disk, and §14 records it as a quota question rather than a rule.

## 5. Upload: the wire

Two routes, added to LLP 1002 §4:

| route | body → response |
|---|---|
| `POST /api/upload` | `{ column: "posts.photos" }` → `{ assetId, url, chunkMax, accept, max }` |
| `PATCH /api/upload/<assetId>` | TUS-shaped: `Upload-Offset`, `Tus-Resumable`; `HEAD` returns the current offset |

Naming the column rather than an intent means the admission policy is looked up
where it is declared, and §6's match check is an equality on the column path.

Three requirements are stated as requirements because Snapback 1 paid for each:

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

## 6. The write: a stamp, not an attach

Snapback 1 required `ctx.assets.attach(...)` inside the mutation, and a write
storing an asset id without it was refused `SNAPBACK_ASSET_REF_UNVERIFIED`. The
refusal is correct — a forged string must not become an authorized reference —
and LLP 1005 §5b records that essentially every author discovered it by hitting
it rather than by reading.

Here, assigning an id to an asset column is checked where every other column
bound is checked, and the engine writes the value itself. In the writing
transaction, for each assigned id:

- the asset exists in `_assets` and is `state = ready` (`E_ASSET_NOT_READY`);
- its upload named this column (`E_ASSET_COLUMN`);
- its `created_by` is the writing principal, or the principal is `system`
  (`E_ASSET_NOT_OWNED`);
- the engine replaces the id with `{ id, kind, w, h, hash, digest }`.

All three refusals ride the existing `input` family. There is nothing to
remember to call, so there is nothing to forget, and the forged-string property
is preserved exactly — strengthened, in fact, because a caller cannot supply
dimensions or a hash at all rather than supplying ones the engine must ignore.

The `system` escape exists so an effect's `then` mutation can place an asset
the service principal produced (LLP 1003 §2).

**A stamped record is immutable.** An `_assets` row reaches `ready` once and
never changes afterward, and §6 forbids referencing anything else, so a stored
record can never go stale. This is why there is no `ready` field in the record,
no readiness invalidation, and no interaction with live subscriptions: the row
write *is* the invalidation, because it happens after the asset is ready.
Snapback 1 needed all three because it admitted attach-before-ready.

## 7. Reading

An asset column reads as what is stored:

```json
{ "id": "as_…", "kind": "image/jpeg", "w": 1290, "h": 1720, "hash": "…", "digest": "sha256-…" }
```

No projection, no point read, no bounds contribution, no viewer variance, no
denial state, no four-valued kind. `hash` is a thumbhash computed at admission,
so a client paints a blurred placeholder synchronously and fades in — Snapback 1
computes the same value and does not project it, so every tile paints empty
during issuance (`issues/20260816-media-placeholder-projection.md`, open).
`digest` is the sha256; LLP 1005 §7 names Convex's queryable digest as the one
strictly-better competitor idea the bakeoff found, and "we verified it, trust
us" is worse DX than handing it over.

## 8. Renditions: two, both at admission

A bounded primary and one thumb, produced at admission and immutable
thereafter. `…/photos/0` serves the primary; `…/photos/0/thumb` serves the
thumb. There is no `?w=`, no ladder, no request-time rendering, and no render
cache.

Snapback 1 pre-declared renditions in the intent, and the bakeoff ranked it
ahead of the field on media-pipeline *capability* while ranking PocketBase ahead
on *DX* for the same axis (LLP 1005 §7). It also produced a specific recurring
bug: a helper composing a rendition name the intent did not declare yields a URL
for bytes that do not exist (Diary 0086). The finding is about *author-declared*
variants; two platform-fixed renditions cannot be named wrongly, so the finding
is satisfied without any of the machinery revision (a) proposed. §12 records why
the ladder went.

## 9. Lifecycle: finalize off the writer, liveness by sweep

**Finalize never runs inside the store transaction.** Snapback 1 reads whole
objects into memory three times and runs media CPU inside the single global
writer lock, so one large upload stalls the instance with ~2× RSS spikes; the
ticket is P2 and still open, and the S3 path still does `read → Vec → put`
(LLP 1005 §9). This is the clearest inherited-debt warning in the v1 record, and
the design answer is to make it structurally impossible: bytes stream to
staging; validation, strip, HEIC decode, thumbhash, and both renditions run on a
Rust worker thread outside any store transaction; success is one small engine
write flipping `_assets.state` to `ready`.

**The job lifecycle is the outbox's, not a second one.** LLP 1003's `_outbox`
already has claim-once semantics, bounded attempts with backoff, restart
honesty, and a `trace` surface. Finalize reuses it with a platform-owned job
kind rather than introducing a parallel scheduler — `rules/RULES.md` says agents
remove apparatus and add none. It is not an authored `job` kind (still deferred,
LLP 1001) and no application JavaScript runs: this is Rust, not Ibex 2.

**Liveness is a periodic mark-and-sweep.** The sweep scans rows, collects the
ids in stamped records, and deletes `_assets` rows and bytes that are unmarked
and past a grace period. No refcount, no per-write delta, no list-edit or
row-delete bookkeeping.

The reason the dumbest correct algorithm is the right one: **liveness buys space
and never authority.** Because delivery is by reference site (§2), an
unreferenced asset is already undeliverable, so a sweep that lags, crashes, or
partially completes is a disk cost and not a disclosure. Snapback 1's equivalent
bug is open today — a partial reset wipe leaves orphans that are never reclaimed
*and* undetectable (`issues/20260821-orphan-blob-reclamation-after-reset.md`).
Here the same failure is recoverable by running the scan again. §12 records why
the maintained refcount went.

## 10. Clients

React web first, Expo second (LLP 1000 decision 5); Exact 2 follows.

```tsx
const { data } = useQuery(api.posts.feed, {})
// post.photos[0] is { id, kind, w, h, hash, digest }
<AssetImage of={post} column="photos" index={0} thumb />
```

`AssetImage` composes the §2 path and paints `hash` while bytes load. Upload is
`client.upload(api.posts.photos, file)` returning `{ assetId, progress, done }`
with §5's offset custody. One component, one call.

Snapback 1's client friction was concentrated in exactly what this removes:
hooks with different nullability conventions for the same concept, a `src`
defaulting to a URL a plain `<img>` cannot fetch, and hand-composed delivery
URLs (LLP 1005 §5c, Diary 0100). There is no URL to hand-compose, because the
path derives from the reference the caller already holds.

## 11. What this deletes

| Snapback 1 | Snapback 2 | Why it goes |
|---|---|---|
| `assetSharing` declaration | — | the reference edge is the declaration (§2) |
| Three delivery profiles | — | derived from the table's read rule (§2) |
| Reverse-reference edges + 1,024-edge quota | — | authority is a point read (§2) |
| `defineAssetUpload` intent | a column type | policy belongs on the column (§3) |
| `ctx.assets.attach` | the stamp (§6) | checked where column bounds are checked |
| `MediaRef` projection seam (LLP 0244, 809 lines) | — | the value is already the record (§1) |
| `assetCollection` (LLP 0239, experimental) | `t.list(t.image(…), { max })` | the engine has bounded lists (§3) |
| `defineMediaCommand` (LLP 0180, experimental) | the mutation | uploads settle before the write (§3) |
| Recipient grants (LLP 0220) | — | non-goal (§13) |
| Pre-declared renditions | two fixed renditions (§8) | a fixed pair cannot be named wrongly |
| 199 `SNAPBACK_ASSET*`/`MEDIA*`/`COMMAND*` codes | ~6 `E_ASSET_*` | most described machinery that no longer exists |

## 12. Considered and rejected

Revision (a) proposed each of these; they are recorded so a reader does not
re-derive them.

**An asset reference as `Ref { table: "_assets" }`, projected at read time.**
Elegant in the type system — the reference is an ordinary `Ref`, and `_assets`
is an ordinary engine table — and it keeps asset facts normalized, so one
asset referenced twice stores its dimensions once. Rejected because it
reinstates a read path: one point read per asset-valued cell per returned row,
a bounds contribution of `take × columns`, an interaction with LLP 1001 §3's
capped-site rules, and a projection seam. That seam is precisely what cost
Snapback 1 809 lines. Stamping keeps only the write half and costs a few dozen
denormalized, immutable bytes per reference.

**A named `asset` intent declaration.** The v1 diaries single the intent
declaration out as the good part, and dropping it is the change most likely to
be wrong. The judgment is that what the diaries praised is *co-located policy* —
"the intent declaration reads like config and carries the whole policy" —
which putting the policy on the column preserves and tightens, rather than the
naming. It also lets an upload name its destination column, which makes §6's
match check an equality instead of a tag comparison. The cost is that two
columns sharing a policy repeat it. OQ2 asks the author to confirm.

**An on-demand width ladder.** A closed set of widths rendered lazily and
cached, matching PocketBase's `?thumb=` DX that the bakeoff ranked above
Snapback 1. Rejected as the wrong size for a first slice: it adds a
request-time rendering path, a cache keyed on `(asset, width, generation)`,
ladder validation, and a diagnostic, to serve a need two fixed renditions cover.
The ladder is the natural second slice if a real feed wants it.

**A maintained refcount for liveness.** One integer per asset, deltaed in the
commit that writes or clears a cell. Rejected because it is a second source of
truth that can drift — which is the shape of the v1 orphan bug it would be
imitating — and because §2 removes the only reason to want it to be exact.

**A per-intent `upload` rule.** Rejected as unnecessary under §2: an upload
grants nothing until a mutation the table's rules admit references it (§4).

## 13. Non-goals, with reasons

- **Video, in the first slice.** Not because it is unimportant — Clique and
  Coterie both need it — but because we cannot strip video metadata without the
  container walker Snapback 1 spent weeks on, including the finding that
  QuickTime `meta` atoms are not ISO fullboxes (LLP 1005 §6). Shipping video
  unstripped would surrender the single differentiator the bakeoff measured.
  `E_ASSET_TYPE` names the deferral; the second slice adds a `video` column type
  and ports the walker *with* its fix and a real iPhone MOV in the corpus.
- **Codec and duration admission facts.** Only useful once video ships; Snapback
  1 could not express them either
  (`issues/20260817-upload-intent-codec-duration-admission-facts.md`).
- **Recipient grants and signed share links.** `rules/NOT-DOING.md`; LLP 1005
  §8. The honest consequence is stated in §2 rather than hidden.
- **Ordered-collection operations** (insert-at, reorder, item ids surviving
  reorder). A list column replaces the collection, not the collection's
  operations; an app needing reorder writes the list.
- **Per-item residue and multi-upload ambiguity semantics** (LLP 0180). §3
  records the trade: partial failure here is "retry that one file."
- **Arbitrary transforms**: crop, format negotiation, effects, cross-app
  deduplication, byte export/import.
- **A second authorization system for bytes.** The whole point.

## 14. What it costs

- **No new blocking check.** `rules/RULES.md` allows five; assets add none.
  Asset cases join the existing corpus and `scripts/test.sh`.
- **No certificate version bump and no new `Value` variant** (§1). The twin
  gains one column type whose value it already models.
- **`check` stays under 1 s.** One schema node kind and three write-time checks;
  nothing walks bytes at check time.
- **Binary size.** An image decoder, a HEIC decoder, and a resizer are real
  dependencies on a binary whose published size is a measured number (2.18 MB
  without the engine, 5.06 MB with). This is the largest honest cost in the
  design; OQ3.
- **Denormalized bytes.** Roughly 150 bytes per asset reference, duplicated per
  reference. Accepted deliberately (§12).
- **Upload disk without a rule** (§4). An authenticated principal can stage
  bytes that no mutation ever references. The sweep reclaims them; a per-
  principal staging quota is the natural bound, and is a number, not a rule.
- **Finalize concurrency** is bounded by a worker pool, and a single large
  upload must not delay unrelated commits — the measured property, and the
  regression test, that §9 exists for.

## 15. Implementation shape

`rules/RULES.md`: a spec needs an implementer and a date. Proposed, subject to
the author's scheduling:

| lane | scope |
|---|---|
| A | `_assets` ledger, the asset column type, `valid_column_value` arm, the write-time stamp (§6), the sweep (§9) — `snapback2-core` |
| B | upload + delivery routes, streaming staging, the finalize worker on the outbox lifecycle, both renditions — `snapback2` |
| C | `t.image()` in the compiler, `image` in Quarry, `api.d.ts` types |
| D | `client.upload`, `AssetImage`, React; one template using it |

Fix loops get three rounds (`rules/RULES.md`). The acceptance that matters is
not a unit suite: per LLP 1005 §6, this slice is not done until a real
multi-megabyte file, a real browser bundle with no relay in front of it, and a
real phone have each been through it — those three found every serious asset bug
in Snapback 1, and none was reachable from a harness.

## Confidence

**0.85** on §2 (delivery by reference site). It follows from the existing rule
evaluation and reproduces the property LLP 1005 measures as the moat with
strictly less machinery. The residual risk is its honest cost — no
row-independent link — mattering more to real apps than I judge.

**0.8** on §1 and §6 (stamp at write time). The mechanism is sound and the
immutability argument closes cleanly; the risk is that denormalized facts turn
out to want updating for a reason this design does not anticipate, at which
point the stamp is the wrong shape and §12's rejected alternative is right.

**0.8** on §3's claim that a list column replaces `assetCollection` for the apps
we have. Clique and Coterie need ordered post media and do not need reorder; an
app that needs reorder is not served.

**0.7** on dropping the named intent declaration (§12, OQ2). It is the change
most directly in tension with the v1 diaries.

**0.6** on §4's always-strip ruling and §8's two-rendition choice. Both are
defensible defaults rather than derived results.

**0.5** on §14's binary-size cost being acceptable. That is the author's call.

## Open questions (author)

1. **Video in slice 1 or slice 2?** §13 recommends slice 2 and gives the
   reason. Slice 1 means no video for Clique's brief.
2. **Is the named intent declaration worth keeping after all?** §12 argues the
   diaries praised co-located policy rather than the name, and that putting
   policy on the column preserves it. This is the one deletion most likely to be
   wrong.
3. **Is an image/HEIC decoder acceptable in the published binary?** §14. The
   alternatives are an out-of-process renderer (more machinery, slower) or
   originals only (no thumb, which the feed needs).
4. **Does anything need a row-independent link before promotion?** §2 trades it
   away deliberately. If a benchmark app needs "share this photo by URL," the
   trade must be revisited before the design lands, not after.
