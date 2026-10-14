# E_UNIQUE

E_UNIQUE means a caller-readable row already holds this declared secondary unique key.
The refusal names `unique principal` (or the declared columns), never the
planner's internal index name. Update the existing row or choose a new key.
Declare `else CODE 'message'` on the key to use an application refusal instead.
`insert … if absent` returns null on a readable collision when doing nothing
is the intended operation. Every refused write rolls back the whole mutation.
An intrinsic id clash remains E_CONSTRAINT; a hidden clash remains the ambiguous
E_RULE (or NOT_FOUND for an unreadable write target). Keep private keys private.
See `guide writes` for constraints that govern every writer across hidden rows.
