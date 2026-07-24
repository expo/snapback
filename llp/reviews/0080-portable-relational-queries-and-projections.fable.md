**Reviewer family:** Claude
**Provider / runtime:** Claude Code CLI (Fable)
**Date:** 2026-07-20
**Redacted:** no
**Method:** cli-runner

I've read LLP 0080 in full, plus the governing context: LLP 0004 (deferred-joins boundary, syncable-subset rules), LLP 0007 (portable query semantics, unique-index v1 rules, commit-version contract, 1,024-write mutation buffer), LLP 0053 (auth-scoped resnapshot/obligation model), LLP 0063 Workstream 6 and its Step 5 entry gates, and LLP 0065 (declaration floor, owner-only v1 visibility profile). Here is the review.

---

# Review: LLP 0080 — Portable relational queries and maintained projections

## Overall assessment

This is a good proposal with the right instincts, and it is clearly written by someone who has internalized the corpus's hard-won rules: closed plans over SQL text, explicit visibility over inference, bounded results, one evaluator semantics, same-transaction projection maintenance, no `live_delta` claim without a proved matcher. The scoping discipline is excellent — the non-goals list is exactly the set of things that would have quietly imported SQLite semantics or broken LLP 0053's model. The RFC also correctly refuses to open the LLP 0063 Step 5 gate by existing (§Summary), which matches the Plan's "acceptance plus executable witnesses, not existence" rule.

However, it is not yet acceptable as written. Three load-bearing semantics are unpinned, and each one is the kind of gap that surfaces as a production incident rather than a failing test if the acceptance corpus doesn't know to look for it: (1) maintained projections have an **unbounded write fan-out** when the uniquely-joined source is updated, which collides with LLP 0007's 1,024-write mutation bound; (2) the **composition order of visibility predicates with ordering and `take`** is not specified, which affects correctness, pagination, and a potential count side channel; (3) **rebuild determinism under concurrent writes** is asserted (content digest) but the snapshot the digest is computed against is undefined. There is also an internal contradiction about whether the join key is a single field or a compound sequence.

## Strengths

- **The closed-plan discipline (§1) is exactly right.** No SQL text, no callbacks, no dynamic property access, fail-closed on unknown vocabulary — this is LLP 0004's "structured predicate, not JavaScript" rule and LLP 0065's fact-class model applied consistently to the relational tier. The unique-index cardinality proof requirement, rather than a first-row pick, avoids the classic "which duplicate wins" nondeterminism, and declaring duplicate rows under a unique index to be a **storage-invariant failure** (§2) is the correct fail-closed posture.
- **The authorization posture (§3) is honest and matches the corpus.** Predicates execute inside the authoritative transaction before projection; visibility is declared, never inferred (LLP 0065 §1–2); invisible-equals-absent under `inner` collapses "doesn't exist" with "can't see," which is the correct non-leaking equivalence; the conservative dependency set explicitly includes authorization-backing relations and is explicitly *not* enforcement. The authority-partition fencing sentence directly picks up LLP 0063 WS1's provider-issued partition identity, which the round-6 review fought hard to get right.
- **`live_replace`-only with no implied delta (§4)** is exactly what LLP 0053 demands — its conservative predicate already treats every auth-scoped `live_replace` as potentially shrinking and obligation-backed, and this RFC refuses to claim the matcher capability it hasn't built. The prohibition on retaining unprojected joined rows to recompute locally closes a real offline-leak path.
- **Same-transaction projection maintenance (§5)** is the strongest design choice in the document. No after-commit repair, no independently visible projection version, replay idempotence riding the existing mutation settlement — this eliminates the source/projection skew class entirely rather than managing it.
- **The acceptance suite (§Acceptance) is unusually strong for a Draft**: byte-identical cross-evaluator corpus, cross-user/cross-tenant negative tests, injected-failure atomicity, crash points on both sides of publication, and the same-landing amendment of LLP 0004/0007's deferred-work sections (good corpus hygiene per LLP 0016's reconcile discipline).

## Concerns

**C1 — HIGH — Maintained-projection fan-out on joined-source updates is unbounded.**
§5 says every source mutation "computes the finite set of affected projection keys and updates the output in the same storage transaction." The joined source is unique on the join key, but the relationship is many-to-one from roots: arbitrarily many root rows (hence output rows) can reference one joined row. An update to one joined row therefore fans out to an unbounded set of output writes inside one transaction. *Finite* is not *bounded*. This collides with LLP 0007's rule that one mutation may buffer at most 1,024 writes — either projection writes count against that bound (mutations fail unpredictably based on data shape) or they bypass it (unbounded transactions, exactly what §2 forbids for reads). Nothing in the RFC decides.
*Resolution:* pin one of: (a) v1 requires every joined-source field the mapper reads to be declared immutable-after-create, so joined updates cannot invalidate outputs (simplest, statically checkable, and honest about v1's scope); (b) a declared per-plan fan-out ceiling with a stable refusal diagnostic (`SNAPBACK_PROJECTION_FANOUT_EXCEEDED`) when a mutation would exceed it; or (c) route over-ceiling updates into a rebuild requirement. Whichever is chosen, add an acceptance case that updates a joined row referenced by many roots.

**C2 — HIGH — Visibility-versus-limit composition is unpinned.**
§2 says the root is "filtered and ordered under LLP 0007 before the join is materialized"; §3 says predicates run "before projection." *Before projection* is weaker than *before ordering and `take`*. If the root visibility predicate runs after `take`, invisible rows occupy top-N slots: callers get short pages whose shortness is a function of rows they may not observe (a count side channel), and cursor identity is corrupted. Separately, `inner` joins whose joined row is unmatched or invisible drop roots *after* the limit — the RFC never says whether the result may be shorter than `take` or whether targets refill (refilling breaks the bounded-read ceiling).
*Resolution:* pin explicitly that (a) the root visibility predicate composes into the logical root filter before ordering and `take`; (b) the joined visibility check runs per unique lookup; (c) `inner` omission may yield fewer than `take` rows with **no refill**, and cursors advance over root order keys so omitted rows are never skipped across pages. Add an acceptance case where an invisible root row sits inside the top-N boundary and one where inner-join omission shortens a page mid-pagination.

**C3 — HIGH — Rebuild determinism under concurrent writes is undefined.**
§6 validates "a canonical content digest" and the acceptance suite compares a crash-recovered generation against "a clean rebuild" — but a digest is deterministic only relative to a source snapshot, and nothing says whether source mutations (which per §5 must synchronously maintain the *current* generation) are blocked, dual-applied to the in-flight generation, or replayed via snapshot-plus-catch-up during a rebuild. Handing "approval, checkpointing, cleanup" to the migration RFC (LLP 0081) does not discharge this: "the projection invariants it must preserve" must include *the published generation equals the mapper applied to the source at the publish commit version*, and that invariant is only meaningful once the concurrency stance is chosen.
*Resolution:* state the v1 stance in this RFC (a write-blocking rebuild with a bounded window is a defensible v1; dual-apply is the alternative), name the invariant in terms of a pinned commit version, and add a write-during-rebuild acceptance case — the current crash cases test the boundary but not the race.

**C4 — MEDIUM — Single-equality versus compound-key contradiction.**
§1 requires "exactly one equality join whose operands are declared scalar fields" (singular) but then requires the unique index "whose complete key is the join field sequence" (plural). If compound unique indexes are admissible, one equality cannot be the complete key; if only single-field keys are admissible, "sequence" is misleading and the restriction should be stated (it also interacts with LLP 0007's compound unique-index spelling). Pin one reading.

**C5 — MEDIUM — Join-key type domain is unrestricted.**
Join operands must be "declared scalar fields of the same portable type," and LLP 0007's scalar vocabulary includes floating point and exact decimal. Float equality as a join key is a cross-engine hazard (SQLite REAL affinity, -0/+0, NaN storage) that the byte-identical claim will eventually trip over, and it's a semantic smell besides. *Resolution:* whitelist v1 join-key types — string, id/reference, safe-range integer, boolean — and refuse the rest with `SNAPBACK_RELATIONAL_PLAN_INVALID`. This costs nothing real and removes a whole acceptance-corpus quadrant.

**C6 — MEDIUM — Projections can silently widen visibility.**
§5 requires source visibility and output visibility to be declared separately but imposes no relationship between them. A projection whose output profile is broader than its sources' is a declared-but-quiet information-flow widening — data laundered from a narrow profile into a broad one by a mapper running with system authority. LLP 0065 forbids *inference*, not explicit declaration, so this is permitted; but it should not be *silent*. *Resolution:* when output visibility is not provably at-most-as-narrow as every source's, require an explicit acknowledgment flag on the plan and surface the widening in §7's inspection explanation; add a negative acceptance case for the unacknowledged form.

**C7 — MEDIUM — v1 expressiveness may not clear the Step 5 fixture.**
Every source must name a visibility declaration "accepted by its governing authorization profile," and LLP 0065's only v1 profile is owner-scoped. If that is the admissible vocabulary, the only expressible v1 join is owner-scoped ⋈ owner-scoped for the same caller — but the common denormalization need (and plausibly Partitime's: events, venues, RSVPs with membership visibility) joins a private root against a public or membership-scoped lookup table. The RFC never says which profiles are admissible, and the Step 5 acceptance bullet ("demonstrates both generated helpers, records source/glue reduction") may be unsatisfiable or reduced to a toy under owner-only. *Resolution:* state the admissible profile set explicitly, and verify now — before acceptance — that the intended Step 5 fixture's joins are expressible in it; if not, a minimal public-read profile needs a home (this RFC, or a small LLP 0065 follow-on, per its own open question 2).

**C8 — LOW — Cardinality declaration is semantically underdefined.**
`one` versus `optional-one` (§1) overlaps with `inner` versus `left` and the RFC never says what `one` means when no row matches at runtime — integrity violation with a diagnostic, or just omission? Either drop the declaration in v1 or define it as an assertion with a named failure code.

**C9 — LOW — Skip-proof interaction with LLP 0053's convergence fixtures.**
LLP 0053 requires an L4-style convergence assertion for every authorization-sensitive skip or delta proof. If any captured-dependency skip path (proved-disjoint verdicts) applies to relational subscriptions, relational plans must carry the same convergence fixture; if v1 deliberately excludes relational plans from all skip proofs (table-granular invalidation only), say so — it's the safer v1 and worth one sentence.

## Suggestions

- **Define the canonical result serialization.** "Byte-identically" (§Acceptance) is only testable once one canonical encoding of results — field order, null representation, number formatting, Json leaf serialization — is pinned. Name where that lives (LLP 0010's conformance-corpus machinery seems like the home).
- **State invalidation granularity.** One sentence saying the v1 dependency set is table-granular for invalidation purposes would close C9 and set fan-out expectations for §4's resnapshot cost.
- **Consider excluding `Json` fields from projection leaves in v1**, or pin their canonical serialization; LLP 0007 already fails closed on Json ordering for the same reason.
- **Non-standard idea worth considering:** make the projection's declared plan literally *be* a `RelationalQueryPlanV1` plus a key expression ("materialize this query"), rather than a parallel structure sharing vocabulary. It collapses two spec surfaces into one, makes the rebuild recipe trivially "run the query at version V," and gives you the query/projection equivalence property as a testable invariant: projected table contents at version V byte-equal the query result at version V. That equivalence check is a far stronger acceptance oracle than row count plus digest.
- **Add a diagnostic for the fan-out refusal** (whatever C1's resolution is) to the §7 stable-diagnostics list — every other refusal in the design has a named code; this one shouldn't be the exception.

## Open questions that must be answered before acceptance

1. C1: what bounds joined-source update fan-out, and do projection writes count against LLP 0007's 1,024-write mutation buffer?
2. C2: does the root visibility predicate compose before `take`, and may `inner` results be shorter than `take` without refill?
3. C3: are source writes blocked, dual-applied, or caught-up during rebuild, and at which commit version is the content digest defined?
4. C4: single-field or compound join keys?
5. C7: which visibility profiles are admissible for v1 sources and outputs, and is the Step 5 fixture expressible in them?
6. (Existing open question 2 — invisible vs. absent in admin inspection — is already partially answered by §3's structured-trace sentence; reconcile the two.)

## Recommended next step

Revise before any further review rounds: resolve C1–C3 in the document (they are design decisions, not implementation details, and each changes the acceptance suite), fix the C4 contradiction, and answer C7 by checking the intended Step 5 fixture's joins against the admissible profile set. Then extend §Acceptance with the four missing cases named above (joined-row fan-out, invisible-row-in-top-N, write-during-rebuild, short-page pagination) and run the LLP 0005 review loop on the revised draft. Keep the RFC Draft until then — the current text's gaps are exactly where an implementation would silently pick SQLite's answer, which is the failure mode this profile exists to prevent.

## Re-review — 2026-07-20

### Overall assessment

The reconciliation closed the prior review's visibility-before-window,
compound-key, type-domain, no-widening, cardinality, invalidation, and rebuild
fencing concerns. The shared-ceiling arithmetic was verified: one direct write
plus 1,023 projection writes equals LLP 0007's 1,024-write maximum, and the
worst-case buffered overfetch exactly meets the 2,048 internal ceiling.

The revision introduced one high-severity contradiction by treating a
maintained projection as a literal callable query: callable queries carry
caller visibility, ordering, and `take`, while a durable table must materialize
all governed rows under system authority. Several smaller fan-out,
authorization-profile, provenance, and coverage pins remained.

### Concerns

**H1 (High) — The materialization invariant was inconsistent with `take`,
ordering, and caller visibility (§5 against §1–3, §6).** If `take` applied, a
top-N projection could not refill its boundary correctly; if visibility applied,
the output table depended on an undefined caller; if neither applied, the stated
equivalence oracle was false. Split a shared relational core from the callable
window and define all-row system-authority materialization explicitly.

**M1 (Medium) — The static fan-out limit referred to a runtime-dependent
"remaining" ceiling and did not compose multiple projections (§5).** Declare a
static bound and prove the summed output writes across all affected projections
plus direct writes before mutation.

**M2 (Medium) — The 1,024th-root acceptance wording was ambiguous.** Under the
then-current design, a root insert was legal while the joined-row update was the
operation that exceeded the total. If admission is guarded, say so explicitly
and test both the admission and update boundary.

**M3 (Medium) — `public-read` had no governing definition (§3).** Define
anonymous/authenticated behavior, partition identity, and write non-authority,
or gate on an LLP 0065 amendment.

**M4 (Medium) — Ordinary root inserts could silently create a joined key that
no normal update could ever change (§5).** Refuse the admission that crosses the
declared reverse-reference bound or expose the wedge prospectively.

**M5 (Medium) — "same authority field" and owner-output field provenance were
ambiguous (§3).** Distinguish same authority subject from physical field-name
identity and prove the output owner field derives from a source owner field.

**M6 (Medium) — The conformance corpus omitted execution sites the normative
text claimed (§2, Acceptance).** Include the retained/native evaluator and
either include Postgres or scope it to a future admitted profile.

Low findings: add LLP 0081 to Related and explain the coupled implementation
acceptance; clarify that opaque cursors may carry unprojected root boundary keys.

### Suggestions

- Preserve the strong equality oracle as
  `output = materializeAll(core, V)` and exercise more than 1,024 roots.
- Assert exact-fit ceiling behavior to catch off-by-one errors.
- Use an indexed reverse-reference admission proof so over-limit joins cannot
  become a delayed operational trap.

### Recommended next step

Restate the materialization invariant before further review, then pin the
global fan-out proof, public visibility, owner provenance, and missing corpus
sites. The reviewer considered the architecture sound but recommended keeping
the RFC Draft until the central equivalence sentence no longer required an
implementation to invent semantics.

## Final targeted review — 2026-07-20

**READY.** No HIGH or MEDIUM blockers remain.

The reviewer verified all five targeted gate areas:

- `RelationalCoreV1` is cleanly separated from callable visibility/order/cursor/
  `take`, while `materializeAll(core, V)` is an all-root, system-authority,
  canonical-key-order oracle exercised above 1,024 rows.
- Static `fanOutLimit`, reverse-index admission, global summed writes, exact-fit
  1,024 behavior, pre-activation over-limit refusal, and two-projection
  composition are coherent and witnessed.
- `public-read` now defines anonymous/authenticated truth, no write authority,
  and partition fencing; LLP 0065 explicitly cedes that narrow profile, and
  owner outputs prove same-subject source-field provenance.
- The normative and acceptance evaluator lists both include retained/native;
  Postgres is correctly a future profile that must pass before it is claimed.
- LLP 0081 is related and supplies the exclusive barrier, pinned V, crash
  recovery, and reciprocal coupled acceptance; neither RFC claims an executable
  witness before the combined suite passes.

Two LOW nits remained: activation originally checked each plan but not the
cross-plan summed wedge, and projection same-subject language could more
explicitly be static rather than caller-relative. Both were clarified after the
review. The reviewer recommended author acceptance; this review does not perform
that status transition.

## Re-review — 2026-07-24 (post GPT-round reconciliation)

**Provider / runtime:** claude-code sub-agent (Fable, fresh session — not the authoring or reconciling session)
**Method:** sub-agent

The document was substantially revised on 2026-07-24 to reconcile the GPT family's round 1 (see the .codex.md artifact). This fresh-session re-review verified all five prior READY-gate areas HOLD (core/callable separation and `materializeAll`; fan-out proof coherence; `public-read` semantics; evaluator lists, including the exact 2,048-overfetch fit; 0080/0081 coupling via `RELATIONAL_MIGRATION_COUPLED_SUITE_V1`), and cleared the new material's index-served filter restriction, byte-equality comparator, cursor binding versus the buffered overlay, `sharedFanOutDisclosure` versus the widening ban, and the output-table raw-read rule.

Initial verdict was **NOT READY** on two MEDIUM findings introduced by the reconciliation itself: the acceptance corpus demanded a concurrent-mutation cursor refusal §2 forbids and cannot witness, and the output-row `_id` rule digested an undefined "plan identity" whose only defined reading (the plan hash) contradicted the document's own preservation rules and LLP 0081's inherited-`_id` rule; plus two LOW findings (the activation bound's worst-case model excluded key-moving doubling; the noninterference claim was unscoped against the disclosure channel).

## Targeted verification — 2026-07-24

**READY.** All four findings verified RESOLVED after fixes: the pagination bullet now witnesses §2's stated concurrency bound with exactly §2's refusal classes; §5 digests the revision-stable stored projection identity (activation-timestamp time bits, LLP 0081 §3's UUIDv7 layout) consistently with §6 and LLP 0081; the activation bound is scoped to non-key-moving mutations consistently with the exact-fit fan-out witness; and the noninterference boundary names the write-path disclosure channel as outside its claim. No new contradictions; prior gate areas untouched. The remaining LOW test-coverage nit (cross-argument-set and order-schema-invalid cursor refusals not separately named as witnesses) was fixed after the review. The reviewer recommended the document as READY for author acceptance; this review performs no status transition.
