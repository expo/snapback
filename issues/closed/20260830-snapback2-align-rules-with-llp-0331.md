# snapback2: align the rule surface with scoped-authority research

**Status:** Resolved — implementation and named proof closure verified
**Systems:** snapback2, schema, certificate, test
**Severity:** P2
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-30
**Related:** LLP 1001 §3/§4/§9/§10, LLP 1002 §2/§4/§7; LLP 0331
§"Failure and disclosure semantics" and §"Amendment to ruling 0" (Draft
Research influence only; it is not a governing Snapback2 spec)

LLP 0331 supplied evidence after the first engine implementation landed. Per
the Snapback2 fence, its author rulings bind only that research proposal. The
implemented decisions belong to LLP 1001 and LLP 1002. This issue tracks the
five deltas needed to make that adoption honest; it is not the full M1–M3
scoped-authority program.

## Adopted Snapback2 decisions

1. **The system principal is a value, not a kind term.** The only rule IR is
   `Eq(Viewer, Literal(Id("system")))`. `rule.system()` is compiler sugar for
   exactly that expression. `RuleExpr::PrincipalKind` and
   `rule.principal(kind)` do not exist. Protected identity may retain kind
   metadata, but it supplies no rule authority. The chat fixture/template
   names `rule.system()` on each system-written table. The corpus keeps its 76
   filenames, case names, and expected results; regenerated IR bytes change
   deliberately to remove the legacy serialized `input_visibility` field.
2. **Rule-input visibility is structural and derived.**
   `rule.exists(table, index, key)` has no visibility/options argument and its
   IR has no `input_visibility`. Public/allow targets are readable. A protected
   target is readable only when substituting the exact outer indexed key for
   its row fields proves its read rule for that same row: reflexive `Eq`, all
   arms of `And`, one arm of `Or`, or a self-`Exists` on the same table/index
   reducing to the identical key. This deliberately admits the canonical
   self-readable `(scope, viewer)` membership row. `Deny`, `Ne`, `Not`,
   cross-table/different-index probes, unpinned fields, and unknown forms fail
   closed to an authority verdict. A fourth authored argument is a sited
   `E_RULE_INVALID` refusal, never an escape hatch.
3. **`Capped` disclosure follows prefix uniformity.** Every read-policy row
   field, including a field used in an indexed rule-probe key, must be pinned
   by the scan's index prefix for the range to be uniform. Any non-uniform
   range makes the whole query opaque `{ state: "capped" }` with neither
   `site` nor `take`, whether that authoritative range exhausted or hit its
   limit; opaque dominates a disclosable cap from another range. For a uniform
   prefix, physical empty and all-hidden are identically `Complete`. An
   ordinary uniform visible range stopped by `Limit` may return `Capped` with
   both `site` and `take`. A mixed result under a purported uniform proof
   fails closed to opaque.
4. **Revocation and stale authority have named proofs.** LLP 1002 §7 names
   `live-revocation`, `successor-policy-fence`, and
   `grant-incarnation-aba`. They respectively prove an admitted live query
   becomes denied at the membership-deletion commit, a retained G handle
   cannot execute G's predecessor policy after G+1, and a stale intent cannot
   hit a membership removed and recreated under the same logical key.
5. **The authority subject is nominal.** `Principal`/`t.principal()` is
   distinct from every application row id and `Ref<T>`, even while the v1 wire
   encodes all three as ID-shaped values. Compiler rule typing and raw
   `Generation::certify` typing resolve every comparison and indexed probe;
   `Viewer` can meet only a Principal axis (or the reserved `system` literal).
   The canonical chat fixture keeps separate profile row ids and Principal
   creator/member/author axes.

## Working-tree audit (2026-08-30)

- [x] System authority is lowered to the literal viewer equality; the rule
  kind term and authoring surface are removed, and runtime system checks do
  not trust kind metadata.
- [x] Authored input visibility is removed from the compiler, IR, Rust
  engine, and evaluator; the compiler has a negative fourth-argument test.
- [x] The engine, wire, and client represent opaque `Capped` without
  `site`/`take`, and the engine gives non-uniform ranges opaque precedence.
- [x] Principal is nominal across schema, program args, generated/client
  types, rule checking, raw project certification, and the canonical fixtures;
  type-negative tests reject string/row-ref values and pseudo-memberships.
- [x] All three named served-loop authority proofs pass, and the structural
  visibility/Capped edge cases below have direct parity coverage. The
  canonical receipt records `live-revocation`, `successor-policy-fence`, and
  `grant-incarnation-aba` as passing.

## Remaining before resolution

- [x] Direct Rust and evaluator parity cases cover public/readable input,
  exact self-readable indexed membership, and a protected near miss that
  fails closed; the compiler negative separately proves authors cannot select
  visibility.
- [x] Direct engine/wire cases prove uniform empty and uniform all-hidden are
  identical `Complete`, empty and occupied non-uniform scans are identically
  opaque, an opaque later range dominates an earlier visible cap, and the
  client accepts only paired or fully omitted `site`/`take`.
- [x] Make `live-revocation` a served `snapback2 test` receipt check. The existing
  core `complete_to_denied_with_the_same_result_is_a_changed_delivery` test is
  useful engine evidence but does not satisfy LLP 1002's loop-level proof by
  itself. The canonical chat receipt now opens Bob's thread, commits the named
  `groups.memberLeave` mutation, and observes `Complete -> Denied` at the exact
  mutation sequence with no delivered rows.
- [x] Core coverage retains a named handle across an applied successor,
  resolves it under the active denying policy, and rejects the captured
  predecessor certificate. The served-loop `successor-policy-fence` check now
  also retains a G subscription across control-plane application of G+1 and
  proves both that handle and a fresh request resolve under G+1's deny policy.
- [x] The intrinsic immutable membership row id is the grant incarnation.
  `grant-incarnation-aba` captures the old id, removes it, recreates the same
  `(scope, principal)` relation under a fresh id across an owner restart, and
  proves replay of the captured promote/remove intent cannot affect the
  successor row. Serving `ctx.newId()` uses a durable per-store namespace and
  precommitted high-water range, rather than wall clock plus process-local
  state. Core rollback/reset/restart coverage proves an exposed id is not
  reused. Core raw-IR tests also reject addressed update/upsert attempts whose
  resulting `id` differs from the addressed key, before storage or index
  mutation.
- [x] The corpus is regenerated without legacy `input_visibility`; all 76
  filenames/case names and expected semantic results remain, and the Rust
  engine/evaluator twin passes all 76.

## Resolution

Resolved on 2026-08-30 after the exact canonical command
`cargo test -p snapback2 --test test_verb chat_template_receipt_tracks_the_effect_engine_and_lists_all_journeys -- --nocapture`
passed all named authority checks. Its invalidation qualification recorded 50
probes, 70 persona-seed attempts, 13 concrete overlaps, 12 exact deliveries,
37 disjoint silences, five explicit system-only effect exclusions, 75
auditable outcomes, and zero blocked pairs. `cargo test -p snapback2`,
`cargo test -p snapback2-core`, the 54-check compiler suite, the 59-case
package suite (58 passed, one intentional skip), and `./ref-check --verbose`
also passed on the integrated tree.
