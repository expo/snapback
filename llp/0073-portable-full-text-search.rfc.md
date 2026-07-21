# LLP 0073: Portable full-text search

**Type:** RFC
**Status:** Draft
**Systems:** Search, Storage, Schema, Code generation, Auth, Live Queries, Offline, Background work, Admin, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-07-20 (initial proposal for LLP 0063's chat and document pressure tests)
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
phrases, required/excluded clauses, final-token prefix, field filters, bounded
highlight fragments, score-then-id ordering, and cursor pagination. It is an
online server capability. Offline client-side search and semantic/vector search
are separate future profiles.

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

An index version binds source schema, field weights, analyzer, stopword set,
normalization, synonym set if any, projection code digest, and visibility-policy
digest. Any change creates a new version and rebuild; it does not silently
reinterpret old tokens.

## Canonical text and analyzer

The v1 canonical analyzer is intentionally narrow:

1. validate UTF-8 and replace disallowed control characters with spaces;
2. apply Unicode normalization and locale-independent case folding using a
   pinned Unicode data version;
3. segment on the pinned Unicode word-boundary rules with explicit handling for
   apostrophe and hyphen;
4. retain letter/number tokens from 1 through 64 Unicode scalars;
5. apply the declared language's pinned stopword set, or `simple` with none;
6. do no stemming in the portable base profile; and
7. preserve original bounded text separately only when highlights are declared.

The exact Unicode version and all tables are generated corpus artifacts. A
backend-native analyzer can accelerate candidate selection only if the adapter
proves equivalence against that corpus; otherwise the target reports a distinct
nonportable analyzer profile.

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
- `prefix(value, field?)`, allowed only on the final positive clause;
- `all`, `any`, and `not` with bounded depth and clause count;
- exact `filter(field, op, value)` over declared filter fields; and
- optional `after` cursor and result limit.

The parser rejects unmatched quotes, unknown fields/operators, empty positive
queries, prefix shorter than the declared minimum, clauses above limits,
wildcards in other positions, regex, raw backend syntax, and unbounded negation.
Values are analyzer inputs, never syntax fragments.

Default matching requires every positive clause and excludes every negative
clause. A phrase requires consecutive canonical tokens within one field.
Prefix matches a canonical token prefix. Filters use LLP 0004's portable scalar,
null, and ordering semantics.

## Ranking, order, and cursors

Each backend computes a nonnegative relevance score from term frequency,
document frequency, field weights, phrase boost, and exact-match boost. The
portable contract does not require identical floating scores or identical order
between SQLite and PostgreSQL. Within one index version, target, and immutable
query snapshot, results order by descending backend score, then ascending stable
row id.

A cursor contains an opaque server-MACed binding to app, database, target,
stream, index/version, query/filter hash, authorization projection identity,
snapshot head, score-order key, row id, and expiry. It contains no query text or
secret in plaintext. Wrong identity, policy/version, query, expiry, reset, or
snapshot fails closed and asks the caller to restart.

The first page pins a search snapshot head. Subsequent pages read the same
physical index generation when the target can retain it. A target that cannot
provide snapshot-stable pagination reports `search.pagination.snapshotStable:
Missing`; its cursor is best-effort and cannot satisfy the v1 profile. The
profile requires no duplicate/omitted rows within the pinned snapshot.

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

Page filling may overfetch bounded candidate batches after authorization removes
rows. It stops at the requested visible limit, index exhaustion, or a declared
work ceiling. Hitting the work ceiling returns a partial page with a continuation
cursor and a structured `authorizationFiltered` fact, not an estimate of hidden
matches.

Total counts, facets, autocomplete, spell correction, and "did you mean" can
leak hidden vocabulary. The base profile returns no total count, facets, or
suggestions unless they are computed solely over rows already proved visible
under the same snapshot and work ceiling. `hasMore` means only that a safe
continuation exists.

Index storage is app/database/target/stream scoped. Cross-tenant, cross-user,
cross-target, old-stream, and moderator-bypass searches use independent
authorization and cache identities. Admin search is an explicit audited profile,
not an ordinary query flag.

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
state exposes `indexedThrough`, source head, oldest pending age, and target
freshness objective. They cannot call a stale result current.

Deletes and newly restrictive visibility changes take the fail-closed path:
either the source transaction removes/blocks index release synchronously or a
pending obligation prevents potentially affected search responses until
acknowledged. Newly permissive changes may lag without leaking data.

Every update has an idempotent `(indexVersion, sourceId, sourceVersion)` identity.
Out-of-order older work cannot overwrite a newer source version. Extraction and
projection failures quarantine the source, report the diagnostic, and preserve
the last index version only when its visibility remains safe.

## Rebuilds and migrations

An analyzer, projection, field, weight, or visibility change builds a new index
generation beside the active one. The builder reads a fixed source snapshot,
records cursor/progress and corpus hashes, catches up through the ordinary
obligation stream, verifies counts and sampled source/token hashes, then
atomically activates the generation.

Deploy compatibility declares which releases can query and maintain each
generation. Rollback retains the prior generation until the declared window
closes. Activation never points a release at an index whose query/parser or
visibility digest it cannot interpret.

At capacity or corruption, the system keeps source data authoritative, reports
search degraded, and can rebuild. It does not drop source writes silently. A
profile may choose to reject a source mutation when synchronous indexing cannot
commit, but that policy must be declared and the whole source transaction rolls
back.

Backups may omit fully derivable index bytes if the manifest records all source,
analyzer, projection, and policy artifacts needed to rebuild. Restore keeps
search unavailable or explicitly stale until rebuild/catch-up and authorization
verification complete.

## Highlights and private data

Highlights are generated from already authorized stored display fields or a
fresh authorized source read. They return bounded plain-text fragments and
canonical match ranges, never backend-generated HTML. The client chooses markup
and must escape text.

Source declarations classify fields as public, private, sensitive, or forbidden.
Forbidden fields cannot enter tokens, stored display text, diagnostics, corpus
fixtures, or query logs. Private/sensitive query strings and result fields use
redacted logging; default telemetry stores query shape and digest, not raw text.

Deleting source content and completing its retention policy removes searchable
tokens, highlights, cached pages, and rebuild artifacts. Audit may retain an
event identity/hash under LLP 0071, not the searchable content itself.

## Adapter contract and capabilities

The physical adapter implements schema/version install, transactional or
obligation-based upsert/delete, snapshot query, candidate pagination, score,
corpus verification, rebuild, activation, inspection, backup/restore posture,
and corruption recovery.

The initial adapters are SQLite FTS5 and PostgreSQL text search or an explicitly
implemented portable inverted index. Each must prove the canonical analyzer and
query corpus. Backend extensions such as stemming, typo tolerance, vectors, or
provider ranking are separate named capabilities and cannot change the base
profile silently.

Capabilities report analyzer/version, query operators, synchronous/async mode,
snapshot-stable pagination, maximum source/query/result sizes, freshness,
highlight support, count/facet/suggestion support, rebuild behavior, offline
availability, and authorization filter class.

## Acceptance

The implementation must retain executable evidence that:

- the pinned multilingual Unicode, punctuation, case, stopword, phrase, prefix,
  exclusion, filter, and malformed-query corpus has the same match set on
  SQLite and PostgreSQL; ranking differences are reported and stable per target;
- injection strings cannot escape the structured AST into FTS/SQL syntax;
- inserts, updates, deletes, rollback, duplicate/out-of-order obligations,
  worker restart, and generation activation preserve source/index identity;
- permission, membership, block, and moderation changes prevent all newly
  forbidden title/snippet/score/count/facet/suggestion/existence leakage before
  active clients can observe stale results;
- cross-user/app/database/target/stream cursors and cache entries fail closed,
  and cursor tampering/expiry/version mismatch restarts safely;
- authorized overfetch returns complete visible pages within the work ceiling,
  partial pages say why, and snapshot pagination has no duplicate or omitted row;
- synchronous chat messages are searchable at their commit head, while document
  and asset async fixtures expose precise stale/frontier state and catch up;
- concurrent rebuild and source writes activate a verified generation with no
  lost update, and rollback uses a compatible retained generation;
- a large pinned chat/document corpus meets preregistered index size, build,
  update, query-latency, memory, and authorization-overfetch budgets;
- forbidden/private fields, raw query text, and unauthorized snippets do not
  enter logs, diagnostics, receipts, backups, or public metrics; and
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

1. Is a portable inverted index simpler than proving a pinned analyzer across
   FTS5 and PostgreSQL for the first implementation?
2. Which Unicode data version and language profiles should v1 pin?
3. Should exact visible counts remain outside v1 even for simple partitioned
   authorization?
4. Is `synchronous` indexing for chat worth source-write failure at index
   capacity, or should chat use a fail-closed bounded-async frontier too?
