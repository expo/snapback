# LLP 0073 review — Codex family

## Round 1 — 2026-07-27

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** OpenAI Codex CLI 0.145.0, `gpt-5.6-sol`  
**Effort:** ultra  
**Date:** 2026-07-27  
**Redacted:** no (target bytes unredacted; context capsule contains public
tracked repository files only)  
**Method:** fresh non-interactive CLI runner, read-only sandbox, mutually blind
structurally isolated capsule  
**Target SHA-256:** `91ea2b86e29b16a5cb7ee31a834b56a3027dd3234d2d11dd083a40984083c8f8`  
**Capsule SHA-256:** `b0300273bf962d8cf1d1c450467e7c96f583866d47cc4e19a4cce21b1819e14c`  
**Instruction SHA-256:** `829a93ec8bc4352d9e0d6ebc25ee2bce54ff76f4cc436ab7d335164e7741820e`  
**Attempt 1 status:** failed before review. Codex CLI refused the capsule
because it intentionally has no `.git` metadata and the launch omitted
`--skip-git-repo-check`. Received output:

> Reading additional input from stdin...  
> Not inside a trusted directory and --skip-git-repo-check was not specified.

No review body or verdict was received. This attempt is not counted.

## Attempt 2

**Status:** completed — NOT READY  
**Thread ID:** `019fa5f7-8e1b-7a32-918d-54f570bd3538`  
**Review body:** preserved verbatim below.

## 1. Overall assessment

Portable full-text search is a good idea, and the proposal chooses the right architectural center: Snapback-owned analysis, matching, ranking, authorization, and cursor semantics, with native database search used only as an accelerator.

The RFC is not ready yet. The remaining problems are not merely implementation detail: snapshot retention is confused with generation retention, authorization behavior across pages is contradictory, hidden candidates can affect public response shape, the Boolean grammar admits unbounded complements, and the analyzer is not normative for all Unicode inputs. The synchronous maintenance profile also lacks a closed work model for the document and moderation cases it claims.

## 2. Strengths

- The separation between semantic authority and physical acceleration is excellent. LLP 0073 §Summary and §Adapter contract and capabilities correctly refuse to let FTS5, PostgreSQL analyzers, native scores, or backend query syntax become the application contract.

- Pinning Unicode, parser, analyzer, scorer, row-id ordering, and corpus identities is the right portability discipline. Unicode 17.0.0 is indeed the current published Standard in the cited [Unicode release register](https://www.unicode.org/releases/index.html). See §Canonical text and analyzer and §Ranking, order, and cursors.

- The integer, corpus-statistics-free scorer is a strong default. It avoids database-dependent BM25 variants and upgrade-induced reordering. See §Ranking, order, and cursors.

- The authorization posture is directionally strong: partitions do not authorize, private vocabulary is classified as private data, backend snippets are prohibited, counts/facets/suggestions are excluded, and current authoritative visibility is intended to control release. See §Authorization and result release and §Highlights and private data.

- Synchronous source/index atomicity is a coherent v1 product choice for bounded rows. Rolling back the source mutation is much more honest than claiming freshness after best-effort indexing. See §Index maintenance.

- Rebuild admission, artifact-digest fencing, restore-epoch invalidation, corruption quarantine, and capability reporting are unusually thorough. See §Rebuilds and migrations and §Adapter contract and capabilities.

- The acceptance section covers cross-target semantics, injection, authorization transitions, rebuild races, deletion, backups, corruption, and pressure-test receipts rather than treating a few happy-path queries as portability evidence.

## 3. Concerns

1. **Retaining a physical generation does not provide the promised cross-request snapshot.**

   - Severity: High
   - RFC altitude: MATERIAL
   - Evidence: §Ranking, order, and cursors says page one pins a snapshot and later pages merely read the same physical generation. But §Index maintenance says the active generation is mutated by every source commit. The same generation therefore has different contents after page one. The current implementation’s `with_pinned_read_snapshot` opens and commits a short read transaction within one call (`src/storage.rs:4052`), while its existing pagination test explicitly states that pagination is not snapshot-consistent across pages (`src/storage.rs:14373`). Implemented LLP 0080 §2 deliberately promises only the weaker untouched-row keyset bound.
   - Resolution criteria: Choose and specify an actual cross-request mechanism for both SQLite and PostgreSQL:
     - retained database transactions/server-side cursor state; or
     - versioned postings/source rows with `validFrom`/`validThrough` semantics queried at the cursor’s source head.
     
     Define crash behavior, global cursor limits, SQLite WAL/checkpoint impact, PostgreSQL vacuum/snapshot impact, garbage collection, and rebuild interaction. Add adversarial insert/update/delete tests between every page boundary on both adapters. Generation retention may remain necessary, but it cannot stand in for snapshot retention.

2. **The authorization snapshot and current-authorization requirements conflict.**

   - Severity: Critical
   - RFC altitude: MATERIAL
   - Evidence: §Summary and §Authorization and result release require “current” visibility, but the latter also evaluates visibility inside the page-one pinned application snapshot. Accepted LLP 0053 §The authorization-event universe deliberately does not advance its global authorization version for every ordinary matcher-observed row change. A `public → private` source-row update can therefore change visibility without moving LLP 0053’s epoch. Search pagination is not a live subscription whose shrinking-result obligation repairs that case. The RFC’s new phrase “complete generated authorization-dependency epoch” has no closed event universe or identified transaction hook.
   - Resolution criteria: Define a search-specific visibility witness, or explicitly broaden an existing witness, with a closed producer set covering every source field, relationship, membership, block, moderation projection, policy artifact, authority transition, reset, and restore fact that can narrow release. State whether:
     - the candidate set is fixed at source head `S`, while authorization is revalidated at a current visibility version `V`; or
     - every relevant visibility change restarts the cursor before any later-page release.
     
     Add a required test where a non-`permissionBacking` row becomes private between pages and the old cursor releases no stale title, snippet, score, or existence fact.

3. **Post-authorization overfetch is not presently non-disclosing, and the cursor may carry hidden boundary data in plaintext.**

   - Severity: Critical
   - RFC altitude: MATERIAL
   - Evidence: Under §Authorization and result release, a database with no matches can return an empty terminal page, while an otherwise identical database with many unauthorized matches can return an empty `workLimited` page and continuation. That distinguishes hidden-candidate existence despite the stated guarantee. The same issue applies to data-dependent prefix-frequency admission. In addition, a partial page may need to resume after the last scanned unauthorized candidate; §Ranking says the cursor contains its relevance key and row-id bytes under a MAC. A MAC authenticates but does not conceal payload data. Implemented LLP 0080 §3 provides the relevant precedent: it defines an application observation boundary, makes missing and invisible rows byte/code-indistinguishable, and explicitly disclaims constant-work timing.
   - Resolution criteria:
     - Require v1 visibility predicates to be pushdown-compilable and execute before candidate limiting/page filling, with an authoritative release recheck afterward.
     - Define the public observation boundary across rows, cursor presence, `hasMore`, `workLimited`, prefix refusals, status codes, and ordinary inspection.
     - Add paired-database tests differing only in hidden matching rows.
     - Keep unauthorized scan boundaries in server-side cursor state or protect them with authenticated encryption; do not rely on MAC-only opacity.
     - If timing noninterference is not claimed, say so explicitly and define the bounded timing leakage that remains.

4. **The Boolean grammar still admits unbounded negation.**

   - Severity: High
   - RFC altitude: MATERIAL
   - Evidence: §Query language requires only one positive atom somewhere outside `not`. Thus `any(term("needle"), not(term("common")))` is valid but matches almost every row lacking `common`; `not` over compound subtrees creates similar complements. This contradicts both the parser’s claimed rejection of unbounded negation and §Summary’s narrower “required/excluded clauses” model. Such queries cannot be driven from bounded positive postings.
   - Resolution criteria: Give v1 an anchor-preserving grammar. The simplest rule is that exclusions may appear only as conjunctive narrowing of a positive query, with `not(matchAtom)` only; forbid `not` beneath `any`, compound negation, and double negation. Alternatively, formally require every satisfying disjunct to contain a positive posting anchor and prove that property without unbounded normalization. Add accepted/rejected vectors and an examined-candidate bound for each legal Boolean shape.

5. **The analyzer is not yet normative for arbitrary Unicode input.**

   - Severity: High
   - RFC altitude: MATERIAL
   - Evidence: §Canonical text and analyzer combines default word boundaries with a token-character description that mentions only letters/numbers, combining marks, and two apostrophes. Unicode default word-boundary segments can also join through `MidLetter`, `MidNumLetQ`, `ExtendNumLet`, connector punctuation, format characters, and ZWJ. Consequently inputs such as `foo_bar`, `example.com`, `a<LRM>b`, and NNBSP-connected text have no specified token bytes. It is unclear whether non-retained characters split, disappear and concatenate neighbors, remain in the token, or reject the segment. Positions after discarded/overlong segments and provenance spans through NFKC case-fold expansions/compositions are also unspecified. [UAX #29](https://www.unicode.org/reports/tr29/tr29-47.html) requires a tailored profile to describe its changes precisely and notes that default segmentation is inadequate for several script classes.
   - Resolution criteria: Publish a complete Unicode-17, UAX29-C2-2 analyzer algorithm or generated transition/property tables whose digest is normative. It must define every code-point class’s contribution, all tailoring, discarded and overlength-token position behavior, and a deterministic many-to-many source-span provenance rule through normalization. Golden vectors should validate this authority, not substitute for it.

6. **The synchronous maintenance decision lacks a closed, composable work model for the claimed applications.**

   - Severity: High
   - RFC altitude: MATERIAL
   - Evidence:
     - §Index maintenance admits only bounded reverse fan-out and excludes document extraction, while §Acceptance requires bounded document commits, large-document windows, and an async frontier.
     - LLP 0068 §Storage and transactions stores an operation log plus canonical document snapshot; it does not provide the stable block-level search projection or incremental delta contract presumed here.
     - LLP 0071 §Moderation model sends search consumers durable follow-up work for moderation changes, while LLP 0073 says visibility changes update or remove index entries in the source transaction.
     - Implemented LLP 0080 §5 globally composes direct and maintained-projection writes under the 1,024-write mutation bound; current code enforces that composition at `src/storage.rs:5592`. LLP 0073 defines per-index work ceilings but not a global counted unit across direct writes, projections, and multiple search indexes.
   - Resolution criteria: Define the indexed source-row granularity and delta shape, particularly whether document results are documents or blocks and how scoring/deduplication works across changed blocks. Define one global commit-work accounting rule and activation preflight across every index and maintained projection. Separate text/filter materialization dependencies from authorization-only visibility dependencies so a membership change or account-wide moderation action need not rewrite unbounded postings. Then either narrow v1 acceptance to demonstrably bounded synchronous projections or admit and specify the required `boundedAsync` document profile before claiming the large-document test.

7. **The public score has no portable numeric representation.**

   - Severity: Medium
   - RFC altitude: MATERIAL
   - Evidence: §Ranking makes saturation at `u64::MAX` normative, while §Authorization treats score as caller-visible and §Scores calls it informational. LLP 0007 §Data Model and §Versions and Changesets limit the shipped plain-JSON integer profile to `Number.MAX_SAFE_INTEGER`; larger exact integers require a tagged/string encoding. SQLite and PostgreSQL’s ordinary integer paths are signed 64-bit, not an unsigned-64 portable ordering contract. No maximum weighted-field count proves that saturation cannot exceed the wire range.
   - Resolution criteria: Either cap weighted fields and total score so a generated proof guarantees `score <= Number.MAX_SAFE_INTEGER`, preferably using a bounded u53 scorer, or define a tagged exact-u64 wire, storage, comparison, JSON-schema, and client type. Also state whether score is actually returned; if it is internal only, remove the public-score claims.

8. **Optional native-accelerator correctness is asserted rather than constructed.**

   - Severity: Medium
   - RFC altitude: DETAIL
   - Evidence: §Summary correctly says a finite corpus cannot establish analyzer authority for arbitrary Unicode, but §Adapter contract and capabilities says an adapter “proves” no false negatives and that a failed equivalence check disables acceleration without defining a proof mechanism. Comparing every production query with a complete portable scan would erase the acceleration; corpus comparison alone is not proof for arbitrary data.
   - Resolution criteria: Keep accelerators disabled by default until their superset property follows by construction from canonical pre-tokenized inputs and a closed query translation. Otherwise label them experimental and always union them with an independently complete portable candidate path. Specify what the equivalence check checks and when.

9. **Several smaller normative and corpus-hygiene gaps should be closed.**

   - Severity: Low
   - RFC altitude: DETAIL
   - Evidence:
     - `filter(field, op, value)` never enumerates the closed operator set.
     - “Exact whole-field match,” global repeated-atom removal, and scoring beneath nested Boolean nodes are ambiguous.
     - §Search declarations says semantic changes create a new version, while §Rebuilds sometimes calls the resulting object only a generation.
     - Cursor consumption/replay is undefined; if each page leaves its predecessor cursor live, a normal chain can exhaust the 16-cursor limit.
     - The 2026-07-26 Revised note says the RFC remains Draft although the header says Review.
     - LLP 0044 is cited in the body but absent from `Related`; implemented LLP 0080 and the capability/migration authorities are also now load-bearing.
   - Resolution criteria: Pin these vocabularies and lifecycle rules, distinguish semantic index version from physical generation consistently, specify whether next-page issuance replaces or consumes a cursor slot, and reconcile metadata/Related references.

10. **The implementation sequence does not acknowledge the current PostgreSQL prerequisite.**

   - Severity: Medium
   - RFC altitude: DETAIL
   - Evidence: §Adapter contract and §Acceptance require SQLite and PostgreSQL. LLP 0046 §Prerequisite states that no storage abstraction exists yet, and `Cargo.toml` currently contains `rusqlite` but no PostgreSQL client. The closed capability registry in `src/manifest.rs` also has no proposed search capability.
   - Resolution criteria: Add an explicit dependency sequence: shared semantic core and artifact schemas; SQLite exact matcher; store-seam/PostgreSQL prerequisite; PostgreSQL matcher; optional accelerators; then capability promotion. Separate semantic acceptance from implementation evidence, or state deliberately that this RFC uses a combined gate.

## 4. Suggestions

- Reuse LLP 0080’s strongest established patterns: visibility before limiting, an explicit observation boundary, a named result encoding, closed capability maturity, examined-entry instrumentation, and global work-budget composition.

- Narrow the first implementation to positive terms/phrases plus conjunctive exclusions, public/owner-style pushdown visibility, bounded ordinary rows, the exact portable matcher, and no native accelerators. This is already useful and makes the core proof substantially smaller.

- Consider short-horizon versioned postings instead of holding database read transactions for 120 seconds. `validFrom`/`validThrough` postings retained until the oldest cursor head expires would make snapshot heads real while avoiding long-lived SQLite WAL readers and PostgreSQL vacuum pins. The bakeoff should compare this against leased native snapshots.

- Introduce a cursor-bound `SearchVisibilityVersion` tuple, for example `{authorizationVersion, sourceVisibilityHead, moderationFrontier, policyDigest}`, distinct from the match snapshot head. That makes the source-snapshot/current-authority split explicit.

- Separate index-semantic versioning from release-policy versioning. A policy-only change should advance the visibility witness and restart/recheck cursors; it should not necessarily force a full token rebuild unless indexed partition bytes actually change.

- Add metamorphic tests, not only fixed corpora: AST child permutation/deduplication, canonically equivalent Unicode spellings, accelerator on/off, hidden-row insertion, generation rebuild, and page-boundary mutation should preserve exactly the claims each transformation is supposed to preserve.

## 5. Open questions

1. Are candidate membership and ranking fixed at page-one source head while authorization remains current, or is authorization also intentionally historical for 120 seconds? The latter would conflict with the stated fail-closed security goal.

2. Does “no existence fact” mean semantic equality of rows/codes/continuation shape, or does it also claim timing/work noninterference? If timing is excluded, what bounded leakage is accepted?

3. Which exact visibility profiles may back v1 search, and must each be pushdown-compilable before candidate limiting?

4. For collaborative documents, is one search result a document, a block, or a generated document projection? How are block scores combined and duplicate document hits removed?

5. Are public scores required? If so, why use u64 saturation instead of a bounded score domain already representable by every client and database target?

6. Is a cursor single-use, replayable for idempotency, or a token naming a replaceable server-side cursor slot? How does normal multi-page traversal interact with the 16-cursor quota?

7. Are native accelerators part of `full-text-search-v1`, or separately reported experimental capabilities whose absence never weakens the base profile?

8. Must semantic acceptance wait for both database adapters and pressure-test evidence, or should it follow the established Accepted-versus-Implemented split used by LLP 0080?

## 6. Readiness verdict

The core direction should be preserved, but snapshot mechanics, authorization freshness/non-disclosure, bounded Boolean evaluation, and the Unicode analyzer must be resolved before implementation can rely on this as a coherent portable contract.

VERDICT: NOT READY

## Round 3 — 2026-07-27

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`  
**Reasoning effort:** ultra  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh CLI runner, read-only sandbox, mutually blind structurally
isolated capsule; final delta-round instructions  
**Target SHA-256:** `3930bc079cc8d17a69c8b486db1dbefcda54398641c3addf00484756babf3c81`  
**Capsule SHA-256:** `4c561755852a7a3ead7632fcebb1df0cdad9761b10c8475eba46fa2afe704155`  
**Instruction SHA-256:** `26d7ae20655758a859993f7fe52298bab4bf51a0b3a2d0d692dc7a4c9419295e`  
**Status:** completed

## 1. Overall assessment

LLP 0073 is substantially improved, especially around Unicode analysis, authorization partitioning, exact-or-refuse execution, and noninterference. It is not yet ready for acceptance: several protocols remain non-portable or non-total, so independent implementations could diverge or fail on valid inputs.

## 2. Strengths

- Unicode 17 versioning, analyzer digests, and pre-normalization separator handling provide a strong portability foundation.
- Public and owner-only observability are fail-closed, with authorization-partitioned postings and authoritative source-row rechecks.
- The termination-insensitive noninterference claim is explicit and appropriately limited.
- Exact-or-refuse ranking avoids returning partially evaluated or incorrectly ranked pages.
- Stateless AEAD cursors avoid retained cursor state and its associated quota risks.
- Synchronous source/index mutation and deletion requirements establish sound consistency expectations.
- Acceptance criteria cover cross-user isolation, cross-target behavior, migration, interruption, and private-data custody.

## 3. Concerns

### 1. The work budget is not an implementation-independent logical ledger

**Severity:** Major  
**Horizon:** MATERIAL

**Evidence:** The ranking formula and ceilings in `llp/0073-portable-full-text-search.rfc.md:405-448` do not define canonical anchor selection, posting-list traversal, OR/prefix expansion order, intersection and exclusion operations, duplicate charging, source-row rechecks, or cancellation points. Mutation accounting at `:482-489` refers to physical posting operations. Consequently, equivalent adapters may charge different work and disagree between success and `WORK_LIMIT`.

**Resolution criteria:** Define a versioned logical evaluator and ledger covering every query and mutation operation, including deterministic tie-breaking, prefix enumeration, deduplication, rechecks, and repeated charges. Add trace fixtures proving identical charge sequences and refusal points across supported adapters.

### 2. Input analysis and result materialization remain unbounded

**Severity:** Major  
**Horizon:** MATERIAL

**Evidence:** AST node and token-count limits do not bound the raw bytes or scalars that must be parsed and normalized before those limits can be applied. Stored display fields and complete `SearchPageV1` payloads likewise lack per-field, per-item, and per-page byte bounds. Current string and JSON fields do not supply such bounds.

**Resolution criteria:** Specify raw-request, atom, filter, normalized-text, indexed-source, projected-field, item, and total-page limits. Require early, allocation-safe enforcement with stable diagnostics and include boundary fixtures.

### 3. Highlight generation is not total for valid matches

**Severity:** Major  
**Horizon:** MATERIAL

**Evidence:** Highlights are capped at 256 source bytes while phrase highlights must cover the full first-to-last token span (`:559-608`). Four legal 64-byte ASCII tokens plus three separators already require 259 bytes; large separator spans produce the same contradiction. Selection among more than eight matches and allocation of the optional surrounding context are also underspecified.

**Resolution criteria:** Define deterministic behavior for an oversized matching span—such as omission, clipping with explicit match metadata, splitting, or stable refusal—and specify occurrence ordering, overlap merging, context allocation, and the eight-highlight selection rule. Add adversarial golden cases.

### 4. Fast rollback can reactivate previously invalidated cursors

**Severity:** Major  
**Horizon:** MATERIAL

**Evidence:** Cursors bind the physical generation (`:312-350`), while fast rollback may republish the same predecessor generation (`:526-545`). The admission epoch is not cursor-bound. A predecessor cursor can therefore become invalid during successor activation and valid again after rollback if its snapshot and TTL remain usable.

**Resolution criteria:** Bind cursors, caches, admissions, and worker fences to a never-reused activation generation that advances on every activation, rollback, restore, or reactivation. Add activation-to-rollback tests proving both predecessor and successor cursors require restart.

### 5. The XChaCha cursor format is not completely specified

**Severity:** Major  
**Horizon:** MATERIAL

**Evidence:** The cursor section (`:312-355`) does not close the HKDF input record, salt, length-framed `info`, output length, plaintext field encodings, timestamp representation, associated-data framing, key-record custody, maximum predecessor set, or trial order. “Authority instance” is undefined, while `targetProfileId` is reusable and is not the never-reused hosted deployment identity defined by LLP 0072.

**Resolution criteria:** Specify an exact binary schema, key-record schema, 32-byte derivation inputs and output, self-delimiting associated data, exact deployment/target binding, bounded rotation window and trial order, and custody/zeroization rules. Provide positive golden vectors and negative cross-app, cross-deployment, cross-generation, and cross-profile vectors.

### 6. The migration protocol does not conform to its governing profile

**Severity:** Major  
**Horizon:** MATERIAL

**Evidence:** LLP 0073 specifies online shadow construction and journal catch-up (`:499-557`), but LLP 0081’s executable profile is `exclusive-single-writer.v1` and explicitly excludes online zero-downtime migration. LLP 0073’s rollback boundary also permits predecessor republish until a later source commit, whereas LLP 0081 requires all application and effect lanes to remain fenced. The proposed journal-floor lease lacks durable identity, fencing, atomic acquisition, progress-gated renewal, retention bounds, multi-lease behavior, and an atomic relationship with pruning; current pruning has no lease integration.

**Resolution criteria:** Either use `exclusive-single-writer.v1` or jointly define a named online search-migration profile in the governing LLPs. That profile must specify typed durable state, canonical steps, fences, receipts, cancellation, bounded leases, atomic snapshot-head acquisition, renewal/pruning races, resource limits, restart behavior, activation identity, and a single rollback rule.

### 7. Private-index custody is not mechanically enforceable

**Severity:** Major  
**Horizon:** MATERIAL

**Evidence:** The RFC requires private representations to use storage and encryption classes “at least as restrictive” as their source (`:588-608`), but no closed class vocabulary or ordering is defined. Current source-field manifests do not carry a comparable custody class, and arbitrary storage/encryption strings cannot establish a portable ordering or target capability.

**Resolution criteria:** Define Rust-owned custody and encryption enums, their ordering, source-field classification, permitted index/cache/backup placements, and target evidence. Alternatively, constrain the first profile to a custody arrangement whose equivalence is mechanically provable.

### 8. Dispatch, response, and admission metadata are not fully mapped

**Severity:** Moderate  
**Horizon:** MATERIAL

**Evidence:** The RFC defines `SearchQueryPlan` and an exact `SearchPageV1` carrier (`:114-140`), while the current query route returns `FunctionResponse<QueryOutput>`. It does not define the response sum/envelope change or how attribution composes with the closed page schema. It also does not normatively map public-read and owner-only search to existing function metadata such as authentication requirement, authorization dependence, read-set summary, retention, syncability, and effect ceiling.

**Resolution criteria:** Define the exact Rust response variant and wire envelope, generated-client decoding behavior, and a complete metadata matrix for each visibility mode. Add manifest-to-dispatch and generated-client fixtures.

### 9. The owner-field vocabulary conflicts with `owner.v1`

**Severity:** Moderate  
**Horizon:** MATERIAL

**Evidence:** LLP 0073 permits a required “principal/reference” owner field (`:72-74`, `:369-375`). LLP 0065 and current code generation permit exactly a nonoptional `String` or `Principal`; an arbitrary row reference is not a valid authorization subject.

**Resolution criteria:** State exactly that owner fields are nonoptional `String` or `Principal` values compared with canonical effective-user subjects, and explicitly reject arbitrary references and IDs. Otherwise, extend and review `owner.v1` first.

### 10. Analyzer record encoding is not byte-complete

**Severity:** Minor  
**Horizon:** DETAIL

**Evidence:** The analyzer defines logical output records (`:154-214`) but does not fully specify position origin/reset rules, numeric widths and byte order, or deterministic field ordering. Those choices affect the promised byte-for-byte oracle.

**Resolution criteria:** Define the canonical record serialization completely and provide multi-field, empty-field, combining-mark, ignored-code-point, and position-reset vectors.

### 11. Pagination has two possible authorities

**Severity:** Minor  
**Horizon:** DETAIL

**Evidence:** The exact operation arguments contain `limit` and `after`, while the AST vocabulary also admits optional pagination controls (`:225-278`). The relationship between them is undefined for hashing, cursor validation, and conflicting values.

**Resolution criteria:** Keep pagination in one layer, or define an exact equality/precedence rule and include it in canonicalization and cursor-binding fixtures.

## 4. Suggestions

- Add executable traces for analyzer output, logical work charging, cursor derivation, highlighting, migration fencing, and rollback.
- Add LLP 0065 and LLP 0072 to the document’s `Related` metadata.
- Add the promised search GAP row to `guide/capabilities.md` before advancing the RFC.
- Update `issues/20260727-portable-indexed-text-search.md` so its cursor, projection, and hosted-target language matches this RFC.

## 5. Open questions

- Is online search rebuilding intended to become a new LLP 0081 profile, or should the first implementation use exclusive migration?
- Is the work budget intended to measure a portable logical machine or adapter-specific physical operations?
- Which exact local and hosted identifier does “authority instance” denote?
- What should clients observe when an exact phrase’s source span cannot fit in one highlight fragment?
- Are private field names themselves intended to be observable in owner-only highlight results?

## 6. Readiness verdict

Not ready for acceptance. The authorization model is strong, but finite execution, highlighting, cursor lifecycle and cryptography, migration leasing, private custody, and public operation integration require normative closure first.

VERDICT: NOT READY

## Round 2 — 2026-07-27

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** OpenAI Codex CLI 0.145.0, `gpt-5.6-sol`  
**Effort:** ultra  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh non-interactive CLI runner, read-only sandbox, mutually blind
structurally isolated capsule; delta-round instructions  
**Target SHA-256:** `47533c1bf2270d414032993f8deaf39a4545214af08b66276dac272e8165fb2b`  
**Capsule SHA-256:** `1b1c1f120e040b2c80034839df874473fa9de8ffcdaede8b530543d5aae5b5f5`  
**Instruction SHA-256:** `1e06817ebcc75dd3f91e12c9c5a1254cf8e7031fb86871a5058dcbdae30a9728`  
**Status:** completed — NOT READY  
**Thread ID:** `019fa60f-83c8-7670-af1a-ca34487bb3b0`  
**Review body:** preserved verbatim below.

## 1. Overall assessment

LLP 0073 is substantially stronger after Round 1: its portable matching model, bounded-work intent, authoritative visibility rechecks, and SQLite-first scope are sound foundations. It is not yet implementable as a portable, privacy-preserving protocol, however. Several contracts remain internally contradictory or insufficient to guarantee exact ordering, confidentiality, cursor determinism, and safe rollback.

## 2. Strengths

- Clearly limits v1 to ordinary bounded rows and explicitly excludes projections, documents, assets, live queries, offline search, and native acceleration.
- Makes the canonical portable index the match-set authority and defines integer-only scoring suitable for cross-target comparison.
- Uses authoritative source-row visibility rechecks rather than relying on a fictional authorization epoch.
- Bounds synchronous maintenance and query work globally, including physical posting operations.
- Keeps SQLite as the first implementation target and correctly leaves PostgreSQL as a GAP pending the store seam.
- Includes broad acceptance requirements covering conformance, privacy, mutation, cursor replay, rollback, and target receipts.
- Correctly requires deleted or denied rows to be omitted and prevents them from becoming cursor boundaries.

## 3. Concerns

### 3.1 Unicode normalization contradicts tokenization

**Severity: Critical — MATERIAL**

**Evidence:** `llp/0073-portable-full-text-search.rfc.md:117-128` applies NFKC_Casefold before scanning, then says format characters such as ZWJ and LRM become separators. Unicode 17 NFKC_Casefold deletes U+200B–U+200F, including ZWJ and LRM. Consequently, `a<LRM>b` normalizes to `ab`, not two tokens as the required vector claims. See [Unicode 17 DerivedNormalizationProps](https://www.unicode.org/Public/17.0.0/ucd/DerivedNormalizationProps.txt).

**Resolution criteria:** Specify an ordering that preserves separator intent, such as mapping separator-class format characters to a sentinel or space before NFKC_Casefold, or change the claimed token semantics. Add normative vectors for ZWJ, LRM, combining marks, compatibility expansions, and adjacent deleted characters.

### 3.2 Exact ranking is not reconciled with bounded partial evaluation

**Severity: Critical — MATERIAL**

**Evidence:** Lines 219-241 require exact global score order. Lines 247-252 retain only the last released row as the cursor boundary, while lines 310-316 allow evaluation to stop at a work ceiling and return `workLimited`. Unless all viable candidates are exhausted or a portable score threshold proves that unseen candidates cannot outrank released rows, a later candidate may belong before an already returned row. A sparse work-limited page also has no scan frontier with which to resume.

**Resolution criteria:** Either:

- fail before releasing results whenever exact top-k cannot be proven within the work bound; or
- define a portable threshold/top-k algorithm, deterministic candidate traversal, and a privacy-safe resumable frontier carried by the cursor.

Normative tests must cover high-frequency terms, sparse visibility, ties, and repeated work-limited continuation.

### 3.3 Public-read indexes can expose private fields

**Severity: Critical — MATERIAL**

**Evidence:** Lines 290-308 authorize public-read rows as a constant partition and recheck row visibility, but lines 455-466 permit private indexed and filterable fields based on storage custody. Matching, exclusion, prefix behavior, filters, score changes, and highlights can reveal private field contents even when the source row itself is publicly readable. The RFC also does not establish the authoritative source and fail-closed defaults for public/private field classifications.

**Resolution criteria:** Require code generation to reject public-read indexes unless every field affecting matches, filtering, scoring, or highlights is public-observable to that audience. Define where classifications are authored, their defaults, their migration behavior, and equivalent field-level rules for owner-visible indexes.

### 3.4 Owner authority semantics are underdefined

**Severity: High — MATERIAL**

**Evidence:** Lines 66-67 and 290-307 refer to a required principal/reference and “current authority,” but do not define principal classes or consume the existing `owner.v1` semantics from LLP 0065. Current authority variants include anonymous, user sessions, dev impersonation, service principals, admin bypass, and system invocation; they do not all carry the same authority-instance identity. The acceptance case for a “public-to-private source-row mutation” also does not fit the RFC’s fixed public-read versus owner declaration shapes.

**Resolution criteria:** Explicitly adopt `owner.v1` and its canonical effective-user subject, or define a replacement profile covering delegated agents, autonomous agents, service principals, impersonation, admin, system, and refusal cases. Specify the exact owner partition and cursor identity. Replace the impossible mutation vector unless row-level visibility transitions are added.

### 3.5 The noninterference claim is incompatible with observable timeouts

**Severity: High — MATERIAL**

**Evidence:** Lines 310-320 require byte- and code-identical paired-database observations. Lines 322-327 permit hidden-data-dependent physical cache and page behavior, while lines 340-345 expose timeout or cancellation as a diagnostic outcome. Hidden physical latency crossing a deadline can therefore produce success in one database and timeout in the paired database—a code-level difference, not merely a timing difference.

**Resolution criteria:** Define a termination-insensitive noninterference scope with explicitly coupled nondeterminism, or base termination on deterministic logical work units independent of hidden physical state. Amend the acceptance oracle to cover timeout behavior explicitly.

### 3.6 Cursor cryptography, hashing, and replay semantics are incomplete

**Severity: High — MATERIAL**

**Evidence:** Lines 247-274 require confidential AEAD cursors and byte-identical observations but do not pin the AEAD construction, nonce generation, canonical plaintext, associated data, key separation, rotation, or maximum encoded size. Conventional randomized AEAD does not produce byte-identical cursors. The canonical AST includes `after` and result limit, while cursor binding refers to a query/filter hash, leaving a possible self-reference and unclear page-size binding. “Replayable idempotently” also conflicts with metadata calling cursors single-use and cannot mean response-stable replay under current-state semantics.

The current query cursor implementation in `src/rqs.rs` uses a clear body authenticated by HMAC, so it cannot silently supply the new confidentiality contract.

**Resolution criteria:** Define a complete `SearchCursorV1` wire and crypto profile, including whether deterministic misuse-resistant encryption is required. Define a canonical query core that excludes `after`, state whether limit is bound, clarify replay as side-effect-free rather than response-stable, reconcile the metadata, and add rotation, tampering, size-limit, and cross-authority vectors.

### 3.7 Retained generations are not safe rollback points after activation

**Severity: High — MATERIAL**

**Evidence:** Lines 398-415 route later commits to the successor generation while retaining the predecessor for rollback. Once new writes, deletes, or ownership changes occur, that predecessor is stale. Rolling back to it can omit new rows and retain deleted or formerly authorized postings. Source rechecks reduce disclosure risk but do not restore completeness or prevent excessive stale work. The design also lacks a journal-floor lease or restart rule if rebuild catch-up falls behind the prunable journal.

**Resolution criteria:** Choose one explicit model:

- no fast rollback after the first successor-only commit;
- dual maintenance of every rollback-eligible generation, included in global work accounting and deletion guarantees; or
- mandatory replay/rebuild to the current source position before rollback.

Integrate semantic search-version changes with LLP 0081’s typed migration and approval protocol, and define behavior when the journal floor overtakes a rebuild.

### 3.8 The public operation and generated carrier are unspecified

**Severity: High — MATERIAL**

**Evidence:** The RFC defines `SearchPageV1` but not the manifest location of search declarations, operation kind or route, request/response envelope, schema version, generated function/reference shape, diagnostic carrier, capability identifier, or supported client arms. Current runtime, guide, and capability surfaces have no search operation to inherit. LLP 0037 also requires Rust-owned artifact shapes rather than a prose-only wire definition.

**Resolution criteria:** Define the Rust-owned declaration and wire types, serialization names, operation dispatch, generated references, capability identity, errors, version snapshots, and explicit headless/client-arm claims. Add corresponding guide and capability-index entries.

### 3.9 Several deterministic result details remain ambiguous

**Severity: Medium — DETAIL**

**Evidence:** The RFC does not define whether phrase occurrences overlap, how frequency is scoped across fields, or whether an identical atom appearing in both direct and `anyOf` sets contributes once or twice. Highlights are described as bounded at lines 442-453, but their object shape, count and byte limits, fragment selection, overlap merging, context selection, and prefix-span behavior are absent. These choices affect exact bytes and privacy bounds.

**Resolution criteria:** Specify the exact frequency and cross-set deduplication rules. Define a normative highlight schema and deterministic extraction algorithm with hard count and byte limits and executable vectors.

### 3.10 Identity and current-source claims need correction

**Severity: Medium — DETAIL**

**Evidence:** Lines 237-240 label UUIDv7 byte order as newest/oldest, but the current model treats `_id` as opaque and storage accepts arbitrary string IDs. UUIDv7 chronology therefore requires an activation invariant not presently stated. Line 239 implies the guide already establishes search defaults, but the current guide and capability index contain no search entry or GAP. The “exact hosted single-instance profile” is also not tied to a concrete target profile ID.

**Resolution criteria:** Validate canonical UUIDv7 IDs for all existing, imported, and future indexed rows before activation, or describe the order only as opaque ID-byte order. Correct the guide claim, add the missing capability entry, and name each exact target profile.

## 4. Suggestions

- For v1, prefer refusing candidate-overflow queries before releasing a page; it is considerably easier to specify and verify than a privacy-safe resumable top-k frontier.
- Reuse `owner.v1`, existing cursor keyring concepts, and LLP 0081 migration machinery rather than introducing parallel authority, key-rotation, or approval semantics.
- Create executable reference vectors for normalization, AST canonicalization, scoring, highlights, and cursor plaintext independently of any storage adapter.
- Replace “newest/oldest” with `id-desc`/`id-asc` unless UUIDv7 validity becomes a declared schema invariant.
- Clarify the non-goal at line 577: it currently reads as though exact cross-database ranking is excluded, despite that being a central conformance objective.

## 5. Open questions

- May v1 reject a query when exact top-k cannot be proven within the candidate-work ceiling?
- Are public-read search declarations intended to index only fields publicly observable to every caller?
- Is owner visibility exactly the LLP 0065 `owner.v1` effective-user model?
- Is fast rollback required after successor-only writes begin?
- Which concrete operation carrier and client arms are intended for the first release?
- Should paired-database equivalence cover deterministic logical outputs only, or also deadline-derived diagnostic outcomes?

## 6. Readiness verdict

The RFC has a credible architecture, but the Unicode contradiction, bounded exact-ranking gap, private-field disclosure path, authority ambiguity, timeout contradiction, cursor underspecification, and unsafe rollback model are material blockers. It is not ready for implementation or acceptance.

VERDICT: NOT READY
