# Panel 2: LLP 1006 revision (i) — the author-side review (Claude Fable 5.1)

**Reviewed:** `llp/1006-assets.rfc.md` revision (i) at `4d67b2a78`
**Family:** Claude (Fable 5.1) — **the session that authored revisions (f)–(i); not an independent reviewer**
**Provider/runtime:** Claude Code, model claude-fable-5-1
**Date:** 2026-09-03
**Redacted:** No.
**Method:** Two rounds, sealed before the corresponding family outputs were opened (see the independence note).

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

# Round 1 (blind) — Claude Fable 5.1, the author-side voice

**Independence disclosure (LLP 0005):** this session authored revisions (f)–(i)
at the author's rulings. It is not an independent reviewer of them. This is
the author-side reading, written before either family's round-1 review was
opened, and it is weighted accordingly in the synthesis.

## 1. Verdict

Revision (i) is implementable as written for lanes C and D, and for lane B2.
It is **not** ready for lanes A and B until three defects are fixed, all of
them in the parts I wrote or re-shaped this week: the claim rule refuses an
ordinary list edit; `reset` as written destroys blobs a fork still references;
and strip-by-detected-type under `file` has an escape the document itself
argues must not exist. None changes the design's shape. Two further items are
tuning numbers the document states too tightly (carrier lifetime, private
caching). One ruling — the two published helper variants — I would ask the
author to narrow.

## 2. Defects

**D1 — The claim rule refuses a list edit (§6, §2a). Severity: high.**
§6 says the server "requires the asset unclaimed and claims it
(`E_ASSET_IN_USE` otherwise)". §2a says claim and release are "transactional
correctness across replacement, list edits, deletion". Those two sentences
disagree: `~posts[id] { photos: [a, b, c] }` where `a` and `b` are already
claimed *by this cell* is refused as written, because `a` and `b` are not
unclaimed. Adding a fourth photo, or reordering, is the most ordinary list
edit there is. **Resolution:** the claim check is "unclaimed, or claimed by
this `(table, row, column)`"; an asset removed from the list in the same write
is released. One clause. The locator has no index (§2a), so reorder is
already free; this makes append and remove free too.

**D2 — `reset` empties the blob directory while `fork` shares it (§9a).
Severity: high, and mine.** §9a says a fork is a snapshot of the store that
*shares* content-addressed blobs, and that the sweep treats fork ledgers as
referrers. Two bullets earlier it says `reset` "empties `.snapback/blobs/`".
Reset on the live store therefore deletes every blob a fork still references,
and restoring the fork serves nothing. **Resolution:** `reset` clears the live
ledger and staging, then runs the ordinary sweep — which already protects
keys referenced by any ledger under `.snapback/` — rather than emptying the
directory. Same guarantee against v1's orphan bug (a key in no ledger is
garbage), no fork breakage.

**D3 — Strip under `file` has an escape the document forbids (§4).
Severity: medium, and mine.** §4's strip-by-detected-type bullet says what
the walker "cannot prove location-free it refuses under `video` and stores
byte for byte under `file`", and that HEIC under `file` "is the one strippable
format that escapes". Read against the bullet above it — "no declaration, no
escape hatch" — that is two escape hatches: exactly the MOV the walker is
unsure about, and exactly the HEIC an iPhone produces, both leak location the
moment an author uses an attachments column for photos and clips, which is
the case the bullet was written for. **Resolution:** one rule, "strip or
refuse, by detected type, in every column": a format Snapback claims to strip
is stripped or refused wherever it lands; a format it makes no claim about is
stored byte for byte. HEIC under `file` is refused with a hint naming `image`
(it is decoded there anyway), until an in-process HEIF `Exif`-item blank
exists, which is a chunk walk, not a decode. This deletes the "one format that
escapes" sentence and the `video`-vs-`file` asymmetry.

**D4 — Portrait video dimensions (§9, lane B2). Severity: medium, verify.**
§9 says the walker "reads display `width`, `height`, and `duration` from
`tkhd` and `mvhd`". A portrait iPhone MOV stores a landscape sample size with
a rotation matrix in `tkhd`; if the port reports the sample size, every
portrait clip's record is transposed and `<AssetVideo>` sizes its box wrong —
the Diary 0087 collapse class in a new place. I did not verify whether
`assets_video.rs` applies the matrix. **Resolution:** lane B2's acceptance
names a portrait MOV and asserts the record matches the displayed
orientation.

**D5 — Carrier lifetime is stated too tightly (§2b). Severity: low.**
"Expires within minutes" breaks a PDF viewer or a scrubbed video that issues a
fresh `Range` request after expiry, because the element's URL still carries
the old token and the SDK cannot rewrite a URL a native element already
holds. **Resolution:** say "short-lived, on the order of an hour, refreshed by
the SDK well before expiry"; the number is the implementer's.

## 3. Recommended changes, ranked

1. **Fix D1** (§6): one clause on the claim rule. Deletes a refusal that would
   have fired on the bar's most ordinary edit.
2. **Fix D2** (§9a): `reset` = clear ledger + sweep. Deletes the contradiction
   between two adjacent bullets.
3. **Fix D3** (§4): strip-or-refuse everywhere. Deletes two named escapes and
   the `video`/`file` asymmetry.
4. **Private delivery is `Cache-Control: private, immutable`, not `no-store`**
   (§2). The asset id is in the path and bytes are immutable, so staleness is
   impossible; the only thing `no-store` buys is not caching bytes the viewer
   already has, which §2 concedes cannot be recalled anyway. With the carrier
   in the query string, `no-store` makes every scroll of a private feed a
   re-download. Deletes the fetch-to-blob path's last reason to exist for
   images.
5. **A global staging cap beside the per-principal one** (§14). `/api/auth/guest`
   mints principals for free, so a per-principal cap bounds nothing. A number,
   not a rule; it deletes a disk-exhaustion path on any public dev URL.
6. **An upload worker class with its own small bound** (§14, lane B).
   `serve.rs` pools JSON/SSE/control workers; four 12 MB uploads waiting
   through finalize would sit in the JSON pool. Naming the class deletes a
   way for uploads to starve queries.
7. **Lane B2 acceptance names a portrait MOV** (D4).
8. **Split lane B** into routes/streaming/carrier and the blob-store trait;
   the row is now the longest in the table and two implementers can take it.

## 4. Cut list

- **The published slim variant** (§14a, ruling 10). See §7. Keep the
  build-time choice, which already delivers the developer-loop benefit; cut
  the second published artifact until a size measurement asks for it.
- **"HEIC is the one strippable format that escapes"** and the
  `video`-refuses/`file`-stores asymmetry (§4) — replaced by D3's single rule.
- **The `system` uploader escape in §6** stays only because §13 now names
  what would use it; if the effect-minted-asset non-goal is ever dropped, the
  escape goes with it.

## 5. Add list

- **The global staging cap** (above). Pays for itself.
- **A `Content-Type` allow-behaviour line for `file`**: unknown bytes are
  `application/octet-stream`, always attachment, never sniffed — already
  implied by §2; worth one explicit sentence so nobody adds a sniffing
  "improvement".

Nothing else. The bar's apps are buildable with (i) plus the fixes above.

## 6. Most likely to be wrong

**The session carrier as the *only* private-media path on the web** (§2b).
It is the smallest thing that plays a private `<video>`, and I still think it
is right, but it puts a per-viewer token in every private image URL, which
(a) defeats shared caches by design and (b) makes "copy image address" hand a
minutes-long credential to whoever receives it. **Trigger:** the first diary
that says private feed images feel slow, or the first report of a pasted
private URL working for a stranger. The reopen is not signed URLs; it is
whether `<AssetImage>` should keep the header-plus-blob path for images and
reserve the carrier for elements that cannot send headers.

## 7. Rulings I would ask the author to revisit

**Ruling 10, the published slim variant — narrow it.** The ruling's purpose,
"so that size is taken care of", is met by the build-time feature for
snapback2 developers and by the engine binary carrying no codec at all. The
second *published* variant is a packaging matrix (two helpers × every
platform), a support question ("which do I have?"), a per-format refusal path,
and a publish-time rule — apparatus with no named user, which `rules/RULES.md`
says agents add none of. Recommend: one published variant (full), the build
flag retained, and `publish.mjs`'s size report as the trigger that brings a
slim package back if the HEIC decoders measure badly. This narrows ruling 10;
it does not reverse it, and it deletes more than it adds.

No other ruling needs reopening on the evidence I have.

## Round 2 (cross-read)

# Round 2 (cross-read) — Claude Fable 5.1, the author-side voice

Written after reading both families' round-1 reviews and before reading their
round-2 answers. Three positions changed; each says what convinced me.

## 1. Disagreements

**D-A — `file` in slice 1. Change: defer to a named slice 2.** I held "keep per
the ruling" in round 1. What convinced me is not the brief alone but the cost
ledger the two reviews assembled: `file` is the sole reason for `as`, `name`,
a third record, attachment/nosniff delivery, strip-by-type inside a column,
the HEIC-under-file escape, and the arbitrary-bytes-from-our-origin surface.
The design is now fully recorded in the RFC, so deferring costs nothing in
design and removes roughly a fifth of lanes B, C, and D before the capability
bar. The recommendation to the author is a deferral, not a reversal: the
ruling stands as product intent, the slice moves.

**D-B — HEIC in the default helper. Hold.** The ruling was made to prevent the
v1 bug that is still open: a phone hands over HEIC and the platform stores or
refuses something unservable. A default helper without HEIC reproduces that
bug on the first real iPhone in §15's acceptance. The C toolchain cost is paid
once by the publisher, not per install. Codex's "delete HEIC" and grok's
"HEIC as an extra" both make the ordinary phone the exceptional case.

**D-C — Published variants. Hold: one published helper, full; build flag
retained.** Two published variants is a packaging matrix and a support
question with no named user. If `publish.mjs` measures the HEIC decoders as
material, a slim package is the follow-up, not the default.

**D-D — Blob keys. Change: asset-id keys, not content addresses.** Codex's
argument is decisive: write the `receiving` ledger row first, then the blob
under the asset id, then flip to `ready`, and every blob key is known to the
ledger before the blob exists — a crash can never orphan a key the sweep
cannot see. Content addressing cannot know the key until the stored bytes are
hashed, so it needs listing to find orphans, plus a derived reference count.
Fork-sharing does not need content addressing; it needs immutable keys, which
asset ids are. The one thing lost is dedupe of identical uploads, which the
bar's apps never exercise.

**D-E — Carrier scope and image delivery. Change to the combined shape.**
Images fetch with the bearer or persona header (revision (c)'s path; RN's
`Image` takes headers) and private responses are `Cache-Control: private,
immutable`, so the HTTP cache serves repeats even through the fetch path —
the id is in the URL and the bytes never change. The carrier is minted for a
bearer *or a persona*, bound to the session epoch or the owner incarnation,
and used only where an element cannot send a header: `<video>`, downloads,
native players. Public rows keep the tokenless URL, and a carrier URL on a
public row redirects to it, so shared caches key on one URL. This deletes
"attach the carrier whenever authenticated" and the fetch-to-blob path's
performance objection at once.

**D-F — Image strip mechanism. Change: decode → orient → re-encode in the
helper, v1's path.** My lossless alternative (keep only the orientation tag)
is elegant but adds a second image path — an in-process chunk walker beside
the helper — and inherits every consumer that ignores the tag. Routing every
image through the helper makes one path, deletes the walker for JPEG, PNG,
and WebP, and is where the orientation and safety ceiling already have to
live. The cost is a quality generation and CPU per upload, both in a process
that is not the engine. "The uploader's pixels exactly" goes; "the uploader's
image, oriented and stripped" replaces it.

**D-G — Fixed decode-safety ceiling. Agree.** A memory cap is a ceiling that
fails by OOM at an unknown size; a stated pixel and dimension bound fails by
a typed refusal at a known one. Not author-facing; it narrows nothing in
ruling 6 that an author can see.

**D-H — The `system` escape. Change: delete.** §13 records the shape that
would need it, and that record is enough to bring it back with the effect
`put` call. Both original panelists wanted it gone; I kept it for a user
that does not exist yet.

**D-I — What the helper is. Agree with codex.** Same-UID child, can open the
store file. Say "crash, hang, and memory isolation with a cleared environment
and process-group termination", and name an OS sandbox (seatbelt on macOS,
seccomp plus namespaces on Linux) as the follow-up that turns it into a
boundary. Do not claim the boundary in slice 1.

**D-J — Forgeable asset arguments. Agree, no dissent.** Ledger-validate every
asset-typed argument at mutation entry, inside the transaction, before the
body runs. The write-time check then adds only the column bound and the
claim. One validation site instead of two, and `require clip.duration` reads
a fact.

**D-K — Delivery primitive and the 302. Agree on both.** One core primitive:
ledger → locator → point read → cell check → certified rule evaluation, in one
read transaction, exposed through the owner's action channel. Delete the
presigned redirect from slice-1 prose: after a redirect the bucket serves
ranges without the rule, so "every request evaluates the rule" would be false
for the token's lifetime. Record hosted delivery as a decision that waits for
the hosted target.

**D-L — The trim rule. Recommend: trim `file`, keep HEIC and MOV, amend
NOT-DOING.** Consistent with D-A and D-B. NOT-DOING's own rule applies: one
line naming what the widening unblocks — "phones produce HEIC and MOV; the
bar's real-device acceptance cannot pass without them."

## 2. Final recommended changes, ranked

1. Ledger-validate asset-typed arguments at mutation entry — deletes the forged-fact path and the second validation site.
2. Add the certified delivery primitive; delete the presigned 302 — deletes the table-scan fallback and the false "no new machinery".
3. One asset-lifecycle reconciler for insert, replace, delete, and schema successors; refuse asset types in `maintain.by` and in seeds; the claim rule allows the same cell — deletes stranded locators and the list-edit refusal.
4. `reset` = clear ledger and staging, then the fork-aware sweep; blobs keyed by asset id with the ledger row written first — deletes the fork-breaking `rm -rf`, hashing, and orphan listing.
5. Image admission = decode, orient, re-encode in the helper, with a fixed pixel and dimension ceiling — deletes the in-process image walker and the sideways-avatar bug.
6. Walker port blanks the staging file in place, applies the `tkhd` matrix, refuses missing facts — deletes the `Vec` copy and the transposed portrait record.
7. Carrier for bearer or persona, epoch-bound, video and downloads only; images by header with `private, immutable`; public rows tokenless with redirect — deletes carrier-on-every-URL and the fetch-path slowness.
8. Defer `file` to a named slice 2 — deletes `as`, `name`, the third record, attachment delivery, and strip-inside-columns from slice 1 (author's call; the design stays recorded).
9. One published helper, full, with HEIC; keep the build flag — deletes the variant matrix and the per-format refusal.
10. Describe the helper as crash and memory isolation; sandbox as a follow-up; amend LLP 1002 decision 1 — deletes an unearned security claim.
11. Lane D from the manifest, not `.d.ts`; Expo URI source; list-aware URL resolver; `MutationRejected` wording — deletes the runtime-types fiction.
12. Upload and asset worker class before the JSON reader; exact Range statuses; delete the `system` escape; clear the residue — deletes query starvation and three stale sentences.

## 3. What I would steal

From codex: the entry-time ledger validation of asset arguments (D-J), the
delivery-primitive finding (D-K), asset-id blob keys (D-D), the successor and
`maintain` lifecycle holes, and the observation that runtime `Op` objects
carry no types so substitution must be manifest-driven. From grok: the
persona carrier (D-3), the orientation defect stated first and plainest, the
LLP 1002 "nothing else is ever spawned" collision, and the residue list.

## 4. Verdict after the changes

Implementable. Items 1 through 7 are correctness and must land in the text
before lanes A and B start; 8 and 9 are the author's calls with the panel's
recommendation attached; 10 through 12 are honesty and inventory. None
reopens the center the previous panel settled.
