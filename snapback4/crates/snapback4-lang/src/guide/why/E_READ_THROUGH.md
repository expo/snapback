# E_READ_THROUGH

E_READ_THROUGH: bare `read through` requires `read through .ref` as the complete read rule, a required immutable reference without a default, and immutable parent rule inputs and expiry. Put service grants on the parent. A child insert also needs a live parent readable by its writer; its own insert rule adds conditions. A child inherits its parent's effective deadline. Sync follows the substituted rule only when its audience is invertible. Otherwise use `online only`.

For a child readable by the parent's current department roster, use the live form in `guide rule-recipes current-roster`; its manual-copy alternative keeps maintenance in the application. An immutable copy preserves creation-time authority.

For current authority on a mutable parent, use `read through live .ref` with
`immutable ref` and an honest `cap N by ref`. The bounded live form owns its
private copy maintenance; unsupported lifetimes, chains, derivations, receipt
roles, reference actions or index shapes keep the manual current-roster recipe.
See: `snapback4 guide rule-recipes current-roster`.
