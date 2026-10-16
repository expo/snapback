# E_READ_THROUGH

E_READ_THROUGH requires `read through .ref` as the complete read rule, a required immutable reference without a default, and immutable parent rule inputs and expiry. Put service grants on the parent. A child insert also needs a live parent readable by its writer; its own insert rule adds conditions. A child inherits its parent's effective deadline. Sync follows the substituted rule only when its audience is invertible. Otherwise use `online only`.

For a child readable by the parent's current department roster, use the transactionally maintained copy in `guide rule-recipes current-roster`. An immutable copy preserves creation-time authority; it does not follow transfers. A live form remains under design.
