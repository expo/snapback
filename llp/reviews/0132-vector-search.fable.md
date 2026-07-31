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

## Round 2 — 2026-07-31

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh non-author subagent
**Effort:** session-inherited
**Date:** 2026-07-31
**Redacted:** no
**Method:** round-2 delta review — verify each Round-1 Fable concern
against v0.2 and review the new v0.2 text for fresh defects; blind to
the codex artifact throughout; C1's fix re-verified against LLP 0073's
actual text (declaration matrix 0073:115–122, resolved open question 4
at 0073:876–878, private-custody clause 0073:685–691, query-telemetry
rule 0073:682–683, noninterference claim shape 0073:484–492); the
never-−0 lemma, the finiteness restatement, and the scale-floor
arithmetic re-derived independently; `src/` checked for
`SNAPBACK_VECTOR_*` code collisions (none exist; zero implementation,
as expected). No re-litigation of Round-1-settled text.
**Target:** `llp/0132-vector-search.spec.md` v0.2 (613 lines)
**Target SHA-256:** `efd2fa83266cc187500a37632e2bee04e59326fad6cd70f990de460a28f28be5`
**Status:** completed

### Round-1 concern resolution

**C1 (MATERIAL — classification/custody/telemetry matrix): RESOLVED.**
The new matrix (lines 155–169) closes classification over every
participating role — vector field, every equality-filter field, every
stored display field — and I verified it against 0073's actual rule,
not my Round-1 paraphrase: "omission is `forbidden`," the table-wide
more-restrictive rule, public-read-admits-only-public,
owner.v1-may-admit-private with the posting-key/release-authority
rationale, sensitive/forbidden rejected everywhere pending a later
named profile, and classification-change-is-semantic-migration all
mirror 0073:115–122 and resolved OQ4 (0073:876–878) exactly. The
custody paragraph (lines 171–175) transfers 0073:685–687's clause with
the correct domain substitutions (term vocabulary → content digests;
rebuild/rollback generations added, matching 0073:832's custody-path
list). The query-vector telemetry sentence (lines 176–179) transfers
0073:682–683 (redacted logging; shape-and-digest default, never raw
components). The acceptance section adds the generation-negative
matrix bullet plus paired public/private owner-release evidence
(lines 559–564), which Round 1 did not even ask for. All three
sub-omissions (a)(b)(c) are closed.

**C2 (MATERIAL — unpinned decimal→binary64 conversion): RESOLVED.**
Lines 116–125 pin admission conversion unconditionally — nearest
binary64, ties to even — declare the admitted value (not the wire
spelling) the semantic input to storage, digests, and distances, and
classify a one-ulp parser as nonconforming in the same breath as the
fast-math transformations. The adversarial corpus now carries
halfway-case conversion entries (lines 529–532) and "one-ulp decimal
conversion" appears in the named divergence-class list with committed
bit-pattern witnesses (lines 533–539). The hole in the pin is closed.
One attribution nit in the new wording survives as R2-1 below;
it does not reopen the hole because the binding sentence is
unconditional.

**C3 (MATERIAL — approximate-door attribution): RESOLVED, and
sufficient.** The fix lands in both required places. §Commission
(lines 90–94) now separates "proposes without deciding" from the
decided list and states decision 8 decided only the proved-superset
route. §ANN successor admission (lines 484–509) re-labels the
approximate door "this Spec's own proposal, undecided," discloses it
as beyond-commission, rides it on open question 2, routes adoption to
the author, and adds the affirmative bar: "A future
`vector_search_ann_v1` document may not cite this section as
commissioned or decided policy." That bar answers Round-1 open
question 1 in the strongest available form — a future ANN author
cannot cite this section as decided and must obtain author
adjudication. The accelerator door keeps its correct decision-8
attribution, and the Summary's "ANN admitted later ... with
proved-superset translation" remains consistent (it describes only
the decided door). Nothing further needed.

**C4 (DETAIL — injectivity overstated / missing lemma): RESOLVED, and
the lemma is mathematically valid — I re-derived it.** Lines 246–251
state the never-−0-output lemma; lines 269–273 scope injectivity to
the reachable output domain (binary64 excluding −0 and non-finites).
Verification of the lemma: (i) every finite binary64 is an integer
multiple of 2^−1074, so a nonzero exact difference or sum has
magnitude ≥ 2^−1074, which is representable, and monotone
round-to-nearest cannot take it to zero — rounded results are ±0 only
when the exact result is 0, which RNE signs +0 for
opposite-sign-operand sums and equal-operand differences; (ii) for
`l2sq`, differences are therefore never −0 from admitted (+0-
canonicalized) components, and squares are ≥ +0 in any case because
same-sign products (including underflow to zero) are positively
signed; (iii) for `dot`, −0 terms ARE reachable (+0 × negative;
negative underflow), which the text correctly concedes, and the
induction correctly absorbs them: acc starts +0.0, +0 + (−0) = +0
under RNE, nonzero-acc cases follow from (i), so acc is never −0 and
−0 output would require (−0) + (−0), excluded. Sound. The scoped
injectivity claim (RFC 8785 shortest round-trip spelling on binary64
minus −0 and non-finites) is true.

**C5 (DETAIL — filter composition): RESOLVED.** Lines 298–302:
filters conjoin, stated; duplicate-field lists refuse with
`SNAPBACK_VECTOR_QUERY_INVALID`, matching the Spec-wide validation
posture, with the rejected alternatives named. Exactly the requested
sentence.

**C6 (DETAIL — corpus universality): RESOLVED.** The acceptance
bullet (lines 532–546) now scopes the claim to the named divergence
classes on the kernels exercised, names FTZ/DAZ beside the subnormal
entries, requires every shipped kernel (scalar, SIMD,
dimension-specialized) to run the full corpus, adds per-kernel
coverage records and build/flag evidence, concedes "no finite corpus
detects every nonconforming build," and restates the pin as the
normative guarantee with the corpus as its detector. This is the
honest form Round 1 asked for, strengthened.

**C7 (DETAIL — wording/attribution): RESOLVED, all four.**
(a) "this Spec specifies as one authorized query call" (line 332)
replaces present-tense shipping. (b) The mutation-side bound refusal
is coded `SNAPBACK_VECTOR_CORPUS_BOUND` on the named ordinary
validation envelope (lines 416–418) and added to the diagnostics
enumeration (line 322); no existing `SNAPBACK_*` code collides
(checked `src/` and 0073). (c) The partial-bound representability
clause (k·2^202 exactly representable for k ≤ 2^12; monotone rounding
cannot cross a representable bound) is stated at lines 240–244 —
this is precisely the elided step Round 1 verified privately, now on
the page. (d) The 32 dimensions are attributed to Diary 0031's
freeze, with 0102 App 5 correctly credited for the fixture only
(lines 519–521).

### Review of the new v0.2 text

- **Four-counter logical-work object (lines 365–385).** The shape
  matches 0073's transcript claim (0073:484–492): value/code,
  termination-insensitive, over counted logical units in the caller's
  partition, wall-clock/cancellation/machine-loss outside the
  semantic transcript, no stronger timing claim without separate
  evidence. Dropping 0073's "continuation-shape" leg is correct, not
  an omission — v1 vector has no cursor or continuation at all. Each
  counter is partition-local by construction, the phase order
  (enumeration → filtering → distance → top-k → release) is fixed,
  and first-exceeded-ceiling refusal naming is deterministic given
  the counters, so the paired-database comparison in acceptance is
  falsifiable as M2 intended. One wording defect survives as R2-2.
- **Scale-floor arithmetic (lines 565–576).** Verified:
  min(⌊2^26/dims⌋, 65,536) is the correct generation-validated
  maximum (the 65,536 cap binds only at dims ≤ 1024, below the
  bullet's 1,536-dim floor); ⌊67,108,864/1,536⌋ = 43,690 exactly, and
  1,536 × 43,690 = 67,107,840 ≤ 2^26 while 43,691 would refuse. The
  receipt (exact vector count, bytes, scalar pairs) plus
  boundary-fill/next-insert-refused evidence makes the bullet
  unsatisfiable by a token-cardinality index, which was M4's point.
- **New refusal code.** `SNAPBACK_VECTOR_CORPUS_BOUND` is declared,
  used consistently across maintenance, acceptance, and the
  diagnostics enumeration, and collides with nothing.
- **`l2sq` restatement (lines 212–217).** "The difference is computed
  and rounded once, then squared" plus "three per `l2sq` term, two
  per `dot` term" is consistent with the finiteness proof's operation
  count and removes the only ambiguity (whether `a[i] − b[i]` is
  rounded once or twice) the old formula admitted.
- **Cosine preconditions (lines 253–263).** The M5 restatement is
  correct: consistent application normalization plus nonzero vectors,
  with the claim honestly scoped to portable dot ranking over the
  admitted binary64 components, not exact-real cosine.

### New concerns (all detail-grade; none block)

**R2-1. DETAIL — the IEEE 754 attribution on the conversion pin is
slightly too generous.** Lines 118–120 gloss the pin as "the
correctly rounded strtod-class decimal-to-binary conversion IEEE 754
specifies for decimal character sequences." IEEE 754 (§5.12.2)
requires correctly rounded conversion only for decimal sequences of
at most H significant digits (H ≥ 20 for binary64); for longer
sequences it permits rounding the sequence to H digits first — i.e.,
double rounding — and JSON wire decimals can be arbitrarily long,
which is exactly where halfway-straddling adversarial inputs live.
The Spec's own binding sentence is unconditional ("converts each to
the nearest binary64 value with ties to even") and therefore
*stronger* than IEEE's minimum, so the pin itself is sound; the risk
is an implementer reading the appositive as "an IEEE-conforming
strtod suffices." **Resolution:** one clause — note the pin is
unconditional and exceeds IEEE's H-digit minimum (no
long-input double-rounding allowance) — and prefer at least one
corpus witness whose decimal exceeds 20 significant digits so the
H-digit shortcut is detected, not just the one-ulp parser class.

**R2-2. DETAIL — counter 2's definition is internally ambiguous.**
Line 369–370: "filter comparisons evaluated — enumerated postings
times the declared filters actually tested." "Times" (a product)
and "actually tested" (short-circuit) contradict each other: under
short-circuit evaluation the count is not a product, and under a
product reading "actually tested" is dead words. Both readings are
partition-local, so no noninterference or paired-database claim
becomes false under either — but the counter is one of the four
compared inspection facts, so the Spec should pick one.
**Resolution:** either define counter 2 as enumerated postings ×
declared filter count (evaluation strategy free), or pin
declaration-order short-circuit testing and count comparisons
actually executed. One sentence.

**R2-3. OBSERVATION — query-vector telemetry placement.** The
query-vector custody sentence (lines 176–179) is semantically
unconditional ("Query vectors are embeddings of caller content and
are equally custody-bearing") but sits inside the paragraph opening
"When any participating field is `private`…", so a pedantic reader
could take shape-and-digest telemetry as conditional on a private
participating field, leaving raw query components loggable against
all-public indexes. The unconditional reading is clearly intended
(and is 0073's default-telemetry posture). A paragraph break or "for
every index" would close the misreading. Non-blocking.

### Verdict

**READY.**

All three MATERIAL Round-1 concerns are genuinely resolved — C1
verified against 0073's actual matrix, custody, and telemetry text
rather than a paraphrase; C2's pin is unconditional with corpus
witnesses; C3's re-attribution is sufficient, including the explicit
citation bar — and all four detail concerns are fixed as specified,
with the C4 lemma independently re-derived and confirmed valid. The
new v0.2 text (four-counter work object, scale floor, refusal code,
`l2sq` restatement, cosine preconditions) survives arithmetic and
0073-shape verification. The three new findings are detail-grade
wording items (an IEEE attribution clause, one ambiguous counter
definition, one paragraph-scoping nit); none weakens an evidence
boundary, none makes any claim false, and none blocks.

### Recommended next step

Apply R2-1 and R2-2 (two sentences plus one corpus-entry qualifier)
and optionally R2-3 in the next editorial touch — they need no
re-review from this family. Proceed to the Codex-family round-2
delta; on dual-family READY with zero unresolved MATERIAL concerns,
acceptance runs under LLP 0130 SD-4 as the Spec's review path
records.
