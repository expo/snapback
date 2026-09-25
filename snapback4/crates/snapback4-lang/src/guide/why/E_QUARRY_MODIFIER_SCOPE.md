# Reads — E_QUARRY_MODIFIER_SCOPE

E_QUARRY_MODIFIER_SCOPE means a nested read's modifiers are ambiguous.
Parenthesize the inner read, for example `exists (messages[roomId = .roomId]
matching q)`, and put the outer page's `by .roomId after c` after its predicate.
