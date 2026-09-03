# Panel 2 synthesis: LLP 1006 revision (i) — what three reviewers decided

**Reviewed:** `llp/1006-assets.rfc.md` revision (i) at `4d67b2a78`, specifically
the four unreviewed revisions (f)–(i) of 2026-09-03.
**Panel:** codex gpt-5.6-sol (`ultra`), grok-4.6 (`xhigh`), and the
orchestrating Claude session (Fable 5.1), which authored (f)–(i) and is
disclosed as the author-side voice rather than an independent family.
**Date:** 2026-09-03
**Method:** Round 1 mutually blind on one brief; round 2 cross-read with all
three round-1 reviews, twelve settled agreements, and twelve numbered
disagreements. Full records: `1006-assets.panel.codex.md`,
`1006-assets.panel.grok.md`, `1006-assets.panel.claude.md` (dated Panel 2
sections). Every engine claim below was verified against the tree by the
orchestrator before it was written here.
**Standing:** this document proposes; it changes nothing in LLP 1006 and sets no
status. The author decides.

## 1. Verdict

All three reviewers: **revision (i) is not ready to implement as written, and
is ready after the changes in §3.** The center that the first panel settled
holds without dissent — an asset is a column type with one closed record,
validated rather than stamped; bytes are authorized by the owning row's read
rule; affine ownership; any width, snapped; full-resolution originals; the
v1 walker ported; decode in a subprocess; share links and resume deferred.
Nothing below reopens any of that.

What the panel found in (f)–(i) is of three kinds: **five correctness defects**
against the engine as it exists, **a scope conflict** between the author's
rulings and the binding trim in `rules/NOT-DOING.md`, and a set of **honesty
and inventory** corrections. The defects are spec edits, not a new design.

## 2. Unanimous findings

Each of these was raised by at least one reviewer and accepted by the other two
after the cross-read.

1. **Asset-typed arguments are forgeable before the write** (codex). Argument
   validation is shape-only and runs before the transaction opens; the ledger
   check runs only when a column is written. So `require clip.duration <= 60000`
   reads whatever the caller sent, and a mutation can act on a forged fact
   without ever storing the asset. *Fix:* ledger-validate every asset-typed
   argument, recursively through optionals and lists, after the transaction
   opens and before the body runs. The write-time check then adds only the
   column bound and the claim. One validation site instead of two.

2. **The certified delivery point-read does not exist** (codex). The runtime's
   reusable rule probe scans every row of the table; indexed read plus
   certified rule evaluation lives only inside the program runner. §2's "one
   point read, no new machinery" is not true today. *Fix:* one new core
   primitive — ledger → locator → point read → cell-contains-id check → read
   rule under the stored certificate, in one read transaction, through the
   owner's action channel. *Consequence:* delete the hosted presigned `302`,
   because after a redirect the bucket serves `Range` requests without the
   rule; hosted private bytes stream through the same `GET`. Scope
   "revocation is exact and immediate" to requests that reach Snapback.

3. **`reset` destroys blobs a fork shares** (all three, independently). §9a says
   forks share content-addressed blobs and the sweep protects fork ledgers;
   two bullets later `reset` empties the blob directory. *Fix:* `reset` clears
   the live ledger and staging, then runs the ordinary fork-aware sweep.

4. **Stripping alone renders phone JPEGs sideways** (grok, codex). Nearly every
   iPhone JPEG carries EXIF orientation 6. Chunk-stripping the EXIF and keeping
   the pixels drops the tag, so the avatar renders rotated and the record's
   `width`/`height` are sensor pixels, not the "display pixels" §1 promises.
   Snapback 1 decoded, oriented, and re-encoded on purpose. *Fix:* orientation
   is handled at admission (mechanism is a split — §4, S6). The record's
   dimensions are post-orientation in either case.

5. **The walker port copies 50 MB and can mint a record the twin cannot hold**
   (grok, codex, Claude). `canonicalize_strip_video` takes `&[u8]` and returns a
   `Vec` — LLP 1005 §9's `read → Vec → put` debt, verbatim. Its facts are
   `Option`, while `VideoAsset` is closed. Its `tkhd` handling ignores the
   transform matrix, so portrait clips report landscape dimensions. *Fix:*
   blank in place on the staging file; refuse finalize when duration or
   display size is missing; apply the matrix.

6. **Affine lifecycle has holes** (Claude, codex). The claim rule as written
   ("unclaimed, else `E_ASSET_IN_USE`") refuses every list append and reorder,
   because the existing photos are already claimed by the same cell. Schema
   successors that drop a table or column strand locators. `maintain`
   projections copy a grouping value into another row, which would violate
   one-home silently. Seeds have no way to mint a ledger row. *Fix:* one
   old-row/new-row asset-set reconciler for insert, replace, delete, and
   successor operations, with same-cell carry-forward allowed; refuse asset
   types in `maintain.by` and in seed values.

7. **The session carrier is specified against the wrong identity and the wrong
   URLs** (grok, codex). The loop's ordinary identity is a persona
   (`--as`, `snapback2 test`), carried in a header a `<video>` element cannot
   send; the carrier is defined only for bearer sessions, so no private clip
   plays in a persona journey. And "attach the carrier whenever the client is
   authenticated" makes every signed-in user's public avatar a per-viewer,
   minutes-lived cache key, which kills the `public, immutable` path §9a sells.
   *Fix:* mint from `Identity` (persona or bearer), bound to the exact session
   epoch or owner incarnation; attach it only where a header is impossible —
   `<video>`, native players, downloads; images fetch with the header;
   public rows keep the tokenless URL, and a carrier URL that lands on a public
   row redirects to it; never rotate a mounted player's `src`; carrier
   responses are never `public`.

8. **HTTP and pool contracts** (all three). Upload must branch before the
   1 MiB UTF-8 JSON body reader and get its own bounded worker class, or four
   parallel uploads sit in the JSON pool; a plain GET is `200`, one satisfiable
   range is `206`, otherwise `416`, reusing v1's parser; the per-principal
   staging cap needs a global cap beside it because `/api/auth/guest` mints
   principals for free.

9. **The helper is resource isolation, not a security boundary** (codex). A
   same-UID child can open `.snapback/store.sqlite`; "no store handle" is a
   convention until an OS sandbox enforces it. *Fix:* describe it as crash,
   hang, and memory containment with a cleared environment, bounded output,
   and process-group termination; name a sandbox as the follow-up; and amend
   LLP 1002 decision 1, which says "Nothing else is ever spawned."

10. **A fixed internal decode-safety ceiling** (codex; all agree). The helper's
    memory cap is already a ceiling that fails by OOM at an unknown size.
    Port v1's stated bounds (pixels, dimensions, decompression ratio, output
    bytes) and refuse with a typed code. Not author-facing; ruling 6 is
    narrowed, not reversed. Also: effective `?w=` is `min(requested, source
    width)`; never upscale.

11. **Delete the `created_by = system` escape** until effects can mint an
    asset. A grant whose issuer does not exist is a hole, not a placeholder;
    §13's recorded shape is enough to bring it back with the effect `put`.

12. **Lane D as it would actually be built** (codex). Runtime `Op` objects
    carry only their name — type parameters are erased — so `File`
    substitution cannot be driven from `.d.ts`; it must come from the
    manifest, which already carries descriptors. The brief's picker yields a
    native URI, not a browser `File`, so an Expo streaming source is required.
    `useAssetUrl` must resolve lists. Mutations resolve `MutationRejected`;
    they do not throw, and §10 says they do.

13. **Rungs are lazy in slice 1**, rendered on first `?w=`. Eager rendering
    puts resize work on the upload clock that `run({ photos: files })` blocks
    on, and §8 already says lazy is a server-only switch.

14. **Residue** to scrub: §6 "Under option A"; §12's surviving "the optional
    `max` covers…" sentence; the `use assets` refusal at `parser.ts:87` beside
    the `asset` refusal lane C names; the `engine/index.rs:320` citation,
    which is not `valid_column_value`.

## 3. Recommended changes to the plan, ranked

The three final lists were merged; where they differed in order, correctness
outranks scope, and scope outranks inventory.

1. Ledger-validate asset-typed arguments at mutation entry, inside the
   transaction. *Deletes* the forged-fact path and the second validation site.
2. Add the certified delivery primitive; delete the presigned `302`. *Deletes*
   the table-scan fallback and §2's false "no new machinery".
3. One asset-lifecycle reconciler (insert, replace, delete, successor) with
   same-cell carry-forward; refuse asset types in `maintain.by` and seeds.
   *Deletes* stranded locators and the list-edit refusal.
4. `reset` = clear ledger and staging, then the fork-aware sweep. *Deletes* the
   fork-breaking directory wipe.
5. Handle orientation at admission with a stated pixel/dimension ceiling
   (mechanism per S6). *Deletes* the sideways avatar and OOM-as-policy.
6. Walker port blanks the staging file in place, applies the `tkhd` matrix,
   refuses missing facts. *Deletes* the `Vec` copy and transposed portraits.
7. Carrier for persona or bearer, epoch-bound, video and downloads only;
   images by header; public rows tokenless with redirect. *Deletes*
   carrier-on-every-URL and the persona playback gap.
8. **Defer `file` to a named slice 2** (unanimous after cross-read; ruling 5's
   non-media half). *Deletes* `as`, `name`, the third record, attachment
   delivery, strip-inside-columns, and the HEIC-under-file escape from
   slice 1. The design stays recorded in the RFC, so the addition is
   mechanical when an app needs it.
9. **One published helper** (unanimous; ruling 10). Whether it carries HEIC is
   S2. *Deletes* the variant matrix and the per-format refusal path.
10. Describe the helper as resource isolation; sandbox as follow-up; amend
    LLP 1002 decision 1. *Deletes* an unearned security claim and a spec
    contradiction.
11. Lane D from the manifest; Expo URI source; list-aware URL resolver;
    `MutationRejected` wording. *Deletes* the runtime-types fiction.
12. Upload branches before the JSON reader with its own worker class; exact
    Range statuses; global staging cap; lazy rungs; delete the `system`
    escape; scrub residue. *Deletes* pool starvation, guest-multiplied disk
    exhaustion, and three stale sentences.

## 4. Where the panel split, with the recommendation

**S1 — `file` in slice 1.** Split in round 1 (Claude held the ruling); unanimous
in round 2 to defer. Claude changed on the cost ledger: `file` is the sole
reason for `as`, `name`, a third record, attachment delivery, and
strip-by-type inside a column. Honest cost of deferring: the first app with an
attachment waits one slice. Honest cost of keeping: roughly a fifth of lanes
B, C, and D before the capability bar, and the D3 strip-or-refuse rule
becomes mandatory.

**S2 — HEIC in slice 1.** **Two to one to defer** (codex, grok) against keep
(Claude). The two families' reasoning: HEIC is outside the brief's formats, is
the only C toolchain in the design, is the entire reason ruling 10's package
matrix existed, and was never reconciled with `NOT-DOING.md`. A raw HEIC
upload would refuse with a conversion hint; the Expo picker can request JPEG.
Claude's dissent: the ruling was made to prevent the v1 bug that is still
open — a phone hands over HEIC and the platform stores or refuses something
unservable — and Diary 0087 records pickers handing back HEIC even in
compatible mode; the toolchain cost is paid once by the publisher, not per
install. **Trigger to reopen, agreed by all three:** the first real-phone
acceptance run in which the picker delivers HEIC. Either way the author
decides; see S7.

**S3 — Blob keys.** Both families swapped in round 2. Grok and Claude moved to
**asset-id keys**: write the `receiving` ledger row first, then the blob under
the id, then `ready`, so every key is known to the ledger before the blob
exists and a crash can never orphan an unlisted key; fork-sharing needs
immutable keys, not content addresses. Codex moved to **content addressing**
because a fork copies the id namespace and high-water mark, so a restored fork
could re-mint an id that already names a blob. The orchestrator verified the
allocator: ids are `s2id-<namespace>-<sequence>` with a 32-character per-store
namespace held in the database, and no restore verb exists today.
**Recommendation: asset-id keys, plus one invariant — any operation that opens
a fork as a writable store rotates the id namespace.** That neutralizes the
collision with one line and keeps the crash-safety argument. Codex's
alternative (content addressing with the digest recorded on the `receiving`
row before publish) is the fallback if a shared-namespace restore ever ships.

**S4 — Private image caching.** Grok and Claude: `Cache-Control: private,
immutable` (the id is in the path, bytes never change, `no-store` re-downloads
a feed on every scroll). Codex: `private, immutable` lets a revoked viewer's
own browser cache keep serving, which is "revocation is exact" made false on
that device; use `private, no-cache` with an ETag and authorize before any
`304`. **Recommendation: codex's.** One conditional round trip per render, no
bytes, and the guarantee holds. Carrier responses stay `no-store`.

**S5 — Carrier scope.** Unanimous after cross-read (finding 7). No split
remains.

**S6 — Orientation mechanism.** Both families swapped. Grok and Claude moved to
**decode → orient → re-encode in the helper** for every image: one image path,
pixels equal the record, no consumer has to honor a tag, v1's proven route.
Codex moved to **orientation-only chunk surgery**: strip everything, synthesize
a fresh orientation-only tag, compute dimensions post-orientation, bake the
transform when rungs decode; preserves the compressed pixels and color, and
removes decode plus encode from the upload clock the paved call blocks on.
**Recommendation: chunk surgery with the orientation tag, gated by an
acceptance matrix** — orientations 2 through 8 rendered correctly on web,
iOS, and Android — with re-encode as the fallback if the matrix fails. The
deciding factor under this document's ranking is speed on the paved path: a
12 MP decode and encode per photo, four photos per post, is seconds the
author's `run()` waits on. Modern browsers, iOS, and Fresco on Android honor
the tag.

**S7 — The trim rule.** Unanimous that two binding documents now disagree:
`rules/NOT-DOING.md` and LLP 1007 §4a say LLP 1006 is trimmed to the brief's
formats when the capability bar starts; rulings 5 and 7 widen past them
without the one line `NOT-DOING.md` requires for moving something off itself.
Two of three recommend trimming the RFC to `image` and `video` with JPEG, PNG,
WebP, MP4 H.264/AAC. All three agree that **if the author holds `file` or
HEIC, `NOT-DOING.md` must be amended in the same change** with a line naming
what each unblocks (attachment columns; iPhone-camera HEIC on the server).
Do not leave the conflict standing.

## 5. Rulings the panel asks the author to revisit

| Ruling | Ask | Panel |
|---|---|---|
| 5, non-media half (`file`) | defer to a named slice 2 | unanimous |
| 7 (HEIC in slice 1) | defer; reopen on the first real-phone HEIC | 2–1 |
| 10 (published variants) | one published helper | unanimous |
| 6 (no `max`) | keep; add a fixed *internal* decode-safety ceiling | unanimous, narrow |
| 8 (storage) | keep local-now/bucket-later; delete the presigned `302`; asset-id keys with namespace rotation | unanimous on the `302`; keys per S3 |
| 9 (subprocess) | hold; amend LLP 1002; call it resource isolation | unanimous |

Not reopened by anyone: 1 (affine), 2 (any width), 3 (full-resolution
originals), 4 (share links deferred), validate-not-stamp, no resume in
slice 1, video in slice 1.

## 6. Process notes

- Two disagreements swapped sides between rounds (S3, S6). Both are recorded
  with the fact that decides them rather than the vote.
- Codex's round-2 output notes it could not append to the repository record
  because its checkout was read-only; the orchestrator appended all records.
- The orchestrator's changes of mind (S1, S3, and the caching and
  orientation positions) are in `1006-assets.panel.claude.md` with what
  convinced it. Its votes are weighted as the author-side voice.
- Three things the families took from the author-side review: the same-cell
  claim exception, the global staging cap, and private caching over
  `no-store` (which codex then improved to `no-cache` plus ETag).

## 7. Proposed next step

Revise LLP 1006 to a revision (j) that folds §3 items 1–7 and 10–12 as
correctness and inventory, records the author's decisions on S1, S2, S3, S4,
S6, and S7, and amends `rules/NOT-DOING.md` and LLP 1002 decision 1 in the same
landing. Stay `Draft`; then assign an implementer and a date. No further
panel round is needed unless the author reverses a unanimous finding.
