**Reviewer family:** GPT (Codex)
**Provider / runtime:** OpenAI Codex CLI v0.145.0 — model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, approval never; non-interactive `codex exec` orchestrated by /llp-review
**Date:** 2026-07-24
**Redacted:** no — repo-local review; no secrets in the reviewed material; reviewer instructed not to read credential files or llp/reviews/
**Method:** cli-runner

# LLP 0080 reviews — GPT family

## Round 1 — 2026-07-24

## 1. **Overall assessment**

This is a good direction and an appropriately narrow first relational profile. The unique-side join restriction, root-window semantics, explicit visibility, transactional projections, and rebuild oracle are the right foundations.

It is not yet sound enough to serve as LLP 0063’s Step 5 prerequisite. Several load-bearing behaviors remain implementation choices rather than portable semantics: bounded root access, cursor progress, join equality, projection identity, the global 1,024-write proof, authorization delivery, and rebuild equality.

## 2. **Strengths**

- LLP 0080 §1 defines a genuinely closed plan: one joined source, bounded compound equi-joins, an exact joined-side unique index, no callbacks or SQL, and no silent many-side cardinality.
- LLP 0080 §2 makes the unusual but coherent choice of root-window semantics: root visibility precedes `take`, inner omission does not refill, and pagination advances across omitted roots.
- LLP 0080 §3 keeps source and output visibility explicit, forbids inferred declassification, and requires a static same-subject proof. The statement that maintenance authority cannot substitute for this proof is particularly strong.
- LLP 0080 §4 conservatively chooses `live_replace`, table-granular invalidation, and no unproved relational delta path.
- LLP 0080 §5 correctly requires source and projection writes to share one transaction and commit version, and correctly attempts to count derived writes globally under LLP 0007’s 1,024-write ceiling.
- LLP 0080 §6 and LLP 0081 §§1–5 have the right overall rebuild shape: exclusive fencing, a fresh generation, atomic publication, crash recovery, and an independently evaluated full-state oracle.
- LLP 0063 Workstream 6 correctly treats accepted semantics plus executable witnesses—not the existence of these drafts—as the Step 5 entry gate.

## 3. **Concerns**

1. **HIGH — A bounded result is not a bounded root query.**

   LLP 0080 §1 requires the joined unique index and projection reverse index, but no root index compatible with visibility, filters, cursor, and ordering. A sparse owner-filtered query can scan or sort an arbitrarily large table to produce ten rows, contradicting the Summary and LLP 0007 §§Query Semantics–Index Contract. It also exposes hidden population through latency and resource counters.

   **Resolution:** Require a named root access index and a static compatibility proof covering the security predicate, filter, order, and cursor. Restrict v1 filters to the fully pushable/index-compatible subset and add instrumented large, sparse, mostly-invisible fixtures that assert examined-entry and materialization bounds.

2. **HIGH — Pagination progress and identity are not specified.**

   LLP 0080 §2 says a cursor “may carry” root keys, while LLP 0007 still leaves cursor encoding open. The page envelope, strict boundary comparison, all-omitted window, `take: 0`, end-of-stream, malformed cursor, and cross-plan/cross-authority behavior are undefined. The no-duplicate/no-skip claim is also impossible under arbitrary concurrent order-key changes unless its scope is narrowed.

   **Resolution:** Normatively define:

   `visible root filter → cursor boundary → root order → take N roots → join/visibility → projection`

   Return continuation from the last consumed root even when no result row is emitted. Bind it to app, plan hash, normalized arguments, order schema, and authority partition. Define terminal and zero-take behavior, and either scope continuity to unchanged state or provide snapshot semantics. Test fully omitted pages and cross-plan, cross-user, stale, malformed, and concurrently mutated cursors.

3. **HIGH — The unique-index cardinality proof lacks a portable comparator.**

   “Same declared type” and “no target-specific collation” do not ensure that pure evaluation, SQLite, and a future Postgres unique index agree. String normalization/case/collation and reference-ID domain compatibility are unpinned; storage equality must exactly equal join equality for uniqueness to prove cardinality.

   **Resolution:** Define equality for each join-key type, including byte/code-point behavior, normalization, case, embedded NUL, reference target domain, and optional-root/null semantics. Require matching database collations/operator classes and add adversarial NFC/NFD, case, cross-reference-domain, boolean/integer, and compound-null cases.

4. **HIGH — `materializeAll(core, V)` cannot define the bytes it must equal.**

   LLP 0080 §5 passes only `core` and `V`, although output identity and publication metadata live outside the core. It does not define `_id`, `_createdAt`, `_updatedAt`, or `_version`. LLP 0081 §4 additionally preserves or synthesizes those fields using a predecessor generation, publication timestamp, and successor publication version—inputs absent from `materializeAll`. A rebuild pins source version `V` but publishes at successor version `V+1`.

   The “canonical content digest” is likewise missing its algorithm, framing, included fields, and domain separation, while LLP 0081 §5 permits sampling that cannot prove LLP 0080’s full byte-equality invariant.

   **Resolution:** Separate a normative logical-row function from a system-field carry-forward/publication function over the predecessor generation and explicit publication constants. Distinguish source and publication versions. Pin a versioned full streaming digest format, and require full proof—not sampling—for `RebuildMaintainedProjection`.

5. **HIGH — The global fan-out/write proof is neither closed nor serialized.**

   LLP 0080 §5 does not specify pre/post-image composition, old/new join-key unions, repeated-write coalescing, no-op writes, or whether “writes” means calls, logical rows, or physical transitions. Two concurrent root inserts can both observe capacity and exceed it unless reverse-index ranges are locked or commit-validated. Activation can similarly race ordinary writes.

   Activation checks plans sharing a joined source, but a table can be the root of enough plans that one root write always exceeds 1,024. Rejecting cycles while not rejecting projection DAGs also appears to admit transitive and diamond fan-out without a topological or global bound.

   **Resolution:** For v1, preferably require flat projections: one owner per output table and no maintained output as another projection’s source. Compute affected identities from the union of pre-state and final buffered post-state, evaluate each once against the final transaction snapshot, and define the counted unit. Make reverse-index ranges and the active-plan set commit dependencies or acquire atomic reservations. Activate under an exclusive barrier. Add two-writer, activation-race, root-role, key-move, repeated-write, chain, and diamond tests.

6. **HIGH — LLP 0053 integration and maintained-output read enforcement are incomplete.**

   LLP 0053 default-denies new protected-query forms and requires every auth-scoped `live_replace` to be obligation-backed. LLP 0080 §4 mentions resnapshotting but does not classify relational reads, decide whether all-public plans are `authorityIndependent`, or inherit LLP 0053’s obligation, disposition, ACK, reconnect, denial, and protocol-gate rules. A lost shrinking replacement could therefore leave forbidden rows visible.

   Separately, LLP 0080 §5 forbids direct writes to output tables but not direct reads. LLP 0065’s owner profile governs generated operations, not arbitrary `ctx.db` reads, so the output predicate has no specified universal enforcement locus. Retention is also not a closed plan capability and its first branch can be read as bypassing LLP 0053’s lease discipline.

   **Resolution:** Register all relational reads—including absent unique lookups—as snapshot-bound `DatabaseCaptured` inputs. Make owner plans auth-scoped, decide the all-public classification explicitly, and inherit LLP 0053 in full. Add default-deny `retention: none | opaque-authorized-snapshot-v1`. Make maintained outputs inaccessible except through visibility-enforcing references, or enforce row visibility on every read path. Test lost delivery, overflow, ACK loss, reconnect, lease expiry, raw point/index reads, inspection, and stale callbacks.

7. **HIGH — The claimed absence of an existence leak contradicts the diagnostic design.**

   LLP 0080 §3 says targets merely “may” collapse missing and invisible diagnostics, while the server trace distinguishes them; §7 promises inspection naming source rows and visibility decisions. Acceptance nevertheless claims that invisible joined rows leak no existence fact.

   **Resolution:** Define the observation boundary. Missing and invisible must be indistinguishable across application and ordinary Agent surfaces: result, cursor, code/status, transport, retry behavior, cache behavior, and diagnostics. Put distinguished traces behind a separately authorized, scoped, redacted, bounded audit channel. Narrow the claim to semantic noninterference unless constant-work timing is implemented, and run paired databases differing only by an unauthorized joined row across every claimed target.

8. **HIGH — The fan-out ceiling is a cross-authority count and availability side channel.**

   An owner-visible root may reference a public joined row shared by many owners. Root insertion or joined-row mutation then reveals whether other users have consumed the global `fanOutLimit` through success versus `SNAPBACK_PROJECTION_FANOUT_EXCEEDED`, and runtime/receipts may reveal more. One authority can also exhaust another’s capacity. Output visibility does not address this implicit flow.

   **Resolution:** Either forbid ordinary mutable shared-public joined sources feeding owner outputs, require an explicit declassification of global reference counts and resource coupling, or introduce an immutable/versioned dimension profile whose changes occur only through privileged rebuild. Test public responses, receipts, timing, and capacity behavior at 0, 1, 1,023, and 1,024 invisible references.

9. **MEDIUM — A left join can derive owner visibility from an absent joined row.**

   LLP 0080 §2 nulls every joined leaf for an unmatched or invisible left join, while §3 allows the output owner field to derive from either source. A public root plus owner joined source can therefore produce an output whose declared owner field is null, conflicting with LLP 0065’s required owner field and making durable output authorization undefined.

   **Resolution:** Require owner output identity to come from a guaranteed-present source: normally the root, or the joined side only for an inner join or a separately proven total relation. Add callable and maintained rejection fixtures.

10. **MEDIUM — Some acceptance claims exceed the admitted profile.**

    “Cross-tenant” tests cannot prove tenant isolation because LLP 0080 admits only `public-read` and owner visibility bound to `ctx.auth.userId`; LLP 0065 explicitly defers tenant profiles. Treating two users as two tenants misses the same-user/multiple-tenant case. Likewise, duplicate unique-index corruption requires deliberate below-constraint injection, and “every currently claimed hosted evaluator” needs a pinned target/profile manifest.

    **Resolution:** Define a real tenant profile or remove and explicitly narrow the tenant claim. Specify corruption injection below the unique constraint and enumerate exact target/profile versions consumed by acceptance.

11. **MEDIUM — The coupled acceptance clause points to unrelated documents.**

    LLP 0080 §6 says “0074’s rebuild corpus uses 0075’s executor.” Those numbers now name the Convex RFC and checkpoint Spec. LLP 0000 explicitly records that the former relational/migration 0074/0075 pair was renumbered to 0080/0081.

    **Resolution:** Replace those references with LLP 0080/0081, name the exact coupled suite and step, and restate LLP 0063’s conjunction: Step 0 plus accepted 0080/0081 semantics and their combined executable witnesses.

12. **MEDIUM — The normalized plan grammar contains unresolved contradictions.**

    LLP 0080 §2 first restricts ordering to “projected” fields, then says ordering fields need not be projected. `RelationalCoreV1` owns root filters and is reused by caller-free projections, but §7 promises callable argument validators without saying whether core filters may reference arguments. “At most one” joined table also conflicts with requiring a non-empty join conjunction.

    **Resolution:** Publish a closed schema for core, callable-only predicates, ordering, cursor, and projection-only constants. State that ordering may reference qualified root scalar fields independently of result projection, and decide whether v1 requires exactly one joined table.

## 4. **Suggestions**

- Name and serialize this as `root-window-v1`; otherwise future implementers will assume ordinary `JOIN … LIMIT` semantics.
- Narrow v1 output identity to a domain-separated function of projection identity plus immutable root `_id`.
- Add an immutable/versioned dimension-table profile. It would support common denormalization without imposing a mutable global reverse-fan-out ceiling.
- Use a small exhaustive state-machine oracle that permutes root/joined inserts, updates, deletes, key moves, filter transitions, replay, and write order, comparing every commit with full materialization.
- Consider a partitioned Merkle manifest for rebuild proof and drift localization once the canonical row digest is pinned.

## 5. **Open questions**

- Is `take` definitively a bound on consumed authorized roots rather than emitted rows?
- Is pagination snapshot-consistent, or only stable while data and authority remain unchanged?
- What exact root index/filter shapes are admitted?
- Are all-public plans auth-scoped or explicitly `authorityIndependent`, and may anonymous results be retained?
- Does projection equality include every Snapback system field?
- What exactly counts as one write under the 1,024 ceiling?
- May maintained outputs source other projections or share an output table?
- May a mutable public lookup source drive private owner projections?
- Is tenant visibility required for Step 5, or is v1 explicitly owner-only?
- What total work and downtime bounds make the exclusive rebuild barrier an admitted target profile?

## 6. **Verdict**

Verdict: NOT READY

Several HIGH blockers leave bounded execution, pagination, authorization delivery, projection identity, fan-out closure, and rebuild equivalence undefined, so acceptance would certify implementation choices rather than a portable contract.