# Rules: `read`, `viewer`

Rules are `allow`, `deny`, `public`, `exists`, `created`, `and`,
`or`, `not`, and `=`/`!=` over `viewer`, literals, `.field`, and channel
arguments. `created` is insert-only. Table rules omit a binder (`read <- …`);
`.` is the row, or the candidate image for update. Only `update (old, next)`
names binders. Select their fields explicitly: `old.id`, `old.owner`,
`next.owner`. A bare update binder refuses, even when a column shares its name;
use `.old` in a focal rule or `next.old` in a two-image rule for that column.
Channel arguments, including ones named `old` or `next`, stay bare.
Rule `exists`/`created` accepts any index whose leading columns match the key;
when several match, add `by index`. Parentheses allow multiline rules.
Self-probes on a full unique key of nonoptional columns are uniform over own rows;
so is an `or` with an arm proven true by the prefix.

See `guide quarry` for related topics.
