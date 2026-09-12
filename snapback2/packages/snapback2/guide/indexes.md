# Indexes: `unique`, `immutable`, `cap`

Tables get `id` and `byId` implicitly.
`by name: a, b` declares a named ordering. `unique name: a, b` declares a named
unique ordering and its uniqueness constraint. Declarations name their indexes;
unnamed indexes refuse with an inferred-name repair. If `byId` and `byName`
both match a read, select explicitly: `people[key] by byId` or
`people[key] by byName`. `id` may appear in an index. `immutable a, b` forbids changes.
`cap N by a, b` holds every group at N rows (an omitted optional column is the
`null` group); every writer, seeds included, refuses past it, naming the cap and group; a
successor that leaves a group over N refuses, naming the groups and the cap to raise; only
inserts, upserts, and updates that may write its grouping columns reserve the cap probe. `public`
accepts an optional reason string. An insert
postcondition is `after insert <- exists table[...] [by index]`.

See `guide quarry` for related topics.
