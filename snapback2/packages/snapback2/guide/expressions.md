# Expressions: `require`, `for`, `walk`, `tokens`

`require condition else CODE` aborts when false. Other statements
bind expressions or `sorted` tuples, `return`, `if/else`, or bounded `for`;
`return` works in all arms and a body's last expression is an implicit return.

Objects allow shorthand: `{ id: conversationId, creatorMembershipId }`.
`slice(text, start, end)` returns the half-open range of Unicode scalar
positions. Literal endpoints narrow the result's text bound, so
`slice(body, 0, 80)` fits a `text <=80` preview.
`count(text)` is not a length check; clamp a stored caption directly:

```q
mutation send(body: text <=500, digest: text <=64):
  return insert messages { body, caption: slice(body, 0, 80), digest, author: viewer, at: now }
```

`count(x)` counts bounded lists/pages. Text concatenation is not supported;
return separate fields such as `{ body, caption }`, or expose two typed queries.
Other built-ins are `range`, `min`, `max`, and `share`. `sorted` is only
`(lo, hi) = sorted(a, b)` and evaluates each value once.
`! else CODE` requires presence; bare `!` refuses with that repair.
`??` supplies a fallback. Program `=`/`!=` are total: absent equals absent, differs from present;
`!=` is `not (=)`. Ordered comparisons require present operands; narrow with
`if x != null:`, require with `! else CODE`, or use `??` first.

`walk table[seed] up .column depth N` follows at most N parent links.

`tokens(text)` extracts `@` mentions. Search uses a schema
`wordPrefixes(field)` index and an ordinary bounded prefix read; there is no
public `words()` value function. See `guide live-query` for indexing and editing.

`now` is the query read clock and mutation commit clock; `commit` is the commit
clock. Both are pinned per request. `new` allocates per evaluation.

See `guide quarry` for related topics.

`for` needs a bounded list/page/range/tokens result; see `guide bounds` for
optional-list presence and complete mutation fan-out requirements.
