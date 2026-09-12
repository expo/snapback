# Rules: `read`, `viewer`

Rules are `allow`, `deny`, `public`, `exists`, `created`, `and`,
`or`, `not`, and `=`/`!=` over `viewer`, literals, `.field`, and channel
arguments. `created` is insert-only. Table rules omit a binder (`read <- …`);
`.` is the row, or the candidate image for update. Only `update (old, next)`
names binders. Select fields explicitly: `old.id`, `old.owner`,
`next.owner`. Bare update binders refuse even for same-named columns;
access those as `.old` in focal rules or `next.old` in two-image rules.
Channel arguments stay bare, even `old`/`next`.
Rule `exists`/`created` requires a complete ordinary index key;
add `by index` when ambiguous. Parentheses allow multiline rules.
Self-probes on a full unique key of nonoptional columns are uniform over own rows;
so is an `or` with an arm proven true by the prefix.

See `guide quarry` for related topics.
