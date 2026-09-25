# Shapes — E_QUARRY_SELF_EQUALITY

E_QUARRY_SELF_EQUALITY refuses a `where` equality comparing the filtered row
with itself. In a nested roster, write `members[conversation = .conversation]`:
the named key reads the enclosing row; the inner predicate's `.` is the member.
At top level, pass a conversation argument and write `.conversation = conversation`.
