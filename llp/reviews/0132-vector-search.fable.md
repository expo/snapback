# LLP 0132 review — Fable family


## Round 1 — 2026-07-31

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh non-author subagent
**Effort:** session-inherited
**Date:** 2026-07-31
**Redacted:** no
**Method:** fresh non-author subagent context, read-only review of the
working tree at commit cffe06ff, blind to this Spec's codex artifact (no
`llp/reviews/0132-*` file existed at review start); verified against
LLP 0124 v0.2, LLP 0073 (2026-07-30 revision), LLP 0113, LLP 0115
v0.7 (OQ7/OQ8 decision registry), LLP 0119/0127 §Sequencing 4 and
decision docket 8, LLP 0130 (SD-4, ER-2), LLP 0019 (F7, OQ5), LLP 0080,
LLP 0065, LLP 0102 App 5, Diary 0031, `guide/capabilities.md`, and the
`SNAPBACK_FUNCTION_NOT_LIVE` code in `src/`; the arithmetic claims in
§Distance profile were re-derived independently (worked checks in
§Strengths and §Concerns below)
**Target:** `llp/0132-vector-search.spec.md` (449 lines)
**Target SHA-256:** `c78fe10dc6086bfa3db67d639324e33267e2ff72eadbd99829dfc7c8ac46d57b`
**Status:** completed

## Verbatim review

## 1. Overall assessment

This is a disciplined, commission-faithful Spec whose hardest technical
content — the pinned-binary64 distance profile — survives independent
re-derivation. I checked the finiteness bounds by hand and they are
correct, including the subtlety the text elides (partial accumulator
bounds `k·2^202` and `k·2^200` are exactly representable for
`k ≤ 2^12`, so correctly rounded addition can never overshoot them);
the product rule is arithmetically consistent with the ≥1,536-dimension
acceptance corpus (1,536 × 43,690 = 67,107,840 ≤ 2^26); the cosine
deferral recipe is mathematically sound (dot over pre-normalized
vectors *is* cosine ranking, and l2sq over unit vectors is 2 − 2cos,
monotone in it); and the −0 admission canonicalization interlocks
exactly with the SQLite integral-REAL storage quirk it names — I
verified that −0.0 is precisely the one binary64 value the SQLite REAL
round trip does not preserve (integral-value REALs may be stored as
integers, and −0 reloads as +0), so canonicalizing it at admission is
what makes the "binary64 survives the SQLite REAL round trip exactly"
claim true rather than approximately true. The consistency section is
the strongest product argument in the document and its three
filter-timing grounds hold: an exhaustive partition scan genuinely has
no ANN pre-filter dilemma, the page genuinely is the true top-k of the
authorized set, and the leakage exclusion is structural because every
observable (items, distances, counts, work accounting, admission)
ranges over the caller's partition only, matching 0073's
termination-insensitive claim shape. Nonclaims (live, hosted,
membership visibility, pagination, cosine id, embedding computation)
are honest and coded.

It is not yet at the bar. Three material gaps remain, all cheap to fix
and none architectural: (C1) the Spec never states the
classification-to-visibility admission matrix or the private-posting
custody rule that 0073 makes load-bearing — as written, nothing forbids
a `private`-classified vector field in a `public-read` index, which
would structurally leak distances derived from private content; (C2)
the arithmetic profile pins every operation but not the wire-decimal →
binary64 conversion at admission, a named, historically real divergence
source that the adversarial corpus does not cover — a hole in a profile
whose stated posture is "portability follows from the pin, not from
testing luck"; (C3) the §ANN successor admission section presents its
approximate door as "Decision 8's rule, made concrete," but decision 8
decided only the proved-superset route, and the approximate door is
also absent from the Spec's own beyond-commission list — an undisclosed
extension of the commission.

VERDICT: NOT READY

## 2. Strengths

- **The finiteness bound is correct, and I verified it rigorously.**
  With components admitted at |x| ≤ 2^100 (line 73) and −0
  canonicalized: the rounded difference satisfies |round(a−b)| ≤ 2^101
  (exact bound ≤ 2^101, which is representable, and round-to-nearest is
  monotone with round(2^101) = 2^101); the rounded square is ≤ 2^202 by
  the same argument; and the accumulator after k terms is ≤ k·2^202 by
  induction, because k·2^202 is exactly representable for every
  k ≤ 4096 = 2^12 (12 < 53 significand bits) and rounding cannot cross
  a representable bound. Final bound 2^12 · 2^202 = 2^214 for `l2sq`
  and 2^12 · 2^200 = 2^212 for `dot` (mixed-sign dot terms bound the
  magnitude by the same induction), both vastly below binary64
  overflow. No division, no square root, no NaN path from admitted
  inputs. The claims at lines 158–165 are true as stated.
- **Bit-exact cross-target determinism follows from the pin.** IEEE 754
  requires correctly rounded add/subtract/multiply in binary64, so the
  strict sequential evaluation order (lines 136–148) fully determines
  every bit; the named forbidden divergence sources (FMA contraction,
  reassociation/vectorized reduction reorder, x87 extended precision)
  are exactly the real-world ones, and the adversarial corpus's
  detector vectors for each class (lines 392–397) are constructible —
  standard 1 + 2^-53-pattern order-sensitivity and product-residue
  FMA-detection vectors work, including with nonnegative square terms
  for `l2sq`. Subnormal corpus entries also catch FTZ/DAZ builds, whose
  flushing is not correctly rounded arithmetic.
- **The product rule and the acceptance corpus are consistent.**
  `dims × maxIndexedVectorsPerPartition ≤ 2^26` at 1,536 dims permits a
  generation-validated bound of ⌊2^26/1536⌋ = 43,690 ≤ 65,536, so the
  "at least 1,536 dimensions at its generation-validated partition
  bound" budget corpus (lines 408–412) names a declarable index. At
  4,096 dims the bound is 2^14 = 16,384, inside the 1–65,536 range.
  32 KiB/row = 8 × 4096 checks out.
- **The −0/RFC 8785/SQLite interlock is genuinely elegant.**
  Canonicalizing −0 at admission (lines 74–78) simultaneously removes
  the RFC 8785 `0`-spelling ambiguity, the Diary 0039
  representation-divergence trap class, and the one SQLite REAL
  round-trip non-identity — and it provably does not change any
  distance (a −0 component can flip only the sign of an exact-zero term
  or difference, which squaring and RNE zero-sign rules erase).
- **The consistency section earns its load-bearing status.** The
  Convex composition-overhead quote is verbatim from Diary 0031
  (lines 762–764 there), the nontransactional-seam background matches
  0124's doc-verified account, and the one-snapshot argument is sound
  because synchronous maintenance (§Index maintenance) makes the index
  a pure derivation of the snapshot's source rows. The 0073
  noninterference transfer goes through: with postings keyed by
  `(visibilityPartition, canonicalRowIdBytes)` and no cursor surface at
  all, the vector observation boundary is strictly smaller than
  search's, and every named observable is partition-scoped. The
  explicit inheritance clause for future ANN
  (pre-filter-or-proved-over-fetch, lines 257–259) closes the silent-
  weakening path 0124 warned about.
- **Commission fidelity on the decided axes.** New Spec beside 0073
  with 0073 untouched; staged admission copied concretely
  (version-bound artifacts, fail-closed digests, capability id with
  nonclaims, per-target evidence, the 0073 implementation-sequence
  shape including the container-vm step and the LLP 0046-gated
  PostgreSQL step); exact k-NN base; embeddings-from-outside (0124 V2,
  0019 F7's independence-from-actions rationale); the float-pinning
  rider decided here, citing 0124 OQ3 (correctly, per 0115 v0.7's
  OQ2→OQ3 attribution fix); beyond-commission decisions (0124 OQ8
  consistency, OQ9 first half) explicitly disclosed in §Commission.
  The 0073 OQ12 lesson (provider/contract projection named in the
  byte-for-byte bullet) and the RFC 8785/Diary 0039 lesson are both
  absorbed by name.
- **Falsifiable acceptance.** Every bullet is executable-evidence
  shaped: byte-identical pinned spellings, paired databases, injected
  maintenance failure, refused over-bound declarations, preregistered
  budgets, byte-for-byte carrier agreement. The membership-visibility
  restatement caveat on the Diary 0031 fixture (lines 388–390) is
  exactly the right honesty move, verified against the fixture's
  actual room-membership protection in Diary 0031.

## 3. Concerns

**C1. MATERIAL — the classification-to-visibility admission matrix and
private-custody rules are missing.** §Index declarations (lines 92–95)
requires the vector field to carry a `public` or `private`
classification and rejects `sensitive`/`forbidden`, and lines 102–104
admit `public-read` and `owner.v1` visibility — but nothing connects
the two. LLP 0073 makes the connection load-bearing and resolved it as
its OQ4: "`public-read` indexes admit only `public` match, filter,
score, stored, and highlight fields. `owner.v1` indexes may admit
`public` or `private` fields because the canonical effective-user
partition is both the posting key and release authority"
(0073:117–121). As written, LLP 0132 permits declaring a
`private`-classified vector field in a `public-read` index — every
caller would then receive distances, ranks, and stored fields derived
from private content, in a Spec whose §Candidate-to-release claim is
that "leakage is excluded structurally." Three adjacent omissions
travel with it: (a) filter and stored fields get no classification
treatment at all ("as in 0073" at line 100 covers stored-field
*mechanics*, not the admission matrix; the vector field is a surface
0073 has no rule for); (b) 0073's private-custody clause ("index
bytes, term vocabulary, stored display text, caches, backup posture,
and administrative access have a storage and encryption class at least
as restrictive as the source," 0073:686–691) has no counterpart for
private vector posting bytes in the shadow table, even though line 95's
"an embedding is derived from content and inherits its custody" states
the principle; (c) 0073's query-text telemetry rule (redacted logging,
shape-and-digest-only defaults) has no counterpart for query vectors,
which are embeddings of caller content and equally custody-bearing.
**Resolution:** add the explicit matrix (public-read admits only
`public` vector/filter/stored fields; `owner.v1` may admit `private`,
with generation refusing the rest), a custody sentence for private
postings across active/rebuild/rollback/backup paths, and a
query-vector logging/telemetry sentence.

**C2. MATERIAL — the profile pins the arithmetic but not the
decimal → binary64 conversion at the admission boundary.** The
determinism claim (lines 129–133) is bit-identical distances "on every
conforming target," and the golden corpus pins RFC 8785 spellings. But
query and stored vectors arrive as JSON `number[]` (line 194), and the
conversion from wire decimal to the admitted binary64 value is nowhere
pinned to correctly rounded round-to-nearest-ties-even. This is a
named, historically real divergence class (naive strtod
implementations off by an ulp on halfway-adjacent decimals) of exactly
the same kind as the forbidden FMA/reassociation sources — yet the
adversarial corpus bullet (lines 392–397) contains no
conversion-adversarial entries, so a target with a sloppy parser could
pass a corpus whose fixture decimals happen to be benign while
diverging on application inputs. LLP 0080 pins output spelling (RFC
8785 serialization), not input conversion, so no cited authority
covers it. For a Spec whose stated posture is "portability follows
from the pin, not from testing luck" (line 148), this is a genuine
hole in the pin, not an implementation detail — even though the
current Rust host's parser is correctly rounded in practice, the
profile is what a future target (e.g., a physical pgvector adapter)
conforms to. **Resolution:** one sentence in §Vector values or
§Distance profile — admission converts wire decimals to the nearest
binary64 (ties to even), and the admitted value, not the wire
spelling, is the semantic input — plus halfway-case decimal entries in
the adversarial corpus.

**C3. MATERIAL — the approximate door is presented as part of decision
8, but decision 8 did not decide it.** §ANN successor admission opens
"Decision 8's rule, made concrete" (line 356) and then admits two
future doors. The accelerator door is decision 8's rule: "ANN admitted
later as a separate capability with proved-superset translation"
(0115 OQ8 registry item 8; same wording at 0115 OQ7's answer). The
approximate door (`vector_search_ann_v1`, recall@k vocabulary,
lines 368–373) is not: it is the V1b evidence vocabulary decision 8
declined for the base, relocated to a future non-base capability —
defensible as owner-Spec policy, but nowhere decided, and it is also
absent from §Commission's own beyond-commission list (lines 54–58),
which names only the consistency model, filtered k-NN, the value/index
contract, bounds, and acceptance. As written, a future
`vector_search_ann_v1` author could cite this section as commissioned
policy. This is the one place the Spec's otherwise excellent
commission-boundary hygiene slips. **Resolution:** re-attribute — keep
the accelerator door as decision 8's rule; label the approximate door
as this Spec's own proposed admission constraint riding open question
2 (or route its legitimacy to the author), and add it to §Commission's
beyond-the-commission list.

**C4. DETAIL — the RFC 8785 injectivity claim is overstated and rests
on an unstated (provable) lemma.** Lines 175–177: "RFC 8785's shortest
round-trip spelling is injective on binary64." False as a statement
about binary64: RFC 8785 spells both +0 and −0 as `0` (and non-finites
are unserializable). The claim is true on the *reachable output set*,
because the profile can never emit −0 — for `l2sq`, components are
never −0 post-canonicalization, exact-zero differences round to +0
under RNE, and squares are ≥ +0; for `dot`, the accumulator starts at
+0.0 and IEEE zero-sign rules make −0 reachable only via (−0) + (−0),
which induction excludes (a −0 *term* from underflow is absorbed as
+0 + (−0) = +0). Neither the never-−0-output lemma nor the scoping is
stated. **Resolution:** state the lemma in §Provable finiteness (one
clause) and scope the injectivity claim to the profile's output
domain, or to "binary64 excluding the zero-sign distinction, which the
profile never produces."

**C5. DETAIL — filter composition semantics are unstated.**
Lines 194–201 admit up to 8 equality filters but never say they
conjoin, nor what a duplicate-field filter list does (two `eq` values
on one field: contradiction-refuse, or vacuously empty conjunction?).
0073 answered both via its AST shape (filters are direct children of
one root `all`) and canonicalization/dedup rules; this Spec has no AST
and no cursor, so one sentence suffices — but it is currently absent.
**Resolution:** state that filters conjoin, and pick a duplicate-field
rule (refuse, matching the validation posture elsewhere, or admit as
conjunction).

**C6. DETAIL — the adversarial-corpus sentence claims more than a
finite corpus can.** Lines 395–397: detector vectors are included "so
a nonconforming build fails the corpus rather than passing
approximately." For the three named divergence classes (FMA,
reassociation, extended precision — plus FTZ via the subnormal
entries) this is right and constructible. As an unscoped universal
("a nonconforming build") it is not provable by any finite corpus — an
implementation wrong only outside the corpus passes it; the normative
guarantee is the pin (line 148), with the corpus as detector.
**Resolution:** scope the sentence to the named divergence classes
("a build nonconforming in any of these ways"), which also makes it
consistent with the Spec's own pin-not-testing posture. Consider
naming FTZ/DAZ explicitly beside the subnormal entries.

**C7. DETAIL — small wording/attribution items.** (a) Line 226–230's
"Snapback ships as one authorized query call" is present-tense in a
Draft Spec with zero implementation; the §Capabilities GAP-flip
discipline makes the posture clear elsewhere, but this sentence, in
the section the Spec calls its load-bearing product claim, should read
as specification ("ships as" → "specifies as one authorized query
call"). (b) The mutation-side corpus-bound refusal is "an ordinary
validation refusal" (line 291) with no named code, while every other
refusal in the Spec is coded; if the ordinary validation envelope is
the deliberate answer, one clause saying so would close it.
(c) Line 160–161's "so the accumulator never exceeds 2^214" silently
uses the fact that partial bounds k·2^202 are exactly representable
(so rounding cannot overshoot); one clause would make §Provable
finiteness self-contained. (d) Line 385's "LLP 0102 App 5's
deterministic 32-dimensional embeddings": 0102 App 5 specifies a
"deterministic embedding fixture" without dimensions; the 32 is the
Diary 0031 freeze. Attribute the number to the frozen fixture.

## 4. Suggestions (non-blocking)

- **Note the pgvector float4 reality in step 4.** The parenthetical
  "pgvector, if used physically, must reproduce
  `snapback-vector-distance-v1` bitwise or stay a nonclaim" is
  correctly fail-closed, but pgvector's `vector` type stores float4
  components, so the bitwise branch is close to structurally
  unreachable; a half-sentence saying the expected PostgreSQL physical
  shape is ordinary binary64 column storage under the store seam would
  save a future implementer a dead end.
- **State the reachable-output range of each metric in the facts.**
  `l2sq` ∈ [+0, 2^214], `dot` ∈ [−2^212, 2^212], never −0/NaN/Inf —
  three constants in `VectorSearchFactsV1` would let clients and
  fixture authors validate distances without re-deriving the bounds.
- **Say one word about admin inspection.** 0073 pins "scoped audited
  administration may inspect drift and physical work separately";
  the vector Spec's corruption posture would benefit from inheriting
  or explicitly deferring that sentence.
- **Consider naming the k-out-of-range refusal.** `k?: 1..64` implies
  schema refusal; folding it into the `SNAPBACK_VECTOR_QUERY_INVALID`
  enumeration (line 196–199) would make the diagnostic surface
  complete.

## 5. Open questions

1. Is the approximate door (C3) intended as decided owner policy for
   any future `vector_search_ann_v1`, or as a proposal riding OQ2? The
   re-attribution answer determines whether a future ANN document
   needs author adjudication or can cite this section.
2. Does the `v.vector` storage mapping amendment (LLP 0004/0007/0037,
   line 80–84) intend the source-row representation to be the RFC 8785
   array spelling or the fixed-width binary64 encoding the posting
   table uses? The Spec's SQLite REAL round-trip sentence suggests the
   former; the amendment should not have to guess.
3. For `owner.v1` vector indexes, is `maxIndexedVectorsPerPartition`
   also the effective per-owner quota surface applications should
   read, or will a separate quota fact exist? (Product question only;
   the bound semantics are clear.)

## 6. Verdict

**NOT READY.**

The commissioned direction is executed faithfully on every decided
axis, the arithmetic profile is correct as far as it goes (verified
independently), the consistency model is the genuine product advance
it claims to be, and the nonclaims are honest. The document misses the
bar on three material, cheaply fixable gaps: the missing
classification/visibility/custody matrix (C1 — leakage-adjacent in a
Spec whose central claim is structural leakage exclusion), the
unpinned decimal→binary64 admission conversion (C2 — a hole in the
very pin the profile's portability rests on), and the approximate ANN
door's attribution to a commission that did not decide it (C3).
C4–C7 are detail-grade. No evidence boundary is weakened anywhere;
nothing requires re-architecture.

## 7. Recommended next step

Apply C1–C3 (roughly six sentences plus corpus entries and one
re-attribution) and the C4–C7 wording repairs in a v0.2 revision, then
proceed to the Codex-family round on the revised text. Given the
fix-locality, one revision round should suffice for this family; on
dual-family READY with zero unresolved MATERIAL concerns, acceptance
runs under LLP 0130 SD-4 as the Spec's review path already records.
