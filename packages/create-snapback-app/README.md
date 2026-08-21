# `create-snapback-app`

The ecosystem-standard scaffold entry point for Snapback applications:

```sh
npm create snapback-app my-chat
# equivalently:
npx create-snapback-app my-chat
bun create snapback-app my-chat
pnpm create snapback-app my-chat
```

The default template is `expo-chat`, the golden-path Expo starter carrying a
working conversation surface (messages table, image upload intent, live
queries, the generated `conversation` surface, typing presence, and a React
Native chat screen). Pick another template with `--template <name>`;
`create-snapback-app --help` lists every template shipped by the installed
`@expo/snapback-cli`.

This package is a thin wrapper. It parses `<target-dir>` and `--template`,
then delegates to the `@expo/snapback-cli` scaffold mechanism — the same code
path as `snapback new <name> --template <name>` — so there is exactly one
scaffolder and one template registry.

After scaffolding:

```sh
cd my-chat
bun install
bun run dev
bun run prove
```

`bun run prove` is ordinary completion and the only done-oracle: it writes the
authoritative aggregate `snapback verify` receipt (acceptance evidence, not
formal proof). `npm test` runs the raw starter acceptance that `prove` wraps
for debugging, while `bun run test:static` checks no-server source/generated
coherence. Available `bun run carry:*` commands drive browser or simulator
observation only after accepting the `prove` receipt; their artifacts are not
proof authority.

## Documentation outside a checkout

A running Snapback server serves the Guide compiled into that exact build.
These links use the first default development port; use the origin printed by
`snapback dev` or `snapback start` if yours differs.

- Read [the authoring loop](http://127.0.0.1:4287/_snapback/guide/getting-started/the-authoring-loop.md).
- Read first: [the start packets](http://127.0.0.1:4287/_snapback/guide/start/index.md)
  — the budgeted per-template first read (LLP 0259).
- Look up (do not linear-read) the [capability index](http://127.0.0.1:4287/_snapback/guide/capabilities.md).
- Run `snapback guide` or `snapback guide <query>` to browse or search the embedded Guide.
- Run `snapback mcp` for the same build-bound corpus as read-only MCP resources, starting at `snapback-guide://manifest`.
