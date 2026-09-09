# Expressions: `require`, `for`, `walk`, `tokens`

`require condition else CODE` aborts when false. Other statements
bind expressions or `sorted` tuples, `return`, `if/else`, or bounded `for`;
`return` works in all arms and a body's last expression is an implicit return.

Objects allow shorthand: `{ id: conversationId, creatorMembershipId }`.
`count(x)` is
`x.length` for bounded lists and pages. Bindings and captured list fields keep their selected element count;
a field named `length` stays that field. Other built-ins are `range`,
`min`, `max`, and `share`. `sorted` is only `(lo, hi) = sorted(a, b)`:
it evaluates `a` then `b` once and returns the values in canonical scalar order.
`! else CODE` requires presence; bare `!` refuses with that repair.
`??` supplies a fallback. Program `=`/`!=` are total: absent equals absent, differs from present;
`!=` is `not (=)`. Ordered comparison refuses an optional operand;
use `! else CODE`, `??`, or narrowing first. `if x != null:` narrows a bound
name or one-hop row field in its then branch; `if x = null:` narrows the else.
`x != null and R` narrows R and evaluates its reads only when reached;
`require x != null else CODE` narrows the rest of its block.

`walk table[seed] up .column depth N` follows at most N parent links.

`tokens(text)` extracts `@` mentions. Search uses a schema
`wordPrefixes(field)` index and an ordinary bounded prefix read; there is no
public `words()` value function. See `guide live-query` for indexing and editing.

`now` is the read clock in queries, the commit clock in mutations; `commit`
is the commit clock. `now` is pinned per request rather than redrawn;
`new` allocates a fresh ID per evaluation.

See `guide quarry` for related topics.

`for` needs a bounded list/page/range/tokens result; see `guide bounds` for
optional-list presence and complete mutation fan-out requirements.
