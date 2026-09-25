# Shapes — E_QUARRY_SELF_EQUALITY

E_QUARRY_SELF_EQUALITY refuses comparisons of a filtered row column with itself:
`=`, `!=`, `<`, `<=`, `>`, `>=`, and `in` a list containing that same column.
Optional columns keep `<=` and `>=`: in read predicates these test presence,
because ordered comparisons are false on null. Aggregate predicates retain
their existing E_QUARRY_MAINTAIN refusal for nullable ordered operands.
It checks read, view, column-aggregate and timeline event predicates, including
expressions in nested read keys. Those keys keep the enclosing focal row;
a nested read's own `where` introduces its own focal row.

In a nested roster, write `members[conversation = .conversation]`:
the named key reads the enclosing row; the inner predicate's `.` is the member.
The key repair requires a matching column on the enclosing row and a bounded
read. It keeps the other conjuncts, page size and ordering. Otherwise use an
argument repair. Comparisons under `or` or `not` are not moved into keys.
At top level, use `where .conversation = conversation` with an explicit argument.
The repair names a compatible existing argument, or adds a typed argument to
the operation while preserving its body. Projected views use their inferred
column types. Uncertain types or source spans produce no replacement text.
Aggregate and timeline declarations
have no argument scope: their repair makes the constant `true` or `false`
behavior explicit. Keep that only if intended, or write a column-to-value filter.
Scope repairs require intent and are never applied by `check --fix`.
