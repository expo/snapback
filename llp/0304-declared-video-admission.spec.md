# LLP 0304: Declared video codec configuration and sample-timeline admission

**Type:** Spec
**Status:** Review
**Systems:** Assets, Security, Code generation, Storage, Deployment, Testing
**Author:** Codex, commissioned by Charlie Cheever for the 2026-08-24 design-revision round
**Date:** 2026-08-24
**Revised:** 2026-08-24 (v0.3 — freezes arbitrary-precision integer/rational duration arithmetic and the canonical v1 work, logical-allocation, and metadata-byte ledgers; design only, implementation and capability claims remain open)
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

The public admission member is exactly `videoAdmission`, whose closed result
shape is:

```text
VideoAdmissionResultV1 {
  declaredContainer: "mp4" | "quicktime",
  declaredVideoCodec: "h264",
  declaredAudioCodec: "aac" | null,
  declaredDurationMs: positive JavaScript-safe integer,
}
```

All four keys are required; `declaredAudioCodec` is `null` when no audio track
exists. V1's closed codec map makes the singular codec keys lossless even when
multiple tracks or sample descriptions are present. The admission result must
not add or substitute `container`, `codec`, `codecs`, `videoCodec`,
`audioCodec`, or `durationMs` aliases. Existing enclosing rendition/media
facts may retain their legacy generic `durationMs` compatibility projection,
but it is derived from `declaredDurationMs` and is not a key of
`VideoAdmissionResultV1`. Receipts, SDKs, diagnostics, capability prose, and
Diary 0086 must preserve the `declared*` distinction and must not present these
values as decoded-payload identity.

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

### Trusted MIME and still-image detection

The trusted content-type detector and this brand classifier are one closed
decision, not two widening gates. Detection must parse the complete bounded
top-level `ftyp` brand vector before emitting an ISO-BMFF video MIME; checking
only bytes 8–11 or treating every non-`qt  ` `ftyp` as `video/mp4` is
nonconforming. It applies these rules before media-type policy dispatch:

- major `heic`, `mif1`, `msf1`, and `avif` detect as `image/heic`,
  `image/heif`, `image/heif-sequence`, and `image/avif`, respectively, even
  when `isom` is compatible;
- any still-image/image-sequence brand in the compatible vector of a video-
  family major is a contradictory image/video signature and detects as
  unavailable/unknown content, never `video/mp4` or `video/quicktime`;
- a recognized Motion Photo or other still-image wrapper keeps the primary
  still image's MIME (for example `image/jpeg`), or detects as unavailable if
  that wrapper is unsupported; an embedded or appended `ftyp` cannot promote
  the wrapper to video; and
- `video/mp4` or `video/quicktime` is emitted only when the complete brand
  vector produces the corresponding result in the closed table above. An
  incomplete, over-budget, contradictory, or unlisted vector emits no video
  MIME.

Thus a mixed image+video intent routes an actual HEIC/HEIF/AVIF/Motion-Photo
object through its image/unsupported branch rather than first misclassifying
it as video and reaching video facts. The detector and admission parser share
the same parser-semantics version and brand-table fixtures; disagreement is a
conformance failure, not a policy outcome.

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
2. Every `stsc` run is ordered, covers the chunk table without a gap or an
   index outside the exact chunk-count domain, and references an in-range sample-description index. Every sample
   description is structurally and codec-configuration checked, including an
   unused alternate; an alternate cannot become an unexamined future codec or
   external data reference.
3. `stsz`/`stz2` supplies exactly the sample count consumed by `stsc`; fixed
   size, per-sample size, and compact-size encodings are checked without
   allocating a per-sample object. `stts` and, when present, `ctts` expand to
   that same count. Zero samples, zero-sized presentable video, or an exact
   count mismatch yields facts-unavailable.
4. For every derived chunk, the parser streams the mapped sample sizes, uses
   arithmetic in `Z`, and proves the complete chunk interval lies within one
   `mdat` payload in the canonical object. File-bound-but-outside-`mdat`,
   an exact endpoint outside the object, overlapping/contradictory chunk
   layout, or an unaccounted sample yields facts-unavailable.
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
  decoder configuration whose DecoderConfigDescriptor
  `objectTypeIndication` is exactly hexadecimal `0x40`, exactly one parseable
  AudioSpecificConfig, and a decoded ASC Audio Object Type in the closed set
  `{1 (AAC Main), 2 (AAC LC), 5 (SBR/HE-AAC), 29 (PS/HE-AAC v2)}`.
  Escape-form AOTs are decoded before membership comparison. The OTI and AOT
  are different namespaces: the [MP4RA Object Types
  registry](https://mp4ra.org/registered-types/object-types) assigns `0x40`
  to MPEG-4 Audio, `0x69` to ISO/IEC 13818-3 audio, and `0x6B` to ISO/IEC
  11172-3 audio; [RFC 6381
  §3.3](https://www.rfc-editor.org/rfc/rfc6381.html#section-3.3) separately
  identifies AAC LC as decimal AOT `2` in `mp4a.40.2`. ASC AOT 64 is a
  separately named, parseable unsupported-AOT case; it is not the MP3 fixture
  and is not confused with OTI `0x40`.
- A structurally coherent `mp4a`/`esds` declaration with OTI `0x6B` (MPEG-1
  audio, including an MP3 Layer III fixture) or the applicable `0x69` MPEG-2
  audio OTI is recognized as non-AAC and yields
  `SNAPBACK_ASSET_VIDEO_CODEC_UNSUPPORTED` without requiring an AAC ASC. Any
  other known non-`0x40` audio OTI follows the same known-but-unlisted rule.
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
“unspecified” duration, unsupported versions, a field value disallowed by the
versioned rules below, or disagreement under the exact comparisons below yields
`SNAPBACK_ASSET_VIDEO_FACTS_UNAVAILABLE`, never admission as zero and never a
truncation-dependent result.

### V1 integer and rational domain

Every encoded integer is decoded at its specified signedness and width and is
then promoted, before arithmetic, into the mathematical integer domain
`Z` (arbitrary precision). Counts, offsets, durations, timescales, intermediate
sums, differences, products, negations, cross-products, and the work,
allocation, and byte ledgers use that domain. There is no semantic fixed-width
overflow in v1. A conforming implementation may use fixed-width fast paths
only when it transparently promotes before overflow; exhausting a local
machine integer is neither `FACTS_UNAVAILABLE` nor `BOUNDS_EXCEEDED` and may
not change the content verdict. An implementation that cannot promote is
nonconforming and cannot publish the v1 capability. A transient allocation or
process failure while providing this domain follows the non-terminal
cancellation rule below; it never creates a stable content refusal.

Every stored or compared rational has the canonical representation `(n, d)`:
`n` and `d` are arbitrary-precision integers, `d > 0`, the sign is carried by
`n`, and the pair is reduced by `gcd(abs(n), d)`; zero, where an intermediate
can be zero, is exactly `(0, 1)`. Duration facts require a positive numerator.
All identities below are evaluated in `Z`. Timescale conversion never rounds
or materializes an integer tick count in the destination scale: equality and
ordering of `a/b` and `c/d` are exactly the ordering of `a*d` and `c*b` in
`Z`, after canonicalization. `max` selects by that comparison; equal values
have the same canonical pair. No production, test, oracle, persistence, or
capability path may use binary or decimal floating point.

Only version 0 and version 1 `mdhd`, `tkhd`, `mvhd`, and `elst` encodings are
supported. For `elst`, v0 has unsigned 32-bit `segment_duration` and signed
32-bit `media_time`; v1 has unsigned 64-bit `segment_duration` and signed
64-bit `media_time`. The empty-edit sentinel is the signed value `-1` (raw
v0 bits `0xFFFFFFFF`; raw v1 bits `0xFFFFFFFFFFFFFFFF`). Media rate is exactly
1.0 only when its signed 16.16 fields encode `media_rate_integer == 1` and
`media_rate_fraction == 0`, raw `0x00010000`; no float comparison is allowed.

For each admitted audio/video-class track, define:

- `M_t = mdhd.timescale` and `M_m = mvhd.timescale`, both positive integers;
- `n_i` and `delta_i` as each positive `stts` run count and delta;
- `S = Σ_i(n_i × delta_i)`, in media ticks;
- `DTS_0 = 0` and `DTS_i = Σ_{k < i} delta_k` after streaming expansion;
- `offset_i = 0` without `ctts`, otherwise the v0 unsigned or v1 signed
  composition offset for sample `i`;
- `PTS_i = DTS_i + offset_i`,
  `C_min = min_i(PTS_i)`, `C_max = max_i(PTS_i + delta_i)`, and
  `C = C_max - C_min`, all checked signed media-tick integers; and
- the unedited media duration `U = U_num/U_den = S/M_t`.

The run-count sums for `stts` and `ctts` must equal the exact sample count.
The parser must establish these exact integer equalities before considering
an edit:

```text
S == mdhd.duration
C == S
U == mdhd.duration / M_t          because S == mdhd.duration
```

Thus `stts` is the unedited-duration authority, `mdhd` is its same-clock
cross-check, and `ctts` may reorder presentation but may not introduce an
unexplained composition gap or longer/shorter span. A positive `S`, `C`, and
`mdhd.duration` is required.

V1 supports only no `elst`, one non-empty media edit, or one leading empty edit
followed by one non-empty media edit. For each non-empty edit let
`m = media_time` in media ticks and `l = segment_duration` in movie ticks.
Require `m >= 0`, `l > 0`, and exact containment of the selected composition
interval in `[C_min, C_max]`:

```text
m >= C_min
m × M_m + l × M_t <= C_max × M_m
```

The leading empty edit, when present, has `media_time == -1` and positive
`segment_duration`; it selects no media. Let `L = Σ segment_duration` over all
supported empty and non-empty edits, in movie ticks. Define the edit-list
presentation span exactly as:

```text
no elst:     E = E_num/E_den = S/M_t = U
with elst:   E = E_num/E_den = L/M_m
```

Let `K = tkhd.duration`, in movie ticks. The track-header cross-check is the
following exact integer equality, chosen by edit presence:

```text
no elst:     K × M_t == S × M_m       (K/M_m == U)
with elst:   K == L                   (K/M_m == E)
```

Any disagreement refuses facts. The per-track admission span is the exact
rational `P = max(U, E)`. Therefore an edit can never shorten admission below
the unedited sample duration: a 90-second `U` edited and header-declared as a
60-second `E` still has `P = 90 seconds`.

The movie-header cross-check is also an integer equality. The parser reads one
supported-version `tkhd` from **every** `trak`, including non-A/V handlers such
as `tmcd`, `text`, `subt`, `sbtl`, and `clcp`, and defines
`K_movie = max_j(tkhd_j.duration)` in movie ticks. It requires:

```text
mvhd.duration == K_movie
```

The mere presence of a non-A/V track is therefore **not fatal** and its inner
sample/codec timeline is not admitted by v1. Its `tkhd` still participates in
the same-clock `mvhd` summary cross-check; a missing, duplicated, unsupported,
all-1s, or structurally invalid `tkhd`, or disagreement with `mvhd`, refuses
facts. Non-A/V tracks do not enter the codec allowlists and do not enter the
final admission span. The final admission duration is `P_final = max(P_t)`
over admitted audio/video-class tracks only.

The inclusive policy check is exactly:

```text
P_final_num × 1000 <= maxDurationMs × P_final_den
```

Both products and the comparison are in `Z`; there is no intermediate
millisecond conversion. Only after that comparison is `declaredDurationMs`
computed by Euclidean division in `Z`: for
`(q, r) = divmod(P_final_num × 1000, P_final_den)`, where
`0 <= r < P_final_den`, the result is `q` when `r == 0` and `q + 1` otherwise.
No other conversion or rounding occurs. A 60.000-second `U` with a supported
edit whose leading/composition-delay presentation adds two frames has
`E > 60.000 seconds`, hence `P = E` and intentionally refuses a 60,000 ms
ceiling; no frame, tick, or millisecond rounding may admit it. When
`accept.video` is absent, legacy `mvhd`-derived behavior stays byte- and
behavior-compatible until a separate versioned migration changes it.

## Deterministic bounds and allocation discipline

Parser semantics `snapback.video-admission.iso-bmff.v1` freezes this exact
numeric tuple. These are semantic content limits, not deploy-time knobs or
target-profile recommendations:

| Ceiling | Exact v1 value | Scope |
| --- | ---: | --- |
| `maxWorkUnits` | 2,000,000 | one parser invocation |
| `maxTemporaryAllocationBytes` | 16,777,216 | canonical non-refunded logical reservations in the v1 table below |
| `maxWholeFileParseBytes` | 536,870,912 | canonical object length |
| `maxBoxDepth` | 32 | nested box depth, counting the top-level box as depth 1 |
| `maxBoxCount` | 100,000 | all headers in the closed phase-H walk, including skipped payload boxes |
| `maxMetadataBytes` | 16,777,216 | cardinality of the canonical half-open byte-range union below |
| `maxCompatibleBrandEntries` | 64 | complete `ftyp` vector |
| `maxTracks` | 64 | all `trak` boxes, including non-A/V |
| `maxDrefEntriesPerTrack` | 64 | one track |
| `maxSampleDescriptionsPerTrack` | 64 | one track |
| `maxAvcCParameterSetsPerDescription` | 512 | all SPS/PPS/extension parameter-set records combined |
| `maxEsdsBytesPerDescription` | 1,048,576 | complete `esds` box |
| `maxEsdsDescriptorDepth` | 16 | iterative descriptor nesting |
| `maxEsdsDescriptorCountPerDescription` | 4,096 | all descriptors |
| `maxElstEntriesPerTrack` | 2 | one track; exactly the largest supported v1 shape |
| `maxSttsEntriesPerTrack` | 262,144 | one track |
| `maxCttsEntriesPerTrack` | 262,144 | one track |
| `maxStscEntriesPerTrack` | 262,144 | one track |
| `maxSampleCountPerTrack` | 10,000,000 | expanded count, including fixed-size `stsz` |
| `maxEncodedSampleSizeEntriesPerTrack` | 10,000,000 | explicit `stsz`/`stz2` entries |
| `maxChunkOffsetEntriesPerTrack` | 1,000,000 | `stco` or `co64` entries |

Every implementation and capability fact publishes these exact numbers. A
target cannot raise or lower one while claiming v1. Changing any value,
charging scope, or entry-count definition requires a successor parser-
semantics version and new capability identity. The semantic refusal is based
on these deterministic ledgers, not elapsed wall-clock time.

### Canonical v1 event schedule

The work ledger starts at zero and contains one entry for each event in the
following schedule, in the stated order. An event is counted exactly once.
An implementation may traverse or buffer differently, but it must derive this
canonical ledger and the verdict at the same canonical event.

Phase H uses one closed walk: scan top-level boxes, and descend only through
`moov`, `trak`, `edts`, `mdia`, `minf`, `dinf`, and `stbl`; through `dref` into
its box-like entries; and through `stsd` into every sample-description entry.
It descends into child boxes only for `avc1`/`avc3`, beginning at
`payloadStart + 78` after the ISO VisualSampleEntry fields, and `mp4a`,
beginning at `payloadStart + 28` after the ISO AudioSampleEntry fields. A
shorter entry is malformed. `encv`, `enca`, known-but-unlisted entries, and
non-A/V sample entries contribute their own entry header but have no descended
child headers in v1. It does not descend into any other payload for accounting.
The phases execute H, then B, then, for each `trak` in start-offset order, T1
through T8, and finally P. T1--T8 are per-track subphases, not whole-file
passes.

| Phase | One work-unit event | Canonical order |
| --- | --- | --- |
| H | One syntactically decoded ISO BMFF box or box-like sample/data-reference entry header, including an otherwise skipped box. | Increasing header start offset over the complete object; a containing header necessarily precedes its children. |
| B | One `ftyp` compatible-brand vector element. The major brand and minor version are not elements. | Encoded vector order. |
| T1 | One `dref` entry. | Tracks by `trak` start offset, then entry index. |
| T2 | One `stsd` sample-description entry. | Same track order, then entry index. |
| T3 | One `avcC` parameter-set record: each SPS, PPS, or extension parameter-set record is one event, including its length field and payload as one record. The `avcC` box and array-count fields add no separate event. | Sample-description order, child-box start offset, then array order SPS, PPS, extension; encoded record order within an array. |
| T4 | One `esds` descriptor TLV, including the outer descriptor. | Sample-description order, then encoded pre-order: parent before child and siblings by start offset. |
| T5 | One encoded entry in each of `elst`, `stts`, `ctts`, `stsc`, `stsz`/`stz2`, and `stco`/`co64`. A fixed-size `stsz` has zero encoded size-entry events. | Within each track, table kinds in the order just listed, then encoded entry index. Exactly one member of each slash pair may exist. |
| T6 | One merged timing interval. | Expand only conceptually to `(delta_i, offset_i)` for sample indices `i` in `[0, sampleCount)`; absent `ctts` means offset zero. Partition that sequence into maximal nonempty half-open index intervals on which the pair is identical. Charge one event per interval in increasing start index. Input-run boundaries with identical pairs do not create another event. |
| T7 | One derived and validated chunk extent. | One per `stco`/`co64` entry, by 1-based chunk index, after applying `stsc` and the sample-size table; unused or zero-sample chunks still reach this event and then refuse facts if invalid. |
| T8 | One completed track fact. | Exactly one per `trak`, including a non-A/V track whose fact is only the validated `tkhd` contribution, in `trak` start-offset order. |
| P | One whole-value policy comparison. | After all facts: container allowlist, declared-video-codec set, declared-audio-codec set (also when empty), then duration, in that order. Stop after the first failed comparison. |

Structural or semantic refusal stops the schedule. Before a scheduled event,
the parser applies any tied local-count ceiling, logical reservation, and work
charge before performing that event. A work charge is allowed when
`workUnits + 1 <= maxWorkUnits`; when another event exists and the ledger is
already at the ceiling, that event refuses
`SNAPBACK_ASSET_VIDEO_BOUNDS_EXCEEDED` before it executes. Merely reaching the
ceiling on the final event is allowed.

### Canonical metadata-byte ranges

Byte accounting is a property of the encoded object, not of reads, page
faults, seeks, traversal, or copies. Every range is half-open: `[start, end)`
includes the byte at `start` and excludes the byte at `end`. `boxEnd` is the
first byte after the declared box. The metadata ledger is the cardinality of
the set union of these ranges, so overlapping parent/child or record ranges
charge each byte once:

| Encoded structure | Charged range |
| --- | --- |
| Every header counted by phase H | `[headerStart, payloadStart)`, including extended-size or user-type header bytes when present. |
| `ftyp`, `mvhd`, `tkhd`, `mdhd`, `hdlr`, `elst`, `dref`, `stsd`, `avcC`, `esds`, `stts`, `ctts`, `stsc`, `stsz`, `stz2`, `stco`, and `co64` | The complete declared payload `[payloadStart, boxEnd)`, including version/flags, count fields, entry bytes, and trailing bytes inside the declared box. Nested ranges remain a set union. |
| A box-like `dref` entry or `stsd` sample-description entry | Its complete declared header and payload extent; overlap with its containing `dref`/`stsd` is charged once. |
| Navigation containers, unrecognized/skipped boxes, and recognized boxes not listed above | Header range only. Their payload contributes zero. |
| `mdat` | Header range only. `[payloadStart, boxEnd)` contributes zero and is never scanned merely to charge it. |

Header ranges are admitted in phase-H order. After the complete structural
scan, listed payload/entry ranges are admitted by increasing range start, then
increasing range end. Before adding a range, the ledger adds only bytes not
already in the union and refuses if the resulting exact natural number would
exceed `maxMetadataBytes`. An invalid or out-of-file range is malformed or
facts-unavailable according to the stable refusal table; it is never clipped.
Thus “metadata bytes parsed” has no implementation-dependent meaning in v1.

### Canonical logical reservations

Temporary-allocation accounting is the following abstract, non-refunded
reservation ledger. Sizes are exact octet counts with no allocator header,
alignment, capacity-growth, small-vector, interning, or compression adjustment.
Actual `malloc`, stack, mmap, streaming, and cache choices do not affect it.

| Logical structure | Reservation charged exactly once |
| --- | ---: |
| Decoded phase-H header record | 32 bytes per header |
| Compatible-brand retained value | 8 bytes per compatible-brand element |
| Track summary/cursors | 256 bytes per `trak` |
| Data-reference summary | 32 bytes per `dref` entry |
| Sample-description summary | 256 bytes per `stsd` entry |
| `avcC` bounded workspace | Exact `avcC` payload length per `avcC` |
| `avcC` parameter-set summary | 16 bytes per T3 record; payload bytes are already in the workspace row |
| `esds` bounded workspace | Exact complete encoded `esds` box length, header included, per `esds` |
| Iterative `esds` descriptor state | 32 bytes per T4 descriptor |
| Edit summary | 32 bytes per `elst` entry |
| `stts`, `ctts`, `stsc`, sample-size, chunk-offset, merged-timing, and chunk-extent entries | 0 bytes per entry; their fixed streaming cursors are included in the track summary |
| Closed codec sets, policy comparisons, and final prepared scalar facts | 0 bytes; their fixed storage is included in the track summary/invocation state |

Header, brand, entry, descriptor, and edit reservations occur immediately
before their corresponding work event. A track summary is reserved before
that track's first T1--T8 event. `avcC` or `esds` workspace is reserved after
its containing T2 event and before its first child event, or immediately after
T2 when it has no child event. Reservation arithmetic uses the v1 natural-
number domain. A reservation is allowed when the new total is less than or
equal to `maxTemporaryAllocationBytes`; otherwise it refuses before the
logical structure is used. Nothing is refunded.

Declared counts and their minimum/exact encoded lengths must fit the enclosing
box and their per-structure ceilings before their first dependent event. For
simultaneous possible bounds at one step, v1 checks whole-file length once at
entry. At each H event it then checks box depth, box count, the header-byte
range, the header's logical reservation, and the work charge, in that order.
After H it admits payload/entry byte ranges in the order above. At each later
count or event it checks applicable named per-structure ceilings in the
numeric-table order above, then that event's logical reservation, then its work
charge. The first failed check names the bounded detail. Every ceiling permits
equality and refuses only when the next exact value would be greater. This
ordering and the three ledgers are part of parser-semantics v1.

Capability facts carry every named table entry above, without aliases or
omissions.
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
arbitrary-precision integer/rational domain, canonical event schedule, charged
byte-range map, logical reservation-size table, **the exact numeric ceiling
tuple above**, refusal precedence, and safe-fact shape — not merely a crate version.
There is no conforming “v1 with locally tuned limits.”

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
| `SNAPBACK_ASSET_VIDEO_CODEC_UNSUPPORTED` | A structurally coherent declared video/audio configuration is outside its allowlist or closed v1 map, including encryption. | track kind/ordinal, allowed/declared codec or `unknown`, bounded entry FourCC/OTI/AOT |
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
- Generated schemas, SDKs, receipts, persistence, and real-server results pin
  `videoAdmission.{declaredContainer,declaredVideoCodec,declaredAudioCodec,declaredDurationMs}`
  exactly, including `declaredAudioCodec: null` for silent video, and reject
  payload-identity aliases.
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
  sub-millisecond excess rounded only after comparison.
- Arithmetic vectors require cross-products wider than 64 and 128 bits and
  compare a fixed-width-fast-path implementation with an arbitrary-precision
  reference. Both must emit the same reduced rational, rounded millisecond
  value, and verdict; injected machine-width exhaustion is never a content
  refusal.
- Brand vectors cover HEIC + compatible `isom`, `mif1`, `msf1`, AVIF,
  Motion Photo/still-image wrapping, `qt  ` + `isom`, `isom` + `qt  `,
  unknown brands, and contradictory still-image/video combinations. None of
  the still/image cases becomes video.
- Timeline vectors cover understated `stts` versus headers, negative and large
  `ctts`, duration 0, all-1s unspecified duration, a shortening `elst` that
  cannot reduce the unedited ceiling, leading-empty edit, edit rate other than
  raw 16.16 `0x00010000`, a 60.000-second timeline plus a two-frame
  composition-delay edit that must refuse the inclusive 60,000 ms ceiling,
  unsupported edit shape, count mismatch, duplicate `moov`/`mvhd`, supported
  `tmcd`/caption siblings whose `tkhd` values participate in the `mvhd`
  equality without entering `P`, and a short-`moov`/long-`moof` hybrid plus
  standalone `moof`, `traf`, and `mvex`.
- Data-layout vectors cover external `dref`, invalid data-reference and sample-
  description indices, out-of-range and outside-`mdat` chunks, exact endpoints
  beyond the object,
  overlap/contradiction, zero samples, zero-sized video samples, and a valid
  multi-chunk same-file file with at least one presentable video sample.
- Codec vectors cover handler/sample-entry mismatch, no `vide` handler,
  `auxv` validation, AAC LC as OTI `0x40` plus ASC AOT 2, a genuine
  MP3-in-MP4 `mp4a`/`esds` declaration with OTI `0x6B` (and an applicable
  MPEG-2 case with OTI `0x69`) that must be codec-unsupported, a separately
  named OTI `0x40` plus parseable ASC AOT 64 unsupported-AOT case,
  empty/no-SPS `avcC`, extra or mismatched decoder configuration, encrypted
  `encv`/`enca`, unknown codec entries, and unused unsupported alternate
  descriptions.
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

The Coterie oracle's pinned timeline field is exactly
`timeline.packetPtsSpan`, an exact rational derived from `ffprobe
-show_packets` integer `pts`, integer `duration`, and per-stream `time_base`:
for each admitted A/V stream it is
`(max(packet.pts + packet.duration) - min(packet.pts)) × time_base`, and the
file value is the maximum exact rational across those streams. A fixture with
a missing required packet timestamp/duration is oracle-unavailable and cannot
pass the gate. For each no-edit oracle vector, including Coterie's positive and
understated-timeline adversary, the comparison is exactly
`timeline.packetPtsSpan == U`; because those vectors have `E == U`, it also
compares directly with Snapback's exact final `P` before either side is rounded
to milliseconds. Edit-list vectors separately assert the checked `E` and
`P = max(U,E)` identities above; they do not substitute a summary-box field
when an FFmpeg demux presentation has already applied an edit. The oracle must
not use `format.duration`, `stream.duration`, `mvhd`, or `tkhd` as its timeline
field.
Decode-to-null remains the independent payload/codec oracle; its deliberate
disagreement with declared `h264` on the descriptor/payload spoof is honesty
evidence, not a Snapback false negative.

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
- Golden accounting vectors publish the phase/event ordinal, work total,
  logical-reservation total, and canonical metadata-range-union total at each
  refusal boundary. Implementations using eager buffers, streaming cursors,
  mmap, and different allocator growth strategies must match those ledgers and
  the named first exceeded ceiling byte for byte.
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

- **v0.3 (2026-08-24, Review).** Freezes v1 duration arithmetic to canonical
  arbitrary-precision integers and reduced rationals, including exact
  timescale comparison and Euclidean millisecond rounding. Replaces
  representation-dependent resource language with one canonical event
  schedule, half-open charged-byte-range union, logical reservation-size
  table, and bound-precedence rule under parser-semantics v1. Status remains
  Review, the implementation ticket remains open, and no capability is
  claimed.
- **v0.2 (2026-08-24, Review).** Closes the residual delta-review findings:
  checked-integer `U`/`E`/`P` identities and header equalities, explicit
  non-A/V `tkhd` handling and conservative composition-delay behavior;
  separate MP4RA OTI versus ASC AOT classification with genuine MP3 vectors;
  closed trusted still-image MIME detection; exact numeric v1 ceilings; and
  pinned public `declared*` result keys plus Coterie's packet-PTS-span oracle.
  Status remains Review, the implementation ticket remains open, and no
  capability is claimed.
- **v0.1 (2026-08-24, Review).** Extracts the proposed admission contract from
  Accepted LLP 0269 into the asset authority, incorporates the convergent
  hostile-review corrections for sample-timeline duration, syntactic fragment
  refusal, same-file sample extents, honest declared-codec scope, closed brand
  mapping, deterministic work/allocation bounds, retained parser semantics,
  and the expanded Coterie/adversarial acceptance gate. Design only.
