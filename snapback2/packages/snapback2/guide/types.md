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


A bounded list example: `tags: [text <=32] <=8` stores at most eight strings,
each at most 32 characters. `tags: [text <=32] <=8 ?` also permits absence;
use `tags ?? []` before iterating. `[]` is present and suppresses fallback.

See `guide quarry` for related topics.
