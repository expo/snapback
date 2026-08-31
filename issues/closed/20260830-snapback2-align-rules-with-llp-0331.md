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
deltas needed to make that adoption honest; it is not the full M1–M3
scoped-authority program.

## Adopted Snapback2 decisions

1. **The system principal is a value, not a kind term.** The only rule IR is
   `Eq(Viewer, Literal(Id("system")))`. `rule.system()` is compiler sugar for
   exactly that expression. `RuleExpr::PrincipalKind` and
   `rule.principal(kind)` do not exist. Protected identity may retain kind
   metadata, but it supplies no rule authority. The chat fixture/template
   names `rule.system()` on each system-written table.
2. **Rule-input visibility is structural and derived.**
   `rule.exists(table, index, key)` has no visibility/options argument and its
   IR has no `input_visibility`. Public/allow targets are readable. A protected
   target is readable only when substituting the exact outer indexed key for
   its row fields proves its read rule for that same row: reflexive `Eq`, all
   arms of `And`, one arm of `Or`, or a self-`Exists` on the same table/index
   reducing to the identical key. This deliberately admits the canonical
   self-readable `(scope, viewer)` membership row. Unknown or unprovable forms
   fail closed to an authority verdict. A fourth authored argument is a sited
   `E_RULE_INVALID` refusal, never an escape hatch.
3. **`Capped` is one opaque unit shape.** `take` counts visible rows only;
   denied candidates spend the certified examined/rule-probe budgets, never
   `take`. Certificate-proven prefix-uniform false ranges may finish as the
   same complete empty result as physically empty ranges. Non-uniform ranges
   are capped-only regardless of their runtime population, and an empty
   `Capped` page terminates the drain. The wire carries no site, stop reason,
   take echo, continuation, or examined position. Completeness-sensitive
   counts, emptiness/has-more branches, and writes from capped-only reads are
   refused with `E_STRUCTURAL_COUNT` and a denormalize-or-maintain rewrite.
4. **Revocation and stale authority have named proofs.** LLP 1002 §7 names
   `live-revocation`, `successor-policy-fence`, and
   `grant-incarnation-aba`. They respectively prove an admitted live query
   becomes denied at the membership-deletion commit, a retained generation
   handle cannot execute its predecessor policy after a successor, and a stale
   intent cannot hit a membership removed and recreated under the same logical
   key.
5. **The authority subject is nominal.** `Principal`/`t.principal()` is
   distinct from every application row id and `Ref<T>`, even while the v1 wire
   encodes all three as ID-shaped values. Compiler rule typing and raw
   `Generation::certify` typing resolve every comparison and indexed probe;
   `Viewer` can meet only a Principal axis or the reserved `system` literal.
6. **Private conversation metadata follows membership.** Conversation shells,
   membership rows, messages, and maintained message counts all use the current
   `(conversationId, viewer)` membership rule. The canonical outsider journey
   proves that neither a private title nor its activity count crosses that
   boundary.

## Closure audit

- [x] System authority lowers to the literal viewer equality; rule-kind terms
  and their authoring surface are absent, and runtime checks do not trust kind
  metadata.
- [x] Authored input visibility is absent from compiler, IR, Rust engine, and
  evaluator; negative compiler coverage proves authors cannot select it.
- [x] Rust, HTTP/SSE, and TypeScript use the single opaque `Capped` shape.
  Prefix-uniform empty/all-hidden and capped-only non-uniform cases have direct
  Rust/evaluator parity coverage, including maintained-aggregate completeness.
- [x] `Principal` is nominal across schema, operation args, generated/client
  types, rule checking, raw certification, and canonical fixtures.
- [x] Trusted system and development-alias contexts use reserved auth epoch
  zero, while persisted sessions use a positive durable epoch.
- [x] The named served-loop authority proofs are canonical receipt checks.
- [x] Intrinsic immutable membership ids are grant incarnations; reset,
  rollback, restart, and raw-IR cases prevent stale-id retargeting.
- [x] The 97-case shared corpus omits legacy `input_visibility` and carries the RBAC,
  later opaque-capping/completeness, and Bytes parity additions under the
  current value model. Rust and TypeScript consume the same inventory.
- [x] The chat compiler fixture and shipped template both enforce membership
  on conversation shells and message counts; the template includes the
  outsider negative journey.

## Resolution

Resolved on 2026-08-30. The canonical proof surface is the named authority
receipt checks, focused Rust/compiler/client regressions, and shared
Rust/TypeScript corpus parity above. Exact final-tree test totals, corpus
inventory, bundle size, and timing are intentionally recorded by the landing
qualification rather than frozen here across concurrent integrations.
