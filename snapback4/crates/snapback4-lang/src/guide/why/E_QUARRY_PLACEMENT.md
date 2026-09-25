# Programs — E_QUARRY_PLACEMENT

E_QUARRY_PLACEMENT means a statement is valid only in another context.
For example, `query add():` cannot contain `insert notes { body: 'hello' }`;
make that operation `mutation add():` so the write runs in its transaction.
Queries cannot insert, update, delete or mint ids, even through a helper.
Keep read-only work in a query, put writes in a mutation or job, and put
`break` or `continue` inside the loop they control. The rewrite names the
misplaced statement and where it belongs.

The table names are the language card's; a `job` is `for row in table where predicate:` sweeps (guide jobs), or `native`: the app's
own Rust, hosted as wasm; a `query` may be `native` too, run on the server
as the viewer and on a device over its rows (guide native). Operations in `schema.q`
are called by name (`api.thread`); operations in `snapback/feed.q` are
`api.feed.<name>`; jobs are not on api.ts. `require cond else CODE` refuses
with the program's own code, which reaches the client as `{ code, family:
"rule", .. }`; `CODE` is UPPER_SNAKE and never starts with `E_`. Statements
are `x = expr` (bind or reassign a local), `(a, b) = divmod(..)`, `require`, `if:`/`else if:`/`else:`, `for x in
domain:`, `break`, `continue`, `return`, a helper `fn` call, and a write; every other
expression must be bound or returned. `fn` takes one expression or a body ending
in `return expr` or a bare `return`; calls work in statements and expressions.
A helper return exits only the helper, and its locals cannot capture the caller's.
It never repositions or reclassifies an enclosing page.
Queries cannot write or mint ids, including through a helper; the call site names
the write that does not belong.

`shape card = { id, name, owner: .ownerId }` names a shape; `row card` and
`page card` use it, and `{ ...card, extra: 1 }` spreads its fields into
another. After a scalar predicate, `where not .hidden card` shapes the page
with the declared `card`, as does `where not .hidden { ...card }`. A valid
row/object shape inside a predicate keeps its meaning; parenthesize that
operand, or use `{ ...card }` explicitly for the page.
`fn isBrief(ttl: int ?): ttl != null` is a helper expression and
`fn stamp(roomId: rooms):` a helper block ending in `return expr` or a bare `return`,
each expanded where it is called (`isBrief(ttl)`; `stamp(r.id)` as a
statement or expression), at most eight levels deep. A table-typed helper parameter keeps a row argument as a row with fields and no lookup; a reference argument stays a reference. A helper can write only
when its caller can; a query's diagnostic names the write at the call site.
A helper's `return` ends only that call, including inside a page's shape;
the page keeps its continuation and completeness.
