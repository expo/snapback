# LLP 0304: Declared video codec configuration and sample-timeline admission

**Type:** Spec
**Status:** Review
**Systems:** Assets, Security, Code generation, Storage, Deployment, Testing
**Author:** Codex, commissioned by Charlie Cheever for the 2026-08-24 design-revision round
**Date:** 2026-08-24
**Revised:** 2026-08-24 (v0.1 — initial Review revision after convergent hostile design reviews; design only, implementation and capability claims remain open)
**Related:** LLP 0000, LLP 0012, LLP 0037, LLP 0044, LLP 0189, LLP 0225, LLP 0269, LLP 0276, LLP 0277, Diary 0086, `issues/20260817-upload-intent-codec-duration-admission-facts.md`

## Summary and authority

This Spec defines the proposed v1 upload-intent policy for ISO BMFF video
container classification, declared AVC/AAC decoder configuration, same-file
sample layout, and presentation-duration admission. It is deliberately
**Review**, not Accepted or Implemented. No target may claim the capability
described here merely because this design exists.

LLP 0044 remains the asset-pipeline authority: generated upload policy,
restricted staging, trusted finalization, canonicalization, frozen intent
generations, opaque prepared carriers, publication, and receipts keep their
0044 meanings. This document is the dedicated admission grammar and parser
contract under that authority. LLP 0269 owns only the obligation that this
same contract and outcome survive SQLite → Postgres → transactional-cell
graduation; it does not own the parser semantics.

The trust claim is intentionally narrower than “the uploaded bytes are
H.264/AAC.” V1 proves all of the following over the complete canonical ISO BMFF
object:

- a container classification from the closed brand table below;
- coherent, same-file sample tables whose referenced chunk/sample extents lie
  within `mdat` payloads in that object, including at least one presentable
  in-file video sample;
- ISO BMFF sample-entry and decoder-configuration declarations for H.264 and,
  when audio is present, AAC; and
- a bounded sample/edit-timeline duration cross-checked against the matching
  media, track, and movie headers.

V1 does **not** decode elementary `mdat` access units and therefore does not
prove elementary-stream identity or conformance. A valid `avc1` + `avcC`
description can still point at non-H.264 payload bytes; the corresponding
`mp4a` limitation is the same. Stored facts and capability text must say
**declared codec configuration**, never “the bytes are H.264/AAC,”
“byte-authoritative codec,” or an equivalent stronger claim. Diary 0086's
current broad honesty caveat may retire only for the declared container/codec-
configuration and sample-timeline facts after the acceptance rerun. Full
bounded NAL-unit and AAC access-unit/ASC-to-payload validation is an explicit
future graduation question, not an implied property of v1.

## Authoring contract

The upload intent's existing `accept` object gains one optional closed `video`
member. Coterie's intended declaration is:

```ts
export const postVideoUpload = defineAssetUpload({
  args: {},
  auth: "authenticated",
  accept: {
    mediaTypes: ["video/mp4"],
    maxBytes: 50_000_000,
    video: {
      containers: ["mp4"],
      videoCodecs: ["h264"],
      audioCodecs: ["aac"],
      maxDurationMs: 60_000,
    },
  },
  delivery: { kind: "public-immutable" },
  access: { read: "via-references" },
  video: { location: "strip" },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
})
```

The sibling spellings remain intentional. `accept.video` is admission policy
over the facts scoped above. Top-level `video.location` remains LLP 0044's
canonicalization/privacy policy. Neither block absorbs the other.

`accept.video` is all-or-nothing in v1:

- `containers`, `videoCodecs`, and `audioCodecs` are non-empty, duplicate-free
  allowlists;
- `maxDurationMs` is a positive JavaScript-safe integer;
- declaration order is non-semantic and codegen sorts the sets in policy
  identity;
- the closed container vocabulary is `mp4 | quicktime`;
- the closed video-codec vocabulary is `h264`; and
- the closed audio-codec vocabulary is `aac`.

An audio track is optional; `audioCodecs: ["aac"]` means “every audio track is
declared AAC if audio exists,” not “audio is required.” At least one `vide`
handler with at least one presentable same-file sample is required. `auxv` is a
video-class handler for validation and allowlist purposes, but an `auxv`-only
file does not satisfy the required primary-video rule.

`mediaTypes` and `maxBytes` retain their current meaning and precedence. With
`accept.video` present, codegen requires at least one of `video/mp4` or
`video/quicktime` and refuses **every** `video/*` entry outside that closed set;
an intent cannot quietly admit WebM or another video branch on which the block
would not run. Non-video media types may coexist and keep their existing
branch behavior.

The optional member is presence-only in the canonical artifact. When absent,
the emitted manifest and `snapback.asset-intent-policy.v1` preimage remain
byte-identical; existing hashes, generations, behavior, capability
requirements, and legacy media facts do not move. When present, the normalized
block and the parser-semantics version participate in `intentPolicyHash`,
implementation identity, retained generation artifacts, AssetRef semantic
identity, and required-capability derivation. Existing open attempts retain
LLP 0044's frozen-generation/revocation behavior.

The Rust-owned policy carrier remains the source of truth under LLP 0037. No
attempt-create or finalize request gains caller-supplied container, codec, data
reference, sample, or duration evidence. Client preview checks remain advisory
and can neither satisfy nor widen admission.

## Trusted finalization and fact scope

Admission runs at LLP 0044's trusted prepare boundary after restricted staging
is complete and exact length, transport integrity, and magic-byte media type
have passed, but before any blob or rendition is planned or published. The
strip path inspects the in-place rewritten canonical object; because the
current strip operation preserves every box size and chunk offset, the same
layout checks apply to strip and retain. The prepared result is bound to the
resulting canonical digest.

The bounded parser extends the in-process ISO BMFF walker. Production does not
trust filenames, extensions, HTTP `Content-Type`, client media APIs, client
metadata, or an ambient version-variable `ffprobe`. It parses one complete
object and produces this logically closed carrier:

```text
VideoAdmissionFactsV1 {
  parserSemanticsVersion,
  canonicalDigest,
  container,
  declaredVideoCodecs,
  declaredAudioCodecs,
  presentationDurationNumerator,
  presentationDurationDenominator,
  durationMsRoundedUp,
}
```

The exact rational fields are internal prepared facts used for comparison and
revalidation; public safe facts may expose the upward-rounded milliseconds.
`declaredVideoCodecs` and `declaredAudioCodecs` are deliberately named so a
consumer cannot confuse sample-entry configuration with decoded payload
identity.

The parser requires exactly one top-level `ftyp`, one top-level `moov`, and one
`mvhd`. Duplicate or structurally contradictory forms yield
`SNAPBACK_ASSET_VIDEO_FACTS_UNAVAILABLE`; malformed box encoding retains
`SNAPBACK_ASSET_VIDEO_PARSE_FAILED`.

### Fragment syntax is unsupported

V1 syntactically refuses the **presence anywhere** of `moof`, `traf`, or
`mvex` as `SNAPBACK_ASSET_VIDEO_FACTS_UNAVAILABLE`. This includes a hybrid
file with a complete-looking short `moov` followed by longer `moof` media. The
parser does not decide whether a fragment is “required”: its walker must
observe these box types explicitly before the catch-all skip arm, including a
maliciously misplaced `traf`; it cannot inherit the current `_ => Ok(())`
behavior. The capability fact is exactly `fragmentedTimelines: Unsupported`.

### Closed brand-to-container table

The v1 table is closed. Compatible-brand membership alone never turns an
otherwise excluded or unknown object into MP4 video.

| Major brand | Allowed compatible brands | Result |
| --- | --- | --- |
| `isom`, `iso2`, `mp41`, `mp42`, `avc1` | zero or more from the same five-brand MP4 family, plus `qt  ` under the dual-brand rule below | `mp4` |
| `qt  ` | `qt  ` and/or the five-brand MP4 family | `quicktime` |
| `heic`, `mif1`, `msf1`, `avif`, or any other still-image/image-sequence brand | none produce a video result, even when `isom` is compatible | facts unavailable |
| any unlisted major or compatible brand | — | facts unavailable |

The named `major-brand-wins-v1` dual-brand outcome applies only to the table's
MP4-family/`qt  ` pairing: `qt  ` major + `isom` compatible is `quicktime`;
`isom` major + `qt  ` compatible is `mp4`. This exception is deterministic
and does not generalize to “any compatible ISO brand means MP4.” A still-image
or image-sequence brand combined with a video-family brand is contradictory
and fails closed. A Motion Photo/still-image wrapper recognized by trusted
magic-byte detection likewise never maps to `mp4` or `quicktime` merely
because it embeds or appends an ISO BMFF payload.

Only a result from this table is compared with `containers`. A valid table
result outside the intent allowlist produces
`SNAPBACK_ASSET_VIDEO_CONTAINER_UNSUPPORTED`; absence of a video-container
fact produces facts-unavailable instead.

### Same-file sample layout

Every audio/video-class track must have a coherent `hdlr` → `stbl` chain and
exactly one supported table form for each required role. V1 parses `dinf/dref`,
`stsd`, `stsc`, `stsz` or `stz2`, and `stco` or `co64` and applies all of the
following before codec or duration policy comparison:

1. Every sample entry has a nonzero data-reference index within that track's
   `dref` table. The referenced entry must be a same-file `url ` entry carrying
   the self-contained flag and no external locator. External `url `, `urn `,
   aliases, or an unrecognized reference form yield facts-unavailable. V1 does
   not fetch or trust external media.
2. Every `stsc` run is ordered, covers the chunk table without a gap or
   overflow, and references an in-range sample-description index. Every sample
   description is structurally and codec-configuration checked, including an
   unused alternate; an alternate cannot become an unexamined future codec or
   external data reference.
3. `stsz`/`stz2` supplies exactly the sample count consumed by `stsc`; fixed
   size, per-sample size, and compact-size encodings are checked without
   allocating a per-sample object. `stts` and, when present, `ctts` expand to
   that same count. Zero samples, zero-sized presentable video, count mismatch,
   or arithmetic overflow yields facts-unavailable.
4. For every derived chunk, the parser streams the mapped sample sizes, uses
   checked arithmetic, and proves the complete chunk interval lies within one
   `mdat` payload in the canonical object. File-bound-but-outside-`mdat`,
   out-of-range, wrapping, overlapping/contradictory chunk layout, or an
   unaccounted sample yields facts-unavailable.
5. At least one positive-size sample belonging to a `vide` track is present in
   the canonical object's `mdat`. The parser validates extents but does not
   interpret those bytes as NAL units or AAC access units.

Handler/sample-entry mismatches, including a `vide` handler carrying only
audio entries or a `soun` handler carrying only visual entries, yield
facts-unavailable. `auxv` entries are checked as video; non-audio/video
handlers do not satisfy the required track and cannot lengthen an allowlist by
being silently reclassified.

### Declared codec-configuration map

Classification uses the sample entry and its decoder configuration, not
`ftyp` and not the elementary payload:

- A visual sample entry normalizes to declared `h264` only when its entry is
  `avc1` or `avc3`, it contains exactly one structurally valid `avcC`,
  `configurationVersion == 1`, and the bounded configuration contains at least
  one SPS. FourCC alone, a missing/empty `avcC`, no SPS, or malformed parameter
  arrays cannot establish the fact.
- An audio sample entry normalizes to declared `aac` only when its entry is
  `mp4a`, its bounded iterative `esds` graph contains the expected MPEG-4 Audio
  decoder configuration and exactly one parseable AudioSpecificConfig, and the
  decoded Audio Object Type is in the closed set `{1 (AAC Main), 2 (AAC LC),
  5 (SBR/HE-AAC), 29 (PS/HE-AAC v2)}`. Escape-form object types are decoded
  before membership comparison. Object type 64 and every other unlisted value
  are not AAC for v1.
- `encv` and `enca` are unsupported. V1 does not unwrap `sinf/frma` to claim
  the underlying `avc1`, `avc3`, or `mp4a` configuration.
- A structurally valid known-but-unlisted entry, encrypted entry, unlisted AAC
  object type, or extra decoder-configuration box for a different codec yields
  `SNAPBACK_ASSET_VIDEO_CODEC_UNSUPPORTED`. A missing, malformed, duplicated,
  handler-mismatched, or internally contradictory configuration yields
  `SNAPBACK_ASSET_VIDEO_FACTS_UNAVAILABLE` (or `PARSE_FAILED` when the byte
  grammar itself is malformed).

The admitted sets are sorted and de-duplicated for persistence, but policy
comparison examines every track and every sample description. A recognized
unsupported alternate therefore refuses even when no current `stsc` run uses
it.

## Presentation-duration derivation

V1 derives duration from bounded sample-timeline data and uses `mdhd`, `tkhd`,
and `mvhd` only as cross-checks in their own domains. Timescales are never
crossed:

- `stts` deltas, `ctts` composition offsets, `mdhd.duration`, and
  `elst.media_time` use the track's `mdhd.timescale`;
- `tkhd.duration`, `mvhd.duration`, and `elst.segment_duration` use the movie's
  `mvhd.timescale`.

Zero timescales, zero governing durations, a version-specific all-1s
“unspecified” duration, unsupported versions, overflow, or disagreement under
the exact comparisons below yields
`SNAPBACK_ASSET_VIDEO_FACTS_UNAVAILABLE`, never admission as zero and never a
truncation-dependent result.

For each admitted audio/video-class track:

1. Stream the bounded `stts` run-length entries. Counts and deltas must be
   positive, their sample-count sum must equal `stsz`/`stz2`, and their checked
   duration sum `D = Σ(sample_count × sample_delta)` must equal
   `mdhd.duration` in the **media** timescale.
2. If `ctts` is absent, every composition offset is zero. If present, v0
   unsigned and v1 signed offsets are supported; other forms are unavailable.
   Its positive run counts must sum to the same sample count. Stream-merge its
   runs with `stts` without materializing samples. For sample `i`, use checked
   signed arithmetic for `PTS_i = DTS_i + composition_offset_i` and compute
   `U = (max_i(PTS_i + sample_delta_i) - min_i(PTS_i)) / mdhd.timescale`.
   `U` must be positive and must exactly equal `D / mdhd.timescale`. A valid
   negative-offset reordering can pass; an offset that creates an unexplained
   gap/span, a large-value overflow, or a disagreement cannot.
3. Support only these edit-list shapes, all at exactly 1.0 media rate:

   - no `elst`;
   - one non-empty media edit with `media_time >= 0`; or
   - one leading empty edit (`media_time == -1`) followed by exactly one
     non-empty media edit with `media_time >= 0`.

   Segment durations must be positive and not all-1s. The selected media
   interval must lie within the unedited sample timeline under an exact
   comparison that pairs `elst.media_time` with the media timescale and
   `elst.segment_duration` with the movie timescale. Empty-only, trailing
   empty, multiple media edits, dwell/repeat, negative non-empty media time,
   or any media rate other than exactly 1.0 is unsupported and yields
   facts-unavailable.
4. Let `E` be `U` when no edit exists, otherwise the sum of the supported edit
   segments in movie time. `tkhd.duration / mvhd.timescale` must exactly equal
   `E`. The per-track admission span is `P = max(U, E)`: an edit list may add a
   leading empty interval or lengthen presentation, but it can never shorten
   the admission duration below unedited media. Thus a 90-second sample
   timeline edited and header-declared as 60 seconds still compares as at
   least 90 seconds.

After all tracks, `mvhd.duration / mvhd.timescale` must exactly equal the
maximum edited track span `E` represented by the `tkhd` values. A non-A/V
track, duplicate summary, or other structure that makes that movie-header
cross-check ambiguous yields facts-unavailable. The final admission duration
is the maximum `P` across admitted audio/video tracks.

All comparisons — table/header agreement and
`presentationDuration <= maxDurationMs / 1000` — use checked exact-rational
cross multiplication before any millisecond conversion. Only after policy
comparison does the safe persisted `durationMs` round upward. When
`accept.video` is present, the existing rendition/media
`facts.durationMs` becomes this upward-rounded admission fact; there is not a
second competing duration field. When the block is absent, legacy
`mvhd`-derived behavior stays byte- and behavior-compatible until a separate
versioned migration changes it.

## Deterministic bounds and allocation discipline

Every implementation and capability profile publishes concrete numeric values
for one global `maxWorkUnits` and one global `maxTemporaryAllocationBytes`, as
well as the structural ceilings below. The semantic refusal is based on these
deterministic counters, not elapsed wall-clock time.

One work unit is charged before each of these operations:

- decoding one box header or compatible-brand entry;
- decoding one `dref`, sample-description, codec-config array element/SPS, or
  `esds` descriptor;
- decoding one `elst`, `stts`, `ctts`, `stsc`, `stsz`/`stz2`, `stco`, or `co64`
  entry;
- consuming one merged timing run or deriving/validating one chunk extent; and
- completing one track fact or one policy comparison.

The same bytes, frozen artifact, and parser-semantics version therefore
consume the same units. Reaching `maxWorkUnits` yields
`SNAPBACK_ASSET_VIDEO_BOUNDS_EXCEEDED` at the same semantic step on every run.
`mdat` is skipped by declared extent and is never charged or scanned per byte
by this parser.

Temporary allocation is a deterministic parser-arena reservation budget, not
allocator telemetry. Before every dynamic buffer, the parser computes the
exact logical byte request with checked arithmetic, charges it once against
`maxTemporaryAllocationBytes`, and does not refund it during that invocation.
Declared counts and their minimum/exact encoded lengths must fit the enclosing
box, their per-structure ceiling, the remaining work units, and the remaining
allocation budget **before allocation**. Implementation-dependent `Vec`
growth is not an accounting mechanism.

At minimum, capability facts carry ceilings for whole-file parse bytes, box
depth/count, metadata bytes, compatible-brand entries, tracks, `dref` entries,
sample descriptions, `avcC` parameter arrays, `esds` bytes/descriptor
depth/descriptor count, edit-list entries, `stts` entries, `ctts` entries,
`stsc` entries, sample count/encoded size entries, and chunk-offset entries.
`esds` is parsed iteratively with an explicit depth/count state; recursive
descent without the same counters is nonconforming. `stts`, `ctts`, sample
sizes, and chunk extents are streamed; the parser never creates a `Vec` per
sample.

A wall-clock deadline, request cancellation, process shutdown, or scheduler
preemption is an operationally necessary escape hatch but is **transient**, not
a content verdict. It must not record
`SNAPBACK_ASSET_VIDEO_BOUNDS_EXCEEDED`, must not make the attempt terminally
`failed`, and must leave the current attempt re-drivable under the same frozen
semantics. Only deterministic work/allocation/structural ceilings produce the
stable resource refusal.

## Parser-semantics version and frozen attempts

The initial semantic identity is
`snapback.video-admission.iso-bmff.v1`. It names the complete brand table,
sample/data-reference checks, codec-configuration map, duration algorithm,
work-unit schedule, allocation accounting, refusal precedence, and safe-fact
shape — not merely a crate version.

When `accept.video` is present:

1. codegen binds that version into the normalized policy and required
   capability;
2. attempt creation freezes it beside the intent policy/implementation
   generation;
3. the deployment artifact retains the matching parser implementation until
   every open attempt using it terminates or expires;
4. trusted prepare selects that exact retained implementation and puts the
   version, canonical digest, exact facts, and policy result in the opaque
   prepared carrier; and
5. publication commit revalidates the attempt/generation/version and carrier
   digest before persisting facts or readiness.

A deploy may introduce a successor semantic version, but it cannot reinterpret
an old open attempt with the successor. A genuinely missing or corrupt retained
implementation refuses the old attempt through LLP 0044's stale-admission
path; it does not fall forward, and a successor attempt may be created under
the current version. Identical bytes plus identical frozen policy and semantic
version therefore have the same semantic admission/refusal across deploys;
transient cancellation remains outside that content claim.

## Stable refusal contract

After the existing trusted MIME and size checks, deterministic structural and
semantic classification precedes policy comparison. Malformed encoding and
resource ceilings keep their existing parser codes; otherwise the first
semantic policy failure wins in this order: facts unavailable, container,
video codec, audio codec, duration.

| Code | Condition | Bounded safe details |
| --- | --- | --- |
| `SNAPBACK_ASSET_VIDEO_PARSE_FAILED` | Malformed box/table/descriptor byte grammar whose structure cannot be decoded. | bounded `reasonClass`, box/table kind and ordinal/offset; no payload sample |
| `SNAPBACK_ASSET_VIDEO_BOUNDS_EXCEEDED` | A deterministic published count, work-unit, encoded-size, parse-byte, or temporary-allocation ceiling is exceeded. | ceiling name and configured value |
| `SNAPBACK_ASSET_VIDEO_FACTS_UNAVAILABLE` | A structurally parseable object cannot produce every scoped v1 fact: excluded/unknown/contradictory brands; any fragment syntax; missing primary video; external data; invalid sample extents/counts; handler/config mismatch; zero/unspecified/disagreeing duration; or unsupported edit/timeline form. | `fact`, bounded `reasonClass`, detected MIME; never raw metadata or payload |
| `SNAPBACK_ASSET_VIDEO_CONTAINER_UNSUPPORTED` | A closed-table `mp4`/`quicktime` result is outside `containers`. | allowed/detected container and bounded brands |
| `SNAPBACK_ASSET_VIDEO_CODEC_UNSUPPORTED` | A structurally coherent declared video/audio configuration is outside its allowlist or closed v1 map, including encryption. | track kind/ordinal, allowed/declared codec or `unknown`, bounded entry FourCC/AOT |
| `SNAPBACK_ASSET_VIDEO_DURATION_EXCEEDED` | The exact-rational admission span is greater than the inclusive ceiling. | `maxDurationMs`, upward-rounded `detectedDurationMs` |

A content-policy refusal makes the current attempt `failed`, records the
ordinary safe diagnostic/receipt, publishes no blob or rendition, and leaves
the stable asset `pending` for a successor attempt with different bytes. The
facts-unavailable code — including “no `vide` handler” — is not collapsed into
codec-unsupported. Transient cancellation follows the non-terminal rule above.

## Capability and storage portability

An intent carrying `accept.video` mechanically requires
`asset_video_admission_facts_v1`. The target fact names:

- parser semantics `snapback.video-admission.iso-bmff.v1`;
- closed container and declared codec-configuration vocabularies;
- `sameFileDataReferences: Enforced` and `sampleExtents: Enforced`;
- `sampleTimelineDuration: Enforced`;
- `fragmentedTimelines: Unsupported`;
- `elementaryStreamIdentity: Missing`; and
- every concrete structural, work-unit, and allocation ceiling.

A missing fact refuses generation or activation before staging. A target may
not ignore the block, use client metadata, borrow another target's claim, or
describe elementary identity as Enforced.

The parser and policy comparison live in the asset-domain service above the
authority-store port. SQLite, Postgres, and later cells persist the same safe
facts, parser version, lifecycle outcome, stable code/details, and receipt.
Publication remains atomic in the asset's owning cell; parsing may occur
outside its commit fence, but the opaque carrier is revalidated at final
commit. Store/cell migration copies the canonical digest, normalized facts,
parser version, and policy/generation identity; it never re-probes old blobs
and rewrites historical admission under a newer parser. LLP 0269 carries the
graduation gates and parity obligation.

## Implementation acceptance

Implementation is a later lane. It is complete only when every row below is
executable and the capability remains unclaimed until its affected evidence
passes.

### Authoring and identity

- Codegen accepts the exact Coterie spelling, rejects unknown/empty/duplicate
  or invalid-bound forms, rejects no-supported-video `mediaTypes`, and rejects
  every unsupported `video/*` member in a mixed list.
- The Rust-owned carrier/schema artifacts regenerate, and intents without
  `accept.video` retain byte-identical manifest and policy-hash artifacts.
- Metamorphic fixtures prove each policy or parser-semantics change bumps only
  the changed intent generation; ordinary redeploy, revocation, retained
  implementation selection, missing retained implementation, and successor
  attempt behavior match the frozen rules above.

### Positive and adversarial media fixtures

- Positive vectors cover MP4 and QuickTime, the named dual-brand outcome,
  `avc1` and `avc3` with nonempty v1 `avcC`, each enumerated AAC Audio Object
  Type, silent video, multiple tracks/descriptions, a valid negative `ctts`
  reorder, exact 60,000 ms admission, 60,001 ms refusal, and rational
  sub-millisecond overflow rounded only after comparison.
- Brand vectors cover HEIC + compatible `isom`, `mif1`, `msf1`, AVIF,
  Motion Photo/still-image wrapping, `qt  ` + `isom`, `isom` + `qt  `,
  unknown brands, and contradictory still-image/video combinations. None of
  the still/image cases becomes video.
- Timeline vectors cover understated `stts` versus headers, negative and large
  `ctts`, duration 0, all-1s unspecified duration, a shortening `elst` that
  cannot reduce the unedited ceiling, leading-empty edit, edit rate other than
  1.0, unsupported edit shape, count mismatch, duplicate `moov`/`mvhd`, and a
  short-`moov`/long-`moof` hybrid plus standalone `moof`, `traf`, and `mvex`.
- Data-layout vectors cover external `dref`, invalid data-reference and sample-
  description indices, out-of-range and outside-`mdat` chunks, overflow,
  overlap/contradiction, zero samples, zero-sized video samples, and a valid
  multi-chunk same-file file with at least one presentable video sample.
- Codec vectors cover handler/sample-entry mismatch, no `vide` handler,
  `auxv` validation, MP3-in-MP4 expressed through unlisted `esds`/ASC object
  type 64, empty/no-SPS `avcC`, extra or mismatched decoder configuration,
  encrypted `encv`/`enca`, unknown codec entries, and unused unsupported
  alternate descriptions.
- A descriptor-versus-payload spoof fixture has valid same-file extents and
  valid `avc1`/`avcC` declarations but non-H.264 sample payload. The test may
  derive declared `h264`; it must prove that no fact, receipt, capability, or
  diary claim says the elementary payload was validated. This is an honesty
  regression, not a false-negative expectation.

Every refusal asserts its exact stable code and bounded details, publishes no
blob/rendition, leaves a retryable pending asset, and matches on strip and
retain. Successful finalization records the declared codec sets and upward-
rounded sample-timeline duration against the canonical digest.

### Independent oracle and Coterie gate

The conformance corpus and Coterie rerun use a pinned independent FFmpeg
`ffprobe` plus decode-to-null build, recording its version and executable
digest, as the codec/payload/timeline oracle. It is test evidence, never the
production authority. The oracle comparison must include the descriptor-
versus-payload spoof and understated-sample-timeline cases, not only a happy
fixture.

Coterie's real-server M2 rerun declares MP4 + H.264 + AAC + inclusive 60 s
alongside the existing 50 MB and location-strip rules. It exercises at least
one container/codec refusal, one duration refusal, the descriptor/payload
adversary, and the understated timeline adversary. Only then may Diary 0086
retire its broad “codec/duration inexpressible” caveat for **declared ISO BMFF
container/codec configuration and sample-timeline duration**; the diary must
simultaneously state that elementary-stream identity remains unvalidated.
Editing only the declaration or diary does not satisfy the gate.

### Bounds, determinism, capability, and portability

- Each published structural ceiling is exercised independently: parse bytes,
  box depth/count, metadata bytes, compatible brands, tracks, `dref`, sample
  descriptions, `avcC`, `esds` bytes/depth/count, `elst`, `stts`, `ctts`,
  `stsc`, samples/sizes, and chunk offsets.
- `maxWorkUnits` and `maxTemporaryAllocationBytes` are each exercised
  independently, then one combined fixture approaches multiple local ceilings
  and crosses the single global budget deterministically. Allocation probes
  prove rejection occurs before allocating from hostile declared counts.
- Repeated runs under different CPU load produce the same semantic result and
  work count. Injected wall-clock cancellation remains transient and
  re-drivable; it never becomes a content refusal.
- Capability tests prove missing-fact refusal before staging and activation
  only after the affected parser/finalizer corpus passes. SQLite/Postgres
  parity is required before a future Postgres claim; migration tests copy
  retained facts/version without blob re-probe.
- Schema, diagnostic registry, guide/capability manifest, public authoring
  types, SDK artifacts, inventories, and implementation `@ref` anchors are
  regenerated and drift-checked under LLP 0037, LLP 0012, and repository
  policy.

## Non-goals and open questions

Non-goals are transcoding/remuxing, poster/HLS/bitrate ladders, WebM/Matroska/
AVI, resolution/frame-rate/bitrate policy, requiring audio, content moderation
or virus scanning, client-authoritative admission, and triggering LLP 0269's
Postgres/cell program. Location rewriting and delivery ranges retain LLP 0044's
contracts.

Open questions for a later version:

1. What bounded NAL-unit and AAC access-unit validation is sufficient to
   graduate from declared sample-entry configuration to elementary-stream
   identity, and what new fact/capability name prevents old v1 evidence from
   being reinterpreted?
2. Which application justifies a bounded fragmented-MP4 timeline, and what
   `moof`/`traf` sample/encryption/dependency surface must that new semantic
   version validate?
3. Which additional major/compatible brands can enter the closed table with
   adversarial evidence, especially around HEIF/AVIF image sequences and
   Motion Photo wrappers?
4. Should a later grammar express required/forbidden audio, track-count limits,
   codec profiles/levels, or allowed container+codec tuples rather than
   independent allowlists?

## Revision history

- **v0.1 (2026-08-24, Review).** Extracts the proposed admission contract from
  Accepted LLP 0269 into the asset authority, incorporates the convergent
  hostile-review corrections for sample-timeline duration, syntactic fragment
  refusal, same-file sample extents, honest declared-codec scope, closed brand
  mapping, deterministic work/allocation bounds, retained parser semantics,
  and the expanded Coterie/adversarial acceptance gate. Design only.
