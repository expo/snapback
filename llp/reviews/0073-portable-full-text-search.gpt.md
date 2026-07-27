**Reviewer family:** GPT (author-side pass; not independent)
**Provider / runtime:** OpenAI Codex API agent
**Date:** 2026-07-26
**Redacted:** no
**Method:** manual

# Review of LLP 0073: Portable full-text search

This is an author-side critical pass over the committed Draft at Snapback
`a215647d036f7f04e52767b216bbc0e9c3af2e32`. Because the draft is attributed
to Charlie Cheever / Codex, this review does **not** count as the independent
cross-family review appropriate for a portable query, authorization, and index
maintenance protocol.

## Overall assessment

The RFC chooses the right product boundary: generated declarations, a small
structured language, pinned analysis, backend-private scoring,
authorization-after-candidate-selection, honest freshness, generation rebuilds,
and no semantic-search overclaim. It also correctly treats snippets, counts,
facets, and suggestions as potential authorization leaks.

Several contracts remain too loose for two adapters to implement the same
profile. The query AST has no formal reduction semantics; the analyzer does not
pin normalization and punctuation rules precisely; native FTS5/PostgreSQL
analyzers are unlikely to be equivalent without pre-tokenization; and
snapshot-stable pagination conflicts with current authorization changes between
pages. The rebuild and async-frontier protocols also need gap-free activation
rules. These must close before implementation.

## Strengths

- `## Search declarations` makes the complete index, analyzer, projection, and
  visibility dependency graph inspectable and versioned.
- `## Canonical text and analyzer` refuses regex stripping of rich text and
  recognizes that Unicode data and token tables are committed artifacts.
- `## Query language` excludes raw backend syntax, regex, unconstrained
  wildcards, and caller-provided tokenizer behavior.
- `## Authorization and result release` treats the index only as candidate
  selection and rechecks authoritative visibility before releasing any
  existence-bearing field.
- `## Index maintenance` distinguishes synchronous and bounded-async modes and
  makes newly restrictive visibility fail closed.
- `## Rebuilds and migrations` builds beside the active generation and keeps
  source data authoritative under capacity or corruption.
- `## Highlights and private data` returns escaped plain text and forbids raw
  private/query payloads in ordinary telemetry.
- `## Non-goals and claim boundary` keeps backend-specific FTS and app-side
  loops from satisfying the portable claim.

## Concerns

### Critical — snapshot pagination and current authorization conflict

The cursor pins an immutable query snapshot and authorization projection
identity, while each candidate must pass “current” visibility. If membership,
block, or moderation authority changes after page one:

- continuing against the old authorization snapshot can leak newly forbidden
  rows;
- rechecking current authority can remove rows that were visible on page one,
  add newly visible rows before the cursor, and violate the no-omission claim;
  or
- restarting is safe, but the RFC does not define which authority change
  invalidates the cursor.

Pin the rule: a cursor binds an authorization epoch/frontier and authority
instance, not just a policy digest. Every subsequent page first compares the
current relevant epoch. A newly restrictive or identity-changing transition
must invalidate and require restart before candidate evaluation. A newly
permissive transition may either invalidate or remain invisible until restart,
but must not splice rows into the pinned snapshot. Document the resulting
guarantee as “no duplicate/omitted rows among the authorized snapshot fixed at
page one,” not an unqualified current-result guarantee.

### Critical — the AST does not have formal evaluation semantics

“Default matching requires every positive clause” conflicts with an explicit
`any` node. `not` scope, nested combinations, empty children after stopword
removal, duplicate clauses, phrase values, filter placement, and “final
positive clause” for prefix are ambiguous. Two parsers can create different
trees, and two adapters can reduce the same tree differently.

Define a closed typed grammar and canonicalization:

- arity and depth for every node;
- exact truth semantics for `all`, `any`, and unary/bounded `not`;
- normalization of field names and scalar filters;
- whether duplicates are preserved or deduplicated;
- handling when analysis removes every token from a term/phrase;
- one preorder or canonical ordering rule for the sole allowed prefix node;
- canonical AST bytes and query hash; and
- golden parse and evaluation vectors, including rejected strings.

The structured AST should be the authority; the convenience text parser needs
its own version and cannot silently change old saved queries.

### Critical — the analyzer is not sufficiently pinned

The proposal names Unicode normalization, case folding, word boundaries,
apostrophe/hyphen handling, stopwords, and scalar limits but not:

- normalization form and ordering relative to case folding;
- full versus simple case folding and locale-sensitive exclusions;
- default-ignorable, combining-mark, emoji, CJK, Thai, and malformed-input
  behavior;
- exact apostrophe/hyphen code point sets and whether they join or split;
- diacritic preservation;
- stopword matching before/after folding and its effect inside phrases;
- prefix analysis when one input produces multiple tokens; or
- offset mapping when normalization expands or contracts text.

Pin a pure reference analyzer with committed Unicode data, domain-separated
version identity, exact input/output token and position records, and a large
multilingual golden corpus. “UTF-8 validation” must also distinguish byte
sources from already-decoded JS strings and prescribe replacement/error
behavior.

### Critical — native FTS analyzers are unlikely to prove equivalence

SQLite FTS5 and PostgreSQL text search have different tokenization,
normalization, phrase position, stopword, prefix, and query semantics.
Backend-native scoring is allowed to differ, but match-set and phrase
equivalence are mandatory. Merely testing a finite corpus cannot prove that
arbitrary source/query text is equivalent.

Choose one of two honest designs:

1. run the Snapback canonical analyzer for both source and query, store
   pre-tokenized terms/positions, and use each backend only as an inverted
   candidate store; or
2. make each native analyzer a separately named nonportable profile.

For v1, a generated portable term/position table is the safer correctness
oracle even if FTS5 accelerates a verified subset. The common adapter suite
should compare every result with that oracle.

### Critical — rebuild activation lacks a gap-free cutover

The builder reads a fixed source snapshot, catches up through an obligation
stream, verifies, then activates. The RFC does not require the obligation
stream to be gap-free, identify its source head, or atomically couple
activation with the last caught-up source commit. A write can land after the
builder’s final read but before activation and be absent from the new
generation.

Define a per-app gap-free source/index frontier. Activation must transactionally
or under a write fence:

1. record the build snapshot head;
2. consume every obligation through a candidate head;
3. acquire a short generation switch fence;
4. re-read and consume through the fenced current head;
5. CAS active generation only if no gap/quarantine blocks that head; and
6. route later commits to the new generation before releasing the fence.

The old generation remains available for pinned cursors and compatible
rollback, but no source update may be acknowledged without an obligation for
every maintained generation that still needs it.

### Critical — authorization filtering leaks hidden-result facts

Returning a structured `authorizationFiltered` fact explicitly tells the
caller that hidden candidate rows matched. Page fullness, number of continuation
pages, response latency, work-ceiling behavior, and backend errors can further
reveal hidden corpus density. The base claim says no existence fact reaches the
caller, so this field contradicts it.

Return a generic bounded-work continuation or partial-result status that does
not distinguish authorization filtering from ordinary candidate work. Use
fixed/bucketed candidate batch limits, bounded timing where warranted, and
identical public diagnostics for hidden and non-hidden exhaustion. Detailed
filter counts may appear only in scoped audited admin evidence.

### Major — scoring and cursor order are not version-stable

The cursor stores a score-order key, but scores are backend floats derived from
an unpinned formula and library implementation. Floating serialization,
NaN/rounding, FTS statistics, collation, and backend upgrades can reorder a
generation or make a cursor incomparable. “Stable per target” needs a concrete
identity.

Include backend engine/build, scorer version, field-weight encoding, corpus
statistics digest, score numeric domain/quantization, and row-id canonical
ordering in the index-generation identity. Scores must be finite and
canonically encoded. Prefer a backend-issued opaque candidate position bound to
the immutable generation over re-evaluating `score < cursorScore` with floats.

### Major — stable row identity and filter ordering need canonical bytes

“Ascending stable row id” is ambiguous across string, number, UUID, composite,
and backend collation. LLP 0004 scalar semantics alone do not define one byte
order for a mixed adapter protocol.

Generate one fixed row-identity type per index and canonical binary encoding.
Pin string normalization/collation, integer range, null placement, composite
framing, and filter comparison. The cursor and corpus hashes must use those
bytes, not backend display strings.

### Major — async freshness needs per-source quarantine semantics

One failed extraction/projection may be quarantined while later obligations
continue. A global `indexedThrough` cannot advance past the failed source
without falsely implying the head is complete; blocking the whole index may
violate the intended bounded-async availability.

Define separate:

- gap-free consumed source head;
- visible complete head;
- per-source latest indexed version;
- quarantine set and oldest age; and
- visibility-safety frontier.

Queries must report whether the generation is complete through a head or
contains named, non-disclosing degraded omissions. A stale permissive prior
version must never remain releasable after a restrictive source/auth change
fails to project.

### Major — update idempotency needs tombstones and monotonic source versions

`(indexVersion, sourceId, sourceVersion)` prevents duplicate work but does not
say how adapters reject an older version after a newer one, retain deletion
tombstones, or compare source versions. Deleting the idempotency row too early
can resurrect content from a delayed job.

Use the gap-free application commit/version authority, retain a per-source
highest-applied version and deletion/visibility tombstone through the maximum
job/rebuild/retry horizon, and CAS every update. Restoration and generation
rebuild must preserve or reconstruct these guards before workers resume.

### Major — projection consistency is underspecified

A generated projection may depend on several tables. “Source mutation” does
not identify when all dependency facts were read or how changes to a secondary
table enqueue every affected source row. Search can otherwise index a mixture
of commits or miss a membership/title update.

Require generated dependency/read sets and one projection snapshot version.
Synchronous projection updates must run in the source transaction or prove an
equivalent materialized-view rule. Async obligations name every dependency
commit and source identity affected, with bounded fan-out and rebuild fallback
when exact dependency tracking is unavailable.

### Major — private token storage and deletion need a lifecycle

Private/sensitive fields may enter tokens and stored highlights, but their
at-rest isolation, backup posture, old-generation retention, and deletion are
not defined. Token vocabulary itself can reveal private text even when source
rows are authorized at query time.

Bind index storage encryption/access class to the source classification;
prevent ordinary inspection, metrics, and corpus diagnostics from exposing
terms; and make query access traverse the same authorization boundary.
Deletion must remove or cryptographically erase terms/highlights from active,
retained rollback, build, cache, and backup generations. A generation with
undeletable private terms cannot claim completed retention.

### Major — highlight offset mapping is not executable

Canonical normalization can change scalar count and phrase/token boundaries.
Returning “canonical match ranges” against original display text is ambiguous
and can split grapheme clusters or point at the wrong substring.

Have the analyzer emit a source-span map for each canonical token, expressed in
one pinned unit. Highlight assembly expands to grapheme-safe boundaries in the
authorized original field, caps surrounding text, and returns both text-local
and fragment-local ranges with golden vectors for expansions, combining marks,
RTL text, emoji, and rich-document block boundaries.

### Major — retained cursor generations need resource bounds

Snapshot-stable pagination requires retaining physical index generations while
cursors remain valid. An attacker can mint cursors across many generations or
queries and prevent cleanup. MAC rotation can also invalidate all cursors
without a declared diagnostic.

Pin cursor maximum lifetime, generation-retention cap, per-authority cursor
admission, key-generation overlap, revocation behavior, and a safe restart
outcome when capacity retires a snapshot early. A cursor is not a lease unless
the server explicitly and boundedly records it.

### Major — rolling releases need enforced query/maintainer admission

The rebuild section declares compatible releases but performs a point-in-time
check. An old process can continue writing an old generation after new
activation, or a rolled-back process can parse a cursor generated under newer
semantics.

Use a search admission epoch that atomically lists allowed query/parser and
maintainer artifact digests for each generation. Workers and serving processes
must present those digests on every update/query; deployment activation changes
the set under the control-plane fence.

### Moderate — “visible counts” remain risky and should stay out of v1

An exact visible total requires exhausting and authorizing all candidates,
which conflicts with bounded work and can amplify timing/cost side channels.
Counts can also change with authorization between requests. Keep totals,
facets, suggestions, and spelling outside the base profile until a separate
partition-safe or preauthorized aggregation contract exists.

### Moderate — search needs its own abuse/cost envelope

Clause/depth limits do not fully bound cost: common prefixes, high-frequency
terms, phrase scans, authorization rejection, and retained snapshots can still
be expensive. Declare per-index candidate/work budgets, prefix document
frequency caps, time/cancellation behavior, and LLP 0071 admission policies.
Cancellation must release resources without publishing partial unauthorized
diagnostics.

### Moderate — corruption recovery needs an authority rule

The RFC says corruption degrades and rebuilds but does not pin detection,
isolation, cursor invalidation, or whether a possibly corrupt index may keep
serving. Integrity failure should quarantine the generation, invalidate its
cursors, fail closed for affected queries, rebuild from authoritative source,
and retain a coded audit receipt.

## Suggestions

1. Implement a small portable term/position index as the semantic oracle; let
   FTS5/PostgreSQL acceleration prove equivalence against it rather than define
   semantics.
2. Publish canonical analyzer, AST, row-id, cursor, and highlight golden
   vectors before writing either adapter.
3. Model source frontier, index generation, authorization epoch, and release
   admission epoch as separate monotonic identities.
4. Make exact counts/facets/suggestions later capabilities; keep v1 focused on
   safe paginated results.
5. Add a deterministic fault schedule around every source commit, obligation,
   rebuild catch-up, generation switch, auth change, and cursor page.

## Open questions for the author

1. Will v1 choose a portable pre-tokenized index as the match-set authority,
   with native FTS only as an optional accelerator?
2. Should every relevant authorization change invalidate pagination, or may
   newly permissive changes remain invisible until cursor restart?
3. Is bounded maintenance/write fencing acceptable for first-generation index
   activation?
4. Can private/sensitive source fields be excluded from v1 until encrypted
   index custody and deletion are proved?

## Recommended next step

Revise and remain `Draft`. Close the authorization/snapshot rule, formal AST,
exact analyzer, portable match-set authority, gap-free rebuild cutover, hidden
candidate side-channel, and private-index lifecycle. Then obtain an independent
non-GPT search/security review before the author considers `Accepted`.
