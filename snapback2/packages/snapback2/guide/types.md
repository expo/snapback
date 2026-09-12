# Types

Virtual `connected[p]` yields the int connection count for `p: principal`;
`exists connected[p]` tests presence; see `guide connected`.

Column/argument types: `principal`, `id`, table references, `int`, `time`,
`bool`, `decimal <scale>`, `money <CUR> [scale]`, `text <=N`, `text M..N`,
`json <=N`, `bytes <=N`, `enum(...)`, and bounded lists `[type] <=N`. Decimal
and money scales are integers 0–12 (money defaults to 2; its currency is three
uppercase letters). Add `?` for optional. Text may add `format handle`/`format url` after its bound; minimums and
formats are enforced, maximums stay part of the type.
Text forbids C0 controls but tab, LF, CR.


`viewer` is a nominal `principal`, distinct from table references and `id`
despite the shared wire shape. Columns used with `viewer` must be `principal`.
A non-empty text literal in an Id position (key, merge prefix, equality,
or `??` fallback) is an Id on the wire; text expressions and wrong-table refs
refuse. A cursor position takes the token, never an Id literal.


A bounded list stores scalars only: `tags: [text <=32] <=8` or an operation
argument such as `terms: [text <=128] <=20`. Object/row arrays refuse; call one
typed operation per object, or pass independently processed scalar arrays.
Add `?` for absence and use `tags ?? []` before iterating.

See `guide quarry` for related topics.
