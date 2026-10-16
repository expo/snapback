# N_LOOKUP_HIDDEN

N_LOOKUP_HIDDEN concerns reads before writes. Read access is required for a program's own lookup before a write, such as
`let row = tasks[task] ! else NOT_FOUND`. If that row is hidden, this lookup
refuses before any later write rule runs. A nullable lookup returns null.
Guard or remove the lookup, or deliberately admit the reader when the operation
needs those contents. Do not widen read access solely to permit a blind patch.

A direct `update tasks[task] { ... }` or upsert patch can change an unreadable
row when its update rule admits the old and next images; success returns null
if the result stays unreadable. A denied hidden target returns NOT_FOUND.
An update condition requires a readable target. See `guide rules` and
`why NOT_FOUND` for disclosure and immutable-column behavior. Prove the intended
role with fixture and HTTP cases before changing its read audience.
