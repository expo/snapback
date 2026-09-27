# Writes — E_WRITE_ID

For replay adapters and retry-safe intents, pass a `mintId()` you stored with
the intent, or name a fixture label with `idFrom("post-17")`: the same label
gives the same valid id on every client and host, so a replay needs no ledger.
`idFrom` also names row ids. It is a name, not a secret.
Pass it as `{ id }`; a retry returns the original outcome and never applies twice:
`client.mutate(api.send, args, { id })`. The id must have the `mintId()` form:
26 uppercase Crockford base32 digits (0123456789ABCDEFGHJKMNPQRSTVWXYZ), with
the first digit 0–7; malformed ids return local `failed` with `E_WRITE_ID`.
Mint once and keep the id with the intent. It identifies the write, not a row;
prediction still mints separate row ids through `new_ids`.
A retry of a pending write on the same client returns the same Write object;
a settled retry returns its retained receipt, without historical result values.
Online, web and native clients share this rule; a recovered queued write is
reused before prediction or admission. Already-open owners of one device store
compare and admit under its transaction: equal input reuses the original entry
and row ids, and conflicting input changes nothing, even during a send. `client.write(id)` and
`usePendingWrite(op, id)` observe that same id.
