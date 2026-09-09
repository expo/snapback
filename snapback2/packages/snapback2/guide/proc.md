# Statement helpers

`proc deliver(c: conversations, id: messages, kind: enum('message')):` and a
block declare a statement helper; `proc deliver from access` imports it;
`deliver(c, row.id, 'message')` on its own line calls it. The body elaborates
at each call in the caller's context: parameters bind once, caller locals are
invisible, writes, `emit`, and `require` bind where the caller allows, `return`
refuses, and a parameter's type is the priced bound.

See `guide quarry` for related topics.
