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
Insert yields its row. A returned update/upsert reads its result once after
writing; `! else CODE` requires that view and rolls back on refusal. Ignored
writes add no result read. Delete yields no value. A final write is an implicit
return, except in a proc. Search re-derivation is priced only when an update
patch names an indexed source column; upsert carries insert derivation cost.

With read authority, optional cleanup may read and guard before deleting; a
direct delete of a missing point refuses `E_REQUIRE:NOT_FOUND`:

```q
mutation clearDigest(digest: text <=64):
  row = messages[digest] by byDigest
  if row != null:
    delete messages[row]
  return null
```

Read and delete authority are independent. With delete-only authority, keep a
direct by-id delete and handle an expected `NOT_FOUND` at its authorized caller;
Quarry cannot guard an unreadable row without silently skipping an existing one.

See `guide quarry` for related topics.

## Insert if absent

`insert memberships { group, principal: viewer } if absent` returns the inserted
row, or `null` when any unique key already exists. It never returns the conflicting
row, even when that row is readable. Insert authorization runs before uniqueness
probes; an insertion still checks constraints and updates maintained values.
Offline, an unheld unique range remains `partial`.

## Conditional update

Use `update messages[messageId] { body } if .body = baseBody` to edit only the
body the caller read. The chat template's `messages.edit` is a complete example.

The key evaluates once; the patch evaluates only after the condition passes.
A false condition or absent/unreadable target returns `E_CONFLICT` with the
readable current row or `null`; review it before submitting a new edit.
`expectedGeneration` on the mutation wire separately fences the operation and
schema using the manifest's `programGeneration`; it is not a row version.
SDK calls pin it automatically. `E_GENERATION_CHANGED` requires inspecting the
current operation before a fresh call. Never rewrite a queued envelope.
