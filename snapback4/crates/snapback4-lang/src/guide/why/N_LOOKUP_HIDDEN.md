# N_LOOKUP_HIDDEN

A required point lookup reads under its table's read rule. N_LOOKUP_HIDDEN reviews that gate when the table's update or delete rule admits a role its read rule never uses: those role holders may receive the lookup's authored refusal code even though the table permits their write. Earlier guards proving the exact row readable silence the note. A blind mutable update is not a program read and does not receive this warning. If those role holders should pass the required lookup, let them read the intended rows; otherwise keep the lookup as the reader-only gate. guide rules.

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
