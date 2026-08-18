# LLP 0073: Portable full-text search

**Type:** RFC
**Status:** Implemented
**Systems:** Search, Storage, Schema, Code generation, Auth, Client integration, Admin, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-08-05 (authoring-safety clarification: visibility is a
required declaration; omission refuses with
`SNAPBACK_SEARCH_INDEX_VISIBILITY_REQUIRED`, so public release is affirmative
rather than defaulted); 2026-08-02 (Accepted LLP 0136 design fold: a separately gated
`live_full_text_search_v1` successor is registered without claiming its
unimplemented path; ordinary search remains non-live); 2026-08-01 (membership visibility amendment, commissioned by LLP 0100 §8a: third pushdown-compilable `membership` visibility variant with required equality-bound resource argument, one-snapshot seat resolution, outsider-empty ≡ nonexistent, authorization-version-bound continuations, and the two pinned post-revocation observables — see the dated section at the end). 2026-07-30 (Diary 0039 absorption, per LLP 0115 CV-5/10/11/12:
(a) numeric canonicalization pin — stored/filter scalar bytes at the
source-content digest and authoritative-release recheck boundary use RFC 8785
number spelling, matching LLP 0080's portable scalar semantics; the Pantry
rerun's `SNAPBACK_SEARCH_INDEX_CORRUPT` on integral `v.number()` values was
an implementation defect, not a contract change — the canonical digests
agreed and a representation-sensitive struct equality at the release recheck
(a strengthening beyond this RFC's specified version+partition+predicate
recheck) compared an unnormalized insert-path in-memory document against the
SQLite-reloaded row; the fix is code plus this one-sentence pin
(issues/20260730-search-real-integral-digest-corruption.md has the trace).
The code fix landed the same day: storage admission normalizes Real values
to their SQLite round-trip representation, and the release recheck compares
canonical content digests — healing pre-fix retained records with integral
spellings — while releasing the authoritative derivation.
(b) Open question 11 added: bounded range filters, the rerun's first
practical filter gap. (c) Open question 12 added: which projection surfaces
are bound by the byte-for-byte carrier-agreement acceptance bullet — the
rerun found the provider/contract projection publishing the search argument
as `unknown` while the client carrier names `SearchQueryAstV1`. (d) The
non-live posture and its `SNAPBACK_FUNCTION_NOT_LIVE` refusal are reaffirmed
as pinned contract; the rerun scored reactive search as a Convex advantage,
and a live path remains a separate future design under its own capability id
per §Implementation state.) 2026-07-27 (generated result-contract closure: search operations
now derive a closed runtime contract and operation-specific TypeScript page
from the index's exact stored-field projection, including present-null storage
optionals and the source-table row-id brand; the Signal Desk review summary no
longer reports an inapplicable degraded result). 2026-07-27 (local SQLite implementation gate complete: closes
all-participating-field classification, manifest-digest rebuilds, retired
generation purge, corruption/backup/restore, concurrent pinned-reader switch,
paired-owner observation, and preregistered large-corpus evidence; promotes
the exact SQLite capability to stable while preserving every target and
feature nonclaim below). 2026-07-27 (experimental local SQLite implementation: lands the
generated declaration/query/client surface, pinned Unicode tables and
analyzer, synchronous portable postings, exact matcher/scorer/highlights,
AEAD-bound pagination, capability facts, Guide page, and bakeoff integration;
records the remaining hardening evidence below without overstating target
support). 2026-07-27 (super-refine round-2 reconciliation: preserves
separator intent before NFKC casefold; makes exact ranking fail closed on
candidate overflow; pins field observability, `owner.v1`, cursor crypto/wire,
deterministic highlights, operation carriers, migration/rollback, journal
leases, logical-work noninterference, and opaque-id ordering). 2026-07-27
(super-refine round-1 reconciliation: narrows v1 to
bounded ordinary rows and public/owner pushdown visibility; replaces fictional
cross-request snapshots and dependency epochs with current-authority keyset
pagination; makes cursors stateless, replayable, and encrypted; closes Boolean,
Unicode analyzer, u32 score, work-accounting, overflow, tie-break, accelerator,
and target-staging defects identified independently by Fable 5 and Codex).
2026-07-27 (backend-bakeoff implementation gate: resolves the
four remaining product decisions before the author-invoked super-refine loop:
one cross-target fixed-point scorer, synchronous v1 maintenance, a 120-second
cursor with an initially proposed server quota/retention bound (superseded by
the later stateless design), and no
sensitive-field admission in v1). 2026-07-26 (author-side review application: v1 now pins
Unicode 17.0.0 and a portable pre-tokenized term/position index as match-set
authority; formalizes AST canonicalization, authorization-epoch cursor
invalidation, gap-free rebuild activation, bounded non-disclosing page work,
private-index custody, and retained-generation limits. The RFC remains Draft
and still requires independent review and executable evidence). 2026-07-20
(initial proposal for LLP 0063's chat and document pressure tests)
**Related:** LLP 0000, LLP 0004, LLP 0007, LLP 0011, LLP 0012, LLP 0018, LLP 0037, LLP 0044, LLP 0046, LLP 0051, LLP 0053, LLP 0063, LLP 0065, LLP 0068, LLP 0070, LLP 0071, LLP 0072, LLP 0080, LLP 0081, LLP 0090, LLP 0098, LLP 0099

## Summary

Snapback should expose one generated, portable full-text search profile over
declared application rows. The profile defines a small query language,
versioned tokenization, deterministic candidate identity, authorization-aware
result release, stable cursor rules, index freshness, rebuild behavior, and
capability reporting. SQLite FTS5 and PostgreSQL text search may be physical
backends, but neither backend's raw query syntax or ranking numbers become the
application contract.

The first profile, `full-text-search-v1`, supports normalized terms, quoted
phrases, required/excluded clauses, one final-input prefix, field filters,
bounded highlight fragments, score-then-id ordering, and cursor pagination. It
is an online server capability. Offline client-side search and semantic/vector
search are separate future profiles.

The v1 match-set authority is a generated portable term/position index fed by
Snapback's canonical analyzer. Each admitted target stores that same logical
index. The first implementation uses only the exact portable index and matcher:
native FTS acceleration is not part of `full-text-search-v1`. A later
separately reported accelerator may consume the already-canonical token stream
only when its candidate superset follows by construction; raw-source native
tokenization and a finite equivalence corpus cannot prove arbitrary-Unicode
superset behavior.

Search never authorizes data. Candidate rows must pass the current generated
visibility policy before any title, snippet, score, count, facet, suggestion, or
existence fact reaches a caller.

## Search declarations

Application source declares an index with:

- a stable index name and schema version;
- one ordinary source table with a stable row identity;
- weighted text fields and optional stored display fields;
- equality-filter fields from a closed scalar vocabulary;
- the fixed analyzer profile and a declared `id-desc` or `id-asc` row-id
  tie-break;
- exactly `public-read` visibility or owner visibility through one required
  string or principal field under LLP 0065's `owner.v1`;
- synchronous maintenance and a target capability requirement; and
- maximum indexed bytes, tokens, posting operations, and result window.

Generated code validates that every source field, filter, and authorization
fact exists. Every participating field is classified in the search declaration
as `public`, `private`, `sensitive`, or `forbidden`; omission is
`forbidden`, and a table-wide classification may only make the result more
restrictive. `public-read` indexes admit only `public` match, filter, score,
stored, and highlight fields. `owner.v1` indexes may admit `public` or
`private` fields because the canonical effective-user partition is both the
posting key and release authority. A classification change is a semantic
index migration and rebuild, not an in-place inspection flag.

Visibility is required in the authoring declaration. Omission refuses codegen
with `SNAPBACK_SEARCH_INDEX_VISIBILITY_REQUIRED`; codegen never interprets an
absent value as `public-read`.

Raw SQL expressions, arbitrary user tokenizers, handler-returned
opaque objects, maintained projections, document/asset extraction, and secrets
are not v1 index sources. Those later sources require a separately reviewed
delta/work profile; a document block table that is already an ordinary bounded
table may be indexed as ordinary rows, but v1 does not group block hits into a
document result.

Each declaration also generates:

- one fixed row-identity type and canonical byte encoding;
- the complete source and visibility dependency set;
- public/private/sensitive/forbidden storage classifications;
- an index storage/encryption class at least as restrictive as every indexed
  field;
- a gap-free source-version stream and per-source high-water/tombstone shape;
- fixed candidate-work, cursor-lifetime, posting-work, and query
  admission ceilings; and
- the versioned portable scorer/ordering profile.

An index version binds source schema, field weights, analyzer-table digest,
tie-break, result shape, and visibility-partition shape. Any semantic change
creates a new version and rebuild; it does not silently reinterpret old tokens.
A physical generation is one materialization of an unchanged semantic version.
A policy-artifact change that preserves the same admitted owner/public
partition shape changes release admission and current recheck identity without
pretending the token semantics changed.

## Rust-owned artifacts and operation carrier

LLP 0037 owns these closed v1 shapes and their generated JSON Schemas:

- `SearchIndexManifestV1`, stored in `TableManifest.searchIndexes`, is the
  closed object `{formatVersion, name, semanticVersion, analyzer,
  analyzerTablesDigest, textFields, equalityFilters, storedFields,
  highlightFields, visibility, tieBreak, sourceLimits, queryLimits,
  cursorLimits, maintenanceLimits}`. `textFields` is a name-keyed map whose
  closed values are `{weight, classification}`; the filter/stored/highlight members are
  name-keyed sets encoded as lexically sorted arrays; `visibility` is the
  closed tagged union `public-read | owner {field}`; `tieBreak` is exactly
  `score-desc-row-id-asc.v1`; and every limits member is a closed integer
  object named by the quantitative ceilings in this RFC. Unknown members or
  order-dependent semantic duplicates refuse;
- `SearchQueryPlanV1`, carried as
  `FunctionRuntime.HostPlan.SearchQuery`, names one installed table/index,
  parser profile, fixed result projection, and required target capability;
- `SearchQueryAstV1`, `SearchRequestV1`, `SearchPageV1`,
  `SearchItemV1`, `SearchHighlightV1`, and `SearchCursorV1` are the public
  request/result/cursor-plaintext authorities; and
- `FullTextSearchFactsV1` is the target capability/inspection projection with
  capability id `full_text_search_v1`.

JavaScript authoring uses `table.searchIndex(name, spec)` and exports a callable
operation with `defineSearchQuery({ table, index })`. The generated function
has `FunctionKind::Query`, not `FunctionKind::LiveQuery`; subscription attempts
therefore refuse with the existing `SNAPBACK_FUNCTION_NOT_LIVE` diagnostic. It
uses the existing authenticated query invocation route and envelope rather than
a new backend-specific search route. Its exact arguments are
`{ query: SearchQueryAstV1, limit?: 1..50, after?: string }`; its exact result
is `SearchPageV1`. A string convenience parser produces the AST before
invocation and is not accepted as a raw server query language. Generated
references carry the exact Args/Result phantoms and complete app/schema/
function/index/parser identities.

The existing query wire remains `QueryOutput {version, rows, cursor}` rather
than gaining a second result envelope. Storage projects `SearchItemV1` values
into `rows`, places the opaque continuation in the top-level `cursor`, and
never places a second cursor inside a row. The generated/headless
`client.search()` adapter converts that transport to the operation-level
`SearchPageV1 {items, cursor, hasMore}`, with `items = rows` and
`hasMore = cursor != null`. The generated Result phantom is `SearchPageV1`.
Direct callers of the ordinary query route observe the ordinary transport;
this projection does not change live, bundle, RQS, or other query output
schemas.

The first public client claim is callable headless query invocation in the
existing web and React Native/Expo client arms. React may invoke it as an
ordinary non-live request, but `useSnapbackQuery`, live subscriptions, RQS
register bundles, optimistic mutation stores, and offline execution do not
claim search support in v1. Invocation refuses before storage work unless the
target advertises `full_text_search_v1` with the exact semantic profile.
Stable application diagnostics include
`SNAPBACK_SEARCH_QUERY_INVALID`, `SNAPBACK_SEARCH_WORK_LIMIT`,
`SNAPBACK_SEARCH_CURSOR_RESTART`, `SNAPBACK_SEARCH_INDEX_UNAVAILABLE`, and
`SNAPBACK_SEARCH_INDEX_CORRUPT`; every carrier uses the existing structured
`Diagnostic` envelope.

## Canonical text and analyzer

The v1 analyzer is `snapback-category-unicode17-v1`. Its normative Unicode data
is Unicode 17.0.0, committed as generated normalization, full case-fold,
general-category, and grapheme tables with one content digest. The generated
tables and the algorithm below are the authority; golden vectors validate
them, not substitute for unspecified Unicode behavior. A Unicode upgrade
creates a new analyzer and index version; `latest` never appears in an artifact
identity. The Unicode Consortium's
[recent-releases register](https://www.unicode.org/releases/) records 17.0.0 as
the current stable Standard on this amendment date; prospective 18.0 data is not
admitted.

The reference analyzer:

1. strictly decodes byte sources as UTF-8 and rejects malformed bytes; adapters
   receiving UTF-16 strings reject unpaired surrogates rather than replacing
   them differently;
2. before normalization, maps every Unicode `General_Category=Cc` scalar and
   every scalar with Unicode 17.0.0
   `Default_Ignorable_Code_Point=Yes` to one U+0020 SPACE sentinel. It then
   runs Unicode 17.0.0 `toNFKC_Casefold`. Mapping first preserves a separator
   where casefold would otherwise delete ZWJ, LRM, ZWNJ, variation selectors,
   or another default ignorable and accidentally concatenate neighboring token
   scalars. The generated provenance transducer maps that sentinel to the
   original scalar interval;
3. scans the normalized scalars without invoking UAX #29 default word
   boundaries. `Letter`, `Number`, and `Mark` categories are token scalars.
   U+0027 APOSTROPHE and U+2019 RIGHT SINGLE QUOTATION MARK are token scalars
   only when immediately flanked by normalized `Letter` or `Number` scalars.
   Every other scalar — including connector punctuation, dot, remaining format
   characters, all hyphens, and whitespace — is a separator. Thus
   `foo_bar`, `example.com`, and `a<LRM>b` become two tokens rather than an
   underspecified joined segment;
4. treats each maximal run under rule 3 as one candidate position. A run emits
   only if it contains a `Letter` or `Number` and contains 1 through 64
   normalized scalars. An empty/mark-only or overlength run is dropped but
   still consumes one position, so phrase matching never bridges it. No token
   is truncated or split;
5. carries source provenance through the generated normalization transducer:
   an expansion inherits its input scalar's half-open source interval; a
   composition inherits the smallest interval covering every contributing
   scalar; reordering retains each output scalar's contributing interval.
   The token span is the smallest interval covering all of its output
   scalars. This generated transducer, including stable-boundary buffering and
   its Unicode-table digest, is part of the analyzer artifact;
6. emits monotonically increasing per-field positions and source spans in
   original Unicode-scalar offsets before grapheme-safe highlight expansion;
7. applies no stopword removal, stemming, transliteration, locale-sensitive
   casing, or extra diacritic folding; and
8. preserves bounded original text only when highlights are declared.

Language stopwords, stemming, and locale-specific analysis are later named
profiles. This keeps phrase positions and match sets portable in v1.

The analyzer output is a closed sequence of
`{fieldId, tokenBytes, position, sourceStart, sourceEnd}` records. Generated
canonical bytes, generated Unicode tables, and corpus hashes are the semantic
oracle. The v1 adapter indexes these canonical records directly. A future
accelerator must consume those records through a trivial closed tokenizer whose
superset property follows by construction; it cannot retokenize raw source.

HTML and rich content are not indexed by regex stripping. An application may
store a bounded plain-text field in an ordinary row and index it. Document
frontier projection under LLP 0068 and asset extraction under LLP 0044 remain
outside synchronous v1 until a later profile defines their stable delta,
grouping, and global work contract.

## Query language

The generated client accepts a structured query AST; a convenience parser may
produce it from a string. The AST vocabulary is:

- `term(value, field?)`;
- `phrase(values, field?)`;
- `prefix(value, field?)`, with at most one prefix atom per query;
- one root `all(children)`, whose positive children are match atoms or one
  non-nested `any(positiveMatchAtoms)` and whose exclusions are
  `not(matchAtom)` direct children;
- exact `filter(field, 'eq', value)` direct children over declared filter
  fields; and
- optional `after` cursor and result limit.

The parser rejects unmatched quotes, unknown fields/operators, empty positive
queries, prefix shorter than the declared minimum, clauses above limits,
wildcards in other positions, regex, raw backend syntax, and unbounded negation.
Values are analyzer inputs, never syntax fragments.

`term`, `phrase`, and `prefix` are match atoms. V1 is deliberately
anchor-preserving: the root is one `all`; every direct positive atom is
required; an optional `any` child requires at least one of its positive atoms;
and every `not` is a direct root child containing exactly one match atom.
`not` beneath `any`, negation of `all`/`any`/`filter`, double negation, nested
`all`/`any`, and a query without a positive match atom are rejected. The root
has 1–16 positive atoms after expanding its optional `any`, at most 8
exclusions, at most 8 equality filters, and depth at most 3. Every legal query
can therefore begin from a bounded positive posting anchor; complement scans
are not expressible.

Analysis must produce exactly one nonempty token for `term` and `prefix`.
`phrase` analysis must produce 1–16 tokens; phrase truth requires the exact
consecutive token sequence within one field. Phrase occurrences may overlap;
frequency is counted independently per atom and field before its scorer cap. A
prefix matches the byte prefix of one canonical token and is rejected below the
declaration's scalar minimum. Prefix frequency is the total occurrence count of
all canonical tokens that match the prefix in that field, capped by the scorer.
Equality filters use LLP 0080's portable exact scalar semantics and binary
encoding. `eq null` is not admitted because null never matches under that
authority; future null tests require separately declared
`isNull`/`isNotNull` operators. Range/date filtering is outside v1.

The string parser permits `*` only on the last positive lexical input, which
produces the AST's sole prefix atom. `-atom` produces a direct conjunctive
exclusion; `OR` creates the one flat positive `any`. It rejects an exclusion in
an OR branch and any syntax that cannot normalize to the closed shape above.

Canonicalization canonicalizes atoms and filter values, sorts the root
positive, optional-any, exclusion, and filter sets independently by canonical
bytes, and removes duplicates within each set. If the same positive atom is
both a direct root child and inside `any`, the direct required occurrence wins
and the `any` copy is removed; it contributes once. If the same positive atom
is also excluded, validation rejects the query instead of inventing a score.
Domain-separated canonical AST bytes are the query/filter hash used by cursors
and caches. Parser version, analyzer version, examined-anchor bounds, and
golden accepted/rejected vectors are committed artifacts; changing any parse
or reduction result creates a new parser profile.

## Ranking, order, and cursors

The portable v1 scorer is `snapback-term-score-v1`. It deliberately avoids
floating point and corpus statistics so a target upgrade cannot silently
reorder the same result set. One index has 1–16 text fields; every field weight
is an authored unsigned integer from 1 through 64. For each positive atom and
field, the scorer adds an unsigned contribution:

- term: `fieldWeight * min(termFrequency, 8) * 100`;
- prefix: `fieldWeight * min(termFrequency, 8) * 80`;
- phrase: `fieldWeight * min(phraseFrequency, 4) * 250`; and
- an exact whole-field match adds `fieldWeight * 400` once. This bonus applies
  only when the field's complete normalized token sequence byte-equals the
  positive `term` or `phrase` atom sequence; a prefix never receives it.

The root contributes every matched direct positive atom and every matched atom
inside its optional `any` once; exclusions and equality filters contribute
zero. Canonical duplicates are removed before scoring. The generated maxima
prove the public score is at most 22,937,600, so the score is an exact portable
u32 and JavaScript-safe JSON integer; saturation is neither needed nor allowed.
Results order by descending portable score and then by canonical opaque row-id
bytes in the declaration's `id-desc` or `id-asc` direction. No chronological
meaning is inferred from an ID; an application that needs recency ranking
requires a later scorer with a declared typed timestamp. The initial Guide
defaults chat-like indexes to `id-desc`, but the choice is authored and
version-bound. Targets therefore return the same order for the same current
index state.

An index version binds scorer id/version, field-weight encoding, and canonical
row-id direction. A scorer or direction change creates a new semantic index
version, not merely a physical generation.

A cursor uses `snapback-search-cursor-xchacha20-v1`: the wire is
`sbsc1.<base64url-no-pad(nonce || ciphertext || tag)>`, with a fresh
cryptographic 24-byte nonce and XChaCha20-Poly1305. A domain-separated
HKDF-SHA-256 key derives from the target cursor key generation. Associated data
is the unambiguous frame
`UTF8("snapback:search-cursor:v1\n") || u32be(len(appIdBytes)) || appIdBytes ||
u32be(len(targetProfileIdBytes)) || targetProfileIdBytes`. The
canonical RFC 8785 plaintext is the closed `SearchCursorV1` object. It binds
app, database, target profile, stream/restore epoch, index semantic version,
active physical generation, the canonical **query core** hash, requested page
limit, authority instance, `owner.v1` effective-user subject when applicable,
release-policy digest, exact score, returned authorized row-id bytes, row-id
direction, cursor-key generation, issued-at, and expiry. The query core excludes
the `after` member and page limit, avoiding self-reference; the limit is bound
as its own plaintext member.

The boundary is always the last row actually released to this authority; an
unauthorized scan boundary never enters a client token. Authenticated
encryption keeps even that visible boundary from becoming an ambient inspection
surface. The complete encoded cursor is at most 2,048 bytes. Decoders accept
only the current key generation and explicitly configured predecessors whose
verification overlap has not outlived the 120-second TTL. Wrong identity,
query, limit, policy, authority, generation, expiry, reset, wire version, size,
or key generation fails closed with `SNAPBACK_SEARCH_CURSOR_RESTART`.

V1 deliberately does **not** promise snapshot-stable pagination across
requests. Each page evaluates the current active generation and current
visibility, then resumes strictly after the prior released `(score, rowId)`
key. It guarantees no duplicate and no omitted result whose indexed text,
filters, visibility partition, score, and row-id are unchanged across the page
boundary. A concurrent insert before the boundary is not revisited; a changed
row may move, disappear, or appear later. This is the same honest keyset bound
as LLP 0080, not a retained transaction disguised as generation retention.

The v1 cursor TTL is 120 seconds. Replay is side-effect-free, not
response-stable: current-state changes may change the page while preserving the
keyset guarantees above. Issuing the next page replaces rather than accumulates
application cursor state because the server retains none. Generated type-ahead
clients discard superseded tokens. Rebuild activation invalidates
old-generation cursors with the restart code rather than retaining a mutable
generation as a fictional snapshot. Cursor-key rotation names generations and
a bounded verification overlap; cursor state is not a durable lease, is not
single-use, and imposes no per-authority cursor quota. Random nonces mean two
equivalent cursors need not have byte-identical ciphertext; the security oracle
compares successful decode class, plaintext shape, encoded length, and absence
versus presence, never nonce bytes.

Scores are informational. Applications must not use them as authorization,
moderation, pricing, or other correctness inputs.

The generated `SearchPageV1` result is closed:
`{items, cursor, hasMore}`. Each item is
`{rowId, score, fields, highlights}` where `fields` has exactly the declared
stored scalar/display fields and `highlights` is the bounded array described
below. `cursor` is a string or null; `hasMore` is true exactly when that safe
cursor exists. Generated JSON Schema and TypeScript
types use the same declaration-order object encoding, exact u32 score, and
row-id type on every target. Unknown fields fail schema validation.

## Authorization and result release

V1 admits exactly two pushdown-compilable visibility shapes. `public-read`
stores one constant visibility partition. `owner` is exactly LLP 0065's
`owner.v1`: it stores the canonical effective-user subject from one required
string or principal field as the visibility partition and queries only the
current effective user's partition. Anonymous, service, admin-bypass, system,
or other invocation classes that do not resolve an LLP 0065 canonical
effective-user subject refuse ordinary owner search; a separately authorized
admin-search profile cannot smuggle that authority into v1. Provider,
delegation, tenant, impersonation, and authority-instance changes therefore
change the cursor/cache identity even when the user id string is unchanged.

That partition is part of every posting access key, so hidden owners' postings
are not traversed to fill or bound a page. Membership joins, blocks, moderation
relations, opaque policies, and other multi-row visibility shapes are not v1
search declarations even if an ordinary query can enforce them.

Partition pushdown narrows work but never authorizes release. Within the same
pinned per-request application snapshot that produces a page, the server reads
each candidate's current authoritative source row, proves that its indexed
source version and partition equal the posting, and evaluates the generated
public/owner predicate before returning any field or existence fact. An
implementation may strengthen that recheck to the full source content, but the
comparison is over RFC 8785 canonical bytes/digests — never in-memory value
representation, which is not part of the contract (an integral Real
legitimately spells `5` in a retained record and `5.0` after a SQLite reload)
— and the released fields come from the authoritative derivation, not the
retained payload. The local implementation does exactly this: it proves the
retained record matches its own content digest and that digest matches the
one recomputed from the authoritative row. A
visibility-field or indexed-content change rewrites the posting synchronously
with the source mutation. Authority-instance, policy-artifact, reset, restore,
or generation changes invalidate the cursor; ordinary owner-row changes need
no fictional dependency epoch because every page uses current source state and
current authority.

The application observation boundary covers returned rows and scores, cursor
presence/encoded length and decoded canonical plaintext, `hasMore`,
refusal/status codes, prefix admission, and ordinary inspection. Paired
databases differing only in an unauthorized matching row produce identical
semantic observations across that boundary; randomized cursor nonce/ciphertext
bytes are excluded as specified above.

Page evaluation is exact or refuses before releasing a page. It scans only the
caller's visibility partition in deterministic canonical posting order and
must exhaust every candidate capable of matching the query before sorting the
exact top page. One query may examine at most the declaration's deterministic
logical posting/position/source-read ceiling. Encountering the next unit beyond
that ceiling returns `SNAPBACK_SEARCH_WORK_LIMIT` with no rows, cursor, or
partial order; v1 has no resumable candidate-scan frontier and never releases a
page whose unseen candidates could outrank it. Per-row release recheck failure
is storage drift and fails closed with one generic restart/corruption outcome
rather than continuing past a hidden boundary. Scoped audited administration
may inspect drift and physical work separately.

The semantic claim is value/code/continuation-shape, termination-insensitive
noninterference at that boundary, not constant-time execution. Work-limit
termination depends only on counted logical units in the caller's partition and
is part of paired evidence. A wall-clock timeout, process cancellation, or
machine loss is coupled nondeterminism outside the semantic transcript: it
releases no result envelope or cursor and is not compared as an
authorization-derived application code. Different physical caches and page
layouts may affect bounded latency; no target may report a stronger timing or
termination-sensitive noninterference claim without separate evidence.
Prefix-frequency admission is computed within the same visibility partition
and returns one bucketed capacity diagnostic that does not expose another
partition's vocabulary.

Total counts, facets, autocomplete, spell correction, and "did you mean" can
leak hidden vocabulary. The base profile returns no total count, facets,
autocomplete, spell correction, or suggestions. Those require later
authorization-safe profiles. `hasMore` means only that a safe continuation
exists; it is not an estimate of hidden or total matches.

Index storage is app/database/target/stream scoped. Cross-tenant, cross-user,
cross-target, old-stream, and moderator-bypass searches use independent
authorization and cache identities. Admin search is an explicit audited profile,
not an ordinary query flag.

Search admission uses the existing trusted request/authority envelope and
applies per-index query, authorized-candidate-work, prefix-frequency, and
concurrency ceilings. It does not depend on Draft LLP 0071's application-safety
profile for correctness; a target may compose those later admission limits as a
separate capability. Timeout or cancellation releases a fenced work
reservation, releases no page bytes, and uses the existing transport
interruption class rather than a backend- or authorization-specific application
diagnostic.

## Index maintenance

The portable v1 profile is synchronous: source commit and searchable index
generation advance in one transaction. An index declaration includes maximum
indexed bytes/tokens per source, maximum posting operations per changed source,
and maximum aggregate search work per commit. Its field bounds become generated
write validators, and activation preflights every existing row; an over-bound
legacy row refuses activation rather than becoming an indexed row that cannot
later be edited. A post-activation mutation whose final value exceeds the bound
is an ordinary validation refusal. Index maintenance or aggregate-work failure
rolls back the complete source mutation with a stable diagnostic. Accepted rows
are searchable at their commit head; no stale-success state exists.

`boundedAsync` is reserved for a later named profile governed with LLP 0070.
Large-document and asset extraction work is therefore outside v1 rather than a
second freshness dialect hidden inside it.

Deletes and owner-visibility changes update or remove v1 index entries in the
same source transaction. A failure rolls back that complete transaction. A
later asynchronous or relational-visibility profile must retain a fail-closed
obligation rule: restrictive changes block affected release until acknowledged,
while permissive changes may lag without leaking data.

Every update has an idempotent `(indexVersion, sourceId, sourceVersion)`
identity. `sourceVersion` is the gap-free application commit/version authority.
Every generation retains a per-source highest-applied version and deletion
tombstone through the maximum rebuild, rollback, and retry horizon. An update
applies by CAS; older work cannot overwrite a newer source version or resurrect
a tombstone.

Search work composes globally rather than one index at a time. The existing
1,024 application/projection-row mutation ceiling remains unchanged. In
addition, one mutation may perform at most 4,096 internal search posting
insert/delete operations, visit at most 8,192 canonical token positions, and
write at most 256 KiB of search bytes across every changed source row and every
active search index. Replacing one source's per-index search document counts as
one unit against a new `searchMaintenanceEffects` ceiling of 1,024 across the
mutation; it does not consume one of the existing 1,024
application/projection rows because it is fully internal derived state. Each
physical posting insert/delete counts against `searchPostingOps`. Thus a
mutation already writing the maximum 1,024 application/projection rows remains
admissible with one indexed source update when the search posting, position,
byte, and maintenance-effect ceilings also pass. Generation validates a static
per-row bound; mutation planning computes the exact union of old/new posting
keys and refuses before any write when the aggregate would exceed a ceiling.
Activation considers all existing search indexes and LLP 0080 maintained
projections; it cannot admit a combination whose minimum single-row maintenance
path is already over a global ceiling.

Maintained projections, document/asset extraction, and authorization-only
relations remain outside v1. This keeps a membership or account-wide moderation
change from implying an unbounded posting rewrite and leaves their delta,
grouping, and async work semantics to a later reviewed profile.

## Rebuilds and migrations

An analyzer, source-schema, field/classification, weight, tie-break, or
visibility-shape change requires an LLP 0081 migration plan and approval
receipt binding predecessor/successor index versions, analyzer/parser/scorer/
policy digests, target capability, activation, and rollback posture. Execution,
however, is the search-owned `derived-search-catchup.v1` executor defined here,
not LLP 0081's `exclusive-single-writer.v1` executor or closed step vocabulary.
This is an intentional derived-data specialization: it changes no application
row, rewinds no application head, and emits no application action, job, webhook,
payment, or other external effect. It may therefore build a new index generation
beside the active one while application lanes remain open. The builder reads a
fixed source snapshot, records cursor/progress and corpus hashes, catches up
through the gap-free application change journal, verifies full ordered
source/token digests, then atomically activates the generation. Its receipt
records the governing LLP 0081 plan/approval identity and names
`derived-search-catchup.v1` as the actual executor profile; a generic LLP 0081
executor must refuse this search-specific step.

Starting a build acquires a renewable journal-floor lease at or before the
fixed snapshot head. Pruning may not cross that floor while the lease is valid.
If the lease expires, the journal reports a gap, or catch-up falls behind the
available floor, the candidate is quarantined and must restart from a fresh
snapshot; activation cannot guess completeness.

The change stream is gap-free in application commit order. Activation:

1. records the fixed build snapshot head;
2. consumes and verifies every relevant change through a candidate source head;
3. acquires a bounded index-generation switch fence;
4. re-reads the authoritative source head and consumes every remaining relevant
   change through it;
5. refuses while any gap or unsafe quarantine blocks that head;
6. CASes the active generation and routes later source commits to it before
   releasing the fence; and
7. marks the predecessor rollback-eligible only until the first later source
   commit, and restarts all predecessor cursors.

Deploy compatibility declares which releases can query and maintain each
generation. Because activation switches only fully derived bytes and cannot
rewind an application or external effect, the search-specific fast-rollback
guard is exactly “no source commit maintained only in the successor generation
since activation,” not LLP 0081's broader no-work-passed-the-fence guard. Before
such a successor-only source commit, rollback may CAS the verified predecessor
back under the same bounded index fence while ordinary application lanes remain
open. The first later source commit atomically marks that predecessor stale and
ineligible, after which its private bytes are retired under the deletion policy.
A later rollback request must
rebuild/replay the predecessor semantics through the current source head,
verify it, and activate it as a new physical generation; search remains
unavailable for that version until this completes. V1 never activates a stale
predecessor, dual-maintains a hidden rollback generation, or treats source-row
rechecks as completeness. Activation never points a release at an index whose
query/parser or visibility digest it cannot interpret.

A versioned search admission epoch lists the exact query/parser and maintainer
artifact digests allowed for each generation. Deployment activation changes
that set under the control-plane fence; every query and update presents its
artifact digest. Point-in-time compatibility inspection without enforced
admission cannot satisfy the profile.

At corruption, the system keeps source data authoritative, reports search
degraded, and can rebuild. Under synchronous v1, a source mutation is rejected
when required index maintenance cannot commit, and the whole source transaction
rolls back. There is no alternate per-index overflow policy hidden in this
profile.

Backups may omit fully derivable index bytes if the manifest records all source,
analyzer, projection, and policy artifacts needed to rebuild. Restore keeps
search unavailable or explicitly stale until rebuild/catch-up and authorization
verification complete. A new restore/stream epoch invalidates every old cursor,
cache key, generation admission, and worker fence.

## Highlights and private data

Highlights are generated from already authorized stored display fields or a
fresh authorized source read. They return bounded plain-text fragments and
canonical match ranges, never backend-generated HTML. The client chooses markup
and must escape text.

Each result contains at most three `SearchHighlightV1` values:
`{field, text, matches}`. `field` is a declared highlight field name;
`text` is at most 256 UTF-8 bytes; `matches` is 1–8 non-overlapping
`{start, end}` scalar-offset pairs relative to `text`. Candidate occurrences
order by field declaration, original source start, longer source span first,
then canonical atom bytes. Overlapping/touching occurrences merge. The builder
selects the first uncovered occurrence and ignores it when its smallest
enclosing grapheme sequence alone exceeds 256 UTF-8 bytes. For an eligible
occurrence, the fragment begins as that smallest enclosing grapheme sequence.
It then alternates adding one complete preceding grapheme and one complete
following grapheme, beginning on the left, while that side remains within 48
source scalars of the occurrence and the addition keeps the fragment at or
below 256 bytes. A blocked side is skipped and expansion continues on the
other side. This pins grapheme snap direction, side priority, and trimming
without implementation-dependent choices. Further occurrences inside that
fragment merge into its `matches`; otherwise the next occurrence
starts the next fragment. A prefix highlight spans the complete matched token,
and a phrase spans from its first token start through its last token end. These
rules and limits are version-bound.

The analyzer's source-span map uses Unicode scalar offsets in the authorized
original field. Highlight assembly expands spans to pinned Unicode 17.0.0
extended-grapheme boundaries, extracts a bounded fragment, and returns ranges
relative to that fragment. It never splits a grapheme or crosses a declared
field boundary. Golden vectors cover compatibility expansion, combining
marks, right-to-left text, emoji sequences, apostrophes/hyphens, and field
boundaries.

Search declarations classify fields as public, private, sensitive, or forbidden
under the fail-closed rule in `Search declarations`.
Forbidden fields cannot enter tokens, stored display text, diagnostics, corpus
fixtures, or query logs. Private/sensitive query strings and result fields use
redacted logging; default telemetry stores query shape and digest, not raw text.

Private fields may enter owner-only v1 indexes only when index bytes, term vocabulary, stored
display text, caches, backup posture, and administrative access have a storage
and encryption class at least as restrictive as the source. Sensitive fields
are rejected from v1 indexing on every target; admitting them requires a later
named profile with separately proven key custody and cryptographic-erasure
behavior. Term dictionaries and frequency metrics are private data when any
contributing source is private.

Deleting source content and completing its retention policy removes searchable
tokens, highlights, cached pages, active/rollback generations, build artifacts,
and backup-derived indexes. The rollback horizon limits how long an old
generation may delay deletion; cursor expiry alone never retains one. When source backup
retention outlives searchable retention, restore reconciliation reapplies the
deletion/key manifest before rebuilding. Audit may retain an event identity/hash
under LLP 0071, not the searchable content itself.

## Adapter contract and capabilities

The physical adapter implements schema/version install, transactional
upsert/delete, current-state keyset query, visibility-partition pushdown,
candidate pagination, score, corpus verification, rebuild, activation,
inspection, backup/restore posture, and corruption recovery.

The implementation sequence is explicit:

1. publish the shared analyzer/AST/matcher/scorer artifacts and golden corpus;
2. implement the exact logical term/position/source contract on SQLite;
3. qualify the same SQLite adapter inside
   `single-instance-container-vm.v1` independently;
4. after Draft LLP 0046's store-seam prerequisite lands, implement PostgreSQL
   and require the same corpus before that target reports support; and
5. consider optional accelerators only as separate capabilities over canonical
   pre-tokenized input whose superset translation is proved by construction.

SQLite plus a hosted profile using SQLite do not constitute two storage-engine
implementations, but they may each report the v1 capability after their own
runtime/authorization evidence. PostgreSQL is an explicit GAP until step 4; it
does not block the local v1 implementation. Backend-native analyzers and
extensions such as stemming, typo tolerance, vectors, or provider ranking are
separate named capabilities and cannot change the base profile silently.

Capabilities and the Guide first add an explicit GAP row, then report
analyzer/version/table digest, query operators,
synchronous mode, `current-keyset-v1` pagination, maximum
source/query/result/posting-work sizes, freshness,
highlight support, count/facet/suggestion support, rebuild behavior, offline
availability, authorization filter class, portable matcher identity,
accelerator identity (`none` in v1), scorer/u32 bound, cursor TTL, private-data
storage class, and corruption posture.

Integrity verification covers generated schema, analyzer tables, source
frontiers, per-source high-water/tombstones, term/position rows, scorer
inputs, and generation root. A failed check quarantines the generation,
invalidates its cursors with the coded restart outcome, fails closed for
affected queries, and rebuilds from authoritative source; it never serves a
possibly corrupt match set as current.

## Implementation state

The repository contains the implemented local SQLite profile of the
portable v1 slice. Codegen owns the closed `.searchIndex(...)` declaration and
`defineSearchQuery(...)` plan; generated API references name the structured
request/page carriers. Each operation's effective result contract closes the
transport row over exactly its declared stored fields, and the generated page
type preserves that stored-field shape plus the source-table row-id brand
through `client.search()` without a cast. Rust owns manifest validation, the
generated Unicode-17 analyzer tables and digest, AST canonicalization, exact
integer scoring, grapheme-safe highlights, synchronous transactional source/posting
maintenance, generation activation, posting-anchored bounded query execution,
current-source/owner recheck, and XChaCha20-Poly1305/HKDF cursors. The
framework-neutral client supplies structured builders and the versioned small
string parser. Capability inspection reports this exact surface only for local
SQLite at stable maturity, with the explicit nonclaims in this RFC.

Executable evidence covers analyzer normalization and expansion,
AST canonicalization, scorer/highlight/cursor primitives, maintained posting
queries with equality filters, deterministic ranking, highlights, pagination,
tamper refusal, owner partitioning and cross-owner cursor refusal, parser
accepted/rejected shapes, generated manifest admission, and the backend
bakeoff's seeded incident-search path. The local gate additionally covers the
closed classification carrier for every non-text participating field,
classification-only manifest-digest rebuilds, atomic retired-generation
purge, corruption refusal, verified file backup/restore, a pinned reader
across concurrent generation activation, paired databases differing only in
another owner's matching row, and preregistered build/query budgets over a
deterministic corpus. The Guide documents authoring, invocation, diagnostics,
bounds, and nonclaims using CI-verified snippets.

PostgreSQL and remote-service targets remain unsupported; the separately
specified live-search successor and offline search,
relational visibility, native acceleration, sensitive fields, and counts,
facets, or suggestions remain explicit nonclaims. Those targets or features
must earn independent capability ids or the exact v1 target corpus before
advertisement.

## Acceptance

The implementation must retain executable evidence that:

- the pinned Unicode 17.0.0 multilingual, malformed-input, normalization,
  punctuation/category, case, pre-normalization Cc/default-ignorable separator,
  adjacent deleted-scalar, ZWJ/LRM/ZWNJ/variation-selector, compatibility
  expansion, combining-mark, overlength-run, overlapping phrase,
  prefix, exclusion, equality-filter, provenance-map, and malformed-query
  corpus produces byte-identical
  analyzer/AST/match/u32-score/order/highlight output
  through the semantic oracle and every claimed target adapter;
- metamorphic cases cover canonical child permutation/deduplication,
  normalization equivalence, Boolean accepted/rejected shapes, and injection
  strings that cannot escape the structured AST into SQL syntax;
- inserts, updates, owner transfers, deletes, rollback, restart, tombstone
  retention, aggregate search-work refusal, and generation activation preserve
  source/index identity and gap-free frontiers;
- public/owner pushdown plus current authoritative recheck prevents all newly
  forbidden title/snippet/score/existence leakage; paired databases differing
  only by another owner's matching rows are identical across rows, decoded
  cursor plaintext/encoded length, cursor presence, `hasMore`, prefix
  admission, logical-work-limit codes, and ordinary inspection; randomized
  nonce bytes and coupled wall-clock interruptions are tested only to the
  explicitly weaker claim;
- an `owner.v1` transfer between pages releases no stale field or existence
  fact even though LLP 0053's global authorization version need not advance;
  public-read generation rejects any non-public participating field, and a
  field-classification change requires migration/rebuild;
- cross-user/app/database/target/stream/restore-epoch cursors and cache entries
  fail closed, and tampering, expiry, AEAD-key rotation/revocation, generation
  activation, or version mismatch produces the coded safe restart;
- current-state keyset pagination proves no duplicate or omission for untouched
  results across adversarial insert/update/delete boundaries while documenting
  the allowed movement of changed rows; cursor replay is side-effect-free and a
  type-ahead sequence cannot exhaust server cursor capacity;
- candidate sets at, below, and one above each logical work ceiling prove that
  exact score order is released only after all viable candidates are exhausted;
  overflow returns no partial page, `hasMore`, cursor, or resumable frontier;
- synchronous bounded ordinary rows are searchable at their commit head;
  activation refuses legacy over-bound rows, authored overflow is a validation
  error, and injected posting-capacity/maintenance failure rolls back the
  complete source mutation;
- concurrent rebuild and source writes activate a verified generation with no
  lost update under the switch fence, release admission rejects incompatible
  query/maintainer artifacts, journal-floor loss restarts the build, rollback
  before the first later source commit uses the verified predecessor, and
  rollback afterward rebuilds to current source state before activation;
- a large pinned chat/table corpus meets preregistered index size, build,
  update, query-latency, memory, authorized-candidate, and posting-work budgets;
- forbidden fields, raw query text, and unauthorized snippets never enter index
  bytes, logs, diagnostics, receipts, backups, or public metrics; private terms
  and highlights remain inside their declared encrypted/access-controlled
  custody across active, rebuild, rollback, cache, inspection, and backup paths;
- deletion/retention enforcement, cursor expiry, rollback-generation retirement,
  restore reconciliation, and cache purge remove the pinned private fixture
  from every searchable artifact; and
- backup, destroy/replace, restore, rebuild, and corruption recovery reproduce
  the pinned visible-result corpus and authorization behavior; and
- Rust-owned manifest/request/result/cursor/capability schemas, codegen
  builders, generated Args/Result refs, query dispatch, structured
  diagnostics, client-arm nonclaims, Guide GAP/positive rows, and target
  inspection agree byte-for-byte on the declared profile.

The v1 pressure test covers an owner-partitioned message/incident table,
ownership/visibility changes, pagination, prefix type-ahead, and message search.
Membership joins, blocks, moderation relations, grouped document results,
large-document extraction, comments/sharing relations, async frontiers,
PostgreSQL, the separately specified live-search successor, and native
accelerators are explicit nonclaims until their own evidence lands.
Each target receipt names its exact adapter/runtime profile, analyzer/table
digest and Unicode version, index and policy digests, source heads,
corpus/result hashes, effective limits, metrics, and every nonclaim.

## Non-goals and claim boundary

This RFC does not provide semantic/vector search, embeddings, typo tolerance,
arbitrary fuzzy matching, raw backend query syntax,
global web search, analytics aggregation, or offline client search. It does not
make opaque server functions automatically searchable. Ordinary v1 search
also excludes live subscriptions; Accepted LLP 0136 specifies a separately
gated successor without changing this operation. V1 excludes
membership/relational visibility, maintained or extracted
projections, result grouping/collapsing, document-level aggregation, range
filters, retained cross-request snapshots, native FTS acceleration, and
asynchronous maintenance.

Database-specific FTS calls or application-side filter loops do not satisfy
this implemented profile. Every additional target still requires its own
maintainer acceptance and executable target-specific evidence.

## Open questions

1. **Resolved:** `snapback-term-score-v1` is a cross-target integer scorer
   bounded to an exact public u32; there is no native accelerator in v1.
2. **Resolved:** v1 is synchronous and rolls back the source mutation when
   bounded index work cannot commit. Async maintenance is a later profile.
3. **Resolved:** 120-second stateless XChaCha20-Poly1305 cursors implement
   current-state keyset pagination; no cursor quota, retained transaction,
   response-stable replay, or predecessor generation is implied.
4. **Resolved:** sensitive fields are excluded from v1 on every target;
   public-read admits public fields only, owner-only indexes may admit private
   fields under matching custody, and omission is forbidden.
5. **Resolved:** v1 visibility is public or LLP 0065 `owner.v1` pushdown with
   current authoritative release recheck; LLP 0053's epoch is not asked to
   witness ordinary membership or row changes.
6. **Resolved:** the Unicode 17 generated category analyzer, its transducer, and
   its content digest are normative for every scalar; goldens validate them.
7. **Resolved:** local SQLite can implement v1 before PostgreSQL; each target
   reports independent corpus evidence and PostgreSQL remains a GAP until LLP
   0046's prerequisite lands.
8. **Resolved:** exact ranking exhausts the viable candidate set inside a
   deterministic logical-work ceiling or releases no page; v1 has no partial
   `workLimited` page or candidate-scan cursor.
9. **Resolved:** semantic changes use LLP 0081; fast predecessor rollback ends
   at the first successor-only source commit, after which rollback rebuilds to
   current source state under a journal-floor lease.
10. **Resolved:** Rust-owned `Search*V1` artifacts, a non-live ordinary query
    plan/reference, existing query dispatch, and capability id
    `full_text_search_v1` are the v1 public carrier.
11. **Open (2026-07-30, Diary 0039):** bounded range filters. The Pantry arm
    needed a client-side numeric projection because v1 filters are
    equality-only; ranges are the first practical extension. Any design must
    respect the version-binding rule (a new operator vocabulary is a new
    parser profile and semantic index version), the positive-anchor
    invariant (complement scans stay inexpressible), and the cursor
    query-core hash. Tracked as LLP 0115 CV-12a; null tests remain the only
    other queued filter extension.
12. **Open (2026-07-30, Diary 0039):** carrier scope of the byte-for-byte
    agreement bullet. The client carrier names `SearchQueryAstV1` concretely,
    but the provider/contract projection emitted the search argument as
    `unknown` in the rerun. Decide whether that projection is one of this
    RFC's byte-for-byte carriers (making the `unknown` a violated acceptance
    bullet) or a Contract-owned surface (making it a cross-document wiring
    item). Either way the repair is propagation of the existing LLP
    0037-owned schema, not new type design. Tracked as LLP 0115 CV-5.

## 2026-08-01 amendment: membership visibility (commissioned by LLP 0100 §8a)

**Commissioning authority:** LLP 0100 (Accepted) §8a routes membership-visible
search to this RFC as a dated amendment and pins the interface; the ticketed
inexpressible case is
`issues/closed/20260801-0137-a3-search-visibility-cannot-express-membership.md`.
This section is append-only over the v1 text above: where the Search
declarations and Authorization sections say the visibility union is exactly
`public-read` and `owner`, and that membership joins are not v1 search
declarations, this amendment adds the third pushdown-compilable variant those
sections reserved. Everything else in the v1 contract — analyzer, scoring,
work ceilings, non-live posture, observation boundary — is unchanged and
applies to the new variant verbatim.

### The third visibility variant

`SearchVisibilityV1` gains `{ kind: 'membership', declaration, resourceField,
roles }` (crates/snapback/src/search/types.rs; authoring surface
`packages/snapback-codegen/define.mjs`, same closed-union gate). `declaration`
names a resource-scoped LLP 0100 membership declaration; app-scoped
declarations are refused at generation. `resourceField` names a required
scalar (String/Principal/Id) field on the source table; it is the partition
key source exactly as `owner`'s field is, and is folded into the declared
non-text participating fields. `roles`, when present, is a non-empty
deduplicated subset of the declaration's role vocabulary and admits only
those seats (`hasRole`); absent means any non-pending seat (`memberOf`).
The posting partition is `membership:{resourceValue}` beside `public` and
`owner:{subject}`; hidden partitions' postings are never traversed to fill
or bound a page, exactly as for owner. Membership indexes admit `public` and
`private` field classifications under the same reasoning as `owner.v1`: the
partition plus seat check is both posting key and release authority.

### The routed wire interface (LLP 0100 §8a pins honored)

- **Required equality-bound resource argument.** The generated
  membership-visible search function carries one additional required argument
  (declared `resourceArg` at authoring) beside the unchanged
  `SearchRequestV1` `{query, limit?, after?}` shape; the wire decision is a
  new generated-function argument, not an extension of the committed request
  schema, so the LLP 0037-owned `search.request.schema.json` and its fixture
  corpus are untouched. Every invocation addresses one singular
  `membership:{declaration, resource-value}` partition.
- **Multi-seat traversal is rejected**, per LLP 0100 §8a's own reasons: one
  resource value per invocation; seat enumeration belongs to
  `_snapback.myMemberships`; cross-resource ranking across deliberately
  independent partitions is not a v1 surface. A caller searching several
  resources iterates its own seats.
- **Seat resolution and posting recheck share one snapshot.** The caller's
  seat for `(declaration, resource-value)` is resolved by a direct read of
  the declaration's membership table on the same pinned per-request
  connection that serves posting candidates and the authoritative-row release
  recheck; the per-candidate recheck re-proves the current row's
  `resourceField` partition as it does for owner. The caller principal is the
  LLP 0065 canonical effective-user subject, required exactly as owner search
  requires it; invocation classes without one refuse with the same
  `SNAPBACK_SEARCH_QUERY_INVALID` class refusal (not a membership oracle).
- **Outsider-empty ≡ nonexistent, byte-identical.** A caller with no
  admitted seat receives the empty success page through the same code path
  as a search over a nonexistent resource value: same rows, cursor absence,
  `hasMore`, and bytes. Absence of a seat is never a refusal.

### Continuation identity (the §5 authorization binding)

The search continuation for a membership search binds, beyond the v1 cursor
identity list: the concrete resource value, the declaration id, the admitted
role set, and the durable authorization version pair
(`AuthorizationVersion {incarnation, epoch}`) read from the same snapshot at
mint. On presentation the decoded values must equal the current invocation's
values and the **current** authorization version; any mismatch is the
existing uniform `SNAPBACK_SEARCH_CURSOR_RESTART`, refused before candidate
evaluation, byte-identical across causes. Because every committed membership
write advances the authorization version, a continuation minted before a
revocation always fails custody; that a non-membership-related membership
write also restarts a continuation is accepted over-invalidation — restart
from the first page is the ordinary recovery and discloses nothing.

### The two post-revocation observables (both pinned, distinct)

1. **Stale continuation** minted before the revocation → the uniform
   invalid-continuation custody refusal, pre-evaluation
   (`SNAPBACK_SEARCH_CURSOR_RESTART`), the epoch-bound observable LLP 0100
   §1 scopes as an accepted disclosure.
2. **Fresh search** after the revocation → success with the empty page,
   byte-identical to the outsider and nonexistent-resource results — the
   non-disclosing steady state.

### Acceptance (mandatory rows, one per observable)

Member cross-owner visibility within a resource; outsider-empty
byte-identical to nonexistent-resource; roles-filtered admission; partition
pushdown bound into cursors; paired observations across resources
non-interfering; revocation zeroes the next fresh search (observable 2);
stale continuation after revocation refuses uniformly pre-evaluation
(observable 1); generation-time refusals for unknown declarations,
app-scoped declarations, out-of-vocabulary roles, and a membership index
whose generated function lacks the required resource argument.

## LLP 0136 acceptance fold — 2026-08-02

Accepted LLP 0136 registers the design for a separately authored
`defineLiveSearchQuery` operation under `live_full_text_search_v1`. It pairs
`FunctionKind::LiveQuery` with the unchanged `SearchQueryPlanV1`, re-executes
the bounded first page on table-granular invalidation, and delivers full
authorized pages on the replace lane. Its v1 scope is first-page-only and
non-auth-scoped; sessions-mode `owner.v1` refuses pending a negotiated
successor. The ordinary `defineSearchQuery`, its `FunctionKind::Query`, and
its `SNAPBACK_FUNCTION_NOT_LIVE` refusal are unchanged. Delta delivery,
finer wake precision, continuation-page liveness, auth-scoped live search,
retention/resume, and offline search remain nonclaims. The design is accepted
but unimplemented; capability publication still requires LLP 0136's complete
target evidence.
