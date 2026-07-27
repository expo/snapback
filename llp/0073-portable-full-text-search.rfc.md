# LLP 0073: Portable full-text search

**Type:** RFC
**Status:** Draft
**Systems:** Search, Storage, Schema, Code generation, Auth, Live Queries, Offline, Background work, Admin, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-07-26 (author-side review application: v1 now pins
Unicode 17.0.0 and a portable pre-tokenized term/position index as match-set
authority; formalizes AST canonicalization, authorization-epoch cursor
invalidation, gap-free rebuild activation, bounded non-disclosing page work,
private-index custody, and retained-generation limits. The RFC remains Draft
and still requires independent review and executable evidence). 2026-07-20
(initial proposal for LLP 0063's chat and document pressure tests)
**Related:** LLP 0000, LLP 0004, LLP 0007, LLP 0011, LLP 0012, LLP 0018, LLP 0037, LLP 0046, LLP 0051, LLP 0053, LLP 0063, LLP 0068, LLP 0070, LLP 0071

## Summary

Snapback should expose one generated, portable full-text search profile over
declared application projections. The profile defines a small query language,
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
Snapback's canonical analyzer. SQLite and PostgreSQL store that same logical
index. Native FTS facilities may produce a candidate superset, but the portable
matcher decides term, phrase, prefix, exclusion, and filter truth before
authorization. Backend-native analyzers are separate nonportable capabilities;
a finite conformance corpus alone cannot make their behavior authoritative for
arbitrary Unicode input.

Search never authorizes data. Candidate rows must pass the current generated
visibility policy before any title, snippet, score, count, facet, suggestion, or
existence fact reaches a caller.

## Search declarations

Application source declares an index with:

- a stable index name and schema version;
- one source table or a generated projection with a stable row identity;
- weighted text fields and optional stored display fields;
- exact filter/facet fields from a closed scalar vocabulary;
- language/analyzer profile and per-field normalization;
- a visibility policy compatible with generated authorization evaluation;
- update mode, freshness objective, and target capability requirement;
- maximum source bytes, tokens, and result window; and
- optional document or asset extraction producer.

Generated code validates that every source field, projection dependency,
filter, and authorization fact exists. Raw SQL expressions, arbitrary user
tokenizers, handler-returned opaque objects, and secrets are not index sources.

Each declaration also generates:

- one fixed row-identity type and canonical byte encoding;
- complete source-projection dependency and read sets;
- public/private/sensitive/forbidden storage classifications;
- an index storage/encryption class at least as restrictive as every indexed
  field;
- a gap-free source-version stream and per-source high-water/tombstone shape;
- fixed candidate-work, cursor-lifetime, generation-retention, and query
  admission ceilings; and
- a versioned scorer/ordering profile, even though ranking need not match other
  targets.

An index version binds source schema, field weights, analyzer, stopword set,
normalization, synonym set if any, projection code digest, and visibility-policy
digest. Any change creates a new version and rebuild; it does not silently
reinterpret old tokens.

## Canonical text and analyzer

The v1 analyzer is `snapback-simple-unicode17-v1`. Its normative Unicode data is
Unicode 17.0.0, committed by content digest with generated tables and golden
vectors. A Unicode upgrade creates a new analyzer and index version; `latest`
never appears in an artifact identity. The Unicode Consortium's
[recent-releases register](https://www.unicode.org/releases/) records 17.0.0 as
the current stable Standard on this amendment date; prospective 18.0 data is not
admitted.

The reference analyzer:

1. strictly decodes byte sources as UTF-8 and rejects malformed bytes; adapters
   receiving UTF-16 strings reject unpaired surrogates rather than replacing
   them differently;
2. maps every Unicode `General_Category=Cc` scalar to U+0020 SPACE;
3. applies Unicode 17.0.0 `toNFKC_Casefold` in that order, preserving
   diacritics except where that normative mapping changes them;
4. segments using Unicode 17.0.0 default word-boundary rules, with U+0027
   APOSTROPHE and U+2019 RIGHT SINGLE QUOTATION MARK retained as an internal
   joiner only when immediately flanked by letter/number scalars, and U+002D,
   U+2010, and U+2011 hyphens always acting as separators;
5. emits tokens containing at least one Unicode letter or number, with internal
   combining marks and admitted apostrophes, from 1 through 64 normalized
   Unicode scalars;
6. emits monotonically increasing token positions and a source-span map in
   Unicode scalar offsets before grapheme-safe highlight expansion;
7. applies no stopword removal, stemming, transliteration, locale-sensitive
   casing, or diacritic folding in the portable v1 profile; and
8. preserves bounded original text only when highlights are declared.

Language stopwords, stemming, and locale-specific analysis are later named
profiles. This keeps phrase positions and match sets portable in v1.

The analyzer output is a closed sequence of
`{fieldId, tokenBytes, position, sourceStart, sourceEnd}` records. Generated
canonical bytes and corpus hashes are the semantic oracle. A native FTS index
may accelerate only by returning a superset that the portable term/position
matcher reduces; it cannot replace the oracle.

HTML and rich content are not indexed by regex stripping. A generated source
projection supplies plain text and maps canonical offsets back to allowed
display fragments. LLP 0068 documents index visible block text and selected
attributes from a named document frontier. LLP 0044 assets may contribute
trusted extracted metadata only after their processing state and extractor
version are durable.

## Query language

The generated client accepts a structured query AST; a convenience parser may
produce it from a string. The AST vocabulary is:

- `term(value, field?)`;
- `phrase(values, field?)`;
- `prefix(value, field?)`, with at most one prefix atom per query;
- `all(children)`, `any(children)`, and `not(child)` with bounded depth and
  clause count;
- exact `filter(field, op, value)` over declared filter fields; and
- optional `after` cursor and result limit.

The parser rejects unmatched quotes, unknown fields/operators, empty positive
queries, prefix shorter than the declared minimum, clauses above limits,
wildcards in other positions, regex, raw backend syntax, and unbounded negation.
Values are analyzer inputs, never syntax fragments.

`term`, `phrase`, and `prefix` are match atoms. `all` is conjunction, `any` is
disjunction, and `not` is Boolean negation over its one child. Every AST must
contain at least one match atom outside any `not`; a filter does not satisfy that
requirement. `all` and `any` have 1–16 children, `not` cannot contain only
filters, and the complete tree has at most 32 match atoms and depth 4.

Analysis must produce exactly one nonempty token for `term` and `prefix`.
`phrase` analysis must produce 1–16 tokens; phrase truth requires the exact
consecutive token sequence within one field. A prefix matches the byte prefix of
one canonical token and is rejected below the declaration's scalar minimum.
Filters use LLP 0004's portable scalar/null semantics and the index's generated
canonical scalar encoding.

The string parser permits `*` only on the last positive lexical input, which
produces the AST's sole prefix atom. The structured AST may place that atom
inside any positive subtree; ordering has no semantic effect.

Canonicalization recursively canonicalizes atoms and filter values, sorts
`all`/`any` children by canonical bytes, removes exact duplicate children,
retains `not` structure, and rejects a tree that becomes empty. Domain-separated
canonical AST bytes are the query/filter hash used by cursors and caches. Parser
version, analyzer version, and golden accepted/rejected vectors are committed
artifacts; changing any parse or reduction result creates a new parser profile.

## Ranking, order, and cursors

Each backend computes a nonnegative relevance score from term frequency,
document frequency, field weights, phrase boost, and exact-match boost. The
portable contract does not require identical floating scores or identical order
between SQLite and PostgreSQL. Within one index version, target, and immutable
query snapshot, results order by descending backend score, then ascending stable
row id.

An index generation binds backend engine/build, scorer id/version, field-weight
fixed-point encoding, corpus-statistics digest, finite-score quantizer, and
canonical row-id order. The adapter maps its internal score to a nonnegative
unsigned 64-bit relevance key with a versioned deterministic quantizer; the
display score, if exposed, is informational. Equal keys use canonical row-id
bytes. A backend upgrade or changed quantizer creates a new generation.

A cursor contains an opaque server-MACed binding to app, database, target,
stream/restore epoch, index/version/generation, query/filter hash, authority
instance, authorization dependency epoch, snapshot head, exact relevance key,
row-id bytes, cursor-key generation, and expiry. It contains no query text,
private field, or secret in plaintext. Wrong identity, policy/authority epoch,
query, expiry, reset, retired generation, or snapshot fails closed with a coded
restart outcome.

The first page pins a search snapshot head. Subsequent pages read the same
physical index generation when the target can retain it. A target that cannot
provide snapshot-stable pagination reports `search.pagination.snapshotStable:
Missing`; its cursor is best-effort and cannot satisfy the v1 profile. The
profile requires no duplicate/omitted rows within the source and authorization
snapshot fixed by page one.

The v1 cursor TTL is at most 300 seconds. A generation remains queryable for its
last cursor TTL plus declared clock skew, subject to per-authority cursor
admission and a bounded generation-retention cap. Cursors are not durable
leases. Capacity or key revocation may retire a generation early only by
returning the same coded restart outcome; it cannot continue from a different
snapshot. Cursor MAC key rotation names generations and a bounded verification
overlap.

Scores are informational. Applications must not use them as authorization,
moderation, pricing, or other correctness inputs.

## Authorization and result release

Search declarations name a generated visibility predicate whose complete data
and authorization dependencies are inspectable. Index rows may carry only
coarse partition keys derived from non-secret authoritative fields. A partition
key narrows candidates but never proves release.

For every candidate the server evaluates current row/resource visibility under
LLP 0053 before returning any field or existence fact. Permission and moderation
changes commit index-invalidation obligations. Until the corresponding search
generation acknowledges the obligation, the query either rechecks authoritative
facts candidate by candidate or fails closed; it never serves a stale permissive
index entry.

The first page evaluates visibility at one application snapshot and binds the
complete generated authorization-dependency epoch and authority instance into
the cursor. Any relevant permission, membership, block, moderation, session,
authority-instance, or policy transition advances that epoch. A later page with
an epoch mismatch restarts before candidate evaluation, regardless of whether
the change appears permissive or restrictive. This deliberately favors a
simple fail-closed invariant over trying to splice current authority into an old
result order. The server still rechecks candidate visibility inside the pinned
page transaction; authorization never comes from an index partition alone.

Page filling may overfetch bounded candidate batches after authorization removes
rows. It stops at the requested visible limit, index exhaustion, or a declared
work ceiling. Hitting the work ceiling returns a partial page with a continuation
cursor and a generic `workLimited` fact. Public results never distinguish
authorization rejection from ordinary candidate work, never expose rejected
counts, and use declared fixed/bucketed candidate batches. Detailed filter
counts are available only through scoped audited administration.

Total counts, facets, autocomplete, spell correction, and "did you mean" can
leak hidden vocabulary. The base profile returns no total count, facets,
autocomplete, spell correction, or suggestions. Those require later
authorization-safe profiles. `hasMore` means only that a safe continuation
exists; it is not an estimate of hidden or total matches.

Index storage is app/database/target/stream scoped. Cross-tenant, cross-user,
cross-target, old-stream, and moderator-bypass searches use independent
authorization and cache identities. Admin search is an explicit audited profile,
not an ordinary query flag.

Search admission consumes LLP 0071's staged trusted identity and applies
per-index query, candidate-work, prefix-frequency, retained-cursor, and
concurrency ceilings. Timeout or cancellation releases a fenced work
reservation and returns no backend- or authorization-specific public
diagnostic.

## Index maintenance

Ordinary table-backed indexes update transactionally with their source mutation
or record a durable index obligation in that transaction. The declaration
chooses:

- `synchronous`: source commit and searchable index generation advance together;
  or
- `boundedAsync`: source commit enqueues durable work and publishes a pending
  generation/freshness fact.

The first chat profile requires synchronous indexing for bounded message text so
accepted messages are searchable at the commit head. Large documents and asset
extraction may use bounded asynchronous indexing through LLP 0070. Their query
state exposes a gap-free source head, obligation-consumed head, complete-visible
head, oldest pending age, quarantine count, and target freshness objective.
Public state never identifies a quarantined private source. A generation cannot
call itself current beyond its complete-visible head.

Deletes and newly restrictive visibility changes take the fail-closed path:
either the source transaction removes/blocks index release synchronously or a
pending obligation prevents potentially affected search responses until
acknowledged. Newly permissive changes may lag without leaking data.

Every update has an idempotent `(indexVersion, sourceId, sourceVersion)` identity.
`sourceVersion` is the gap-free application commit/version authority. Every
generation retains a per-source highest-applied version and deletion/visibility
tombstone through the maximum job, rebuild, cursor, rollback, and retry horizon.
An update applies by CAS; out-of-order older work cannot overwrite a newer source
version or resurrect a tombstone.

A generated projection reads all declared table and authorization dependencies
at one source snapshot. A dependency mutation transactionally identifies every
affected source row or emits a bounded rebuild-required obligation when exact
fan-out is unavailable. Extraction and projection failures quarantine the
source, report a coded private diagnostic, and preserve an earlier indexed
version only when current authoritative visibility proves it safe. A failed
restrictive update blocks release for the affected scope.

## Rebuilds and migrations

An analyzer, projection, field, weight, or visibility change builds a new index
generation beside the active one. The builder reads a fixed source snapshot,
records cursor/progress and corpus hashes, catches up through the ordinary
obligation stream, verifies counts and sampled source/token hashes, then
atomically activates the generation.

The obligation stream is gap-free in application commit order. Activation:

1. records the fixed build snapshot head;
2. consumes and verifies every obligation through a candidate source head;
3. acquires a bounded index-generation switch fence;
4. re-reads the authoritative source head and consumes every remaining
   obligation through it;
5. refuses while any gap or unsafe quarantine blocks that head;
6. CASes the active generation and routes later source commits to it before
   releasing the fence; and
7. retains the predecessor only for compatible rollback and unexpired cursors.

Deploy compatibility declares which releases can query and maintain each
generation. Rollback retains the prior generation until the declared window
closes. Activation never points a release at an index whose query/parser or
visibility digest it cannot interpret.

A versioned search admission epoch lists the exact query/parser and maintainer
artifact digests allowed for each generation. Deployment activation changes
that set under the control-plane fence; every query and update presents its
artifact digest. Point-in-time compatibility inspection without enforced
admission cannot satisfy the profile.

At capacity or corruption, the system keeps source data authoritative, reports
search degraded, and can rebuild. It does not drop source writes silently. A
profile may choose to reject a source mutation when synchronous indexing cannot
commit, but that policy must be declared and the whole source transaction rolls
back.

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

The analyzer's source-span map uses Unicode scalar offsets in the authorized
original field. Highlight assembly expands spans to pinned Unicode 17.0.0
extended-grapheme boundaries, extracts a bounded fragment, and returns ranges
relative to that fragment. It never splits a grapheme or crosses a declared
rich-document block. Golden vectors cover compatibility expansion, combining
marks, right-to-left text, emoji sequences, apostrophes/hyphens, and document
block boundaries.

Source declarations classify fields as public, private, sensitive, or forbidden.
Forbidden fields cannot enter tokens, stored display text, diagnostics, corpus
fixtures, or query logs. Private/sensitive query strings and result fields use
redacted logging; default telemetry stores query shape and digest, not raw text.

Private fields may enter v1 only when index bytes, term vocabulary, stored
display text, caches, backup posture, and administrative access have a storage
and encryption class at least as restrictive as the source. Sensitive fields
add a target capability requiring separately proven key custody and
cryptographic-erasure behavior; otherwise they are rejected from v1 indexing.
Term dictionaries and frequency metrics are private data when any contributing
source is private.

Deleting source content and completing its retention policy removes searchable
tokens, highlights, cached pages, active and retained generations, build
artifacts, and backup-derived indexes. The bounded cursor/rollback horizon
limits how long old generations may delay deletion. When source backup
retention outlives searchable retention, restore reconciliation reapplies the
deletion/key manifest before rebuilding. Audit may retain an event identity/hash
under LLP 0071, not the searchable content itself.

## Adapter contract and capabilities

The physical adapter implements schema/version install, transactional or
obligation-based upsert/delete, snapshot query, candidate pagination, score,
corpus verification, rebuild, activation, inspection, backup/restore posture,
and corruption recovery.

The initial SQLite and PostgreSQL adapters implement the same generated portable
term/position/source table contract and exact matcher. SQLite FTS5 and
PostgreSQL text search may serve as optional candidate-superset accelerators
only; the adapter proves no false negative against the portable matcher and
reduces every candidate through the exact contract. A failed equivalence check
disables the accelerator without changing results. Backend-native analyzers and
extensions such as stemming, typo tolerance, vectors, or provider ranking are
separate named capabilities and cannot change the base profile silently.

Capabilities report analyzer/version, query operators, synchronous/async mode,
snapshot-stable pagination, maximum source/query/result sizes, freshness,
highlight support, count/facet/suggestion support, rebuild behavior, offline
availability, authorization filter class, portable matcher identity, optional
accelerator identity, scorer/quantizer, cursor TTL/generation cap, private-data
storage class, and corruption posture.

Integrity verification covers generated schema, analyzer tables, source
frontiers, per-source high-water/tombstones, term/position rows, scorer
statistics, and generation root. A failed check quarantines the generation,
invalidates its cursors with the coded restart outcome, fails closed for
affected queries, and rebuilds from authoritative source; it never serves a
possibly corrupt match set as current.

## Acceptance

The implementation must retain executable evidence that:

- the pinned Unicode 17.0.0 multilingual, malformed-input, normalization,
  punctuation, case, phrase, prefix, exclusion, filter, offset-map, and
  malformed-query corpus produces byte-identical analyzer/AST/match output on
  SQLite and PostgreSQL; ranking differences are reported and stable within
  their bound generation;
- native FTS accelerators have no false negatives against the portable oracle,
  disabling either accelerator leaves match results unchanged, and injection
  strings cannot escape the structured AST into FTS/SQL syntax;
- inserts, updates, deletes, rollback, duplicate/out-of-order obligations,
  worker restart, tombstone retention, projection-dependency fan-out, and
  generation activation preserve source/index identity and gap-free frontiers;
- permission, membership, block, and moderation changes prevent all newly
  forbidden title/snippet/score/count/facet/suggestion/existence leakage before
  active clients can observe stale results, and every relevant authorization
  epoch change restarts an existing cursor before candidate evaluation;
- cross-user/app/database/target/stream/restore-epoch cursors and cache entries
  fail closed, and tampering, expiry, MAC rotation/revocation, generation
  retirement, or version mismatch produces the coded safe restart;
- authorized overfetch returns complete visible pages within the work ceiling,
  partial pages expose only generic bounded-work state, timing/count fields do
  not disclose rejected candidates, and snapshot pagination has no duplicate or
  omitted row within the pinned source/authorization snapshot;
- synchronous chat messages are searchable at their commit head, while document
  and asset async fixtures expose precise non-disclosing stale/frontier state,
  quarantine unsafe failures, and catch up;
- concurrent rebuild and source writes activate a verified generation with no
  lost update under the switch fence, release admission rejects incompatible
  query/maintainer artifacts, and rollback uses a compatible retained generation;
- a large pinned chat/document corpus meets preregistered index size, build,
  update, query-latency, memory, and authorization-overfetch budgets;
- forbidden fields, raw query text, and unauthorized snippets never enter index
  bytes, logs, diagnostics, receipts, backups, or public metrics; private terms
  and highlights remain inside their declared encrypted/access-controlled
  custody across active, rebuild, rollback, cache, inspection, and backup paths;
- deletion/cryptographic-erasure, cursor expiry, old-generation retirement,
  restore reconciliation, and cache purge remove the pinned private fixture
  from every searchable artifact; and
- backup, destroy/replace, restore, rebuild, and corruption recovery reproduce
  the pinned visible-result corpus and authorization behavior.

The chat pressure test must cover channel history, membership change, block,
moderation, pagination, and message search. The document test must cover block
updates, large-document windows, comments, sharing changes, and async frontier.
Their receipts name target/adapters, analyzer and Unicode versions, index and
policy digests, snapshot heads, corpus/result hashes, effective limits, metrics,
and every nonclaim.

## Non-goals and claim boundary

This RFC does not provide semantic/vector search, embeddings, typo tolerance,
arbitrary fuzzy matching, raw backend query syntax, exact cross-database ranking,
global web search, analytics aggregation, or offline client search. It does not
make opaque server functions automatically searchable.

While this RFC is Draft, database-specific FTS calls or application-side filter
loops cannot satisfy LLP 0063's full-text prerequisite. Maintainer acceptance
and executable target-specific evidence are both required.

## Open questions

1. Which deterministic relevance scorer/quantizer should the first SQLite and
   PostgreSQL generations use, given that cross-target ranking equivalence is
   intentionally not a v1 claim?
2. Is `synchronous` portable-term indexing for bounded chat messages worth
   source-write failure at index capacity, or should chat use a fail-closed
   bounded-async frontier too?
3. What per-authority cursor and generation-retention ceilings preserve useful
   pagination without allowing resource pinning?
4. Should the first accepted profile exclude `sensitive` fields even on a
   target whose encryption and cryptographic-erasure capability is separately
   proven?
