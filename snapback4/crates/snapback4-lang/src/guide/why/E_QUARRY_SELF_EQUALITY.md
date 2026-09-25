# Shapes — E_QUARRY_SELF_EQUALITY

E_QUARRY_SELF_EQUALITY refuses comparisons of a filtered row column with itself:
`=`, `!=`, `<`, `<=`, `>`, `>=`, and `in` a list containing that same column.
It checks read, view, column-aggregate and timeline event predicates, including
expressions in nested read keys. Those keys keep the enclosing focal row;
a nested read's own `where` introduces its own focal row.

In a nested roster, write `members[conversation = .conversation]`:
the named key reads the enclosing row; the inner predicate's `.` is the member.
At top level, use `where .conversation = conversation` with an explicit argument.
The repair names a compatible existing argument, or adds a typed argument to
the operation while preserving its body. Aggregate and timeline declarations
have no argument scope: their repair makes the constant `true` or `false`
behavior explicit. Keep that only if intended, or write a column-to-value filter.
Scope repairs require intent and are never applied by `check --fix`.
