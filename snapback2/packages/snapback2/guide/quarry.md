# Quarry

Quarry is the backend language. `check` compiles in memory; inspection goes in
`.snapback/build/quarry/`, never `snapback/`. `guide grammar` is the syntax map.
Use `guide <topic>` for one complete card; unknown topics list available names.

`snapback/schema.q` holds `use identity`, tables, maintains and channels.
`.q` stems name API/shape namespaces; `messages.q` exports
`api.messages.thread`. TypeScript is only seeds, tests, and effect I/O;
otherwise use Quarry. Effect/`.q` stems differ.

Declarations use `:` before their body: `fn member(c: conversations): expression`,
`proc deliver(c: conversations):` with a statement block, and
`maintain counts: count messages by conversationId` with indented read rules.
Callables always declare parentheses, including `job cleanup():`;
schedules name an inline call: `schedule cleanup every 1h: sweep()`.

- Types: `guide types`, `guide money`, `guide assets`.
- Schema: `guide indexes`, `guide rules`, `guide maintain`, `guide retain`.
- Programs: `guide programs`, `guide expressions`, `guide shape`, `guide fn`, `guide proc`.
- Reads: `guide pagination`, `guide merge`, `guide absence`, `guide bounds`, `guide live-query`.
- Writes and background work: `guide writes`, `guide job`, `guide schedule`, `guide expiry`, `guide effects`.
- App lifecycle: `guide auth`, `guide offline`, `guide personas`, `guide testing`, `guide migrations`.

`use identity` enables passwords and guests; `use identity password` or
`use identity guests` selects one. `guide init` gives the initialization command.
