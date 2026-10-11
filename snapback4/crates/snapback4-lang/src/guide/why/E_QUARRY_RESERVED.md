# Quarry — E_QUARRY_RESERVED

E_QUARRY_RESERVED names a Quarry keyword used as a name, at its declaration,
before a later use fails with a generic syntax error. Rename it at the
declaration and each use.

A column cannot be named after a word that begins a table line: `after`, `by`,
`cap`, `delete`, `deliver`, `ephemeral`, `expire`, `immutable`, `insert`,
`online`, `public`, `read`, `retain`, `search`, `sync`, `unique`, `update`
(and `id`, which every row has). For example `isRead: bool`,
`author: principal`, `expiresAt: time`.

A parameter, local or loop variable cannot be a word a statement or
expression reads as syntax: `and`, `as`, `break`, `continue`, `created`,
`delete`, `device`, `elif`, `else`, `emit`, `exists`, `false`, `for`, `if`,
`insert`, `merge`, `not`, `null`, `oblivious`, `or`, `require`, `return`,
`true`, `update`, `upsert`, `viewer`, `walk`, `while`. For example
`mutation removeUpdate(change: updates)`. Table, view, function and shape
names are not restricted.
