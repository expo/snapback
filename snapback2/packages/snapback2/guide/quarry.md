# Quarry: `schema` and JSON `config`

Quarry is the backend language. `check` compiles in memory; inspection goes in
`.snapback/build/quarry/`. `guide grammar` is the syntax map.

`snapback/schema.q` holds `use identity`, tables, maintains and channels.
.q` stems name API namespaces; `messages.q` exports `api.messages.thread`.
TypeScript is only seeds, tests, and effect I/O;
otherwise use Quarry. Effect/`.q` stems differ.

Declarations use `:` before their body. Callables always use parentheses,
including `job cleanup():`; schedules call inline: `schedule cleanup every 1h: sweep()`.
See `guide schedule` for the complete forms.

Topics: `types`, `money`, `indexes`, `rules`, `maintain`, `programs`,
`expressions`, `pagination`, `merge`, `absence`, `bounds`, `writes`, `job`,
`schedule`, `effects`, `auth`, `offline`, and `testing`.

`use identity` enables passwords and guests; append `password` or `guests` to select one.

## JSON window config

Quarry does not import JSON. Keep integer windows in `config/windows.json`, then
generate expression-only functions before `check` or `dev` starts:

```sh
node node_modules/snapback2/dist/guide/recipes/quarry-window-config.js config/windows.json snapback/config.q
snapback2 check
```

For `{"editWindowMs":60000}`, the generated module contains
`fn editWindowMs(): 60000`. Another module imports it with
`fn editWindowMs from config` and calls `editWindowMs()`.
