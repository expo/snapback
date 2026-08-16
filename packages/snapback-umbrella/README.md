# `@expo/snapback`

Experimental, thin familiar-authoring entrypoints for Snapback. This package
only re-exports implementation owned by `@expo/snapback-codegen`,
`@expo/snapback-client`, and `@expo/snapback-react`, including the
`/server`, `/values`, `/data`, `/react`, and `/react/data` doorways.

## Documentation outside a checkout

A running Snapback server serves the Guide compiled into that exact build.
These links use the first default development port; use the origin printed by
`snapback dev` or `snapback start` if yours differs.

- Follow [the authoring loop](http://127.0.0.1:4287/_snapback/guide/getting-started/the-authoring-loop.md)
  for the complete Snapback development flow.
- Read [generated artifact custody](http://127.0.0.1:4287/_snapback/guide/getting-started/generated-artifacts.md)
  before committing generated files.
- Read first: [the start packets](http://127.0.0.1:4287/_snapback/guide/start/index.md)
  — the budgeted per-template first read (LLP 0259).
- Look up (do not linear-read) the [capability index](http://127.0.0.1:4287/_snapback/guide/capabilities.md)
  before assuming a target or doorway is supported.
- Run `snapback guide` or `snapback guide <query>` to browse or search the
  embedded Guide.
- Run `snapback mcp` for the same build-bound corpus as read-only MCP
  resources, starting at `snapback-guide://manifest`.
