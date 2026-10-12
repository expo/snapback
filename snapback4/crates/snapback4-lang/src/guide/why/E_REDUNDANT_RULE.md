# Totals — E_REDUNDANT_RULE

E_REDUNDANT_RULE means an aggregate read rule repeats its parent's rule
through the group reference. Omit the entire read line to inherit the parent's
authorization. This preserves the audience; making the total public would
widen it. The mechanical check --fix repair removes only that redundant line.
