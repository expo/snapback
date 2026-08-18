# LLP 0221: Offline search parity — generated local evaluators toward an owned offline-search capability

**Type:** RFC
**Status:** Accepted
**Systems:** Search, Client integration, Sync, Codegen
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-10
**Revised:** 2026-08-10 (e — Phase 0 executed and recorded closed (a: the
qualified-release and ticket closures are facts, recorded in §Execution
log; b: the envelope-latency fix landed with a generated-fixture proof and
the deviation from the named Clique-rerun proof disclosed); the Phase 1
spec artifact is extracted to LLP 0229 (Draft) with its corpus proof
obligation explicitly not yet delivered)
**Revised:** 2026-08-10 (Review → Accepted — accepted to begin implementation (author direction in-session, 2026-08-10); final verdicts bind revision (c), the (d) tail is unreviewed and disclosed; Phases 2+ remain gated as written)
**Revised:** 2026-08-10 (d — round-2 delta-convergence closure;
**UNREVIEWED** — final verdicts bind revision (c): dual NOT READY with all
remaining MATERIALs IN-DELTA and pre-existing text reported clean by both
families (`llp/reviews/0221-offline-search-parity.rfc.{claude,gpt-5}.md`,
round 2). Fixes the three in-delta MATERIALs: the public-data-only
prototype now explicitly does not precede Phase 4's owner-amendment
condition (in-store materialization of the derived record waits; only
out-of-store spikes are unrestricted); the new profile's delta now
includes benchmark-compatible token boundaries (internal apostrophes),
with a boundary conformance vector; `prefer-online` fallback is defined as
connectivity/transport failure before a semantic server response only —
authorization/custody/contract/corruption/work-limit refusals never
trigger fallback. Cheap MINORs: `unknown` qualified against `refused`,
additive facts confined to the rotated offline-capable surface with legacy
`SearchPageV1` unchanged, LLP 0126 citation made exact (OQ6 +
§Relationship, OQ7 only for the embedded-runtime alternative), OQ2
admission-gate conformance note)
**Revised:** 2026-08-10 (c — round-1 super-refine revision; verdicts bind
revision (b): dual NOT READY
(`llp/reviews/0221-offline-search-parity.rfc.{claude,gpt-5}.md`, round 1).
Fixes all four MATERIALs: Phase 4 now explicitly conditioned on an
owner-approved successor amendment advancing the LLP 0155 OQ2 / LLP 0157
§D7 source-row evaluation gate, with the corpus scoped as a query/partition
derived record and no cross-query normalization admission; completeness
vocabulary corrected to LLP 0166 §D4's closed classes (`unknown`, no new
class; partiality lives in the orthogonal `coverage` fact); the
semantic-profile identity now binds logical work units, counting rules, and
effective ceilings with at-limit/one-over conformance vectors; OQ2
constrained so a Unicode-table subset is a distinct profile identity or
fails closed, with non-Latin/edge-codepoint conformance vectors required.
Also lands the cheap MINORs: pilot evidence labeled N=1
builder-scored calibration, per-app cache claim narrowed, duplicate ticket
named, client delegation location added, Phase 2 restart-test scope
clarified, prefix-atom note, `prefer-online` continuation divergence, LLP
0126 OQ6/OQ7 citation)
**Revised:** 2026-08-10 (b — Draft → Review at llp-super-refine loop start,
the one authorized transition; sub-orchestrated loop)
**Revised:** 2026-08-10 (a — initial draft, synthesized from the Clique P2
pilot evidence and a GPT-5.6-sol design consultation)
**Related:** LLP 0073 (portable full-text search — the online profile this
extends; offline search is its explicit nonclaim), LLP 0043 (offline &
lease custody), LLP 0053 (the lease), LLP 0129 (JS-arm persistence
Phase 0), LLP 0131 (structured argument contracts — 2026-08-09 typed-search
amendment), LLP 0155 (local-sync product direction), LLP 0166 (local
persistent store — completeness-honest answers), LLP 0157 (composition
algebra — §D7 holds the source-row evaluation gate with LLP 0155 OQ2),
LLP 0126 (local-first research OQ6/OQ7), LLP 0201 (Clique benchmark),
`benchmarks/records/2026-08-09-social-messenger-p2-pilot.md`,
`issues/20260809-typed-search-contract-hash-skew.md`,
`issues/20260809-membership-search-envelope-latency.md`,
`issues/20260731-js-arm-lease-custody-and-sessions-outbox.md`

## Summary

The Clique P2 pilot scored Snapback's search dimension B6 at 55 — behind
Convex (58) and Supabase (65) despite Snapback being the only lane with a
server-authoritative portable search profile. (The record labels these
scores N=1, builder-scored, calibration-only evidence; they motivate, they
do not measure.) Three distinct problems contributed to that score, and
this RFC deliberately treats them as three:

1. **A shipped bug.** Typed `client.search()` in npm 0.1.15 refuses its
   own release's generated membership-search references with
   `SNAPBACK_SEARCH_REFERENCE_INVALID`
   (`issues/20260809-typed-search-contract-hash-skew.md`); it cost the
   lane a loop, worked around via hand-built plain `query()` calls.
2. **A server performance defect.** Membership-visible message search at
   the 166k-action envelope ran 582 ms p50 / **806 ms p95** on a
   10k-message chat while every other probe sat at 31–77 ms p95; Convex's
   posture-different global probe ran 82 ms p95 — signal, not a claim
   (`issues/20260809-membership-search-envelope-latency.md`).
3. **A capability gap.** `full-text-search-v1` is explicitly online-only
   (LLP 0073 line ~1034 keeps offline search a nonclaim), and the local
   persistent store retains opaque result fragments, not searchable source
   rows (LLP 0155 §Store model). The pilot lane reimplemented matching
   over an application-owned cache, and any app wanting offline search
   today must do the same, with the semantic drift and weak completeness
   that implies.

The RFC's destination is the **full offline-search capability**: local
search that owns corpus authorization, completeness, retention, and
revocation, coherent with the synced store's rules. The first shipping
rung is the **generated evaluator kernel** — `searchIndex` /
`defineSearchQuery` declarations compile to a local matcher with a
versioned semantic profile — explicitly *not* finished parity. The parity
promise is qualified exactly: **for the same semantic-profile version and
the same admitted document corpus, server and local evaluators produce
identical matches, ordering, highlights, and work-limit outcomes.**
Corpus coverage, freshness, authority, and continuation are documented
divergences, never hidden ones. Phase 0 fixes the two shipped defects
first; the protected-data rungs sequence behind the JS-arm
protected-retention custody work (LLP 0043 M1, open leg 1 of
`issues/20260731-js-arm-lease-custody-and-sessions-outbox.md`).

## Options considered

**1. Status quo plus hand-built local search.** Cheapest — document the
expected divergence, leave corpus and matching to applications — but it
preserves per-app duplicate logic, drift, and a B6≈60 ceiling.

**2. Generated pure local matcher.** Codegen emits a JS matcher from the
existing declarations; the app supplies cached rows. Removes
analyzer/query duplication and is a genuinely useful rung — but apps still
own corpus custody, revocation, completeness, ordering inputs, and
pagination, so it is not one coherent capability.

**3. First-class offline-search capability.** Generate both the server
plan and the local evaluator, plus owner-issued, query/partition-scoped
corpus materialization under Snapback proofs and leases. The correct
long-term abstraction; it requires corpus registration, completeness
facts, local cursors, protected retention, indexing, and cross-runtime
conformance.

**4. Replicate the server postings/index tables.** Strongest physical
similarity, but turns the client into a protected partial replica, couples
client storage to server index internals, and hardens deletion/projection
authority — conflicting with the fragments-first store boundary (LLP 0155)
and the sync-set registration guardrails (LLP 0166).

**Decision: Option 3 as destination, Option 2's evaluator kernel as the
first shipping rung.** Not close: a generated matcher alone cannot own
authorization, completeness, retention, or revocation, so it cannot
deliver the coherent capability B6 measures; the only close call is how
much of Option 3 rides the first rung, and presenting that rung as
finished parity would be incorrect. Wrong-call condition, recorded
honestly: if demand stays strictly warm-session best-effort cache search,
Option 2 alone delivers most of the ergonomic benefit at far lower
authority/storage cost, and the later phases should be shelved.

## Design detail

### Semantics: the current profile is not the benchmark's profile

The literal Clique semantics are not `full-text-search-v1`'s. The brief
pins NFC, Unicode simple case folding, word-prefix, newest-first
(`benchmarks/briefs/social-messenger.md` §Search); the shipped profile
pins Unicode 17 `toNFKC_Casefold` (analyzer
`snapback-category-unicode17-v1`) and `score-desc-row-id-asc.v1` ordering,
explicitly deferring recency to "a later scorer with a declared typed
timestamp" (LLP 0073 §Ranking). Therefore: do not silently relabel the
current profile as NFC/newest-first; add an opt-in, versioned
word-prefix/recency profile (or a declared timestamp-ordering extension)
with an exact tie-break; preserve existing `full-text-search-v1`
references and ordering unchanged; run Rust and JS against one generated
conformance corpus. (Prefix matching itself already ships as a query atom
— `SearchMatchAtomV1::Prefix` — so the new profile's actual deltas versus
the brief are the analyzer and ordering, not prefix support. The analyzer
delta is normalization *and* token boundaries: the brief splits words on
punctuation while the shipped analyzer keeps internal apostrophes inside
tokens, so `can't` tokenizes differently even after normalization is
pinned — the new profile must pin benchmark-compatible boundaries
explicitly.) Exact
**evaluator** equivalence is achievable; exact whole-operation equivalence
is not — local corpus state and cursors necessarily differ.

### Surfaces

- **Codegen** (`packages/snapback-codegen/define.mjs`, `index.mjs`):
  explicit offline profile + ordering declaration; a canonical
  local-evaluator descriptor/hash; a generated corpus-materialization
  companion per resource partition. Never infer retainability or authority
  from indexed fields.
- **Evaluator kernel** (new optional subpath, e.g.
  `@expo/snapback-client/local-search`): JS Unicode analyzer, AST matcher,
  scorer/orderer, highlighter, local cursor codec. Generated Unicode
  tables shared with `crates/snapback/src/search/`; kept out of micro-client bundles
  unless imported.
- **Store** (`packages/snapback-client/materialization-store.mjs` + RQS
  store arms): a derived search corpus/index record keyed by semantic-plan
  hash, resource argument, authority partition, materialization identity,
  and corpus version. Derived postings inherit the source corpus's lease
  and deletion transaction — they never acquire independent retention —
  and are discarded/rebuilt across format or semantic-profile changes.
- **Client API**: `client.search()` stays online by default; an explicit
  `execution: "online" | "local" | "prefer-online"` option opts in.
  Results carry additive facts — `execution`, `freshness`, `completeness`,
  `coverage`, `corpusVersion`. The additive facts ride only the rotated
  offline-capable reference/result surface; legacy online `client.search()`
  calls keep LLP 0073's closed `SearchPageV1` shape
  (`{items, cursor, hasMore}`) unchanged. `prefer-online` falls back to
  local execution only on connectivity/transport failure before a semantic
  server response; authorization, custody, contract, corruption, and
  work-limit refusals never trigger fallback — falling back there would
  mask a stronger server decision — and the local path still passes its
  own witness, fence, and lease checks. Server and local cursors are
  distinct formats and never cross execution modes — so a `prefer-online`
  pagination that loses connectivity mid-sequence cannot resume locally
  from a server cursor (a documented continuation divergence, surfaced
  where the option is documented); partitions are registered explicitly,
  never inferred as "all chats" from cached rows.
- **Answer honesty**: a local no-hit is authoritative only when the scope
  has an exact completeness proof; otherwise — when evaluation is admitted
  but completeness is unproved — it reports `completeness: "unknown"`
  (established refusal states remain `refused`), per LLP 0166 §D4's
  completeness-honest answer rule. §D4's answer classes are closed — this RFC adds no new class;
  partiality is expressed only through the orthogonal `coverage` fact
  (which scopes were searched), never as a completeness value.

Compatibility is additive throughout: existing references keep online
semantics; opting into local search rotates the semantic/artifact identity
and requires fresh corpus establishment; no old cache is relabeled.

## Phases

**Phase 0 — fix the shipped defects (before any offline work).**
(a) *Typed-search contract-hash skew.* Mechanism confirmed: a membership
search adds the generated `resourceArg` to the complete operation
contract, legitimately changing `argsContractHash`; 0.1.15's client then
compares that larger hash against the plain `SearchRequestV1` pin, so the
typed wrapper refuses while plain `query()` — which validates the actual
complete schema and never runs the mistaken discriminator check — works.
The fix shape is already on `main` (`f8e8892af`; LLP 0131's 2026-08-09
amendment): keep `argsContractHash` as the complete-operation witness,
generate a separate `searchRequestContractHash` excluding the resource
sibling (`packages/snapback-codegen/index.mjs` ~10661), carry
`searchResourceArg` explicitly, and have `client.search()` validate the
dedicated marker then delegate full validation to `query()`
(reference validation `packages/snapback-client/index.mjs` ~321;
delegation inside `client.search()` ~5618). Remaining closure is
operational: a qualified lockstep client/codegen release superseding
0.1.15, plus closing the still-open
`issues/20260809-typed-search-contract-hash-skew.md` (its twin,
`issues/closed/20260809-typed-search-reference-hash-skew.md`, is already
closed). Proof: the landed
`typed-search-wrapper.test.mjs` matrix (plain + membership references,
corrupted-hash and missing-resource refusals) green in that release.
(b) *Membership-search envelope latency (806 ms p95).* Membership
resolution itself is already a single pre-traversal seat lookup
(`crates/snapback/src/search/sqlite.rs` ~1798), so the likely bottlenecks are broader:
prefix predicates using `substr(token, …)` instead of an index-friendly
range (~1503), and candidate release doing per-row source lookup and
authoritative reload/re-analysis plus a final authoritative query (~1857).
Confirm with `EXPLAIN QUERY PLAN` and stage counters, then optimize via
prefix-range lookup and batched authoritative/source rechecks while
preserving all-or-nothing release. Public semantics unchanged ⇒ this is an
LLP 0073 implementation fix, not part of the offline design. Proof: the
Clique scale probe (10k-message chat, 166k-action envelope) rerun with
search p95 rejoining the flat probes, plus a scale regression gate.

**Phase 1 — semantic profile and conformance spec.** Specify the offline
profile, evaluator artifact format, and the generated dual Rust/JS
Unicode/match/ranking/highlight conformance corpus. The semantic-profile
version/hash binds not just analyzer, matcher, scorer, and highlighter but
also the logical work units, their counting rules, and every effective
ceiling — otherwise two evaluators under one profile name could diverge on
the promised work-limit outcomes (LLP 0073 makes work accounting and
exact-or-refuse semantic). Proof: the committed corpus, both runtimes
green on identical outcomes, with the corpus required to include
at-limit and one-over-limit work-ceiling vectors, token-boundary vectors
(including internal-apostrophe words like `can't`), and non-Latin /
edge-codepoint vectors that exercise the Unicode table boundary (the
motivating benchmark corpus is Latin-only and would be blind to analyzer
divergence there).

**Phase 2 — evaluator kernel (first shipping rung).** Pure JS evaluator
over caller-supplied rows; no protected-data retention; additive client
facts; distinct local cursors. Explicitly documented as not parity — the
qualified promise only. Proof: conformance corpus green in the client
package; IndexedDB and Node restart tests exercising evaluator-artifact
determinism over caller-persisted rows — the kernel itself persists
nothing; §Surfaces' derived corpus/index record is Phase 4 work (a
public-data-only prototype may precede the Phase 3 custody gate, per
Phase 3 — but never Phase 4's owner-amendment condition).

**Phase 3 — custody gate (sequencing, not work).** Protected corpus
retention MUST NOT land before JS-arm lease custody (leg 1 of the
2026-07-31 ticket: query-authorization namespaces, signed
`AuthorizedLease` custody, equality-expiry deletion-before-render) is
implemented and witnessed. A public-data-only prototype may precede this
custody gate — but it does not precede Phase 4's owner-amendment
condition: any materialization of the derived corpus/index record in the
shipped store waits for that amendment; only out-of-store spike
prototypes (no shipped store record) are unrestricted by it.
Membership-message offline search may precede neither.

**Phase 4 — owned corpus.** Protected corpus storage, local indexing,
explicit partition registration, completeness facts, membership/global
coverage. A locally searchable document corpus is source-row evaluation
territory: LLP 0155 OQ2 / LLP 0157 §D7 gate it, and LLP 0166 explicitly
does not advance that gate (no cross-query normalization, no local
execution of a plan's source-row pipeline). Phase 4 therefore lands only
through an owner-approved successor amendment to the owning store Spec
advancing that gate for this shape — and the shape it asks for is narrow:
a single-purpose derived corpus record scoped to one search plan ×
resource partition × authority partition, with separately authorized
corpus projections, no cross-query row sharing, and no authority ever
inferred from indexed fields. It is not an admission of general
cross-query normalization; if the gate's owner rules the narrow exception
unacceptable, Phase 4 blocks rather than routing around the gate. Proof:
lease equality expiry, membership revocation, principal change,
disappearing-message purge, delete-before-render, partial multi-chat
coverage, and authoritative no-hit negative witnesses.

**Phase 5 — capability publication.** Publish under LLP 0189 claim gating
only after restart, revocation, expiry, completeness, and pilot-envelope
witnesses pass, with 10k-document local CPU/storage/bundle metrology.

## Open questions

1. Does the word-prefix/recency profile have demand beyond the Clique
   benchmark, or does a benchmark-specific profile risk becoming permanent
   platform complexity (consultation risk list)?
2. What bundle-size budget bounds the JS Unicode tables for micro-clients,
   and is a table subset acceptable for the kernel rung? Constraint on any
   answer: a subset ships only as (a) a distinct declared
   semantic-profile/artifact identity, or (b) fail-closed refusal on
   out-of-subset input — never silent divergence under the same profile
   version, which would falsify the qualified parity promise. A
   fail-closed subset is a declared input-admission gate: conformance for
   that identity requires both runtimes applying the identical gate, with
   in-range, boundary, and out-of-range vectors.
3. Is "all chats" completeness (complete seat set × complete per-resource
   corpus establishment) worth its cost, or does v1 scope completeness to
   explicitly registered partitions only?
4. Does recency ordering land as a new profile or as LLP 0073's
   declared-timestamp scorer extension — and which document owns offline
   search (LLP 0126 OQ6 left the mechanism and capability id unresolved,
   and its §Relationship section requires a named owning document; OQ7
   applies only if the embedded-runtime front absorbs this)?

## Execution log

**2026-08-10 — Phase 0(a) closed.** The operational closure this phase
named has happened, most of it by the time execution started, and the
record is now complete rather than "still open":

- The fix (`f8e8892af`, LLP 0131's 2026-08-09 typed-search amendment) is
  an ancestor of `0e6bf1842a`, the clean-`main` cut of npm **0.1.17** —
  the qualified lockstep eleven-package fastpath release (retained ledger
  `~/snapback-release-ledgers/fastpath-ledger-0.1.17-0e6bf1842a.json`,
  byte-verified, receipts bound; LLP 0041 §0.1.17), now `latest` on npm.
  0.1.16 (2026-08-09) also postdates the fix; both supersede 0.1.15.
- `issues/20260809-typed-search-contract-hash-skew.md` was closed
  2026-08-10 as a duplicate of the already-closed
  `issues/closed/20260809-typed-search-reference-hash-skew.md`; both now
  live in `issues/closed/` with resolutions recorded.
- The named proof, `packages/snapback-codegen/typed-search-wrapper.test.mjs`
  (plain + membership references composed through `client.search()`,
  corrupted-hash and missing-resource refusals), runs green on current
  `main` (re-verified in this execution, 1 pass / 0 fail).

**2026-08-10 — Phase 0(b) landed.** Both diagnosed bottlenecks in
`crates/snapback/src/search/sqlite.rs` are fixed, public semantics unchanged (an LLP 0073
implementation fix, as this phase requires):

- *Sargable prefix traversal.* The two prefix predicates
  (`COUNT(DISTINCT token)` vocabulary-ceiling probe and candidate
  traversal) replaced `substr(token,1,length(?))=?` — which forced a full
  token scan of the partition — with the half-open successor range
  `token>=?5 AND token<?6` (open-ended when the prefix has no successor),
  which seeks on the `_snapback_search_terms_anchor` covering index.
  UTF-8 byte order under SQLite's BINARY collation equals code-point
  order, so the range returns exactly the substr row set; the
  `prefix_upper_bound` successor handles the surrogate gap and trailing
  `char::MAX`. Both ceilings trip at exactly the prior thresholds.
- *Batched release rechecks.* Candidate release now fetches retained
  source records and authoritative rows in deterministic IN-list chunks
  (400 ids) instead of two point queries per candidate. The per-candidate
  authoritative re-derivation, RFC 8785 digest tamper/drift rechecks, and
  all-or-nothing release with the same refusal codes are preserved
  unchanged — batching removes SQL round trips only.

Proof, as executed: (i) a deterministic `EXPLAIN QUERY PLAN` regression
gate (`prefix_candidate_plan_uses_anchor_token_range`) pinning the
anchor-index token-range SEARCH and refusing a terms-table SCAN — this,
not wall-clock, is the durable sargability witness; (ii) a
selective-prefix membership fixture (4,000 rows, ~21k-term partition
vocabulary, 50 matches) measured before/after, reported honestly: at
this committed-fixture size old and fixed traversal are equal within
noise (best-of-5, debug build: 53.5 ms old vs 56.4 ms fixed) because a
~21k-row scan costs single-digit milliseconds and the semantic
per-candidate release re-derivation dominates — the fixture proves
correctness, budget, and no-regression, while the scan-elimination
effect scales with partition vocabulary (the pilot's ~10k-message chat
implies a term partition an order of magnitude larger, scanned twice per
query before the fix); the envelope-scale measured before/after is
recorded in the next entry; (iii) a broad-match membership scale
budget test (2,000 rows all matching) guarding the batched release path;
(iv) `prefix_upper_bound` unit vectors; (v) the full `search::sqlite`
module green. Disclosed deviation: this phase named the Clique
10k-message/166k-action scale probe rerun as proof; execution
substituted the generated-fixture evidence above plus the plan gate
(program direction in-session, 2026-08-10). The pilot-envelope rerun
remains open and belongs to the next Clique run alongside O5 ceiling
calibration; `issues/20260809-membership-search-envelope-latency.md` is
closed on the landed code fix with the envelope-scale measurement and
pilot rerun noted as residual follow-through.

**2026-08-10 — Phase 0(b) envelope-scale before/after recorded.** The
selective-prefix fixture scaled to the pilot envelope's posting volume
(24,000 rows, ~216k-term partition vocabulary, 50 matches; constants
scaled in-place for measurement only, not committed), run on the same
machine and debug toolchain, best-of-5: **pre-fix (`ca7119ed5`)
135.3 ms; fixed (`4f7fe2ca7`) 25.5 ms — 5.3×**, post-landing evidence
against the landed commit per LLP 0189. This substantiates the
scan-elimination claim the committed CI-sized fixture deliberately does
not: at ~10× the committed vocabulary the pre-fix substr scan dominates
and the range seek removes it. Residual follow-through is now only the
Clique pilot probe rerun (next Clique run, O5 calibration).

**2026-08-10 — Phase 1 spec artifact extracted.** LLP 0229 (Spec, Draft)
now owns the semantic-profile identity (binding analyzer, matcher,
scorer/ordering, highlighter, logical work units, counting rules, every
effective ceiling, and refusal mapping), the canonical evaluator artifact
descriptor/hash, and the dual Rust/JS conformance-corpus format with the
required at-limit/one-over, token-boundary (internal apostrophe),
non-Latin/edge-codepoint, and subset-admission vector classes. Per this
phase's proof clause, the committed generated corpus with both runtimes
green is the execution proof and is *not yet delivered*: it lands with
the Phase 2 evaluator kernel, and LLP 0229 states that obligation
explicitly. OQ1/OQ2/OQ4 remain open and are only pointed at, not ruled.
