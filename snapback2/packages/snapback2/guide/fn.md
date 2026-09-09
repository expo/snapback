# Expression helpers

`fn member(c: conversations, p: principal): exists memberships[c,p]` is an
expression helper; `fn member from access` imports it. Arguments evaluate once
left-to-right. Parameters, context, and bounded reads are valid; capture,
allocation, commit time, writes, assertions, and recursion refuse. Callers own
their `require`/`! else CODE`.

See `guide quarry` for related topics.
