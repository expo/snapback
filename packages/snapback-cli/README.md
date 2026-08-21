<!-- @ref LLP 0187#t4--build-the-out-of-repo-funnel-before-it-is-tested-for-real — the published CLI is the first checkout-independent orientation point. -->
<!-- @ref LLP 0061#4-distribution-and-discovery — every package link routes to the build-bound served Guide or its MCP projection. -->

# `@expo/snapback-cli`

Snapback is a complete application backend: declare a schema and server
functions, generate typed clients, then run queries, mutations, live data,
auth, and local-first behavior through one coherent development loop. It is
designed to scale to zero for prototypes and back up for real applications.

## Start a project

Install the CLI, scaffold an app, and install the generated dependencies:

```sh
npm install --global @expo/snapback-cli
snapback new my-app --template todo-contract
cd my-app
bun install
```

Use `--template react` for the React/Vite starter, or `--template expo-chat`
for the golden-path Expo conversation starter (messages with image upload,
live queries, the generated conversation surface, and typing presence).

## The golden path

1. Declare tables, fields, indexes, and sync policy in
   `snapback/schema.mjs`.
2. Define queries and mutations in `snapback/functions.mjs`.
3. Generate the typed artifact graph:

   ```sh
   bun run generate
   ```

4. Start codegen, the backend, artifact loading, and file watching:

   ```sh
   bun run dev
   ```

5. In another terminal, run the starter's first query against the managed
   ready file:

   ```sh
   snapback run listTodos \
     --ready-file .snapback/dev.ready.json \
     --user user_ada \
     --args '{}'
   ```

For ordinary completion, run `bun run prove`, the only done-oracle; it writes
the authoritative aggregate `snapback verify` receipt (acceptance evidence,
not formal proof). `npm test` runs the raw starter acceptance that `prove`
wraps for debugging, while `bun run test:static` checks no-server
source/generated coherence. Available `bun run carry:*` commands drive browser
or simulator observation only after accepting the `prove` receipt; their
artifacts are not proof authority.

## Documentation outside a checkout

A running Snapback server serves the Guide compiled into that exact build.
These links use the first default development port; use the origin printed by
`snapback dev` or `snapback start` if yours differs.

- Read first: [the start packets](http://127.0.0.1:4287/_snapback/guide/start/index.md)
  — the budgeted per-template first read (LLP 0259).
- Look up (do not linear-read) the [capability index](http://127.0.0.1:4287/_snapback/guide/capabilities.md)
  so you do not rebuild a feature that already exists.
- Follow [your first backend](http://127.0.0.1:4287/_snapback/guide/getting-started/your-first-backend.md)
  or browse the [Guide index](http://127.0.0.1:4287/_snapback/guide).
- Fetch the complete agent-oriented projection at
  [flat.md](http://127.0.0.1:4287/_snapback/guide/flat.md).
- Run `snapback guide` for these channels or `snapback guide <query>` to
  search the embedded Guide by section.
- Run `snapback mcp` to expose the same build-bound corpus as read-only MCP
  resources, starting at `snapback-guide://manifest`.

## Operate it

`snapback mcp` serves read-only Guide resources; `snapback mcp-control` adds typed control tools with local admin authority.
Preview control setup with `snapback agent setup --print <client> --server mcp-control`.
