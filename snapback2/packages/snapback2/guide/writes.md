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
An update re-derives a search index, and is priced for it, only when its patch
names a column that index reads; other patches keep the postings at no cost.

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
A false condition or absent/unreadable target returns a rejected mutation with
`reason: "conflict"`, `code: "E_CONFLICT"`, and `current` (the readable current row
or `null`). The owner rolls back the whole mutation before freshly authorizing
that row. Review the current value before submitting a new edit.
`expectedGeneration` on the mutation wire separately fences the operation and
schema using the manifest's `programGeneration`; it is not a row version.
SDK calls pin it automatically, including uploaded arguments. A stale call
returns `E_GENERATION_CHANGED` without automatic retry: inspect the current
operation before a fresh call. Identical durable retries return their original
terminal result first. Never rewrite an already queued envelope.
