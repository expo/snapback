# Writes: `insert`, `update`, `upsert`, `delete`

Inserts return rows; omit optional columns you do not use.
Writes: `insert table { fields }`, `update table[key] { patch }`,
`upsert table[key] { row }`, `delete table[key]`. Non-insert keys must be complete
unique keys, including composite alternatives. Alternate-key update/delete
read once, require the row (`NOT_FOUND`), then write by `id`.

Keys evaluate once and supply omitted upsert key columns. A row/patch may repeat
a key column only with its key expression; otherwise `E_QUARRY_TYPE` names the
field to remove. Upsert cannot spell `id`: by-id uses the key; alternate-key
keeps a hit's id or mints one.
Insert yields its row. A bound or returned update/upsert reads its result once
right after writing: a snapshot, or absence when its read rule denies the
caller (including self-revocation). `! else CODE` requires that view and
rolls back on refusal. Ignored update/upsert adds no result read. Delete yields
no value. A body's final write is an implicit return; never in a proc.

See `guide quarry` for related topics.
