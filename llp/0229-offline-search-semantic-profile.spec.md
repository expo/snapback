# LLP 0229: Offline search semantic profile and conformance corpus

**Type:** Spec  
**Status:** Draft  
**Systems:** Search, Client integration, Codegen  
**Author:** Charlie Cheever / Claude  
**Date:** 2026-08-10  
**Revised:** 2026-08-10 (a — initial draft, LLP 0221 Phase 1 artifact)  
**Related:** LLP 0221 (governing RFC — Phase 1 artifact), LLP 0073 (online profile), LLP 0166 (local persistent store — completeness), LLP 0155 (local-sync direction), LLP 0131 (structured argument contracts), LLP 0126 (local-first research OQ6/OQ7), LLP 0201 (Clique benchmark), `benchmarks/briefs/social-messenger.md`

## Summary

This specification defines the semantic-profile identity, evaluator artifact format, and generated dual Rust/JavaScript conformance corpus required for offline search parity under LLP 0221. For the same semantic-profile version and the same admitted document corpus, server and local evaluators MUST produce identical matches, ordering, highlights, and work-limit outcomes.

The profile contract is exact-or-refuse. An evaluator MUST NOT silently approximate an analyzer, matcher, scorer, ordering, highlighter, work unit, counting rule, ceiling, or refusal outcome. The existing `full_text_search_v1` profile and its ordering remain unchanged. Any benchmark-compatible behavior MUST be exposed under an opt-in, versioned identity.

This document specifies the Phase 1 artifacts. The generated committed corpus and green execution in both runtimes are required proof, but are not delivered by this document alone.

## Semantic-profile identity

A semantic-profile descriptor MUST bind all behavior that can change an observable search result or refusal:

- analyzer identity and version, including Unicode data identity, normalization, case folding, token boundaries, token admission, positions, source-span provenance, and highlight expansion inputs;
- matcher and query-plan/AST semantics, including atom admission and matching rules;
- scorer and ordering identity and version, including field-weight encoding, row-id direction, any typed ordering field, and the exact tie-break sequence;
- highlighter semantics, including source-offset units and grapheme-safe expansion;
- every logical work unit, the exact rule by which each unit is counted, and every effective ceiling;
- the mapping from invalidity, unavailability, corruption, ceiling overflow, and restart conditions to stable refusal outcomes.

The descriptor MUST have one canonical JSON byte serialization. Object member names MUST be ordered lexicographically by their UTF-8 bytes; array order MUST be preserved; integers MUST be serialized as base-10 JSON integers; strings MUST use JSON string escaping; and insignificant whitespace MUST be absent. The descriptor MUST declare the hash algorithm and its version. The semantic-profile hash MUST be computed from those canonical bytes.

The semantic-profile version and hash jointly identify the contract. Any change to a bound component, work unit, counting rule, effective ceiling, refusal mapping, canonicalization rule, or hash algorithm MUST rotate the semantic-profile identity. Two evaluators MUST NOT claim the same identity if they can differ on a promised outcome.

## The shipped profile restated

The shipped capability identity is `full_text_search_v1`. This section restates its contract; it MUST NOT be interpreted as relabeling or revising it.

### Analyzer

The analyzer is `snapback-category-unicode17-v1`. It binds generated Unicode 17.0.0 normalization, full case-fold, general-category, and grapheme tables under one content digest.

Input MUST be strictly decoded as UTF-8. Malformed UTF-8 MUST be rejected, and adapters MUST reject unpaired surrogates. Before normalization, every scalar with `General_Category=Cc` and every scalar with `Default_Ignorable_Code_Point=Yes` MUST map to one U+0020 sentinel. The resulting stream MUST undergo Unicode 17 `toNFKC_Casefold`.

Letter, Number, and Mark general-category scalars are token scalars. U+0027 APOSTROPHE and U+2019 RIGHT SINGLE QUOTATION MARK are token scalars only when immediately flanked by normalized Letter or Number scalars. All other scalars—including connector punctuation, dot, hyphens, whitespace, and remaining format characters—are separators. Thus `can't` is one token under this analyzer.

A maximal run MUST emit a token only if it contains a Letter or Number and contains 1 through 64 normalized scalars. A dropped run MUST still consume a position, so phrase matching MUST NOT bridge it. The analyzer performs no stopword removal, stemming, transliteration, or locale casing.

Source provenance MUST flow through the generated normalization transducer. Expansion inherits the input interval; composition takes the smallest covering interval. Positions and source spans MUST use original Unicode-scalar offsets. Highlight expansion MUST be grapheme-safe. Each analyzer record has the shape `{fieldId, tokenBytes, position, sourceStart, sourceEnd}`.

A Unicode upgrade MUST create a new analyzer and index version. `latest` MUST NOT appear in an artifact identity.

### Matcher and query AST

The matcher binds `SearchQueryAstV1`. Match atoms are `term(value, field?)`, `phrase(values, field?)`, and `prefix(value, field?)`. A query MAY contain at most one prefix atom. Its root is one `all(children)`, with an optional single, non-nested `any(positiveMatchAtoms)`. A `not(matchAtom)` is permitted only as a direct root child. An exact `filter(field,'eq',value)` is permitted only over a declared filter field.

After `any` expansion, a query MUST contain 1 through 16 positive atoms, at most 8 exclusions, at most 8 equality filters, and depth at most 3. The grammar is anchor-preserving; complement scans are inexpressible. A term or prefix MUST analyze to exactly one nonempty token. A phrase MUST contain 1 through 16 tokens and matches an exact consecutive sequence in one field. A prefix matches the byte prefix of one canonical token and MUST be rejected below the declared scalar minimum.

### Scorer, ordering, and highlights

The scorer is `snapback-term-score-v1` and uses integer arithmetic only. For each positive atom and field it assigns:

- term: `fieldWeight * min(tf, 8) * 100`;
- prefix: `fieldWeight * min(tf, 8) * 80`;
- phrase: `fieldWeight * min(pf, 4) * 250`.

A whole-field exact-match bonus of `fieldWeight * 400` applies once for a term or phrase and never for a prefix. A profile has 1 through 16 text fields, and each authored field weight is an integer from 1 through 64. The maximum provable score is 22,937,600, which is exact in `u32` and safe in JavaScript.

Ordering is `score-desc-row-id-asc.v1`: descending score, then canonical opaque row-id bytes in the declared `id-asc` or `id-desc` direction. Row IDs carry no chronological meaning. Recency ranking is deferred to a later scorer with a declared typed timestamp. The index semantic version MUST bind scorer identity/version, field-weight encoding, and row-id direction.

Highlights MUST be derived from analyzer source provenance in original Unicode-scalar offsets and MUST be expanded to grapheme-safe boundaries.

### Limits, refusals, and result shape

`SearchIndexManifestV1` contains closed integer limit objects. `SearchQueryLimitsV1` binds:

- `max_candidate_work`, default 10,000: count distinct candidate row IDs accumulated from posting anchors and refuse when the count exceeds the ceiling;
- `max_prefix_terms`, default 256: count `COUNT(DISTINCT token)` matching the prefix in the partition and refuse when it exceeds the ceiling;
- `min_prefix_scalars`, default 2.

`SearchSourceLimitsV1` binds `max_indexed_bytes`, default 32,768; `max_tokens`, default 2,048; and `max_posting_operations`. `SearchCursorLimitsV1` binds `ttl_ms`, default 120,000, and `max_bytes`. `SearchMaintenanceLimitsV1` binds `search_maintenance_effects`, `search_posting_ops`, `search_positions`, and `search_bytes`. Request `limit` MUST be from 1 through `SEARCH_MAX_LIMIT` 50 and defaults to 20.

Work accounting is semantic and exact-or-refuse. The stable refusal codes are `SNAPBACK_SEARCH_QUERY_INVALID`, `SNAPBACK_SEARCH_WORK_LIMIT`, `SNAPBACK_SEARCH_CURSOR_RESTART`, `SNAPBACK_SEARCH_INDEX_UNAVAILABLE`, `SNAPBACK_SEARCH_INDEX_CORRUPT`, `SNAPBACK_SEARCH_SOURCE_LIMIT`, and `SNAPBACK_SEARCH_MAINTENANCE_LIMIT`.

The result shape is `SearchPageV1 {items, cursor, hasMore}` with `SearchItemV1 {rowId, score, fields, highlights}`. The server cursor format is the opaque, server-only `snapback-search-cursor-xchacha20-v1` with a 120-second TTL. A local evaluator MUST use a distinct local cursor format. Server and local cursors MUST NOT cross execution modes.

## The benchmark-compatible profile

Benchmark-compatible behavior MUST be an opt-in, versioned profile and MUST NOT alter or relabel `full_text_search_v1`. Its actual semantic deltas from the shipped profile are analyzer behavior and ordering; prefix support is not a delta because `SearchMatchAtomV1::Prefix` already ships.

The benchmark-compatible analyzer MUST normalize text to NFC, apply Unicode simple case folding, and split word boundaries on whitespace and punctuation. Internal apostrophes therefore split: `can't` analyzes as `can` followed by `t`, unlike the single-token result under `snapback-category-unicode17-v1`. Its initial benchmark fixture corpus is Latin-only; that corpus restriction MUST NOT be represented as broader Unicode parity.

The benchmark-compatible ordering MUST be newest-first over a declared typed timestamp and MUST declare an exact tie-break. Under LLP 0221 OQ4, either of two binding shapes remains permitted:

1. A new semantic profile MAY bind the benchmark analyzer, a recency scorer/ordering identity, the declared typed timestamp field and encoding, direction, and exact tie-break.
2. The declared-timestamp scorer extension anticipated by LLP 0073 MAY bind that same timestamp field and encoding, direction, and exact tie-break while the benchmark analyzer remains bound by an opt-in semantic-profile identity.

Either shape MUST fully bind all observable semantics and MUST rotate identity on any change. This specification does not choose between them. Implementation demand for this profile remains open under LLP 0221 OQ1; conformance machinery MUST NOT imply that demand has been established.

## Evaluator artifact format

Codegen MUST emit a canonical evaluator descriptor containing:

- semantic-profile name, version, and hash;
- analyzer, matcher, scorer/ordering, and highlighter bindings;
- query-plan and AST binding, including all structural and atom-admission limits;
- index declarations and text/filter field declarations, including field IDs, integer weights, row-id direction, and any declared typed timestamp and exact tie-break;
- Unicode table identity and content digest, or the declared subset admission gate;
- every logical work unit, its counting rule, every effective query, source, cursor, maintenance, request, and evaluator ceiling, and its refusal outcome mapping;
- canonical serialization identity and declared hash algorithm/version.

The artifact MUST use the canonical JSON serialization defined by this specification. Its artifact hash MUST cover the complete canonical descriptor. An evaluator MUST verify the hash before use and MUST refuse an unavailable, corrupt, or mismatched artifact with the profile-declared stable outcome.

Any artifact-hash rotation invalidates cached derived state associated with the former hash, including generated evaluator state and local derived search indexes. Such state MUST be rebuilt under the new hash or refused; it MUST NOT be silently reused.

## Conformance corpus

Codegen MUST generate a single conformance corpus consumed by both Rust and JavaScript evaluators. The corpus MUST be committed. Each vector MUST contain:

- the semantic-profile identity and evaluator-artifact hash;
- admitted input documents, including row IDs and declared field values;
- the query and request limit;
- the expected complete outcome: either the exact page result or the exact refusal;
- for a result, exact matched row IDs, scores, ordering, returned fields, highlight offsets, `hasMore`, and cursor-presence semantics;
- for a refusal, the exact stable refusal code and the work unit/count boundary that determines it.

The corpus MUST include all of the following vector classes:

- at-limit and one-over-limit vectors for every effective ceiling in the descriptor, including AST/query admission, prefix expansion, candidate work, source, cursor, maintenance, request, field/token, and evaluator ceilings;
- token-boundary vectors covering whitespace, punctuation, dropped runs, phrase positions, U+0027, U+2019, and the profile divergence for `can't`;
- normalization, full/simple case-fold, source-provenance, composition/expansion, and grapheme-safe highlight vectors as applicable to the profile;
- non-Latin vectors and edge-codepoint vectors at the Unicode table boundary for every identity claiming the full table;
- in-range, boundary, and out-of-range admission vectors for every subset identity;
- score saturation, whole-field bonus, row-id direction, typed-timestamp ordering when applicable, and every exact tie-break;
- malformed UTF-8 and unpaired-surrogate adapter refusals.

For each vector, both runtimes MUST produce byte-equivalent normalized outcomes after excluding their intentionally distinct cursor encodings. They MUST agree on matches, scores, ordering, fields, highlight offsets, pagination semantics, and refusal outcome. A runtime MUST NOT skip a vector applicable to an identity it claims.

The committed corpus plus both runtimes green on identical outcomes is the LLP 0221 Phase 1/2 execution proof. This specification defines that proof obligation; it does not claim that the corpus has been generated or that either runtime is green.

## Unicode-table subsets

LLP 0221 OQ2 remains open. A subset ships only as (a) a distinct declared semantic-profile/artifact identity, or (b) fail-closed refusal on out-of-subset input—never silent divergence under the same profile version.

A fail-closed subset is a declared input-admission gate. Conformance for that identity requires both runtimes applying the identical gate, with in-range, boundary, and out-of-range vectors. The gate, subset table identity/digest, refusal mapping, and affected input surfaces MUST be bound by the descriptor and hash.

## Non-scope

This specification does not erase the documented offline divergences in corpus coverage, freshness, authority, or continuation. Those facts remain orthogonal to semantic parity. Index custody and lifecycle are Phase 3/4 concerns under LLP 0221 and are not selected here.

LLP 0166 §D4 defines the closed answer classes. This specification adds no answer class. Partiality is expressed only through the orthogonal coverage fact. Additive facts ride only the rotated offline-capable surface; legacy `SearchPageV1` remains unchanged as required by LLP 0221 §Surfaces.

Server and local cursor formats remain distinct and MUST NOT cross execution modes. This specification does not define cross-mode cursor translation, corpus-continuation equivalence, or a shared cursor envelope.

## Open questions

- **LLP 0221 OQ1:** demand for the benchmark-compatible profile remains open.
- **LLP 0221 OQ2:** Unicode-table subset policy remains open, subject to the identity-or-fail-closed constraint in this specification.
- **LLP 0221 OQ4:** recency ordering may bind through a new profile or through LLP 0073's declared-timestamp scorer extension; either alternative MUST use the complete binding shape specified above.

These are pointers to the governing RFC's open questions, not new questions or decisions introduced by this specification.
