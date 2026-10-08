import Quarry
/-! Prints the axioms each headline theorem depends on. `check.sh` fails if
any depends on `sorryAx`. Expected: at most `propext`, `Classical.choice`,
`Quot.sound`. -/
open Quarry
#print axioms Scalar.cmp_lawful
#print axioms Scalar.le_antisymm
#print axioms Scalar.le_trans
#print axioms Scalar.le_total
#print axioms encKey_agrees
#print axioms keyCmp_lawful
#print axioms id_ne_text
#print axioms codepoint_order
#print axioms run_deterministic
#print axioms sortRows_perm
#print axioms candidates_perm
#print axioms pageRead_perm
#print axioms query_noninterference
#print axioms query_writes_nothing
#print axioms pageRead_visible
#print axioms page_rows_readable
#print axioms countRead_eq
#print axioms existsRead_eq
#print axioms query_ignores_hidden_insert
#print axioms pageRead_complete
#print axioms walk_complete
#print axioms cut_continuation
#print axioms applyWrite_authorized
#print axioms mutation_authorized
#print axioms or_true_skips
#print axioms and_false_skips
#print axioms or_true_skips_null_assertion
#print axioms cond_true_skips
#print axioms identity_sum
#print axioms call_scope_independent
#print axioms triple_conseq
#print axioms triple_nil
#print axioms triple_assign
#print axioms triple_require
#print axioms triple_ret
#print axioms triple_ite
#print axioms triple_write
#print axioms triple_write_authorized
