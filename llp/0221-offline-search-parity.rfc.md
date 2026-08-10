# LLP 0221: Offline search parity — generated local evaluators toward an owned offline-search capability

**Type:** RFC
**Status:** Draft
**Systems:** Search, Client integration, Sync, Codegen
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-10
**Revised:** 2026-08-10 (a — initial draft, synthesized from the Clique P2
pilot evidence and a GPT-5.6-sol design consultation)
**Related:** LLP 0073 (portable full-text search — the online profile this
extends; offline search is its explicit nonclaim), LLP 0043 (offline &
lease custody), LLP 0053 (the lease), LLP 0129 (JS-arm persistence
Phase 0), LLP 0131 (structured argument contracts — 2026-08-09 typed-search
amendment), LLP 0155 (local-sync product direction), LLP 0166 (local
persistent store — completeness-honest answers), LLP 0126 (local-first
research OQ6), LLP 0201 (Clique benchmark),
`benchmarks/records/2026-08-09-social-messenger-p2-pilot.md`,
`issues/20260809-typed-search-contract-hash-skew.md`,
`issues/20260809-membership-search-envelope-latency.md`,
`issues/20260731-js-arm-lease-custody-and-sessions-outbox.md`

## Summary

The Clique P2 pilot scored Snapback's search dimension B6 at 55 — behind
Convex (58) and Supabase (65) despite Snapback being the only lane with a
server-authoritative portable search profile. Three distinct problems
produced that score, and this RFC deliberately treats them as three:

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
   rows (LLP 0155 §Store model). Every pilot that wanted offline search
   reimplemented matching over an application-owned cache, with the
   semantic drift and weak completeness that implies.

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
conformance corpus. Exact **evaluator** equivalence is achievable; exact
whole-operation equivalence is not — local corpus state and cursors
necessarily differ.

### Surfaces

- **Codegen** (`packages/snapback-codegen/define.mjs`, `index.mjs`):
  explicit offline profile + ordering declaration; a canonical
  local-evaluator descriptor/hash; a generated corpus-materialization
  companion per resource partition. Never infer retainability or authority
  from indexed fields.
- **Evaluator kernel** (new optional subpath, e.g.
  `@expo/snapback-client/local-search`): JS Unicode analyzer, AST matcher,
  scorer/orderer, highlighter, local cursor codec. Generated Unicode
  tables shared with `src/search/`; kept out of micro-client bundles
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
  `coverage`, `corpusVersion`. Server and local cursors are distinct
  formats and never cross execution modes; partitions are registered
  explicitly, never inferred as "all chats" from cached rows.
- **Answer honesty**: a local no-hit is authoritative only when the scope
  has an exact completeness proof; otherwise it reports
  `unknown`/`partial`, per LLP 0166 §D4's completeness-honest answer rule.

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
(`packages/snapback-client/index.mjs` ~321). Remaining closure is
operational: a qualified lockstep client/codegen release superseding
0.1.15, plus closing the duplicate ticket. Proof: the landed
`typed-search-wrapper.test.mjs` matrix (plain + membership references,
corrupted-hash and missing-resource refusals) green in that release.
(b) *Membership-search envelope latency (806 ms p95).* Membership
resolution itself is already a single pre-traversal seat lookup
(`src/search/sqlite.rs` ~1798), so the likely bottlenecks are broader:
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
Unicode/match/ranking/highlight conformance corpus. Proof: the committed
corpus, both runtimes green on identical outcomes.

**Phase 2 — evaluator kernel (first shipping rung).** Pure JS evaluator
over caller-supplied rows; no protected-data retention; additive client
facts; distinct local cursors. Explicitly documented as not parity — the
qualified promise only. Proof: conformance corpus green in the client
package; IndexedDB and Node restart tests for the non-protected path.

**Phase 3 — custody gate (sequencing, not work).** Protected corpus
retention MUST NOT land before JS-arm lease custody (leg 1 of the
2026-07-31 ticket: query-authorization namespaces, signed
`AuthorizedLease` custody, equality-expiry deletion-before-render) is
implemented and witnessed. A public-data-only prototype may precede this
gate; membership-message offline search may not.

**Phase 4 — owned corpus.** Protected corpus storage, local indexing,
explicit partition registration, completeness facts, membership/global
coverage. Proof: lease equality expiry, membership revocation, principal
change, disappearing-message purge, delete-before-render, partial
multi-chat coverage, and authoritative no-hit negative witnesses.

**Phase 5 — capability publication.** Publish under LLP 0189 claim gating
only after restart, revocation, expiry, completeness, and pilot-envelope
witnesses pass, with 10k-document local CPU/storage/bundle metrology.

## Open questions

1. Does the word-prefix/recency profile have demand beyond the Clique
   benchmark, or does a benchmark-specific profile risk becoming permanent
   platform complexity (consultation risk list)?
2. What bundle-size budget bounds the JS Unicode tables for micro-clients,
   and is a table subset acceptable for the kernel rung?
3. Is "all chats" completeness (complete seat set × complete per-resource
   corpus establishment) worth its cost, or does v1 scope completeness to
   explicitly registered partitions only?
4. Does recency ordering land as a new profile or as LLP 0073's
   declared-timestamp scorer extension — and which document owns offline
   search (LLP 0126 OQ6 left the owner unresolved)?
