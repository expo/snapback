# snapback2: align the rule surface with LLP 0331's author rulings (system principal term, derived rule-input visibility, revocation probes)

**Status:** Open
**Systems:** snapback2, schema, certificate, test
**Severity:** P2
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-30
**Related:** LLP 0331 (revision 3, author rulings 0 as amended, E-b; §"Failure and disclosure semantics"), LLP 1001 §6/§7/open decision 0, LLP 1002 §2/§7

LLP 0331 landed on main the same day the engine did. What it ratifies, the engine already has: one authorization locus (table rules in the bounded language), a reserved `system` principal that table rules name explicitly, `then`/schedules running as `system` (LLP 1001 ruling: `then` runs under ordinary rules; the chat template says `insert: rule.principal('system')`). Three points differ and should be aligned in a follow-up lane:

1. **The system-principal term.** Ruling 0 (amended) says "no kind term in rules": the system principal is an ordinary reserved principal value and a table names it with a `viewer === system` disjunct; "the spike's `PrincipalKind` term can be deleted." The engine keeps `RuleExpr::PrincipalKind` and the surface has `rule.principal('system')`. Replace with a `viewer`-vs-literal comparison (`rule.system()` sugar lowering to `Eq(Viewer, Literal(system-id))`), delete `PrincipalKind` from the IR and the compiler, re-author the chat fixture/template, keep the 76-case corpus identical.
2. **Rule-input visibility.** LLP 0331: "derived from the referenced table policy, not an author-controlled `readable`/`hidden` escape hatch." `rule.exists(table, index, key, { hidden? })` carries S1's `input_visibility`. Derive it: a probe into a table whose read rule the viewer would not pass is hidden; remove the option.
3. **Derived checks.** LLP 0331 asks the tests to probe "role change and revocation while a live query is active, a stale program handle after policy replacement, and a stale grant handle after remove/recreate." `snapback2 test`'s `rules`/`invalidation` checks cover allowed/denied principals and delivery/silence; add the revocation-while-live probe (a subscription that turns `denied` when its membership row is deleted — the engine delivers it; the check must assert it) and the stale-handle probe across a successor.
4. **Disclosure and `Capped`.** LLP 0331's "production reads … reveal no hidden row or relationship existence" is the same objection grok raised to LLP 1001's round-2 ruling that a `Limit` stop among hidden rows is `Capped` (open decision 0). Decide the third form there with this document as evidence.

## Resolution — items 1–3 (2026-08-30)

Items 1–3 are resolved. The rule IR and evaluator no longer have
`PrincipalKind`; zero-argument `rule.system()` lowers to equality between the
viewer and the core-owned reserved system principal id, and the chat fixture
and template use it. Authored rule probes no longer carry `hidden` /
`input_visibility`; the evaluator derives readable versus scoped-verdict
delivery from the referenced table's read rule for the running viewer, with
tests for both outcomes. The existing `snapback2 test` invalidation check now
asserts a live membership-row revocation delivery and replans a generation-N
query handle after a policy-only generation-N+1 successor.

The frozen 76-program corpus contains no `PrincipalKind`, and its complete
certificate response remained byte-identical across the change. Item 4 is
still the open author decision, so this ticket remains **Open**.
