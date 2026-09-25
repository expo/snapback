# Shapes — E_QUARRY_DUPLICATE_FIELD

`{ ...p, extra: true }` copies a present row or object's known fields. Fields
can replace inherited fields: `{ ...p, handle: { value: p.handle } }` and
`p { *, handle: { value: .handle } }` return an object in place of the handle
text. The replacing field determines the generated type. A row contributes
the same columns and `pending?: boolean` as `p { *, extra: true }`.
A spread result is `pending` if any row spread into it, directly or through a
spread local, is pending, even when all of that row's fields are replaced.
Later spreads replace earlier fields from left to right. `pending` cannot be supplied or overwritten
in an object that spreads a row. This changes only the output;
rules, ordering and cursors still use the original row.
E_QUARRY_DUPLICATE_FIELD refuses two explicit fields with the same name, even
with a spread between them. Rename or remove the second field; the rewrite
names both locations. A bare column is an explicit field too.
E_QUARRY_SPREAD refuses nullable operands and values without statically known
fields. Establish the row first: `p = profiles[handle = h] ! else NOT_FOUND`,
then `return { ...p, extra: true }`.

For a present row, `{ ...p, extra }` and `p { *, extra: extra }` contribute
the same columns and extra value. Shapes keep `*`; object fields and spreads
can replace inherited fields with an explicit field and its type, as `handle`
does above. Two explicit fields with the same name are refused.
